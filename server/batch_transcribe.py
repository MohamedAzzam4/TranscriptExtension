"""Local full-media transcription worker for the Native Messaging host.

The worker accepts one JSON request on stdin and writes newline-delimited JSON
events to stdout. Only public HTTP(S) media is accepted; browser cookies are
never copied into the native process.
"""

from __future__ import annotations

import io
import ipaddress
import json
import os
import re
import shutil
import socket
import statistics
import sys
import tempfile
import time
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from typing import Iterable
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

# CTranslate2 loads these DLLs lazily when inference begins, so the directory
# must be registered before importing faster-whisper (not merely before model
# construction).
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUDA_DIRECTORY = os.path.join(PROJECT_ROOT, ".runtime", "cuda")
CUDA_DLL_HANDLE = None
if os.path.isdir(CUDA_DIRECTORY):
    os.environ["PATH"] = CUDA_DIRECTORY + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        CUDA_DLL_HANDLE = os.add_dll_directory(CUDA_DIRECTORY)

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from whisperlivekit.timed_objects import ASRToken

from subtitle_lines import split_tokens


SILENCE_BREAK_SECONDS = 0.65
RESULT_CHUNK_SIZE = 100
ALLOWED_SOURCE_KINDS = {"browser-pcm", "direct", "youtube"}
MAX_CAPTION_BYTES = 8 * 1024 * 1024
HTTP_AUDIO_CHUNK_BYTES = 8 * 1024 * 1024
MAX_AUDIO_BYTES = 1024 * 1024 * 1024
MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
MAX_HLS_SEGMENT_BYTES = 64 * 1024 * 1024
MAX_HLS_SEGMENTS = 5_000
MAX_DIRECT_CANDIDATES = 10
WORKER_VERSION = "0.10.4"


@dataclass(frozen=True)
class CaptionAnswerKey:
    language: str
    kind: str
    name: str | None
    segments: list[dict]


@dataclass(frozen=True)
class ResolvedSource:
    url: str
    headers: dict[str, str]
    title: str | None = None
    duration: float | None = None
    answer_key: CaptionAnswerKey | None = None
    answer_key_status: str = "not-requested"
    youtube_page_url: str | None = None
    media_extension: str | None = None
    media_kind: str | None = None
    discovery_source: str | None = None
    language_hint: str | None = None
    codec_hint: str | None = None
    profile_hint: str | None = None
    bitrate: int | None = None
    channels: int | None = None
    representation_index: int | None = None
    local_pcm_path: str | None = None


@dataclass(frozen=True)
class HlsPngTsInspection:
    segments: list[tuple[str, float | None]]
    first_transport_stream: bytes
    first_payload_bytes: int
    wrapper_kind: str


def emit(state: str, job_id: str, **payload) -> None:
    print(
        json.dumps(
            {"state": state, "jobId": job_id, **payload},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        flush=True,
    )


LOOPBACK_MEDIA_HOSTS = {"localhost", "127.0.0.1", "::1"}


def normalized_loopback_origin(value: str | None) -> tuple[str, str, int] | None:
    parsed = urlsplit(str(value or ""))
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        return None
    hostname = parsed.hostname.rstrip(".").casefold()
    if hostname not in LOOPBACK_MEDIA_HOSTS:
        return None
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return None
    return parsed.scheme, hostname, port


def validate_public_http_url(
    value: str,
    *,
    youtube_only: bool = False,
    allowed_loopback_origin: str | None = None,
) -> str:
    parsed = urlsplit(str(value or ""))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Batch analysis requires an HTTP(S) media source.")
    if parsed.username or parsed.password:
        raise ValueError("Media URLs containing credentials are not accepted.")

    hostname = parsed.hostname.rstrip(".").casefold()
    if youtube_only and not (
        hostname == "youtu.be"
        or hostname == "youtube.com"
        or hostname.endswith(".youtube.com")
    ):
        raise ValueError("The YouTube batch adapter only accepts YouTube page URLs.")

    try:
        candidate_origin = (
            parsed.scheme,
            hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
        )
    except ValueError as error:
        raise ValueError("The media URL contains an invalid port.") from error
    authorized_origin = normalized_loopback_origin(allowed_loopback_origin)
    if hostname in LOOPBACK_MEDIA_HOSTS and candidate_origin == authorized_origin:
        return parsed.geturl()

    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as error:
        raise ValueError(f"The media host could not be resolved: {hostname}") from error

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("Private, loopback, and reserved media addresses are not accepted.")
    return parsed.geturl()


def clean_headers(raw_headers: dict | None) -> dict[str, str]:
    allowed = {
        "accept",
        "accept-language",
        "origin",
        "referer",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "user-agent",
    }
    headers: dict[str, str] = {}
    for raw_name, raw_value in (raw_headers or {}).items():
        name = str(raw_name).strip().casefold()
        value = str(raw_value).replace("\r", "").replace("\n", "").strip()
        if name in allowed and value:
            headers[name] = value[:1024]
    return headers


class PublicCaptionRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_public_http_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def select_youtube_caption_track(info: dict, requested_language: str) -> dict | None:
    target = normalize_language(requested_language)
    for kind, field in (("manual", "subtitles"), ("automatic", "automatic_captions")):
        ranked: list[tuple[int, str, dict]] = []
        for language, formats in (info.get(field) or {}).items():
            score = caption_language_score(language, target, automatic=kind == "automatic")
            if score is None:
                continue
            json_format = next(
                (
                    item for item in (formats or [])
                    if str(item.get("ext") or "").casefold() == "json3" and item.get("url")
                ),
                None,
            )
            if json_format:
                ranked.append((score, str(language), json_format))
        if ranked:
            _, language, selected = min(ranked, key=lambda item: (item[0], item[1]))
            return {
                "kind": kind,
                "language": language,
                "name": selected.get("name"),
                "url": selected.get("url"),
            }
    return None


def normalize_language(value: str) -> str:
    return str(value or "").strip().replace("_", "-").casefold()


def caption_language_score(language: str, target: str, *, automatic: bool) -> int | None:
    candidate = normalize_language(language)
    if not candidate or not target:
        return None
    target_base = target.split("-", 1)[0]
    candidate_without_original = candidate.removesuffix("-orig")
    candidate_base = candidate_without_original.split("-", 1)[0]
    if automatic and candidate == f"{target}-orig":
        return 0
    if candidate == target:
        return 1 if automatic else 0
    if not automatic and candidate == f"{target}-orig":
        return 1
    if candidate_without_original == target:
        return 2
    if candidate_base == target_base:
        return 3
    return None


def download_youtube_answer_key(info: dict, requested_language: str) -> CaptionAnswerKey | None:
    track = select_youtube_caption_track(info, requested_language)
    if not track:
        return None
    caption_url = validate_public_http_url(track["url"])
    source_headers = clean_headers(info.get("http_headers"))
    request_headers = {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
    }
    for name, value in source_headers.items():
        request_headers["-".join(part.capitalize() for part in name.split("-"))] = value
    request = Request(caption_url, headers=request_headers, method="GET")
    opener = build_opener(PublicCaptionRedirectHandler())
    with opener.open(request, timeout=20) as response:
        content_length = number_or_none(response.headers.get("Content-Length"))
        if content_length and content_length > MAX_CAPTION_BYTES:
            raise RuntimeError("The YouTube caption track is unexpectedly large.")
        payload = response.read(MAX_CAPTION_BYTES + 1)
    if len(payload) > MAX_CAPTION_BYTES:
        raise RuntimeError("The YouTube caption track exceeded the local safety limit.")
    parsed = json.loads(payload.decode("utf-8-sig"))
    segments = parse_youtube_json3(parsed, track["language"], track["kind"])
    if not segments:
        return None
    return CaptionAnswerKey(
        language=track["language"],
        kind=track["kind"],
        name=track.get("name"),
        segments=segments,
    )


def parse_youtube_json3(payload: dict, language: str, kind: str) -> list[dict]:
    parsed: list[dict] = []
    for event in payload.get("events") or []:
        raw_segments = event.get("segs") or []
        text = "".join(str(segment.get("utf8") or "") for segment in raw_segments)
        text = re.sub(r"\s+", " ", text.replace("\u200b", " ")).strip()
        try:
            start = max(0.0, float(event.get("tStartMs")) / 1000)
        except (TypeError, ValueError):
            continue
        if not text:
            continue
        try:
            duration = max(0.0, float(event.get("dDurationMs")) / 1000)
        except (TypeError, ValueError):
            duration = 0.0
        event_end = start + duration
        timed_words: list[dict] = []
        for raw_index, raw_segment in enumerate(raw_segments):
            raw_text = str(raw_segment.get("utf8") or "")
            try:
                raw_offset = max(0.0, float(raw_segment.get("tOffsetMs") or 0) / 1000)
            except (TypeError, ValueError):
                raw_offset = 0.0
            raw_start = start + raw_offset
            next_offset = None
            if raw_index + 1 < len(raw_segments):
                try:
                    next_offset = max(
                        raw_offset,
                        float(raw_segments[raw_index + 1].get("tOffsetMs")) / 1000,
                    )
                except (TypeError, ValueError):
                    next_offset = None
            raw_end = start + next_offset if next_offset is not None else event_end
            timed_words.extend(distribute_timed_words(raw_text, raw_start, raw_end))
        parsed.append({
            "start": start,
            "end": start + duration,
            "text": text,
            "words": timed_words,
        })

    parsed.sort(key=lambda segment: (segment["start"], segment["end"]))
    result: list[dict] = []
    for index, segment in enumerate(parsed):
        end = segment["end"]
        if end <= segment["start"]:
            next_start = parsed[index + 1]["start"] if index + 1 < len(parsed) else segment["start"] + 2
            end = max(segment["start"], next_start)
        result.append({
            "id": f"youtube-caption:{kind}:{index}",
            "start": round(segment["start"], 3),
            "end": round(end, 3),
            "text": segment["text"],
            "words": segment["words"],
            "source": f"youtube-{kind}-caption",
            "language": language,
            "trackKind": kind,
        })
    return result


def resolve_sources(request: dict) -> list[ResolvedSource]:
    source_kind = str(request.get("sourceKind") or "")
    if source_kind not in ALLOWED_SOURCE_KINDS:
        raise ValueError("Unsupported batch source type.")

    if source_kind == "browser-pcm":
        sample_rate = positive_int_or_none(request.get("sampleRate"))
        channels = positive_int_or_none(request.get("channels"))
        if sample_rate != 16_000 or channels != 1:
            raise ValueError("Browser-decoded PCM must be mono 16 kHz audio.")
        pcm_path = validate_browser_pcm_path(
            request.get("pcmPath"),
            str(request.get("jobId") or ""),
        )
        file_size = os.path.getsize(pcm_path)
        declared_size = positive_int_or_none(request.get("pcmBytes"))
        if declared_size and declared_size != file_size:
            raise ValueError("Browser-decoded PCM size did not match the completed transfer.")
        return [ResolvedSource(
            url="",
            headers={},
            duration=number_or_none(request.get("durationHint")),
            answer_key_status="not-requested",
            media_kind="browser-decoded-xhe-aac",
            codec_hint="pcm-s16le",
            profile_hint="Chrome/Windows platform decoder",
            channels=1,
            local_pcm_path=pcm_path,
        )]

    if source_kind == "direct":
        raw_candidates = request.get("sourceCandidates") or [request.get("sourceUrl")]
        if not isinstance(raw_candidates, list):
            raise ValueError("Direct media candidates must be a list.")
        headers = clean_headers(request.get("headers"))
        duration = number_or_none(request.get("durationHint"))
        answer_key_status = (
            "unsupported-for-direct-media"
            if request.get("collectCaptions")
            else "not-requested"
        )
        loopback_media_origin = request.get("loopbackMediaOrigin")
        result: list[ResolvedSource] = []
        seen: set[str] = set()
        for raw_candidate in raw_candidates[:MAX_DIRECT_CANDIDATES]:
            if isinstance(raw_candidate, dict):
                raw_url = raw_candidate.get("url")
                candidate_headers = {
                    **headers,
                    **clean_headers(raw_candidate.get("headers")),
                }
                media_kind = re.sub(
                    r"[^a-z-]",
                    "",
                    str(raw_candidate.get("kind") or "").casefold(),
                )[:32] or None
                discovery_source = safe_diagnostic_hint(raw_candidate.get("source"), 64)
                language_hint = safe_diagnostic_hint(raw_candidate.get("language"), 32)
                codec_hint = safe_diagnostic_hint(raw_candidate.get("codec"), 64)
                profile_hint = safe_diagnostic_hint(raw_candidate.get("profile"), 96)
                bitrate = positive_int_or_none(raw_candidate.get("bitrate"))
                channels = positive_int_or_none(raw_candidate.get("channels"))
                representation_index = nonnegative_int_or_none(
                    raw_candidate.get("representationIndex")
                )
            else:
                raw_url = raw_candidate
                candidate_headers = headers
                media_kind = None
                discovery_source = None
                language_hint = None
                codec_hint = None
                profile_hint = None
                bitrate = None
                channels = None
                representation_index = None
            url = validate_public_http_url(
                raw_url,
                allowed_loopback_origin=loopback_media_origin,
            )
            if url in seen:
                continue
            seen.add(url)
            result.append(ResolvedSource(
                url=url,
                headers=candidate_headers,
                duration=duration,
                answer_key_status=answer_key_status,
                media_kind=media_kind,
                discovery_source=discovery_source,
                language_hint=language_hint,
                codec_hint=codec_hint,
                profile_hint=profile_hint,
                bitrate=bitrate,
                channels=channels,
                representation_index=representation_index,
            ))
        if not result:
            raise ValueError("No valid direct HTTP media candidates were supplied.")
        return result

    page_url = validate_public_http_url(request.get("sourceUrl"), youtube_only=True)
    try:
        import yt_dlp
    except ImportError as error:
        raise RuntimeError("The YouTube batch adapter needs yt-dlp. Run server/setup.cmd again.") from error

    options = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(page_url, download=False)
    answer_key = None
    answer_key_status = "not-requested"
    if request.get("collectCaptions"):
        try:
            answer_key = download_youtube_answer_key(
                info,
                str(request.get("captionLanguage") or request.get("language") or "de")[:32],
            )
            answer_key_status = "available" if answer_key else "no-matching-caption-track"
        except Exception as error:
            answer_key_status = f"caption-retrieval-failed: {error}"
    source_url = validate_public_http_url(info.get("url"))
    return [ResolvedSource(
        url=source_url,
        headers=clean_headers(info.get("http_headers")),
        title=info.get("title"),
        duration=number_or_none(info.get("duration")),
        answer_key=answer_key,
        answer_key_status=answer_key_status,
        youtube_page_url=page_url,
        media_extension=re.sub(r"[^a-z0-9]", "", str(info.get("ext") or "").casefold())[:8] or None,
        media_kind="youtube-audio",
    )]


def resolve_source(request: dict) -> ResolvedSource:
    """Return the first source for compatibility with focused unit tests."""
    return resolve_sources(request)[0]


def number_or_none(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def positive_int_or_none(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number > 0 else None


def nonnegative_int_or_none(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number >= 0 else None


def safe_diagnostic_hint(value, limit: int) -> str | None:
    text = re.sub(r"[^a-zA-Z0-9._+ /:@-]", "", str(value or "")).strip()
    return text[:limit] or None


def validate_browser_pcm_path(value, job_id: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", job_id):
        raise ValueError("The browser PCM job ID is invalid.")
    temp_root = os.path.realpath(os.path.join(PROJECT_ROOT, ".runtime", "batch-temp"))
    expected = os.path.realpath(os.path.join(temp_root, f"browser-pcm-{job_id}.s16le"))
    candidate = os.path.realpath(str(value or ""))
    if candidate != expected or os.path.commonpath([temp_root, candidate]) != temp_root:
        raise ValueError("The browser PCM file was outside the local batch directory.")
    if not os.path.isfile(candidate):
        raise ValueError("The browser PCM file was not found.")
    size = os.path.getsize(candidate)
    if size <= 0 or size > MAX_AUDIO_BYTES:
        raise ValueError("The browser PCM file had an invalid size.")
    return candidate


def ffmpeg_http_options(headers: dict[str, str]) -> dict[str, str]:
    protocol_headers = {
        name: value
        for name, value in headers.items()
        if name not in {"user-agent", "referer"}
    }
    options = {
        "rw_timeout": "30000000",
        "reconnect": "1",
        "reconnect_streamed": "1",
        "reconnect_delay_max": "5",
    }
    if protocol_headers:
        options["headers"] = "".join(
            f"{name}: {value}\r\n"
            for name, value in protocol_headers.items()
        )
    if headers.get("user-agent"):
        options["user_agent"] = headers["user-agent"]
    if headers.get("referer"):
        options["referer"] = headers["referer"]
    return options


def decode_source(
    source: ResolvedSource,
    job_id: str,
    language: str = "",
    attempt: int | None = None,
    candidate_count: int | None = None,
):
    if source.local_pcm_path:
        import numpy as np

        path = source.local_pcm_path
        try:
            audio = np.fromfile(path, dtype="<i2")
        finally:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
        if not audio.size:
            raise RuntimeError("Chrome produced no decoded PCM audio samples.")
        emit(
            "batch_candidate_probe",
            job_id,
            attempt=attempt,
            candidateCount=candidate_count,
            sourceHost=None,
            sourceKind=source.media_kind,
            language=language,
            containerFormat="raw-s16le",
            codec="pcm_s16le",
            codecLongName="Chrome/Windows platform-decoded PCM",
            profile="mono-16-khz",
            sampleRate=16_000,
            channels=1,
            layout="mono",
        )
        return audio.astype(np.float32) / 32768.0

    if source.youtube_page_url:
        try:
            return download_and_decode_youtube(source, job_id)
        except Exception as error:
            emit(
                "batch_status",
                job_id,
                message=(
                    "Temporary audio download was unavailable; retrying with the original direct decoder "
                    f"({str(error)[:240]})."
                ),
            )
        try:
            return decode_audio(source.url, sampling_rate=16_000)
        except Exception as error:
            emit(
                "batch_status",
                job_id,
                message=(
                    "The original direct decoder was unavailable; streaming with explicit media headers "
                    f"({str(error)[:240]})."
                ),
            )

    # PyAV accepts a file-like object but faster-whisper's public helper does
    # not expose protocol header options. For header-bearing sources, use
    # PyAV's HTTP header option through a tiny local wrapper.
    import av
    import numpy as np

    options = ffmpeg_http_options(source.headers)
    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16_000)
    chunks: list = []
    decoded_sample_count = 0
    last_reported_percent = -5
    last_reported_seconds = -30.0
    last_reported_at = 0.0
    with av.open(source.url, mode="r", options=options, metadata_errors="ignore") as container:
        if not container.streams.audio:
            raise RuntimeError("The selected media source has no audio stream.")
        audio_stream = select_audio_stream(container.streams.audio, language)
        stream_language = audio_stream_language(audio_stream)
        probe = audio_stream_probe(container, audio_stream)
        emit(
            "batch_candidate_probe",
            job_id,
            attempt=attempt,
            candidateCount=candidate_count,
            sourceHost=urlsplit(source.url).hostname,
            sourceKind=source.media_kind,
            language=stream_language or source.language_hint,
            **probe,
        )
        if len(container.streams.audio) > 1:
            emit(
                "batch_status",
                job_id,
                message=(
                    f"Selected audio track {audio_stream.index + 1} of {len(container.streams.audio)}"
                    + (f" ({stream_language})" if stream_language else "")
                    + "."
                ),
            )
        try:
            for frame in container.decode(audio_stream):
                converted = resampler.resample(frame)
                if converted is None:
                    continue
                converted_frames = converted if isinstance(converted, list) else [converted]
                for converted_frame in converted_frames:
                    samples = converted_frame.to_ndarray().reshape(-1)
                    chunks.append(samples)
                    decoded_sample_count += samples.size
                decoded_seconds = (
                    float(frame.time)
                    if frame.time is not None
                    else decoded_sample_count / 16_000
                )
                now = time.monotonic()
                if source.duration:
                    percent = min(99, int(max(0.0, decoded_seconds) / source.duration * 100))
                    should_report = percent >= last_reported_percent + 5
                else:
                    percent = None
                    should_report = decoded_seconds >= last_reported_seconds + 30
                if should_report and now - last_reported_at >= 0.5:
                    emit(
                        "batch_decode_progress",
                        job_id,
                        percent=percent,
                        decodedSeconds=round(decoded_seconds, 3),
                        duration=round(source.duration, 3) if source.duration else None,
                        attempt=attempt,
                    )
                    if percent is not None:
                        last_reported_percent = percent
                    last_reported_seconds = decoded_seconds
                    last_reported_at = now
        except Exception as error:
            if is_ffmpeg_unimplemented_error(error):
                codec = probe.get("codec") or "unknown audio"
                profile = probe.get("profile")
                description = f"{codec}/{profile}" if profile else codec
                raise RuntimeError(
                    f"Local FFmpeg opened the audio as {description}, but cannot decode a feature "
                    "used by this representation. Netflix xHE-AAC with eSBR is a common cause; "
                    "a Chrome/Windows decoder fallback is required."
                ) from error
            raise
        flushed = resampler.resample(None)
        flushed_frames = flushed if isinstance(flushed, list) else ([flushed] if flushed else [])
        for converted_frame in flushed_frames:
            chunks.append(converted_frame.to_ndarray().reshape(-1))

    if not chunks:
        raise RuntimeError("No audio samples could be decoded from the selected source.")
    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
    return audio


def decode_png_wrapped_hls(
    source: ResolvedSource,
    inspection: HlsPngTsInspection,
    job_id: str,
    language: str = "",
    attempt: int | None = None,
    candidate_count: int | None = None,
):
    import av
    import numpy as np

    segments = inspection.segments
    if not segments:
        raise RuntimeError("The PNG-wrapped HLS playlist contains no media segments.")
    emit(
        "batch_candidate_wrapper",
        job_id,
        attempt=attempt,
        candidateCount=candidate_count,
        sourceHost=urlsplit(source.url).hostname,
        sourceKind=source.media_kind,
        wrapperKind=inspection.wrapper_kind,
        segmentCount=len(segments),
    )
    emit(
        "batch_status",
        job_id,
        message=(
            "The player uses PNG-wrapped clear HLS segments. "
            "Unwrapping and decoding them locally; nothing is uploaded."
        ),
    )

    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16_000)
    chunks: list = []
    decoded_sample_count = 0
    downloaded_bytes = inspection.first_payload_bytes
    if downloaded_bytes > MAX_AUDIO_BYTES:
        raise RuntimeError(
            "The PNG-wrapped HLS media exceeded the local streaming safety limit."
        )
    last_reported_percent = -5
    probe_emitted = False

    for segment_index, (segment_url, _declared_duration) in enumerate(segments):
        if segment_index == 0:
            transport_stream = inspection.first_transport_stream
        else:
            payload, _content_type = read_media_payload(segment_url, source.headers)
            downloaded_bytes += len(payload)
            if downloaded_bytes > MAX_AUDIO_BYTES:
                raise RuntimeError(
                    "The PNG-wrapped HLS media exceeded the local streaming safety limit."
                )
            transport_stream = unwrap_png_appended_mpegts(payload)
            if transport_stream is None:
                raise RuntimeError(
                    f"PNG-wrapped HLS segment {segment_index + 1} did not contain "
                    "the expected appended MPEG-TS payload."
                )

        try:
            with av.open(
                io.BytesIO(transport_stream),
                mode="r",
                format="mpegts",
                metadata_errors="ignore",
                buffer_size=min(max(len(transport_stream), 32_768), 1024 * 1024),
            ) as container:
                if not container.streams.audio:
                    raise RuntimeError(
                        f"PNG-wrapped HLS segment {segment_index + 1} contains no audio stream."
                    )
                audio_stream = select_audio_stream(container.streams.audio, language)
                if not probe_emitted:
                    stream_language = audio_stream_language(audio_stream)
                    probe = audio_stream_probe(container, audio_stream)
                    probe["containerFormat"] = "png-envelope/mpegts"
                    emit(
                        "batch_candidate_probe",
                        job_id,
                        attempt=attempt,
                        candidateCount=candidate_count,
                        sourceHost=urlsplit(source.url).hostname,
                        sourceKind="hls-png-ts",
                        language=stream_language or source.language_hint or language,
                        **probe,
                    )
                    probe_emitted = True
                for frame in container.decode(audio_stream):
                    # HLS segment containers can restart timestamps. Segment
                    # order is the source of truth for this streaming decode.
                    frame.pts = None
                    converted_frames = resampler.resample(frame)
                    if converted_frames is None:
                        continue
                    if not isinstance(converted_frames, list):
                        converted_frames = [converted_frames]
                    for converted_frame in converted_frames:
                        samples = converted_frame.to_ndarray().reshape(-1)
                        chunks.append(samples)
                        decoded_sample_count += samples.size
        except Exception as error:
            raise RuntimeError(
                f"PNG-wrapped HLS segment {segment_index + 1} could not be decoded: "
                f"{str(error)[:240]}"
            ) from error

        percent = min(99, int((segment_index + 1) / len(segments) * 100))
        if percent >= last_reported_percent + 5 or segment_index + 1 == len(segments):
            emit(
                "batch_decode_progress",
                job_id,
                percent=percent,
                decodedSeconds=round(decoded_sample_count / 16_000, 3),
                duration=round(source.duration, 3) if source.duration else None,
                downloadedBytes=downloaded_bytes,
                attempt=attempt,
            )
            last_reported_percent = percent

    flushed_frames = resampler.resample(None)
    if flushed_frames is None:
        flushed_frames = []
    elif not isinstance(flushed_frames, list):
        flushed_frames = [flushed_frames]
    for converted_frame in flushed_frames:
        samples = converted_frame.to_ndarray().reshape(-1)
        chunks.append(samples)

    if not chunks:
        raise RuntimeError("No audio samples were decoded from the PNG-wrapped HLS source.")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def audio_stream_probe(container, stream) -> dict:
    codec_context = getattr(stream, "codec_context", None)
    codec = getattr(codec_context, "codec", None)
    profile = getattr(stream, "profile", None) or getattr(codec_context, "profile", None)
    layout = getattr(codec_context, "layout", None)
    layout_name = getattr(layout, "name", None) or (str(layout) if layout else None)
    container_format = getattr(getattr(container, "format", None), "name", None)
    return {
        "containerFormat": safe_diagnostic_hint(container_format, 64),
        "codec": safe_diagnostic_hint(getattr(codec_context, "name", None), 64),
        "codecLongName": safe_diagnostic_hint(getattr(codec, "long_name", None), 96),
        "profile": safe_diagnostic_hint(profile, 96),
        "sampleRate": positive_int_or_none(getattr(codec_context, "sample_rate", None)),
        "channels": positive_int_or_none(getattr(codec_context, "channels", None)),
        "layout": safe_diagnostic_hint(layout_name, 64),
    }


def is_ffmpeg_unimplemented_error(error: Exception) -> bool:
    text = str(error).casefold()
    return "not yet implemented in ffmpeg" in text or "patches welcome" in text


def is_ffmpeg_invalid_data_error(error: Exception) -> bool:
    text = str(error).casefold()
    return (
        "invalid data found when processing input" in text
        or "invaliddataerror" in text
    )


def normalize_media_language(value: str | None) -> str:
    language = re.sub(r"[^a-z]", "", str(value or "").casefold())
    aliases = {
        "deu": "de",
        "ger": "de",
        "german": "de",
        "eng": "en",
        "english": "en",
        "jpn": "ja",
        "japanese": "ja",
        "fra": "fr",
        "fre": "fr",
        "french": "fr",
    }
    return aliases.get(language, language[:2] if len(language) >= 2 else language)


def audio_stream_language(stream) -> str:
    metadata = getattr(stream, "metadata", None) or {}
    for key in ("language", "LANGUAGE", "lang", "title", "name"):
        value = metadata.get(key)
        if value:
            return str(value).strip()[:64]
    return ""


def select_audio_stream(streams, requested_language: str):
    available = list(streams)
    if not available:
        raise RuntimeError("The selected media source has no audio stream.")
    requested = normalize_media_language(requested_language)

    def score(stream) -> tuple[int, int]:
        metadata = getattr(stream, "metadata", None) or {}
        values = [str(value) for value in metadata.values() if value]
        normalized = [normalize_media_language(value) for value in values]
        language_score = 0
        if requested and requested in normalized:
            language_score = 100
        elif requested and any(requested in value.casefold() for value in values):
            language_score = 80
        disposition = getattr(stream, "disposition", None)
        default_score = 10 if bool(getattr(disposition, "default", False)) else 0
        index = int(getattr(stream, "index", 0) or 0)
        return language_score + default_score, -index

    return max(available, key=score)


def playlist_request(url: str, headers: dict[str, str]) -> Request:
    request_headers = {
        "Accept": "application/vnd.apple.mpegurl, application/dash+xml, text/plain, */*",
        "Accept-Encoding": "identity",
        **{
            "-".join(part.capitalize() for part in name.split("-")): value
            for name, value in headers.items()
        },
    }
    return Request(url, headers=request_headers, method="GET")


def read_playlist_text(url: str, headers: dict[str, str]) -> str:
    opener = build_opener(PublicCaptionRedirectHandler())
    with opener.open(playlist_request(url, headers), timeout=20) as response:
        content_length = number_or_none(response.headers.get("Content-Length"))
        if content_length and content_length > MAX_PLAYLIST_BYTES:
            raise RuntimeError("The media playlist is unexpectedly large.")
        payload = response.read(MAX_PLAYLIST_BYTES + 1)
    if len(payload) > MAX_PLAYLIST_BYTES:
        raise RuntimeError("The media playlist exceeded the local safety limit.")
    return payload.decode("utf-8-sig", errors="replace")


def media_payload_request(url: str, headers: dict[str, str]) -> Request:
    request_headers = {
        "Accept": "video/mp2t, image/png, application/octet-stream, */*",
        "Accept-Encoding": "identity",
        **{
            "-".join(part.capitalize() for part in name.split("-")): value
            for name, value in headers.items()
        },
    }
    return Request(url, headers=request_headers, method="GET")


def read_media_payload(
    url: str,
    headers: dict[str, str],
    limit: int = MAX_HLS_SEGMENT_BYTES,
) -> tuple[bytes, str]:
    validate_public_http_url(url)
    opener = build_opener(PublicCaptionRedirectHandler())
    with opener.open(media_payload_request(url, headers), timeout=30) as response:
        content_length = number_or_none(response.headers.get("Content-Length"))
        if content_length and content_length > limit:
            raise RuntimeError("An HLS media segment exceeded the local safety limit.")
        content_type = str(response.headers.get("Content-Type") or "")
        payload = response.read(limit + 1)
    if len(payload) > limit:
        raise RuntimeError("An HLS media segment exceeded the local safety limit.")
    return payload, content_type.split(";", 1)[0].strip().casefold()


def hls_child_playlists(text: str, base_url: str) -> list[str]:
    children: list[str] = []
    expect_variant = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#EXT-X-STREAM-INF"):
            expect_variant = True
        for match in re.finditer(r'URI=(?:"([^"]+)"|([^,\s]+))', line, flags=re.IGNORECASE):
            child = match.group(1) or match.group(2)
            if child and (".m3u8" in child.casefold() or line.startswith("#EXT-X-MEDIA")):
                children.append(urljoin(base_url, child))
        if expect_variant and not line.startswith("#"):
            children.append(urljoin(base_url, line))
            expect_variant = False
    result: list[str] = []
    for child in children:
        if child not in result:
            result.append(child)
    return result[:12]


def hls_media_segments(text: str, base_url: str) -> list[tuple[str, float | None]]:
    segments: list[tuple[str, float | None]] = []
    pending_duration: float | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.casefold().startswith("#extinf:"):
            duration_text = line.split(":", 1)[1].split(",", 1)[0].strip()
            try:
                pending_duration = max(0.0, float(duration_text))
            except (TypeError, ValueError, OverflowError):
                pending_duration = None
            continue
        if line.startswith("#"):
            continue
        segments.append((urljoin(base_url, line), pending_duration))
        pending_duration = None
        if len(segments) > MAX_HLS_SEGMENTS:
            raise RuntimeError("The HLS playlist contains too many media segments.")
    return segments


def mpegts_sync_offset(payload: bytes) -> int | None:
    packet_size = 188
    if len(payload) < packet_size * 3:
        return None
    max_offset = min(packet_size, len(payload) - packet_size * 3 + 1)
    for offset in range(max_offset):
        if all(payload[offset + index * packet_size] == 0x47 for index in range(3)):
            return offset
    return None


def unwrap_png_appended_mpegts(payload: bytes) -> bytes | None:
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    offset = 8
    while offset + 12 <= len(payload):
        chunk_length = int.from_bytes(payload[offset:offset + 4], "big")
        chunk_end = offset + 12 + chunk_length
        if chunk_end > len(payload):
            return None
        chunk_type = payload[offset + 4:offset + 8]
        if chunk_type == b"IEND":
            transport_stream = payload[chunk_end:]
            sync_offset = mpegts_sync_offset(transport_stream)
            return (
                transport_stream[sync_offset:]
                if sync_offset is not None
                else None
            )
        offset = chunk_end
    return None


def inspect_png_wrapped_hls(source: ResolvedSource) -> HlsPngTsInspection | None:
    text = read_playlist_text(source.url, source.headers)
    require_hls_playlist(text)
    lowered = text.casefold()
    if "#ext-x-stream-inf" in lowered:
        return None
    if "#ext-x-playlist-type:vod" not in lowered and "#ext-x-endlist" not in lowered:
        return None
    if hls_encryption_reason(text):
        return None
    segments = hls_media_segments(text, source.url)
    if not segments:
        return None
    first_url, _duration = segments[0]
    payload, content_type = read_media_payload(first_url, source.headers)
    if content_type and content_type != "image/png" and not payload.startswith(b"\x89PNG"):
        return None
    transport_stream = unwrap_png_appended_mpegts(payload)
    if transport_stream is None:
        return None
    return HlsPngTsInspection(
        segments=segments,
        first_transport_stream=transport_stream,
        first_payload_bytes=len(payload),
        wrapper_kind="png-appended-mpegts",
    )


def hls_audio_playlists(text: str, base_url: str, requested_language: str) -> list[str]:
    requested = normalize_media_language(requested_language)
    audio_entries: list[tuple[int, int, str]] = []
    for index, line in enumerate(text.splitlines()):
        if not line.strip().casefold().startswith("#ext-x-media:") or "type=audio" not in line.casefold():
            continue
        attributes = {
            key.casefold(): (quoted or plain or "")
            for key, quoted, plain in re.findall(r'([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))', line, re.IGNORECASE)
        }
        uri = attributes.get("uri")
        if not uri:
            continue
        labels = [attributes.get("language", ""), attributes.get("name", "")]
        normalized = [normalize_media_language(label) for label in labels if label]
        score = 100 if requested and requested in normalized else 0
        if requested and any(requested in label.casefold() for label in labels):
            score = max(score, 80)
        if attributes.get("default", "").casefold() == "yes":
            score += 10
        audio_entries.append((score, index, urljoin(base_url, uri)))
    ordered: list[str] = []
    for _score, _index, url in sorted(
        audio_entries,
        key=lambda entry: (-entry[0], entry[1]),
    ):
        if url not in ordered:
            ordered.append(url)
    return ordered[:12]


def hls_audio_languages(text: str) -> list[str]:
    languages: list[str] = []
    for line in text.splitlines():
        if not line.strip().casefold().startswith("#ext-x-media:") or "type=audio" not in line.casefold():
            continue
        attributes = {
            key.casefold(): (quoted or plain or "")
            for key, quoted, plain in re.findall(
                r'([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))',
                line,
                re.IGNORECASE,
            )
        }
        language = normalize_media_language(attributes.get("language"))
        if language and language not in languages:
            languages.append(language)
    return languages


def hls_relevant_playlists(text: str, base_url: str, requested_language: str) -> list[str]:
    audio_playlists = hls_audio_playlists(text, base_url, requested_language)
    if audio_playlists:
        return audio_playlists[:1]
    return hls_child_playlists(text, base_url)[:1]


def require_hls_playlist(text: str) -> None:
    normalized = str(text or "").lstrip("\ufeff \t\r\n").casefold()
    if not normalized.startswith("#extm3u"):
        raise RuntimeError(
            "The detected HLS endpoint did not return an HLS playlist. "
            "It may be an expired source or an access-control response."
        )


def hls_encryption_reason(text: str, *, child: bool = False) -> str | None:
    lowered = text.casefold()
    if not re.search(
        r"#ext-x-(?:session-)?key:[^\r\n]*method=(?!none(?:[,\s]|$))",
        lowered,
    ):
        return None
    return (
        "a selected HLS media playlist declares encrypted media keys"
        if child
        else "the HLS playlist declares encrypted media keys"
    )


def resolve_hls_audio_source(
    source: ResolvedSource,
    requested_language: str,
    job_id: str | None = None,
    attempt: int | None = None,
    candidate_count: int | None = None,
) -> ResolvedSource:
    kind = str(source.media_kind or "").casefold()
    if kind not in {"hls", "hls-audio"} and ".m3u8" not in source.url.casefold():
        return source

    text = read_playlist_text(source.url, source.headers)
    require_hls_playlist(text)
    root_protection = hls_encryption_reason(text)
    if root_protection:
        raise RuntimeError(
            f"Protected media is not eligible for full-audio acquisition: {root_protection}."
        )
    audio_playlists = hls_audio_playlists(text, source.url, requested_language)
    available_languages = hls_audio_languages(text)
    requested = normalize_media_language(requested_language)
    variant_count = sum(
        1
        for line in text.splitlines()
        if line.strip().casefold().startswith("#ext-x-stream-inf")
    )
    media_segment_count = (
        0
        if variant_count or audio_playlists
        else sum(
            1
            for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        )
    )
    selected = source
    selected_child_host = None
    if requested and available_languages and requested not in available_languages:
        if job_id:
            emit(
                "batch_candidate_playlist",
                job_id,
                attempt=attempt,
                candidateCount=candidate_count,
                sourceHost=urlsplit(source.url).hostname,
                sourceKind=source.media_kind,
                playlistType="master",
                audioRenditionCount=len(audio_playlists),
                availableAudioLanguages=available_languages,
                variantCount=variant_count,
                mediaSegmentCount=0,
                selectedAudioRendition=False,
                selectedChildHost=None,
            )
        raise RuntimeError(
            f"No HLS audio rendition matched requested language {requested}. "
            f"Available languages: {', '.join(available_languages)}."
        )
    if audio_playlists:
        selected_url = validate_public_http_url(audio_playlists[0])
        selected_text = read_playlist_text(selected_url, source.headers)
        require_hls_playlist(selected_text)
        child_protection = hls_encryption_reason(selected_text, child=True)
        if child_protection:
            raise RuntimeError(
                f"Protected media is not eligible for full-audio acquisition: {child_protection}."
            )
        selected = replace(source, url=selected_url, media_kind="hls-audio")
        selected_child_host = urlsplit(selected_url).hostname

    if job_id:
        emit(
            "batch_candidate_playlist",
            job_id,
            attempt=attempt,
            candidateCount=candidate_count,
            sourceHost=urlsplit(source.url).hostname,
            sourceKind=source.media_kind,
            playlistType=(
                "master"
                if variant_count or audio_playlists
                else "media"
            ),
            audioRenditionCount=len(audio_playlists),
            availableAudioLanguages=available_languages,
            variantCount=variant_count,
            mediaSegmentCount=media_segment_count,
            selectedAudioRendition=bool(audio_playlists),
            selectedChildHost=selected_child_host,
        )
    return selected


def playlist_protection_reason(source: ResolvedSource, requested_language: str = "") -> str | None:
    lowered_url = source.url.casefold()
    kind = str(source.media_kind or "").casefold()
    is_hls = kind == "hls" or ".m3u8" in lowered_url
    is_dash = kind == "dash" or ".mpd" in lowered_url
    if not is_hls and not is_dash:
        return None

    text = read_playlist_text(source.url, source.headers)
    lowered = text.casefold()
    if is_dash:
        if "<contentprotection" in lowered or any(
            marker in lowered for marker in ("widevine", "playready", "fairplay", "urn:mpeg:dash:mp4protection")
        ):
            return "the DASH manifest declares DRM ContentProtection"
        return None

    require_hls_playlist(text)
    protection = hls_encryption_reason(text)
    if protection:
        return protection
    if "#ext-x-stream-inf" not in lowered and "#ext-x-media" not in lowered:
        return None
    for child_url in hls_relevant_playlists(text, source.url, requested_language):
        validate_public_http_url(child_url)
        child_text = read_playlist_text(child_url, source.headers)
        require_hls_playlist(child_text)
        protection = hls_encryption_reason(child_text, child=True)
        if protection:
            return protection
    return None


def acquire_first_accessible_source(
    sources: list[ResolvedSource],
    job_id: str,
    language: str,
) -> tuple[ResolvedSource, object]:
    failures: list[str] = []
    for index, source in enumerate(sources, start=1):
        source_host = urlsplit(source.url).hostname
        emit(
            "batch_candidate_attempt",
            job_id,
            attempt=index,
            candidateCount=len(sources),
            sourceHost=source_host,
            sourceKind=source.media_kind,
            discoverySource=source.discovery_source,
            languageHint=source.language_hint,
            codecHint=source.codec_hint,
            profileHint=source.profile_hint,
            bitrate=source.bitrate,
            channels=source.channels,
            representationIndex=source.representation_index,
        )
        emit(
            "batch_status",
            job_id,
            message=f"Checking media source {index} of {len(sources)} ({source.media_kind or 'direct'}).",
        )
        try:
            is_hls = (
                str(source.media_kind or "").casefold() in {"hls", "hls-audio"}
                or ".m3u8" in source.url.casefold()
            )
            if is_hls:
                decode_source_candidate = resolve_hls_audio_source(
                    source,
                    language,
                    job_id,
                    index,
                    len(sources),
                )
            else:
                protection = playlist_protection_reason(source, language)
                if protection:
                    raise RuntimeError(
                        "Protected media is not eligible for full-audio acquisition: "
                        f"{protection}."
                    )
                decode_source_candidate = source
            try:
                audio = decode_source(
                    decode_source_candidate,
                    job_id,
                    language,
                    index,
                    len(sources),
                )
            except Exception as decode_error:
                if not is_hls or not is_ffmpeg_invalid_data_error(decode_error):
                    raise
                png_inspection = inspect_png_wrapped_hls(decode_source_candidate)
                if png_inspection is None:
                    raise
                audio = decode_png_wrapped_hls(
                    decode_source_candidate,
                    png_inspection,
                    job_id,
                    language,
                    index,
                    len(sources),
                )
            decoded_duration = len(audio) / 16_000
            if decode_source_candidate.duration and decode_source_candidate.duration >= 60:
                ratio = decoded_duration / decode_source_candidate.duration
                if ratio < 0.70 or ratio > 1.30:
                    raise RuntimeError(
                        "decoded duration does not match the active video "
                        f"({decoded_duration:.1f}s versus {decode_source_candidate.duration:.1f}s)"
                    )
            return decode_source_candidate, audio
        except Exception as error:
            failure_message = str(error)[:500]
            failures.append(f"candidate {index}: {failure_message[:220]}")
            emit(
                "batch_candidate_failed",
                job_id,
                attempt=index,
                candidateCount=len(sources),
                sourceHost=source_host,
                sourceKind=source.media_kind,
                category=media_failure_category(error),
                message=failure_message,
            )
            emit(
                "batch_status",
                job_id,
                message=f"Media source {index} was unsuitable; trying the next candidate.",
            )
    detail = "; ".join(failures[:3])
    raise RuntimeError(
        "None of the detected media sources provided accessible, matching clear audio."
        + (f" {detail}" if detail else "")
    )


def media_failure_category(error: Exception) -> str:
    text = str(error).casefold()
    if "png-wrapped hls segment" in text:
        return "segment-wrapper-error"
    if is_ffmpeg_unimplemented_error(error) or "chrome/windows decoder fallback is required" in text:
        return "decoder-unsupported"
    if "protected media" in text or "drm" in text or "encrypted" in text:
        return "protected-media"
    if "duration does not match" in text:
        return "duration-mismatch"
    if "http " in text or "timed out" in text or "network" in text:
        return "network"
    if "did not return an hls playlist" in text:
        return "invalid-playlist"
    if "no hls audio rendition matched requested language" in text:
        return "language-mismatch"
    if "no audio" in text or "no audio samples" in text:
        return "no-audio"
    return "decode-or-access-error"


def content_range_total(value: str | None) -> int | None:
    match = re.match(r"^bytes\s+\d+-\d+/(\d+)$", str(value or "").strip(), flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def download_and_decode_youtube(source: ResolvedSource, job_id: str):
    temp_root = os.path.join(PROJECT_ROOT, ".runtime", "batch-temp")
    os.makedirs(temp_root, exist_ok=True)
    temp_directory = tempfile.mkdtemp(prefix="audio-", dir=temp_root)
    extension = source.media_extension or "media"
    media_path = os.path.join(temp_directory, f"audio.{extension}")
    last_reported_percent = -5
    last_reported_at = 0.0
    download_started_at = time.monotonic()
    request_headers = {
        "Accept-Encoding": "identity",
        **{
            "-".join(part.capitalize() for part in name.split("-")): value
            for name, value in source.headers.items()
        },
    }
    opener = build_opener(PublicCaptionRedirectHandler())
    try:
        total = 0
        downloaded = 0
        with open(media_path, "wb") as output:
            while not total or downloaded < total:
                range_end = downloaded + HTTP_AUDIO_CHUNK_BYTES - 1
                request = Request(
                    source.url,
                    headers={**request_headers, "Range": f"bytes={downloaded}-{range_end}"},
                    method="GET",
                )
                with opener.open(request, timeout=30) as response:
                    status = int(getattr(response, "status", None) or response.getcode() or 0)
                    if downloaded and status != 206:
                        raise RuntimeError("The media server stopped honoring audio Range requests.")
                    if status == 206:
                        response_total = content_range_total(response.headers.get("Content-Range"))
                        if response_total is None:
                            raise RuntimeError("The media server returned an invalid audio Content-Range.")
                        if total and total != response_total:
                            raise RuntimeError("The media server changed the audio size between chunks.")
                        total = response_total
                    elif status == 200:
                        total = int(response.headers.get("Content-Length") or 0)
                    else:
                        raise RuntimeError(f"The media server returned HTTP {status} for the audio stream.")
                    if total > MAX_AUDIO_BYTES:
                        raise RuntimeError("The selected audio stream exceeds the 1 GB temporary-file limit.")

                    chunk_downloaded = 0
                    while True:
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        output.write(chunk)
                        downloaded += len(chunk)
                        chunk_downloaded += len(chunk)
                        if downloaded > MAX_AUDIO_BYTES:
                            raise RuntimeError("The selected audio stream exceeded the 1 GB temporary-file limit.")
                        now = time.monotonic()
                        percent = min(99, int(downloaded / total * 100)) if total > 0 else None
                        should_report = (
                            percent >= last_reported_percent + 5
                            if percent is not None
                            else now - last_reported_at >= 2
                        )
                        if not should_report:
                            continue
                        emit(
                            "batch_download_progress",
                            job_id,
                            percent=percent,
                            downloadedBytes=downloaded,
                            totalBytes=total or None,
                            bytesPerSecond=round(
                                downloaded / max(0.001, now - download_started_at),
                                1,
                            ),
                        )
                        if percent is not None:
                            last_reported_percent = percent
                        last_reported_at = now
                    if status == 200:
                        break
                    if chunk_downloaded <= 0:
                        raise RuntimeError("The media server returned an empty audio Range chunk.")
        if not os.path.getsize(media_path):
            raise RuntimeError("The temporary YouTube audio download was empty.")
        emit(
            "batch_download_progress",
            job_id,
            percent=100,
            downloadedBytes=os.path.getsize(media_path),
            totalBytes=total or os.path.getsize(media_path),
            bytesPerSecond=round(
                os.path.getsize(media_path) / max(0.001, time.monotonic() - download_started_at),
                1,
            ),
        )
        emit(
            "batch_status",
            job_id,
            message="Audio downloaded locally. Decoding the temporary file now.",
        )
        return decode_audio(media_path, sampling_rate=16_000)
    finally:
        shutil.rmtree(temp_directory, ignore_errors=True)


def load_model(model_name: str, job_id: str):
    try:
        model = WhisperModel(model_name, device="cuda", compute_type="float16")
        return model, "cuda/float16"
    except Exception as gpu_error:
        emit(
            "batch_status",
            job_id,
            message=f"GPU initialization failed; using CPU int8 ({gpu_error}).",
        )
        return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu/int8"


def transcribe_words(model, audio, language: str, duration: float, job_id: str):
    segments, info = model.transcribe(
        audio,
        language=language,
        task="transcribe",
        beam_size=5,
        condition_on_previous_text=True,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 500,
            "speech_pad_ms": 250,
        },
    )
    words: list[ASRToken] = []
    last_reported_percent = -1
    for segment in segments:
        for word in segment.words or []:
            if word.start is None or word.end is None or not word.word:
                continue
            words.append(ASRToken(float(word.start), float(word.end), str(word.word)))
        percent = min(99, int(max(0.0, float(segment.end)) / max(duration, 0.001) * 100))
        if percent >= last_reported_percent + 2:
            emit(
                "batch_progress",
                job_id,
                percent=percent,
                processedSeconds=round(float(segment.end), 3),
                duration=round(duration, 3),
            )
            last_reported_percent = percent
    return words, info


def group_words_by_silence(words: Iterable[ASRToken]) -> list[list[ASRToken]]:
    groups: list[list[ASRToken]] = []
    current: list[ASRToken] = []
    for word in words:
        if (
            current
            and word.start is not None
            and current[-1].end is not None
            and word.start - current[-1].end >= SILENCE_BREAK_SECONDS
        ):
            groups.append(current)
            current = []
        current.append(word)
    if current:
        groups.append(current)
    return groups


def create_cues(words: list[ASRToken], job_id: str) -> list[dict]:
    cues: list[dict] = []
    for group in group_words_by_silence(words):
        for cue in split_tokens(group, finalize_tail=True):
            cue_words: list[dict] = []
            for word in group:
                if (
                    word.start is not None
                    and word.end is not None
                    and word.start >= float(cue.start or 0.0) - 0.001
                    and word.end <= float(cue.end or cue.start or 0.0) + 0.001
                ):
                    cue_words.extend(
                        distribute_timed_words(str(word.text or ""), float(word.start), float(word.end))
                    )
            cues.append({
                "id": f"batch:{job_id}:{len(cues)}",
                "epochId": "batch",
                "start": round(float(cue.start or 0.0), 3),
                "end": round(float(cue.end or cue.start or 0.0), 3),
                "text": str(cue.text or "").strip(),
                "words": cue_words,
                "complete": True,
                "boundary": getattr(cue, "dub_boundary", "silence"),
                "timing": "word-timestamps",
            })
    return [cue for cue in cues if cue["text"] and cue["end"] >= cue["start"]]


def word_tokens(text: str) -> list[str]:
    cleaned = re.sub(r"\[[^\]]{1,120}\]", " ", str(text or ""))
    cleaned = cleaned.replace("♪", " ").casefold()
    return re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*", cleaned, flags=re.UNICODE)


def distribute_timed_words(text: str, start: float, end: float) -> list[dict]:
    matches = list(re.finditer(r"[^\W_]+(?:['’\-][^\W_]+)*", str(text or ""), flags=re.UNICODE))
    if not matches:
        return []
    start = max(0.0, float(start))
    end = max(start, float(end))
    if len(matches) == 1:
        return [{
            "text": matches[0].group(0),
            "start": round(start, 3),
            "end": round(end, 3),
        }]
    span = max(1, len(str(text or "")))
    duration = end - start
    return [{
        "text": match.group(0),
        "start": round(start + duration * match.start() / span, 3),
        "end": round(start + duration * match.end() / span, 3),
    } for match in matches]


def transcript_words(segments: Iterable[dict]) -> list[str]:
    return word_tokens(" ".join(str(segment.get("text") or "") for segment in segments))


def timed_transcript_words(segments: Iterable[dict]) -> list[dict]:
    result: list[dict] = []
    for segment in segments:
        raw_words = segment.get("words") or distribute_timed_words(
            str(segment.get("text") or ""),
            float(segment.get("start") or 0.0),
            float(segment.get("end") or segment.get("start") or 0.0),
        )
        for raw_word in raw_words:
            normalized = word_tokens(str(raw_word.get("text") or ""))
            if not normalized:
                continue
            start = float(raw_word.get("start") or 0.0)
            end = float(raw_word.get("end") or start)
            if len(normalized) == 1:
                result.append({"text": normalized[0], "start": start, "end": end})
                continue
            for word in distribute_timed_words(" ".join(normalized), start, end):
                result.append({
                    "text": word_tokens(word["text"])[0],
                    "start": word["start"],
                    "end": word["end"],
                })
    return result


def word_error_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for reference_index, reference_word in enumerate(reference, start=1):
        current = [reference_index]
        for hypothesis_index, hypothesis_word in enumerate(hypothesis, start=1):
            substitution = previous[hypothesis_index - 1] + (reference_word != hypothesis_word)
            insertion = current[hypothesis_index - 1] + 1
            deletion = previous[hypothesis_index] + 1
            current.append(min(substitution, insertion, deletion))
        previous = current
    return previous[-1]


def compute_answer_key_evaluation(
    cues: list[dict],
    answer_key: CaptionAnswerKey | None,
    answer_key_status: str,
) -> dict:
    if not answer_key:
        return {
            "status": "unavailable",
            "reason": answer_key_status,
            "captionsUsedAsInput": False,
        }

    reference_words = transcript_words(answer_key.segments)
    hypothesis_words = transcript_words(cues)
    if not reference_words:
        return {
            "status": "unavailable",
            "reason": "the selected caption track contained no comparable words",
            "captionsUsedAsInput": False,
        }

    distance = word_error_distance(reference_words, hypothesis_words)
    reference_timed_words = timed_transcript_words(answer_key.segments)
    hypothesis_timed_words = timed_transcript_words(cues)
    matcher = SequenceMatcher(
        None,
        [word["text"] for word in reference_timed_words],
        [word["text"] for word in hypothesis_timed_words],
    )
    timing_offsets: list[float] = []
    for block in matcher.get_matching_blocks():
        for index in range(block.size):
            reference_word = reference_timed_words[block.a + index]
            hypothesis_word = hypothesis_timed_words[block.b + index]
            timing_offsets.append(hypothesis_word["start"] - reference_word["start"])
    absolute_timing_errors = sorted(abs(offset) for offset in timing_offsets)
    percentile_90 = (
        absolute_timing_errors[max(0, int(len(absolute_timing_errors) * 0.9 + 0.9999) - 1)]
        if absolute_timing_errors else None
    )
    word_error_rate = distance / len(reference_words)
    return {
        "status": "available",
        "captionsUsedAsInput": False,
        "reference": {
            "platform": "youtube",
            "kind": answer_key.kind,
            "language": answer_key.language,
            "name": answer_key.name,
            "segmentCount": len(answer_key.segments),
        },
        "metrics": {
            "referenceWordCount": len(reference_words),
            "asrWordCount": len(hypothesis_words),
            "wordEditDistance": distance,
            "wordErrorRate": round(word_error_rate, 4),
            "wordAgreementEstimate": round(max(0.0, 1.0 - word_error_rate), 4),
            "timingMatchedWordCount": len(timing_offsets),
            "timingMedianOffsetSeconds": (
                round(statistics.median(timing_offsets), 3) if timing_offsets else None
            ),
            "timingMedianAbsoluteErrorSeconds": (
                round(statistics.median(absolute_timing_errors), 3)
                if absolute_timing_errors else None
            ),
            "timingP90AbsoluteErrorSeconds": (
                round(percentile_90, 3) if percentile_90 is not None else None
            ),
            "timingWithin750msRate": round(
                sum(error <= 0.75 for error in absolute_timing_errors)
                / max(1, len(absolute_timing_errors)),
                4,
            ),
        },
    }


def batch_worker_diagnostics() -> dict:
    details = {
        "workerVersion": WORKER_VERSION,
        "pythonVersion": ".".join(str(part) for part in sys.version_info[:3]),
    }
    try:
        import av

        details["pyavVersion"] = str(av.__version__)
        libavcodec = av.library_versions.get("libavcodec")
        if libavcodec:
            details["libavcodecVersion"] = ".".join(str(part) for part in libavcodec)
    except Exception as error:
        details["pyavInspectionError"] = str(error)[:160]
    return details


def run(request: dict) -> None:
    job_id = str(request.get("jobId") or "")
    if not job_id:
        raise ValueError("The batch request is missing its job ID.")
    language = str(request.get("language") or "de")[:16]
    model_name = str(request.get("model") or "small")[:64]

    emit("batch_worker_info", job_id, **batch_worker_diagnostics())
    emit("batch_status", job_id, message="Resolving the authorized media source.")
    sources = resolve_sources(request)
    source = sources[0]
    if source.answer_key:
        emit(
            "batch_status",
            job_id,
            message=(
                f"Found a {source.answer_key.kind} {source.answer_key.language} "
                "YouTube caption track for evaluation only."
            ),
        )
    emit(
        "batch_status",
        job_id,
        message=(
            "Downloading the authorized audio to a temporary local file. Nothing is uploaded."
            if source.youtube_page_url
            else (
                f"Found {len(sources)} possible media source"
                f"{'s' if len(sources) != 1 else ''}. Acquiring clear audio locally; nothing is uploaded."
            )
        ),
        title=source.title,
    )
    source, audio = acquire_first_accessible_source(sources, job_id, language)
    duration = len(audio) / 16_000
    emit(
        "batch_started",
        job_id,
        duration=round(duration, 3),
        title=source.title,
        sourceKind=source.media_kind,
        sourceHost=urlsplit(source.url).hostname,
    )

    model, device = load_model(model_name, job_id)
    try:
        words, info = transcribe_words(model, audio, language, duration, job_id)
    except Exception as gpu_error:
        if not device.startswith("cuda"):
            raise
        emit(
            "batch_status",
            job_id,
            message=f"GPU inference failed; retrying on CPU int8 ({gpu_error}).",
        )
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        device = "cpu/int8"
        words, info = transcribe_words(model, audio, language, duration, job_id)

    cues = create_cues(words, job_id)
    caption_segments = source.answer_key.segments if source.answer_key else []
    evaluation = compute_answer_key_evaluation(
        cues,
        source.answer_key,
        source.answer_key_status,
    )
    for offset in range(0, len(cues), RESULT_CHUNK_SIZE):
        emit("batch_segments", job_id, segments=cues[offset:offset + RESULT_CHUNK_SIZE])
    for offset in range(0, len(caption_segments), RESULT_CHUNK_SIZE):
        emit(
            "batch_captions",
            job_id,
            segments=caption_segments[offset:offset + RESULT_CHUNK_SIZE],
        )
    emit(
        "batch_complete",
        job_id,
        duration=round(duration, 3),
        language=getattr(info, "language", language),
        device=device,
        segmentCount=len(cues),
        captionSegmentCount=len(caption_segments),
        evaluation=evaluation,
    )


def main() -> int:
    request: dict = {}
    try:
        line = sys.stdin.readline()
        if not line:
            raise ValueError("The native host did not provide a batch request.")
        request = json.loads(line)
        run(request)
        return 0
    except Exception as error:
        job_id = str(request.get("jobId") or "unknown")
        emit(
            "batch_error",
            job_id,
            message=str(error),
            category=media_failure_category(error),
            workerVersion=WORKER_VERSION,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

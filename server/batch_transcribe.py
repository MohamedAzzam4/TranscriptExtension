"""Local full-media transcription worker for the Native Messaging host.

The worker accepts one JSON request on stdin and writes newline-delimited JSON
events to stdout. Only public HTTP(S) media is accepted; browser cookies are
never copied into the native process.
"""

from __future__ import annotations

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
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Iterable
from urllib.parse import urlsplit
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
ALLOWED_SOURCE_KINDS = {"direct", "youtube"}
MAX_CAPTION_BYTES = 8 * 1024 * 1024
HTTP_AUDIO_CHUNK_BYTES = 8 * 1024 * 1024
MAX_AUDIO_BYTES = 1024 * 1024 * 1024


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


def emit(state: str, job_id: str, **payload) -> None:
    print(
        json.dumps(
            {"state": state, "jobId": job_id, **payload},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        flush=True,
    )


def validate_public_http_url(value: str, *, youtube_only: bool = False) -> str:
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
    allowed = {"accept", "accept-language", "origin", "referer", "user-agent"}
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


def resolve_source(request: dict) -> ResolvedSource:
    source_kind = str(request.get("sourceKind") or "")
    if source_kind not in ALLOWED_SOURCE_KINDS:
        raise ValueError("Unsupported batch source type.")

    if source_kind == "direct":
        return ResolvedSource(
            url=validate_public_http_url(request.get("sourceUrl")),
            headers=clean_headers(request.get("headers")),
            duration=number_or_none(request.get("durationHint")),
            answer_key_status=(
                "unsupported-for-direct-media"
                if request.get("collectCaptions")
                else "not-requested"
            ),
        )

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
    return ResolvedSource(
        url=source_url,
        headers=clean_headers(info.get("http_headers")),
        title=info.get("title"),
        duration=number_or_none(info.get("duration")),
        answer_key=answer_key,
        answer_key_status=answer_key_status,
        youtube_page_url=page_url,
        media_extension=re.sub(r"[^a-z0-9]", "", str(info.get("ext") or "").casefold())[:8] or None,
    )


def number_or_none(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def decode_source(source: ResolvedSource, job_id: str):
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

    header_block = "".join(f"{name}: {value}\r\n" for name, value in source.headers.items())
    options = {
        "rw_timeout": "30000000",
        "reconnect": "1",
        "reconnect_streamed": "1",
        "reconnect_delay_max": "5",
    }
    if header_block:
        options["headers"] = header_block
    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16_000)
    chunks: list = []
    decoded_sample_count = 0
    last_reported_percent = -5
    last_reported_seconds = -30.0
    last_reported_at = 0.0
    with av.open(source.url, mode="r", options=options, metadata_errors="ignore") as container:
        if not container.streams.audio:
            raise RuntimeError("The selected media source has no audio stream.")
        for frame in container.decode(audio=0):
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
                )
                if percent is not None:
                    last_reported_percent = percent
                last_reported_seconds = decoded_seconds
                last_reported_at = now
        flushed = resampler.resample(None)
        flushed_frames = flushed if isinstance(flushed, list) else ([flushed] if flushed else [])
        for converted_frame in flushed_frames:
            chunks.append(converted_frame.to_ndarray().reshape(-1))

    if not chunks:
        raise RuntimeError("No audio samples could be decoded from the selected source.")
    audio = np.concatenate(chunks).astype(np.float32) / 32768.0
    return audio


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


def run(request: dict) -> None:
    job_id = str(request.get("jobId") or "")
    if not job_id:
        raise ValueError("The batch request is missing its job ID.")
    language = str(request.get("language") or "de")[:16]
    model_name = str(request.get("model") or "small")[:64]

    emit("batch_status", job_id, message="Resolving the authorized media source.")
    source = resolve_source(request)
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
            else "Decoding the full audio locally. Nothing is uploaded."
        ),
        title=source.title,
    )
    audio = decode_source(source, job_id)
    duration = len(audio) / 16_000
    emit("batch_started", job_id, duration=round(duration, 3), title=source.title)

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
        emit("batch_error", job_id, message=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

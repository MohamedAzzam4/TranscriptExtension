import os
import socket
import tempfile
import unittest
from unittest.mock import patch

from whisperlivekit.timed_objects import ASRToken

from batch_transcribe import (
    acquire_first_accessible_source,
    batch_worker_diagnostics,
    CaptionAnswerKey,
    HlsPngTsInspection,
    ResolvedSource,
    clean_headers,
    content_range_total,
    compute_answer_key_evaluation,
    create_cues,
    decode_png_wrapped_hls,
    decode_source,
    download_and_decode_youtube,
    ffmpeg_http_options,
    group_words_by_silence,
    hls_child_playlists,
    hls_audio_playlists,
    hls_audio_languages,
    hls_media_segments,
    hls_relevant_playlists,
    inspect_png_wrapped_hls,
    media_failure_category,
    parse_youtube_json3,
    playlist_protection_reason,
    resolve_hls_audio_source,
    resolve_sources,
    select_audio_stream,
    select_youtube_caption_track,
    unwrap_png_appended_mpegts,
    validate_public_http_url,
)


class BatchTranscribeTests(unittest.TestCase):
    @patch("batch_transcribe.socket.getaddrinfo")
    def test_public_https_url_is_allowed(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        self.assertEqual(
            validate_public_http_url("https://media.example/video.mp4?token=abc"),
            "https://media.example/video.mp4?token=abc",
        )

    def test_non_http_url_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_public_http_url("file:///private/video.mp4")

    @patch("batch_transcribe.socket.getaddrinfo")
    def test_private_address_is_rejected(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with self.assertRaises(ValueError):
            validate_public_http_url("https://localhost/video.mp4")

    def test_headers_are_allowlisted_and_newlines_removed(self):
        self.assertEqual(
            clean_headers({
                "User-Agent": "Browser\r\nInjected: no",
                "Cookie": "secret",
                "Authorization": "Bearer secret",
                "Referer": "https://example.com/watch",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
            }),
            {
                "user-agent": "BrowserInjected: no",
                "referer": "https://example.com/watch",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "cross-site",
            },
        )

    def test_ffmpeg_http_options_use_dedicated_user_agent_and_referer(self):
        options = ffmpeg_http_options({
            "user-agent": "Test Browser",
            "referer": "https://player.example/watch",
            "origin": "https://player.example",
            "accept-language": "de-DE",
        })
        self.assertEqual(options["user_agent"], "Test Browser")
        self.assertEqual(options["referer"], "https://player.example/watch")
        self.assertIn("origin: https://player.example\r\n", options["headers"])
        self.assertIn("accept-language: de-DE\r\n", options["headers"])
        self.assertNotIn("user-agent", options["headers"])
        self.assertNotIn("referer", options["headers"])

    @patch("batch_transcribe.socket.getaddrinfo")
    def test_direct_sources_keep_ranked_candidates(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        sources = resolve_sources({
            "sourceKind": "direct",
            "sourceCandidates": [
                {
                    "url": "https://media.example/master.m3u8",
                    "kind": "hls",
                    "source": "netflix-player-metadata",
                    "language": "deu",
                    "codec": "aac",
                    "profile": "xhe-aac-dash",
                    "bitrate": 128000,
                    "channels": 2,
                    "representationIndex": 3,
                    "headers": {
                        "referer": "https://player.example/embed",
                        "origin": "https://player.example",
                        "cookie": "must-not-survive",
                    },
                },
                {"url": "https://media.example/movie.mp4", "kind": "media"},
            ],
            "headers": {"referer": "https://player.example/watch"},
            "durationHint": 1200,
        })
        self.assertEqual([source.media_kind for source in sources], ["hls", "media"])
        self.assertEqual(sources[0].headers["referer"], "https://player.example/embed")
        self.assertEqual(sources[0].headers["origin"], "https://player.example")
        self.assertNotIn("cookie", sources[0].headers)
        self.assertEqual(sources[1].headers["referer"], "https://player.example/watch")
        self.assertEqual(sources[0].duration, 1200)
        self.assertEqual(sources[0].discovery_source, "netflix-player-metadata")
        self.assertEqual(sources[0].language_hint, "deu")
        self.assertEqual(sources[0].codec_hint, "aac")
        self.assertEqual(sources[0].profile_hint, "xhe-aac-dash")
        self.assertEqual(sources[0].bitrate, 128000)
        self.assertEqual(sources[0].channels, 2)
        self.assertEqual(sources[0].representation_index, 3)

    def test_worker_diagnostics_include_decoder_versions(self):
        diagnostics = batch_worker_diagnostics()
        self.assertEqual(diagnostics["workerVersion"], "0.10.3")
        self.assertIn("pyavVersion", diagnostics)
        self.assertIn("libavcodecVersion", diagnostics)

    def test_patchwelcome_is_classified_as_unsupported_decoder(self):
        error = RuntimeError("Not yet implemented in FFmpeg, patches welcome: avcodec_send_packet")
        self.assertEqual(media_failure_category(error), "decoder-unsupported")

    def test_browser_pcm_is_loaded_and_deleted_from_local_temp_directory(self):
        job_id = "browser-job"
        with tempfile.TemporaryDirectory() as project_root:
            temp_root = os.path.join(project_root, ".runtime", "batch-temp")
            os.makedirs(temp_root)
            pcm_path = os.path.join(temp_root, f"browser-pcm-{job_id}.s16le")
            with open(pcm_path, "wb") as output:
                output.write(b"\x00\x00" * 16_000)
            with (
                patch("batch_transcribe.PROJECT_ROOT", project_root),
                patch("batch_transcribe.emit"),
            ):
                source = resolve_sources({
                    "sourceKind": "browser-pcm",
                    "jobId": job_id,
                    "pcmPath": pcm_path,
                    "pcmBytes": 32_000,
                    "sampleRate": 16_000,
                    "channels": 1,
                    "durationHint": 1,
                })[0]
                audio = decode_source(source, job_id, "de", 1, 1)
            self.assertEqual(len(audio), 16_000)
            self.assertFalse(os.path.exists(pcm_path))

    def test_browser_pcm_outside_local_temp_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as project_root:
            outside = os.path.join(project_root, "outside.s16le")
            with open(outside, "wb") as output:
                output.write(b"\x00\x00")
            with patch("batch_transcribe.PROJECT_ROOT", project_root):
                with self.assertRaises(ValueError):
                    resolve_sources({
                        "sourceKind": "browser-pcm",
                        "jobId": "browser-job",
                        "pcmPath": outside,
                        "sampleRate": 16_000,
                        "channels": 1,
                    })

    def test_hls_children_include_audio_and_variant_playlists(self):
        children = hls_child_playlists(
            """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",LANGUAGE=\"de\",URI=\"audio/de.m3u8\"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"a\"
video/main.m3u8
""",
            "https://media.example/path/master.m3u8",
        )
        self.assertEqual(children, [
            "https://media.example/path/audio/de.m3u8",
            "https://media.example/path/video/main.m3u8",
        ])

    def test_hls_relevant_playlist_prefers_requested_audio_language(self):
        selected = hls_relevant_playlists(
            """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",LANGUAGE=\"en\",DEFAULT=YES,URI=\"audio/en.m3u8\"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",LANGUAGE=\"deu\",URI=\"audio/de.m3u8\"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"a\"
video/main.m3u8
""",
            "https://media.example/path/master.m3u8",
            "de",
        )
        self.assertEqual(selected, ["https://media.example/path/audio/de.m3u8"])

    def test_hls_audio_playlists_rank_requested_language_before_default(self):
        selected = hls_audio_playlists(
            """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="deu",URI="audio/de.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"
video/main.m3u8
""",
            "https://media.example/path/master.m3u8",
            "de",
        )
        self.assertEqual(selected, [
            "https://media.example/path/audio/de.m3u8",
            "https://media.example/path/audio/en.m3u8",
        ])
        self.assertEqual(
            hls_audio_languages(
                '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="eng",URI="en.m3u8"\n'
                '#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="deu",URI="de.m3u8"\n'
            ),
            ["en", "de"],
        )

    @patch("batch_transcribe.read_playlist_text")
    def test_hls_explicit_language_mismatch_is_not_silently_selected(
        self,
        read_playlist_text,
    ):
        read_playlist_text.return_value = (
            '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",'
            'LANGUAGE="eng",DEFAULT=YES,URI="audio/en.m3u8"\n'
            '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"\nvideo/main.m3u8\n'
        )
        with self.assertRaisesRegex(RuntimeError, "Available languages: en"):
            resolve_hls_audio_source(
                ResolvedSource(
                    url="https://media.example/path/master.m3u8",
                    headers={},
                    media_kind="hls",
                ),
                "de",
            )

    @patch("batch_transcribe.validate_public_http_url", side_effect=lambda value: value)
    @patch("batch_transcribe.emit")
    @patch("batch_transcribe.read_playlist_text")
    def test_hls_master_resolves_to_requested_audio_child(
        self,
        read_playlist_text,
        emit_mock,
        _validate,
    ):
        read_playlist_text.side_effect = [
            """#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="en",URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="deu",URI="audio/de.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"
video/main.m3u8
""",
            "#EXTM3U\n#EXTINF:4,\nsegment-1.aac\n",
        ]
        source = ResolvedSource(
            url="https://media.example/path/master.m3u8",
            headers={"referer": "https://player.example/watch"},
            media_kind="hls",
            duration=120,
        )
        resolved = resolve_hls_audio_source(source, "de", "job", 1, 2)
        self.assertEqual(resolved.url, "https://media.example/path/audio/de.m3u8")
        self.assertEqual(resolved.media_kind, "hls-audio")
        self.assertEqual(resolved.headers, source.headers)
        emit_mock.assert_called_once()
        event = emit_mock.call_args
        self.assertEqual(event.args[:2], ("batch_candidate_playlist", "job"))
        self.assertEqual(event.kwargs["playlistType"], "master")
        self.assertEqual(event.kwargs["audioRenditionCount"], 2)
        self.assertTrue(event.kwargs["selectedAudioRendition"])

    @patch("batch_transcribe.read_playlist_text", return_value="<html>Access denied</html>")
    def test_hls_non_playlist_response_is_rejected_explicitly(self, _read_playlist):
        with self.assertRaisesRegex(RuntimeError, "did not return an HLS playlist"):
            resolve_hls_audio_source(
                ResolvedSource(
                    url="https://media.example/path/master.m3u8",
                    headers={},
                    media_kind="hls",
                ),
                "de",
            )

    @patch(
        "batch_transcribe.read_playlist_text",
        return_value=(
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n"
            "#EXTINF:4,\nsegment-1.ts\n"
        ),
    )
    def test_hls_resolver_rejects_encrypted_playlist(self, _read_playlist):
        with self.assertRaisesRegex(RuntimeError, "Protected media"):
            resolve_hls_audio_source(
                ResolvedSource(
                    url="https://media.example/path/audio.m3u8",
                    headers={},
                    media_kind="hls",
                ),
                "de",
            )

    @patch("batch_transcribe.read_playlist_text")
    def test_encrypted_hls_is_rejected_before_decode(self, read_playlist_text):
        read_playlist_text.return_value = (
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\na.ts\n"
        )
        reason = playlist_protection_reason(ResolvedSource(
            url="https://media.example/audio.m3u8",
            headers={},
            media_kind="hls",
        ))
        self.assertIn("encrypted media keys", reason)

    @patch("batch_transcribe.read_playlist_text")
    def test_hls_method_none_is_clear(self, read_playlist_text):
        read_playlist_text.return_value = (
            "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\na.ts\n"
        )
        reason = playlist_protection_reason(ResolvedSource(
            url="https://media.example/audio.m3u8",
            headers={},
            media_kind="hls",
        ))
        self.assertIsNone(reason)

    def test_hls_media_segments_preserve_order_duration_and_relative_urls(self):
        segments = hls_media_segments(
            """#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:9.92,
segment-one
#EXTINF:2.84,
https://cdn.example/segment-two
""",
            "https://media.example/path/index.m3u8",
        )
        self.assertEqual(
            segments,
            [
                ("https://media.example/path/segment-one", 9.92),
                ("https://cdn.example/segment-two", 2.84),
            ],
        )

    def test_png_envelope_is_removed_only_when_appended_payload_is_mpegts(self):
        png_signature = b"\x89PNG\r\n\x1a\n"
        ihdr = (
            (13).to_bytes(4, "big")
            + b"IHDR"
            + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        iend = b"\x00\x00\x00\x00IEND\x00\x00\x00\x00"
        transport_stream = (
            b"\x47" + b"\x00" * 187
            + b"\x47" + b"\x01" * 187
            + b"\x47" + b"\x02" * 187
        )
        wrapped = png_signature + ihdr + iend + transport_stream
        self.assertEqual(unwrap_png_appended_mpegts(wrapped), transport_stream)
        truncated_packet_prefix = b"\x47" + b"\x99" * 181
        self.assertEqual(
            unwrap_png_appended_mpegts(
                png_signature + ihdr + iend + truncated_packet_prefix + transport_stream
            ),
            transport_stream,
        )
        self.assertIsNone(unwrap_png_appended_mpegts(png_signature + ihdr + iend))
        self.assertIsNone(unwrap_png_appended_mpegts(transport_stream))

    @patch("batch_transcribe.validate_public_http_url", side_effect=lambda value: value)
    @patch("batch_transcribe.read_media_payload")
    @patch("batch_transcribe.read_playlist_text")
    def test_png_wrapped_hls_is_identified_from_the_first_media_segment(
        self,
        read_playlist_text,
        read_media_payload,
        _validate,
    ):
        read_playlist_text.return_value = (
            "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n"
            "#EXTINF:10,\nsegment-one\n#EXTINF:8,\nsegment-two\n"
        )
        transport_stream = (
            b"\x47" + b"\x00" * 187
            + b"\x47" + b"\x01" * 187
            + b"\x47" + b"\x02" * 187
        )
        read_media_payload.return_value = (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\x00IEND\x00\x00\x00\x00"
            + transport_stream,
            "image/png",
        )
        source = ResolvedSource(
            url="https://media.example/path/index.m3u8",
            headers={"referer": "https://player.example/watch"},
            media_kind="hls",
        )
        inspection = inspect_png_wrapped_hls(source)
        self.assertIsNotNone(inspection)
        self.assertEqual(inspection.wrapper_kind, "png-appended-mpegts")
        self.assertEqual(len(inspection.segments), 2)
        self.assertEqual(inspection.first_transport_stream, transport_stream)

    @patch("batch_transcribe.read_playlist_text")
    def test_png_wrapper_path_does_not_treat_live_or_master_hls_as_complete(
        self,
        read_playlist_text,
    ):
        source = ResolvedSource(
            url="https://media.example/path/index.m3u8",
            headers={},
            media_kind="hls",
        )
        read_playlist_text.side_effect = [
            "#EXTM3U\n#EXTINF:10,\nsegment-one\n",
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8\n",
        ]
        self.assertIsNone(inspect_png_wrapped_hls(source))
        self.assertIsNone(inspect_png_wrapped_hls(source))

    @patch("batch_transcribe.decode_png_wrapped_hls")
    @patch("batch_transcribe.inspect_png_wrapped_hls")
    @patch("batch_transcribe.decode_source")
    @patch("batch_transcribe.resolve_hls_audio_source")
    @patch("batch_transcribe.emit")
    def test_invalid_native_hls_input_retries_with_verified_png_segment_unwrap(
        self,
        _emit,
        resolve_hls_audio_source_mock,
        decode_source_mock,
        inspect_png_wrapped_hls_mock,
        decode_png_wrapped_hls_mock,
    ):
        source = ResolvedSource(
            url="https://media.example/path/index.m3u8",
            headers={},
            media_kind="hls",
            duration=1,
        )
        inspection = HlsPngTsInspection(
            segments=[("https://media.example/segment-one", 1.0)],
            first_transport_stream=b"\x47" + b"\x00" * 187,
            first_payload_bytes=200,
            wrapper_kind="png-appended-mpegts",
        )
        resolve_hls_audio_source_mock.return_value = source
        decode_source_mock.side_effect = RuntimeError(
            "Invalid data found when processing input"
        )
        inspect_png_wrapped_hls_mock.return_value = inspection
        decode_png_wrapped_hls_mock.return_value = [0.0] * 16_000

        selected, audio = acquire_first_accessible_source([source], "job", "en")

        self.assertIs(selected, source)
        self.assertEqual(len(audio), 16_000)
        decode_png_wrapped_hls_mock.assert_called_once_with(
            source,
            inspection,
            "job",
            "en",
            1,
            1,
        )

    @patch("batch_transcribe.read_playlist_text")
    def test_dash_content_protection_is_rejected(self, read_playlist_text):
        read_playlist_text.return_value = (
            '<MPD><Period><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:test" />'
            "</AdaptationSet></Period></MPD>"
        )
        reason = playlist_protection_reason(ResolvedSource(
            url="https://media.example/stream.mpd",
            headers={},
            media_kind="dash",
        ))
        self.assertIn("ContentProtection", reason)

    def test_requested_audio_language_is_selected(self):
        class Disposition:
            def __init__(self, default=False):
                self.default = default

        class Stream:
            def __init__(self, index, language, default=False):
                self.index = index
                self.metadata = {"language": language}
                self.disposition = Disposition(default)

        english = Stream(0, "eng", True)
        german = Stream(1, "deu")
        self.assertIs(select_audio_stream([english, german], "de"), german)

    @patch("batch_transcribe.decode_source")
    @patch("batch_transcribe.resolve_hls_audio_source")
    @patch("batch_transcribe.playlist_protection_reason", return_value=None)
    @patch("batch_transcribe.emit")
    def test_acquisition_tries_the_next_ranked_candidate(
        self,
        _emit,
        _protection,
        resolve_hls_audio_source_mock,
        decode_source_mock,
    ):
        first = ResolvedSource(url="https://media.example/first.m3u8", headers={}, media_kind="hls")
        second = ResolvedSource(url="https://media.example/second.m3u8", headers={}, media_kind="hls")
        resolve_hls_audio_source_mock.side_effect = [first, second]
        decode_source_mock.side_effect = [RuntimeError("expired"), [0.0] * 16_000]
        selected, audio = acquire_first_accessible_source([first, second], "job", "de")
        self.assertIs(selected, second)
        self.assertEqual(len(audio), 16_000)

    def test_words_are_grouped_at_real_silence(self):
        words = [
            ASRToken(0.0, 0.4, "Hallo"),
            ASRToken(0.4, 0.8, " Welt."),
            ASRToken(1.6, 2.0, "Nächster"),
            ASRToken(2.0, 2.4, " Satz."),
        ]
        self.assertEqual([len(group) for group in group_words_by_silence(words)], [2, 2])

    def test_batch_cues_keep_preposition_with_natural_phrase(self):
        words = [
            ASRToken(0.0, 3.0, "der dem Begriff das Unbekannte inne wohnt und eine ganz bestimmte Art"),
            ASRToken(3.0, 5.6, " von"),
            ASRToken(5.6, 6.0, " Menschen,"),
            ASRToken(6.0, 6.5, " welche"),
        ]
        cues = create_cues(words, "test")
        self.assertTrue(cues[0]["text"].endswith("von Menschen,"))
        self.assertFalse(any(cue["text"].casefold() == "von" for cue in cues))

    def test_manual_youtube_caption_is_preferred_over_automatic(self):
        info = {
            "subtitles": {"de": [{"ext": "json3", "url": "https://example.com/manual"}]},
            "automatic_captions": {
                "de-orig": [{"ext": "json3", "url": "https://example.com/automatic"}]
            },
        }
        selected = select_youtube_caption_track(info, "de")
        self.assertEqual(selected["kind"], "manual")
        self.assertEqual(selected["language"], "de")

    def test_original_automatic_language_is_preferred(self):
        info = {
            "automatic_captions": {
                "de": [{"ext": "json3", "url": "https://example.com/translated"}],
                "de-orig": [{"ext": "json3", "url": "https://example.com/original"}],
            }
        }
        selected = select_youtube_caption_track(info, "de")
        self.assertEqual(selected["language"], "de-orig")

    def test_youtube_json3_is_converted_to_timed_answer_key(self):
        segments = parse_youtube_json3({
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1500, "segs": [{"utf8": "Hallo "}, {"utf8": "Welt."}]},
                {"tStartMs": 3000, "segs": [{"utf8": "Weiter."}]},
            ]
        }, "de", "manual")
        self.assertEqual(segments[0]["text"], "Hallo Welt.")
        self.assertEqual((segments[0]["start"], segments[0]["end"]), (1.0, 2.5))
        self.assertEqual((segments[1]["start"], segments[1]["end"]), (3.0, 5.0))

    def test_answer_key_evaluation_reports_zero_error_for_identical_text(self):
        reference_segments = [{
            "id": "reference:0",
            "start": 0.0,
            "end": 2.0,
            "text": "Hallo schöne Welt.",
            "words": [
                {"text": "Hallo", "start": 0.0, "end": 0.4},
                {"text": "schöne", "start": 0.5, "end": 1.0},
                {"text": "Welt", "start": 1.1, "end": 1.6},
            ],
        }]
        answer_key = CaptionAnswerKey("de", "manual", "Deutsch", reference_segments)
        evaluation = compute_answer_key_evaluation([
            {
                "start": 0.0,
                "end": 2.0,
                "text": "Hallo schöne Welt.",
                "words": reference_segments[0]["words"],
            }
        ], answer_key, "available")
        self.assertEqual(evaluation["metrics"]["wordErrorRate"], 0.0)
        self.assertEqual(evaluation["metrics"]["timingMedianAbsoluteErrorSeconds"], 0.0)
        self.assertEqual(evaluation["metrics"]["timingMatchedWordCount"], 3)
        self.assertFalse(evaluation["captionsUsedAsInput"])

    def test_resolved_audio_download_is_decoded_and_deleted(self):
        class FakeResponse:
            status = 206
            headers = {
                "Content-Length": "6",
                "Content-Range": "bytes 0-5/6",
            }

            def __init__(self):
                self.chunks = [b"abcdef", b""]

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, _size):
                return self.chunks.pop(0)

        class FakeOpener:
            def open(self, _request, timeout):
                self.timeout = timeout
                return FakeResponse()

        source = ResolvedSource(
            url="https://media.example/audio",
            headers={"user-agent": "test"},
            youtube_page_url="https://www.youtube.com/watch?v=test",
            media_extension="m4a",
        )
        with tempfile.TemporaryDirectory() as project_root:
            with (
                patch("batch_transcribe.PROJECT_ROOT", project_root),
                patch("batch_transcribe.build_opener", return_value=FakeOpener()),
                patch("batch_transcribe.emit"),
                patch(
                    "batch_transcribe.decode_audio",
                    side_effect=lambda path, sampling_rate: (
                        self.assertTrue(os.path.exists(path)),
                        self.assertEqual(sampling_rate, 16_000),
                        [0.0],
                    )[-1],
                ),
            ):
                self.assertEqual(download_and_decode_youtube(source, "test-job"), [0.0])
            temp_root = os.path.join(project_root, ".runtime", "batch-temp")
            self.assertEqual(os.listdir(temp_root), [])

    def test_content_range_total(self):
        self.assertEqual(content_range_total("bytes 0-8388607/11742779"), 11_742_779)
        self.assertIsNone(content_range_total("11742779"))

    def test_youtube_download_failure_uses_original_direct_decoder(self):
        source = ResolvedSource(
            url="https://media.example/audio",
            headers={"user-agent": "test"},
            youtube_page_url="https://www.youtube.com/watch?v=test",
        )
        with (
            patch(
                "batch_transcribe.download_and_decode_youtube",
                side_effect=RuntimeError("range unavailable"),
            ),
            patch("batch_transcribe.decode_audio", return_value=[0.0]) as direct_decode,
            patch("batch_transcribe.emit"),
        ):
            self.assertEqual(decode_source(source, "test-job"), [0.0])
        direct_decode.assert_called_once_with(source.url, sampling_rate=16_000)


if __name__ == "__main__":
    unittest.main()

import os
import socket
import tempfile
import unittest
from unittest.mock import patch

from whisperlivekit.timed_objects import ASRToken

from batch_transcribe import (
    CaptionAnswerKey,
    ResolvedSource,
    clean_headers,
    content_range_total,
    compute_answer_key_evaluation,
    create_cues,
    decode_source,
    download_and_decode_youtube,
    group_words_by_silence,
    parse_youtube_json3,
    select_youtube_caption_track,
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
                "Referer": "https://example.com/watch",
            }),
            {
                "user-agent": "BrowserInjected: no",
                "referer": "https://example.com/watch",
            },
        )

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

"""Caption-only fallback: frozen metadata/HTTP doubles, no network or audio."""
import copy
import types
import unittest
from unittest.mock import patch, Mock

import batch_transcribe as worker


class CaptionOnlyTests(unittest.TestCase):
    def setUp(self):
        self.request = {"jobId": "caption-test", "captionsOnly": True,
                        "sourceUrl": "https://www.youtube.com/watch?v=abcdefghijk", "language": "de"}
        self.info = {"id": "abcdefghijk", "subtitles": {"de": [{"ext": "json3", "name": "German",
                     "url": "https://www.youtube.com/api/timedtext?lang=de&sig=PRIVATE"}]},
                     "automatic_captions": {"de-orig": [{"ext": "json3", "url": "https://www.youtube.com/api/timedtext?lang=de&kind=asr"}]}}

    def run_fixture(self, info=None, request=None, translation_fails=False):
        fixture = copy.deepcopy(info if info is not None else self.info)
        options = []
        events = []
        class Downloader:
            def __init__(self, value): options.append(value)
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def extract_info(self, url, download):
                self.download = download
                if download:
                    raise AssertionError("No media download permitted")
                return fixture

        def read_track(temporary, _language):
            item = next(iter(next(iter(temporary.values())).values()))[0]
            translated = 'tlang=' in item['url']
            if translated and translation_fails:
                raise ValueError('Translation unavailable')
            return types.SimpleNamespace(segments=[{"start": 0, "end": 2, "text": 'مرحبا' if translated else 'Hallo Welt.', "words": []}])

        with patch.dict('sys.modules', {'yt_dlp': types.SimpleNamespace(YoutubeDL=Downloader)}), \
             patch.object(worker, 'validate_public_http_url', side_effect=lambda value, **_kwargs: value), \
             patch.object(worker, 'download_youtube_answer_key', side_effect=read_track), \
             patch.object(worker, 'emit', side_effect=lambda state, job, **payload: events.append({"state": state, **payload})), \
             patch.object(worker, 'load_model') as model, patch.object(worker, 'resolve_sources') as sources, \
             patch.object(worker, 'acquire_first_accessible_source') as audio:
            worker.run(request or self.request)
            model.assert_not_called(); sources.assert_not_called(); audio.assert_not_called()
        return events, options

    def test_creator_first_without_audio_or_model(self):
        events, options = self.run_fixture()
        self.assertEqual(events[-1]['track']['kind'], 'manual')
        self.assertTrue(events[-1]['captionsOnly'])
        self.assertTrue(options[0]['skip_download'])
        self.assertNotIn('PRIVATE', str(events))
        self.assertNotIn('timedtext', str(events))

    def test_original_automatic_second(self):
        self.info['subtitles'] = {}
        events, _ = self.run_fixture()
        self.assertEqual(events[-1]['track']['kind'], 'automatic')

    def test_translated_track_is_not_source(self):
        self.info['subtitles']['de'][0]['url'] += '&tlang=de'
        self.info['automatic_captions'] = {}
        with self.assertRaisesRegex(ValueError, 'No matching'):
            self.run_fixture()

    def test_wrong_original_language_is_rejected(self):
        self.info['subtitles']['de'][0]['url'] = 'https://www.youtube.com/api/timedtext?lang=en'
        self.info['automatic_captions'] = {}
        with self.assertRaisesRegex(ValueError, 'No matching'):
            self.run_fixture()

    def test_explicit_automatic_selection(self):
        events, _ = self.run_fixture(request={**self.request, 'trackId': 'a.de'})
        self.assertEqual(events[-1]['track']['id'], 'a.de')

    def test_translation_uses_separate_stream(self):
        events, _ = self.run_fixture(request={**self.request, 'targetLanguage': 'ar'})
        self.assertEqual([item['state'] for item in events], ['batch_captions', 'batch_translation_captions', 'batch_complete'])

    def test_translation_failure_keeps_original(self):
        events, _ = self.run_fixture(request={**self.request, 'targetLanguage': 'ar'}, translation_fails=True)
        self.assertEqual(events[0]['segments'][0]['text'], 'Hallo Welt.')
        self.assertEqual(events[-1]['state'], 'batch_complete')

    def test_wrong_video_rejected(self):
        self.info['id'] = 'zzzzzzzzzzz'
        with self.assertRaisesRegex(ValueError, 'another video'):
            self.run_fixture()

    def test_non_caption_url_rejected(self):
        self.info['subtitles']['de'][0]['url'] = 'https://evil.example/video.mp4?lang=de'
        self.info['automatic_captions'] = {}
        with self.assertRaisesRegex(ValueError, 'No matching'):
            self.run_fixture()

    def test_live_rejected(self):
        self.info['is_live'] = True
        with self.assertRaisesRegex(ValueError, 'Live captions'):
            self.run_fixture()


if __name__ == '__main__':
    unittest.main()

"""No network, model or media-site requests: reproduce PyAV 19's keyword API."""
import io
import unittest
import wave
from contextlib import contextmanager
from unittest.mock import patch

import av
import numpy as np

import batch_transcribe as worker


def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(np.full(1600, 1024, dtype=np.int16).tobytes())
    return buffer.getvalue()


class PyAvCompatibilityTests(unittest.TestCase):
    @contextmanager
    def pyav19_signature(self):
        real_open = av.open
        calls = []
        # No metadata_errors/**kwargs: Python itself raises the friend's exact
        # TypeError on the old worker. Actual installed PyAV decodes local PCM.
        def native_open(file, mode='r', format=None, options=None, buffer_size=32768):
            calls.append(dict(file=file,mode=mode,format=format,options=options,buffer_size=buffer_size))
            return real_open(io.BytesIO(wav_bytes()), mode='r')
        with patch('av.open', side_effect=native_open), patch.object(worker,'emit'):
            yield calls

    def test_direct_decoder_accepts_native_metadata_api_and_preserves_headers(self):
        source = worker.ResolvedSource(url='https://media.example/clear.mp4',
            headers={'Referer':'https://media.example/watch'},media_kind='media')
        with self.pyav19_signature() as calls:
            audio = worker.decode_source(source,'fixture','de')
        self.assertEqual(audio.size,1600)
        np.testing.assert_allclose(audio,1024/32768)
        self.assertEqual(calls[0]['file'],source.url)
        self.assertIn('Referer: https://media.example/watch',calls[0]['options']['headers'])

    def test_wrapped_hls_decoder_accepts_native_metadata_api(self):
        source = worker.ResolvedSource(url='https://media.example/clear.m3u8',headers={},media_kind='hls')
        inspection = worker.HlsPngTsInspection(segments=[('https://media.example/1.ts',0.1)],
            first_transport_stream=b'fixture-ts',first_payload_bytes=10,wrapper_kind='png-appended-mpegts')
        with self.pyav19_signature() as calls:
            audio = worker.decode_png_wrapped_hls(source,inspection,'fixture','de')
        self.assertEqual(audio.size,1600)
        self.assertEqual(calls[0]['format'],'mpegts')
        self.assertEqual(calls[0]['file'].getvalue(),b'fixture-ts')

    def test_legacy_metadata_tolerance_is_preserved(self):
        sentinel = object()
        with patch('av.open', return_value=sentinel) as opener:
            result = worker.open_media_container('fixture',mode='r',options={'headers':'safe'})
        self.assertIs(result,sentinel)
        opener.assert_called_once_with('fixture',mode='r',options={'headers':'safe'},metadata_errors='ignore')

    def test_unrelated_typeerrors_and_access_errors_are_not_retried(self):
        for error in (TypeError("open() got an unexpected keyword argument 'wrong_option'"),
                      TypeError('invalid argument type'),OSError('HTTP 403')):
            with self.subTest(error=str(error)), patch('av.open',side_effect=error) as opener:
                with self.assertRaises(type(error)) as caught:
                    worker.open_media_container('fixture',mode='r')
                self.assertIs(caught.exception,error)
                opener.assert_called_once()

    def test_installation_keeps_the_tested_decoder_for_faster_whisper(self):
        from pathlib import Path
        requirements = (Path(__file__).parent/'requirements.txt').read_text(encoding='utf-8')
        self.assertIn('av==18.0.0',requirements.splitlines())


if __name__=='__main__':
    unittest.main()

import unittest

from whisperlivekit.timed_objects import ASRToken

from subtitle_lines import split_tokens


class SubtitleLineTests(unittest.TestCase):
    def test_open_tail_is_not_complete(self):
        cues = split_tokens([
            ASRToken(0.0, 0.4, "Das"),
            ASRToken(0.4, 0.8, " ist"),
        ])

        self.assertEqual(len(cues), 1)
        self.assertFalse(cues[0].dub_complete)
        self.assertEqual(cues[0].dub_boundary, "open")

    def test_sentence_punctuation_completes_cue(self):
        cues = split_tokens([
            ASRToken(0.0, 0.4, "Das"),
            ASRToken(0.4, 0.9, " stimmt."),
        ])

        self.assertEqual(len(cues), 1)
        self.assertTrue(cues[0].dub_complete)
        self.assertEqual(cues[0].dub_boundary, "sentence")

    def test_silence_completes_unpunctuated_phrase(self):
        cues = split_tokens([
            ASRToken(0.0, 0.4, "Bis"),
            ASRToken(0.4, 0.8, " morgen"),
        ], finalize_tail=True)

        self.assertTrue(cues[0].dub_complete)
        self.assertEqual(cues[0].dub_boundary, "silence")

    def test_ellipsis_does_not_cut_off_sentence_tail(self):
        tokens = [
            ASRToken(0.0, 0.8, "Menschen, welche von seiner Macht..."),
            ASRToken(0.8, 1.3, " angezogen"),
            ASRToken(1.3, 1.8, " werden."),
        ]
        cues = split_tokens(tokens)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].text, "Menschen, welche von seiner Macht... angezogen werden.")
        self.assertTrue(cues[0].dub_complete)
        self.assertEqual(cues[0].dub_boundary, "sentence")

    def test_soft_limit_does_not_leave_preposition_at_line_end(self):
        tokens = [
            ASRToken(
                0.0,
                3.0,
                "der dem Begriff das Unbekannte inne wohnt und eine ganz bestimmte Art",
            ),
            ASRToken(3.0, 5.6, " von"),
            ASRToken(5.6, 6.0, " Menschen,"),
            ASRToken(6.0, 6.5, " welche"),
        ]
        cues = split_tokens(tokens)
        self.assertEqual(cues[0].text, (
            "der dem Begriff das Unbekannte inne wohnt und eine ganz bestimmte Art"
            " von Menschen,"
        ))
        self.assertEqual(cues[0].dub_boundary, "phrase")
        self.assertFalse(cues[1].dub_complete)

    def test_long_speech_still_produces_bounded_complete_cue(self):
        tokens = [
            ASRToken(index * 0.4, (index + 1) * 0.4, " langeswort")
            for index in range(18)
        ]
        cues = split_tokens(tokens)

        self.assertGreaterEqual(len(cues), 2)
        self.assertTrue(cues[0].dub_complete)
        self.assertEqual(cues[0].dub_boundary, "length")
        self.assertFalse(cues[-1].dub_complete)


if __name__ == "__main__":
    unittest.main()

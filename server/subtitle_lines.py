"""Project-local WhisperLiveKit subtitle line formatting.

WhisperLiveKit's non-diarized full-mode formatter can keep appending committed
word tokens to one line until a Silence object arrives. This adapter preserves
the recognizer's word timestamps while bounding each visible subtitle cue.
"""

from __future__ import annotations

from typing import Iterable

from whisperlivekit.timed_objects import ASRToken, Segment
from whisperlivekit.tokens_alignment import TokensAlignment

MAX_CUE_CHARS = 72
MAX_CUE_SECONDS = 5.5
HARD_MAX_CUE_CHARS = 96
HARD_MAX_CUE_SECONDS = 7.5
SENTENCE_MIN_CHARS = 8
SENTENCE_MIN_SECONDS = 0.7
PHRASE_MIN_CHARS = 28
PHRASE_MIN_SECONDS = 1.5
PHRASE_ENDINGS = (",", ";", ":", "\u2014", "\u2013")
CONTINUATION_WORDS = {
    "aber", "als", "am", "an", "auf", "aus", "bei", "dass", "das",
    "dem", "den", "der", "des", "die", "durch", "ein", "eine", "einem",
    "einen", "einer", "eines", "für", "gegen", "im", "in", "mit", "nach",
    "ob", "oder", "ohne", "sowie", "über", "um", "und", "unter", "von",
    "vor", "weil", "wenn", "wie", "zwischen", "zu", "zum", "zur",
}


def make_cue(tokens: list[ASRToken], *, complete: bool, boundary: str) -> Segment | None:
    cue = Segment.from_tokens(tokens)
    if cue:
        cue.dub_timing = "word-timestamps"
        cue.dub_complete = complete
        cue.dub_boundary = boundary
    return cue


def split_tokens(
    tokens: Iterable[ASRToken],
    *,
    finalize_tail: bool = False,
) -> list[Segment]:
    token_list = list(tokens)
    cues: list[Segment] = []
    current: list[ASRToken] = []
    character_count = 0

    for index, token in enumerate(token_list):
        current.append(token)
        character_count += len(token.text or "")
        duration = max(0.0, (token.end or 0.0) - (current[0].start or 0.0))
        token_text = (token.text or "").strip()
        next_text = (
            (token_list[index + 1].text or "").strip()
            if index + 1 < len(token_list)
            else ""
        )
        token_word = token_text.rstrip(".,!?;:\u2026\u2014\u2013").casefold()
        next_word = next_text.rstrip(".,!?;:\u2026\u2014\u2013").casefold()
        is_ellipsis = token_text.endswith(("...", "\u2026"))
        sentence_boundary = token.has_punctuation() and not is_ellipsis and (
            character_count >= SENTENCE_MIN_CHARS
            or duration >= SENTENCE_MIN_SECONDS
        )
        phrase_boundary = token_text.endswith(PHRASE_ENDINGS) and (
            character_count >= PHRASE_MIN_CHARS
            or duration >= PHRASE_MIN_SECONDS
        )
        soft_limit = character_count >= MAX_CUE_CHARS or duration >= MAX_CUE_SECONDS
        hard_limit = (
            character_count >= HARD_MAX_CUE_CHARS
            or duration >= HARD_MAX_CUE_SECONDS
        )
        awkward_break = (
            token_word in CONTINUATION_WORDS
            or next_word in CONTINUATION_WORDS
        )
        length_boundary = hard_limit or (soft_limit and not awkward_break)

        if sentence_boundary or phrase_boundary or length_boundary:
            boundary = (
                "sentence" if sentence_boundary
                else "phrase" if phrase_boundary
                else "length"
            )
            cue = make_cue(current, complete=True, boundary=boundary)
            if cue:
                cues.append(cue)
            current = []
            character_count = 0

    if current:
        cue = make_cue(
            current,
            complete=finalize_tail,
            boundary="silence" if finalize_tail else "open",
        )
        if cue:
            cues.append(cue)

    return cues


def install_subtitle_line_patch() -> None:
    if getattr(TokensAlignment.get_lines, "_dub_transcript_patched", False):
        return

    original_get_lines = TokensAlignment.get_lines
    original_segment_to_dict = Segment.to_dict

    def segment_to_dict_with_timing(self):
        payload = original_segment_to_dict(self)
        timing = getattr(self, "dub_timing", None)
        if timing:
            payload["timing"] = timing
        if hasattr(self, "dub_complete"):
            payload["complete"] = self.dub_complete
        if hasattr(self, "dub_boundary"):
            payload["boundary"] = self.dub_boundary
        return payload

    Segment.to_dict = segment_to_dict_with_timing

    def get_subtitle_lines(self, *args, **kwargs):
        result = original_get_lines(self, *args, **kwargs)
        segments, diarization_buffer, translation_buffer = result
        diarization = kwargs.get("diarization", args[0] if args else False)
        translation = kwargs.get("translation", args[1] if len(args) > 1 else False)
        if diarization or translation:
            return result

        refined: list[Segment] = []
        for index, segment in enumerate(segments):
            if segment.is_silence():
                refined.append(segment)
                continue

            matching_tokens = [
                token
                for token in self.all_tokens
                if not token.is_silence()
                and token.start is not None
                and token.end is not None
                and token.start >= (segment.start or 0.0) - 0.001
                and token.end <= (segment.end or 0.0) + 0.001
            ]
            next_is_silence = (
                index + 1 < len(segments)
                and segments[index + 1].is_silence()
            )
            refined.extend(
                split_tokens(matching_tokens, finalize_tail=next_is_silence)
                if matching_tokens
                else [segment]
            )

        return refined, diarization_buffer, translation_buffer

    get_subtitle_lines._dub_transcript_patched = True
    TokensAlignment.get_lines = get_subtitle_lines

# Experiment matrix

The transcript input is always the audio that is actually playing. Platform captions are collected separately and used only as a possible reference.

## Test order

| Stage | Video/audio | Caption choice | What the result means |
|---|---|---|---|
| 1 | Public YouTube video with German speech | German captions that closely follow the spoken words | Valid first accuracy and timing benchmark |
| 2 | Same YouTube sample, repeat run | Same captions | Measures run-to-run stability and latency |
| 3 | German dub of non-German material | German subtitles translated from the original track | Deliberately demonstrates dub/subtitle divergence; WER is not an ASR accuracy score |
| 4 | German speech without captions | None; manually verify three one-minute samples | Tests the real target case |
| 5 | Legal public HTML5 players | Same-language captions where available | Tests whether the generic tab-capture path works beyond YouTube |
| 6 | Official, freely available anime video | Same-language captions if they represent the dub | Anime-specific vocabulary, music, effects, and overlapping voices |

Netflix and other DRM subscription services are not in this phase. They add protected-media behavior and contractual questions without improving the ASR experiment itself.

## Fixed conditions

- Start with the `small` Whisper model, the `localagreement` policy, and German forced as the audio language.
- Use normal playback speed, then repeat one sample at 0.75× and 1.25×.
- Test at least 10 minutes per source. Include music, silence, and two-speaker dialogue.
- Record the same hardware and model for every comparison.
- Do not call translated subtitles “ground truth” when their words differ from the dub.

## Pass/fail checks

- Audio remains audible after tab capture starts.
- The on-video transcript appears within a tolerable delay.
- Pause produces no new transcript time.
- Rewinding into cached coverage shows old transcript and does not transcribe again.
- Seeking to an uncached time creates a new epoch aligned to that video time.
- Export contains ASR and caption streams separately.
- Reloading the page ends the active capture cleanly; a new experiment can then be started.

## Measurements

- Word error rate only for same-language, verbatim-like captions.
- Median difference between caption and ASR segment starts.
- Caption timeline coverage by ASR segments.
- Observed display latency and obvious hallucinations during silence, recorded manually for now.

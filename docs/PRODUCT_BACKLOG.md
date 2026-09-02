# Product backlog

This file preserves requested product ideas and their historical implementation
status. An item listed as implemented still requires the current-version
regression evidence defined in
[REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md); source code or an older
checkpoint alone is not proof that the browser interaction still works.

For priority, dependencies, phases, and future work, use
[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Historically implemented in extension 0.8.0

- Reorganized the word card into meanings, paired examples, combinations, grammar, and related-word sections. Empty dictionary sections are hidden.
- Added **Replay clip** using exact batch word timestamps or a clearly identified cue-based estimate. The original media time, pause state, and playback rate are restored.
- Added **YouGlish**, opening the selected word in the public German pronunciation route.
- Saved-word entries now retain context, definitions, examples, source video identity, and available audio timing.

- Added one-click UTF-8 text download of the most recent transcript.
- Completed transcripts are stored under stable platform/page identity plus audio language and restored automatically.
- Structured cues and optional word timestamps remain in storage; text is generated only for download.
- The popup lists saved transcripts and supports TXT export and deletion.
- The library is browser-local, capped at 20 records and roughly 7.5 MB, and excludes signed media URLs, headers, cookies, and secrets.

## Still deferred

- A larger searchable library page and an explicit **Open video** action for old transcripts.
- User-selected filesystem folders or companion-service persistence beyond browser storage.
- AI-generated B1 simplification or B2 tutoring. The current card deliberately uses only source-backed dictionary data.
- Optional forced alignment for tighter word-audio boundaries beyond
  Faster-Whisper timestamps. This would require a measured model/dependency
  decision and is not part of the compact replay/blur change.

## Next bounded interaction update

- Keep the existing word replay and add replay of the current recognized
  sentence. When only a phrase/caption boundary is known, label it honestly.
- Tighten exact word replay by removing the current broad fixed padding and
  clamping small playback handles against adjacent word boundaries.
- Preserve the current smaller translation default: 21 px translation versus
  31 px transcript.
- Add one translation preference, **Blur until hover**, with a fixed visual blur
  and hover/focus/touch reveal. Do not add a strength slider or another modal.
- Preserve text selection, word click, caption dragging, playback restoration,
  settings reset/persistence, cache replay, and generic-player support.

## YouTube caption-first and saved-word update

- Prefer an eligible original YouTube automatic transcript before downloading
  audio for local ASR. Never use a YouTube-translated track as the spoken
  transcript, and keep manual subtitles evaluation-only by default.
- Translate the selected original cue through the existing translation provider
  and persistent cache rather than using YouTube auto-translation.
- Keep a compact **Local audio transcription** override for comparison and
  timing diagnosis.
- Measure the reported YouTube ASR timing issue as constant offset, drift,
  grouping, wrong-source, or cache mismatch before changing timestamps.
- Mark whole-token exact forms of previously saved German words in later source
  transcript cues. Initial scope does not infer lemmas or match inflections.
- Full plan: [YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md](YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md).

## Acceptance notes

- All export and persistence actions must be understandable as a single user action.
- Reopening an already analyzed video must not run transcription again when a compatible complete transcript is available.
- Word-audio replay must not permanently seek, pause, or change the playback rate of the video.
- No signed media URLs, cookies, DRM material, or API secrets may be stored in the transcript library.

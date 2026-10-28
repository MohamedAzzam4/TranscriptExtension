# Product backlog

This file preserves requested product ideas and their historical implementation
status. An item listed as implemented still requires the current-version
regression evidence defined in
[REGRESSION_TEST_PLAN.md](REGRESSION_TEST_PLAN.md); source code or an older
checkpoint alone is not proof that the browser interaction still works.

For priority, dependencies, phases, and future work, use
[DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## Historically implemented in extension 0.8.0

- 0.11.4 candidate: clickable saved vocabulary opens the same full word card
  within Words, with list/review state, removal and Return to source. Local
  regression passes; browser acceptance unverified. See
  `test-results/0.11.4-saved-word-review.md`.

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

- Measured 0.11.1 dictionary gaps: `noch` child senses/example links; `durch`
  maintenance cleanup; `gegen` case annotation; `werden` auxiliary/participle
  variants; ambiguous `wegen` scope. Retain features pending the user's decision.
  User subsequently reports normal-browser translation setup works; exact
  cold-download/background conditions remain unspecified. See the0.11.2 UI
  report and0.11.1 expanded evaluation (one prior reserve consumed).

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

- 2026-10-28 approved/candidate0.12.0: retrieve automatically on each YouTube
  video when enabled; creator-provided spoken-language subtitles first, original
  automatic transcript second. Browser adapter first, subtitle-only local yt-dlp
  fallback second. Never use a YouTube-translated track as source speech.
- YouTube auto-translation first (optional), then the existing browser/configured
  Cloud provider. Preserve source and target track/timing provenance in caches.
- Missing captions show an error/retry; **Local audio transcription** is an
  explicit source mode, never an automatic failure fallback on YouTube.
- Player transcript button provides source-track, translation and appearance
  settings shared with the popup. Word highlighting (default on) and pause on
  hover (default off) apply across supported sites. Candidate local checks pass;
  live YouTube/browser acceptance remains unverified.
- Measure the reported YouTube ASR timing issue as constant offset, drift,
  grouping, wrong-source, or cache mismatch before changing timestamps.
- Mark whole-token exact forms of previously saved German words in later source
  transcript cues. Initial scope does not infer lemmas or match inflections.
- Full plan: [YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md](YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md).
  Current approved scope: [YOUTUBE_CAPTIONS_IMPLEMENTATION.md](YOUTUBE_CAPTIONS_IMPLEMENTATION.md).

## User-requested Terra UI corrections (2026-10-25)

- Word-card headings contain direct meaning in the selected target language,
  with dictionary-backed alternative meanings underneath. English is not a
  forced display language; Arabic follows the same provider contract.
- Keep the German dictionary definition first and translate that exact
  definition into the target language. Grammatical form notes are secondary,
  not meanings. Follow an explicitly named dictionary lemma once when needed;
  do not invent definitions for placeholders or missing entries.
- Highlight the selected German word and matching target words/phrases in
  translated examples. Keep unmatched paraphrases unmarked.
- Blend the card scrollbar with the glass theme. Outside pointer actions close
  the card without cancelling site/player actions, including parent-frame
  clicks for embedded players.
- Keep video titles compact. Pin the scaled caption preview while settings
  scroll, and group Transcript, Translation, and Caption box into collapsible
  containers with larger bold summaries. Only Transcript starts open.
- Source changes are a candidate; automated/provider/browser/upgrade checks
  after these corrections are deferred at the user's request.

## German-only learning decisions (supersede earlier card sourcing)

- German Wiktionary is the sole active dictionary source. Do not use English
  Wiktionary content, English glosses as a bridge, displayed grammatical roles,
  or usage notes. Keep source-explicit case/government separate from meanings;
  retain verb base form and conjugations alongside it.
  This follow-up supersedes the earlier verb-only grammar wording; see
  [`WORD_CARD_FOLLOWUP_PLAN.md`](WORD_CARD_FOLLOWUP_PLAN.md).
- German definitions remain separate senses, translated individually directly
  into the chosen target. Whole German examples use the same direct route.
- Keep one concise example visible by default, with further source content
  expandable. German example occurrences of the selected form are marked.
- Per translated example, deduplicate candidates and count distinct matches
  before rendering: zero or two-plus gives no mark; exactly one marks every
  occurrence of that candidate. Do not claim semantic alignment.
- Chrome's built-in on-device Translator is primary; show availability and
  language-pack download progress. Google Cloud is a fallback only with a
  configured key and a policy that allows it. Cache provenance must remain
  honest and cannot bypass the chosen policy.
- Use browser German pronunciation with local or online voices, prefer de-DE,
  wait for voice-list changes and block other-language fallback. This supersedes
  the earlier Windows/local-only voice requirement. Restore last popup view/scroll/groups/search
  and edits, highlight the currently spoken source word using timing metadata,
  and place diagnostics directly beneath the Home video card.
- Preserve existing saved records and source context without using legacy
  English fields as new card evidence. Keep selection, save/remove, YouGlish,
  replay restoration, dragging, cached transcripts, and embedded players.
- Implementation scope and evidence requirements are in
  [GERMAN_ONLY_LEARNING_IMPLEMENTATION_PLAN.md](GERMAN_ONLY_LEARNING_IMPLEMENTATION_PLAN.md).
  Testing remains paused; the implementation report distinguishes source
  changes from unverified runtime behavior.

## Acceptance notes

- All export and persistence actions must be understandable as a single user action.
- Reopening an already analyzed video must not run transcription again when a compatible complete transcript is available.
- Word-audio replay must not permanently seek, pause, or change the playback rate of the video.
- No signed media URLs, cookies, DRM material, or API secrets may be stored in the transcript library.

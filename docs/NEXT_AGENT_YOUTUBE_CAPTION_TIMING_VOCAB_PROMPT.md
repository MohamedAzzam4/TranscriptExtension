# Prompt for the next coding agent

You are implementing a bounded prototype update for **Dub Transcript Lab** in
the repository `MohamedAzzam4/TranscriptExtension`.

Read `AGENTS.md` completely before acting. Then read:

- `docs/YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/REGRESSION_TEST_PLAN.md`
- `docs/FEATURE_REGISTRY.md`
- `docs/UI_INTERACTION_CONTRACTS.md`
- `docs/PRODUCT_BACKLOG.md`
- `experiments/TEST_MATRIX.md`
- `experiments/PHASE1_MANUAL_CHECKLIST.md`
- `experiments/PHASE2_MANUAL_CHECKLIST.md`

The authoritative **implementation-code** base is commit `c30d417` on
`origin/codex/local-media-loopback`, extension/worker version 0.10.4. The tip
of that remote branch may also contain a newer documentation-only planning
commit with this prompt and its companion plan.

## Isolation and safety

1. Fetch the repository, verify that `c30d417` exists, and inspect the current
   tip of `origin/codex/local-media-loopback`. Confirm that every commit after
   `c30d417` changes documentation only. Stop and report the difference if
   runtime source, tests, binaries, or version metadata changed.
2. Create a separate Git worktree and branch named
   `codex/youtube-caption-first-vocab` from the verified documentation-only tip
   of `origin/codex/local-media-loopback`. Do not implement in the user's dirty
   primary checkout. Treat `c30d417` as the behavioral/code baseline.
3. Record `git status --short`, the base commit, branch, browser/Windows details
   available to you, and the pre-change regression result.
4. If the shared environment is needed for tests, reference or junction the
   existing `.venv` without modifying its packages. Never copy, delete, stage,
   or regenerate `.venv`, `.runtime`, `.model-cache`, logs, or downloaded models.
5. Do not touch or stage the existing modified `server/native-host.exe`,
   `.opencode/`, or old ZIP archives. Do not modify generated binaries for this
   task.
6. Do not automate YouTube, AniWorld, AnimeKai, Netflix, or another user website.
   Automated tests may use deterministic fixtures. Give the user the manual
   browser checklist when their participation is required.
7. Before editing, run `RUN-REGRESSION.cmd` or
   `scripts/run-regression.ps1`. Record any baseline failure instead of
   attributing it to your changes.

## Required outcomes

Implement the following in sequence. Do not skip the source-provenance contract
to make caption reuse appear simpler.

### 1. Source-honest transcript selection

Introduce an explicit `transcriptSource` object and a deterministic
`selectedTranscriptSegments(experiment)` helper.

- Actual recognized audio remains in `asrSegments`.
- Platform captions remain in `captionSegments`.
- When `transcriptSource.kind === "youtube-auto-caption"`, rendering, completion,
  TXT export, cache/library storage, and replay use `captionSegments`.
- Otherwise those consumers use `asrSegments`.
- Add `purpose`, provider, language, track kind/name when safe, timing
  provenance, and ASR model/device only when applicable.
- Old schema-v4 experiments without this field are read as
  `legacy-local-asr`.
- Preserve library schema-v1 reads. If you introduce library schema v2, migrate
  idempotently, preserve old data until the new record succeeds, and add
  upgrade tests.
- Caption reuse must set `captionsUsedAsInput: true` and must not claim audio
  coverage, audio decoding, or Whisper inference.
- Do not duplicate caption cues into `asrSegments`.

Add characterization tests before replacing lifecycle assumptions. Search all
uses of `asrSegments`; do not update only the renderer while leaving exports,
completion, cache, evaluation, or the library inconsistent.

### 2. YouTube original automatic transcript first

Add a normalized setting with two values:

- `youtube-auto-first` — default;
- `local-asr` — explicit bypass for comparison and timing tests.

Expose it compactly in advanced settings. Keep **Analyze automatically** as the
primary one-click action and update popup binding/default/migration tests.

Create a new pure selector for playback input; do not silently change the
existing manual-first evaluation selector.

The playback selector may accept a YouTube track only when:

- it is from yt-dlp `automatic_captions`;
- it is demonstrably the original/source automatic track, preferring exact
  `<requested-language>-orig`;
- its base language matches the selected audio language;
- it is not a YouTube-translated track and its URL does not request `tlang`;
- JSON3 contains valid, monotonic, non-empty timed cues compatible with player
  duration.

Do not accept a translated `de` track originating from English or another
language. Do not treat a manual German subtitle as spoken German merely because
the language code matches. For multi-audio YouTube videos, ambiguity about the
currently selected dub must fall back to local ASR with a visible reason.

On eligible caption reuse:

- do not download audio;
- do not load Faster-Whisper;
- emit source-specific progress/status messages;
- deliver normalized JSON3 cues through the normal transcript renderer;
- make evaluation against the same input track `not-applicable`;
- record full-track completion without populating `audioCoverage`;
- suppress duplicate native YouTube captions only for the active reused-caption
  session and restore their previous visibility on stop/failure/navigation;
- preserve selection, clickable words, saved vocabulary, replay estimates,
  dragging, appearance settings, translation, cache replay, and exports.

If selection, download, parsing, validation, or language certainty fails, use
the existing YouTube local batch-ASR path. Do not jump directly to live mode
unless local batch ASR also fails under the existing policy.

### 3. Translate reused captions ourselves

Pass the selected original-language cue to the existing translation pipeline.
Never request YouTube's auto-translated caption track.

- Preserve the current browser-first/optional Google provider policy.
- Translation failure leaves the original cue intact.
- Persistent translation cache identity must include exact normalized source
  text, source language, and target language; preserve provider metadata.
- Rewind, seek, and reopen must reuse cached translations when compatible.
- Do not send text anywhere when translation is disabled.

### 4. Instrument the YouTube local-ASR timing problem

Version 0.10.4 did not modify the YouTube clock or decode pipeline. Do not state
that it caused the timing issue without evidence.

In `local-asr` mode, add sanitized diagnostics and technical-export fields for:

- yt-dlp format ID, extension, audio codec, sample rate, language, and duration;
- player duration;
- container/stream start time and time base;
- first decoded audio-frame PTS, decoded sample count and duration;
- first/last ASR word and raw cue times;
- first/last display-group times;
- reference-caption median offset/error data when a valid reference exists;
- manual `syncOffset` separately from any pipeline correction.

Never persist the resolved/signed audio URL, headers containing secrets, media
bytes, compressed audio, or PCM.

Use deterministic fixtures to distinguish:

- constant offset;
- progressive drift;
- correct raw words but wrong display grouping;
- wrong audio/language;
- fresh-run versus cache-only mismatch.

Do not implement a speculative universal offset. If you have no real
beginning/middle/end evidence, ship the instrumentation as an experimental
candidate and report the timing correction as **Needs development**. Ask the
user to force local ASR on one short German YouTube video, inspect cues near the
beginning/middle/end, and export technical JSON.

Only implement a timing correction in this branch if the cause is reproducible
and the correction has tests proving it does not create drift or damage cached
timing. Keep the user's manual sync offset independent and applied last.

### 5. Mark saved words in later videos

At session start, load saved vocabulary once into a normalized `Set`. Use the
existing `learning.normalizedWord` function for both stored entries and rendered
tokens.

- Mark whole-token exact saved forms in the German/source transcript.
- Matching is case-insensitive and Unicode-normalized.
- Do not mark substrings; saved `in` must not mark `finden`.
- Do not mark the English translation line.
- Do not claim lemma or inflection matching. `gehen` and `ging` are different
  unless both forms were saved.
- Mark every occurrence in the visible cue.
- Saving/removing a word updates the current cue immediately, and a new tab or
  session loads the latest saved set.
- Use a restrained visual marker plus a non-color signal such as an underline.
- Preserve text selection/copy, word click, keyboard activation, focus, replay,
  and caption dragging. A marker is not a new click target.
- Do not call Wiktionary, translation, or AI merely to determine saved status.

Add unit tests for case, Unicode normalization, punctuation, multiple
occurrences, substring rejection, save/remove refresh, caption input, batch/live
ASR, and cache replay.

## Required testing

Run and record:

1. All JavaScript syntax checks and every `extension/test-*.mjs` suite.
2. Every Python server unit test.
3. `git diff --check`.
4. Old experiment/library fixtures plus any schema migration tests.
5. Lifecycle tests for eligible caption reuse, translated-track rejection,
   empty/invalid caption fallback, forced local ASR, caption retrieval failure,
   cache replay, completion, cancellation, and export provenance.
6. Cross-feature tests for translation, selection/copy, word click, save/remove,
   YouGlish, replay, caption dragging, appearance settings, and saved-word marks.
7. Privacy assertions that exports/storage contain no signed URLs, cookies, API
   keys, audio/PCM, or DRM material.

Prepare—but do not automate—the manual checks listed under GATE-1 in
`docs/YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md`.

Caption-first reuse, storage schema, and shared rendering are high-risk changes.
Do not classify the version as **Pass** without the required browser and upgrade
evidence. Use **Experimental** or **Needs development** honestly.

## Scope boundaries

- Preserve YouTube local batch ASR and live fallback.
- Preserve AniWorld, AnimeKai, Netflix, direct MP4/HLS/DASH, and loopback-media
  behavior.
- Preserve all historically protected learning and overlay interactions.
- Do not implement AI definitions, lemma inference, flashcards, Anki, a website,
  accounts, billing, production/SaaS architecture, or unrelated UI redesign.
- Do not refactor acquisition modules unless characterization tests make the
  behavior observable first.
- Do not modify installation, native host, DRM, or model dependencies for this
  task.

## Version, evidence, and Git checkpoint

- Use version 0.10.5 only after implementation and automated tests pass.
- Update the manifest, visible version, worker version, roadmap, feature
  registry, backlog, test matrix, README, and a new version evidence record.
- Commit only intended source, tests, and documentation.
- Push `codex/youtube-caption-first-vocab` to `origin`.
- Do not merge it into another branch.

## Mandatory honest final report

Your final report must include:

- base commit, worktree path, branch, final commit, and push result;
- exact files changed and why;
- exact source-selection rules implemented;
- old-record migration behavior;
- proof that caption reuse skipped audio download and Whisper loading;
- all test commands, counts, and failures;
- manual checks not performed;
- whether YouTube ASR timing was diagnosed, merely instrumented, or corrected;
- evidence supporting any timing correction;
- saved-word matching limitations, especially inflections;
- privacy review result;
- protected features checked and any remaining regression risk;
- final classification: **Pass**, **Experimental**, or **Needs development**.

Never claim a browser behavior was tested if you only inspected code or ran a
fixture. Never describe an unresolved timing complaint as fixed.

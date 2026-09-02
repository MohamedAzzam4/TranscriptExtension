# YouTube caption-first, timing, and saved-word plan

## Purpose

This is a planning document only. It does not authorize a production rewrite
or claim that the current YouTube timing issue has been diagnosed.

The requested outcomes are:

1. Prefer YouTube's own **original automatic transcript** when it represents
   the selected audio language, then translate that text through Dub Transcript
   Lab's existing translation providers.
2. Preserve local Whisper as an explicit fallback and diagnostic option, and
   determine why its YouTube timestamps can appear misaligned before applying
   a correction.
3. Mark previously saved German words whenever their exact normalized forms
   occur in later transcript cues, regardless of whether the cue came from
   YouTube captions, local batch ASR, live ASR, or the transcript cache.

The bounded work maps to roadmap WP3.1 (source/timing provenance), WP3.2
(synchronization), WP3.4 (caption reuse), WP1.3 (saved vocabulary), and the
WP1.6/Phase 3 regression gates.

## Current facts established from source and history

- Version 0.10.4 is at commit `c30d417` on
  `codex/local-media-loopback`.
- The current YouTube adapter already downloads a matching caption track, but
  only as an evaluation answer key. It always performs local audio ASR for the
  displayed transcript.
- Current caption selection checks manual tracks before automatic tracks. That
  policy must not be reused for caption-first playback because a manual
  subtitle can be adapted or translated and may not match the spoken dub.
- `parse_youtube_json3` already converts YouTube JSON3 events into timed cues
  and estimated per-token intervals. It can be reused after source selection is
  made stricter and provenance is preserved.
- Translation is already source-agnostic at render time. Stable YouTube cues
  can use the existing browser/Google translation path and its persistent cache;
  YouTube's auto-translated caption tracks must not be used.
- Experiments currently assume `asrSegments` is the displayed and reusable
  transcript, while `captionSegments` is evaluation-only. Caption reuse must
  introduce an explicit selected-transcript source rather than relabel captions
  as ASR.
- Saved vocabulary is stored as at most 2,000 normalized entries. Transcript
  words are already tokenized into individual interactive spans, so highlighting
  can use the existing normalization contract without dictionary or AI calls.
- The 0.10.4 checkpoint did not change YouTube ASR cue timestamps, the
  `video.currentTime - syncOffset` clock, or the YouTube download/decode path.
  It changed same-origin loopback authorization and root-page overlay
  placement. Therefore the timing complaint must be reproduced and measured;
  it must not be attributed to 0.10.4 without evidence.

## Product decisions

### Default source policy

Add one compact YouTube-only preference:

- **YouTube transcript first** — default. Reuse an eligible original automatic
  track. Fall back to local audio transcription when no trustworthy track is
  available or retrieval fails.
- **Local audio transcription** — bypass caption reuse. This preserves a user
  choice for accuracy comparisons and provides the required timing diagnostic
  path.

Keep **Analyze automatically** as the one-click primary action. Do not add a
modal, a second setup flow, or a provider dashboard.

### Eligible YouTube track

A track is eligible only when all of the following are true:

- It comes from yt-dlp's `automatic_captions` field, not `subtitles`.
- It is the original/source automatic track, preferably the exact
  `<requested-language>-orig` key.
- Its base language matches the extension's selected audio language.
- The metadata is sufficient to distinguish it from a YouTube-generated
  translation. If original-language identity is ambiguous, fall back to local
  ASR and display the reason.
- The JSON3 payload is non-empty, has valid monotonic cue times, and its final
  timing is compatible with the player duration.

Do not accept a plain `de` automatic track merely because its key is German if
the source track is known to be another language. Do not use a URL containing a
YouTube translation request such as `tlang`. Language equality alone is not
proof that a manual subtitle represents the spoken dub.

For YouTube videos with multiple dubbed audio tracks, reuse is allowed only
when the available metadata can establish that the automatic transcript belongs
to the audio language the user selected. Ambiguity must produce local ASR, not
a confident but potentially wrong transcript.

### Source-honest experiment contract

Add an explicit `transcriptSource` record and a pure
`selectedTranscriptSegments(experiment)` helper:

- `kind`: `youtube-auto-caption`, `local-whisper-batch`,
  `local-whisper-live`, or `legacy-local-asr`;
- `provider`: `youtube`, `faster-whisper`, or `whisperlivekit`;
- `language` and optional original track language/name;
- `purpose`: `transcript-input` or `recognized-audio`;
- timing provenance: platform cue, exact recognized word, or estimated word;
- model/device only when ASR actually ran.

Keep actual recognition in `asrSegments`. Keep platform cues in
`captionSegments`. The helper selects `captionSegments` only when the declared
source is `youtube-auto-caption`; otherwise it selects `asrSegments`. Never copy
YouTube captions into `asrSegments`.

Old schema-v4 experiments without `transcriptSource` are interpreted as
`legacy-local-asr`, because captions were not previously used as input. Library
schema v1 records remain readable. A new library record stores the source
metadata with its selected segments and does not destroy an older record until
the new record has been written successfully.

For caption reuse:

- `captionsUsedAsInput` is true;
- `audioCoverage` remains empty because no audio was decoded;
- transcript completion records that the full platform caption track was
  fetched, rather than claiming that the full audio was analyzed;
- evaluation is `not-applicable` against the same input track;
- visible status says **Using YouTube automatic transcript**;
- diagnostics and TXT/JSON exports retain source provenance;
- native YouTube captions are suppressed only while our reused-caption session
  is active, and their prior visible state is restored on stop, failure, page
  change, and extension reload where practical.

### Translation behavior

The selected original-language cue is passed to the existing translation
pipeline with the declared transcript language. Translation remains optional
and uses the user's selected provider and target language.

- Do not request YouTube auto-translated tracks.
- Cache identity remains based on exact normalized source text, source language,
  and target language. Provider metadata remains stored with the result.
- A stable platform cue may be translated lazily when first displayed; repeated
  playback and reopening should reuse the existing persistent translation
  cache.
- Translation failure must not cause local ASR or replace the original cue.

## Work-package sequence

### YT-0 — Isolated baseline and characterization

**Depends on:** commit `c30d417`.

**Outcome:** Create an isolated worktree/branch, run the complete pre-change
suite, and add characterization fixtures for current YouTube track selection,
experiment storage, library migration, cue rendering, and saved-word behavior.

**Evidence:** Record the base commit, extension/worker version, test counts,
dirty files excluded from the worktree, and unverified browser checks.

### YT-1 — Transcript-source compatibility contract

**Depends on:** YT-0.

**Outcome:** Add `transcriptSource`, `selectedTranscriptSegments`, source-aware
completion/export/library behavior, and backwards-compatible reads. Do not yet
change the default acquisition decision.

**Pass criteria:**

- Legacy experiments and library entries replay unchanged.
- ASR remains in `asrSegments`; platform captions remain in
  `captionSegments`.
- Render, TXT export, cache replay, completion, and diagnostics all select the
  same declared stream.
- Missing or contradictory provenance is rejected or labelled unknown; it is
  never silently called ASR.

### YT-2 — Original automatic-caption reuse

**Depends on:** YT-1.

**Outcome:** Add the default **YouTube transcript first** policy and a local-ASR
override. Fetch and normalize the eligible JSON3 track without downloading
audio or loading Whisper. Retrieval, validation, or language uncertainty falls
back to the existing YouTube batch-ASR path.

**Pass criteria:**

- Eligible original German automatic captions become the selected transcript.
- A translated German track generated from non-German audio is rejected.
- Manual captions remain evaluation-only unless a later explicit feature
  changes that policy.
- Caption reuse never starts audio download or loads Whisper.
- Local-ASR mode still executes the current audio path.
- Status, diagnostics, cache, and exports state exactly which path was used.

### YT-3 — Translation and cache integration

**Depends on:** YT-2.

**Outcome:** Prove reused cues use the existing translation UI/cache and that
complete caption-source transcripts reopen without network ASR work.

**Pass criteria:**

- Original text remains visible when translation is unavailable.
- Translation toggling and appearance controls remain independent.
- Rewind and seek select cues by platform timestamps without retranscription.
- Reopening a compatible cached record preserves source provenance.
- Existing complete ASR caches are not silently overwritten or mislabeled.

### YT-4 — YouTube ASR timing instrumentation and diagnosis

**Depends on:** YT-0. It may be developed beside YT-1–YT-3, but it must be
tested using **Local audio transcription** mode.

**Outcome:** Determine whether the observed problem is a static origin offset,
progressive drift, cue grouping/linger, wrong audio-track selection, or cached
record mismatch.

Add sanitized diagnostics for:

- player duration and current source mode;
- yt-dlp format ID, extension, codec, sample rate, language, and reported
  duration, but never the signed media URL;
- container and audio-stream start time/time base;
- first decoded frame PTS, decoded sample duration, and sample count;
- first/last raw ASR word and cue timestamps;
- first/last display-group timestamps;
- optional YouTube reference-caption median offset and error distribution;
- the stored manual `syncOffset`, kept separate from any pipeline correction.

Classify the evidence:

| Observation | Likely owner |
|---|---|
| Roughly constant difference at beginning/middle/end | timeline origin, encoder delay, or player/source offset |
| Difference grows with elapsed time | sample-rate/time-base drift |
| Raw words align but displayed sentences do not | cue grouping/display windows |
| Wrong words or language | wrong audio representation, not timing |
| Fresh run aligns but cached run does not | cache identity/migration |

No automatic correction may be shipped from instrumentation alone.

### YT-5 — Evidence-driven timing correction

**Depends on:** YT-4 plus at least one reproducible user export with checks near
the beginning, middle, and end. Prefer two videos before generalizing.

**Outcome:** Fix the diagnosed owner with one named timeline transformation.
Preserve the user's manual sync adjustment as an independent final display
offset.

**Pass criteria:**

- A static offset does not become a gradually growing correction.
- Drift is measured against duration, not hidden with a single start offset.
- Cue grouping is not modified when raw word times are already wrong.
- Wrong audio-language selection is fixed as source selection, not compensated
  as timing.
- Fresh and cached playback match at beginning, middle, and end.
- Technical export records both raw timing and the applied correction.

If YT-4 cannot establish a cause, classify YT-5 as **Needs development** and ask
for the precise manual evidence; do not guess.

### VOC-1 — Mark saved words in future transcript cues

**Depends on:** YT-1 and the existing saved-vocabulary normalization contract.

**Outcome:** Load the saved vocabulary once when a session begins, maintain a
normalized `Set`, and add a subtle `saved-word` state to matching source-language
word spans. Apply it to caption reuse, batch/live ASR, and cache replay.

Behavior:

- Match whole tokens using `learning.normalizedWord`; matching is
  case-insensitive and Unicode-normalized.
- Do not use substring matching: saving `in` must not mark the letters inside
  `finden`.
- Initially mark exact saved forms only. Do not claim lemma/inflection matching
  without a German morphology source.
- Mark the German/source transcript, not the translated line.
- Multiple appearances in a cue are all marked.
- Save/remove updates the currently visible cue immediately and later tabs load
  the latest saved set.
- The mark is visually distinct but does not replace selection, focus, current
  word hover, or active replay states.
- Native text selection/copy, word lookup, keyboard activation, and caption
  dragging retain their existing event ownership.
- No dictionary, translation, or AI request is made merely to decide whether a
  token is saved.

**Accessibility:** Use more than color alone, such as a restrained underline or
inset marker, retain readable contrast, and expose “saved word” in the word's
accessible name without making screen-reader output excessively repetitive.

### GATE-1 — Regression, manual evidence, and checkpoint

**Depends on:** every work package included in the candidate.

Run the full automated suite plus upgrade fixtures. The mandatory manual matrix
must include:

1. YouTube with an eligible original German automatic transcript.
2. YouTube whose German option is translated from another source language; it
   must fall back to local ASR.
3. YouTube without eligible captions.
4. Forced local-ASR timing checks near beginning, middle, and end.
5. Fresh run, rewind, middle seek, final cue, page reopen, and cached replay.
6. Translation on/off, provider failure, and cached translation.
7. A saved German word appearing once, multiple times, with capitalization,
   and as a substring of an unsaved longer word.
8. Selection/copy, word click, save/remove, YouGlish, word replay, caption drag,
   appearance controls, and TXT/JSON export.
9. YouTube normal, theater, and fullscreen layouts.
10. Regression smoke tests on one AniWorld/AnimeKai clear-media path and the
    0.10.4 loopback MP4 path, because shared lifecycle/rendering code changes.

Inspect exports for cookies, API keys, signed URLs, media bytes, DRM material,
and PCM. Do not automate the user's websites; provide a short checklist and ask
the user to perform the real browser tests.

## Recommended checkpoint split

### Candidate 0.10.5

Implement YT-0 through YT-4 and VOC-1. This can deliver caption-first reuse,
translation integration, source-honest caching, saved-word marks, and the data
needed to diagnose forced-ASR timing. Label timing **unresolved** unless evidence
already proves and validates a correction.

### Candidate 0.10.6

Implement YT-5 only after reviewing beginning/middle/end evidence from forced
local ASR. This keeps a guessed timing adjustment out of the otherwise useful
caption-first and vocabulary release.

## Non-goals

- Do not use YouTube auto-translation as the transcript or translation source.
- Do not assume manual subtitles match a dub.
- Do not remove local Whisper, live fallback, caption comparison, manual sync,
  or generic embedded-player support.
- Do not implement lemma inference, AI vocabulary analysis, a website,
  flashcards, Anki, accounts, billing, or SaaS infrastructure in this work.
- Do not alter DRM handling, Netflix acquisition, installer behavior, model
  files, `.venv`, `.runtime`, or native-host binaries unless a failing test
  proves a direct dependency and the user approves the scope change.


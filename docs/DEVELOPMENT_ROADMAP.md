# Development roadmap

## Purpose

This roadmap preserves the product direction and the sequence of work while Dub
Transcript Lab is still validating its core idea. It is not permission to start
all listed work. Each phase begins only when the previous phase's gate passes
and the user chooses to continue.

The current priority is evidence and core reliability. Production refactoring,
SaaS infrastructure, the learning website, flashcards, and Anki integration are
deliberately last.

## Product outcome

For a video the user is authorized to watch, the extension should:

1. use matching captions when they genuinely represent the selected audio;
2. otherwise acquire or capture the selected audio and transcribe it with a
   chosen provider;
3. display synchronized, reusable bilingual captions inside the player;
4. preserve natural text selection and word-learning interactions;
5. remember complete and partial work honestly; and
6. provide enough visible evidence to explain every acquisition or fallback
   decision.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Pass** | All mandatory acceptance checks and regressions passed on the defined test matrix, and evidence was recorded. |
| **Experimental** | The bounded experiment worked, but catalogue/platform coverage is insufficient for a product guarantee. |
| **Needs development** | A required check failed, a historical feature regressed, data was misclassified, or required evidence is missing. |
| **Blocked** | An external access, legal, platform, hardware, or user-action dependency prevents the check. This is not a pass or failure. |

One successful title never establishes platform-wide support. Source code
presence, a log message, or an old result also does not count as current proof.

## Historical checkpoints and protected behavior

These commits are development memory, not proof that the behavior still passes:

| Commit | Historical purpose | Protected contract to regression-test |
|---|---|---|
| `923d8c9` | Initial experiment baseline | Live capture, epochs, cached rewind, caption comparison, technical export |
| `ea1379c` | Bilingual learning captions | Translation below transcript, clickable words, saved vocabulary, appearance controls |
| `64875b8` | Draggable caption refinement | Caption dragging and word card positioned above the overlay |
| `643eab4` | Beginner setup | Installer, setup check, local recognizer registration and startup |
| `1546662` | Local learning and library | Word card, YouGlish, clip replay, TXT export, complete transcript cache |
| `7b10270` | Netflix research collector | Privacy-safe per-title reports and aggregate dataset export |

The following are especially important user-reported regression risks:

- transcript and translation can be selected and copied naturally;
- a click that is not a text selection opens word analysis;
- the word card provides definitions/examples and can save the word;
- YouGlish opens German usage for the selected word;
- replay seeks to the exact known word interval and restores playback state;
- captions can be dragged with the mouse;
- generic and embedded video players remain supported;
- complete cached transcripts replay without recognition, while partial live
  sessions do not pretend the whole title is complete.

## Dependency map

```text
Phase 0 evidence baseline
  -> Phase 1 acquisition and caption-source decisions
     -> Phase 2 transcript timing, coverage, and durable history
        -> Phase 3 transcription-provider abstraction
           -> Phase 4 learning overlay and UI/UX refactor
              -> Phase 5 production/SaaS hardening
                 -> Phase 6 learning website, flashcards, and Anki
```

An isolated research branch may explore a later WP, but it cannot redefine an
earlier contract or be merged as a release without the earlier phase gate.

## Phase 0 — Evidence baseline and regression protection

### WP0.1 — Canonical feature registry

**Depends on:** none.

**Outcome:** Convert historical claims into a versioned registry of critical
features, their automated tests, manual checks, last known result, and source
checkpoint.

**Pass criteria:**

- Every protected behavior above has a test or a clearly named manual check.
- Current behavior is labelled passed, failed, or unverified; nothing is assumed.
- Each future change can identify which feature contracts it touches.

### WP0.2 — Reproducible media corpus

**Depends on:** WP0.1.

**Outcome:** Maintain legal or user-authorized reference samples for YouTube,
clear MP4, HLS, DASH, embedded players, live-only playback, matching captions,
non-matching translated subtitles, silence, music, and multi-speaker dialogue.
Netflix catalogue samples contain sanitized reports and measurements, not media.

**Pass criteria:**

- Samples cover batch, live, caption-reuse, cache, seek, partial-coverage, and
  failure paths.
- Expected duration/language/role/caption relationship is documented.
- Private URLs, credentials, and DRM material are absent from fixtures.

### WP0.3 — Version regression runner

**Depends on:** WP0.1 and WP0.2.

**Outcome:** One documented command runs unit, lifecycle, schema, privacy, and
fixture tests; a manual checklist covers browser-only interactions.

**Pass criteria:**

- A deliberately broken historical feature makes the suite fail.
- Results identify the affected contract rather than only a generic exception.
- Upgrade tests preserve settings, vocabulary, transcripts, and model/runtime
  folders.

### WP0.4 — Baseline gate

**Depends on:** WP0.1–WP0.3.

**Outcome:** Establish the first trustworthy comparison point for all later
versions.

**Pass criteria:** Critical tests pass, known failures are documented, results
are committed, and the checkpoint is pushed. A known critical regression keeps
the phase in **Needs development**.

## Phase 1 — Audio acquisition and caption-source decisions

### WP1.1 — Netflix catalogue research dataset

**Depends on:** WP0.2.

**Outcome:** Use the existing research button to collect a diverse, sanitized
dataset before making further decoder assumptions.

**Required dimensions:**

- movie versus series episode;
- different release periods and durations;
- normal dub versus audio description;
- German SDH/CC, standard German subtitles, and no German subtitle;
- subtitle wording likely matching, uncertain, or likely adapted;
- codec/profile/sample entry, representation count and bitrate;
- protected, apparently clear, partial-range, complete-range, browser-supported,
  and unsupported configurations;
- first run, repeated run, page reload, title switch, and Windows restart.

**Initial evidence gate:** At least 24 title observations across multiple series
and films, with repeated runs for every observed codec/configuration cluster.
This number establishes an experiment dataset, not a guarantee about Netflix's
whole catalogue.

**Pass criteria:** Reports contain the requested metadata when exposed, use
`unknown` instead of guessing, redact sensitive data, and can explain each
success/failure cluster.

### WP1.2 — Netflix acquisition decision engine

**Depends on:** WP1.1.

**Outcome:** Choose a known working representation/decoder path from observed
evidence and fall back safely for unknown configurations.

**Pass criteria:**

- Every configuration cluster in the research corpus has a deterministic
  decision and visible reason.
- Partial downloads and mid-stream codec changes are not reported as success.
- Unknown/protected configurations use live decoded-tab audio without attempting
  DRM bypass.
- A success on one title does not create a global cache that corrupts another.

### WP1.3 — Generic and embedded-player acquisition

**Depends on:** WP0.2; may run in parallel with WP1.1.

**Outcome:** Preserve public YouTube, clear MP4/HLS/DASH, and user-authorized
embedded-player/AniWorld-style support without provider-specific regressions.

**Pass criteria:**

- The selected audible player and language are identified.
- Cross-origin frames are discovered where extension permissions allow.
- Multiple mirrors are ranked and retried without mixing audio or duplicating
  transcript coverage.
- Clear media may use batch mode; inaccessible media uses audible live capture.
- No CAPTCHA, authentication, paywall, DRM, or access control is bypassed.

### WP1.4 — Matching-caption reuse

**Depends on:** WP1.2 or WP1.3 for platform metadata, plus the Phase 2 cue
contract before release.

**Outcome:** When captions are demonstrated to match the selected audio, fetch
and normalize them instead of transcribing, hide the website's duplicate
captions, and render them through Dub Transcript Lab so learning features remain
available.

**Pass criteria:**

- Language equality alone is never treated as proof of wording equality.
- Match confidence comes from explicit track semantics or a representative
  audio/caption comparison, with a user override.
- Website captions are restored when the extension stops or fails.
- Normalized cues pass the same timing, cache, selection, and word-interaction
  contracts as ASR cues.

### Phase 1 gate

Pass only when every acquisition path has a visible source label, deterministic
fallback, sanitized diagnostics, and regression results across the corpus.

## Phase 2 — Transcript correctness, timing, and durable local history

### WP2.1 — Canonical cue and word-timing contract

**Depends on:** Phase 1 source types being enumerated.

**Outcome:** One schema represents batch ASR, live ASR, reused captions,
translations, word timestamps, confidence/provenance, and revisions.

**Pass criteria:** No renderer or cache guesses whether time is exact,
estimated, provisional, or finalized.

### WP2.2 — Playback synchronization and sentence segmentation

**Depends on:** WP2.1.

**Outcome:** Correct pause, seek, rewind, playback-rate, sentence-boundary, and
caption replacement behavior.

**Pass criteria:**

- Pause creates no new media-time coverage.
- Cached rewind never retranscribes covered audio.
- Seeking to uncovered audio creates an independently anchored epoch.
- Captions do not flood the screen or display a stranded mid-sentence word when
  a stable sentence grouping is available.
- Sync and segmentation remain correct after reopening a cached title.

### WP2.3 — Honest completion and revision lifecycle

**Depends on:** WP2.1 and WP2.2.

**Outcome:** Distinguish provisional live text, finalized ranges, partial
sessions, complete transcripts, and later improved versions.

**Pass criteria:**

- Stopping after selected minutes saves those ranges without marking the video
  complete.
- Live translation is saved only with the finalized cue revision it belongs to.
- Reopening offers reuse, continue missing coverage, or retranscribe; it does
  not silently choose the wrong action.

### WP2.4 — Local transcript history and retranscription

**Depends on:** WP2.3.

**Outcome:** A local folder-backed history stores transcript files plus stable
video link, platform, title, audio language/role, date, coverage, provider,
model/version, and accuracy metadata.

**Pass criteria:**

- The user can list, search, open the source link, export, delete, continue, or
  retranscribe a record.
- A new transcription is versioned; the old result is not silently destroyed.
- Moving/updating the extension does not lose the chosen local history.
- Signed media URLs, cookies, tokens, DRM data, and audio are excluded.

### Phase 2 gate

Pass when cached playback, partial history, retranscription, and timing behave
consistently for batch, live, and reused-caption sources.

## Phase 3 — Pluggable transcription providers

### WP3.1 — Provider-neutral transcription contract

**Depends on:** WP2.1 and WP2.3.

**Outcome:** Define capabilities, input modes, progress, cancellation, errors,
language selection, timestamps, model identity, cost hints, and normalized
output for any transcription provider.

**Pass criteria:** The current local Whisper paths work through the contract
without losing word timing, diagnostics, cancellation, or privacy labels.

### WP3.2 — Local Whisper provider

**Depends on:** WP3.1.

**Outcome:** Preserve local batch and live transcription as the private default.

**Pass criteria:** Existing local regression results do not worsen and model
changes are recorded in transcript provenance.

### WP3.3 — Groq and future API providers

**Depends on:** WP3.1 and secure configuration rules.

**Outcome:** Let a user explicitly supply an API key and choose Groq or another
provider when its capabilities suit the source.

**Pass criteria:**

- Nothing is uploaded until the user selects an online provider and sees what
  data leaves the device.
- API keys never enter exports, logs, transcript files, source control, or page
  content.
- Rate limits, cost, file limits, retention implications, timestamps, and
  failures are shown clearly.
- Provider output is normalized and passes the same Phase 2 lifecycle tests.

### Phase 3 gate

Pass when switching providers changes only declared capability/cost/privacy
behavior, not the saved transcript contract or learning interface.

## Phase 4 — Learning overlay and UI/UX refactor

This phase preserves interactions first, then redesigns them. Do not treat a
visual redesign as permission to remove behavior.

### WP4.1 — Natural transcript interaction

**Depends on:** WP2.1.

**Outcome:** Transcript and translation text are naturally selectable/copyable;
a simple word click opens analysis without fighting text selection.

**Pass criteria:** Drag-select, double-click selection, keyboard copy, link
activation, word click, touch interaction, and overlay drag do not trigger one
another accidentally.

### WP4.2 — Word analysis and saving

**Depends on:** WP4.1.

**Outcome:** Organized compact English-titled card with German/English
definitions, grammar, natural examples, related data, save/remove, and source
context. Deterministic dictionary data remains the no-cost baseline; optional AI
tutoring is a separately labelled future provider.

**Pass criteria:** Cached results remain context-aware where context changes the
meaning, unavailable data is not invented, and saved entries retain the sentence
and video provenance.

### WP4.3 — Listening actions

**Depends on:** WP4.1 and exact/estimated timing from WP2.1.

**Outcome:** Open the word in German YouGlish and replay its occurrence in the
current video.

**Pass criteria:** Exact timestamps are used when available; estimates are
labelled; replay restores prior time, pause state, rate, and volume behavior.

### WP4.4 — Caption positioning and controls

**Depends on:** WP2.2.

**Outcome:** YouTube-like default placement, mouse/touch dragging, independent
transcript/translation appearance, translation visibility, and responsive
collision avoidance.

**Pass criteria:**

- Default captions sit in the expected lower safe area.
- When playback controls appear on pause or pointer movement, captions move
  above them dynamically and return without jumping after controls disappear.
- Fullscreen, theater mode, resize, embedded players, and saved positions work.
- Translation uses a distinct default color.

### WP4.5 — Cohesive UI/UX redesign

**Depends on:** WP4.1–WP4.4 passing.

**Outcome:** Refactor popup, settings, overlay, word card, status/error display,
and transcript history into one accessible visual system.

**Pass criteria:** The complete protected interaction matrix still passes;
keyboard navigation, contrast, scaling, focus, reduced motion, and beginner
clarity are tested.

### Phase 4 gate

Pass only when the redesign improves usability without reducing acquisition,
transcript, learning, or diagnostic capabilities.

## Phase 5 — Production and SaaS hardening

This phase is explicitly deferred until the user accepts the core prototype.

### WP5.1 — Architecture refactor under characterization tests

**Depends on:** Phases 0–4.

**Outcome:** Refactor extension boundaries, schemas, adapters, and build system
without behavior drift.

### WP5.2 — Security, privacy, migration, and reliability

**Depends on:** WP5.1.

**Outcome:** Threat model, least permissions, credential handling, storage
migrations, recovery, update channels, observability, and data deletion.

### WP5.3 — Public distribution and account/SaaS boundary

**Depends on:** WP5.2 and an explicit business decision.

**Outcome:** Store packaging, onboarding, billing/account decisions, hosted
services only where justified, and clear local-versus-cloud controls.

**Phase gate:** Independent privacy/security review, clean upgrade path,
production regression suite, supported-platform policy, and explicit user
approval to launch.

## Phase 6 — Learning website, flashcards, and Anki

This is the final phase.

### WP6.1 — Optional sync contract

**Depends on:** Phase 5 identity/security decisions and WP2.4 history schema.

**Outcome:** Explicit opt-in sync of saved words and approved metadata; local-only
use remains possible.

### WP6.2 — Website vocabulary library

**Depends on:** WP6.1.

**Outcome:** Review words, search, categorize/tag, edit context, and link back to
the source video.

### WP6.3 — Flashcards and scheduling

**Depends on:** WP6.2.

**Outcome:** Flashcards with context, definitions, examples, source links, and a
documented review schedule.

### WP6.4 — Anki export

**Depends on:** WP6.2; may run in parallel with WP6.3 once the schema is stable.

**Outcome:** Export a documented Anki-compatible package or file with stable
field mapping and duplicate handling.

**Phase gate:** Local/cloud data ownership is clear, exports round-trip without
loss, deletion works, and the website is not required for core extension use.

## Rule for choosing the next WP

Choose the earliest unpassed WP that blocks a requested feature. A later feature
may be prototyped in isolation, but do not merge around a failed dependency.
When evidence changes the plan, update this document and explain the dependency
change in the same commit.

# Development roadmap

## Purpose

This roadmap preserves the product direction and work sequence while Dub
Transcript Lab is validating its core idea. It is not permission to implement
every listed feature. A phase begins when its dependencies pass and the user
chooses to continue.

The user reprioritized the immediate bounded work on 2026-09-03:

1. reuse an eligible original YouTube automatic transcript before local ASR;
2. diagnose the reported YouTube batch-ASR timing problem with
   beginning/middle/end evidence before applying a correction; and
3. mark exact previously saved German words in later transcript cues.

The implementation sequence and pass boundary are documented in
[`YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md`](YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md).
This priority does not waive the unfinished restoration/UI regression gates or
authorize a production refactor.

Netflix catalogue research is retained, but data collection is paused until the
user again has access to the test computer. That pause must not block feature
restoration, UI/UX work, transcript lifecycle work, or generic-site testing.

Production/SaaS refactoring, the learning website, flashcards, and Anki remain
deferred until the core extension has been proven.

## Current progress

2026-10-28 WP2.2/WP2.4/WP2.5 candidate0.12.3 adds a12px dropdown role,
explicit option typography, full-width provider field and concise mode/provider
labels. Language controls align when headings wrap. Existing option values and
settings behavior remain. Local24syntax checks,27extension suites and56server
tests pass. Real Chrome/native-dropdown/zoom fit remains unverified under the
browser pause. Experimental; see `POPUP_SELECT_TYPOGRAPHY_PLAN.md` and
`test-results/0.12.3-dropdown-typography.md`.

2026-10-28 WP2.4/WP2.5 candidate0.12.2 fixes the user-confirmed black serif
player-menu text by placing font/color on the panel itself, outside the inline
host reset. Grouped controls, explicit On/Off switches, a close button and
scrollable details retain all settings/actions. User clarifies hover works
when checked; its algorithm/default remain unchanged. Local24syntax checks,
27extension suites/56server tests pass. Browser rendering/size/fullscreen checks
remain unverified under the pause. Experimental; wider Needs development remains.
See `test-results/0.12.2-youtube-menu.md` and `YOUTUBE_MENU_POLISH_PLAN.md`.

2026-10-28 WP2.4/WP2.5/WP3.4 candidate0.12.1 addresses user-reported persistent
Starting and inaccessible player/hover settings. The shared template now starts
empty/hidden; the panel mounts directly in the player outside native control
clipping ancestry; shared word switches are visible on popup Home. Actual menu
DOM regression added and delegated hover bindings tested. Local23syntax checks,
27extension suites/56server tests pass. User confirms0.12.0 automatic retrieval
works, with route/sample unspecified. New real rendering/mouse/fullscreen checks
remain unverified under the browser-testing pause. Candidate Experimental;
broader Needs development remains. See `test-results/0.12.1-youtube-controls.md`.

2026-10-28 WP3.1/3.2/3.4/3.5 and WP2.2/2.4/2.5 candidate0.12.0 implements
automatic YouTube caption retrieval, creator subtitles before original automatic
captions, browser-first/subtitle-only yt-dlp fallback, optional YouTube translation,
source-aware history/export/diagnostics and an in-player settings button. Global
word highlight/pause-on-hover settings share popup/player storage. Local23syntax
checks,26extension suites and56server tests pass. Actual retrieval/player layout/
fullscreen/hover/upgrade acceptance remains unverified while browser testing is
paused. Candidate Experimental; overall Needs development until required browser
evidence. Prior dictionary gaps unchanged. See `YOUTUBE_CAPTIONS_IMPLEMENTATION.md`
and `test-results/0.12.0-youtube-captions.md`. This supersedes the earlier automatic-
transcript-only/no-YouTube-translation/automatic-ASR-fallback decisions.

2026-10-28 WP2.2/WP2.4/WP2.5 candidate0.11.5 establishes shared Open Sans
typography and12/14/16/18/22px roles; Home/Videos titles are16px. Caption
preferences remain independent. Local18syntax checks,23extension suites and
46server tests pass; font/layout browser checks await user review. Experimental;
prior dictionary failures unchanged. Rules: `TYPOGRAPHY_RULES.md`; evidence:
`test-results/0.11.5-typography.md`. Await user instructions before YouTube work.

2026-10-28 WP1.3/WP2.4 candidate0.11.4 makes saved-word titles open the existing
full dictionary card inside Words without a media session. Back/Escape, removal,
source navigation and popup review state are preserved. Local17syntax checks,
23extension suites and46server tests pass; browser testing remains paused.
UI candidate Experimental; prior dictionary gaps remain Needs development.
See `test-results/0.11.4-saved-word-review.md` and `SAVED_WORD_REVIEW_PLAN.md`.

2026-10-26 WP2.4/WP2.5 candidate0.11.3 compacts voice/help descriptions into
hover/focus icons, fades replay/timing notices after a2-second dwell and preserves
sanitized last-reported details in popup diagnostics. Meanings display one ordinal
without bracketed source IDs; dictionary relationships remain unchanged. Three
syntax checks and six quick local suites pass; browser/platform checks not run.
See `test-results/0.11.3-compact-status-ui.md`.

2026-10-26 WP2.4/WP2.5 UI-only candidate0.11.2 moves alternative meanings below
the main meaning, isolates disclosure typography from caption sizing and renders
verb overview/conjugations as full-width semantic tables. User explicitly forbids
functionality tests for this change; syntax/whitespace/source review only, with
browser behavior unverified. User also reports translation setup works in their
normal browser; exact pair/cold/background conditions unspecified. See
`test-results/0.11.2-word-card-table-ui.md`. Prior dictionary gaps remain.

2026-10-26 WP1.3/WP0.3 tests-only follow-up keeps application f8e04a6 unchanged.
Thirty additional entries score case rules7/10, explicit verb bases7/10 and
main conjugation tables10/10; complementary primary infinitives9/10 reveal tun→
tunen scope leakage. Expanded automated acceptance95/109 obligations passes,
14fail; existing regression remains passing. A native Translator control on
Google's demo also stalls with the extension uninstalled, trusted activation and
0→100% progress, narrowing the issue beyond application code without establishing
its internal cause. One reserve sehen consumed; eleven stay unread. **Needs
development**. See `test-results/0.11.1-expanded-grammar-and-chrome-control.md`.

2026-10-26 bounded WP1.3/WP2.4/WP3.5/WP0.3 candidate 0.11.1 implements structured
German dictionary extraction, popup/setup-tab translation preparation and safe
record projection/migration. Parent owns edits; GPT-6 Luna only compares sources.
Sixty entries (36 development/24 final) were evaluated with twelve unread
reserves. Grammar/conjugations and final definitions miss the >95% target; real
Chrome de→en/de→ar creation timed out with retry feedback. Privacy fixtures pass.
Status **Needs development**; no features excluded or final-set tuning performed.
See [`0.11.1-dictionary-readiness-persistence.md`](test-results/0.11.1-dictionary-readiness-persistence.md).

Latest scoped browser acceptance (2026-10-25): user selected only word-card
content, grammar, translation, and upgrade/setup/privacy (items 4/5/6/13).
Chrome DevTools MCP against disposable extension profiles found real dictionary
section/meaning and grammar failures, a first-use Arabic Translator gesture
failure, and persistent signed-query/URL-credential privacy failures. Across
36 scoped assertions: 23 Pass, 12 Fail, 1 Inconclusive; read-only setup and
installer dry-run also passed. Current selected-scope classification is
**Needs development**, superseding earlier automated-only passes for these
real-source cases. Product source was not changed; other categories were not
tested. See
[`0.11.0-scoped-45613-browser-tests.md`](test-results/0.11.0-scoped-45613-browser-tests.md).

Bounded WP3.5 replay-storage correction (2026-10-25): at the user's request,
cached playback now stores a versioned transcript reference instead of another
complete cue payload. Runtime/export reads resolve the canonical version or its
existing original analysis; stop and preference writes remain compact. Old
inline records are readable and no user history was deleted. All 18 extension
suites/46 server tests pass, plus an isolated Chromium storage check: four replay
records total 6,260 bytes for a 447,592-byte synthetic canonical transcript.
Real-player acceptance remains unverified. See
[`0.11.0-replay-transcript-references.md`](test-results/0.11.0-replay-transcript-references.md).

Latest analysis-storage correction (2026-10-25): the user reported
`Resource::kQuotaBytes quota exceeded` after the discovery issue. The parent
added unlimitedStorage for local transcript/experiment persistence, fixed
uncaught popup settings-save failures and recorded analysis-storage failures
with usage diagnostics. No user data was removed. Exact live usage/failing key
was not measured because privileged browser inspection was policy-blocked.
All 18 extension suites, syntax checks and 46 server tests pass; actual quota
recovery after extension reload remains pending. See
[`0.11.0-analysis-storage-quota.md`](test-results/0.11.0-analysis-storage-quota.md).

Latest repeated-discovery correction (2026-10-25): read-only inspection of the
user's actual Edge/AniWorld tab captured `Browser pronunciation helpers were
not loaded`, proving optional speech initialization was aborting discovery.
The parent made speech lazy/optional, moved the readiness sentinel after setup,
and preserved frame inspection errors. All 17 extension suites, 46 server tests
and syntax checks pass; the user browser was not reloaded or started for
analysis, so real post-repair acceptance remains pending. See
[`0.11.0-optional-speech-startup-repair.md`](test-results/0.11.0-optional-speech-startup-repair.md).

Full local validation rerun (2026-10-25): all 16 extension suites, 46 server
tests, entry/helper syntax checks, supplementary Python/PowerShell/JavaScript
parsing, manifest references and whitespace checks pass. The read-only setup
verifier also passes, including native-host registration and existing recognizer
health, after its initial sandbox registry restriction was resolved by an
approved read-only run. No browser/live-analysis gate was exercised. See
[`0.11.0-local-regression-run.md`](test-results/0.11.0-local-regression-run.md).

Latest pronunciation decision (2026-10-25): the parent replaced local-only
`chrome.tts` with the user's site's Web Speech approach. Browser German voices
may be local or online, `de-DE` is preferred, and other-language fallback is
blocked. Voice-list changes and card-local lifecycle feedback remain explicit.
All 16 extension suites, syntax checks and 46 server tests pass; audible speech
and platform acceptance remain unverified. See
[`0.11.0-browser-german-pronunciation.md`](test-results/0.11.0-browser-german-pronunciation.md).

Latest 2026-10-25 correction: after the user stopped Terra delegation and
authorized local checks only, the parent reproduced and repaired a content
script syntax error blocking player discovery and cached-transcript replay.
Application injection errors now retain their real cause, and preparation
failure diagnostics take precedence over the previous completed experiment.
All 15 extension suites, JavaScript syntax checks and 46 server tests pass;
Chrome/platform verification remains unverified. This supersedes the earlier
blanket testing pause only for local checks. See
[`0.11.0-player-initialization-repair.md`](test-results/0.11.0-player-initialization-repair.md).

On 2026-10-25 the user requested the supplied Stitch Terra UI and cross-show
saved-word marking, then reprioritized word-card and appearance corrections
before further testing. This is an isolated WP1.3/VOC-1 and WP2.2/WP2.4/WP2.5
candidate on the existing branch, using the saved-vocabulary normalization,
translation-provider/cache, and interaction contracts. It does not depend on
the unimplemented YouTube caption-first path: the current batch/live/cache
renderer provides the source-word spans needed for marking.

The user supplied AniWorld browser screenshots of the first UI candidate and
requested target-language meanings (including Arabic), German definitions
followed by translations of those definitions, highlighted examples, outside
dismissal, a blended scrollbar, smaller titles, and sticky/collapsible settings.
Testing is paused at the user's request. Earlier automated results do not cover
these subsequent corrections. See
[`0.11.0-terra-vocabulary-candidate.md`](test-results/0.11.0-terra-vocabulary-candidate.md)
for the baseline, changed contracts, deferred checks, and limitations.

The later 2026-10-25 decision replaces the mixed German/English dictionary
candidate with German Wiktionary as the only active card source. Each German
meaning/example is translated directly into the selected language. Source-explicit
case/government information is separate from meanings; verbs also show base
form and conjugations. Roles/usage notes are excluded. The follow-up
grammar/sense/TTS contract supersedes the earlier verb-only grammar wording;
see [`WORD_CARD_FOLLOWUP_PLAN.md`](WORD_CARD_FOLLOWUP_PLAN.md). Candidate
matching is decided independently for each translated example: zero or
multiple distinct matches mean no highlight; one means all its occurrences.
Chrome's built-in Translator is primary, with visible language-pack state and
configured Google fallback only. Pronunciation, popup continuity, spoken-word
highlighting, and diagnostics placement are included in the user's request.

The written scope is
[`GERMAN_ONLY_LEARNING_IMPLEMENTATION_PLAN.md`](GERMAN_ONLY_LEARNING_IMPLEMENTATION_PLAN.md).
Implementation was delegated using the user's explicitly requested
`gpt-5.6-terra` subagent override, with source review by the parent. Consult
[`GERMAN_ONLY_LEARNING_IMPLEMENTATION_REPORT.md`](GERMAN_ONLY_LEARNING_IMPLEMENTATION_REPORT.md)
for implemented/partial items and pending checks. The implementation and report
remain an unverified local candidate while the user-requested testing pause
continues; no release pass or pushed-checkpoint claim follows from delegation.

| WP | Status | Evidence |
|---|---|---|
| WP0.1 | Pass | `docs/FEATURE_REGISTRY.md` records protected contracts and distinguishes automated, source-present, and manual evidence. |
| WP0.2 | In progress | Existing fixtures cover lifecycle paths; the authorized real-media corpus remains incomplete. |
| WP0.3 | Experimental | `RUN-REGRESSION.cmd` runs syntax, extension, server, and whitespace checks; upgrade fixtures and intentional-break validation remain. |
| WP1.1 | In progress | Source/history audit completed; real browser checks M-01 through M-08 remain. |
| WP1.2 | Experimental | Version 0.9.6 strengthens selection/click policy and tests; M-01/M-02 remain. |
| WP1.3 | Experimental | Historical card/save paths are present and section titles are English; M-03/M-04 remain. |
| WP2.1 | Experimental | UI event ownership is documented in `docs/UI_INTERACTION_CONTRACTS.md`; combined Phase 1/2 browser checks remain. |
| WP2.2 | Experimental | Version 0.10.0 implements the glass visual system, independent styling, font steppers, and appearance reset. |
| WP2.3 | Experimental | Version 0.10.0 adds temporary player-control avoidance while preserving the dragged base position. |
| WP2.4 | Experimental | The compact English word card and sanitized diagnostic panel are integrated into the new hierarchy. |
| WP2.5 | In progress | Focus, live-region, and reduced-motion contracts are implemented; U-01–U-17 remain manual. |
| WP4.1 | Experimental | On 2026-07-23 the user confirmed that current-version full-audio analysis works on YouTube, AniWorld, and AnimeKai. Version 0.10.4 adds a same-origin loopback-video candidate after the 0.10.3 worker correctly rejected `127.0.0.1`; its real-browser local MP4 check is pending. The multi-sample manual matrix remains incomplete. |
| WP4.1a | Planned | Measure and improve clear-media preparation speed, especially segmented or muxed HLS on AniWorld, without changing language selection, cue coverage, privacy, cache behavior, or the passing YouTube/AnimeKai paths. |
| WP4.2 | Blocked/paused | Netflix test computer is temporarily unavailable. |
| WP3.1/3.4 YouTube caption-first | Experimental candidate |0.12.0 implements creator-first/original-auto-second source selection, automatic browser retrieval/subtitle-only yt-dlp fallback and explicit source provenance. Local fixtures pass; live retrieval/player/browser gate unverified. See `test-results/0.12.0-youtube-captions.md`. |
| WP3.2 YouTube ASR timing | Needs evidence | The 0.10.4 change did not modify the YouTube clock/decode path. Add sanitized timing instrumentation and require beginning/middle/end evidence before correction. |
| WP1.3 saved-word marking | Experimental candidate | Version 0.11.0 source marks exact normalized saved forms across batch/live/cache cues and storage changes. The first candidate passed automated overlay coverage; current word-card corrections and combined browser gates remain unverified while testing is paused. |

The current evidence records are
[`docs/test-results/0.10.0-phase2-ui-candidate.md`](test-results/0.10.0-phase2-ui-candidate.md)
through
[`docs/test-results/0.10.4-local-media-loopback-candidate.md`](test-results/0.10.4-local-media-loopback-candidate.md).

## Product outcome

For a video the user is authorized to watch, the extension should:

1. use matching captions when they genuinely represent the selected audio;
2. otherwise acquire or capture the selected audio and transcribe it with a
   chosen provider;
3. display synchronized, reusable bilingual captions inside the player;
4. preserve natural text selection and language-learning interactions;
5. remember complete and partial work honestly; and
6. provide visible evidence for every acquisition or fallback decision.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Pass** | All mandatory acceptance checks and regressions passed on the defined matrix, and evidence was recorded. |
| **Experimental** | The bounded experiment worked, but platform or catalogue coverage is insufficient for a product guarantee. |
| **Needs development** | A required check failed, a historical feature regressed, data was misclassified, or required evidence is missing. |
| **Blocked** | An external access, platform, hardware, legal, or user-action dependency prevents the check. This is not a pass or failure. |

One successful title never establishes platform-wide support. Source code,
documentation, a log message, or an old result also does not count as current
proof.

## Historical checkpoints and protected behavior

These commits are development memory, not proof that the behavior still passes:

| Commit | Historical purpose | Protected contract to regression-test |
|---|---|---|
| `923d8c9` | Initial experiment baseline | Live capture, epochs, cached rewind, caption comparison, technical export |
| `ea1379c` | Bilingual learning captions | Translation, clickable words, saved vocabulary, appearance controls |
| `64875b8` | Draggable caption refinement | Caption dragging and word card above the overlay |
| `643eab4` | Beginner setup | Installer, setup check, recognizer registration and startup |
| `1546662` | Local learning and library | Word card, YouGlish, clip replay, TXT export, complete transcript cache |
| `7b10270` | Netflix research collector | Privacy-safe per-title reports and aggregate dataset export |

The following are high-priority user-reported regression risks:

- transcript and translation can be selected and copied naturally;
- a click that is not a text selection opens word analysis;
- the word card provides definitions/examples and can save the word;
- YouGlish opens German usage for the selected word;
- replay seeks to the exact known word interval and restores playback state;
- captions can be dragged with the mouse;
- generic and embedded players remain supported;
- complete cached transcripts replay without recognition, while partial live
  sessions do not pretend the title is complete.

## Revised dependency map

```text
Phase 0 — Evidence baseline
  -> Phase 1 — Restore lost/protected features
     -> Phase 2 — UI/UX refactor
        -> Phase 3 — Transcript lifecycle and local history
           -> Phase 4 — Platform acquisition research
              -> Phase 5 — Pluggable transcription providers
                 -> Phase 6 — Production/SaaS hardening
                    -> Phase 7 — Website, flashcards, and Anki
```

The main sequence is:

```text
WP0.1 -> WP0.2/WP0.3 -> WP0.4
  -> WP1.1 -> WP1.2 -> WP1.3 -> WP1.4 -> WP1.5 -> WP1.6
  -> WP2.1 -> WP2.2/WP2.3/WP2.4 -> WP2.5
  -> WP3.1 -> WP3.2 -> WP3.3 -> WP3.4/WP3.5
  -> WP4.1 -> WP4.1a -> WP4.5
  -> WP5.1 -> WP5.2 -> WP5.3
  -> Phase 6
  -> Phase 7
```

Netflix collection follows its own delayed branch:

```text
WP0.2 -> WP4.2 (paused for test-computer access) -> WP4.3 -> WP4.5
```

An isolated experiment may explore a later WP, but it cannot redefine an
earlier contract or be released around a failed dependency.

## Phase 0 — Evidence baseline and regression protection

Phase 0 is small and should be completed alongside the start of restoration. It
prevents another repair from silently deleting unrelated behavior.

### WP0.1 — Canonical feature registry

**Depends on:** none.

**Outcome:** Convert historical claims into a registry of critical features,
automated tests, manual checks, last known result, and source checkpoint.

**Pass criteria:**

- Every protected behavior has a test or clearly named manual check.
- Current behavior is labelled passed, failed, or unverified.
- Each future change can identify the feature contracts it touches.
- A feature present in source but unusable in Chrome is not marked passed.

### WP0.2 — Reproducible media and interaction corpus

**Depends on:** WP0.1.

**Outcome:** Maintain legal or user-authorized samples for YouTube, clear MP4,
HLS, DASH, embedded players, live-only playback, matching captions,
non-matching subtitles, silence, music, and multi-speaker dialogue. Netflix
fixtures contain sanitized reports and measurements, never media.

**Pass criteria:**

- Samples cover batch, live, caption reuse, cache, seek, partial coverage, and
  failure paths.
- Expected duration, language, role, and caption relationship are documented.
- Private URLs, credentials, audio, and DRM material are absent.

### WP0.3 — Version regression runner

**Depends on:** WP0.1. It can begin before WP0.2 is complete.

**Outcome:** One documented command runs unit, lifecycle, schema, privacy, and
fixture tests; a manual checklist covers real browser interactions.

**Pass criteria:**

- A deliberately broken historical behavior makes a named regression fail.
- Results identify the affected contract rather than only a generic exception.
- Upgrade tests preserve settings, vocabulary, transcripts, and runtime/model
  folders.

### WP0.4 — Baseline gate

**Depends on:** WP0.1–WP0.3.

**Outcome:** Establish the comparison point for restoration and redesign.

**Pass criteria:** Critical tests pass, existing failures are recorded, results
are committed and pushed, and no unverified item is represented as working.

## Phase 1 — Restore lost and protected features

This is the next implementation phase. Restore behavior before redesigning its
appearance.

### WP1.1 — Current-build interaction audit

**Depends on:** WP0.1 and the historical checkpoints above.

**Outcome:** Test the present unpacked extension against each protected
interaction and identify whether it is absent, hidden, broken by event handling,
or working but unverified.

**Pass criteria:**

- Results include browser screenshots or concise manual evidence where needed.
- Each failure has a reproduction sequence and likely owning component.
- No code is rewritten until the working and failing paths are distinguished.

### WP1.2 — Natural selection, copying, and word-click separation

**Depends on:** WP1.1.

**Outcome:** Transcript and translation are naturally selectable and copyable.
A simple word click opens analysis, while drag selection, double-click
selection, and keyboard copy do not accidentally open the card or drag captions.

**Pass criteria:**

- Mouse drag and keyboard copy work for source and translation text.
- Word click works before, during, and after playback.
- Selecting multiple words does not open several cards.
- Caption dragging and text selection do not steal each other's gestures.
- Touch/pointer behavior has an explicit, tested rule.

### WP1.3 — Word analysis and saved vocabulary

**Depends on:** WP1.2.

**Outcome:** Restore the organized word card with English-titled sections,
German/English definitions, grammar, examples, related information, context, and
save/remove behavior.

**Pass criteria:**

- A clicked word is normalized without losing the original displayed form.
- Empty dictionary sections are hidden instead of invented.
- Cache identity includes enough context when context changes the meaning.
- Saved words keep the source sentence, video identity/link, and known timing.
- Reopening the card and extension preserves saved state.

### WP1.4 — YouGlish and replay-in-video

**Depends on:** WP1.3 and existing cue timing.

**Outcome:** Restore German YouGlish and replay either the selected word or its
complete recognized sentence/caption in the current video.

**Pass criteria:**

- YouGlish opens the selected German word in a new tab.
- The word card exposes compact, adjacent **Word** and **Sentence** replay
  actions without another modal or settings page.
- Exact word timestamps are used when available and are clamped against
  adjacent word boundaries instead of always adding broad padding.
- Estimated live-cue boundaries are clearly labelled as estimates.
- Sentence replay uses the recognized sentence boundaries when available. If
  only a phrase/caption boundary exists, the UI calls it a caption rather than
  claiming an exact sentence.
- Replay restores the prior media time, pause state, playback rate, and relevant
  volume state.
- Repeated replay does not corrupt transcript synchronization.
- This work does not claim sample-accurate word isolation. A future optional
  forced-alignment experiment must be measured separately before adding another
  local model dependency.

### WP1.5 — Caption dragging and existing appearance controls

**Depends on:** WP1.2 and WP1.4 because the gestures share the overlay.

**Outcome:** Restore free mouse/pointer dragging, separate transcript and
translation styling, translation visibility, background/edge controls, and the
distinct default translation color.

**Pass criteria:**

- The caption can be dragged without selecting text accidentally.
- Text can be selected without dragging the caption accidentally.
- Positions and appearance persist per the documented settings scope.
- Fullscreen, theater mode, resize, and embedded frames remain usable.
- The word card remains visible and does not cover the selected word needlessly.

### WP1.6 — Restoration regression gate

**Depends on:** WP1.2–WP1.5.

**Outcome:** Prove the restored features coexist with transcription, translation,
cache replay, export, and setup behavior.

**Pass criteria:**

- All restored interactions pass the manual matrix.
- Existing extension and server test suites pass.
- YouTube batch/live smoke checks do not regress.
- No historical feature is removed to simplify another feature.
- The checkpoint is versioned, committed, and pushed.

## Phase 2 — UI/UX refactor

Phase 2 starts only after Phase 1 passes. Refactor behavior into a coherent
interface without a production/SaaS rewrite.

### WP2.1 — Interaction and component boundaries

**Depends on:** Phase 1.

**Outcome:** Separate caption rendering, gesture ownership, word-card state,
settings state, progress/errors, and transcript-library UI into explicit
components/contracts before visual redesign.

**Pass criteria:**

- Selection, word click, drag, replay, and settings have one documented event
  owner each.
- Re-rendering a cue does not close the word card or reset unrelated UI state.
- Characterization tests protect restored behavior during the refactor.

### WP2.2 — Caption settings and visual system

**Depends on:** WP2.1.

**Outcome:** Create a clear glassmorphism-based visual system for the popup,
settings, caption overlay, translation, word card, diagnostics, and library.

**Pass criteria:**

- Transcript and translation have independent font, size, color, opacity, and
  emphasis settings.
- Shared background, blur, edge, and position controls have understandable
  defaults and reset behavior.
- Translation has a distinct default color, defaults smaller than the source
  transcript, and has an obvious visibility toggle.
- A single **Blur until hover** translation option visually hides the
  translation until hover, keyboard focus, or an equivalent non-selection touch
  action. There is no blur-strength control.
- Blur never removes translation text from assistive technology, does not
  prevent native selection/copy, and does not alter translation generation or
  cache identity.
- Contrast remains readable over light and dark video.

### WP2.3 — Player-aware caption positioning

**Depends on:** WP2.1 and restored dragging from WP1.5.

**Outcome:** Use a YouTube-like lower safe-area default and move captions above
player controls dynamically when the control bar appears.

**Pass criteria:**

- Captions avoid visible playback controls on pause and pointer movement.
- They return smoothly when controls disappear.
- Manual drag remains available and has a defined relationship to automatic
  avoidance.
- Fullscreen, theater mode, resize, Netflix-style controls, YouTube, and generic
  players are tested.

### WP2.4 — Minimal word card and visible diagnostics

**Depends on:** WP2.1 and WP1.3.

**Outcome:** Organize the word card into compact English-titled sections and
show acquisition/transcription errors in the extension without requiring JSON.

**Pass criteria:**

- Important word actions are visible without excessive scrolling.
- Errors identify stage, source type, fallback, and suggested next action.
- Technical details are expandable and sanitized.
- Normal learning actions are not buried under diagnostics.

### WP2.5 — Accessibility and UI regression gate

**Depends on:** WP2.2–WP2.4.

**Outcome:** Verify the redesigned interface with keyboard, mouse, touch/pointer,
zoom, responsive sizes, reduced motion, and screen-reader-friendly labels.

**Pass criteria:**

- The complete Phase 1 interaction matrix still passes.
- Keyboard focus is visible and ordered.
- Text selection and browser copy remain native.
- The redesign does not reduce acquisition, transcript, learning, cache, or
  diagnostic capabilities.

## Phase 3 — Transcript correctness, timing, and durable history

### WP3.1 — Canonical cue and word-timing contract

**Depends on:** Phase 2 interaction contracts.

**Outcome:** One schema represents batch ASR, live ASR, reused captions,
translations, word timestamps, confidence/provenance, and revisions.

**Pass criteria:** No renderer or cache guesses whether time is exact,
estimated, provisional, or finalized.

### WP3.2 — Playback synchronization and sentence segmentation

**Depends on:** WP3.1.

**Outcome:** Correct pause, seek, rewind, playback-rate, sentence-boundary, and
caption replacement behavior.

**Pass criteria:**

- Pause creates no new media-time coverage.
- Cached rewind never retranscribes covered audio.
- Uncovered seek creates an independently anchored epoch.
- Captions do not flood the screen or strand a mid-sentence word when a stable
  sentence grouping exists.
- Sync remains correct after reopening a cached title.

### WP3.3 — Honest completion, partial coverage, and revisions

**Depends on:** WP3.1 and WP3.2.

**Outcome:** Distinguish provisional live text, finalized ranges, partial
sessions, complete transcripts, and later improved versions.

**Pass criteria:**

- Selected-minute transcription is saved without marking the video complete.
- Live translation is saved with the finalized cue revision it belongs to.
- Reopening offers reuse, continue missing coverage, or retranscribe.
- Later provider/model results do not silently overwrite prior results.

### WP3.4 — Matching-caption reuse

**Depends on:** WP3.1 and WP3.3.

**Outcome:** When captions are demonstrated to match the selected audio, fetch
and normalize them instead of transcribing, hide the website's duplicate
captions, and render them through Dub Transcript Lab.

**Pass criteria:**

- Language equality alone is not treated as wording equality.
- Confidence comes from track semantics or representative comparison, with a
  user override.
- Website captions are restored when the extension stops or fails.
- Normalized cues pass timing, cache, selection, and word-learning contracts.

### WP3.5 — Local transcript history and retranscription

**Depends on:** WP3.3.

**Outcome:** A local folder-backed history stores transcripts plus stable source
link, platform, title, language/role, date, coverage, provider/model, and
accuracy/provenance metadata.

**Pass criteria:**

- The user can list, search, open, export, delete, continue, or retranscribe.
- New transcription creates a version; it does not destroy the old result.
- Extension updates preserve the chosen history folder.
- Signed URLs, cookies, tokens, DRM data, and audio are excluded.

### Phase 3 gate

Pass when batch, live, and reused-caption sources share honest timing, revision,
cache, partial-history, and retranscription behavior.

## Phase 4 — Platform acquisition and streaming research

This phase no longer blocks feature restoration or UI/UX work.

### WP4.1 — Public, generic, and embedded-player acquisition

**Depends on:** WP0.2 and Phase 3 cue contracts.

**Outcome:** Preserve public YouTube, clear MP4/HLS/DASH, and user-authorized
embedded/AniWorld-style support.

**Pass criteria:**

- The selected audible player, language, and role are identified.
- Cross-origin frames are discovered where permissions allow.
- Mirrors are ranked/retried without duplicate transcript coverage.
- Clear media may use batch mode; inaccessible media uses audible live capture.
- Authentication, CAPTCHA, paywalls, DRM, and access controls are not bypassed.

**Current evidence:** Version 0.10.3 has user-reported browser successes on
YouTube, AniWorld, and AnimeKai. Version 0.10.4 adds an explicitly authorized
same-origin loopback path for user-hosted local video and avoids modifying the
root layout of Chrome's bare media document. The local-video browser retest is
still unverified. These paths remain **Experimental** until the reference samples complete the
beginning/middle/end, language, cache-replay, export, and privacy checks in the
manual matrix. It is not a promise that every mirror or CDN representation
works.

### WP4.1a — Clear-media acquisition speed and stage observability

**Depends on:** WP4.1, the WP0.2 reference corpus, and stable Phase 3
transcript/cache contracts. Measurement-only work may begin earlier, but an
optimization cannot ship around a failed restoration or lifecycle regression
gate.

**Outcome:** Reduce preparation time for accessible clear media, especially
AniWorld-style HLS, while making network acquisition, demuxing, decoding, and
transcription visibly distinct.

**Required baseline measurements:**

- discovery and playlist-resolution time;
- time to first decoded PCM and time to complete acquisition;
- transcription start and completion time;
- media duration, segment count, transferred bytes, and effective throughput;
- audio-only versus muxed video/audio source;
- selected mirror/CDN, retry count, peak memory, cancellation time, and cache
  outcome.

**Optimization sequence:**

1. Correct the UI stages so HLS network reads are not reported only as
   “decoding.”
2. Prefer a matching audio-only HLS rendition when one exists.
3. For muxed HLS, select the lowest viable representation that preserves the
   requested language and complete audio duration.
4. Add bounded concurrent segment prefetch with ordered decode, retry,
   cancellation, and memory limits.
5. Evaluate starting ASR from ordered decoded chunks before the entire title is
   acquired; do not promote a partial result to a complete cached transcript.

**Pass criteria:**

- Preparation wall time improves materially on at least two slow reference HLS
  samples, including AniWorld, compared with a recorded same-machine baseline.
- No reference sample becomes more than 10% slower without a documented,
  accepted accuracy or reliability reason.
- YouTube, AniWorld, and AnimeKai retain the same selected language, duration,
  cue coverage, rewind/cache behavior, and exports.
- Progress names and metrics distinguish downloading, demuxing/decoding,
  transcribing, retrying, and fallback.
- Concurrency remains bounded, cancellation is responsive, and signed URLs,
  media segments, compressed audio, and PCM are not persisted.
- A faster partial acquisition is never described or cached as a complete
  transcript.

### WP4.2 — Netflix catalogue research dataset

**Depends on:** WP0.2 and access to the friend's Netflix test computer.

**Current status:** **Blocked/paused by external test access.** The existing
research collector remains available. Do not invent catalogue conclusions while
collection is paused.

**Outcome:** Collect diverse sanitized observations across:

- films and series episodes;
- release periods and durations;
- normal dub and audio description;
- matching-looking German SDH/CC, standard subtitles, and no subtitle;
- codecs, sample entries, representations, bitrates, protection/range behavior;
- first/repeat run, reload, title switch, and Windows restart.

**Initial evidence gate:** At least 24 observations across multiple films and
series, with repeated runs for each codec/configuration cluster. This is an
experiment dataset, not a Netflix-wide guarantee.

### WP4.3 — Netflix acquisition decision engine

**Depends on:** WP4.2.

**Outcome:** Select known working representation/decoder paths from observed
evidence and fall back safely for unknown configurations.

**Pass criteria:**

- Every observed cluster has a deterministic decision and visible reason.
- Partial downloads and mid-stream codec changes are not reported as success.
- Unknown/protected configurations use decoded-tab live audio.
- Per-title state cannot contaminate the next title.

### WP4.4 — Other subscription streaming services

**Depends on:** Phase 3 and platform-specific authorized test access. It does not
depend on WP4.2 unless reusing a proven Netflix-specific component.

**Outcome:** Research Amazon and other services separately rather than assuming
Netflix behavior applies to them.

**Pass criteria:**

- Each platform has its own evidence and capability classification.
- Protected sources default to decoded audible live capture.
- No DRM keys, license manipulation, cookies, or access-control bypass.

### WP4.5 — Unified acquisition and fallback policy

**Depends on:** WP4.1, plus WP4.3/WP4.4 only for platforms whose research is
available. A paused platform remains explicitly experimental.

**Outcome:** One visible decision model chooses reused captions, clear batch
media, browser decoding, or live capture.

**Pass criteria:**

- Every path reports source, stage, progress, and fallback reason.
- Unsupported platforms fail locally without corrupting other adapters.
- One platform's optimization cannot remove generic-player support.

## Phase 5 — Pluggable transcription providers

### WP5.1 — Provider-neutral contract

**Depends on:** Phase 3.

**Outcome:** Define input modes, capabilities, progress, cancellation, language,
timestamps, model identity, cost hints, privacy, errors, and normalized output.

**Pass criteria:** Existing local Whisper works through the contract without
losing timing, diagnostics, cancellation, or cache provenance.

### WP5.2 — Local Whisper provider

**Depends on:** WP5.1.

**Outcome:** Preserve local batch/live Whisper as the private default.

**Pass criteria:** Existing local regressions do not worsen and model changes are
stored in transcript provenance.

### WP5.3 — Groq and future API providers

**Depends on:** WP5.1 and secure configuration rules.

**Outcome:** Allow explicit user choice of Groq or another provider using the
user's API key.

**Pass criteria:**

- Nothing uploads before explicit online-provider selection and disclosure.
- Keys never enter exports, logs, transcript files, source control, or pages.
- Rate limits, costs, retention implications, limits, and failures are visible.
- Normalized results pass Phase 3 lifecycle tests.

## Phase 6 — Production and SaaS hardening

This phase is deferred until the user accepts the core prototype.

### WP6.1 — Architecture refactor under characterization tests

**Depends on:** Phases 0–5 as selected for the launch scope.

**Outcome:** Refactor extension boundaries, adapters, schemas, and build system
without behavior drift.

### WP6.2 — Security, privacy, migration, and reliability

**Depends on:** WP6.1.

**Outcome:** Threat model, least permissions, credentials, migrations, recovery,
update channels, observability, and deletion.

### WP6.3 — Public distribution and SaaS boundary

**Depends on:** WP6.2 and an explicit business decision.

**Outcome:** Store packaging, onboarding, supported-platform policy, account and
billing decisions, and clear local-versus-cloud controls.

**Phase gate:** Independent privacy/security review, clean upgrade path,
production regression suite, and explicit user approval to launch.

## Phase 7 — Learning website, flashcards, and Anki

This remains the final phase.

### WP7.1 — Optional sync contract

**Depends on:** Phase 6 identity/security decisions and WP3.5 history schema.

**Outcome:** Explicit opt-in sync of saved words and approved metadata while
local-only use remains possible.

### WP7.2 — Website vocabulary library

**Depends on:** WP7.1.

**Outcome:** Review, search, categorize/tag, edit context, and return to the
source video.

### WP7.3 — Flashcards and scheduling

**Depends on:** WP7.2.

**Outcome:** Flashcards with context, definitions, examples, source links, and a
documented review schedule.

### WP7.4 — Anki export

**Depends on:** WP7.2. It may run in parallel with WP7.3 once fields are stable.

**Outcome:** Export a documented Anki-compatible package or file with stable
field mapping and duplicate handling.

**Phase gate:** Data ownership is clear, exports round-trip without loss,
deletion works, and the website is not required for core extension use.

## Rule for choosing the next WP

The next implementation target is the remaining WP1.1 browser audit, followed
by WP1.2–WP1.6 restoration and its regression gate. The existing experimental
Phase 2 UI then needs its combined manual acceptance gate. WP4.1a is preserved
as the next acquisition improvement, but should start with baseline
instrumentation after protected interactions and transcript lifecycle behavior
are stable unless the user explicitly reprioritizes performance.

Choose the earliest unpassed WP that blocks the requested feature. A paused
external-research WP does not block independent earlier work. When evidence
changes priorities or dependencies, update this roadmap and explain the change
in the same commit.

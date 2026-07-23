# Protected feature registry

This registry is the Phase 0/WP0.1 baseline. It distinguishes code evidence
from real browser evidence so an old feature cannot be called working merely
because its functions still exist.

## Status definitions

- **Automated pass:** the named deterministic or lifecycle test passes.
- **Source present:** implementation and wiring exist, but the real browser
  interaction has not been verified for this version.
- **Manual pass:** the matching manual check passed on the recorded build.
- **Needs development:** the behavior failed or is inaccessible.
- **Blocked/unverified:** required media, browser, device, or user action was not
  available.

## Interaction and learning contracts

| ID | Protected contract | Historical checkpoint | Automated evidence | Manual check | Baseline at `9b74b8c` |
|---|---|---|---|---|---|
| INT-SELECT | Source transcript and translation can be selected and copied naturally | `64875b8` | `test-learning-features.mjs`, `test-popup-bindings.mjs` | M-01 | Source present; manual unverified |
| INT-WORD | A word click opens lookup, while text selection does not | `ea1379c` | `test-learning-features.mjs`, `test-popup-bindings.mjs` | M-02 | Source present; manual unverified |
| LEARN-CARD | Word card shows source-backed German/English definitions, examples, grammar, combinations, and related words | `1546662` | `test-learning-features.mjs` | M-03 | Automated helpers pass; manual unverified |
| LEARN-SAVE | Save/remove vocabulary persists context and video provenance | `ea1379c`, `1546662` | `test-batch-lifecycle.mjs`, `test-learning-features.mjs` | M-04 | Automated lifecycle passes; manual unverified |
| LEARN-YG | YouGlish opens the selected word in German | `1546662` | `test-popup-bindings.mjs` | M-05 | Source present; manual unverified |
| LEARN-REPLAY | Replay uses exact/estimated word timing and restores playback state | `1546662` | `test-popup-bindings.mjs`; lifecycle coverage to be expanded | M-06 | Source present; manual unverified |
| UI-DRAG | Caption overlay can be repositioned by pointer without breaking selection | `64875b8` | `test-popup-bindings.mjs` | M-07 | Source present; manual unverified |
| UI-STYLE | Transcript/translation have separate appearance and distinct default colors | `ea1379c`, `a2716b4` | `test-learning-features.mjs`, `test-batch-lifecycle.mjs` | M-08 | Automated settings pass; manual unverified |
| UI-GLASS | Popup, settings, captions, word card, diagnostics, and libraries share the Phase 2 glass visual system | Phase 2 `0.10.0` | `test-popup-bindings.mjs` | U-01–U-05 | Automated structure pass; manual unverified |
| UI-CONTROLS | Caption effective position rises above visible player controls without overwriting the saved base position | Phase 2 `0.10.0` | `test-learning-features.mjs`, `test-popup-bindings.mjs` | U-06–U-11 | Deterministic policy pass; real players unverified |
| UI-A11Y | Keyboard focus, accessible names/live regions, reduced motion, and native selection remain available | Phase 2 `0.10.0` | `test-popup-bindings.mjs` | U-12–U-17 | Source present; manual unverified |

## Transcript and acquisition contracts

| ID | Protected contract | Historical checkpoint | Automated evidence | Manual check | Baseline at `9b74b8c` |
|---|---|---|---|---|---|
| TR-CACHE | Complete cached transcript replays without new recognition | `923d8c9`, `1546662` | `test-batch-lifecycle.mjs`, `test-coverage.mjs` | M-09 | Automated lifecycle passes; manual unverified |
| TR-PARTIAL | Partial live coverage is not promoted as a complete title | `1546662` | `test-coverage.mjs` | M-10 | Automated pass; manual unverified |
| TR-SEEK | Covered rewind reuses cues; uncovered seek creates a new anchored epoch | `923d8c9` | `test-coverage.mjs`, `test-transcript-groups.mjs` | M-11 | Automated pass; manual unverified |
| TR-EXPORT | TXT and technical JSON exports preserve separate ASR/caption provenance | `923d8c9`, `1546662` | `test-learning-features.mjs`, lifecycle tests | M-12 | Automated helper pass; manual unverified |
| ACQ-YT | Public YouTube full-audio analysis remains available | `923d8c9` | `test-batch-lifecycle.mjs` | M-13 | 2026-07-23 user-run current-version success; detailed repeat-run M-13 evidence remains incomplete |
| ACQ-GENERIC | Clear MP4/HLS/DASH and embedded-player discovery remain available | `923d8c9`, versions `0.10.1`–`0.10.3` | `test-media-candidate.mjs`, `test-media-observer.mjs`, `test-network-media-observer.mjs`, `test-batch-lifecycle.mjs`, `test-browser-audio-fallback.mjs`, server HLS/wrapper tests | M-14 | 2026-07-23 user-run success on current-version YouTube, AniWorld, and AnimeKai; detailed multi-sample M-14 evidence remains incomplete |
| ACQ-LIVE | Inaccessible media falls back visibly to local live tab capture | `923d8c9` | `test-batch-lifecycle.mjs`, `test-browser-audio-fallback.mjs` | M-15 | Simulated pass; real browser unverified |
| SETUP-UPGRADE | Same-folder updates preserve extension identity, local models/runtime, settings, vocabulary, and transcripts | `643eab4` | Setup verification plus upgrade fixture still required | M-16 | Manual/upgrade evidence required |
| PRIVACY | Persistent records exclude audio, PCM, cookies, signed URLs, credentials, API keys, and DRM material | all, version `0.10.2` | Netflix lifecycle, fallback-persistence, technical-export, and targeted redaction tests | M-17 | 0.10.1 fallback URL leak fixed; full audit ongoing |

## Current restoration checkpoint

Version `0.9.6` adds deterministic selection/word-activation policy tests,
stronger selection handling across ShadowRoot and Window selection APIs, and
English word-card section titles. It remains **Experimental** until M-01 through
M-08 and the critical transcript smoke checks pass in a real browser.

Test procedures are in
[PHASE1_MANUAL_CHECKLIST.md](../experiments/PHASE1_MANUAL_CHECKLIST.md) and
[PHASE2_MANUAL_CHECKLIST.md](../experiments/PHASE2_MANUAL_CHECKLIST.md).

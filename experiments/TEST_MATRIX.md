# Experiment matrix

2026-10-28 caption-box hover candidate0.12.5:25syntax checks,29extension
suites/56server tests pass. Added padding characterization fails on0.12.4;
stable-box entry/exit and nonempty rerender/empty-hide ownership checks pass
after repair. Real pointer boundaries, drag and fullscreen are unverified.
Experimental; see `docs/test-results/0.12.5-caption-box-hover.md`.

2026-10-28 progressive YouTube candidate0.12.4:25syntax checks,29extension
suites and56server tests pass. A new blocked-translation/cache test fails on
0.12.3 because no source overlay starts, then passes after source-first repair.
Local mocks cover delayed/failed target/cache/native retrieval, stale navigation,
in-place render, preparation feedback and guarded autoplay/rejection/user intent.
No actual Chrome/media check; original paused-start cause unconfirmed. Experimental;
see `docs/test-results/0.12.4-progressive-start.md`.

2026-10-28 dropdown fit candidate0.12.3:24syntax checks,27extension suites,
56server tests pass; all popup select IDs/option values match0.12.2. Smaller
dropdown typography/full-width provider/concise labels applied; no real Chrome
native-dropdown or font/zoom fit check ran. Experimental; see
`docs/test-results/0.12.3-dropdown-typography.md`.

2026-10-28 user screenshot confirms0.12.1 menu opens but text is black/serif;
user clarifies pause-on-hover works when checked.0.12.2 styling repair passes
24syntax checks,27extension suites and56server tests, including menu-owned font/
color/contrast, On/Off semantics and close/focus/scroll retention. No real browser
rendering, mouse or platform check ran. Candidate Experimental; see
`docs/test-results/0.12.2-youtube-menu.md`.

2026-10-28 user reports0.12.0 automatic YouTube transcript works, but persistent
Starting/menu/hover UI fails.0.12.1 repair passes23syntax checks,27extension
suites and56server tests. Actual menu DOM/shared setting events and caption
hover delegation covered locally; browser rendering/physical hover not run.
See `docs/test-results/0.12.1-youtube-controls.md`.

2026-10-28 YouTube caption candidate0.12.0:23syntax checks,26extension suites,
56server tests pass locally with frozen/mocked player, native, network and storage
edges. Source priority, navigation cancellation, ads, timing provenance, translation
alignment/cache, concurrent library writes, no implicit ASR and global word toggles
covered. Actual YouTube/browser/audio/upgrade tests not run; manual gate unverified.
See `docs/test-results/0.12.0-youtube-captions.md`.

2026-10-28 typography candidate0.11.5:18syntax checks,23extension suites and
46server tests pass; local font/manifest/registration/isolation checks pass.
Browser font loading, Arabic and layout remain unverified. User review requested
before YouTube instructions. See `docs/test-results/0.11.5-typography.md`.

2026-10-28 saved-word review candidate0.11.4: local17syntax checks,
23extension suites/46server tests pass. Shared card DOM, offline saved data,
removal, stale responses, navigation and popup state covered with mocks. Browser,
speech and platform tests not run. See `docs/test-results/0.11.4-saved-word-review.md`.

2026-10-26 compact status candidate0.11.3: three JavaScript syntax checks and
six local suites pass (fake clocks, worker/session diagnostics, initialization,
bindings, localization, lifecycle, privacy). No browser/audio/translation checks.
See `docs/test-results/0.11.3-compact-status-ui.md`; real rendering unverified.

2026-10-26 user-run normal-browser translation setup: user reports it worked well;
pair/first-download/background conditions not supplied. New0.11.2 word-card UI
edits have static syntax/whitespace/source review only: user requested no functional
testing. No translation, playback, speech or analysis run. See
`docs/test-results/0.11.2-word-card-table-ui.md`.

2026-10-26 expanded grammar confirmation (application unchanged): 30 new entries,
case rules7/10, explicit verb bases7/10, conjugation tables10/10, complementary
primary infinitives9/10. Separate acceptance95/109 pass,14fail; old regression
passes. Native trusted-click Chrome control with extension uninstalled reports
progress0/1 but no translator by180seconds. Browser internal cause remains unknown;
normal-profile comparison needed. See `docs/test-results/0.11.1-expanded-grammar-and-chrome-control.md`.

2026-10-26: 0.11.1 WP1.3/WP2.4/WP3.5/WP0.3 scope tested without media capture.
21 extension suites/46 server tests/17 syntax checks pass; 60 German source
entries manually compared by GPT-6 Luna (36 development, 24 final, 12 unread
reserves). Case rules/conjugations and final definitions miss >95%; Chrome
English/Arabic creation times out with retry, so pack completion/background
behavior remains unverified. Synthetic migration/export privacy passes. Result
**Needs development**. Details: `docs/test-results/0.11.1-dictionary-readiness-persistence.md`.

Audio-recognition sessions use the audio that is actually playing. In the0.12.0
YouTube caption mode, platform subtitles are explicitly selected as input and
labelled with source provenance; they are never described as newly recognized
audio or used as their own recognition evaluation reference.

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
- For full-audio preparation, record discovery time, time to first decoded PCM,
  complete acquisition time, transcription time, transferred bytes, effective
  throughput, segment count, audio-only versus muxed source, and peak memory.
- Keep acquisition and ASR measurements separate. On HLS sites, a UI state
  labelled “decoding” may currently include network transfer time.

## Current-version user observations

Scoped browser acceptance on 2026-10-25 used clean isolated Chrome DevTools MCP
profiles, real German Wiktionary and a synthetic empty-video card fixture. Only
user-selected items 4/5/6/13 were tested: 23 scoped checks passed, 12 failed and
1 was inconclusive. Live dictionary/grammar, first-use Arabic translation, and
privacy persistence failures mean **Needs development** for this scope. No
transcription, speech, platform acquisition or other excluded category was
tested. See `docs/test-results/0.11.0-scoped-45613-browser-tests.md`.

These observations are useful browser evidence, not a platform-wide support
claim. A row becomes a full manual pass only after the pass/fail checks above
and the relevant regression checklist are recorded.

| Date | Platform/path | Observation | Classification |
|---|---|---|---|
| 2026-07-23 | Public YouTube batch analysis | The user confirmed the existing path still works after the generic HLS changes. | User-run success; detailed repeat-run matrix pending |
| 2026-07-23 | AniWorld embedded clear media | The user confirmed full-audio analysis now works; preparation can be noticeably slow on some mirrors. | User-run success; speed baseline and full M-14 checks pending |
| 2026-07-23 | AnimeKai PNG-wrapped clear HLS | The user confirmed the 0.10.3 browser path now works. | User-run success; multi-title coverage and full M-14 checks pending |
| 2026-08-07 | Local MP4 over `http://127.0.0.1:8050` | On 0.10.3 the bare Chrome media page disappeared when analysis changed the root layout, and the worker rejected the loopback source before decode. Version 0.10.4 contains bounded fixes for both causes. | Automated candidate; user browser retest pending |
| 2026-10-25 | AniWorld / first 0.11.0 Terra UI candidate | User screenshots show the popup and word card rendering, including an Arabic example line. The user requested smaller titles, themed scrolling, outside dismissal, sticky/collapsible settings, and target-language word details. | Rendering observations only; subsequent corrections unverified. Testing paused at user request; see `docs/test-results/0.11.0-terra-vocabulary-candidate.md`. |
| 2026-10-25 | AniWorld / German-only word-card candidate | User reported silent pronunciation and showed saved source title/context printed in the card. Source inspection confirmed metadata rendering and conditional local-German-voice selection; the machine-specific speech failure was not established. The follow-up separates case grammar, hides source metadata, groups sense-linked examples, and adds card-local voice availability/error states. | User-reported failure; follow-up source only, no automated or browser checks run. Testing remains paused; see `docs/WORD_CARD_FOLLOWUP_REPORT.md`. |
| 2026-10-25 | AniWorld / player discovery after word-card follow-up | User reported no-video discovery despite a visible, previously analyzed player. Local checks reproduced a content.js parse error before GET_MEDIA_CONTEXT could register. Parent fixed parsing, application-injection error propagation and stale-Complete diagnostics. | 15 extension suites, JS syntax and 46 server tests pass; real AniWorld/cached replay unverified. Local checks authorized; browser testing remains paused. See `docs/test-results/0.11.0-player-initialization-repair.md`. |
| 2026-10-25 | Edge / repeated AniWorld player discovery failure | User-authorized read-only inspection captured `Browser pronunciation helpers were not loaded` in the actual video tab. Optional speech initialization aborted discovery, and the premature version guard could suppress retries. Parent isolated optional speech and fixed initialization readiness/error propagation. | Browser cause observed; repaired local fixtures and all 17 extension suites/46 server tests pass. Extension/page were not reloaded; real post-repair acceptance pending. See `docs/test-results/0.11.0-optional-speech-startup-repair.md`. |

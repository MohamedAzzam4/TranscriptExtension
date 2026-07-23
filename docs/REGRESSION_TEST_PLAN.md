# Regression test plan

## Goal

Every version must prove both that its new behavior works and that previously
working behavior was not silently removed or broken.

This plan applies to prototype versions as well as future production releases.
The depth of testing changes with risk; the requirement to preserve historical
contracts does not.

## 1. Before implementation

1. Identify the roadmap WP and its dependencies.
2. Record the current branch, commit, extension version, browser, Windows
   version, recognizer mode/model, and affected platforms.
3. List every protected feature touched directly or through shared files.
4. Run the relevant pre-change tests. If the baseline already fails, record that
   before editing.
5. For a refactor or bug in untested behavior, add a characterization test that
   fails for the intended reason before replacing the implementation.

High-risk shared files include the content script, service worker, offscreen
decoder, media observer, popup/settings, storage schema, native host, installer,
and transcript cue schema.

## 2. Automated regression layers

### Layer A — Static and schema checks

- JavaScript syntax checks for extension entry points.
- Python syntax/unit discovery for server code.
- Manifest validity and expected extension version.
- Message names, popup element bindings, storage defaults, and migration tests.
- `git diff --check`.

### Layer B — Deterministic unit tests

- Segmentation and transcript grouping.
- Coverage merging, completion classification, and epoch anchoring.
- Candidate ranking and selected audio language/role.
- Translation and learning-data normalization.
- Subtitle/dub agreement classification.
- Redaction and stable video identity.

### Layer C — Lifecycle simulations

- Batch success, retry, cancel, failure, and live fallback.
- Browser-decoder success/failure and partial-media handling.
- Pause, seek, rewind, replay, and cache restoration.
- Complete versus partial transcript promotion.
- Settings, translation, saved vocabulary, and transcript-library persistence.
- Netflix research collection and stale-title rejection.

### Layer D — Upgrade and persistence

Install the new source over a copy of the previous version and verify:

- the extension ID is unchanged;
- `.venv`, `.runtime`, model caches, logs, and user configuration survive;
- browser-local settings, saved vocabulary, translation cache, and transcript
  records remain readable;
- migrations are explicit, idempotent, and preserve the previous record until
  success;
- `CHECK-SETUP.cmd` still reports actionable results.

## 3. Mandatory manual browser matrix

Automated tests cannot prove real playback and interaction. Use the smallest
authorized samples that cover the changed risk.

| Area | Mandatory checks |
|---|---|
| YouTube/public batch | Correct language, full preparation, first cue present, seek/rewind sync, cache replay, TXT/JSON export |
| Generic clear media | MP4 plus HLS or DASH; audio remains audible; correct duration/language; batch or explicit live fallback |
| Embedded player | Player detection inside the active frame, selected dub, no duplicate capture, rewind/cache behavior |
| Netflix research/acquisition | Multiple title/configuration clusters, visible stage/error, correct audio role, no stale title metadata, safe live fallback |
| Live transcription | Pause, resume, covered rewind, uncovered seek, partial stop, reopen behavior, provisional-to-final text |
| Captions/translation | Source and translation alignment, independent appearance, translation toggle, selectable/copyable text |
| Word learning | Click versus selection, organized definitions/examples, save/remove, YouGlish, clip replay and state restoration |
| Overlay | YouTube-like default, drag, resize, fullscreen, playback-control collision, word card placement |
| Library | Complete auto-save, partial-session honesty, reopen, download, delete, link, and retranscription when implemented |
| Setup/update | Beginner install on a clean test folder and same-folder update from the previous checkpoint |

For DRM services, test only player-exposed metadata and decoded audio the browser
is already authorized to play. Never test DRM bypass or key acquisition.

## 4. Change-risk requirements

| Change type | Minimum required evidence |
|---|---|
| Documentation only | Link/path validation, consistency review, `git diff --check` |
| Pure deterministic helper | Layers A–C for that domain plus all existing extension/server unit suites |
| Popup or overlay UI | Layers A–C plus manual captions, selection, word click, drag, fullscreen, and settings checks |
| Acquisition/decoder | Full automated suite plus affected platform and fallback manual matrix |
| Cue/storage schema | Full suite, upgrade copy, old fixture replay, partial/complete cache checks |
| Installer/native host | Server suite, clean-folder install, same-folder update, startup and health checks |
| Online provider/API key | Full provider contract, privacy/redaction tests, cancellation, rate-limit/error tests, and explicit upload disclosure |
| Refactor | All layers and the entire critical manual matrix; no reduced scope because output is intended to be “equivalent” |

## 5. Comparison with the previous version

For the same reference sample, compare:

- selected source, language, and main/audio-description role;
- acquisition mode and fallback reason;
- first/last cue presence and coverage;
- cue count, segmentation, obvious silence hallucinations, and sync offsets;
- repeat-run/cache behavior;
- translation availability and cue association;
- selectable text, word interaction, dragging, and replay;
- stored record count/schema and exported privacy fields;
- setup/update health.

A metric change must be explained. Faster is not a pass if accuracy, coverage,
privacy, or older interactions regress.

## 6. Result classification

### Pass

- All critical automated checks pass.
- All mandatory manual checks for the change risk pass.
- No protected historical feature is missing or inaccessible.
- Saved data and update behavior remain compatible.
- Diagnostics and privacy checks pass.
- Evidence, branch, and commit are recorded and pushed.

### Experimental

- The bounded experiment meets its stated criteria.
- Unsupported scope and sample limitations are visible.
- It does not replace a passing path or claim general platform support.
- Critical unrelated regressions are absent.

### Needs development

Use this result when any of the following occurs:

- a critical or previously passing feature fails;
- a feature remains in source but is unusable in the actual browser;
- a partial transcript is classified as complete;
- the wrong language/audio role/caption source is used;
- sync, seek, rewind, replay, selection, or dragging regresses;
- failure is hidden behind a misleading success state;
- secrets, signed URLs, DRM data, audio, or PCM enter persistent diagnostics;
- required testing was skipped or evidence is insufficient.

### Blocked

Record the exact external blocker and the unrun checks. Do not call the version
passed and do not repeatedly “fix” unrelated code to work around missing access.

## 7. Version evidence record

Include this in the version notes or a committed test-results document:

```text
Version:
Roadmap WP:
Branch and commit:
Previous comparison commit:
Changed contracts:
Environment:
Automated tests:
Manual samples/platforms:
Upgrade test:
Privacy/redaction check:
Known limitations:
Result: Pass | Experimental | Needs development | Blocked
```

## 8. Release checkpoint

Only after classification:

1. update relevant documentation and version metadata;
2. commit intended changes;
3. push the branch to `origin`;
4. tell the user exactly what passed, what was not tested, and what remains.

The generated ZIP or package must identify the same committed source. Never hand
off a package built from uncommitted or unpushed code without saying so.

# Project agent instructions

These instructions apply to every future change in this repository.

## Product stage

Dub Transcript Lab is currently a prototype for validating the core idea:
reliable audio acquisition, transcription, synchronization, translation,
caption reuse, and language-learning interactions across different video
platforms.

Do not begin a production/SaaS rewrite, large architectural refactor, public
launch hardening, or website implementation until the user explicitly declares
the core experiments successful. Prototype code may be replaced later, but
working behavior must be preserved and measured now.

## Coding fingerprint

The recognizable style of this codebase should be **observable, reversible, and
source-honest**.

- Prefer explicit state machines and named lifecycle stages over hidden control
  flow. A user and a developer should be able to tell whether the system is
  discovering, downloading, decoding, transcribing, translating, caching, or
  falling back.
- Treat diagnostics as part of the product. Important decisions and failures
  must be visible in the extension, with deeper sanitized evidence available in
  technical exports.
- Keep boundaries sharp: platform discovery, audio acquisition, decoding,
  transcription, cue normalization, translation, persistence, and rendering
  should communicate through small documented contracts.
- Put deterministic transformations in small pure functions where practical.
  Keep browser, network, storage, and native-host side effects at the edges.
- Use descriptive domain names such as `candidate`, `representation`, `epoch`,
  `cue`, `coverage`, and `videoIdentity`. Avoid vague names and magic booleans.
- Prefer graceful, explicit degradation. An unsupported batch source may fall
  back to live transcription, but the fallback reason must not be hidden or
  reported as batch success.
- Make temporary actions reversible. Seeking for word replay, pausing for
  analysis, changing captions, or probing audio must restore the user's prior
  playback state whenever possible.
- Preserve provenance. Never describe translated subtitles as the spoken dub,
  partial coverage as a complete transcript, an estimate as an exact timestamp,
  or a cached result as a new recognition run.
- Keep local-first privacy boundaries visible in code. Do not persist signed
  media URLs, cookies, authorization data, DRM material, API keys, compressed
  audio, or PCM in experiment and library records.
- Comments should explain invariants, platform quirks, and reasons—not restate
  the next line of code.
- Clean code still wins over personal cleverness. The fingerprint comes from
  clarity, evidence, and careful user-state restoration, not unusual syntax or
  abstraction for its own sake.

## Preserve historical behavior

User-visible behavior that worked in an earlier checkpoint is a compatibility
contract until the user explicitly removes it.

- Do not delete, hide, or replace a feature merely because it is unrelated to
  the current task.
- Before editing shared content-script, popup, storage, acquisition, or
  lifecycle code, inspect the feature registry and relevant historical commit.
- Before refactoring working code, add characterization tests for its current
  behavior.
- Source code or documentation saying a feature exists is not proof that it
  works. It needs automated coverage where possible and a manual browser check
  where necessary.
- If a requested change conflicts with an older feature, preserve both when
  reasonable; otherwise explain the conflict and ask before removing behavior.

Pay special attention to the historically implemented interactions that the
user has reported as regressions before: natural text selection/copy, clickable
word analysis, saved vocabulary, YouGlish, replaying the exact word fragment,
caption dragging, bilingual appearance controls, cached transcript replay, and
generic embedded-player support.

## Development memory

Do not rely only on chat memory. Before planning or implementing a version,
read the relevant parts of:

- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/REGRESSION_TEST_PLAN.md`
- `docs/PRODUCT_BACKLOG.md`
- `experiments/TEST_MATRIX.md`
- the latest Git history and the historical checkpoints named in the roadmap

Update the roadmap or regression record when a feature, dependency, platform
finding, data contract, or known limitation changes. A future agent must be able
to reconstruct what was tried, what passed, what failed, and why from the
repository.

## Work-package planning

Non-trivial work should be tied to a roadmap work package (WP). State:

1. the WP identifier and outcome;
2. its dependencies;
3. the tests and evidence required;
4. whether the result passed, remains experimental, or needs more development.

Do not implement a dependent WP before its prerequisite contract is stable
unless the work is an explicitly isolated experiment.

## Regression discipline

Every code version must follow `docs/REGRESSION_TEST_PLAN.md`.

At minimum:

1. Record the pre-change baseline and affected feature contracts.
2. Run the automated suites relevant to the change.
3. Run the critical cross-feature regression suite, not only new tests.
4. Perform the required manual browser/platform checks for the risk class.
5. Compare saved data, UI behavior, diagnostics, and fallbacks with the previous
   checkpoint.
6. Mark the version **Pass**, **Experimental**, or **Needs development** using
   the roadmap criteria.

A new feature does not pass when it silently breaks or removes an older feature.
If a check cannot be run, record it as unverified; do not convert missing
evidence into a pass.

## Project release checkpoint policy

When a version or named checkpoint is completed:

1. Run the relevant validation and regression checks.
2. Commit only the intended source, tests, and documentation.
3. Push the current branch to `origin`.
4. Report the version, branch, commit identifier, tests, and known limitations
   to the user.

Do not describe a version as saved or complete if the push has not succeeded.
If pushing is blocked, report the blocker explicitly instead of leaving the
checkpoint only in the local repository.

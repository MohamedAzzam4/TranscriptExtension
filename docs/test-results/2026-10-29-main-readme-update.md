# Main repository and README update

2026-10-29. WP0.1/WP0.2, baseline5882965 on codex/local-media-loopback.
Extension0.12.5 /worker0.12.1 unchanged. Plan: `../MAIN_REPO_UPDATE_PLAN.md`.
User explicitly requests updating the main repository and README.

## Scope and promotion

Fetched main/development refs. origin/main8dd1d6a is an ancestor34commits behind
the current baseline, with no main-only commits. Promotion is a normal
fast-forward, preserving main history and current committed feature work.
No force push or production rewrite. Existing local native-host.exe modification,
archives, .opencode, browser smoke/UI artifacts and personal runtime stay excluded.
Current working branch is retained; updating main does not require moving the
dirty working tree. Commit/push results are verified through Git refs.

README replaced stale audio-first YouTube and English-Wiktionary claims with:
creator-first/original-automatic retrieval, source-first rendering, target-language
translation, German-only cards, voice, shared whole-box hover/highlight settings,
saved-word review/history and timing/source provenance. It explains browser-only
versus full Windows installation, friend distribution, Python discovery/path
recovery, decoder compatibility and same-folder updates. Current limits, privacy,
development commands and evidence links remain explicit. Existing-install guide
updated alongside README so linked instructions no longer claim0.9.4 is current.
Historical acquisition/cache behavior is retained as context, not deleted.

## Validation

- 25 application JavaScript syntax checks and29 extension suites pass.
- 61 server tests and Windows PowerShell Python-discovery suite pass.
- 23 local Markdown links across README/update guide/plan resolve; referenced
  install/check/uninstall/regression/advanced entry points exist. README component
  versions match manifest/worker constants. Intended diff and whitespace pass.
- Full runner log: `../../test-artifacts/main-readme-update/regression.log`.
  Project .venv/workspace temporary directory used. Later edits only add/update
  documentation; no implementation, dependency, binary, schema or preference change.

Documentation checks **Pass**. Main promotion does not turn missing browser or
platform evidence into a pass. No browser/playback/voice/network/media/model
download, clean install, upgrade or native registration test ran. Existing
browser-testing pause, dictionary acceptance gaps and broader Experimental/Needs
development classification remain. The promoted source is the current prototype,
not a declaration of a public-production release or successful platform gate.

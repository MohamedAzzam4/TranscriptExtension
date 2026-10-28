# Worker 0.12.1 — PyAV metadata compatibility

2026-10-28. WP0.2/WP0.3. Baseline 24a4b32 on codex/local-media-loopback.
Extension stays 0.12.5. Plan: ../PYAV_COMPATIBILITY_FIX_PLAN.md.

## Cause and baseline

Friend's generic-site candidates all fail before opening media with unexpected
metadata_errors. Actual friend package version/site/sample are not available.
Local Python 3.12.14, PyAV 18.0.0 and faster-whisper 1.2.1. The PyAV 19 upstream
changelog removes this keyword; faster-whisper's own file decoder also passes it,
while its requirement is only av>=11. The direct dependency was previously
unconstrained. Different installation dates can therefore explain this report.
Extension 0.12.5 versus worker 0.12.0 is not by itself an invalid pairing.

Baseline 56 server tests pass. Two new tests reproduce the exact keyword error
under the PyAV 19 call signature in both direct and wrapped-HLS paths before the
fix. These are API-boundary fixtures, not an installed PyAV 19 binary test.

## Changed contracts

- A narrow open helper preserves metadata_errors=ignore on supported PyAV and
  retries without that argument only on the exact unsupported-keyword TypeError.
  Headers, format and buffer settings remain intact. Other argument, HTTP,
  authentication and decoder failures retain their original cause.
- Worker becomes 0.12.1. Fresh installs pin the locally tested av==18.0.0 for
  faster-whisper's file-helper compatibility too. No local package was replaced.
- No extension JS/manifest, native-host binary, source ranking, language choice,
  storage, translated/source captions or replay/learning interaction changed.
  Existing-install instructions explain the small file update and optional
  local-venv decoder repair. No reinstall or model download is required.

## Validation

- 25 JavaScript syntax checks and all 29 extension suites pass.
- 61 server tests pass (baseline 56 + five compatibility/pin tests).
- Strict new API fixtures decode real synthetic PCM/WAV with local PyAV 18,
  covering direct and wrapped-HLS call sites. Wrapped transport itself is mocked;
  this does not prove real MPEG-TS/HLS playback.
- Legacy metadata handling, unsupported-keyword-only fallback, no retry of
  unrelated TypeErrors/HTTP failures, HTTP headers, MPEG-TS format and decoder
  requirement are checked. Version diagnostics expectation is updated.
- Windows PowerShell Python discovery suite and git diff --check pass.
- No site URLs, cookies, credentials, compressed user media or real PCM are
  persisted; fixture PCM is synthetic in memory. No network/media/model request,
  browser playback, recognizer restart or dependency installation was performed.
- Existing unrelated native-host.exe change, archives, .opencode and browser
  smoke artifacts are excluded from the commit/package.

Friend's retry, real clear MP4/HLS, live fallback/timing, clean installation,
same-folder upgrade and browser manual matrix remain unverified. Prior browser
testing pause is preserved. No claim of site-wide successful transcription.

Result: **Experimental**, pending friend/platform acceptance. Full regression
passed locally. Release commit is identified by Git history/package record.

Sources inspected through Context7: PyAV upstream CHANGELOG.rst (v19.0.0) and
av/container/core.py; local installed av.open docstring, faster_whisper/audio.py
and package metadata. Stable web docs still describe the older keyword API.

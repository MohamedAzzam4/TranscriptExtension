# Windows installer Python discovery repair

2026-10-28. WP0.2, baseline88372cf /extension0.12.5 on
codex/local-media-loopback. Installer-only checkpoint; extension version and
behavior unchanged. Plan: `../PYTHON_DISCOVERY_FIX_PLAN.md`. Historical643eab4
installer and development/regression/protected-feature memory reviewed.

## Report, reproduction and cause

Friend installed Python3.12 and repeated installation in the same folder, but
setup still reports no Python. Exact remote path/error is unavailable, so their
individual cause is unconfirmed. Python3.12 remains supported; no further
reinstallation is required merely to repair discovery.

Local baseline Windows PowerShell5.1 install.ps1 -DryRun reproduces:
py.exe : No suitable Python runtime found, NativeCommandError at the version
probe. Get-CompatiblePython launches312/311/313 before validating candidates,
with ErrorActionPreference Stop and stderr redirected outside a try block.
A missing selector terminates the search even if another selector succeeded.
Additionally, PATH/launcher-only discovery misses registered/custom installations.

## Bounded repair

- New server/python-discovery.ps1 isolates read-only discovery. Search PythonCore
  PEP514 per-user/machine/32-bit registry views, common per-user/Program Files/
  system-drive folders, application PATH entries and py -0p installed-runtime
  listing. Do not launch every minor selector. Prefer named312/311/313 folders;
  trust the executable's actual version report, not its name.
- Execute bounded8-second probes with independent stdout/stderr collection and
  no visible process window. A missing/broken executable, failed launcher listing,
  native stderr or timed-out probe cannot abort later candidates. Discovery does
  not opt the launcher into runtime installation. Probe uses isolated Python mode.
- Accept64-bit3.11/3.12/3.13; report unsupported version/32-bit/invalid response
  clearly. Skip unverified Microsoft WindowsApps execution aliases. Keep direct
  -Python executable path, adding quoted-folder handling.
- Interactive failure offers paste-path retry; DryRun/NonInteractive never
  prompt. Existing install command forwarding, setup steps, CPU/GPU choices,
  model downloads, native registration/autostart and data remain unchanged.
- README documents explicit-path recovery. Current Python Windows/launcher/
  PEP514 documentation fetched through Context7 for discovery conventions.

## Validation

- 25 JavaScript syntax checks,29 extension suites and56 server tests pass.
- New Windows PowerShell5.1 discovery suite passes: real project64-bit3.12,
  quoted explicit folder; missing/failed executable and native stderr; bounded
  timeout; registry/common candidates without PATH/launcher; unsupported3.14,
  32-bit and malformed response; Windows alias; actual common-folder adapter;
  mocked PEP514/list adapter with spaces; interactive paste-path recovery.
  Adapter fixtures are not proof of a fresh machine's registry layout.
- Automatic install.ps1 -DryRun succeeds with actual3.13 while default PATH
  Python is3.14. Explicit project3.12 -DryRun also succeeds. No downloads or
  registration/startup changes occur. Sandbox LOCALAPPDATA differs from the
  user's normal path; standard USERPROFILE/AppData/Local fallback finds3.13.
- Regression runner now includes the discovery suite under Windows PowerShell.
  PowerShell parser and intended diff/whitespace review pass.
- Logs: `../../test-artifacts/python-discovery/regression.log` and `dry-run.log`
  in the same folder. Project .venv/workspace temporary paths used. Unrelated
  native-host.exe, archives, old artifacts and user environment excluded.

Candidate **Experimental**. Friend's actual retry, clean-folder dependency/model
installation, same-folder upgrade, native registration/autostart/recognizer
health and browser/manual platform gates remain unverified. No full installer,
network/package download, browser, recording or transcription check ran.

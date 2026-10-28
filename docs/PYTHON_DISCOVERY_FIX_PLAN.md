# Installer Python discovery — WP0.2

2026-10-28. Baseline88372cf /0.12.5, codex/local-media-loopback.
Dependencies: Windows installer643eab4 and existing Python3.11–3.13 dependency
contract. Registry/roadmap/regression/backlog/matrix read. User confirms friend
installed3.12; exact path/error remains unavailable. No remote cause claimed.

Baseline local Windows PowerShell5.1 install.ps1 -DryRun fails at launcher probe
with NativeCommandError: No suitable Python runtime found. Python313 is installed;
the function probes312/311/313 with ErrorActionPreference Stop outside a try block.
A missing selector aborts search, even if another selector succeeded. PATH-only
fallback also misses registered installations not in the inherited environment.

Bounded installer repair: isolate discovery, tolerate failed launcher discovery,
read PEP514 registry and standard install folders/PATH, probe actual executables
with bounded stdout/stderr handling, and retain supported version/64-bit checks.
An explicit executable/folder path remains supported; interactive discovery
failure offers paste-path retry instead of requiring reinstallation. DryRun and
NonInteractive never prompt or install. Do not expand supported ML versions.

Tests: Windows PowerShell5.1 fixture probes and missing-launcher/runtime cases,
PATH-independent registered/common candidates, quoted/custom path, malformed/
failed/timed-out/wrong-version/32-bit executable, successful read-only installer
dry-run. Run full local regression and record evidence. No clean-PC install,
dependency/model download, browser/registration/autostart mutation authorized by
this diagnosis. Those gates and friend's actual machine remain unverified.
Record Experimental, commit/push intended changes only. No extension UI changes.

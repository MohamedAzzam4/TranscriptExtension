# PyAV metadata API compatibility repair

2026-10-28. WP0.2/WP0.3: reproduce the decoder dependency failure with a local
audio fixture and protect the fix with cross-feature regression. Baseline
24a4b32, codex/local-media-loopback, extension 0.12.5 / worker 0.12.0.

## Outcome and dependencies

Preserve the existing direct and PNG-wrapped HLS acquisition contracts while
accepting both legacy PyAV metadata handling and the PyAV 19 API. Prerequisites:
existing ranked acquisition, language selection, FFmpeg headers, local PCM
resampling, honest fallback and diagnostics. No phase/UI/production rewrite.

The user's friend reports metadata_errors rejected for every candidate. Local
Python 3.12.14 has PyAV 18.0.0; its av.open accepts that keyword. Official PyAV
19 changelog removes metadata_errors/metadata_encoding and uses native UTF-8
with surrogateescape. The friend's actual package version is not yet observed.
The same error can be reproduced by applying the new signature to the old
worker, before any site/network/ASR operation.

## Bounded change

- Route only the two worker av.open calls through a small compatibility helper.
- Keep metadata_errors=ignore when supported; retry without that keyword only
  for the exact unsupported-keyword TypeError. Do not retry network/codec or
  unrelated TypeErrors, drop headers, reset format/options, or hide failures.
- Pin av==18.0.0 for fresh installs: installed faster-whisper 1.2.1 accepts
  av>=11 and itself passes metadata_errors in its file decoder. This keeps
  setup on the locally tested dependency instead of silently drifting.
- Increment worker to 0.12.1; extension remains 0.12.5. Their versions are
  independent and their numerical mismatch alone is not the root cause.
- Preserve native host binaries, caches/models, browser storage, source order,
  YouTube captions, word features and all existing fallback behavior.

## Evidence and result boundary

Baseline server suite: 56 passed. Before implementation, new direct and wrapped
HLS tests fail with the same metadata_errors TypeError. Their media-open boundary
uses PyAV 19's signature and installed PyAV 18 for actual synthetic PCM/WAV decode.
After implementation require both tests, legacy behavior, unrelated-error
propagation, dependency pin, and the full extension/server/installer runner.

Required real-site HLS/MP4, live fallback, friend's installed decoder/version,
clean installation/update and actual browser interaction remain unverified;
no site URL/sample was supplied and prior browser-testing pause is retained.
This repair is Experimental pending those acceptance checks. Do not describe
the API fixture as a real PyAV 19 binary or a remote site/HLS decoder test.

Sources: PyAV upstream CHANGELOG.rst and av/container/core.py obtained through
Context7; local installed av.open docstring and faster_whisper/audio.py.

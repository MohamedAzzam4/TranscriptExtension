# Netflix Audio Research Mode

## Purpose

Netflix does not expose one stable audio shape for every title. Before changing the
full-audio transcription pipeline again, Dub Transcript Lab needs a repeatable dataset
covering movies, series episodes, audio roles, codecs, subtitle types, browser support,
and CDN delivery behavior.

Version 0.9.5 adds a temporary **Netflix audio research** panel. It inspects the current
title without starting Whisper or retaining the media.

## What primary sources establish

- Netflix says audio and subtitle availability can vary with location, profile language,
  title, device, season, and episode. Licensing and show agreements also affect which
  languages exist:
  <https://help.netflix.com/en/node/101798>
- Netflix describes audio delivery as adaptive to device and bandwidth. It also publishes
  different bitrate ranges for 5.1 and Atmos:
  <https://about.netflix.com/en/news/bringing-studio-quality-sound-to-netflix>
- Netflix's German timed-text guide says German SDH for dubbed content should use the
  dubbing script or dubbed audio as its basis and should match it as much as timing and
  reading speed allow. Standard translated subtitles and forced-narrative tracks have
  different purposes:
  <https://partnerhelp.netflixstudios.com/hc/en-us/articles/217351587-German-Timed-Text-Style-Guide>
- The WebCodecs AAC registration identifies xHE-AAC as `mp4a.40.42`. Extended HE-AAC
  access units must be raw AAC and the decoder configuration uses an
  `AudioSpecificConfig`. Browser implementations are not required to support every AAC
  profile:
  <https://www.w3.org/TR/webcodecs-aac-codec-registration/>
- WebCodecs configuration support is best-effort and may change with the available
  platform resources:
  <https://www.w3.org/TR/webcodecs/>
- Common Encryption initialization data uses `pssh` boxes. The presence of protection
  metadata can be detected without recording license messages, keys, or initialization
  payloads:
  <https://www.w3.org/TR/eme-initdata-cenc/>

## Report schema

Each report contains:

| Area | Recorded fields |
|---|---|
| Identity | Netflix watch ID, observed title, series/episode fields when exposed |
| Catalog shape | movie/episode/unknown, release year when exposed, duration |
| Environment | extension version, Chromium family/major version, platform, WebCodecs availability |
| Playback protection | MediaKeys attached, encrypted event observed, MP4 protection signals |
| Audio inventory | languages, labels, main/audio-description role, selected flag, channels |
| Representations | codec/profile hint, bitrate, channel count, representation index, mirror count |
| Subtitle inventory | language, SDH/CC, forced narrative, selected flag |
| Delivery | HTTP status, range behavior, reported entity size, short/full-sized classification |
| MP4 initialization | brands, fragmentation, codec, sample entry, sample rate, channels, protection boxes |
| Decoder capability | `AudioDecoder.isConfigSupported()` result; no sample decoding |
| Optional alignment | ASR/caption sample duration, word counts, estimated agreement, classification |

Unknown values stay `null` or `unknown`; the collector does not infer a release year or
movie/episode type from duration.

## Privacy and DRM boundaries

The research report does **not** store:

- audio bytes;
- complete media URLs or query tokens;
- cookies, authorization headers, profile/account data;
- DRM initialization payloads, license requests, licenses, content keys, or decrypted
  media.

For each unique selected-language representation, the collector requests no more than the
first 2 MiB from one CDN mirror, parses structural metadata, clears the working byte array,
and retains only the fields listed above. CDN mirrors are counted, not repeatedly
downloaded.

This research mode detects protected content; it does not bypass or defeat protection.

## Subtitle-to-dub matching

A same-language subtitle track is not automatically marked as dub-matching.

The report uses three levels:

1. **Metadata candidate** — a German SDH/CC track exists and is a reasonable candidate
   under Netflix's published German guidance.
2. **Sample estimate** — a manually collected ASR/caption sample is compared after
   accessibility cues such as `[Musik]` are removed.
3. **Unknown** — not enough speech/caption text was collected, or only a standard/forced
   subtitle track exists.

Current sample thresholds:

- at least 20 seconds of overlapping data;
- at least 30 ASR words and 30 caption words;
- agreement at or above 72%: `likely-dub-matching`;
- agreement below 42%: `likely-not-dub-matching`;
- values between those thresholds: `uncertain`.

These labels are estimates because ASR errors can lower the score.

## Manual collection protocol

1. Reload the Netflix player page after installing/reloading version 0.9.5.
2. Start playback once.
3. Select the intended audio explicitly, for example **Deutsch** rather than
   **Deutsch – Audiodeskription**.
4. Open Dub Transcript Lab and click **Analyze this Netflix title**.
5. Export the report JSON if a single-title inspection is needed.
6. To test subtitle wording, enable the same-language Netflix subtitle, collect
   20–60 seconds using the normal live experiment, stop it, then click
   **Attach latest ASR + caption sample**.
7. Use **Dataset CSV** after several reports have been collected.

The collector never changes Netflix audio/subtitle selections and never drives the
website automatically.

## Suggested sample matrix

Collect multiple observations in each category:

- movie and episode;
- German-original and German-dubbed content;
- main audio and audio description;
- stereo and 5.1 where exposed;
- German standard subtitle, German SDH/CC, forced narrative, and no German subtitle;
- older and recent release-year buckets;
- short and long durations;
- AAC-LC, HE-AAC, xHE-AAC, E-AC-3, and other observed profiles;
- successful range response, ignored range, short entity, and inspection failure;
- at least two Chromium versions or Windows machines when practical.

The goal is to identify stable representation families and failure clusters before the
production acquisition pipeline is changed again.

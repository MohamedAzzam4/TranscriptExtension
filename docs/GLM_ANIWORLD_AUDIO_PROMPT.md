# Prompt for GLM: AniWorld audio acquisition

Copy everything below the separator into GLM.

---

You are an autonomous coding and testing agent working in this repository:

`D:\Programming\Antigravity-Projects\Transcript_Extension`

Your single objective is to make and test a reliable **audio-acquisition probe** for AniWorld-style embedded video providers. Do not transcribe, translate, or generate subtitles. Do not start WhisperLiveKit and do not construct or run a Faster-Whisper model. Success means proving that the selected German dub becomes valid local PCM audio.

Read these files completely before changing code:

1. `AGENTS.md` if present anywhere applicable to the workspace.
2. `README.md`.
3. `docs/ANIWORLD_AUDIO_ACQUISITION_PLAN.md`.
4. `experiments/TEST_MATRIX.md`.
5. The existing extension and native-host files involved in media discovery, tab capture, the AudioWorklet, and batch source decoding.

The existing YouTube implementation at version 0.6.4 is a working regression baseline. Preserve it.

## User authorization and browser behavior

The user authorizes you to edit and test this local extension and to use a **visible browser** on the user-specified public test page. Never run the browser hidden.

You may use ordinary visible browser actions to select a provider and start or pause playback. Ask the user to act when a language choice, ambiguous player control, CAPTCHA, login, popup, or extension reload cannot be handled reliably. Do not pretend an action succeeded when you cannot observe it.

Do not:

- bypass DRM/EME, paywalls, authentication, CAPTCHA, anti-bot measures, or access controls;
- copy cookies, local storage, account credentials, or authorization headers into native tools;
- click advertisements, enable notifications, install software offered by a streaming page, or weaken browser security;
- save or distribute a complete copyrighted audio/video track;
- commit signed media URLs, query tokens, cookies, or diagnostic WAV files;
- run Whisper or judge transcript accuracy.

Use only content the user is authorized to access. A 10-second local diagnostic WAV is the maximum persistent media artifact needed for this task.

## Initial test target

Start with the user’s currently open AniWorld episode if one is available. Otherwise ask the user for the exact test URL. The earlier experiment used:

`https://aniworld.to/anime/stream/hunter-x-hunter/staffel-1/episode-1`

Initial provider labels seen on that page were:

- VOE
- Doodstream
- Filemoon
- Vidmoly

Provider availability can change. Record what is actually visible instead of assuming all four remain available.

## Required implementation sequence

### 1. Establish the baseline

- Inspect the dirty worktree and preserve unrelated user changes.
- Run the existing local tests before editing.
- Map the current all-frame video discovery and tab-capture flow.
- Confirm that the existing offscreen code currently requires a WhisperLiveKit WebSocket before forwarding PCM; do not reuse that requirement in probe mode.

### 2. Implement a recognizer-free tab-audio probe

Add a clearly labeled development action such as **Capture 10-second audio probe**.

The probe must:

- begin only after a user gesture;
- find the active video across accessible frames;
- use `chrome.tabCapture` and the existing offscreen AudioWorklet;
- keep tab audio audible by routing it back to the AudioContext destination;
- collect mono 16 kHz PCM16 chunks without opening a WebSocket;
- capture exactly 10 seconds of playing audio;
- stop and release MediaStream tracks, AudioWorklet nodes, timers, and AudioContext resources;
- compute duration, byte count, chunk count, RMS, peak, silent/all-zero ratio, and clipping ratio;
- optionally export one 10-second WAV plus a sanitized JSON report;
- stay separate from transcript experiment state and not damage a completed experiment.

Add unit tests for probe lifecycle, bounded size, PCM metrics, WAV header/length if WAV export is implemented, and cleanup after failure.

### 3. Add structured frame/source diagnostics

For every video-bearing frame, report sanitized metadata sufficient to explain selection:

- frame hostname, size, visibility, readiness, paused state, current time, and duration;
- current source type: direct HTTP, HLS, DASH, blob, empty, or unknown;
- encrypted-media/DRM signal;
- candidate count, candidate type, and candidate hostname/path without query values;
- media-target score and selection reason.

Never write full signed URLs or query strings to durable logs.

### 4. Implement a decode-only offline source probe

Do not call the transcription worker merely to test a URL. Add a small `probe_audio_source` path, either as a native-host command with shared helpers or as a focused decode-only module.

It must:

- reuse public-URL validation and safe header cleaning;
- accept only allowlisted headers such as User-Agent, Referer, and Origin;
- try discovered candidates in a meaningful order rather than taking the first URL blindly;
- use PyAV to decode a short window to mono 16 kHz PCM;
- never instantiate `WhisperModel`;
- stop after enough audio exists to validate the source;
- return stream metadata, decoded seconds, PCM statistics, elapsed time, and sanitized errors;
- continue to the next candidate after a normal provider failure;
- treat blob-only, encrypted, cookie-dependent, or inaccessible players as Level 1/live-only rather than trying to bypass them.

A candidate passes only if actual non-silent PCM was decoded. Discovering an `.m3u8`, `.mpd`, or `.mp4` URL by itself is not a pass.

### 5. Test and iterate provider by provider

Use the visible browser. Work on one provider at a time.

For each available provider:

1. Ensure the German dub is selected.
2. Start the intended episode player and ensure it is the only audible player.
3. Run the 10-second tab probe.
4. Ask the user to confirm the short WAV is the intended German dub.
5. Run the offline candidate probe only when a public non-DRM candidate exists.
6. Record Level 1 and Level 2 separately.
7. On failure, inspect concrete diagnostics, make the smallest generic fix, run tests, reload the extension, and repeat the same provider.
8. Move to the next provider only after the result is reproducible or the exact limitation is documented.

Do not stop at the first error, but do stop and ask the user if progress requires credentials, CAPTCHA, ambiguous external navigation, security weakening, DRM circumvention, or permission to retain/download more than a short diagnostic sample.

### 6. Preserve regressions and produce evidence

After each code iteration, run focused tests. Before handoff, run the full existing JS and Python suite plus all new probe tests.

Create a sanitized provider matrix containing:

- provider label;
- frame hostname;
- source type;
- DRM reported yes/no;
- Level 1 pass/fail;
- PCM duration/bytes/RMS/peak/silent ratio;
- user-confirmed German dub yes/no;
- Level 2 pass/fail/not-applicable;
- candidate count and selected candidate type;
- time to first decoded PCM;
- exact sanitized failure reason;
- whether future full-video preparation appears feasible or the provider is live-only.

Keep full media URLs and probe WAV files out of source control.

## Engineering rules

- Prefer a generic solution for nested cross-origin players, blob/MSE players, HLS, DASH, and direct files.
- Add provider-specific code only after evidence proves the generic path cannot express a stable requirement.
- Never solve a detection problem with a hardcoded URL token or temporary signed URL.
- Preserve normal tab audibility during `tabCapture`.
- Ensure stop, provider switch, seek, pause, and page reload clean up resources.
- Keep the YouTube 0.6.4 behavior and tests working.
- Use `apply_patch` for source edits.
- Do not overwrite or revert unrelated changes.
- Communicate short progress updates at meaningful checkpoints.

## Definition of done

Do not claim completion until:

- a 10-second recognizer-free PCM/WAV probe has passed and the user confirms the selected dub;
- every currently available provider has a reproducible Level 1 result;
- every Level 2 claim is backed by actual PyAV-decoded PCM;
- failures are classified precisely as blob-only, DRM, inaccessible/expired URL, headers rejected, no audio stream, wrong frame/player, silence, or another evidenced category;
- lifecycle cleanup and regression tests pass;
- the final response lists changed files, test commands/results, provider matrix, remaining limitations, and exact manual steps for the user.

Begin by reading the required files and running the existing tests. Then implement the isolated 10-second tab-audio probe before testing providers. Do not begin with Whisper or transcription.

---


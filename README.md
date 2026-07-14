# Dub Transcript Lab

A deliberately small experiment for transcribing the selected browser video's actual audio. It first tries to prepare the complete transcript locally from an authorized non-DRM source; when that is unavailable, it captures the decoded tab audio live. If a video is using a German dub, the German dub is transcribed. Existing captions never feed the recognizer; the extension only records them in a separate stream for later comparison.

This is not the full commercial extension. It is a YouTube-first harness for answering the risky questions before building product UI, translation, word definitions, accounts, or billing.

## How it works

1. After the user clicks **Analyze automatically**, the Manifest V3 extension pauses the selected player and inspects its media source inside the correct frame.
2. A public YouTube page or accessible non-DRM HTTP MP4/HLS source is decoded by PyAV and transcribed in one local Faster-Whisper batch job. Public YouTube source resolution uses `yt-dlp`; no browser cookies are copied to the helper. YouTube analysis keeps the best available audio track, downloads it in sequential 8 MB HTTP ranges, reports the measured transfer rate, and deletes the temporary file immediately after decoding. If that download is rejected, the original direct decoder is tried before the header-aware streaming fallback.
3. If no safe batch source is available, the extension automatically falls back to decoded tab capture, 0.5-second mono 16 kHz PCM chunks, and the local WhisperLiveKit WebSocket.
4. Both pipelines produce the same timestamped cue format and cache it in `chrome.storage.local`.
5. In YouTube batch mode, the available manual caption track in the requested language is stored as an evaluation-only reference; the original-language automatic track is the fallback. Live mode continues to sample visible YouTube captions or active HTML5 text-track cues. Neither path feeds captions into ASR.
6. A completed batch covers the full media timeline. In live mode, rewind replays the recorded audio coverage, including silence, and capture resumes only after playback leaves it.
7. Transcript words are clickable inside the video player. A click opens an inline German definition card backed by German Wiktionary.
8. WhisperLiveKit word timestamps are grouped at completed sentence, natural phrase, silence, or bounded-length breaks. The player combines those cues into sentence-aware display blocks capped by strict text and duration limits. Short continuations stay with the following clause, while complete replies remain separate.
9. **Earlier** and **Later** controls shift caption display in 0.1-second steps (up to ±3 seconds), persist the offset, and never trigger transcription again.

Nothing is uploaded to a transcription service. Batch mode reads the authorized media source and decodes its audio into local memory without saving a permanent media copy. Live mode only receives chunks played during uncached portions of the experiment.

## 1. Install the local recognizer

Use Python 3.10 or newer. From PowerShell in this directory:

```powershell
.\server\setup.cmd
```

If `python` is not on `PATH`, pass the executable explicitly:

```powershell
.\server\setup.cmd -Python "C:\path\to\python.exe"
```

Install the recognizer as a per-user background startup process once:

```powershell
.\server\install-autostart.cmd
```

After that, the extension is one click: **Analyze automatically** pauses the current video, tries full-video local analysis, and begins playback when the complete transcript is ready. Unsupported or inaccessible sources fall back to the existing live recognizer. A shortcut in the current user's Windows Startup folder launches the hidden live recognizer whenever that user signs in.

For true one-click recovery when the recognizer is not already running, build and register the project-local Native Messaging host:

```powershell
.\server\build-native-host.ps1
.\server\install-native-host.ps1 -ExtensionId "your-32-character-unpacked-extension-id"
```

The host is registered under the current user's Edge and Chrome Native Messaging keys. Its allowlist contains only that extension ID. It now supports both long-running batch jobs with progress events and automatic startup of the live recognizer.

For a manual foreground server with visible logs, use `.\server\start.cmd` instead.

The experiment defaults to WhisperLiveKit's `localagreement` streaming policy. On this Windows machine it lets Faster-Whisper use CTranslate2 directly, while the default SimulStreaming policy also initializes a torch model and currently falls back to CPU. We can benchmark SimulStreaming later with `-Policy simulstreaming` after installing a CUDA-enabled torch build.

The launcher defaults to `-Device auto`. This machine has project-local CUDA 12 cuBLAS and cuDNN 9 libraries under `.runtime/cuda`; Faster-Whisper is verified as `cuda` with `int8_float16` compute on the RTX 4060. Use `-Device cpu` only as a diagnostic fallback because the `small` model cannot keep pace with this live stream on CPU.

To reproduce the project-local Windows GPU setup after deleting `.runtime`, run:

```powershell
.\server\setup-gpu.cmd
```

The script downloads the Windows CUDA archive referenced by Faster-Whisper, verifies its pinned size and SHA-256, and extracts it only inside this project.

`small` is the first cost/accuracy checkpoint. After the flow is stable, repeat the same clips with `medium` and `turbo` rather than guessing which model is best:

```powershell
.\server\start.cmd -Model medium
```

The first run downloads model files. Everything after that runs locally, so there is no per-minute transcription bill. GPU runtime support still depends on the local PyTorch/CUDA installation; use CPU for plumbing tests if GPU setup is not yet ready.

If Faster-Whisper reports a CUDA/CTranslate2 problem, first prove the browser pipeline on CPU with the native backend and a smaller model:

```powershell
.\server\start.cmd -Backend whisper -Model base
```

Then configure the CUDA-enabled PyTorch and CTranslate2 packages before running the accuracy/speed benchmark on the GPU. Do not compare model latency while one run is using CPU and another is using GPU.

`wlk check` currently reports FFmpeg as missing on this machine. That is not a blocker: live mode uses `--pcm-input`, while batch media decoding is handled by PyAV bundled through Faster-Whisper.

## 2. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the absolute `extension` directory inside this project.
4. Open a public YouTube video, choose the audio track you want to test, and optionally enable captions in the same language.
5. Click the extension, confirm the two language codes, and choose **Analyze automatically**.

The extension requests tab capture only following that click. Chrome 116 or newer is required because the service worker passes the tab stream to an offscreen document.

## 3. Export and compare

Stop the run and click **Export last experiment JSON**. Batch YouTube exports now include `captionSegments` plus an `evaluation` object containing reference metadata, whole-transcript word error rate, a word-agreement estimate, and timing-distance statistics. `captionsUsedAsInput` remains `false`.

For the older standalone comparison report, run:

```powershell
node .\scripts\compare-transcript.mjs "C:\path\to\export.json"
```

The script reports WER and simple timing coverage. Treat WER as meaningful only when the caption text represents the words spoken in the selected audio track. A German dub compared with German subtitles translated from the original English dialogue measures adaptation differences, not recognition accuracy.

See [the test matrix](experiments/TEST_MATRIX.md) for the experiment order and pass/fail checks.

The next provider experiment is documented in [the AniWorld audio-acquisition plan](docs/ANIWORLD_AUDIO_ACQUISITION_PLAN.md). A ready-to-paste autonomous testing brief is in [the GLM AniWorld prompt](docs/GLM_ANIWORLD_AUDIO_PROMPT.md).

## Current boundaries

- Public YouTube pages and accessible non-DRM HTTP MP4/HLS sources can use full-video batch analysis.
- Blob-only, inaccessible, expiring, or rejected media sources automatically use live capture instead.
- The batch helper accepts only public HTTP(S) addresses and never forwards browser cookies. Use it only for media you are authorized to access and analyze.
- YouTube batch mode can retrieve a matching manual or original-language automatic caption track without playing the video. Live mode covers visible YouTube captions and standard active text-track cues; other site-specific players may need a small adapter.
- Click-for-definition is included for German words. Automatic subtitle translation remains postponed until capture, timestamp alignment, accuracy, and latency are measured.
- Netflix and other DRM subscription platforms are intentionally excluded from phase one. Their technical and contractual constraints need a separate checkpoint after the public-site system works.
- Storage is local and currently has no cleanup UI. Export important runs, then clear the extension's site data when needed.

## Implementation references

- [Chrome tabCapture documentation](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome offscreen document documentation](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit)

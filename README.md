# Dub Transcript Lab

Dub Transcript Lab is a Windows browser-extension experiment that creates subtitles from the audio actually playing in a video. If a German dub is selected, it transcribes that German dub instead of relying on subtitles translated from another language.

It can analyze an accessible video before playback or fall back to transcribing the audio as it plays. Completed captions are cached in the browser, remain synchronized when you rewind, and appear inside the video player.

## Current features

- Full-video local transcription for public YouTube pages and accessible non-DRM MP4, HLS, and DASH media.
- Experimental Netflix full-audio acquisition when Netflix player metadata exposes a separate clear, signed audio-only CDN track for the selected dub. Unsupported xHE-AAC representations—including raw FFmpeg failures that appear partway through a title—retry through Chrome's Windows platform decoder before live fallback.
- Document-start media discovery inside embedded player frames, ranked fallback sources, requested-language audio selection, and encrypted-playlist detection.
- Automatic live-audio fallback when a complete media source is unavailable.
- Clickable transcript words with a structured, source-backed German learning card: meanings, English glosses, paired examples, grammar, collocations, synonyms, and pronunciation when Wiktionary provides them.
- Replay a selected word from the current video, or open the word directly in German YouGlish.
- Browser-local saved vocabulary with video context, examples, and word timing when available.
- Optional English translation under the original transcript, with a distinct warm-yellow color by default.
- Selectable transcript and translation text. Click a word for its learning card, select normally to copy text, and use the caption grip to drag the overlay.
- Independent transcript and translation font, color, opacity, size, and bold controls, plus shared background, edge, and position controls.
- A timing adjustment that moves captions earlier or later without retranscribing.
- One-click UTF-8 transcript download plus technical JSON experiment export.
- A browser-local library of up to 20 complete transcripts. Opening the same video and audio language restores the saved transcript automatically instead of transcribing again.

This is still an experiment, not a finished store extension. Netflix support is conditional and does not bypass DRM: encrypted or unavailable sources still use live decoded-tab-audio transcription.

### Netflix audio research mode

Version 0.9.5 includes a temporary research panel for collecting privacy-safe,
title-by-title Netflix audio data before making more decoder changes. It records track,
codec, subtitle, CDN, MP4 protection, and browser capability metadata without retaining
audio, media URLs, cookies, account data, license traffic, or DRM keys.

See [docs/NETFLIX_AUDIO_RESEARCH.md](docs/NETFLIX_AUDIO_RESEARCH.md) for the report schema,
manual sampling protocol, and dataset fields.

## Beginner installation on Windows

### What you need

- Windows 10 or Windows 11, 64-bit.
- Google Chrome or Microsoft Edge version 116 or newer.
- A stable internet connection for the first installation.
- Several GB of free disk space for Python packages and speech models.
- 64-bit Python 3.12 is recommended. Python 3.11 and 3.13 are also accepted.

Download Python from [python.org](https://www.python.org/downloads/windows/). During Python installation, enable **Add python.exe to PATH**.

### Install in five steps

1. On GitHub, choose **Code → Download ZIP**, then extract the ZIP to a normal folder. Do not run it from inside the ZIP preview.
2. Double-click **`INSTALL.cmd`** in the extracted folder.
3. Choose **CPU compatibility mode** for the easiest first setup. Choose NVIDIA GPU mode only if the computer has a supported NVIDIA graphics card and a faster setup is worth the additional download.
4. The installer opens the browser extensions page and the correct `extension` folder. Enable **Developer mode**, choose **Load unpacked**, select that folder, then paste the displayed 32-character extension ID into the installer.
5. Leave the installer open while it downloads the local recognizer and speech model. The first installation can take a while. Wait for the green **Ready** message.

The setup is project-local: Python packages, models, CUDA files, and logs stay inside the extracted project folder. CPU mode downloads `base` for live captions and `small` for full-video analysis; NVIDIA mode reuses `small` for both. The only Windows-level changes are the per-user browser native-host registration and, unless disabled, a Startup shortcut for the local recognizer.

### Update an existing installation

Keep the existing project folder and extension card so the extension ID and browser-local transcripts, vocabulary, settings, and translation cache remain available.

1. Download and extract the new ZIP to a temporary folder.
2. Copy its contents over the existing project folder and allow Windows to replace matching files. Do not delete the existing `.model-cache`, `.runtime`, or `.venv` folders.
3. Open `chrome://extensions` or `edge://extensions` and click **Reload** on the existing Dub Transcript Lab card. Do not remove the extension or load the new files from a different folder.
4. Run **`CHECK-SETUP.cmd`**, refresh the video page, and start a short test.

Do not rerun `INSTALL.cmd` for an ordinary same-folder update. Run it only when the project was moved, the browser extension ID changed, or `CHECK-SETUP.cmd` reports that registration must be repaired.

Download important transcripts as text before an update as a precaution. Do not run `UNINSTALL.cmd` for a normal update.

### Try it

1. Open a public YouTube video.
2. Select the audio language you want to hear, such as German.
3. Click **Dub Transcript Lab** in the browser toolbar.
4. Confirm the audio language code and choose **Analyze automatically**.
5. Wait for full-video preparation. Playback begins automatically when the transcript is ready. If full-video access is unavailable, the extension switches to live transcription.

For the first test, use a short public video. CPU mode works on more computers but can be much slower than an NVIDIA GPU.

### If setup stops working

Double-click **`CHECK-SETUP.cmd`**. It checks the local configuration, Python packages, browser registration, automatic startup, and recognizer health. Logs are stored in `.runtime\logs`.

Running **`INSTALL.cmd`** again is safe and repairs missing packages or registration.

### Remove it

1. Double-click **`UNINSTALL.cmd`**.
2. Choose whether to keep or remove downloaded models and Python packages.
3. Remove Dub Transcript Lab from `chrome://extensions` or `edge://extensions`.

The uninstaller removes the Startup shortcut and Chrome/Edge native-host registration for the current Windows user.

## Privacy and network use

Transcription runs locally. Audio is not uploaded to a transcription service.

- Batch mode reads an authorized media source and converts its audio in local memory. YouTube uses a temporary media file that is deleted immediately after decoding. Netflix batch mode is attempted only for a clear audio-only URL already exposed to the signed-in player.
- Live mode captures only the decoded audio played in the current tab and sends PCM chunks to `127.0.0.1` on the same computer.
- Definitions are requested from English and German Wiktionary after a word click.
- The learning card is deterministic and source-backed. It does not send words to an AI service and does not invent simplified explanations, B2 advice, collocations, or grammar when the dictionaries do not provide them.
- The optional browser translation provider is on-device when supported.
- If Google Cloud Translation fallback is selected, only displayed transcript text is sent to Google's official API. The optional API key stays in browser-local storage and is excluded from experiment JSON exports.
- The helper never copies browser cookies into native tools. Do not use the project to bypass access controls, DRM, authentication, or a platform's terms.

## How transcription works

1. A small document-start observer records HLS, DASH, and direct-media candidates inside the page and embedded player frames. It records URLs and media metadata only; it does not download anything until the user chooses **Analyze automatically**.
2. **Analyze automatically** pauses the selected player, ranks up to ten candidates, and rejects encrypted media. The only narrow exception is a validated clear Netflix audio-only URL exposed by Netflix player metadata. Locally decodable profiles are tried before xHE-AAC when profile metadata is available.
3. Public YouTube media is resolved with `yt-dlp`. For other sites, the local worker checks HLS/DASH manifests for encryption, tries the clear candidates in rank order, selects the requested audio language when track metadata is available, and rejects sources whose duration does not match the active video. Netflix URLs are accepted only from Netflix pages, from the metadata observer, and on Netflix's HTTPS media CDN.
4. Accessible media is decoded locally with PyAV and transcribed with Faster-Whisper. If FFmpeg reports an unsupported Netflix xHE-AAC feature, Chrome can decode the already-authorized audio with Windows' platform codec and stream temporary mono PCM to the local worker. Media URLs, signed query parameters, compressed audio, and PCM are not uploaded or stored in the transcript library; temporary PCM is deleted after loading.
5. When batch acquisition is not possible, Chrome tab capture sends 0.5-second mono 16 kHz PCM chunks to a local WhisperLiveKit server started with `--pcm-input`.
6. Both paths produce the same timestamped cue format in `chrome.storage.local`. Existing captions are evaluation-only and never feed the recognizer.
7. Sentence, phrase, silence, and bounded-length breaks are used to create readable caption blocks.

On direct streaming sites, the current **Decoding** phase may also include fetching remote media. Its speed can therefore depend on the selected provider/CDN even though transcription itself is local.

## Advanced manual setup

The beginner installer is recommended. These commands are useful for development or diagnostics.

Create or repair the Python environment:

```powershell
.\server\setup.cmd
```

Pass a specific supported Python executable when necessary:

```powershell
.\server\setup.cmd -Python "C:\path\to\python.exe"
```

Start the recognizer visibly and keep the window open:

```powershell
.\server\start.cmd -Device cpu -Model base -Language de
```

Install the optional project-local NVIDIA runtime:

```powershell
.\server\setup-gpu.cmd
```

Then start with the saved GPU configuration or explicitly use automatic device selection:

```powershell
.\server\start.cmd -Device auto -Model small -Language de
```

Build and register the native messaging helper manually:

```powershell
.\server\build-native-host.ps1
.\server\install-native-host.ps1 -ExtensionId "your-32-character-extension-id"
```

The helper is registered only for that extension ID under the current user's Chrome and Edge Native Messaging keys. It can start the live recognizer and run cancellable full-video batch jobs.

WhisperLiveKit 0.2.24 is pinned for reproducible setup. Its raw PCM mode bypasses FFmpeg for live capture. Batch media decoding is provided by PyAV through Faster-Whisper, so a missing FFmpeg executable is not a blocker for the current pipelines.

## Export and evaluation

Choose **Download transcript .txt** for a one-click readable transcript. Complete transcripts also appear in **Saved transcripts**, where each one can be downloaded or removed. The library keeps structured timestamps for synchronized replay and automatically recognizes the same stable page plus audio language; signed media URLs and request headers are never stored there.

Choose **Export technical experiment JSON** for research data. YouTube batch exports can include matching caption reference segments and evaluation metrics such as word error rate, word-agreement estimate, and timing-distance statistics. Captions remain evaluation-only.

For the standalone comparison report:

```powershell
node .\scripts\compare-transcript.mjs "C:\path\to\export.json"
```

Only compare ASR with captions that represent the selected audio track. A German dub compared with subtitles adapted from the original English dialogue measures adaptation differences as well as recognition error.

## Project documentation

- [Experiment test matrix](experiments/TEST_MATRIX.md)
- [AniWorld audio-acquisition plan](docs/ANIWORLD_AUDIO_ACQUISITION_PLAN.md)
- [Prompt for the isolated GLM AniWorld branch](docs/GLM_ANIWORLD_AUDIO_PROMPT.md)
- [Deferred product backlog](docs/PRODUCT_BACKLOG.md)
- [Local learning and transcript-library behavior](docs/LOCAL_LEARNING_FEATURES.md)

## Current boundaries

- Full-video mode supports public YouTube pages and accessible non-DRM HTTP MP4, HLS, and DASH media.
- Netflix full-audio mode works only when player metadata exposes a separate clear, signed audio-only `nflxvideo.net` URL for the requested language. The URL can expire and this availability may vary by title, profile, browser, and Netflix changes.
- The xHE-AAC fallback first tries Chrome's `decodeAudioData`, then demuxes MP4 audio with the bundled BSD-licensed MP4Box.js 2.4.1 and checks the lower-level WebCodecs `AudioDecoder`. Browser/OS codec support still varies. It temporarily holds decoded 16 kHz audio in browser memory, so very long titles need more memory.
- Netflix candidates now retain track ID, player-selected state, and audio-description role when Netflix exposes them. The cache identity includes the track role so a German audio-description transcript is not silently reused for the normal German dub.
- The requested audio language and exact role can be selected only when the stream exposes reliable metadata. A mislabeled provider can still supply the wrong dub.
- Blob-only, expired, rejected, or inaccessible sources use live tab capture.
- Multi-provider streaming sites can expose different CDNs on different runs. The extension now tries multiple ranked candidates, but providers can still block cookie-free native access.
- Encrypted Netflix streams and other DRM subscription platforms remain outside full-media acquisition and use decoded live tab audio. The extension never requests DRM keys or sends browser cookies to the local worker.
- The popup shows the current acquisition/decoder stage, candidate number, received-versus-expected audio size, and actionable failures without requiring an export. Technical JSON remains available for deeper investigation; signed URLs and page query strings are redacted.
- The transcript library is browser-local and intentionally bounded to 20 entries and about 7.5 MB. Removing the extension or clearing its storage removes the library, so download important transcripts as text.
- Only complete transcripts are promoted to the reusable library. A partially watched live-transcription session remains an experiment record and will not suppress future analysis.
- Exact batch word timestamps produce the best replay clips. Live cues without word timestamps use an estimated interval inside the cue.
- The no-AI learning card cannot reliably reproduce a custom tutor's simplified B1 explanations or generated B2 tips; empty source-backed sections are hidden instead of invented.

## Primary upstream projects

- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit)
- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Chrome offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MP4Box.js](https://github.com/gpac/mp4box.js) (BSD-3-Clause; bundled license in `extension/vendor/MP4BOX-LICENSE.txt`)

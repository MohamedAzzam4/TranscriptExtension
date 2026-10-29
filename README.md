# Dub Transcript Lab

Dub Transcript Lab is a Windows browser-extension prototype for learning languages while watching videos. It reuses YouTube subtitles automatically, can transcribe accessible video audio locally, and displays selectable bilingual captions with clickable German word cards.

**Current checkpoint:** extension **0.12.5**, local batch worker **0.12.1**. These components have separate version numbers. Features remain experimental: passing local tests does not replace real browser, platform and fresh-install checks. See the [roadmap](docs/DEVELOPMENT_ROADMAP.md) and [test records](docs/test-results).

## Features

- **Automatic YouTube captions:** matching creator-provided subtitles first, then an original automatic transcript. Source captions appear before optional translation or history saving finishes.
- **Translation into your chosen language:** YouTube translation when available, with the extension provider as fallback. The extension provider uses Chrome's built-in on-device Translator API first; Google Cloud Translation is optional and requires your configured API key.
- **Local transcription:** full-video analysis for accessible clear MP4, HLS and DASH media, with live decoded-tab-audio fallback where supported. YouTube audio transcription is an explicit mode; missing subtitles do not silently start recognition.
- **German word cards:** German Wiktionary definitions and examples translated directly into the selected target language, separate case-government information when available, and verb base forms/conjugation tables. No English Wiktionary or intermediate English gloss source.
- **Word tools:** browser-provided German pronunciation, video-fragment replay, YouGlish and saved vocabulary. Saved words open the full card in Words; source context stays metadata rather than an extra visible definition.
- **Learning interactions:** optional current-word highlighting and pause anywhere inside the caption box, including translation and padding. Leaving resumes only playback paused by the extension; an existing/manual pause is preserved.
- **Shared controls:** popup and YouTube player settings use the same preferences. Original/translated caption styling are independent. Captions support selection/copy and dragging using their handle.
- **History and diagnostics:** source-aware cached replay, a Videos library, UTF-8 text downloads and sanitized technical JSON exports. Detailed diagnostics stay in the popup; routine ready notices fade.

Subtitle tracks are not proof of the exact spoken dub. YouTube cue times and platform word offsets are retained when available; within-cue word timing may be estimated. Audio-recognition word timestamps are used when supplied. Estimates are labelled rather than presented as exact.

## Quick start: YouTube captions

Use current desktop **Google Chrome** for the first trial. The extension also targets Microsoft Edge, but translation and voice availability vary with browser/OS capabilities. The manifest minimum is Chrome 116; this does not guarantee the newer Translator API is available.

1. Download the repository using **Code → Download ZIP**, then extract it to a permanent folder.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted **`extension`** folder containing `manifest.json`.
4. Open or refresh a public YouTube video. Select the intended audio language in YouTube; confirm the audio fallback and target language in the extension.
5. Leave **Automatic YouTube learning captions** enabled. Preparation feedback appears in the player. The transcript icon opens track, translation, appearance and hover controls.

The browser caption path does not require Python or speech models. If browser retrieval fails, the subtitle-only native fallback requires the full installation below. Missing captions show retry/track options; audio recognition must be selected explicitly.

Initial playback is attempted once when the video is ready, visible and outside an ad. Chrome can block autoplay; a notice then asks you to press Play. Later pauses are not overridden by a retry loop.

### Translation and pronunciation

- Choose your target language/provider in the popup. Follow its translation setup prompt if Chrome needs language resources; keep that setup tab open until Ready. Availability and download progress are shown. No separate translation extension is needed.
- Google Cloud fallback runs only with a configured key and may involve billing. Without a key, unavailable on-device translation stays an explicit availability/error state.
- Pronunciation uses an available German browser voice, which may be local or online. The card reports availability/failures. A Windows voice installation is not universally required; the extension does not invent voice-download progress the browser cannot report.

## Full installation on Windows

Use full setup for local audio transcription on supported sites or the native subtitle-only fallback.

### Requirements

- Windows 10 or 11, 64-bit, with current Chrome or Edge.
- **64-bit Python 3.12 recommended**; Python 3.11 and 3.13 are also supported. Newer versions are outside the tested ML dependency set.
- Internet access for initial packages/models and several GB of free disk space. CPU mode is the compatibility default; NVIDIA acceleration is optional.

Download Python from [python.org](https://www.python.org/downloads/windows/). Enabling **Add python.exe to PATH** is useful; discovery also checks Windows registration, common folders and the launcher list.

### Install

1. Extract the complete repository with **`extension/`**, **`server/`**, **`INSTALL.cmd`**, **`CHECK-SETUP.cmd`** and **`UNINSTALL.cmd`** together in one permanent folder. An extension-only ZIP cannot install the helper.
2. Run **`INSTALL.cmd`** and choose **CPU compatibility mode** for a first setup.
3. When asked, load the extension folder and paste the 32-character ID from **your own** extension card. If it is already loaded, use the existing card/ID.
4. Wait while setup installs packages, downloads models, registers the helper and verifies the local recognizer. Wait for **Ready** before closing it.
5. Run **`CHECK-SETUP.cmd`** if the full installation later needs diagnosis.

CPU mode normally uses `base` for live captions and `small` for full-video analysis; GPU mode normally uses `small` for both and downloads an additional NVIDIA runtime. Packages/models/configuration stay in the project folder. Windows changes are per-user native-host registration and, unless disabled, a recognizer Startup shortcut.

### Python is installed but not found

A missing launcher/version no longer stops the entire search. Setup checks actual version/bitness, explains rejected candidates and offers a prompt to paste the path to `python.exe` or its folder. You can also run this from a terminal in the project folder:

```powershell
.\INSTALL.cmd -Python "C:\path\to\python.exe"
```

Use the actual path on that computer. Reinstalling into the same location does not repair an old installer's detection logic. Update the installer files first; keep `server/install.ps1` and `server/python-discovery.ps1` together.

### Try local transcription

1. Open a short accessible video and confirm its spoken audio language in the extension.
2. Choose **Analyze video**. On YouTube, explicitly select **Local audio** instead of subtitles when recognition is intended.
3. Follow **Analysis diagnostics** for acquisition, decoding, transcription, caching or fallback. Full-video preparation can be slow on CPU; live fallback is distinguished from completed batch work.
4. Reopen a completed video/language to try cached replay, and use Videos for history/export.

### Share with a friend

- **YouTube browser trial:** send the complete `extension` folder as a ZIP and follow Quick start. Native fallback/local transcription need the helper.
- **Full trial:** send a clean project ZIP containing the entire `extension` and `server` folders plus the root install/check/uninstall commands, or share this repository for download. They install Python and run their own `INSTALL.cmd`.
- Exclude `.venv`, `.runtime`, `.model-cache`, `.git`, test artifacts, exports and old archives from a hand-made package. Do not copy your browser profile, API key or machine-specific registration.
- Keep the extracted folder in place and update the same extension card to retain browser-local data.

## Updates, repair and removal

### Update an existing installation

1. Download the current repository and extract it to a temporary folder.
2. Copy source files over the **existing project folder**, replacing matching files while retaining `.venv`, `.runtime` and `.model-cache`.
3. Click **Reload** on the existing extension card and refresh video pages. Keep the same folder/card to preserve the extension ID and saved vocabulary/history/settings.
4. Run **`CHECK-SETUP.cmd`** for the full local installation. Export important transcripts before updating.

Ordinary source updates do not require model downloads or `UNINSTALL.cmd`. Rerun `INSTALL.cmd` if the project moved, its extension ID changed, registration needs repair, or an update specifically requires setup changes. See [existing-install instructions](UPDATE-EXISTING-INSTALLATION.md).

### Decoder error: `metadata_errors`

If every candidate fails with `open() got an unexpected keyword argument 'metadata_errors'`, update the local worker files. Worker 0.12.1 handles old/new PyAV metadata APIs; fresh setups pin tested `av==18.0.0`. The extension remaining at 0.12.5 is expected. Follow the [decoder repair guide](docs/PYAV_DECODER_UPDATE.md), including optional project-venv dependency repair. Do not replace system-wide packages for this error.

### Remove

Run **`UNINSTALL.cmd`** for the helper, choose whether to keep packages/models, then remove the browser extension. Extension removal/cleared browser storage deletes local words/history; export important transcripts first. The uninstaller removes per-user native registration and its Startup shortcut.

## Supported paths and limits

| Path | Behavior / boundary |
|---|---|
| YouTube captions | Automatic creator-first, original-automatic second; browser retrieval then subtitle-only native fallback. Translation and audio recognition are separate. |
| YouTube audio | Explicit local transcription mode. Missing subtitles do not silently enable it. |
| Generic/embedded players | Ranked discovery for accessible clear MP4/HLS/DASH. Provider access, URL expiry and exposed language metadata affect results; unsupported access may fall back to live decoded-tab audio. |
| Authorized loopback media | Player and media must share the exact `localhost`/`127.0.0.1`/`[::1]` origin. Public pages cannot authorize private/loopback access. |
| Netflix research/acquisition | Experimental clear audio-only representations exposed by the signed-in player. Browser decoder fallback may help xHE-AAC; availability varies. Research collection remains paused pending test access. No DRM keys/decryption/cookie extraction. |
| History | Browser-local library capped at 20 entries and roughly 7.5 MB. Complete audio transcripts and validated platform-caption tracks are reusable; partial live sessions are not complete transcripts. |
| Word cards | German Wiktionary coverage varies. Meanings, examples, case rules, verb bases and conjugations can be incomplete; empty fields are not invented. Known acceptance gaps remain in the backlog. |
| Browser interactions | Voice availability, autoplay, fullscreen, hover and translated-word matching need real browser acceptance; local fixtures cannot prove platform-wide success. |

### Authorized local-video example

Put an ordinary `player.html` and its video in the same folder, then serve that folder:

```powershell
python -m http.server 8050
```

Open `http://127.0.0.1:8050/player.html` and analyze it. Page/media must share the exact scheme, host and port. This allowance does not extend to arbitrary private services.

## Privacy and network use

- Audio recognition runs locally. Live capture sends decoded PCM to the recognizer on this computer; audio is not uploaded to a transcription provider.
- Caption retrieval contacts YouTube. Subtitle-only native fallback does not acquire audio or load speech models. Explicit audio analysis may use temporary local media/PCM, removed after processing.
- Word lookup contacts **German Wiktionary only**. German definitions/examples go directly to the selected translation language. No OpenAI API/key or generative tutor is required.
- Chrome translation is on-device when available, with initial language-resource downloads. Optional configured Google Cloud fallback sends requested text, including card content, to Google's official API. Online browser voices and YouGlish can also use network services.
- Library/experiment records exclude signed media/caption URLs, cookies, authorization data, API keys, DRM material and audio/PCM. Saved vocabulary retains safe source identity/context as metadata. Technical exports are sanitized.
- Native tools do not receive copied browser cookies or DRM keys. Platform captions are not described as a new audio-recognition run.

## Development and verification

Dependencies are pinned in [server/requirements.txt](server/requirements.txt). Advanced local setup/diagnosis:

```powershell
.\server\setup.cmd -Python "C:\path\to\python.exe"
.\server\start.cmd -Device cpu -Model base -Language de
```

NVIDIA runtime setup uses `server/setup-gpu.cmd`; `server/start.cmd -Device auto -Model small -Language de` requests automatic device selection. The beginner installer also builds/registers the native helper for the supplied extension ID.

With Node.js and the project Python environment available, run:

```powershell
.\RUN-REGRESSION.cmd
```

The current suite includes 25 JavaScript syntax checks, 29 extension suites, 61 server tests and Windows PowerShell Python-discovery checks. These cover deterministic transformations and simulated lifecycle boundaries. Browser testing remains paused; real media/voice/download/autoplay/fullscreen, clean install and upgrade checks still need evidence.

- [Roadmap/work packages](docs/DEVELOPMENT_ROADMAP.md) and [protected features](docs/FEATURE_REGISTRY.md)
- [Regression policy](docs/REGRESSION_TEST_PLAN.md), [Phase 1 checklist](experiments/PHASE1_MANUAL_CHECKLIST.md) and [Phase 2 checklist](experiments/PHASE2_MANUAL_CHECKLIST.md)
- [Test matrix](experiments/TEST_MATRIX.md) and [backlog](docs/PRODUCT_BACKLOG.md)
- [YouTube contracts](docs/YOUTUBE_CAPTIONS_IMPLEMENTATION.md), [progressive startup](docs/YOUTUBE_PROGRESSIVE_START_PLAN.md) and [caption-box hover](docs/CAPTION_BOX_HOVER_PLAN.md)
- [Python discovery evidence](docs/test-results/2026-10-28-python-discovery.md) and [decoder compatibility evidence](docs/test-results/2026-10-28-pyav-compatibility.md)
- [Netflix research](docs/NETFLIX_AUDIO_RESEARCH.md) and [local learning/library notes](docs/LOCAL_LEARNING_FEATURES.md)

## Primary upstream projects

- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) and [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [PyAV](https://github.com/PyAV-Org/PyAV)
- Chrome [tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) and [offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [MP4Box.js](https://github.com/gpac/mp4box.js), bundled with its [BSD license](extension/vendor/MP4BOX-LICENSE.txt)
- Open Sans [font license](extension/fonts/OFL-OpenSans.txt)

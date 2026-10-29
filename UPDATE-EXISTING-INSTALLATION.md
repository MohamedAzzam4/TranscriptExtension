# Update an existing Dub Transcript Lab installation

Use these steps for an existing browser extension or full local installation.
Current source: extension **0.12.5**, batch worker **0.12.1**. Separate version
numbers are expected. The project remains experimental; see the [README](README.md)
for current features, setup choices and verification limits.

## Important

- Update the **same existing project folder**. Do not extract this package as a second installation.
- Do not delete `.venv`, `.runtime`, or `.model-cache` from the existing folder.
- Routine source updates do not require `INSTALL.cmd`. Setup may be needed if the folder/extension ID changed, registration is broken, or update instructions require it.
- Stop any active transcription experiment before replacing the files. The background recognizer may remain installed.

Keeping the same folder preserves the Python environment, downloaded Whisper models, local settings, browser extension ID, native-host registration, and Startup shortcut.

## Current update highlights

- YouTube retrieves creator subtitles before original automatic captions. Source
  text appears before translation/history saving; missing captions do not silently
  enable audio transcription. The player transcript icon exposes shared settings.
- Hover pause covers the whole caption box. German-only word cards translate
  directly into the selected target language; saved words open the full card.
- Python discovery handles missing versions/launchers, searches registered/common
  paths and offers paste-path recovery. Keep `server/install.ps1` and
  `server/python-discovery.ps1` together.
- The `metadata_errors` repair is in worker0.12.1. Fresh setup pins tested
  `av==18.0.0`; existing dependency repair is optional and described in the
  [decoder update guide](docs/PYAV_DECODER_UPDATE.md). Do not change system-wide packages.

## Earlier 0.9.4 behavior retained

- The popup now shows acquisition and decoder errors directly, including the failed stage, candidate number, downloaded size, expected size, and a suggested next action.
- Netflix browser decoding retries multiple ranked audio representations instead of stopping after the first URL.
- Partial HTTP range responses are completed when the CDN exposes a usable total range; suspiciously small responses are otherwise classified as incomplete downloads rather than generic codec failures.
- When `decodeAudioData` rejects a complete MP4, the extension demuxes it with MP4Box.js and tests the lower-level WebCodecs `AudioDecoder`.
- Netflix track IDs, player-selected state, and audio-description roles are retained when available. Cache keys now distinguish normal audio from audio description.
- Version 0.9.3's selectable captions and separate transcript/translation appearance controls remain included.

## Steps

1. Stop any active transcription, then close Chrome or Edge completely. This releases the native helper executable so Windows can replace the package files cleanly. The installed Whisper environment and downloaded models remain on disk.
2. Open the existing project folder containing `extension`. Full installations also contain `INSTALL.cmd`, `server`, `.venv` and `.runtime`.
3. Extract the downloaded repository ZIP to a temporary folder. Open its top-level project folder before copying files, so a second project directory is not accidentally nested inside the old one.
4. Copy updated source/installer files into the existing project folder and allow matching files to be replaced. Keep `.venv`, `.runtime`, `.model-cache` and `.git`; no environment/model folders or old archives need to be copied from another person's computer.
5. Reopen the same browser, then open `chrome://extensions` or `edge://extensions`.
6. Find **Dub Transcript Lab** and click its **Reload** button. Do not remove it and do not choose **Load unpacked** again.
7. Refresh video pages so updated scripts, the media observer and player controls load.
8. On YouTube, confirm audio/target languages and leave automatic learning captions enabled. For audio recognition, choose local audio mode explicitly; on other supported sites choose **Analyze video**.

For the full local installation, run `CHECK-SETUP.cmd` if the recognizer is not
reachable. Rerun `INSTALL.cmd` only for moved folders/changed IDs, registration
repair or specifically required setup changes. Keep models and browser data.

## What this update preserves

- Installed Python packages and WhisperLiveKit
- Downloaded speech models
- CPU/GPU selection and local settings
- Native Messaging registration
- Browser-local transcripts and saved vocabulary, because the installed extension is reloaded rather than removed
- Caption and translation appearance settings stored under the same extension ID

## Acquisition boundary

Audio mode can try accessible clear MP4, HLS and DASH and select a language when
reliable metadata is exposed. Experimental Netflix clear audio-only tracks and
browser xHE-AAC decoding remain conditional. It does not request keys, copy
cookies or decrypt DRM. Inaccessible/protected sources may use decoded live tab
audio where supported; platform-wide success is not guaranteed. YouTube subtitle
mode remains separate from acquisition/recognition.

Existing browser-local transcripts and saved vocabulary survive this update when you overwrite the same folder and click Reload on the same unpacked extension. Older Netflix transcripts with language-only cache keys remain in Saved transcripts, but version 0.9.4 will not automatically reuse them when an exact track/role identity is available; this prevents an audio-description transcript from being shown for the normal dub.

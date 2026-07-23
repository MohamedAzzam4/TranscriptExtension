# Update an existing Dub Transcript Lab installation

Use these steps when an older version is already installed and Whisper is working.

## Important

- Update the **same existing project folder**. Do not extract this package as a second installation.
- Do not delete `.venv`, `.runtime`, or `.model-cache` from the existing folder.
- Do not run `INSTALL.cmd` again for this update.
- Stop any active transcription experiment before replacing the files. The background recognizer may remain installed.

Keeping the same folder preserves the Python environment, downloaded Whisper models, local settings, browser extension ID, native-host registration, and Startup shortcut.

## New in version 0.9.4

- The popup now shows acquisition and decoder errors directly, including the failed stage, candidate number, downloaded size, expected size, and a suggested next action.
- Netflix browser decoding retries multiple ranked audio representations instead of stopping after the first URL.
- Partial HTTP range responses are completed when the CDN exposes a usable total range; suspiciously small responses are otherwise classified as incomplete downloads rather than generic codec failures.
- When `decodeAudioData` rejects a complete MP4, the extension demuxes it with MP4Box.js and tests the lower-level WebCodecs `AudioDecoder`.
- Netflix track IDs, player-selected state, and audio-description roles are retained when available. Cache keys now distinguish normal audio from audio description.
- Version 0.9.3's selectable captions and separate transcript/translation appearance controls remain included.

## Steps

1. Stop any active transcription, then close Chrome or Edge completely. This releases the native helper executable so Windows can replace the package files cleanly. The installed Whisper environment and downloaded models remain on disk.
2. Open the folder containing the currently installed project. It should contain `INSTALL.cmd`, `extension`, `server`, `.venv`, and `.runtime`.
3. Extract the contents of this ZIP directly into that existing folder.
4. Allow Windows to **replace the existing files** when asked. The ZIP does not contain `.venv`, `.runtime`, `.model-cache`, `.git`, or old ZIP packages, so those local files remain untouched.
5. Reopen the same browser, then open `chrome://extensions` or `edge://extensions`.
6. Find **Dub Transcript Lab** and click its **Reload** button. Do not remove it and do not choose **Load unpacked** again.
7. Reload the streaming webpage. Version 0.9.4 needs a fresh page load so its early media observer and updated track metadata logic are installed in the page.
8. Choose the dub language, start playback briefly, and select **Analyze automatically**.

If the local recognizer is not reachable afterward, run `CHECK-SETUP.cmd`. Only rerun `INSTALL.cmd` if the project folder was moved or the browser extension ID changed.

## What this update preserves

- Installed Python packages and WhisperLiveKit
- Downloaded speech models
- CPU/GPU selection and local settings
- Native Messaging registration
- Browser-local transcripts and saved vocabulary, because the installed extension is reloaded rather than removed
- Caption and translation appearance settings stored under the same extension ID

## Acquisition boundary

Version 0.9.4 can acquire accessible clear MP4, HLS, and DASH audio and select a requested language when track metadata is available. It can also try clear signed Netflix audio-only representations when Netflix exposes them to the player. Netflix xHE-AAC that FFmpeg cannot decode is retried through Chrome's browser decoders. It does not request keys, copy cookies, or decrypt DRM. Encrypted or unavailable Netflix media—and Prime Video, Disney+, and similar protected playback—use the existing live decoded-tab-audio fallback.

Existing browser-local transcripts and saved vocabulary survive this update when you overwrite the same folder and click Reload on the same unpacked extension. Older Netflix transcripts with language-only cache keys remain in Saved transcripts, but version 0.9.4 will not automatically reuse them when an exact track/role identity is available; this prevents an audio-description transcript from being shown for the normal dub.

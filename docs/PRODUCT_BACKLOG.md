# Product backlog

This file preserves requested product ideas that are intentionally deferred while setup and media acquisition are being stabilized. Items here are not promises of the current build.

## Word-learning panel

- Reorganize the word card so definitions, examples, and translations are grouped more clearly instead of appearing as one long scrolling block.
- Add **Listen again** for the selected word. Prefer the word's real audio from the current video and replay only its timestamped clip without losing the viewer's previous position.
- Add **Hear on YouGlish**. It should open a new YouGlish tab for the selected word with German selected. Confirm YouGlish's current public URL format before implementation.
- Keep saved-word context, definitions, examples, source video, and audio timing together so a saved item remains useful later.

## Transcript export and local library

- Add one-click download of the complete transcript as a readable UTF-8 text file.
- Save completed transcripts locally and restore them automatically when the same video is opened again.
- Use a stable video identity, such as platform plus video ID, rather than an expiring media URL.
- Store structured transcript data for replay and learning features, while generating the text file only as an export format.
- Provide a simple local-library screen for finding, reopening, exporting, and deleting saved transcripts.
- Make the storage boundary explicit: browser-local storage first; optional user-selected files or a local companion service only when persistent filesystem access is needed.

## Acceptance notes

- All export and persistence actions must be understandable as a single user action.
- Reopening an already analyzed video must not run transcription again when a compatible complete transcript is available.
- Word-audio replay must not permanently seek, pause, or change the playback rate of the video.
- No signed media URLs, cookies, DRM material, or API secrets may be stored in the transcript library.

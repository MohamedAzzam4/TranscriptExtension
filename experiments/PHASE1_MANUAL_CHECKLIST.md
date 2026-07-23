# Phase 1 manual interaction checklist

Use this checklist only after reloading the unpacked extension and refreshing
the video page. It does not automate a website.

Record the extension version, browser version, page/video, transcription mode,
and result for every check. Use a short authorized YouTube or clear HTML5 sample
first; Netflix is not required for Phase 1.

## Caption interaction

- **M-01 — Select and copy:** Drag across several source words, copy, and paste
  into a text editor. Repeat with the translation. No word card or player click
  should fire during selection.
- **M-02 — Click a word:** Clear the selection and click one German word. Exactly
  one word card should open for that word.
- **M-07 — Drag captions:** Drag using the grip beside the caption. The overlay
  should follow the pointer, remain inside the player, and preserve the position
  after reopening the popup. Selecting text must still work afterward.
- **M-08 — Appearance:** Change transcript color/size, translation color/size,
  background opacity, and translation visibility. Each change should affect only
  its intended layer.

## Word learning

- **M-03 — Card content:** Confirm English-titled sections, German and English
  meanings when available, paired context/examples, grammar, combinations, and
  related words. Empty sections should be hidden.
- **M-04 — Save:** Save the word, close/reopen the popup, and confirm the entry
  keeps its context. Remove it and confirm the state updates.
- **M-05 — YouGlish:** Click YouGlish and confirm a new German YouGlish search
  opens for the selected word.
- **M-06 — Replay:** While the video is playing, replay the word. Confirm the
  expected short interval plays and the previous time, pause/play state, and
  playback rate are restored. Repeat once while originally paused.

## Critical transcript smoke checks

- **M-09 — Cached replay:** Reopen a complete transcript for the same video and
  language. It should use cached cues and not start recognition.
- **M-10 — Partial honesty:** Stop a live experiment after a short range. Reopen
  the video and confirm it is not presented as a complete cached title.
- **M-11 — Seek/rewind:** Rewind into covered time and confirm no duplicate
  recognition. Seek to uncovered time and confirm new cues align there.
- **M-12 — Export:** Download TXT and technical JSON. Confirm readable text and
  separate ASR/caption streams.
- **M-13 — YouTube batch:** Confirm the first cue, middle seek, final cues, and
  cache replay for a short public sample.
- **M-14 — Generic player:** On an authorized clear or embedded sample, confirm
  the correct audible video is selected and captions remain inside that player.
- **M-15 — Live fallback:** On an inaccessible source, confirm the UI identifies
  live fallback and audio remains audible.

## Setup and privacy

- **M-16 — Same-folder update:** Copy the update over the existing folder without
  deleting `.venv`, `.runtime`, or model caches. Reload the same extension card
  and run `CHECK-SETUP.cmd`.
- **M-17 — Export inspection:** Confirm exported files contain no cookies, API
  keys, license data, DRM keys, audio/PCM, or signed media query strings.

## Classification

- Mark **Pass** only when the check works in the actual browser.
- Mark **Needs development** with reproduction steps when it fails.
- Mark **Blocked/unverified** when it was not run.
- Do not substitute source-code inspection for a manual pass.

# Phase 2 UI/UX manual checklist

Run this after the Phase 1 interaction checks. Reload the unpacked extension and
refresh the video page before testing. This checklist does not automate a site.

## Popup and settings

- **U-01 — Information hierarchy:** Confirm the popup opens with current-session
  language controls and Analyze/Stop actions visible without searching through
  advanced settings.
- **U-02 — Translation:** Toggle translation, change target/provider, and confirm
  the source transcript remains unchanged. Enable **Blur until hover** and
  confirm the translation is blurred until pointer hover or keyboard focus,
  remains available to assistive technology, and can still be selected/copied
  after reveal.
- **U-03 — Independent appearance:** Use both font steppers and color/opacity
  controls. Transcript changes must not alter translation styling and vice
  versa. After Reset, confirm the translation default is smaller than the
  transcript default.
- **U-04 — Reset:** Change every appearance setting, click Reset, and confirm
  visual defaults return while languages, provider, API key, sync offset,
  transcript, vocabulary, and saved transcripts remain untouched.
- **U-05 — Persistence:** Close/reopen the popup and refresh the page. Confirm
  non-reset appearance settings and the manually dragged base position persist.

## Player-aware overlay

- **U-06 — Playing controls hidden:** While controls are hidden, captions should
  use the saved lower position.
- **U-07 — Controls visible:** Move the pointer to reveal controls. Captions
  should rise above the control bar without changing the saved base position.
- **U-08 — Pause:** Pause the video. Captions should remain above the visible
  control area.
- **U-09 — Return:** Resume playback and let controls disappear. Captions should
  return to the saved base position.
- **U-10 — Drag relationship:** Drag captions lower while paused. Temporary
  control avoidance may keep them above the bar; after controls disappear, the
  manually chosen position should become effective.
- **U-11 — Layout modes:** Repeat on YouTube normal/theater/fullscreen and one
  authorized generic player. Record any player whose controls are not detected.

## Word card and interaction preservation

- **U-12 — Compact card:** Confirm Meaning, Examples, Common combinations,
  Grammar, and Related words use compact English headings and empty sections are
  hidden.
- **U-13 — Card state:** Open a word card, let the caption update, and confirm the
  card is not silently closed or reset.
- **U-14 — Preserved actions:** Repeat selection/copy, word click, save/remove,
  YouGlish, replay, and caption dragging from Phase 1.

## Diagnostics and accessibility

- **U-15 — Visible error:** Trigger or observe a safe failure such as an
  unavailable local recognizer. Confirm stage, message, suggested action, and
  sanitized details are readable without exporting JSON.
- **U-16 — Keyboard:** Tab through the popup, activate details/actions, change
  controls, and confirm focus is always visible.
- **U-17 — Zoom and motion:** Check browser UI scaling/zoom where available and
  Windows reduced-motion mode. Content must remain usable without clipped
  controls or required animation.

## Classification

Phase 2 passes only when U-01 through U-17 and the protected Phase 1 checks pass.
Record unsupported player-control selectors as **Needs development**, not as a
general platform pass.

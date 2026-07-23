# UI interaction contracts

This document defines Phase 2/WP2.1 ownership. Visual refactoring may change
markup and styling, but it must not create a second owner for the same gesture or
silently reset unrelated state.

## Event ownership

| Interaction | Owner | Contract |
|---|---|---|
| Select/copy caption text | Native browser selection inside the caption ShadowRoot | Pointer and copy events may stop at the overlay, but their defaults are not cancelled. |
| Activate a word | Delegated transcript click/keyboard handler | Activation runs only when there is a valid word, no active selection, and no drag suppression. |
| Drag captions | Dedicated grip and pointer-drag lifecycle | Only the grip starts dragging. The transcript surface remains text-selectable. |
| Replay a word | Word-card replay action | It temporarily owns seeking/rate/play state and restores the captured user state. |
| Save/remove a word | Word-card action and service-worker vocabulary store | Re-rendering captions does not clear the saved record. |
| Change appearance | Popup controls and `UPDATE_DISPLAY_SETTINGS` | Settings persist independently of the current cue and apply without retranscription. |
| Avoid player controls | Content overlay layout policy | Automatic avoidance raises the effective bottom position; the saved manual position remains the base. |
| Render diagnostics | Popup diagnostic component | It displays sanitized lifecycle state and never changes acquisition decisions. |
| Transcript/library operations | Service worker plus popup library component | Opening/closing a UI panel does not alter transcript completeness or coverage. |

## State invariants

- Re-rendering a cue may replace word spans, but it must not close an open word
  card, erase the selected lookup result, reset appearance, or change the saved
  transcript.
- A native text selection always wins over word activation.
- Manual caption position remains the persisted preference. Player-control
  avoidance is a temporary effective offset and disappears with the controls.
- Translation appearance is independent from transcript appearance.
- Hiding translation does not delete its cache or source transcript.
- Reset appearance changes visual preferences only. It does not change
  languages, translation provider, API key, transcript, vocabulary, or timing.
- Diagnostic presentation does not store or expose signed media URLs, cookies,
  API keys, license data, DRM keys, compressed audio, or PCM.

## Accessibility contract

- Every icon-only action has an accessible name.
- Keyboard focus is visible.
- Word spans support Enter and Space.
- Caption and translation updates use polite live regions.
- Reduced-motion preferences disable nonessential transitions.
- Native selection/copy remains available at browser zoom and in fullscreen.

## Phase 2 classification

Automated tests characterize these contracts, but real popup/player behavior
remains **Experimental** until the combined Phase 1 and Phase 2 manual checklist
passes.

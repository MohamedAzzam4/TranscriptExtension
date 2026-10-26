# UI interaction contracts

0.11.1 translation readiness lives above Analyze and reacts to the current
language pair. Preparation opens an extension-owned setup tab; only its direct
download click starts first-use creation. Closing/reopening the popup never
trusts a stored Ready flag. Percentage is progress only; creation success is
required. Keep the tab open, but do not promise completion or background
continuation. Existing word/selection/replay/drag controls retain their owners.

This document defines Phase 2/WP2.1 ownership. Visual refactoring may change
markup and styling, but it must not create a second owner for the same gesture or
silently reset unrelated state.

## Event ownership

| Interaction | Owner | Contract |
|---|---|---|
| Select/copy caption text | Native browser selection inside the caption ShadowRoot | Pointer and copy events may stop at the overlay, but their defaults are not cancelled. |
| Activate a word | Delegated transcript click/keyboard handler | Activation runs only when there is a valid word, no active selection, and no drag suppression. |
| Dismiss a word card | Capture-phase document pointer listener | A pointer action outside the card closes it without cancelling or stopping the site's event. Clicking another caption word opens that word. Other injected frames relay dismissal only within the same active tab. |
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
- A new player-preparation failure takes precedence over the previous analysis
  result. Keep the failure in session diagnostics until the next preparation
  attempt, without rewriting the previous experiment or cached transcript.
- Analysis settings-save failures release the Analyze action and show an error.
  Analysis startup/storage failures also take precedence over older successful
  results. A quota failure must not delete saved words/transcripts or be reported
  as successful persistence. Storage diagnostics report bytes/policy, not keys
  or content; usage inspection must not become a prerequisite for analysis.
- Optional pronunciation availability or helper loading cannot prevent player
  discovery, session startup or cached transcript replay. Publish content-script
  readiness only after successful initialization; failed setup remains retryable.
  Preserve sanitized frame/message errors instead of reporting an absent video.
- Word-card meanings, definition translations, and example translations follow
  the selected target language/provider. The German definition is preserved;
  its translation is not replaced by an unrelated English dictionary gloss.
- German Wiktionary is the sole active dictionary source. Explicit German form
  references may supply a bounded base-word lookup. Grammar displays only
  source-explicit case/government annotations and verb base/conjugation forms;
  roles, usage notes, and English gloss intermediates are excluded. Case words
  occurring as ordinary definition prose are not extracted.
- Dictionary examples join a meaning only when their source sense identifier
  explicitly matches. Unassigned examples remain visibly separate. Saved video
  context, title, and timing remain metadata rather than word-card/list text;
  a discreet source-return action may use that metadata without exposing it.
- Speak uses browser Web Speech from the speaker gesture, preferring de-DE
  while accepting other explicit German variants. Both local and online browser
  voices are allowed and identified; other-language fallback is blocked.
  Voice-list changes refresh availability without starting speech. Voice availability,
  start, final interruption/cancellation/error, and unconfirmed states are
  card-local and card-epoch guarded; a speech callback is not treated as proof
  that audible playback began.
- Word-card requests capture the selected context and a revision. Closing the
  card, choosing another word, or changing the target language prevents stale
  asynchronous results from repainting the current card.
- Highlights identify matching source/translated terms, not verified semantic
  word alignment. Unmatched paraphrases remain unmarked. Text nodes and marks
  retain native selection and never inject dictionary/translation HTML.
- Each translated example independently counts distinct matching candidates
  before marking. Zero or multiple candidates produce no target mark. Exactly
  one marks all its occurrences; overlap between different candidates does
  not remove their ambiguity.
- Current spoken-word styling is independent from saved/selected/hover states
  and uses the media clock and timing provenance. It must not rebuild text
  nodes or simulate pointer events merely to update the current interval.
- Popup continuity state is stored separately from settings/secrets and restored
  after relevant data is rendered. First-use expansion defaults do not override
  a user's saved expansion state.
- The appearance preview stays within the Appearance view, above independently
  collapsible groups. Preview translation is requested only while that view is
  visible; source/translation appearance updates immediately in the sample.

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

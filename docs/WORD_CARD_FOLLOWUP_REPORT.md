# Word-card follow-up report

Date: 2026-10-25
WP: WP1.3/VOC-1 and WP2.4/WP2.5
Status: **Experimental source candidate — testing paused**

## Outcome

Implemented the approved follow-up on top of the existing uncommitted 0.11.0
candidate. The card now keeps German Wiktionary meanings separate from leading,
source-explicit `mit Akkusativ/Dativ/Genitiv` annotations; these render in
Grammar with a direct selected-language explanation. Verb forms remain in that
same section. Case words in ordinary definition prose are deliberately not
extracted. The parser remains limited to recognized German Wiktionary HTML
patterns; unrecognized source markup remains unclassified rather than guessed.

The German parser retains bracketed source sense IDs. Examples join a meaning only when
their explicit bracketed ID matches; unnumbered, ordinary leading-number, or non-matching examples are rendered
under a separate unassigned-source disclosure. The card uses `Other meanings
(N)`, `More examples (N)`, and `Show full example` for a long first example.
Structural case annotations are removed narrowly from displayed definitions.

Saved scene context, title, timing, video identity, and clip remain preserved
metadata but are no longer rendered as card/list content or used as a definition
fallback. A saved item can expose a compact **Return to source** action without
printing that metadata. It seeks a saved clip only when it is within a confirmed
current seekable range. Cross-page return is routed through the extension worker
to navigate the containing tab safely (including from an embedded frame), and
does not claim that a clip time was restored.

The dictionary cache is now `v6` and fresh entries are marked
`de-wiktionary:v2`. Existing v1 saved records are retained but enriched through
a bounded fresh lookup, allowing their old case-bearing definitions to receive
the new Grammar structure without deleting provenance.

Local German TTS now preflights `getVoices` for a non-remote `de*` voice before
enabling Speak. The card has local availability/guidance and **Check again**;
it never represents voice installation or Translator language packs as a
download/progress operation. Speech state is driven by actual TTS events:
accepted, speaking, end, interrupted, cancelled, error, and unconfirmed are
distinct. Close/new-card epochs invalidate stale availability and speech
responses; word replay remains independent.

## Changed files

- `extension/learning-features.js` — case extraction, sense-aware German
  Wiktionary parsing, preserved example IDs, normalized source government rules.
- `extension/service-worker.js` — v6 dictionary cache, v2 dictionary contract,
  local voice preflight and event relay.
- `extension/content.js`, `extension/popup.js` — grammar/example controls, metadata-safe card/list,
  source-return action, and card-local TTS lifecycle.
- `extension/test-learning-features.mjs` and
  `extension/test-word-card-localization.mjs` — static characterization fixtures
  for case boundaries, senses/unassigned examples, voice guards, and disclosures.
- `docs/FEATURE_REGISTRY.md`, `docs/UI_INTERACTION_CONTRACTS.md` — updated
  formerly verb-only grammar contract.

## Deferred evidence

Per the user’s testing pause, no test, syntax check, build, preview, browser
automation, translation request, or TTS experiment was run. The new fixtures
were authored but not executed. Required later checks include German Wiktionary
markup variants, legacy saved-record enrichment, Arabic/English case
explanations, local/missing German voice behavior, all final TTS states,
same-word close/reopen stale events, source-return behavior, and the protected
selection/copy/save/YouGlish/replay/drag/cache/embedded-player matrix.

No commit or push was made. Pre-existing unrelated changes, including the native
host executable, archives, `.opencode`, and supplied design directory, were not
modified.

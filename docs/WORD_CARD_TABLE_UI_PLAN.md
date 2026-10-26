# Word-card table and hierarchy polish

2026-10-26. WP2.4/WP2.5, dependent on existing card/grammar contracts.
Baseline d8d65cb, extension0.11.1, branch codex/local-media-loopback.
User explicitly requests UI edits without functionality testing. Do not run
functional suites, browser interactions, translation, pronunciation or analysis.
Static source/syntax/whitespace review only; functional acceptance stays unverified.

Preserve lookup, source/target translations, saved vocabulary, replay, speech,
YouGlish, source links, text selection, highlights and all available grammar data.
No extraction, provider, storage, timing or acquisition changes.

Apply ui-ux-pro-max to existing plain JavaScript/Shadow DOM/CSS card: explicit
typography hierarchy, native accessible disclosures, readable semantic tables,
keyboard focus and contained horizontal overflow. Keep the existing palette.

Move Other meanings into Meaning after the main definition and translation.
Make section headings13px bold and disclosure labels12px, independent of caption
settings. Render verb overview as a two-column table, detailed conjugations as
a full-width three-column table grouped by existing tense/mood/source section.
Keep detailed conjugations collapsed initially. Never invent missing forms.

User reports translation preparation works in their normal browser. Record this
as user-observed success; language pair, cold download/background behavior and
exact timing were not supplied. Do not conflate it with MCP environment failures.

# UI typography — WP2.2 / WP2.4 / WP2.5

2026-10-28, candidate 0.11.5. Baseline203dcd2 /0.11.4 on
codex/local-media-loopback. Existing popup/card/library contracts and historical
9fd4dd0 reviewed. Pre-change popup binding/localization/saved-review suites pass.
Depends on existing UI/card surfaces; no YouTube milestone work begins here.

UI/UX Pro Max typography search recommends the Modern Professional sans pairing
(Poppins/Open Sans), and UX guidance recommends a consistent12/14/16/18/24/32
scale with readable line height. Adaptation for this narrow desktop extension:
one bundled Open Sans variable font for headings/body/controls; Tahoma/Arial/
system fallbacks for Arabic and unsupported glyphs. No remote font requests at
runtime. Font is from official google/fonts/ofl/opensans; adjacent OFL applies.

Shared tokens live in `extension/typography.js`, used by extension pages and
injected Shadow DOM. Change the scale there for future UI work:

| Role | Size | Weight / leading |
|---|---|---|
| Metadata, labels, help, nav | 12px | 400–600 /1.5 |
| Body, definitions, examples, controls | 14px | 400–600 /1.5 |
| Video titles, important subsection labels | 16px | 600 /1.4 |
| Card/section titles | 18px | 700 /1.35 |
| Page titles, translated word heading | 22px | 700 /1.3 |

Use weight/spacing for hierarchy before introducing another size. Avoid serif
display faces or monospaced prose in the compact UI. Keep only technical values
monospaced when alignment helps. Long video titles wrap fully at16px (Home keeps
its existing three-line clamp); full source/navigation remains available. New
family/size rules do not alter user-controlled caption preferences or defaults.
IPA uses normal glyph fallback; target text retains lang/dir.

Scope: popup CSS, translation setup, shared card/notice UI, font asset loading.
No storage/schema/dictionary/translation engine changes. Shared CSS tokens are
injected as trusted bundled source; the font alone is web-accessible to pages.

Validation: local syntax, existing extension/server regression, manifest/assets
and whitespace checks. No additional implementation-mirroring tests for this
style change. Browser testing remains paused; visual/font-loading/Arabic/zoom
acceptance is unverified. UI candidate Experimental, wider known dictionary gaps
remain Needs development. User will review before supplying YouTube instructions.

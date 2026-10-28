# Dropdown fit — WP2.2 / WP2.4 / WP2.5

2026-10-28. Baseline2027416 /0.12.2 on codex/local-media-loopback.
Depends on the bundled typography contract and existing popup/player settings.
User screenshots show oversized dropdown text, a provider field constrained to
half a row, clipped long labels and misaligned language controls when a heading
wraps. Popup binding/startup suites pass before changes. Existing typography
checkpoint805fe83 and protected feature registry reviewed.

Apply UI/UX Pro Max form-label, hierarchy and long-content guidance to the plain
HTML/CSS/JavaScript UI: add a12px dropdown role with existing bundled font,
normal weight/spacing and explicit option styling; keep body text/captions at
their existing sizes. Give the lone provider field a full row, bottom-align the
language fields and tighten their label tracking. Shorten long mode/provider
labels without changing values or preference logic; retain explanatory help.
Apply the same dropdown role in player settings. Preserve native select/keyboard
semantics, contrast and control height. No custom dropdown or framework rewrite.

Validation: existing popup/menu and complete local regression, static option
value/version/manifest comparison and intended diff review. No new tests that
mirror CSS declarations. Browser testing remains paused; real font loading,
native option menu, zoom/narrow-width fit and fullscreen remain unverified.
Record the UI candidate as Experimental, then commit/push only intended files.

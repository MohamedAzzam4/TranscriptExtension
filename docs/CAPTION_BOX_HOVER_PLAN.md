# Caption box hover — WP2.4 / WP2.5

2026-10-28. Baseline bdc65d4 /0.12.4 on codex/local-media-loopback.
Depends on existing pause ownership/global shared preference and stable caption
box. Historical cba388a listeners and registry reviewed. Existing hover and popup
binding suites pass. User expands the enabled hover region from individual words
to the whole caption box (source, gaps/padding, translation, drag handle).

Bind pointer entry/exit to the stable box, preserving owned pause/resume, manual
play/pause, default off, settings key, replay, selection/copy, drag and navigation
cleanup. Do not release hover merely because source words rerender; the box is
still hovered. Update popup/player help to state box scope. No new setting or
storage migration. Applies equally to YouTube and supported generic sites.

Characterize the existing gap failure before editing, then test real listener
wiring with box entry/exit, internal child movement, source/target replacement,
manual pause, preference changes, ownership/navigation and cross-feature suites.
Browser tests remain paused: physical hover/drag/fullscreen acceptance unverified.
Record Experimental, commit/push intended implementation/tests/evidence only.

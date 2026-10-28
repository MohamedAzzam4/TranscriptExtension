# YouTube controls/hover repair — WP2.4 / WP2.5 / WP3.4

2026-10-28. Baseline cba388a /0.12.0 on codex/local-media-loopback. The user
reports actual automatic transcript retrieval succeeds, but the overlay retains
Starting, the player button fails to reveal settings, and hover pause/settings
are inaccessible. User observation establishes retrieval success only; it does
not establish the retrieval route, track type or other platform checks.

Dependencies: retain the0.12.0 browser/native caption retrieval, cache, provenance
and word interaction contracts. No acquisition rewrite. Source inspection finds
static Starting text without YouTube lifecycle cleanup; the menu is inside the
control-button ancestry (a clipping risk). Hover pause defaults off by design,
and both switches are buried in collapsed Appearance/Transcript settings.

Plan: characterize the actual menu DOM/click/settings lifecycle locally first;
mount its isolated panel directly inside the player, independent of control-bar
clipping. Preserve Escape/outside/focus/rebuild/fullscreen positioning and shared
storage. Make the shared interaction switches visible outside collapsed controls.
Use explicit pending/ready startup state, retaining errors and popup diagnostics.
Cover actual delegated hover bindings and manual/adjacent pause ownership.

Baseline local navigation, hover and saved-card suites pass but do not exercise
the player's settings menu. Add a local DOM regression for that missing surface;
run the affected and full existing local regression. Browser testing remains
paused. Record actual browser rendering and physical mouse behavior unverified,
and distinguish confirmed source defects from suspected host-CSS effects.
Candidate Experimental until user/browser acceptance. Exclude unrelated binary
and artifacts; commit/push intended source/tests/docs as project policy requires.

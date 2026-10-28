# Player menu presentation — WP2.4 / WP2.5

2026-10-28. Baseline e840813 /0.12.1, codex/local-media-loopback.
User screenshot confirms the menu opens but shows black serif labels on its
dark background. They subsequently clarify hover works when checked. Preserve
hover behavior and default off; no browser approval was supplied, so the prior
browser-testing pause remains active.

Source diagnosis: menuHost has inline all:initial. The shadow :host font/color
rules cannot override that inline reset, so descendants inherit initial black
serif text. Set typography, text color and control styles explicitly on panel
elements, rather than relying on inherited host values. No retrieval changes.

Apply UI/UX Pro Max dark/high-contrast, focus,44px interaction targets and
progressive-disclosure guidance. Retain established green palette and bundled
Open Sans/12–22px scale rather than introducing the search's suggested unrelated
marketing colors/fonts. Group source/learning tools clearly; translation,
appearance and source troubleshooting remain expandable. Add a clear close
control, labelled switches with visible On/Off state, concise status and an
explicit dark form-control theme. Keep all existing settings and actions.

Dependencies:0.12.1 detached panel/focus/storage/menu lifecycle. Characterize
existing menu/settings first, then test the new hierarchy, checkbox semantics,
state text, close/Escape, storage/focus/scroll preservation and text contrast
locally; run full local regression. Actual browser styling and mouse behavior
remain unverified except the user's reported menu-open/hover success. Record an
Experimental candidate, not a full platform pass; commit/push intended files.

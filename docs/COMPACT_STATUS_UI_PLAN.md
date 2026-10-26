# Compact statuses and transient caption notices

2026-10-26, WP2.4/WP2.5. Baseline9fd4dd0 / extension0.11.2.
Preserve speech/retry, replay provenance, timing accuracy, dictionary source
references and popup diagnostics. Keep extraction and playback logic unchanged.

Use ui-ux-pro-max on existing Shadow DOM/CSS: compact status icons with hover
and keyboard-focus text, two-second informational notices followed by a gentle
fade, reduced-motion handling and persistent critical error visibility. Repeated
caption frames must not restart the timer; stale timers must not hide new errors.
Move long voice/help text out of reading flow. Retain retry control access.

Persist only sanitized last-reported UI diagnostic fields in browser session
storage, scoped to the active experiment/media frame. Popup diagnostics retain
voice/help/replay/timing text after notices fade and worker restarts. No audio,
media URLs, selected-word text or secrets are included in this UI snapshot.

Show one ordinal per meaning (1.,2.,3.); keep source sense references in data.
Quick local syntax, fake-clock/helper and targeted lifecycle checks only; no
browser/media/translation/voice tests or broad dictionary reevaluation.

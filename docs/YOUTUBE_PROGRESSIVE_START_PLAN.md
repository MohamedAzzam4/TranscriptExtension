# Progressive YouTube start — WP3.1 / WP3.4 / WP2.4

2026-10-28. Baseline d1a78e4 /0.12.3, codex/local-media-loopback.
Dependencies: original caption/translation separation, request-generation guard,
player-level menu and hover ownership. Existing navigation/hover suites pass.
Registry/history cba388a reviewed. User reports paused initial video and no
preparation feedback. Source confirms rendering waits for translation/cache;
no pause command found in that retrieval path, so pause cause is unconfirmed.

Show source captions immediately after retrieval, before optional translation
or cache writes. Update the same overlay when target captions arrive, preserving
selection/card/hover state. Native fallback initially requests source only;
optional target retrieval follows afterward. Preserve source-track priority,
cache provenance, no implicit ASR and generation checks on all late updates.
Keep Chrome/configured Cloud fallback if YouTube translation fails.

Add compact player preparation feedback, separate from caption session. Source
preparation persists until ready/error; translation preparation says source is
ready. Ready notices fade after2seconds; diagnostic details stay in popup.

Attempt playback once per newly opened video when media is ready, visible and
outside an ad. Never mute to evade autoplay policy, loop attempts, start an ended
video, or override observed playback/user pause intent. Handle play() rejection
with an actionable compact notice plus diagnostics. Preserve same-video intent
across retries/settings/media replacement. Clean up playback listeners/navigation.
MDN current play() autoplay docs fetched through Context7: NotAllowedError may
require user interaction. Guaranteed automatic playback cannot be claimed.

Characterize blocked translation/cache rendering before repair, then test source
first, delayed/failed translations/native helper/cache, stale navigation, overlay
updates without reset, playback success/rejection/user intent/ads/cleanup. Run
all local and critical cross-feature suites. Browser testing remains paused;
mark actual Chrome autoplay/render/hover/fullscreen unverified and Experimental.
Commit/push intended changes and evidence only; exclude unrelated native EXE.

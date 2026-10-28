# YouTube caption mode — approved 2026-10-28

Baseline805fe83 /0.11.5, codex/local-media-loopback. WP3.1/3.2/3.4/3.5,
WP2.2/2.4/2.5, WP1.3. This approved scope supersedes the source, translation
and automatic-ASR fallback decisions in YOUTUBE_CAPTION_FIRST_TIMING_VOCAB_PLAN.md.

1. Browser adapter first, creator-provided spoken-language subtitles before
   original automatic captions. Never treat a translated track as source speech.
2. Retrieve automatically for each new YouTube video/playlist navigation when
   learning captions are enabled. Cancel stale work, use safe source-aware cache,
   and leave audio acquisition/model loading outside the caption path.
3. Existing yt-dlp/native transport is subtitle-only fallback; no audio/model
   run. Missing captions remain visible with retry/track choice; audio ASR is
   explicit only. Existing generic-site/audio functionality remains available.
4. YouTube auto-translation first when available, Chrome/configured Cloud fallback.
   Translation windows align by time; failure never changes the original source.
5. Player transcript icon opens isolated settings/track/appearance controls.
   Shared stored settings, keyboard/Escape, fullscreen/control rebuild handling.
6. Global current-word highlight defaults on; pause-on-word-hover defaults off.
   Pause ownership restores only extension-paused playback, respects manual
   pause/play, and remains paused between adjacent words. Natural selection,
   dictionary clicks, drag, replay and saved-word marks remain protected.

Contracts: caption text stays captionSegments with transcriptSource provenance;
no audioCoverage/ASR success claims. Per-tab caption sessions do not overwrite
other tabs' active audio capture. Persist only normalized cues/track identity,
never caption URLs/tokens/cookies. Old ASR cache/library entries remain readable.
Navigation invalidates source/translation work and restores native caption UI.

Dependencies: establish pure selection/parser/provenance before lifecycle wiring;
implement browser bridge with untrusted-input validation and bounded requests;
then native fallback, cache/diagnostics/export, controls, playback preferences.
Baseline local suites and historical source checkpoints inspected before edits.

Evidence required: deterministic track/parser/translation alignment and hover
ownership tests; mocked worker/browser/native lifecycle, stale navigation, cache,
privacy and old regression. Full local extension/server/static checks. Real
YouTube/browser/media tests remain paused under the user's earlier restriction;
record as unverified, not a Pass. Candidate remains Experimental/Needs development
until source/platform acceptance is measured. No ASR timing corrections in scope.

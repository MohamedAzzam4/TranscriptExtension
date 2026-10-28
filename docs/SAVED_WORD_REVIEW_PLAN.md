# Saved-word review — WP1.3 / WP2.4

2026-10-28. Baseline cdd7422, extension 0.11.3, branch
codex/local-media-loopback. Depends on the existing saved-vocabulary contract,
German dictionary card renderer, and target-language translation path. These
contracts are reused; known dictionary extraction gaps remain outside this UI task.

Make saved-word titles native buttons opening the same card inside the Words tab.
Use an explicit extension-page review mode of the existing content renderer rather
than copying its meanings/examples/grammar/localization logic. No video or analysis
session is created. Replay belongs to the source video and is unavailable here;
Return to source remains available. Metadata stays hidden. Back/Escape restores
the list's search/filter/scroll and focus. Reopening the popup restores the selected
word and detail scroll; an entry removed elsewhere closes its review safely.

Protected contracts: LEARN-CARD, LEARN-SAVE, LEARN-YG, UI-A11Y, popup state,
INT-SELECT and the existing player renderer. Inspect historical1546662 and current
card checkpoints9fd4dd0/cdd7422 before editing. Baseline popup bindings,
localization and learning-feature suites pass. Working tree contains unrelated
native-host binary/untracked artifacts; exclude them.

Evidence: local DOM lifecycle tests with mocked translation/storage, syntax,
all existing extension/server regression suites and whitespace checks. Browser
testing remains paused under the user's previous restriction. Real speech,
translation packs, visual layout and cross-platform interaction remain unverified;
do not mark this version a full release Pass without those checks.

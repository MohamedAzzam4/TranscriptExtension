# Delegated task: replay precision, sentence replay, and translation blur

This document is a copy-paste task contract for a lower-cost coding agent. It
does not authorize merging its work. The result remains a candidate until the
project regression policy and manual browser checks pass.

## Recommended model

Use `gemini-3.6-flash` with medium or high thinking for implementation. The
change looks small, but it touches shared player state, word/caption gesture
ownership, settings normalization, and persistence.

`gemini-3.5-flash-lite` may run mechanical checks or review the final diff, but
should not be the only reviewer deciding that playback restoration and gesture
contracts are correct.

## Copy-paste prompt

You are implementing one bounded candidate version of **Dub Transcript Lab**.
Work source-honestly: a feature is not passed merely because code exists.

### Isolation and Git

1. Do not work directly in the user's active folder or current branch.
2. Create or use an isolated Git worktree based on the latest pushed
   `origin/codex/animekai-png-hls`.
3. Create branch `agent/replay-sentence-translation-blur`.
4. Before editing, report the exact base commit and `git status --short`.
5. Do not merge to another branch. Push only your candidate branch after tests.
6. Never stage or commit `.opencode/`, existing ZIP files,
   `server/native-host.exe`, `.venv/`, `.runtime/`, models, logs, transcripts,
   media, PCM, or user settings.

### Mandatory reading before edits

Read these files completely:

- `AGENTS.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- `docs/REGRESSION_TEST_PLAN.md`
- `docs/FEATURE_REGISTRY.md`
- `docs/PRODUCT_BACKLOG.md`
- `docs/UI_INTERACTION_CONTRACTS.md`
- `experiments/PHASE1_MANUAL_CHECKLIST.md`
- `experiments/PHASE2_MANUAL_CHECKLIST.md`

Inspect the historical intent at commits `1546662`, `64875b8`, and `ea1379c`
without replacing the current implementation with old files.

### Pre-change baseline

Before editing:

1. Run `RUN-REGRESSION.cmd`.
2. Record every command, exit code, suite count, and existing failure.
3. Identify the current implementations of:
   - exact and estimated word timestamps;
   - player-state capture/restoration;
   - text selection versus word click;
   - caption dragging;
   - translation settings normalization/reset/persistence; and
   - word-card action layout.
4. Add characterization tests before changing replay behavior.

### Scope

Implement only:

1. **Replay word plus replay sentence/caption**
2. **Tighter word replay boundaries**
3. **Translation blur-until-reveal**
4. **Regression coverage and candidate documentation**

Do not modify audio acquisition, platform adapters, HLS/DASH/YouTube/Netflix
logic, native host, installer, transcription model settings, translation
providers, dictionary providers, transcript storage schema, or unrelated UI.
Do not install a forced-alignment model or add a new dependency.

### UX contract

#### Replay

- In the existing word card, show one compact replay group with two adjacent,
  accessible actions: **Word** and **Sentence**.
- Do not add a modal, menu, settings page, floating toolbar, or autoplay.
- If sentence boundaries are unavailable and only the current phrase/caption is
  known, label the second action **Caption** and explain the limitation in its
  accessible title.
- Keep YouGlish, Save, Close, dictionary sections, card placement, and caption
  updates working.
- Disabled actions must be visibly disabled and have an explanatory accessible
  label/title.

#### Translation appearance

- Preserve the current default sizes: transcript `31 px`, translation `21 px`.
  Do not overwrite existing user-chosen sizes during migration.
- Add one checkbox/switch inside the existing Translation appearance section:
  **Blur until hover**.
- Default is off.
- Use one fixed, readable blur value. Do not add a strength slider.
- When enabled, visually blur translation text until pointer hover or keyboard
  focus. Provide an equivalent touch/click reveal that does not fire when the
  user is making a text selection.
- The text must remain in the DOM and available to assistive technology.
- Native selection/copy must work after reveal.
- Respect reduced motion and do not animate layout dimensions.
- Blur changes appearance only. It must not refetch translation or change
  translation cache identity.

### Replay timing contract

Refactor replay interval calculation into deterministic, independently tested
helpers. Avoid duplicating player-state restoration for word and sentence
replay.

For `word-timestamps`:

- Remove the unconditional `-0.18 s` start and `+0.22 s` end padding.
- Use small playback handles only where they do not cross a neighboring word
  boundary.
- When previous/next word timing is available, clamp the chosen interval at the
  midpoint of the available gap/boundary so replay does not deliberately include
  an adjacent word.
- Never extend a short word to a minimum duration by crossing a known adjacent
  boundary.
- Clamp to media duration and keep `start <= end`.

For estimated timing:

- Preserve a conservative audible fallback.
- Mark the timing as estimated in the UI and saved provenance.
- Do not describe proportional within-cue estimates as exact.

For sentence/caption replay:

- Prefer the first and last exact word boundaries of the recognized sentence.
- Otherwise use the current display-group/cue start and end.
- Preserve whether the boundary is a recognized sentence or only a
  caption/phrase.

For all replay:

- Capture original media time, paused/playing state, playback rate, and any
  volume state the current implementation promises to preserve.
- Restore exactly once after success, failure, close, a second replay request,
  or teardown.
- Repeated replay must not create competing timers or corrupt synchronization.

Do not claim sample-accurate isolation. Faster-Whisper word timestamps are
approximate and natural speech can coarticulate across word boundaries.

### Required automated tests

Add or extend deterministic/lifecycle tests for:

- exact word interval with previous and next neighbors;
- exact word at sentence start/end;
- overlapping, equal, missing, malformed, and zero-duration boundaries;
- estimated word fallback and visible provenance;
- sentence and caption interval selection;
- restoration while originally playing and originally paused;
- playback-rate/time restoration after success, failure, close, and replay
  replacement;
- no leaked interval/timer after teardown;
- both replay buttons and accessible disabled states;
- translation default `21 px` versus transcript `31 px`;
- blur preference normalization, default, persistence, update, and Reset;
- blur class/CSS, hover, focus, reduced motion, and touch/click reveal contract;
- selection/copy still wins over reveal/word-click behavior;
- caption dragging, word lookup, Save, YouGlish, translation toggle, cache
  replay, and generic-player bindings remain present.

Run the complete `RUN-REGRESSION.cmd`, not only focused tests. Run
`git diff --check`.

### Candidate status

- Bump only the extension patch version if implementation and automated tests
  pass.
- Mark the result **Experimental** until the user performs M-01 through M-14
  and U-01 through U-14 as applicable in a real browser.
- Do not claim YouTube, AniWorld, AnimeKai, fullscreen, touch, or accessibility
  passed unless those exact checks were performed.
- Do not create a ZIP unless the user separately requests it.

### Mandatory final report

Return a report with these exact headings:

1. **Result:** Pass / Experimental / Needs development / Blocked
2. **Base and branch:** base commit, branch, final commit, push result
3. **Requirements completed:** one row per requested behavior
4. **Files changed:** every file and why
5. **Behavior before and after:** factual, concise comparison
6. **Replay timing:** exact formulas, padding/handles, clamping, fallbacks, and
   provenance labels
7. **Settings and migration:** defaults, existing-user behavior, Reset, storage
8. **Tests run:** exact commands, exit codes, suite/test counts
9. **Tests not run:** every skipped manual or automated check and why
10. **Regression audit:** selection, word click, Save, YouGlish, dragging,
    translation, cache, export, YouTube, AniWorld, AnimeKai
11. **Privacy and security:** data/storage/network/dependency changes
12. **Known limitations and risks:** especially timestamp accuracy and
    unverified browser behavior
13. **Diff summary:** `git diff --stat` plus any generated/untracked files
14. **Honesty statement:** explicitly state that source presence and automated
    tests do not prove manual browser behavior

If any instruction conflicts with the current code, stop and report the
conflict instead of silently deleting or weakening a protected behavior.

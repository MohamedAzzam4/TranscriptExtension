# German-only learning implementation plan

Date: 2026-10-25. Planning baseline: `0455ce3` on
`codex/local-media-loopback`, with the existing uncommitted 0.11.0 Terra UI
candidate. This document specifies implementation without providing source
code or pseudocode.

## Authorization, ownership, and status

The user requested a written plan followed by implementation by a GPT Terra
subagent inside the current agent system. No OpenAI API integration or API key
is requested. The parent agent owns planning and static review; the requested
subagent owns source changes and its implementation report. Do not substitute
another model silently if Terra cannot be selected.

Testing remains paused by the user. Source inspection and implementation are
authorized; running tests, syntax checks, browser automation, preview servers,
recognition jobs, builds, or real translation/TTS experiments is not authorized
in this step. Tests may be authored for later execution. No source change is
to be reported as behaviorally verified merely because it was implemented.

This remains an **Experimental candidate with validation pending**, not a
completed release/checkpoint. Retain the current candidate version until its
validation/release gate is explicitly resumed. Do not commit/push or claim a
completed release while these required checks remain paused. The usual
checkpoint commit/push policy applies once the checkpoint is validated.

Do not alter pre-existing user changes to `server/native-host.exe`, archives,
`.opencode/`, or the supplied Stitch design directory. Work in the current
checkout and preserve its uncommitted UI work. No production rewrite, learning
website, new AI provider, or acquisition refactor is included.

## Work packages and dependencies

| WP | Outcome | Dependencies | Evidence required after testing resumes |
|---|---|---|---|
| WP1.3 / VOC-1 | German-only word cards and saved-word compatibility | German dictionary parsing; existing normalization and vocabulary store | Source/parser fixtures; verb/base-form fixtures; old saved-record replay; no English-source request tests; save/remove and cross-show checks |
| WP2.2 / WP2.4 / WP2.5 | Compact multilingual cards, pronunciation, restored popup position, visible diagnostics | Existing Terra styling and event ownership; browser storage and speech APIs | Highlighting/state/voice contract suites; Arabic/English browser checks; selection/copy, outside dismissal, drag, focus, zoom and fullscreen checks |
| WP3.2 bounded experiment | Current spoken-word highlight | Existing word/cue timing provenance and media clock; stable token mapping | Exact/estimated timing, gaps, seek/pause/rate/sync tests; real first/middle/end media observation |

Earlier full browser gates are unfinished. The user explicitly reprioritized
this bounded implementation, so it does not imply those prerequisites passed.
No YouTube timing correction or caption-first acquisition is included.

## 1. German Wiktionary data contract

Use German Wiktionary as the only dictionary source for newly rendered cards.
Remove English Wiktionary requests, displayed source links, English gloss
translation, and English-based lemma resolution from the active card path.
Update permissions only when an old dictionary host is no longer needed.

Keep individual German meanings separate. Each retains its original German
definition, stable identity within the entry, associated German examples where
the source provides that association, and German source provenance. Definition
alternatives are these separate meanings, not a list of English glosses.

Superseded in this narrow respect by
[`WORD_CARD_FOLLOWUP_PLAN.md`](WORD_CARD_FOLLOWUP_PLAN.md): source-explicit
case/government is now a separate Grammar contract for all applicable entries.
For verbs, retain the German infinitive/base form and available documented
conjugations. Resolve an inflected form using explicit German Wiktionary links
and form references, with a bounded follow-up lookup and no English bridge.
Do not guess a lemma by stripping a word ending. Distinguish a base-entry
definition from a definition of the exact clicked surface form in provenance.

Do not display parts of speech, gender, grammatical roles, usage notes, noun
singular/plural tables, or other unapproved dictionary sections. Internal verb
identification is permitted solely to determine whether verb forms apply.
Missing dictionary information remains missing rather than generated.

Use a new German-only dictionary cache identity. Do not reuse old mixed-source
records as if they were German-only. Preserve saved words and old records
without destructive migration. Legacy English fields may remain as preserved
historical data, but must not supply new card meanings or intermediate inputs.
Reopening a legacy saved entry may enrich it from German Wiktionary; failure
must retain its saved status, source context, and available German evidence.

## 2. Card presentation and examples

The bold heading is a short direct translation of the clicked German word into
the current target language. A standalone word can be ambiguous; do not claim
that this operation determines its exact contextual sense.

For every meaning, show the German definition followed immediately by that
definition's target-language translation. Translate definitions separately;
do not merge several senses into one request or fabricate shortened meanings.
Show the first meaning compactly and make further meanings expandable.

Prefer one short complete German Wiktionary example by default. Additional
examples and long original sentences remain expandable. Normalize duplicated
quotation decoration, but do not rewrite quotations or translate a truncated
sentence as if it were the full example. Translate the entire selected German
example sentence. Current video text may remain separately identified as
source/video context, never as a Wiktionary example.

Choose examples containing the selected word form so all its occurrences can
be highlighted in the German original. Do not fabricate an occurrence or mark
a different inflection as if it were the clicked word. If there is no matching
source example, show an explicit unavailable state rather than invent one.

Keep Replay clip, YouGlish, save/remove, original video provenance, outside
dismissal, and natural selection/copy. Keep the existing themed scrollbar,
smaller video title, sticky appearance preview, and bold collapsible settings.
No grammatical-role or usage-note UI is to return.

## 3. Translation routing and visibility

Every new card translation input must be German: a word, one definition, or a
whole example sentence. The chosen target may be Arabic, English, or another
supported language. Original German verb forms remain visible; any translated
explanation must follow the same target-language rule. No English-intermediate
lookup, example fallback, or gloss is permitted when preparing a new card.

Reuse compatible cached results, then use Chrome's built-in on-device
Translator API first. This API belongs to the browser and is not a separately
installed extension. Check availability for the specific language pair and
report model download progress, unavailable pairs, readiness, and failures.
Do not treat Translator presence alone as evidence a particular pair works.

Google Cloud Translation is an optional fallback after on-device unavailability
or failure, and only when an API key has been configured. Adjust existing
provider controls so this policy cannot silently become Google-first. Existing
on-device-only preferences may continue to forbid the cloud fallback.

Correct cache provenance so changing provider policy cannot silently reuse an
incompatible cached provider result. Cached results retain their actual source
and provider. Keep source-language/target-language identity and original text
validation. API keys remain in the existing separate secret store and never
enter UI-state snapshots, learning records, exports, logs, or page content.

Expose download/availability/fallback states in the popup diagnostics and
relevant card feedback, with sanitized messages and no forced view/scroll jump.
Reject stale async results when the word, target language, or session changes.

## 4. Exact target-language text-search policy

Translate the complete German example, then translate the possible German
meanings individually to obtain target-language candidates. Use deterministic
text matching; do not add semantic alignment, an English bridge, or guessed
target inflections. Retain readable original text and use text nodes/marks,
never translation-supplied HTML.

Normalize and deduplicate identical candidates before counting. Determine
which distinct candidates occur before applying any mark. Overlapping
different candidates still count as different candidates; do not silently
pick the longest and hide the ambiguity.

| Distinct candidates found in the translated example | Required behavior |
|---|---|
| Zero | No translated highlight |
| Exactly one | Highlight every occurrence of that candidate |
| Two or more | No translated highlight |

German source highlighting is independent of that decision. Missing matches
are acceptable: translated definitions can be explanatory phrases that do not
occur verbatim in the translated example. Do not promise perfect alignment.

## 5. Built-in pronunciation

Add an accessible speaker action to the word card for the selected German
word, even when its displayed meaning is Arabic or another language. Use the
browser/operating system's installed German speech voice through the extension
speech capability, with the minimal required manifest permission. Do not
install another extension, require an API key, or silently choose a remote or
wrong-language voice.

Handle voice discovery, missing local German voice, speaking, completion,
interruption, and error explicitly. Repeated clicks must not build an unwanted
speech queue. Keep synthesized pronunciation distinct from original-video
Replay clip and preserve the user's video time, playback rate, and pause state.

## 6. Popup position and edit continuity

Store versioned UI state separately from experiment settings and secrets:
active view, scroll location per view, expanded containers, and vocabulary
search/filter. Prefer stable element/record anchors plus an offset where list
rendering could shift the content. Maintain ordinary pending edits through
the existing appropriate setting stores; never copy password/key values into
the UI-state record.

Save on user interactions and periodically during scrolling; do not depend on
an unreliable final unload save. Restore after settings and relevant library
content are ready: select the view, restore expanded groups and filters, then
restore its scroll anchor. Ordinary navigation should reuse each view's prior
position. Diagnostics refreshes must not reset focus or scroll.

For a fresh UI state only Transcript starts open in Appearance. For later
openings the user's stored expansion state takes precedence. Preserve the
sticky preview while moving through controls.

## 7. Current spoken-word highlighting

Map displayed German tokens to their word timing records and validate the
mapping instead of blindly relying on token count. Preserve exact word-timing
versus estimated-within-cue provenance. Where the mapping is unreliable or
there is no interval, do not mark an arbitrary word.

Drive the current-word state from video time minus the existing sync offset.
Use a lightweight playing-frame update and immediate seek/pause/rate updates;
the existing 250 ms session timer alone is too coarse for short words. Change
only the previous/current token classes, without rebuilding caption nodes,
simulating hover events, opening cards, or breaking selection.

Reconcile seeking, replay, silence gaps, cue changes, paused media, playback
speed, and cached replay. Refresh timing metadata when a cue's timestamps are
revised without destroying a selection. Clean up any additional animation
lifecycle on session end. Present approximate timing honestly in diagnostics;
do not confuse a length-weighted estimate with measured word timing.

## 8. Diagnostics position

Move the existing Analysis diagnostics component immediately beneath the Home
video card, ahead of timing controls and vocabulary. Preserve its existing
message bindings, stage, progress, cache/fallback provenance, and sanitized
details. Do not create a duplicate diagnostic owner or force Home open while
the user is editing another view.

## 9. Review, report, and deferred acceptance

Before editing, read the protected feature registry, interaction contracts,
relevant historical checkpoints, and existing tests. Inspect current source
because the working tree contains intentional changes not in HEAD. Fetch
current API documentation through Context7 when required by AGENTS.md.

Author/update relevant characterization and regression coverage without
executing it while testing is paused. Required future checks include German
source/verb fixtures, legacy saved data, direct German translation inputs,
candidate counting, provider/cache/download failures, local-voice selection,
UI-state restoration, timing lifecycle, and all critical cross-feature suites.
The manual matrix must cover Arabic and English, an embedded player,
selection/copy/drag/replay, fullscreen, cached transcripts, and upgrade data.

The implementing agent must write a report identifying the requested model,
files changed, each requirement implemented/partial/missing, observable
failure paths, compatibility decisions, tests authored, tests not run,
limitations, and follow-up checks. The parent will statically review the
actual diff against this plan and reconcile discrepancies. Neither a report
nor source inspection is proof of successful runtime behavior.

Do not claim a tested pass, completed release, or pushed checkpoint at this
stage. Report the local candidate and paused verification boundary clearly.

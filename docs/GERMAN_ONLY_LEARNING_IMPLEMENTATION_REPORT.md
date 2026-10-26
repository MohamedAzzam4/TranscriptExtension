# German-only learning implementation report

Date: 2026-10-25
Requested implementation model: GPT Terra subagent in the current Codex agent system (no API integration or API key was added).
Candidate baseline: `0455ce3` on `codex/local-media-loopback`, including the pre-existing uncommitted 0.11.0 Terra UI and saved-vocabulary work.
Status: **Experimental local candidate — validation is paused and no runtime evidence is claimed.**

## Work package and boundary

This implements the bounded WP1.3/VOC-1, WP2.2/WP2.4/WP2.5, and WP3.2
candidate described in `GERMAN_ONLY_LEARNING_IMPLEMENTATION_PLAN.md`. It does
not change media acquisition, recognizer behavior, the native host, archives,
`.opencode/`, or the supplied Stitch directory. No commit, push, package, test,
syntax check, build, preview, browser automation, recognizer run, translation,
or TTS experiment was run.

The implementation consulted the protected registry, interaction contracts,
roadmap, regression plan, backlog, experiment matrix, current uncommitted
candidate source, and the `1546662` historical learning implementation. Current
Chrome Translator API documentation was fetched via Context7. That documentation
supports `Translator.availability`, `Translator.create` with
`downloadprogress`, and `translator.translate`.

## Requirement disposition

| Requirement | Status | Source location / behavior |
|---|---|---|
| German Wiktionary only for new cards | Implemented | `service-worker.js`: `lookupBilingualWord`, `fetchGermanWiktionaryEntry`; only `de.wiktionary.org` remains in the manifest/CSP. `definition:v5:de-wiktionary:` prevents reuse of old mixed records. |
| Separate German senses/examples/provenance | Partial | `learning-features.js`: German parser; `content.js`: first sense and source examples. More senses/examples are collapsible. The HTML parser remains dependent on Wiktionary markup and needs fixtures/live validation. |
| Explicit German form/lemma follow-up only | Partial | `extractExplicitGermanLemma` extracts a bounded German form/reference link and the worker follows it once only if the clicked form lacks a definition. Exact markup coverage remains unverified. |
| No roles, usage notes, noun tables, English source | Superseded in part | Active card/list paths omit English entries, roles, collocations, related words, noun grammar, and English links. The later [`WORD_CARD_FOLLOWUP_PLAN.md`](WORD_CARD_FOLLOWUP_PLAN.md) adds source-explicit case/government beside verb forms; legacy English fields are not normalized into the active record. |
| Direct word heading + per-definition target translations | Implemented | `localizeSelectedWord` translates the clicked German word and each German definition separately through the existing translation route. |
| Source examples and highlight behavior | Partial | Only dictionary examples containing the selected exact German form render; video context remains separately saved. First example is compact; later examples collapse. Rendering still needs real German Wiktionary fixture coverage. |
| Exact distinct target candidate policy | Implemented | `distinctMatchingCandidates` counts normalized candidate identities that occur before range/overlap rendering. `content.js` highlights only when exactly one distinct candidate occurs; zero/multiple produce no target mark. |
| On-device Translator first, explicit fallback/provenance | Implemented | `translateText` uses policy-specific v2 cache keys and records `browser-on-device` versus `google-cloud-fallback`. A dedicated sanitized translation diagnostic preserves acquisition stage while exposing pair, checking/cache/download/fallback state and provider; `offscreen.js` forwards on-device download progress. Google fallback remains conditional on an existing configured key and browser-only prevents it. |
| Installed local German pronunciation | Implemented | Manifest `tts` permission; `PRONOUNCE_GERMAN_WORD` stops queued speech, selects a non-remote `de*` voice, and reports unavailable/error/end states. The card Speak action is distinct from replay. |
| Persist popup view/scroll/groups/search | Implemented | `popup.js` stores versioned `popupUiState:v1` separately from settings/secrets, with view scroll, details state, search and filter. It saves during interaction/scroll and restores only after library/settings refresh. |
| Current spoken-word highlight | Implemented | `content.js` validates every rendered word against timing text and interval, preserves exact vs estimated metadata, uses video time minus sync offset, changes classes only, and runs a playing animation-frame loop with pause/seek/rate handling. Mismatches intentionally get no arbitrary time highlight. |
| Diagnostics directly below Home video card | Implemented | `popup.html` puts the existing unique `diagnosticPanel` after the Home session card and before timing/vocabulary. Bindings/messages are retained. |
| Protected interactions | Partial, source-preserving | Selection/copy event defaults, delegated word activation, outside dismissal, dragging, saved words, YouGlish, replay restoration, cache and embedded-frame relay were preserved. Browser regression evidence is required. |

## Files changed for this candidate

- `extension/learning-features.js` — cache identity, German parser/provenance,
  active saved-record normalization, distinct-candidate helper.
- `extension/service-worker.js` — German-only lookup, explicit lemma policy,
  translation provenance/cache policy, local voice message handler.
- `extension/offscreen.js` — explicit Translator availability/download/ready
  status reporting.
- `extension/content.js` — German-only card rendering, speaker control,
  strict highlights, validated word timing and animation lifecycle.
- `extension/manifest.json` — `tts` permission and removal of English
  Wiktionary permission/CSP endpoint.
- `extension/popup.html`, `extension/popup.js` — diagnostics placement and
  durable view/scroll/group/search state; `openView` restores an anchor offset
  after library content is rendered.
- `extension/test-word-card-localization.mjs`,
  `extension/test-saved-word-overlay.mjs` — updated characterization intent for
  German-only legacy handling, candidate ambiguity, and validated timing data.
- `extension/test-learning-features.mjs`, `extension/test-batch-lifecycle.mjs`,
  `extension/test-popup-bindings.mjs` — intentional German-only normalization,
  raw legacy preservation, provider-v2 cache/fallback, verb-only card, and
  replacement binding expectations. None were executed.

The final fixture corrections explicitly normalize historical Google-first
preferences to browser-first policy, seed a raw legacy vocabulary record before
testing preservation, and distinguish complete validated word timings from an
incomplete/misaligned set.

## Tests authored/updated but not run

- German-only lexical/card characterization, including that legacy English data
  is not active card input and that overlapping candidates remain distinct.
- Overlay characterization now supplies text-bearing word timings, so a
  timestamp is accepted only after token mapping validation.

Additional source corrections after static review: `learning-features.js`
retains only verified German dictionary contracts and verb `Präsens`/
`Infinitiv` fields; `service-worker.js` preserves raw legacy vocabulary fields,
adds the title-backed verb infinitive and translation diagnostics; and
`content.js` renders separate language nodes for paired meanings, restarts the
word animation after replay, exposes measured-versus-estimated timing in the
overlay, and reports unconfirmed TTS completion honestly.

Future coverage still required: real German dictionary parser/form fixtures;
legacy saved-record enrichment; direct German input assertions for every card
translation; cache/provider policy transitions; Translator download/failure and
configured/unconfigured Google fallback; installed/missing/interrupted local
voice; UI anchor restoration after asynchronous library updates; current-word
seek, silence, rate and cached-replay lifecycle; and the full protected
selection/copy/drag/replay/embedded-player regression matrix.

## Known limitations and deferred validation

- Chrome Translator APIs and Chrome TTS behavior were not invoked. Availability,
  language-pack progress, fallback, local-voice selection, and cancellation are
  source paths only.
- The German Wiktionary HTML parser needs source fixtures for actual form-link
  shapes, verb sections, sense/example association, and malformed/missing data.
- Exact example text matching deliberately does not recognize different German
  inflections. Missing matching examples remain absent instead of fabricated.
- Timing highlights deliberately disappear whenever token/timing validation
  fails. Animation/selection behavior requires real player checks.
- Scroll restoration retains numeric per-view positions and stable saved-word/
  transcript anchors. Browser rendering behavior remains unverified.
- Existing working-tree UI/docs changes were preserved; this report does not
  assert ownership or behavioral validation of them.

## Deferred acceptance

Run the relevant automated and critical cross-feature suites only after the
user resumes testing, then perform Arabic and English card checks, an embedded
player, selection/copy, outside dismissal, dragging, replay restoration,
fullscreen, cached transcript replay, upgrade data, and diagnostics/fallback
observation. Record results under the roadmap/regression plan criteria before
any release checkpoint, commit/push claim, or version pass classification.

# Expanded grammar confirmation and native Chrome control

Thirty distinct newly scored German Wiktionary entries, ten per focused challenge,
plus ten supplementary base pages. Frozen `manifest.json` predates extraction.
Snapshots retain source URLs, revisions, retrieval dates and content hashes;
original attribution/licensing is at
[German Wiktionary](https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen).
No snapshots or Python evaluation dependencies are bundled in the extension.

The parser remains application commit f8e04a6. No source was tuned on these cases.
One overlap (`sehen`) consumes one former reserve; the remaining eleven are unread.

`manual-review.json` consolidates Luna's read-only source comparisons, reviewed
by parent. `automated-acceptance.json` retains all109 individually source-backed
obligations: 95 pass/14 fail. These obligation counts are not complete-entry
quality percentages. The focused complete-entry scores are 7/10 case rules,
7/10 explicit verb bases, 10/10 main conjugation tables. A complementary primary
infinitive check is 9/10; tun wrongly chooses tunen. No feature was excluded.

Run `node scripts/extract-expanded-grammar.mjs` then
`node scripts/test-expanded-grammar.mjs`. The acceptance command intentionally
exits1 until the recorded application failures are fixed. The old regression
suite is separate; a passing old suite does not override this acceptance failure.

`raw-chrome-initialization-*.json` records a direct native Translator.create
request added as a diagnostic button to Google's public translation demo, with
our extension uninstalled. MCP trusted click and user activation are true;
monitor reports0/1, but creation never resolves. The test aborts at180seconds.
AbortError is caused by that diagnostic deadline, not Chrome's underlying error.
The public demo separately reports no language-detection model available.
This isolates a failure outside extension code but not its exact browser-internal
cause. MCP blocks chrome: navigation; no attempt was made to bypass that block.

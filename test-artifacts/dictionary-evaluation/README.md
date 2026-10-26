# Frozen German dictionary evaluation evidence

Sixty distinct real entries, ten in each main challenge group. The manifest
freezes 36 development, 24 final and 12 additional unfetched/unread reserve
entries. Sources are German Wiktionary API parse snapshots; each file retains
source URL, retrieval date, revision, title and SHA-256. `base-versprechen.json`
is supplementary explicit base evidence, not a 61st scored entry.

Original dictionary content and citations retain their source attribution;
see [German Wiktionary licensing](https://de.wiktionary.org/wiki/Wiktionary:Lizenzbestimmungen).
These research snapshots are not bundled in the extension.

`extracted-*.json`: unlocalized output from the production deterministic parser.
`source-inventory-*.json`: independent BeautifulSoup inventory, an evaluation aid,
not an automatic truth standard. Includes empty placeholder records, which the
reviewer distinguishes from actual sentences.
`manual-review.json`: GPT-6 Luna's read-only comparisons consolidated by parent,
including corrections after parent checked the actual example attachments.
Scores use complete-entry checks per part, excluding N/A; unverified/ambiguous
checks never pass. Individual source-linked failures remain behind the table.

`reviewed-output-equivalence.json` proves the reviewed outputs remained identical
after a URL-safety helper change altered the overall helper file hash. No final
evaluation failure was used to tune the extractor, and reserves remain unread.

`chrome-*.json` and screenshots: disposable HeadlessChrome 149 extension checks.
Only artificial credential sentinels were used. No personal browser records,
audio capture, media playback, ASR or real Google Cloud requests were involved.

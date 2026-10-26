# Expanded grammar evidence and Translator initialization diagnosis

2026-10-26. WP1.3/WP0.3 follow-up to f8e04a6 / 0.11.1. Tests and evidence only;
no extraction/preparation behavior changes or feature exclusions authorized here.
Keep the first corpus immutable. The new list overlaps one old reserved entry,
`sehen`, which is now consumed as confirmation; the other eleven remain unread.

Add 30 new scored real entries: ten case-rule/qualification challenges, ten
explicit inflected verb-to-base references and ten verb-table challenges, with
extra linked base snapshots where needed. Freeze the list before inspection;
do not tune on these confirmation cases. Score the three parts independently,
including completeness and N/A. Parent owns code/docs; Luna may only source-review.

For Chrome, first distinguish the extension's 180-second deadline from a browser
failure. Compare production setup with a direct user-click Translator.create
probe on Chrome's public demo origin, with activation, monitor attachment,
progress and native errors recorded. No ASR, media capture or personal browser
data. Browser chrome: navigation is tool-blocked; do not bypass that restriction
to collect internal component or launch-command data. Exact launch flags and
background resource-download failure causes remain unknown unless supported
evidence establishes them. Existing simulated checks are not a real download pass.

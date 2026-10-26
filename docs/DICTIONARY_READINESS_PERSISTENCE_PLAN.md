# Bounded dictionary, readiness and persistence work

Date: 2026-10-26. WP1.3/WP2.4 (dictionary/cards), WP3.5 (safe history),
WP0.3 (evaluation). Dependencies: existing cue, vocabulary, direct translation,
provider-cache and transcript-reference contracts. No acquisition changes.

Baseline: branch codex/local-media-loopback, HEAD 0455ce3, uncommitted 0.11.0
candidate. Learning, localization, batch lifecycle and popup binding suites pass
before edits. Previous real-source acceptance: 23 pass, 12 fail, 1 inconclusive.
Existing user edits and artifacts remain in place.

Implementation by the parent only. GPT-6 Luna performs read-only manual source
comparisons; it must not edit files. German Wiktionary only, deterministic
section/reference parsing, no inference dependency. Preserve all features.

Evaluation: freeze six groups of ten real entries, six development and four
held-out entries per group; twelve additional reserve entries stay unseen.
Save source URLs, retrieved HTML, extracted results and evidence. Score seven
parts independently, including completeness: correct/applicable; wrong, missing,
ambiguous and unverified are distinct. No applicable unverified check passes.
Do not tune on final cases without disclosing contamination and using reserves.

Translation: popup readiness above Analyze; direct-click dedicated setup tab;
creation, not 100% progress, establishes ready. Recheck actual availability;
bounded translation waits, no successful error cache, preserve policy/provenance.

Persistence: shared allowlisted record boundary, canonical safe URLs, repeatable
in-place migration, no whole-record deletion, optional key mechanism preserved.

Evidence required: affected and critical automated regression, controlled layout
variants, Luna source comparisons, isolated Chrome setup/background-tab and
privacy/migration checks. No unrelated media, ASR or capture. Missing evidence
remains unverified. Implementation/evaluation delivered as a 0.11.1 candidate;
status **Needs development**, not a release pass. See
`test-results/0.11.1-dictionary-readiness-persistence.md` for per-part results and
real Chrome download timeouts. No final-set tuning or feature exclusions.

# Word-card grammar, metadata and pronunciation follow-up

Date: 2026-10-25. Baseline: `0455ce3`, branch
`codex/local-media-loopback`, with the existing uncommitted 0.11.0 candidate.
WPs: WP1.3/VOC-1 and WP2.4/WP2.5. Status: Experimental; validation paused.

## Authorized outcome

- Preserve German Wiktionary-only lookup and direct selected-language
  translations. Separate dictionary meanings from case/government annotations.
- Show supported case information (Akkusativ, Dativ, Genitiv, combinations)
  in a separate Grammar section, with a selected-language explanation. Keep
  verb infinitive and conjugations there. Do not infer grammar from translations
  or introduce unrelated usage notes or grammatical-role labels.
- Preserve dictionary sense references and group examples with meanings only
  when the source association is explicit. Keep unassigned examples separate.
  Use predictable counts for additional meanings/examples and a distinct
  control for an unusually long first example. Preserve highlighting rules.
- Retain original scene text, translation, video and clip as metadata, without
  printing them in the word card or normal saved-word content. Keep a discreet
  return-to-source action. Never use scene context as a definition fallback.
- Check Chrome TTS for local German voice availability before enabling Speak.
  Show availability, missing-voice guidance, Check again, speaking and failure
  feedback inside the card. No fabricated download progress: the current
  Windows/Chrome TTS route does not expose installation/download progress.
  Prevent stale-card responses and concurrent speech from corrupting UI state.

## Dependencies and boundaries

Use existing dictionary normalization/storage, card lifecycle, translation
policy, and message contracts. Existing records must stay readable; provenance
metadata must not be deleted. Preserve selection/copy, lookup/save, YouGlish,
video replay/restoration, dragging, outside dismissal, timing highlights,
popup continuity, cached transcripts and embedded players. Inspect registry,
historical `1546662`, current docs and the working tree before source edits.
Do not modify native host, archives, supplied designs or unrelated user changes.

## Evidence required later

Author characterization fixtures before the corresponding fixes, without
executing them. Cover case annotation extraction without deleting meaning,
sense association/unassigned examples, legacy normalization and metadata
retention without rendering, missing/ready/failing/local-only voices, stale
responses and interrupted/cancelled speech. After testing resumes, run relevant
and critical cross-feature suites plus Arabic/English cards, installed/missing
voice browser checks, saved-source return, selection/copy/replay and embedded
player checks. Until then no tests, syntax checks, builds, previews, real speech
or translation runs, commit/push, release or pass claim.

## Ownership

Parent writes this plan and statically reviews. User-requested GPT Terra
subagent writes source and a follow-up report recording files, source behavior,
unverified limitations and deferred checks. No OpenAI API integration/key.

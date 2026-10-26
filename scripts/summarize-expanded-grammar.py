"""Parent consolidation of read-only GPT-6 Luna comparisons, not auto truth scoring."""
import json
from pathlib import Path

folder = Path(__file__).resolve().parents[1] / 'test-artifacts/grammar-expanded'
extracted = json.loads((folder / 'extracted.json').read_text(encoding='utf-8'))
missing_cases = {'außerhalb', 'dank', 'entlang'}
missing_bases = {'geschrieben', 'gelesen', 'gewesen'}
evidence = {
    'statt': 'German preposition source sense preserves Genitiv/Dativ and pronoun qualification; statten is a separately scoped conjugated form.',
    'während': 'Source case alternatives and usage qualifications retained; grammar notes are source-explicit section-level notes.',
    'innerhalb': 'Both numbered preposition senses explicitly require Genitiv and both are linked.',
    'außerhalb': 'Both source senses explicitly require Genitiv; no structured government is emitted.',
    'gemäß': 'Dativ rule retained; source note on hypercorrect Genitiv retained section-level.',
    'entgegen': 'Preposition Dativ/less often Genitiv and postposition Dativ stay distinct; quoted ordinary Genitiv example is not a rule.',
    'dank': 'Source Dativ plus increasingly Genitiv remains inline but structured government is missing. Secondary base danken is retained.',
    'samt': 'Source Dativ rule preserved with its meaning reference.',
    'nebst': 'Source Dativ plus veraltend qualification preserved.',
    'entlang': 'Source preposed Genitiv/less often Dativ/obsolete Akkusativ and postposed Akkusativ/very rarely Dativ are not structured rules.',
    'geschrieben': 'German source explicitly identifies schreiben; output has neither lemma nor baseForms reference.',
    'gelesen': 'German source explicitly identifies lesen; output has neither lemma nor baseForms reference.',
    'gewesen': 'German source explicitly identifies sein; output has neither lemma nor baseForms reference.',
    'laufen': 'Main overview table and per-sense sein/haben variation retained.',
    'dürfen': 'Five finite rows and gedurft/haben match; source imperative dashes correctly produce no invented imperative.',
    'müssen': 'Five finite rows and gemusst/haben match; no invented imperative.',
    'wollen': 'Five finite rows and gewollt/haben match; no invented imperative.',
    'tun': 'Table forms/auxiliary match. Primary grammar.infinitive is wrongly tunen from a valid but secondary conjugated-form section; primary source is tun.',
}
rows = []
for item in extracted['results']:
    word = item['word']
    statuses = {'caseRules': 'not-applicable', 'explicitVerbBase': 'not-applicable',
                'conjugations': 'not-applicable', 'primaryInfinitive': 'not-applicable'}
    if item['group'] == 'case-rules':
        statuses['caseRules'] = 'missing' if word in missing_cases else 'correct'
    elif item['group'] == 'verb-base':
        statuses['explicitVerbBase'] = 'missing' if word in missing_bases else 'correct'
    else:
        statuses['conjugations'] = 'correct'
        statuses['primaryInfinitive'] = 'incorrect' if word == 'tun' else 'correct'
    rows.append({key: item[key] for key in ['word', 'group', 'file', 'sourceUrl', 'revision', 'sha256', 'baseEvidence']} | {
        'statuses': statuses, 'sourceEvidence': evidence.get(word,
            f"Complete main-source {item['group']} comparison passed; explicit base and/or all available table rows checked against frozen German source.")})
summary = {}
for part in ['caseRules', 'explicitVerbBase', 'conjugations', 'primaryInfinitive']:
    counts = {status: sum(row['statuses'][part] == status for row in rows) for status in ['correct', 'incorrect', 'missing', 'ambiguous', 'unverified', 'not-applicable']}
    applicable = 30 - counts['not-applicable']
    summary[part] = {**counts, 'applicable': applicable, 'successRate': counts['correct'] / applicable}
result = {'reviewer': 'gpt-6-luna, read-only built-in subagent', 'consolidatedBy': 'parent',
          'parserCommit': 'f8e04a6', 'parserHash': extracted['parserHash'],
          'scope': '30 new scored confirmation entries; 10 per primary challenge. No extraction tuning.',
          'completeness': 'Each correct judgment includes all applicable main-entry information, not a spot check. Linked full Flexion pages were not fetched.',
          'reserveConsumption': 'sehen overlaps one former reserve and is now consumed; eleven other reserves remain unread.',
          'supplementary': {'secondaryCaseEntryBases': {'correct': 2, 'words': {'statt': 'statten', 'dank': 'danken'}},
                            'primaryInfinitiveCorrection': 'Parent checked actual grammar.infinitive and corrected the evaluator initial tun pass to incorrect.'},
          'rows': rows, 'metrics': summary}
(folder / 'manual-review.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
for part, values in summary.items():
    print(part, f"{values['correct']}/{values['applicable']} = {values['successRate']:.0%}")

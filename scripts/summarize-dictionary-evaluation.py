"""Consolidate Luna's manual judgments; this is not an automatic truth oracle."""
import json
from pathlib import Path

folder = Path(__file__).resolve().parents[1] / 'test-artifacts/dictionary-evaluation'
parts = ['definitions', 'examples', 'exampleMeaning', 'grammarQualifications', 'baseForm', 'conjugations', 'displayCleanup']
case_entries = set('mit ohne helfen wegen auf trotz für bei durch gegen zwischen geholfen ab'.split())
verb_entries = set('helfen gehen versprochen sein haben nehmen aufstehen geben ging geholfen werden'.split())
base_entries = verb_entries | set('schön schnell trotz heute'.split())
failures = {
    'durch': {'definitions': 'incorrect', 'displayCleanup': 'incorrect'},
    'noch': {'definitions': 'missing', 'exampleMeaning': 'missing'},
    'gegen': {'grammarQualifications': 'missing'},
    'werden': {'conjugations': 'incorrect'},
    'wegen': {'grammarQualifications': 'ambiguous'},
}
evidence = {
    'durch': 'Source has seven real meanings. An editor note is an extra extracted meaning; two displayed definitions retain leading colons.',
    'noch': 'Source has 21 lettered child meanings absent from extraction. Sixteen explicitly referenced examples consequently have no resolved meaning or attachment.',
    'gegen': 'Source meanings 1–3 explicitly require Akkusativ. The wording remains inline but no structured government is emitted.',
    'werden': 'Finite rows match, but structured auxiliary/participial alternatives omit source sein, geworden/worden distinction.',
    'wegen': 'Complete usage text retained. Its attachment to meaning de-1:1 is ambiguous because the usage block itself has no explicit meaning number.',
}
rows = []
for split in ['development', 'final']:
    document = json.loads((folder / f'extracted-{split}.json').read_text(encoding='utf-8'))
    for item in document['results']:
        word, result = item['word'], item['result']
        statuses = {part: 'correct' for part in parts}
        if word not in case_entries:
            statuses['grammarQualifications'] = 'not-applicable'
        if word not in base_entries:
            statuses['baseForm'] = 'not-applicable'
        if word not in verb_entries:
            statuses['conjugations'] = 'not-applicable'
        statuses.update(failures.get(word, {}))
        rows.append({
            'word': word, 'split': split, 'group': item['group'], 'sourceUrl': item['sourceUrl'],
            'sourceFile': item['file'], 'revision': item['revision'], 'sourceSha256': item['sha256'],
            'baseEvidence': item.get('baseEvidence'), 'statuses': statuses,
            'sourceEvidence': evidence.get(word, f"All nonempty meanings/examples compared with the frozen German sections: {len(result['senses'])} extracted meanings, {len(result['examples'])} examples. Source number references, actual joins and sense attachments checked."),
            'sourceSenseReferences': [{'id': sense['id'], 'sourceReference': sense['sourceSenseId']} for sense in result['senses']],
            'outputCounts': {'definitions': len(result['senses']), 'examples': len(result['examples']),
                             'caseRules': len(result['grammar']['governments']), 'conjugations': len(result['grammar']['conjugations'])}
        })
assert len(rows) == 60 and len({row['word'] for row in rows}) == 60
metrics = {}
for part in parts:
    metrics[part] = {}
    for split in ['development', 'final', 'combined']:
        counts = {status: 0 for status in ['correct', 'incorrect', 'missing', 'ambiguous', 'unverified', 'not-applicable']}
        for row in rows:
            if split == 'combined' or row['split'] == split:
                counts[row['statuses'][part]] += 1
        applicable = sum(count for status, count in counts.items() if status != 'not-applicable')
        rate = counts['correct'] / applicable if applicable else None
        metrics[part][split] = {**counts, 'applicable': applicable, 'successRate': rate,
                                'moreThan95Percent': rate is not None and rate > .95}
review = {'reviewer': 'gpt-6-luna (built-in subagent, read-only)', 'consolidatedBy': 'parent agent',
          'method': 'Complete entry-level judgment for each part: correctness AND completeness required. Synthetic layout variants excluded from these scores. Extractions never translated during source scoring.',
          'splitPolicy': '36 development / 24 held-out final / 12 unfetched reserves. No final-result-driven extraction changes.',
          'caveats': ['Finite sample; percentages are not guarantees.', 'ging/geholfen use base pages gehen/helfen also in development, so their evidence is correlated.',
                      'Empty example placeholders on Katze and Band are not sentences and not counted as missing.',
                      'Noun declensions are outside requested verb-base scope.',
                      'Early evaluator counting errors were corrected using all nested lists, h4 boundaries and actual resolved attachments, rather than substring matches.'],
          'explicitExampleReferenceAudit': {'developmentApplicable': 550, 'developmentCorrect': 550,
                                          'finalApplicable': 316, 'finalCorrect': 300, 'finalMissing': 16,
                                          'unnumberedSectionExamplesNA': 11},
          'rows': rows, 'metrics': metrics}
(folder / 'manual-review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding='utf-8')
for part in parts:
    values = metrics[part]['combined']
    print(part, f"{values['correct']}/{values['applicable']} = {values['successRate']:.2%}",
          'incorrect', values['incorrect'], 'missing', values['missing'], 'ambiguous', values['ambiguous'])

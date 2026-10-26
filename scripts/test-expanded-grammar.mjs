// Acceptance obligations derived from the new frozen German sources and reviewed
// independently. Deliberately reports all failures; never bless current output.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'test-artifacts/grammar-expanded');
const data = JSON.parse(fs.readFileSync(path.join(dir, 'extracted.json')));
const context = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync(path.join(root, 'extension/learning-features.js'), 'utf8'), context);
const parser = context.DubTranscriptLearning;
const checks = [];
const record = (row, part, obligation, pass, expected, actual) => checks.push({ word: row.word, part, obligation,
  pass: Boolean(pass), expected, actual, sourceUrl: row.sourceUrl, revision: row.revision });
const caseRules = {
  statt: ['Genitiv', 'Dativ', 'Pronomen'], während: ['Genitiv', 'Dativ'], innerhalb: ['Genitiv'],
  außerhalb: ['Genitiv'], gemäß: ['Dativ', 'Genitiv'], entgegen: ['Dativ', 'Genitiv'],
  dank: ['Dativ', 'Genitiv', 'zunehmend'], samt: ['Dativ'], nebst: ['Dativ', 'veraltend'],
  entlang: ['Genitiv', 'Dativ', 'Akkusativ', 'vorangestellt', 'nachgestellt']
};
const paradigms = {
  machen: ['mache', 'machst', 'macht', 'machte', 'gemacht'], sagen: ['sage', 'sagst', 'sagt', 'sagte', 'gesagt'],
  sehen: ['sehe', 'siehst', 'sieht', 'sah', 'gesehen'], sprechen: ['spreche', 'sprichst', 'spricht', 'sprach', 'gesprochen'],
  schlafen: ['schlafe', 'schläfst', 'schläft', 'schlief', 'geschlafen'], laufen: ['laufe', 'läufst', 'läuft', 'lief', 'gelaufen'],
  dürfen: ['darf', 'darfst', 'darf', 'durfte', 'gedurft'], müssen: ['muss', 'musst', 'muss', 'musste', 'gemusst'],
  wollen: ['will', 'willst', 'will', 'wollte', 'gewollt'], tun: ['tue', 'tust', 'tut', 'tat', 'getan']
};
const plain = value => String(value || '').replace(/[·\s]/g, '');
for (const row of data.results) {
  // Fresh production parse prevents stale extract artifacts from hiding a change.
  const source = JSON.parse(fs.readFileSync(path.join(dir, row.file)));
  const direct = parser.extractGermanWiktionaryEntry(source.html);
  if (JSON.stringify(direct) !== JSON.stringify(row.direct)) throw new Error(`Stale extraction for ${row.word}`);
  if (row.group === 'case-rules') {
    const rules = row.result.grammar.governments;
    const text = rules.map(rule => rule.text).join(' ');
    for (const term of caseRules[row.word]) record(row, 'case-rules', `structured rule preserves ${term}`, text.includes(term), term, text);
    if (row.word === 'innerhalb' || row.word === 'außerhalb') record(row, 'case-rules', 'both numbered senses have explicit rules', rules.filter(rule => rule.senseId).length >= 2, 'at least 2', rules.length);
    if (row.word === 'entgegen') record(row, 'case-rules', 'preposition/postposition sections stay distinct', new Set(rules.map(rule => rule.sectionId)).size >= 2, 'two sections', rules.map(rule => rule.sectionId));
  } else if (row.group === 'verb-base') {
    const actual = [row.direct.lemma, ...row.direct.grammar.baseForms.map(form => form.infinitive)].filter(Boolean);
    record(row, 'verb-base', 'explicit inflected-form base is retained', actual.includes(row.expectedBase), row.expectedBase, actual);
  } else {
    const grammar = row.result.grammar;
    record(row, 'verb-base-primary', 'secondary form does not overwrite primary infinitive', grammar.infinitive === row.word, row.word, grammar.infinitive);
    const expected = paradigms[row.word];
    for (const [index, person] of ['ich', 'du', 'er, sie, es'].entries()) record(row, 'conjugations', `Präsens Indikativ ${person}`,
      grammar.conjugations.some(form => form.tense === 'Präsens' && form.mood === 'Indikativ' && form.person === person && form.form === expected[index]), expected[index], grammar.conjugations.filter(form => form.person === person && form.tense === 'Präsens').map(form => form.form));
    record(row, 'conjugations', 'Präteritum ich', grammar.conjugations.some(form => form.tense === 'Präteritum' && form.person === 'ich' && form.form === expected[3]), expected[3], grammar.preterite);
    record(row, 'conjugations', 'Partizip II', plain(grammar.participle) === expected[4], expected[4], grammar.participle);
    const auxiliaries = [grammar.auxiliary, ...grammar.auxiliaries.map(item => item.auxiliary)];
    for (const auxiliary of row.word === 'laufen' ? ['sein', 'haben'] : ['haben']) record(row, 'conjugations', `source auxiliary ${auxiliary}`, auxiliaries.includes(auxiliary), auxiliary, auxiliaries);
    if (['dürfen', 'müssen', 'wollen'].includes(row.word)) record(row, 'conjugations', 'no invented imperative for source em-dashes', !grammar.conjugations.some(form => form.mood === 'Imperativ'), 'no imperative rows', grammar.conjugations.filter(form => form.mood === 'Imperativ'));
  }
}
const failures = checks.filter(check => !check.pass);
fs.writeFileSync(path.join(dir, 'automated-acceptance.json'), JSON.stringify({ parserHash: data.parserHash,
  checks: checks.length, passed: checks.length - failures.length, failed: failures.length, results: checks }, null, 2));
for (const check of failures) console.log(`FAIL ${check.word}: ${check.obligation}`);
console.log(`${checks.length - failures.length}/${checks.length} source-backed obligations passed; ${failures.length} failed.`);
process.exitCode = failures.length ? 1 : 0;

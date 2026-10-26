import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({ URL, console });
vm.runInContext(fs.readFileSync(new URL('./learning-features.js', import.meta.url), 'utf8'), context);
const learning = context.DubTranscriptLearning;
const parse = html => learning.extractGermanWiktionaryEntry(html);
const fixture = `<h2>mit (Deutsch)</h2><h3>Präposition</h3>
<div><p>Bedeutungen:</p><dl><dd>[1] mit Dativ: in Begleitung</dd></dl></div>
<p>Beispiele:</p><dl><dd>[1] Mit Freunden.</dd><dd>Mit niemandem.</dd></dl>
<h3>Adverb</h3><p>Bedeutungen:</p><ol><li>[1] ebenfalls</li></ol>
<p>Beispiele:</p><dl><dd>[1] Ich komme mit.</dd></dl>
<h2>Englisch</h2><h3>Noun</h3><p>Bedeutungen:</p><dl><dd>[1] forbidden</dd></dl>`;
for (const variant of [fixture, fixture.replaceAll('<dl>', '<dl class="variation">').replaceAll('<dd>', '<dd data-case="nested">'), fixture.replaceAll('<p>', '<p><span>').replaceAll('</p>', '</span></p>')]) {
  const result = parse(variant);
  assert.equal(result.senses.length, 2);
  assert.notEqual(result.senses[0].id, result.senses[1].id);
  assert.equal(result.senses[0].examples[0].german, 'Mit Freunden.');
  assert.equal(result.senses[1].examples[0].german, 'Ich komme mit.');
  assert.equal(result.examples.filter(example => example.unassigned).length, 1);
  assert.doesNotMatch(result.germanDefinition, /forbidden/);
}
const multiple = parse('<h2>Deutsch</h2><h3>Verb</h3><p>Bedeutungen:</p><dl><dd>[1] eins</dd><dd>[2] zwei</dd></dl><p>Beispiele:</p><dl><dd>[1][2] Beide.</dd></dl>');
assert.equal(multiple.senses[0].examples.length, 1);
assert.equal(multiple.senses[1].examples.length, 1);
assert.equal(multiple.examples[0].senseIds.length, 2);
assert.equal(multiple.examples[0].senseId, null);
assert.equal(parse('<h2>Englisch</h2><p>Bedeutungen:</p><dl><dd>[1] none</dd></dl>').senses.length, 0);
assert.equal(learning.normalizeExampleQuotation('„Schon zitiert.“'), '„Schon zitiert.“');
assert.equal(learning.normalizeExampleQuotation('„„Doppelt.““'), '„Doppelt.“');
assert.equal(learning.normalizeExampleQuotation('Noch nicht.'), '„Noch nicht.“');
const qualified = learning.extractCaseGovernment('(mit Dativ, seltener mit Akkusativ) jemandem helfen');
assert.equal(qualified.government, 'mit Dativ, seltener mit Akkusativ');
assert.equal(qualified.definition, 'jemandem helfen');
assert.equal(learning.extractCaseGovernment('Eine Erklärung des Dativ und Genitiv.').government, null);
const source = name => JSON.parse(fs.readFileSync(new URL(`../test-artifacts/dictionary-evaluation/${name}`, import.meta.url))).html;
const gehen = parse(source('verbs-01.json'));
assert.ok(gehen.senses.length > 10, 'nested real meanings must not disappear');
assert.ok(gehen.grammar.conjugations.some(form => form.tense === 'Präsens' && form.person === 'ich' && form.form === 'gehe'));
const helfen = parse(source('cases-02.json'));
assert.match(helfen.grammar.governments[0].text, /Dativ, seltener mit Akkusativ/);
assert.ok(helfen.grammar.conjugations.some(form => form.mood === 'Konjunktiv II' && form.form === 'hülfe'));
assert.ok(!helfen.grammar.conjugations.some(form => form.mood === 'Indikativ' && /hülfe/.test(form.form)));
assert.equal(parse(source('straightforward-02.json')).lemma, null, 'noun must not adopt a later inflected-verb lemma');
assert.doesNotMatch(parse(source('missing-and-misleading-01.json')).germanDefinition, /überarbeitet|Kommentar/);
const aufstehen = parse(source('verbs-06.json'));
assert.ok(aufstehen.grammar.auxiliaries.some(item => item.auxiliary === 'haben' && item.senseId.endsWith(':4')));
console.log('Dictionary boundaries, source rules, real layouts and quotations passed');

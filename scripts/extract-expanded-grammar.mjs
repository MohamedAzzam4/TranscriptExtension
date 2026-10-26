import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'test-artifacts/grammar-expanded');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
const group = process.argv[2];
if (group && !['case-rules', 'verb-base', 'conjugations'].includes(group)) throw new Error('Unknown group');
const sources = fs.readdirSync(dir).filter(name => /^(case-rules|verb-base|conjugations|base)-\d+\.json$/.test(name))
  .map(file => ({ ...JSON.parse(fs.readFileSync(path.join(dir, file))), file }));
const code = fs.readFileSync(path.join(root, 'extension/learning-features.js'), 'utf8');
const context = vm.createContext({ URL, console });
vm.runInContext(code, context);
const learning = context.DubTranscriptLearning;
const results = [];
for (const item of manifest.filter(item => !group || item.group === group)) {
  const source = sources.find(row => row.file === item.file);
  if (!source?.html) throw new Error(`Missing source: ${item.word}`);
  const direct = learning.extractGermanWiktionaryEntry(source.html);
  const explicitBase = direct.lemma || direct.grammar?.baseForms?.[0]?.infinitive;
  let result = structuredClone(direct);
  let baseEvidence = null;
  // Match production's one-hop policy, never force a base from the expected label.
  if (!direct.senses.length && explicitBase) {
    const base = sources.find(row => row.title === explicitBase);
    if (!base?.html) throw new Error(`Missing explicit base source for ${item.word}: ${explicitBase}`);
    result = { ...learning.extractGermanWiktionaryEntry(base.html), lemma: explicitBase, definitionLemma: explicitBase };
    baseEvidence = { file: base.file, sourceUrl: base.sourceUrl, revision: base.revision };
  }
  if (result.isVerb) result.grammar.infinitive ||= explicitBase || source.title;
  results.push({ ...item, revision: source.revision, sha256: source.sha256, direct, baseEvidence, result });
  console.log(`${item.word}: ${result.grammar.governments.length} rules; base=${explicitBase || result.grammar.infinitive || '-'}; forms=${result.grammar.conjugations.length}`);
}
fs.writeFileSync(path.join(dir, group ? `extracted-${group}.json` : 'extracted.json'), JSON.stringify({ parserHash: crypto.createHash('sha256').update(code).digest('hex'), results }, null, 2));

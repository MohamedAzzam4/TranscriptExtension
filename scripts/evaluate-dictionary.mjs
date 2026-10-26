import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'test-artifacts/dictionary-evaluation');
const split = process.argv[2] || 'development';
if (!['development', 'final'].includes(split)) throw new Error('Unknown split');
const context = vm.createContext({ URL, console });
vm.runInContext(fs.readFileSync(path.join(root, 'extension/learning-features.js'), 'utf8'), context);
const learning = context.DubTranscriptLearning;
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
const results = [];
for (const item of manifest.filter(item => item.split === split)) {
  const file = path.join(dir, item.file);
  if (!fs.existsSync(file)) throw new Error(`Missing frozen source ${item.word}`);
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = learning.extractGermanWiktionaryEntry(source.html);
  // Same single explicit base-reference policy as the live worker. Fetches are
  // frozen corpus reads; evaluation never uses a translation provider.
  let baseEvidence = null;
  if (!result.senses.length && result.lemma) {
    const base = manifest.find(row => row.word === result.lemma)
      || (result.lemma === 'versprechen' ? { file: 'base-versprechen.json', sourceUrl: 'https://de.wiktionary.org/wiki/versprechen' } : null);
    if (base && fs.existsSync(path.join(dir, base.file))) {
      const baseSource = JSON.parse(fs.readFileSync(path.join(dir, base.file)));
      baseEvidence = { file: base.file, sourceUrl: base.sourceUrl };
      const parsedBase = learning.extractGermanWiktionaryEntry(baseSource.html);
      Object.assign(result, { ...parsedBase, lemma: result.lemma, definitionLemma: result.lemma });
    }
  }
  if (result.isVerb) result.grammar.infinitive ||= result.lemma || source.title;
  results.push({ ...item, revision: source.revision, sha256: source.sha256, baseEvidence, result });
  console.log(`${item.word}: ${result.senses.length} meanings, ${result.examples.length} examples, ${result.grammar.governments.length} rules, ${result.grammar.conjugations.length} forms`);
}
const parserHash = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(path.join(root, 'extension/learning-features.js'))).digest('hex');
fs.writeFileSync(path.join(dir, `extracted-${split}.json`), JSON.stringify({ split, parserHash, results }, null, 2));

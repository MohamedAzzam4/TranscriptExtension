import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Protect dictionary provenance and lexical highlights without a live provider.
const context = vm.createContext({ console, URL });
vm.runInContext(fs.readFileSync(new URL("./learning-features.js", import.meta.url), "utf8"), context);
const learning = context.DubTranscriptLearning;
assert.deepEqual(Array.from(learning.germanWordDefinitions({ germanDefinitions: ["Für diese Bedeutung fehlt noch eine Definition.", "Eine Zusage geben."] })), ["Eine Zusage geben."]);
assert.deepEqual({ ...learning.extractCaseGovernment("mit Dativ, jemandem helfen"), cases: Array.from(learning.extractCaseGovernment("mit Dativ, jemandem helfen").cases) }, { definition: "jemandem helfen", cases: ["Dativ"], government: "mit Dativ" }, "lift only a leading structural case annotation");
assert.deepEqual({ ...learning.extractCaseGovernment("die Verbindung mit Dativ erklären"), cases: Array.from(learning.extractCaseGovernment("die Verbindung mit Dativ erklären").cases) }, { definition: "die Verbindung mit Dativ erklären", cases: [], government: null }, "do not delete case words from ordinary definition prose");
const formFixture = '<h2>Deutsch</h2><p>konjugierte Form von <a href="/wiki/versprechen">versprechen</a></p><p>Grundform siehe <a href="/wiki/Hilfe:Wortart">Hilfe</a></p>';
assert.equal(learning.extractGermanWiktionaryEntry(formFixture).lemma, "versprechen", "only the explicit form relation may select a lemma");

const highlights = (text, phrases, language) => Array.from(learning.highlightedTextParts(text, phrases, language))
  .filter((part) => part.highlighted).map((part) => part.text);
assert.deepEqual(highlights("Er hat es versprochen.", ["versprochen"], "de"), ["versprochen"]);
assert.deepEqual(highlights("finden in finden", ["in"], "de"), ["in"]);
assert.deepEqual(highlights("لقد وعدني بذلك.", ["وعد"], "ar"), ["وعدني"]);
assert.deepEqual(highlights("لدي موعد غداً.", ["وعد"], "ar"), []);
assert.deepEqual(highlights("She gave her word.", ["promised"], "en"), [], "do not guess a paraphrase's alignment");
assert.deepEqual(highlights("a secret, a secret", ["secret", "a secret"], "en"), ["a secret", "a secret"]);

assert.deepEqual(Array.from(learning.distinctMatchingCandidates("a secret, a secret", ["secret", "a secret"], "en")), ["secret", "a secret"], "count candidates before resolving overlap");
assert.deepEqual(Array.from(learning.distinctMatchingCandidates("No matching text.", ["secret"], "en")), []);
assert.deepEqual(Array.from(learning.distinctMatchingCandidates("A secret and a secret.", ["secret", "secret"], "en")), ["secret"], "duplicate candidates count once and all occurrences may mark");
assert.deepEqual(Array.from(learning.distinctMatchingCandidates("A secret promise.", ["secret", "promise"], "en")), ["secret", "promise"], "two candidates suppress target highlighting for that example");
const legacy = learning.normalizeVocabularyEntry({ word: "versprochen", englishDefinition: "past participle of versprechen", context: "Er hat es versprochen." });
assert.equal(legacy.word, "versprochen");
assert.equal(legacy.context, "Er hat es versprochen.");
assert.equal(legacy.englishDefinition, undefined, "legacy English data is not active card input");

const content = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./popup.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./popup.css", import.meta.url), "utf8");
assert.match(content, /translationPreferences: preferences/);
assert.match(content, /wordTranslatedDefinitionElement\.lang = language/);
assert.match(content, /translated\.dir = "auto"/);
assert.match(content, /owner\.wordCardRevision === revision/);
assert.match(content, /owner\.wordCardEpoch === cardEpoch/);
assert.match(content, /getPronunciationController\(\)\.availability\(\)/);
assert.match(content, /Show full example/);
assert.match(content, /Other meanings \(\$\{Math\.max/);
assert.match(content, /scrollbar-color: #46644e #111a14/);
assert.match(content, /document\.addEventListener\("pointerdown", dismissWordCardOutside, true\)/);
assert.match(content, /event\.composedPath\(\)/);
assert.match(html, /class="panel appearance-section"[^>]* open><summary>Transcript/);
assert.match(html, /class="panel appearance-section translation-section"[^>]*><summary>Translation/);
assert.match(html, /class="panel appearance-section"[^>]*><summary>Caption box/);
assert.match(css, /\.caption-preview \{ position: sticky; top: 0;/);
console.log("Word-card localization and appearance contracts passed");

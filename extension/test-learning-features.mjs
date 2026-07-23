import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console, URL });
const source = fs.readFileSync(new URL("./learning-features.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "learning-features.js" });
const helpers = context.DubTranscriptLearning;

assert.deepEqual(
  { ...helpers.normalizeCaptionPreferences({
    fontSize: 99,
    horizontalPosition: 120,
    verticalPosition: -2,
    backgroundOpacity: 42,
    textOpacity: 85,
    textColor: "#ffcc00",
    backgroundColor: "bad",
    fontFamily: "serif",
    edgeStyle: "outline",
    bold: false
  }) },
  {
    fontSize: 52,
    horizontalPosition: 98,
    verticalPosition: 3,
    backgroundOpacity: 42,
    textOpacity: 85,
    textColor: "#FFCC00",
    backgroundColor: "#05070C",
    fontFamily: "serif",
    edgeStyle: "outline",
    bold: false
  }
);
assert.deepEqual(
  { ...helpers.normalizeTranslationPreferences({
    enabled: false,
    targetLanguage: "EN-us!",
    provider: "GOOGLE",
    fontSize: 99,
    textOpacity: 81,
    textColor: "#22cc88",
    fontFamily: "mono",
    bold: true
  }) },
  {
    enabled: false,
    targetLanguage: "en-us",
    provider: "google",
    fontSize: 42,
    textOpacity: 81,
    textColor: "#22CC88",
    fontFamily: "mono",
    bold: true
  }
);
assert.notEqual(
  helpers.DEFAULT_CAPTION_PREFERENCES.textColor,
  helpers.DEFAULT_TRANSLATION_PREFERENCES.textColor,
  "the transcript and translation should have visibly different default colors"
);
assert.equal(helpers.rgbaFromHex("#05070C", 86), "rgba(5, 7, 12, 0.86)");
assert.equal(helpers.sanitizeWord("  Häuser?! "), "Häuser");
assert.equal(
  helpers.translationCacheKey("Hallo   Welt", "de", "en"),
  helpers.translationCacheKey("Hallo Welt", "de", "en")
);

const dictionary = helpers.extractEnglishWiktionaryEntry({
  de: [{
    language: "German",
    definitions: [{
      definition: "<a>house</a>",
      parsedExamples: [{
        example: "In dem <b>Haus</b> wohnen wir.",
        translation: "We live in the <b>house</b>."
      }]
    }, { definition: "<a>home</a> &amp; residence" }]
  }]
});
assert.equal(dictionary.englishDefinition, "house; home & residence");
assert.deepEqual([...dictionary.englishDefinitions], ["house", "home & residence"]);
assert.equal(dictionary.example, "In dem Haus wohnen wir.");
assert.equal(dictionary.exampleTranslation, "We live in the house.");
assert.equal(dictionary.examples.length, 1);

const germanDictionary = helpers.extractGermanWiktionaryEntry(`
  <h2>Haus (Deutsch)</h2>
  <h3>Substantiv, n</h3>
  <table><tr><th>Nominativ</th><td>das Haus</td><td>die Häuser</td></tr></table>
  <p>Bedeutungen:</p><dl><dd>[1] Gebäude, in dem Menschen wohnen</dd></dl>
  <p>Beispiele:</p><dl><dd>Wir gehen nach Hause.</dd></dl>
  <p>Charakteristische Wortkombinationen:</p><dl><dd>ein Haus bauen</dd></dl>
  <p>Synonyme:</p><dl><dd>[1] Gebäude, Heim</dd></dl>
  <p>Worttrennung:</p><dl><dd>Haus, Plural: Häu·ser</dd></dl>
  <p>IPA: [<span class="ipa">haʊ̯s</span>]</p>
`);
assert.equal(germanDictionary.wordType, "Substantiv, n");
assert.deepEqual([...germanDictionary.germanDefinitions], ["Gebäude, in dem Menschen wohnen"]);
assert.equal(germanDictionary.grammar.article, "das");
assert.equal(germanDictionary.grammar.singular, "das Haus");
assert.equal(germanDictionary.grammar.plural, "die Häuser");
assert.deepEqual([...germanDictionary.collocations], ["ein Haus bauen"]);
assert.deepEqual([...germanDictionary.synonyms], ["Gebäude", "Heim"]);
assert.equal(germanDictionary.pronunciation, "haʊ̯s");

const verbDictionary = helpers.extractGermanWiktionaryEntry(`
  <h2>herausfinden (Deutsch)</h2><h3>Verb</h3>
  <p>Worttrennung:</p><dl><dd>he·r·aus·fin·den, Präteritum: fand he·r·aus, Partizip II: he·r·aus·ge·fun·den</dd></dl>
  <table><tr><th>Hilfsverb</th><td><a>haben</a></td></tr></table>
`);
assert.equal(verbDictionary.grammar.preterite, "fand he·r·aus");
assert.equal(verbDictionary.grammar.perfect, "hat he·r·aus·ge·fun·den");
assert.equal(verbDictionary.grammar.separable, true);

const entry = helpers.normalizeVocabularyEntry({
  word: "Haus!",
  englishDefinition: "house",
  germanSourceUrl: "https://de.wiktionary.org/wiki/Haus",
  englishSourceUrl: "https://evil.example/Haus",
  context: "Das ist ein Haus."
});
assert.equal(entry.word, "Haus");
assert.equal(entry.normalizedWord, "haus");
assert.equal(entry.germanSourceUrl, "https://de.wiktionary.org/wiki/Haus");
assert.equal(entry.englishSourceUrl, null);

assert.equal(
  helpers.stableVideoIdentity("https://www.youtube.com/watch?v=abc123&list=ignored", "DE"),
  "youtube:abc123|audio:de"
);
assert.equal(
  helpers.stableVideoIdentity("https://aniworld.to/anime/stream/show/episode-1?server=2", "de"),
  "aniworld.to:/anime/stream/show/episode-1|audio:de"
);
assert.equal(
  helpers.stablePageUrl("https://www.youtube.com/watch?v=abc123&list=ignored"),
  "https://www.youtube.com/watch?v=abc123"
);
const transcriptText = helpers.transcriptToText({
  title: "Test video",
  audioLanguage: "de",
  url: "https://www.youtube.com/watch?v=abc123&list=ignored",
  segments: [
    { start: 65, text: "Hallo Welt." },
    { start: 67, text: "Wie geht es dir?" }
  ]
});
assert.match(transcriptText, /\[01:05\] Hallo Welt\./);
assert.match(transcriptText, /Source: https:\/\/www\.youtube\.com\/watch\?v=abc123/);

console.log("Learning feature tests passed");

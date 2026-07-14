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
    verticalPosition: -2,
    backgroundOpacity: 42,
    textOpacity: 85,
    textColor: "#ffcc00",
    backgroundColor: "bad",
    fontFamily: "serif",
    edgeStyle: "outline"
  }) },
  {
    fontSize: 52,
    verticalPosition: 3,
    backgroundOpacity: 42,
    textOpacity: 85,
    textColor: "#FFCC00",
    backgroundColor: "#05070C",
    fontFamily: "serif",
    edgeStyle: "outline"
  }
);
assert.deepEqual(
  { ...helpers.normalizeTranslationPreferences({
    enabled: false,
    targetLanguage: "EN-us!",
    provider: "GOOGLE"
  }) },
  { enabled: false, targetLanguage: "en-us", provider: "google" }
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
assert.equal(dictionary.example, "In dem Haus wohnen wir.");
assert.equal(dictionary.exampleTranslation, "We live in the house.");

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

console.log("Learning feature tests passed");


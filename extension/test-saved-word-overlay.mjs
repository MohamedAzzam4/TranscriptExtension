import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the real caption renderer without a browser or dictionary service.
class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.classList = {
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      }
    };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(child) { this.children.push(child); }
  replaceChildren(fragment) { this.children = fragment.children; }
  querySelectorAll() { return this.children.filter((child) => child.dataset?.word); }
}
const transcript = new Element();
const storageListeners = [];
const requests = [];
let response = { ok: true, entries: [] };
const context = vm.createContext({
  console, URL,
  document: {
    addEventListener() {},
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: text }),
    createDocumentFragment: () => new Element()
  },
  chrome: {
    runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) { requests.push(message); return response; }
    },
    storage: { onChanged: { addListener: (fn) => storageListeners.push(fn) } }
  },
  DubTranscriptGroups: {}, DubTranscriptMediaCandidate: {}, DubTranscriptLocalMedia: {}
});
vm.runInContext(fs.readFileSync(new URL("./learning-features.js", import.meta.url), "utf8"), context);
vm.runInContext(fs.readFileSync(new URL("./german-pronunciation.js", import.meta.url), "utf8"), context);
const source = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
  globalThis.overlayTest = {
    renderClickableText,
    configure(transcript) { session = { displayedTimingKey: null }; transcriptElement = transcript; captionBoxElement = {}; },
    setHoverController(controller) { hoverPause = controller; },
    ...(typeof refreshSavedWordMarks === "function" ? { refreshSavedWordMarks, loadSavedVocabulary } : {})
  };
})();`), context);
const api = context.overlayTest;
api.configure(transcript);
api.renderClickableText("Ein Haus, ein Haus!", [
  { text: "Ein", start: 1, end: 1.2, timing: "word-timestamps" },
  { text: "Haus", start: 1.2, end: 1.5, timing: "word-timestamps" },
  { text: "ein", start: 1.5, end: 1.7, timing: "word-timestamps" },
  { text: "Haus", start: 1.7, end: 2, timing: "word-timestamps" }
]);
const words = transcript.querySelectorAll();
assert.deepEqual(words.map((word) => word.dataset.word), ["Ein", "Haus", "ein", "Haus"]);
assert.equal(transcript.children.map((child) => child.textContent).join(""), "Ein Haus, ein Haus!");
assert.equal(words[0].attributes.role, "button");
assert.equal(words[0].tabIndex, 0);
assert.equal(words[0].dataset.start, "1");
assert.equal(words[0].dataset.timing, "word-timestamps");
api.renderClickableText("Ein Haus, ein Haus!", [{ text: "wrong", start: 1, end: 2 }]);
assert.equal(transcript.querySelectorAll()[0], words[0], "the clock must preserve caption nodes and native selection");
assert.equal(words[0].dataset.start, undefined, "incomplete or misaligned timing must not mark an arbitrary word");

console.log("Saved-word overlay characterization passed");

const changed = (entries, area = "local") => storageListeners.forEach((fn) => fn({ savedVocabulary: { newValue: entries } }, area));
const marked = () => transcript.querySelectorAll().filter((word) => word.className.split(" ").includes("saved-word"));
changed([{ word: "HAUS", context: "Original show." }]);
assert.equal(marked().length, 2, "every matching token is marked");
assert.equal(marked()[0], words[1], "vocabulary updates preserve native selection and existing nodes");
assert.match(marked()[0].attributes["aria-label"], /saved word/);
changed([], "session");
assert.equal(marked().length, 2, "unrelated storage areas cannot clear the marks");
changed([]);
assert.equal(marked().length, 0);
assert.doesNotMatch(words[1].attributes["aria-label"], /saved word/);
api.renderClickableText("Häuser HA\u0308USER Haus finden in in.");
changed([{ word: "HÄUSER" }, { word: "in" }, null, { word: "" }, { word: "in" }]);
assert.deepEqual(marked().map((word) => word.dataset.word), ["Häuser", "HA\u0308USER", "in", "in"]);
assert.ok(!marked().some((word) => ["Haus", "finden"].includes(word.dataset.word)), "no substring or inferred inflection matching");
assert.equal(requests.length, 0, "marking must not make a dictionary/translation request");

response = { ok: true, entries: [{ word: "Haus", video: { key: "old:show", title: "Previous show" }, context: "Original context" }] };
await api.loadSavedVocabulary();
assert.equal(marked().length, 1, "opening another session loads the saved forms");
let resolveLoad;
response = new Promise((resolve) => { resolveLoad = resolve; });
const pending = api.loadSavedVocabulary();
changed([{ word: "finden" }]);
resolveLoad({ ok: true, entries: [{ word: "Haus" }] });
await pending;
assert.deepEqual(marked().map((word) => word.dataset.word), ["finden"], "an old load cannot overwrite a newer cross-tab update");
changed(undefined);
assert.equal(marked().length, 0, "removing the storage key clears every mark");
let hoverReleases = 0;
api.setHoverController({ release() { hoverReleases++; } });
api.renderClickableText('Ein neuer Satz.');
api.renderClickableText('Noch ein Satz.');
assert.equal(hoverReleases, 0, 'nonempty source replacement keeps box-hover pause ownership');
api.renderClickableText('');
assert.equal(hoverReleases, 1, 'hiding the empty caption box releases an owned hover pause');
assert.ok(requests.every((message) => message.type === "GET_SAVED_WORDS"));
console.log("Cross-show saved-word lifecycle passed");

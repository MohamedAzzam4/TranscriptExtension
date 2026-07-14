import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ console });
const source = fs.readFileSync(new URL("./transcript-groups.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "transcript-groups.js" });

const helpers = context.DubTranscriptGroups;
const groups = helpers.buildDisplayGroups([
  { id: "0", start: 0, end: 0.3, text: "Ich glaube,", complete: true, boundary: "silence" },
  { id: "1", start: 1.2, end: 2.5, text: "wenn man darüber spricht,", complete: true, boundary: "phrase" },
  { id: "2", start: 2.6, end: 3.5, text: "wird es klarer.", complete: true, boundary: "sentence" },
  { id: "3", start: 4, end: 4.2, text: "Nö.", complete: true, boundary: "silence" },
  { id: "4", start: 4.6, end: 5.5, text: "Das bleibt getrennt.", complete: true, boundary: "sentence" }
]);

assert.equal(groups.length, 3);
assert.equal(groups[0].text, "Ich glaube, wenn man darüber spricht, wird es klarer.");
assert.deepEqual([...groups[0].segmentIds], ["0", "1", "2"]);
assert.equal(groups[0].reason, "sentence");
assert.equal(groups[1].text, "Nö.");
assert.equal(groups[2].text, "Das bleibt getrennt.");
assert.ok(groups[0].words.length > 3);
assert.equal(groups[0].words[0].text, "Ich");
assert.equal(groups[0].words[0].timing, "estimated-within-cue");

const exact = helpers.buildDisplayGroups([{
  id: "exact",
  start: 10,
  end: 11,
  text: "Hallo Welt.",
  complete: true,
  boundary: "sentence",
  words: [
    { text: "Hallo", start: 10.1, end: 10.5 },
    { text: "Welt", start: 10.55, end: 10.95 }
  ]
}]);
assert.equal(JSON.stringify(
  exact[0].words.map(({ text, start, end }) => ({ text, start, end }))
), JSON.stringify([
  { text: "Hallo", start: 10.1, end: 10.5 },
  { text: "Welt", start: 10.55, end: 10.95 }
]));
assert.equal(exact[0].words[0].timing, "word-timestamps");

const bounded = helpers.buildDisplayGroups([
  { id: "a", start: 0, end: 4, text: "A".repeat(100) + ",", complete: true, boundary: "phrase" },
  { id: "b", start: 4, end: 8, text: "B".repeat(100) + ".", complete: true, boundary: "sentence" }
]);
assert.equal(bounded.length, 2);
assert.ok(bounded.every((group) => group.text.length <= 150));

assert.equal(helpers.normalizeSyncOffset(0.26), 0.3);
assert.equal(helpers.normalizeSyncOffset(-0.04), 0);
assert.equal(helpers.normalizeSyncOffset(99), 3);
assert.equal(helpers.normalizeSyncOffset(-99), -3);

console.log("Transcript display-group tests passed");

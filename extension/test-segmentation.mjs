import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
const source = fs.readFileSync(new URL("./subtitle-segmentation.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "subtitle-segmentation.js" });

function evaluate(expression) {
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

const wordTimed = evaluate(`DubTranscriptSegmentation.cuesForSourceLine(
  {text: "der dem Begriff das Unbekannte inne wohnt und eine ganz bestimmte Art von", timing: "word-timestamps"},
  19.8,
  24.08
)`);
assert.deepEqual(wordTimed, [{
  text: "der dem Begriff das Unbekannte inne wohnt und eine ganz bestimmte Art von",
  start: 19.8,
  end: 24.08
}]);

const legacy = evaluate(`DubTranscriptSegmentation.cuesForSourceLine(
  {text: "This legacy upstream line is deliberately long enough that the proportional fallback still splits it into smaller readable pieces."},
  0,
  10
)`);
assert.ok(legacy.length > 1, "legacy lines without word timing should retain the fallback splitter");

console.log("Subtitle segmentation tests passed");

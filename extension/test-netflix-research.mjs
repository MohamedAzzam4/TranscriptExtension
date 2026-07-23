import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({
  console,
  URL,
  Date
});
const source = fs.readFileSync(new URL("./netflix-research.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "netflix-research.js" });

function evaluate(expression) {
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

const groups = evaluate(`DubTranscriptNetflixResearch.groupAudioRepresentations([
  {
    url: "https://one.nflxvideo.net/?token=secret-one",
    kind: "netflix-audio",
    language: "deu",
    trackId: "de-main",
    role: "main",
    profile: "xheaac-dash",
    bitrate: 192,
    channels: 2,
    representationIndex: 3
  },
  {
    url: "https://two.nflxvideo.net/?token=secret-two",
    kind: "netflix-audio",
    language: "de",
    trackId: "de-main",
    role: "main",
    profile: "xheaac-dash",
    bitrate: 192,
    channels: 2,
    representationIndex: 3
  },
  {
    url: "https://three.nflxvideo.net/?token=secret-three",
    kind: "netflix-audio",
    language: "de",
    trackId: "de-main",
    role: "main",
    profile: "xheaac-dash",
    bitrate: 96,
    channels: 2,
    representationIndex: 2
  }
], "de")`);

assert.equal(groups.length, 2, "CDN mirrors of one representation should be grouped");
assert.equal(groups[0].urls.length, 2);
assert.equal(groups[0].hosts.length, 2);
assert.equal(groups[1].urls.length, 1);

const subtitleInventory = evaluate(`DubTranscriptNetflixResearch.subtitleInventory([
  { language: "deu", label: "Deutsch [CC]", trackId: "de-sdh", sdh: true },
  { language: "de", label: "Deutsch", trackId: "de-standard" },
  { language: "en", label: "English", trackId: "en-standard" }
], "de")`);
assert.equal(subtitleInventory.sameLanguageCount, 2);
assert.equal(subtitleInventory.conclusion, "candidate-present-not-verified");
assert.equal(
  subtitleInventory.dubMatchCandidates.find((track) => track.trackId === "de-sdh").expectation,
  "candidate-for-dub-match"
);

const matching = evaluate(`DubTranscriptNetflixResearch.estimateSubtitleAlignment(
  [{start: 0, end: 25, text: "${"das ist ein einfacher deutscher satz ".repeat(8)}"}],
  [{start: 0, end: 25, text: "${"das ist ein einfacher deutscher satz ".repeat(8)}"}]
)`);
assert.equal(matching.status, "likely-dub-matching");
assert.equal(matching.agreementEstimate, 1);

const different = evaluate(`DubTranscriptNetflixResearch.estimateSubtitleAlignment(
  [{start: 0, end: 25, text: "${"wir gehen heute gemeinsam in die stadt ".repeat(8)}"}],
  [{start: 0, end: 25, text: "${"morgen bleibt der alte zug wegen regen stehen ".repeat(8)}"}]
)`);
assert.equal(different.status, "likely-not-dub-matching");

const insufficient = evaluate(`DubTranscriptNetflixResearch.estimateSubtitleAlignment(
  [{start: 0, end: 5, text: "zu kurz"}],
  [{start: 0, end: 5, text: "zu kurz"}]
)`);
assert.equal(insufficient.status, "insufficient-sample");

console.log("Netflix research helper tests passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const listener = { addListener() {} };
const context = vm.createContext({
  chrome: {
    runtime: { onMessage: listener },
    tabs: { onRemoved: listener, onUpdated: listener }
  },
  console,
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams
});

const source = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "service-worker.js" });

function evaluate(expression) {
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

assert.deepEqual(
  evaluate("mergeCoverageRanges([{start: 0, end: 0.5}, {start: 0.5, end: 1}, {start: 1.2, end: 1.7}])"),
  [{ start: 0, end: 1.7 }],
  "PCM chunks and small scheduling gaps should become one cached range"
);

const replayFromSilence = evaluate(
  "findCoveredRange([{start: 0, end: 30}], [{start: 5, end: 8}], 22)"
);
assert.deepEqual(
  replayFromSilence,
  { start: 0, end: 30 },
  "a rewind into analyzed silence should use audio coverage, not retranscribe"
);
assert.deepEqual(
  evaluate("findCoveredRange([{start: 0, end: 30}], [{start: 5, end: 8}], 22)"),
  replayFromSilence,
  "repeating the same rewind should keep using the same cached range"
);

assert.deepEqual(
  evaluate("findCoveredRange([], [{start: 0, end: 10}, {start: 12, end: 20}], 11)"),
  { start: 0, end: 20 },
  "older experiments should retain the speech-segment fallback"
);
assert.equal(
  evaluate("findCoveredRange([{start: 0, end: 30}], [], 40)"),
  null,
  "audio that was never analyzed must start a new recognition epoch"
);

assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://www.youtube.com/watch?v=public"},
    {drmProtected: false, sourceKind: "blob", batchCandidates: []}
  )`),
  {
    supported: true,
    sourceKind: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=public",
    headers: {}
  },
  "YouTube pages should use the page-level batch adapter even when the video element is a blob"
);
assert.equal(
  evaluate(`chooseBatchCandidate(
    {url: "https://video.example/watch"},
    {drmProtected: true, batchCandidates: ["https://cdn.example/video.mp4"]}
  )`).supported,
  false,
  "encrypted media must never be sent to the batch downloader"
);
assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://video.example/watch"},
    {
      drmProtected: false,
      batchCandidates: ["https://cdn.example/master.m3u8"],
      frameUrl: "https://player.example/embed/1",
      userAgent: "Test Browser"
    }
  )`),
  {
    supported: true,
    sourceKind: "direct",
    sourceUrl: "https://cdn.example/master.m3u8",
    headers: {
      "user-agent": "Test Browser",
      referer: "https://player.example/embed/1",
      origin: "https://player.example"
    }
  },
  "a direct non-DRM HLS source should be eligible for local batch analysis"
);

console.log("Replay coverage tests passed");

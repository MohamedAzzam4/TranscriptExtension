import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({
  URL,
  console,
  globalThis: {}
});
const source = fs.readFileSync(
  new URL("./network-media-observer.js", import.meta.url),
  "utf8"
);
vm.runInContext(source, context, { filename: "network-media-observer.js" });

const observer = context.globalThis.DubTranscriptNetworkMedia;
assert.ok(observer, "the network media observer should publish its testable API");

assert.deepEqual(
  structuredClone(observer.cleanReplayHeaders([
    { name: "Referer", value: "https://player.example/watch\r\nInjected: no" },
    { name: "Origin", value: "https://player.example" },
    { name: "Accept-Language", value: "de-DE,de;q=0.9" },
    { name: "Cookie", value: "session=secret" },
    { name: "Authorization", value: "Bearer secret" }
  ])),
  {
    referer: "https://player.example/watchInjected: no",
    origin: "https://player.example",
    "accept-language": "de-DE,de;q=0.9"
  }
);

assert.equal(
  observer.classifyMediaRequest(
    "https://media.example/opaque?id=123",
    "application/vnd.apple.mpegurl"
  ),
  "hls"
);
assert.equal(
  observer.classifyMediaRequest(
    "https://media.example/chunk-42.ts",
    "video/mp2t"
  ),
  "hls-segment"
);

const store = observer.createStore({ now: () => 100_000 });
const playlistRequest = {
  requestId: "playlist",
  tabId: 7,
  frameId: 3,
  parentFrameId: 0,
  type: "xmlhttprequest",
  method: "GET",
  initiator: "https://playmogo.com",
  url: "https://media.example/opaque?token=temporary"
};
store.beforeRequest(playlistRequest);
store.beforeSendHeaders({
  ...playlistRequest,
  requestHeaders: [
    { name: "Referer", value: "https://playmogo.com/e/test" },
    { name: "Origin", value: "https://playmogo.com" },
    { name: "Accept-Language", value: "de-DE,de;q=0.9" },
    { name: "Cookie", value: "session=secret" },
    { name: "Authorization", value: "Bearer secret" }
  ]
});
store.headersReceived({
  ...playlistRequest,
  statusCode: 200,
  responseHeaders: [
    { name: "Content-Type", value: "application/vnd.apple.mpegurl" }
  ]
});

const segmentRequest = {
  requestId: "segment",
  tabId: 7,
  frameId: -1,
  parentFrameId: -1,
  type: "xmlhttprequest",
  method: "GET",
  initiator: "https://playmogo.com",
  url: "https://media.example/chunk-42.ts"
};
store.beforeRequest(segmentRequest);
store.headersReceived({
  ...segmentRequest,
  statusCode: 206,
  responseHeaders: [{ name: "Content-Type", value: "video/mp2t" }]
});

const snapshot = store.snapshot(7, 3, "https://playmogo.com/e/test");
assert.equal(snapshot.candidates.length, 1);
assert.equal(snapshot.candidates[0].kind, "hls");
assert.equal(snapshot.candidates[0].frameId, 3);
assert.equal(snapshot.candidates[0].headers.referer, "https://playmogo.com/e/test");
assert.equal(snapshot.candidates[0].headers.origin, "https://playmogo.com");
assert.equal(snapshot.candidates[0].headers.cookie, undefined);
assert.equal(snapshot.candidates[0].headers.authorization, undefined);
assert.equal(snapshot.diagnostics.observedRequestCount, 2);
assert.equal(snapshot.diagnostics.candidateCount, 1);
assert.equal(snapshot.diagnostics.segmentEvidenceCount, 1);
assert.deepEqual(
  structuredClone(snapshot.diagnostics.replayHeaderNames),
  ["accept-language", "origin", "referer"]
);

store.clearTab(7);
assert.equal(store.snapshot(7).candidates.length, 0);

console.log("Generic network media-observer tests passed");

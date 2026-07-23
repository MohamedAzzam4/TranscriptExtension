import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const runtimeMessages = [];
const listener = { addListener() {} };
const compressedBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);

class FakeOfflineAudioContext {
  async decodeAudioData(buffer) {
    assert.equal(buffer.byteLength, compressedBytes.byteLength);
    const left = new Float32Array(16_000).fill(0.5);
    const right = new Float32Array(16_000).fill(-0.25);
    return {
      sampleRate: 16_000,
      numberOfChannels: 2,
      length: 16_000,
      duration: 1,
      getChannelData(index) {
        return index === 0 ? left : right;
      }
    };
  }
}

const context = vm.createContext({
  console,
  URL,
  URLSearchParams,
  AbortController,
  DOMException,
  OfflineAudioContext: FakeOfflineAudioContext,
  btoa,
  setTimeout,
  clearTimeout,
  navigator: {},
  chrome: {
    runtime: {
      onMessage: listener,
      async sendMessage(message) {
        runtimeMessages.push(structuredClone(message));
        return { ok: true };
      }
    }
  },
  async fetch(url, options) {
    assert.equal(options.credentials, "omit");
    if (new URL(url).hostname === "fail.nflxvideo.net") {
      return {
        ok: false,
        status: 503,
        headers: { get() { return null; } },
        body: null
      };
    }
    let delivered = false;
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return String(name).toLowerCase() === "content-length"
            ? String(compressedBytes.byteLength)
            : null;
        }
      },
      body: {
        getReader() {
          return {
            async read() {
              if (delivered) return { done: true };
              delivered = true;
              return { done: false, value: compressedBytes };
            }
          };
        }
      }
    };
  }
});
context.globalThis = context;

const source = fs.readFileSync(new URL("./offscreen.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "offscreen.js" });
assert.deepEqual(
  structuredClone(vm.runInContext('parseContentRange("bytes 0-715239/17500000")', context)),
  { start: 0, end: 715239, total: 17500000 }
);
context.testMessage = {
  jobId: "browser-job",
  sourceUrl: "https://ipv4-c001.example.nflxvideo.net/?o=one&v=two",
  referrer: "https://www.netflix.com/watch/123",
  durationHint: 1
};
context.testSignal = new AbortController().signal;
await vm.runInContext("decodeBrowserBatchAudio(testMessage, testSignal)", context);

assert.ok(runtimeMessages.some((message) => (
  message.type === "BROWSER_BATCH_PROGRESS" && message.phase === "downloading"
)));
assert.ok(runtimeMessages.some((message) => message.type === "BROWSER_BATCH_PCM_BEGIN"));
const pcmChunks = runtimeMessages.filter((message) => message.type === "BROWSER_BATCH_PCM_CHUNK");
assert.equal(pcmChunks.length, 1);
assert.equal(Buffer.from(pcmChunks[0].data, "base64").byteLength, 32_000);
assert.equal(runtimeMessages.at(-1).type, "BROWSER_BATCH_PCM_FINISH");

context.badMessage = {
  ...context.testMessage,
  sourceUrl: "https://evilnflxvideo.net/audio.mp4"
};
await assert.rejects(
  vm.runInContext("decodeBrowserBatchAudio(badMessage, testSignal)", context),
  /only HTTPS Netflix media CDN audio/
);

const retryStart = runtimeMessages.length;
context.retryMessage = {
  ...context.testMessage,
  sourceCandidates: [
    { url: "https://fail.nflxvideo.net/audio.mp4", codec: "aac", profile: "xhe-aac-dash" },
    { url: context.testMessage.sourceUrl, codec: "aac", profile: "heaac-2-dash" }
  ]
};
await vm.runInContext("decodeBrowserBatchAudio(retryMessage, testSignal)", context);
const retryMessages = runtimeMessages.slice(retryStart);
assert.ok(retryMessages.some((message) => (
  message.type === "BROWSER_BATCH_PROGRESS"
  && message.phase === "candidate-failed"
  && message.candidateIndex === 1
  && message.category === "download-failed"
)));
assert.ok(retryMessages.some((message) => message.type === "BROWSER_BATCH_PCM_FINISH"));

console.log("Browser xHE-AAC fallback bridge tests passed");

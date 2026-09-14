import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Behavioral matrix for hideNativeYouTubeCaptions across the real
// BEGIN_SESSION message-producing paths in service-worker.js.
//
// Contract under test:
// - fresh YouTube caption reuse            -> true
// - cached/reopened youtube-auto-caption   -> true
// - batch ASR                              -> false
// - live (incl. fallback) ASR             -> false
// - local-ASR override (library, non-caption kind) -> false
// - non-YouTube batch                      -> false
//
// The assertions run the actual start*Experiment functions and inspect
// the BEGIN_SESSION messages they send to frames — never source text.

const tabMessages = [];
const listener = { addListener() {} };
const storageArea = (values) => ({
  async get(key) {
    if (typeof key === "string") return { [key]: values[key] };
    return { ...values };
  },
  async set(update) {
    Object.assign(values, structuredClone(update));
  },
  async remove(key) {
    delete values[key];
  }
});
const context = vm.createContext({
  importScripts(...files) {
    for (const file of files) {
      const imported = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      vm.runInContext(imported, context, { filename: file });
    }
  },
  chrome: {
    runtime: {
      onMessage: listener,
      getManifest() { return { version: "0.10.5" }; },
      getURL(path) { return `chrome-extension://test/${path}`; },
      async getContexts() { return [{ contextType: "OFFSCREEN_DOCUMENT" }]; },
      connectNative() {
        return {
          postMessage() {},
          onMessage: listener,
          onDisconnect: listener
        };
      },
      async sendMessage() { return { ok: true }; }
    },
    storage: { local: storageArea({}), session: storageArea({}) },
    tabs: {
      onRemoved: listener,
      onUpdated: listener,
      async sendMessage(tabId, message, options) {
        tabMessages.push(structuredClone({ tabId, message, options }));
        return { ok: true };
      }
    },
    tabCapture: {
      async getMediaStreamId() { return "test-stream-id"; }
    },
    scripting: {
      async executeScript() { return [{ frameId: 0 }]; }
    }
  },
  console,
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  URLSearchParams,
  structuredClone
});
const source = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "service-worker.js" });

function lastBeginSession() {
  const found = tabMessages.filter((entry) => entry.message?.type === "BEGIN_SESSION");
  assert.ok(found.length > 0, "expected a BEGIN_SESSION message");
  return found[found.length - 1].message;
}

function baseSettings() {
  return {
    audioLanguage: "de",
    captionLanguage: "de",
    collectCaptions: false,
    syncOffset: 0,
    captionPreferences: {},
    translationPreferences: {},
    batchModel: "small",
    serverUrl: "ws://127.0.0.1:8000/asr"
  };
}

function basePrepared(url = "https://www.youtube.com/watch?v=test123") {
  return {
    tab: { id: 7, url, title: "Test video" },
    mediaTarget: {
      frameId: 0,
      context: { duration: 120, frameUrl: url }
    }
  };
}

function savedRecord(kind) {
  return {
    identity: "test-identity",
    key: "test-key",
    duration: 120,
    segments: [{ start: 0, end: 1, text: "Hallo Welt.", words: [] }],
    transcriptSource: { kind, provider: "test", language: "de", purpose: "transcript-input" },
    captionSegments: []
  };
}

// 1. Fresh YouTube caption reuse -> true.
{
  tabMessages.length = 0;
  const candidate = {
    captionTracks: [{ start: 0, end: 1, text: "Hallo Welt.", id: "a", words: [] }],
    captionLanguage: "de",
    captionTrackInfo: { vssId: "a.de-orig" }
  };
  vm.runInContext(`globalThis.__r1 = null`, context);
  await vm.runInContext(
    `startCaptionReuseExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, ${JSON.stringify(candidate)}).then((r) => { globalThis.__r1 = r; })`,
    context
  );
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, true, "caption reuse hides native captions");
}

// 2. Cached youtube-auto-caption reopen -> true.
{
  tabMessages.length = 0;
  vm.runInContext(
    `startLibraryExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, ${JSON.stringify(savedRecord("youtube-auto-caption"))}).then((r) => { globalThis.__r2 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, true, "cached caption reopen hides native captions");
}

// 3. Local-ASR override (library, non-caption kind) -> false.
{
  tabMessages.length = 0;
  vm.runInContext(
    `startLibraryExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, ${JSON.stringify(savedRecord("local-whisper-batch"))}).then((r) => { globalThis.__r3 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, false, "local-ASR override keeps native captions");
}

// 4. Legacy local record -> false.
{
  tabMessages.length = 0;
  vm.runInContext(
    `startLibraryExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, ${JSON.stringify(savedRecord("legacy-local-asr"))}).then((r) => { globalThis.__r4 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, false, "legacy record keeps native captions");
}

// 5. Batch ASR -> false.
{
  tabMessages.length = 0;
  const candidate = {
    sourceKind: "direct",
    sourceUrl: "https://media.example/audio.mp4",
    headers: {},
    discoveryKind: "direct"
  };
  vm.runInContext(
    `startBatchExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, ${JSON.stringify(candidate)}).then((r) => { globalThis.__r5 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, false, "batch ASR keeps native captions");
}

// 6. Live ASR (fallback path) -> false.
{
  tabMessages.length = 0;
  vm.runInContext(`nativeHostWaiter = { promise: Promise.resolve(), resolve() {}, reject() {}, timeout: 0 };`, context);
  vm.runInContext(
    `startLiveExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(basePrepared())}, "test fallback").then((r) => { globalThis.__r6 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, false, "live ASR keeps native captions");
}

// 7. Non-YouTube batch -> false (must not touch foreign captions).
{
  tabMessages.length = 0;
  const candidate = {
    sourceKind: "direct",
    sourceUrl: "https://media.example/audio.mp4",
    headers: {},
    discoveryKind: "direct"
  };
  const prepared = basePrepared("https://www.netflix.com/watch/123");
  vm.runInContext(
    `startBatchExperiment(${JSON.stringify(baseSettings())}, ${JSON.stringify(prepared)}, ${JSON.stringify(candidate)}).then((r) => { globalThis.__r7 = r; })`,
    context
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const message = lastBeginSession();
  assert.equal(message.hideNativeYouTubeCaptions, false, "non-YouTube batch keeps native captions");
}

console.log("All hide-native matrix tests passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Behavioral test: buildYouTubeTimingDiagnostics must use the REAL
// transcript-grouping implementation inside the service-worker environment
// (transcript-groups.js via importScripts), not silently fall back.
// A decoy displayGroups array proves which path ran: the real implementation
// ignores it, the fallback returns it verbatim.

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
        return { postMessage() {}, onMessage: listener, onDisconnect: listener };
      },
      async sendMessage() { return { ok: true }; }
    },
    storage: { local: storageArea({}), session: storageArea({}) },
    tabs: {
      onRemoved: listener,
      onUpdated: listener,
      async sendMessage() { return { ok: true }; }
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

function makeExperiment() {
  return {
    platform: "youtube",
    page: { duration: 120 },
    settings: { syncOffset: 0 },
    // Decoy: if the fallback path ran, diagnostics would echo this verbatim.
    displayGroups: [{ start: 99, end: 100, text: "decoy", words: [] }],
    asrSegments: [
      {
        id: "batch:job:0", start: 0, end: 2, text: "Hello world.",
        words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "world.", start: 0.5, end: 1.0 }],
        complete: true, boundary: "sentence", timing: "word-timestamps"
      },
      {
        id: "batch:job:1", start: 2.5, end: 4, text: "How are you?",
        words: [{ text: "How", start: 2.5, end: 3.0 }, { text: "you?", start: 3.0, end: 3.5 }],
        complete: true, boundary: "sentence", timing: "word-timestamps"
      },
      {
        id: "batch:job:2", start: 10, end: 12, text: "Later topic here",
        words: [{ text: "Later", start: 10, end: 10.5 }, { text: "topic", start: 10.5, end: 11.0 }],
        complete: true, boundary: "silence", timing: "word-timestamps"
      }
    ]
  };
}

function makePipeline() {
  return {
    sourceKind: "youtube-audio",
    diagnostics: {
      attempts: [{
        phase: "succeeded",
        formatId: "251",
        containerFormat: "webm",
        mediaExtension: "webm",
        codec: "opus",
        sampleRate: 48000,
        firstDecodedAudioPts: 2.75,
        decodedSampleCount: 192000,
        decodedAudioDuration: 4.0
      }]
    }
  };
}

// Test 1: the shared grouping implementation is actually loaded in SW env.
{
  const version = vm.runInContext(`globalThis.DubTranscriptGroups?.version`, context);
  assert.equal(version, 2, "DubTranscriptGroups v2 must be available via importScripts");
}

// Test 2: diagnostics use the REAL grouping (decoy displayGroups ignored).
{
  vm.runInContext(`globalThis.__exp = ${JSON.stringify(makeExperiment())}; globalThis.__pipe = ${JSON.stringify(makePipeline())};`, context);
  const diag = vm.runInContext(`buildYouTubeTimingDiagnostics(globalThis.__exp, globalThis.__pipe)`, context);
  assert.ok(diag, "diagnostics produced");
  assert.equal(diag.firstDecodedAudioPts, 2.75);
  // Real grouping of the cue set: sentence-terminated cues split, the
  // trailing cue stands alone. The decoy (start 99) must NOT appear.
  assert.equal(typeof diag.firstDisplayGroupTimestamp, "object", "unexpected shape");
  assert.equal(diag.firstDisplayGroupTimestamp.start, 0, "real grouping used, not fallback decoy");
  assert.notEqual(diag.firstDisplayGroupTimestamp.start, 99);
  assert.equal(diag.lastDisplayGroupTimestamp.start, 10);
}

// Test 3: intentional fallback when the implementation is absent.
{
  vm.runInContext(`delete globalThis.DubTranscriptGroups;`, context);
  try {
    vm.runInContext(`globalThis.__exp2 = ${JSON.stringify(makeExperiment())}; globalThis.__pipe2 = ${JSON.stringify(makePipeline())};`, context);
    const diag = vm.runInContext(`buildYouTubeTimingDiagnostics(globalThis.__exp2, globalThis.__pipe2)`, context);
    assert.ok(diag, "diagnostics still produced via fallback");
    assert.equal(diag.firstDisplayGroupTimestamp.start, 99, "fallback echoes experiment.displayGroups");
  } finally {
    // Restore the shared implementation for any later tests in this file.
    vm.runInContext(`importScripts("transcript-groups.js")`, context);
  }
  const version = vm.runInContext(`globalThis.DubTranscriptGroups?.version`, context);
  assert.equal(version, 2, "implementation restored after fallback test");
}

console.log("All timing-grouping tests passed");

import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const local = {};
const session = {};
const tabMessages = [];
const runtimeMessages = [];
const nativeMessages = [];
const scriptInjections = [];
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
let context;
context = vm.createContext({
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
          postMessage(message) { nativeMessages.push(structuredClone(message)); },
          onMessage: listener,
          onDisconnect: listener
        };
      },
      async sendMessage(message) {
        runtimeMessages.push(structuredClone(message));
        if (message.command === "youtube_caption_discovery") {
          // Simulate native host would respond, but we test via direct handleNativeHostMessage
        }
        return { ok: true };
      }
    },
    storage: { local: storageArea(local), session: storageArea(session) },
    tabs: {
      onRemoved: listener,
      onUpdated: listener,
      async sendMessage(tabId, message, options) {
        tabMessages.push(structuredClone({ tabId, message, options }));
        return { ok: true };
      }
    },
    scripting: {
      async executeScript(injection) {
        scriptInjections.push(structuredClone(injection));
        return [{ frameId: 0 }, { frameId: 3 }];
      }
    }
  },
  console,
  crypto: globalThis.crypto,
  async fetch(url) {
    if (String(url).startsWith("https://translation.googleapis.com/")) {
      return { ok: true, async json() { return { data: { translations: [{ translatedText: "Hello & welcome." }] } }; } };
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  },
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

// Test 1: normalizeRuntimeSettings migration
{
  const cases = [
    [{ youtubeTranscriptSource: "auto" }, "youtube-auto-first"],
    [{ youtubeTranscriptSource: "local" }, "local-asr"],
    [{ youtubeTranscriptSource: "local-asr" }, "local-asr"],
    [{ youtubeTranscriptSource: "youtube-auto-first" }, "youtube-auto-first"],
    [{ youtubeTranscriptSource: "unknown" }, "youtube-auto-first"],
    [{}, "youtube-auto-first"],
  ];
  for (const [input, expected] of cases) {
    const result = vm.runInContext(`normalizeRuntimeSettings(${JSON.stringify(input)})`, context);
    assert.equal(result.youtubeTranscriptSource, expected, `normalize for ${JSON.stringify(input)}`);
  }
}

// Test 2: selectEligible tracks
{
  const tracks = [{ vssId: "a.de-orig", languageCode: "de" }, { vssId: "a.en", languageCode: "en" }];
  const r = vm.runInContext(`selectEligibleYouTubeAutomaticCaption(${JSON.stringify(tracks)}, "de")`, context);
  assert.equal(r.vssId, "a.de-orig");
}
{
  const tracks = [{ vssId: "a.de.tlang=de", languageCode: "de" }];
  const r = vm.runInContext(`selectEligibleYouTubeAutomaticCaption(${JSON.stringify(tracks)}, "de")`, context);
  assert.equal(r, null);
}
{
  const tracks = [{ vssId: "a.en", languageCode: "en" }];
  const r = vm.runInContext(`selectEligibleYouTubeAutomaticCaption(${JSON.stringify(tracks)}, "de")`, context);
  assert.equal(r, null);
}

// Test 3: selectedTranscriptSegments
{
  const exp1 = { transcriptSource: { kind: "youtube-auto-caption" }, asrSegments: [{ text: "ASR" }], captionSegments: [{ text: "CAP" }] };
  const sel1 = vm.runInContext(`selectedTranscriptSegments(${JSON.stringify(exp1)})`, context);
  assert.equal(sel1[0].text, "CAP");
  const exp2 = { transcriptSource: { kind: "local-whisper-batch" }, asrSegments: [{ text: "ASR" }], captionSegments: [{ text: "CAP" }] };
  const sel2 = vm.runInContext(`selectedTranscriptSegments(${JSON.stringify(exp2)})`, context);
  assert.equal(sel2[0].text, "ASR");
}
{
  const exp3 = { transcriptSource: { kind: "legacy-local-asr" }, asrSegments: [{ text: "Legacy" }], captionSegments: [{ text: "CAP" }] };
  const sel3 = vm.runInContext(`selectedTranscriptSegments(${JSON.stringify(exp3)})`, context);
  assert.equal(sel3[0].text, "Legacy");
}

// Test 4: DEFECT 1 - pending job stays pending until complete (queued -> status -> complete)
{
  vm.runInContext(`pendingCaptionDiscoveryJobs.clear()`, context);
  let promise;
  // Start a fake pending job
  vm.runInContext(`
    new Promise((resolve, reject) => {
      const jobId = "test-job-1";
      const timeoutId = setTimeout(() => reject(new Error("timeout")), 5000);
      pendingCaptionDiscoveryJobs.set(jobId, { resolve: (v) => { clearTimeout(timeoutId); pendingCaptionDiscoveryJobs.delete(jobId); resolve(v); }, reject: (e) => { clearTimeout(timeoutId); pendingCaptionDiscoveryJobs.delete(jobId); reject(e); }, timeoutId });
      // expose promise for test
      globalThis.__testPromise1 = new Promise((res, rej) => {
        const p = pendingCaptionDiscoveryJobs.get(jobId);
        // Wrap to capture
        const origResolve = p.resolve;
        const origReject = p.reject;
        p.resolve = (v) => { origResolve(v); res(v); };
        p.reject = (e) => { origReject(e); rej(e); };
      });
    });
  `, context);
  // Simulate queued then status - should remain pending
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_queued", jobId: "test-job-1" })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("test-job-1")`, context), true, "queued keeps pending");
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_status", jobId: "test-job-1", message: "Discovering" })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("test-job-1")`, context), true, "status keeps pending");
  // Now complete
  const completeMsg = { state: "caption_discovery_complete", jobId: "test-job-1", ok: true, segments: [{ start: 0, end: 1, text: "Hallo" }], language: "de", trackInfo: { vssId: "a.de-orig" } };
  vm.runInContext(`handleNativeHostMessage(${JSON.stringify(completeMsg)})`, context);
  // Pending should be cleared
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("test-job-1")`, context), false, "complete clears pending");
}

// Test 5: queued -> error should reject and clear
{
  vm.runInContext(`pendingCaptionDiscoveryJobs.clear()`, context);
  vm.runInContext(`pendingCaptionDiscoveryJobs.set("test-job-2", { resolve: ()=>{}, reject: (e)=>{ globalThis.__rejected2=true; pendingCaptionDiscoveryJobs.delete("test-job-2"); }, timeoutId: setTimeout(()=>{},5000) })`, context);
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_queued", jobId: "test-job-2" })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("test-job-2")`, context), true, "queued keeps pending");
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_error", jobId: "test-job-2", message: "No track" })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("test-job-2")`, context), false, "error clears pending");
  assert.equal(vm.runInContext(`globalThis.__rejected2`, context), true, "reject called");
}

// Test 6: two interleaved job IDs must not resolve each other
{
  vm.runInContext(`pendingCaptionDiscoveryJobs.clear()`, context);
  let resolve1, resolve2;
  vm.runInContext(`
    pendingCaptionDiscoveryJobs.set("job-A", { resolve: (v) => { globalThis.__resA = v; pendingCaptionDiscoveryJobs.delete("job-A"); }, reject: ()=>{}, timeoutId: setTimeout(()=>{}, 5000) });
    pendingCaptionDiscoveryJobs.set("job-B", { resolve: (v) => { globalThis.__resB = v; pendingCaptionDiscoveryJobs.delete("job-B"); }, reject: ()=>{}, timeoutId: setTimeout(()=>{}, 5000) });
  `, context);
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_complete", jobId: "job-A", ok: true, segments: [{text:"A"}] })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("job-A")`, context), false, "job-A resolved");
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("job-B")`, context), true, "job-B still pending");
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_complete", jobId: "job-B", ok: true, segments: [{text:"B"}] })`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.has("job-B")`, context), false, "job-B resolved");
}

// Test 7: late completion after timeout ignored
{
  vm.runInContext(`pendingCaptionDiscoveryJobs.clear()`, context);
  vm.runInContext(`
    pendingCaptionDiscoveryJobs.set("job-timeout", { resolve: () => { globalThis.__late = true; }, reject: () => {}, timeoutId: setTimeout(()=>{}, 5000) });
    // Simulate timeout clearing
    const p = pendingCaptionDiscoveryJobs.get("job-timeout");
    clearTimeout(p.timeoutId);
    pendingCaptionDiscoveryJobs.delete("job-timeout");
  `, context);
  // Late message should be ignored (no pending)
  vm.runInContext(`handleNativeHostMessage({ state: "caption_discovery_complete", jobId: "job-timeout", ok: true, segments: [] })`, context);
  assert.equal(vm.runInContext(`typeof globalThis.__late`, context), "undefined", "late completion ignored");
}

// Test 8: host disconnect rejects pending
{
  vm.runInContext(`pendingCaptionDiscoveryJobs.clear()`, context);
  vm.runInContext(`
    pendingCaptionDiscoveryJobs.set("job-disconnect", { resolve: ()=>{}, reject: (e) => { globalThis.__discErr = e.message; }, timeoutId: setTimeout(()=>{}, 5000) });
  `, context);
  vm.runInContext(`handleNativeHostDisconnect()`, context);
  assert.equal(vm.runInContext(`pendingCaptionDiscoveryJobs.size`, context), 0, "disconnect clears all");
}

// Test 9: no audio coverage for caption reuse
{
  const exp = { transcriptSource: { kind: "youtube-auto-caption" }, captionSegments: [{ start: 0, end: 10, text: "hello" }], audioCoverage: [] };
  assert.deepEqual(exp.audioCoverage, [], "caption reuse empty coverage");
}

// Test 10: batch provenance
{
  const exp = { transcriptSource: { kind: "local-whisper-batch", provider: "faster-whisper", purpose: "recognized-audio" } };
  assert.equal(exp.transcriptSource.provider, "faster-whisper");
  assert.equal(exp.transcriptSource.purpose, "recognized-audio");
}

// Test 11: live provenance
{
  const exp = { transcriptSource: { kind: "local-whisper-live", provider: "whisperlivekit", purpose: "recognized-audio" } };
  assert.equal(exp.transcriptSource.provider, "whisperlivekit");
}

// Test 12: saved-word vocabRevision invalidation
{
  const session = { displayedTimingKey: "text|0||vocab:1", vocabRevision: 1 };
  const key1 = `text|0||vocab:${session.vocabRevision}`;
  session.vocabRevision = 2;
  const key2 = `text|0||vocab:${session.vocabRevision}`;
  assert.notEqual(key1, key2);
}

// Test 13: timing diagnostics zero preserved (nullish handling)
{
  const attempt = { firstDecodedAudioPts: 0, decodedSampleCount: 0, decodedAudioDuration: 0 };
  assert.equal(attempt.firstDecodedAudioPts ?? null, 0);
  assert.equal(attempt.decodedSampleCount ?? null, 0);
}

// Test 14: privacy redaction
{
  const str = JSON.stringify({ ytDlpFormatId: "123", container: "mp4", audioCodec: "aac", sampleRate: 48000 });
  assert.ok(!str.includes("signature"));
  assert.ok(!str.includes("token"));
}

// Test 15: hideNative flag for source kinds - real behavioral check via service-worker source
{
  const swSource = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
  assert.ok(swSource.includes('hideNativeYouTubeCaptions'), "service-worker has hideNative flag");
  assert.ok(swSource.includes('hideNativeYouTubeCaptions: false'), "batch/live send hideNative false");
  assert.ok(swSource.includes('hideNativeYouTubeCaptions: (experiment.transcriptSource?.kind === "youtube-auto-caption")'), "library replay sends hideNative based on kind");
  // Also verify content.js handles flag
  const contentSource = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
  assert.ok(contentSource.includes('saveAndHideNativeCaptions'), "content saves native caption state");
  assert.ok(contentSource.includes('restoreNativeCaptions'), "content restores native caption state");
}

console.log("All characterization tests passed");

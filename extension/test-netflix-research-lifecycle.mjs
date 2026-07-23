import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const local = {};
const session = {};
const listener = { addListener() {} };
const storageArea = (values) => ({
  async get(keys) {
    if (typeof keys === "string") return { [keys]: values[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, values[key]]));
    }
    return { ...values };
  },
  async set(update) {
    Object.assign(values, structuredClone(update));
  },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
  }
});

const mediaContext = {
  currentTime: 12,
  duration: 1_500,
  readyState: 4,
  paused: true,
  visible: true,
  width: 1280,
  height: 720,
  frameUrl: "https://www.netflix.com/watch/555",
  documentTitle: "Research Episode | Netflix",
  visibleTitleText: "Research Series · S2:E5 · Research Episode",
  userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
  browserLanguage: "de-DE",
  browserPlatform: "Windows",
  drmProtected: true,
  drmSignals: {
    mediaKeysAttached: true,
    encryptedEventObserved: true,
    observerReportedDrm: true
  },
  netflixMetadata: {
    title: {
      videoId: "555",
      contentType: "episode",
      seriesTitle: "Research Series",
      episodeTitle: "Research Episode",
      seasonNumber: 2,
      episodeNumber: 5,
      releaseYear: 2024
    },
    audioTracks: [{
      language: "deu",
      languageDescription: "Deutsch",
      trackId: "de-main",
      role: "main",
      selected: true,
      channels: 2,
      representationCount: 2
    }],
    subtitleTracks: [{
      language: "deu",
      languageDescription: "Deutsch [CC]",
      trackId: "de-sdh",
      role: "sdh",
      sdh: true,
      selected: true
    }]
  },
  batchCandidates: [
    {
      url: "https://mirror-one.nflxvideo.net/?secret=one",
      kind: "netflix-audio",
      language: "deu",
      languageDescription: "Deutsch",
      trackId: "de-main",
      role: "main",
      selected: true,
      profile: "xheaac-dash",
      bitrate: 192,
      channels: 2,
      representationIndex: 3
    },
    {
      url: "https://mirror-two.nflxvideo.net/?secret=two",
      kind: "netflix-audio",
      language: "de",
      languageDescription: "Deutsch",
      trackId: "de-main",
      role: "main",
      selected: true,
      profile: "xheaac-dash",
      bitrate: 192,
      channels: 2,
      representationIndex: 3
    },
    {
      url: "https://mirror-three.nflxvideo.net/?secret=three",
      kind: "netflix-audio",
      language: "de",
      languageDescription: "Deutsch",
      trackId: "de-main",
      role: "main",
      selected: true,
      profile: "xheaac-dash",
      bitrate: 96,
      channels: 2,
      representationIndex: 2
    }
  ]
};

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
      getManifest() { return { version: "0.9.5" }; },
      getURL(path) { return `chrome-extension://test/${path}`; },
      async getContexts() { return [{ contextType: "OFFSCREEN_DOCUMENT" }]; },
      async sendMessage(message) {
        if (message.type === "OFFSCREEN_INSPECT_NETFLIX_AUDIO") {
          assert.equal(message.candidates.length, 2, "CDN mirrors must be grouped before inspection");
          return {
            ok: true,
            environment: {
              webCodecsAvailable: true,
              offlineAudioContextAvailable: true
            },
            inspections: message.candidates.map((candidate) => ({
              representationKey: candidate.representationKey,
              sourceHost: "mirror-one.nflxvideo.net",
              status: "inspected",
              response: { deliveryShape: "full-sized-entity" },
              container: { parsed: true, codec: "mp4a.40.42" },
              protection: { detected: true },
              webCodecs: { configSupported: true },
              privacy: { audioStored: false, urlStored: false }
            }))
          };
        }
        return { ok: true };
      }
    },
    storage: {
      local: storageArea(local),
      session: storageArea(session)
    },
    tabs: {
      onRemoved: listener,
      onUpdated: listener,
      async query() {
        return [{ id: 7, url: "https://www.netflix.com/watch/555?token=page-secret", title: "Netflix" }];
      },
      async sendMessage(_tabId, message) {
        if (message.type === "GET_MEDIA_CONTEXT") return { ok: true, context: mediaContext };
        return { ok: true };
      }
    },
    scripting: {
      async executeScript() { return [{ frameId: 0 }]; }
    }
  },
  console,
  crypto: globalThis.crypto,
  Date,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  structuredClone
});

const source = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "service-worker.js" });

const result = await vm.runInContext('analyzeNetflixTitle("de")', context);
assert.equal(result.report.contentType, "episode");
assert.equal(result.report.inspectedRepresentationCount, 2);
assert.equal(result.report.protectionDetectedCount, 2);
assert.equal(result.report.subtitleConclusion, "candidate-present-not-verified");
assert.equal(result.report.agreementEstimate, null);

const reportKey = Object.keys(local).find((key) => key.startsWith("netflix-research:v1:"));
assert.ok(reportKey);
const serialized = JSON.stringify(local[reportKey]);
assert.doesNotMatch(serialized, /page-secret|secret=one|secret=two|secret=three/);
assert.equal(local[reportKey].privacy.audioStored, false);
assert.equal(local[reportKey].privacy.mediaUrlsStored, false);
assert.equal(local[reportKey].privacy.drmKeysCollected, false);

const dataset = await vm.runInContext("exportNetflixResearchDataset()", context);
assert.match(dataset.csv, /Research Episode/);
assert.doesNotMatch(dataset.csv, /nflxvideo|secret=/);

console.log("Netflix research lifecycle tests passed");

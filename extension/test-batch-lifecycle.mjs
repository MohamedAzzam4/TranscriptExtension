import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const local = {};
const session = {};
const tabMessages = [];
const runtimeMessages = [];
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
      async sendMessage(message) {
        runtimeMessages.push(structuredClone(message));
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
      async sendMessage(tabId, message, options) {
        tabMessages.push(structuredClone({ tabId, message, options }));
        return { ok: true };
      }
    }
  },
  console,
  crypto: globalThis.crypto,
  async fetch(url) {
    if (String(url).startsWith("https://translation.googleapis.com/")) {
      return {
        ok: true,
        async json() {
          return { data: { translations: [{ translatedText: "Hello &amp; welcome." }] } };
        }
      };
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  },
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  structuredClone
});

const source = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "service-worker.js" });

const active = {
  experimentId: "batch-experiment",
  tabId: 7,
  mediaFrameId: 3,
  mode: "batch-analyzing",
  batchJobId: "batch-job",
  settings: {
    serverUrl: "ws://127.0.0.1:8000/asr",
    audioLanguage: "de",
    captionLanguage: "de",
    collectCaptions: true,
    syncOffset: 0
  },
  syncOffset: 0,
  replay: null,
  recognizerReady: false
};
const experiment = {
  schemaVersion: 4,
  id: "batch-experiment",
  createdAt: new Date().toISOString(),
  finishedAt: null,
  platform: "youtube",
  page: {
    title: "Test video",
    url: "https://www.youtube.com/watch?v=test123",
    videoIdentity: "youtube:test123|audio:de",
    duration: 120
  },
  audioLanguage: "de",
  pipeline: { mode: "batch", status: "transcribing" },
  settings: { syncOffset: 0 },
  epochs: [],
  asrSegments: [],
  captionSegments: [],
  audioCoverage: [],
  runtimeSamples: []
};

session.activeExperiment = structuredClone(active);
local["experiment:batch-experiment"] = structuredClone(experiment);
context.testActive = structuredClone(active);
context.testFirstChunk = Array.from({ length: 100 }, (_, index) => ({
  id: `batch:${index}`,
  epochId: "batch",
  start: index,
  end: index + 0.8,
  text: `Erster Teil ${index}.`,
  complete: true,
  boundary: "sentence"
}));
context.testSecondChunk = Array.from({ length: 100 }, (_, index) => ({
  id: `batch:${index + 100}`,
  epochId: "batch",
  start: index + 100,
  end: index + 100.8,
  text: `Zweiter Teil ${index}.`,
  complete: true,
  boundary: "sentence"
}));
context.testThirdChunk = Array.from({ length: 50 }, (_, index) => ({
  id: `batch:${index + 200}`,
  epochId: "batch",
  start: index + 200,
  end: index + 200.8,
  text: `Dritter Teil ${index}.`,
  complete: true,
  boundary: "sentence"
}));
context.testFirstCaptionChunk = Array.from({ length: 100 }, (_, index) => ({
  id: `youtube-caption:manual:${index}`,
  start: index,
  end: index + 1,
  text: `Referenz ${index}.`,
  source: "youtube-manual-caption"
}));
context.testSecondCaptionChunk = Array.from({ length: 20 }, (_, index) => ({
  id: `youtube-caption:manual:${index + 100}`,
  start: index + 100,
  end: index + 101,
  text: `Referenz ${index + 100}.`,
  source: "youtube-manual-caption"
}));
context.testCompleteMessage = {
  state: "batch_complete",
  jobId: "batch-job",
  duration: 250,
  language: "de",
  device: "cuda/float16",
  segmentCount: 250,
  captionSegmentCount: 120,
  evaluation: {
    status: "available",
    metrics: { wordAgreementEstimate: 0.875 }
  }
};

vm.runInContext(`
  handleNativeHostMessage({
    state: "batch_download_progress",
    jobId: "batch-job",
    percent: 100,
    downloadedBytes: 12345678,
    totalBytes: 12345678,
    bytesPerSecond: 1048576
  });
  handleNativeHostMessage({
    state: "batch_decode_progress",
    jobId: "batch-job",
    percent: 40,
    decodedSeconds: 100,
    duration: 250
  });
  handleNativeHostMessage({
    state: "batch_started",
    jobId: "batch-job",
    duration: 250,
    title: "Test video"
  });
  handleNativeHostMessage({
    state: "batch_segments",
    jobId: "batch-job",
    segments: testFirstChunk
  });
  handleNativeHostMessage({
    state: "batch_segments",
    jobId: "batch-job",
    segments: testSecondChunk
  });
  handleNativeHostMessage({
    state: "batch_segments",
    jobId: "batch-job",
    segments: testThirdChunk
  });
  handleNativeHostMessage({
    state: "batch_captions",
    jobId: "batch-job",
    segments: testFirstCaptionChunk
  });
  handleNativeHostMessage({
    state: "batch_captions",
    jobId: "batch-job",
    segments: testSecondCaptionChunk
  });
  handleNativeHostMessage(testCompleteMessage);
`, context);
await vm.runInContext("batchNativeMessageQueue", context);

assert.equal(session.activeExperiment.mode, "batch-ready");
assert.deepEqual(session.activeExperiment.replay, { start: 0, end: 250 });
assert.deepEqual(local["experiment:batch-experiment"].audioCoverage, [{ start: 0, end: 250 }]);
assert.equal(local["experiment:batch-experiment"].pipeline.status, "complete");
assert.equal(local["experiment:batch-experiment"].pipeline.progress, 100);
assert.equal(local["experiment:batch-experiment"].pipeline.decodeProgress, 100);
assert.equal(local["experiment:batch-experiment"].pipeline.downloadProgress, 100);
assert.equal(local["experiment:batch-experiment"].pipeline.downloadBytesPerSecond, 1048576);
assert.equal(local["experiment:batch-experiment"].pipeline.segmentCount, 250);
assert.equal(local["experiment:batch-experiment"].asrSegments.length, 250);
assert.equal(local["experiment:batch-experiment"].asrSegments[0].id, "batch:0");
assert.equal(local["experiment:batch-experiment"].asrSegments.at(-1).id, "batch:249");
assert.equal(local["experiment:batch-experiment"].captionSegments.length, 120);
assert.equal(local["experiment:batch-experiment"].evaluation.status, "available");
assert.ok(tabMessages.some(({ message }) => message.type === "TRANSCRIPT_UPDATE"));
assert.ok(tabMessages.some(({ message }) => message.type === "SET_REPLAY_MODE" && message.enabled));
assert.ok(tabMessages.some(({ message }) => message.type === "CONTROL_MEDIA" && message.action === "play"));
const libraryKey = context.DubTranscriptLearning.transcriptStorageKey(
  "youtube:test123|audio:de"
);
assert.equal(local.transcriptLibraryIndex.length, 1);
assert.equal(local.transcriptLibraryIndex[0].key, libraryKey);
assert.equal(local[libraryKey].segments.length, 250);
assert.equal(local[libraryKey].url, "https://www.youtube.com/watch?v=test123");
context.savedCompatibilityRecord = structuredClone(local[libraryKey]);
assert.equal(
  await vm.runInContext(
    "isStoredTranscriptCompatible(savedCompatibilityRecord, { duration: 251 })",
    context
  ),
  true
);
assert.equal(
  await vm.runInContext(
    "isStoredTranscriptCompatible(savedCompatibilityRecord, { duration: 400 })",
    context
  ),
  false
);
context.libraryKey = libraryKey;
const textExport = await vm.runInContext("exportLibraryTranscriptText(libraryKey)", context);
assert.match(textExport.text, /\[00:00\] Erster Teil 0\./);
assert.match(textExport.filename, /Test-video-de\.txt$/);

context.batchReadyActive = structuredClone(session.activeExperiment);
await vm.runInContext("handleSeek(batchReadyActive, 30, 1)", context);
assert.equal(session.activeExperiment.mode, "batch-ready");
assert.deepEqual(session.activeExperiment.replay, { start: 0, end: 250 });

const epochCount = local["experiment:batch-experiment"].epochs.length;
await vm.runInContext("handleMediaClock(7, 3, 249.95, 1)", context);
assert.equal(
  local["experiment:batch-experiment"].epochs.length,
  epochCount,
  "batch playback must not create a live epoch at the end of cached coverage"
);

context.testSyncOffsetMessage = { type: "SET_SYNC_OFFSET", offset: 0.36 };
await vm.runInContext("handleMessage(testSyncOffsetMessage, {})", context);
assert.equal(session.activeExperiment.syncOffset, 0.4);
assert.equal(local["experiment:batch-experiment"].settings.syncOffset, 0.4);
assert.ok(tabMessages.some(({ message }) => (
  message.type === "SET_SYNC_OFFSET" && message.offset === 0.4
)));

context.testDisplaySettingsMessage = {
  type: "UPDATE_DISPLAY_SETTINGS",
  captionPreferences: {
    fontSize: 38,
    horizontalPosition: 64,
    verticalPosition: 24,
    backgroundOpacity: 60,
    textOpacity: 90,
    textColor: "#FFFF00",
    backgroundColor: "#000000",
    fontFamily: "serif",
    edgeStyle: "outline"
  },
  translationPreferences: {
    enabled: false,
    targetLanguage: "en",
    provider: "browser"
  }
};
await vm.runInContext("handleMessage(testDisplaySettingsMessage, {})", context);
assert.equal(session.activeExperiment.settings.captionPreferences.fontSize, 38);
assert.equal(local.experimentSettings.captionPreferences.horizontalPosition, 64);
assert.equal(session.activeExperiment.settings.translationPreferences.enabled, false);
assert.ok(tabMessages.some(({ message }) => (
  message.type === "APPLY_DISPLAY_SETTINGS"
  && message.captionPreferences.verticalPosition === 24
  && message.translationPreferences.provider === "browser"
)));

context.testVocabularyEntry = {
  word: "Haus",
  englishDefinition: "house",
  germanDefinition: "Gebäude zum Wohnen",
  context: "Das ist ein Haus.",
  germanSourceUrl: "https://de.wiktionary.org/wiki/Haus",
  englishSourceUrl: "https://en.wiktionary.org/wiki/Haus"
};
const savedWord = await vm.runInContext("saveVocabularyWord(testVocabularyEntry)", context);
assert.equal(savedWord.saved, true);
assert.equal(local.savedVocabulary.length, 1);
assert.equal(local.savedVocabulary[0].normalizedWord, "haus");
const savedWords = await vm.runInContext("getSavedWords()", context);
assert.equal(savedWords.entries[0].englishDefinition, "house");
await vm.runInContext("removeSavedWord('Haus')", context);
assert.equal(local.savedVocabulary.length, 0);

local.translationSecrets = { googleApiKey: "test-key" };
context.testTranslationMessage = {
  text: "Hallo und willkommen.",
  sourceLanguage: "de",
  translationPreferences: {
    enabled: true,
    targetLanguage: "en",
    provider: "google"
  }
};
const translated = await vm.runInContext("translateText(testTranslationMessage)", context);
assert.equal(translated.translatedText, "Hello & welcome.");
assert.equal(translated.provider, "google");
assert.ok(Object.keys(local).some((key) => key.startsWith("translation:v1:de:en:")));
context.testUnsafeSettings = {
  serverUrl: "ws://127.0.0.1:8000/asr",
  audioLanguage: "de",
  googleApiKey: "must-not-enter-active-state",
  translationPreferences: { enabled: true, targetLanguage: "en", provider: "google" }
};
const normalizedRuntimeSettings = await vm.runInContext(
  "normalizeRuntimeSettings(testUnsafeSettings)",
  context
);
assert.equal("googleApiKey" in normalizedRuntimeSettings, false);

context.savedLibraryRecord = structuredClone(local[libraryKey]);
context.savedLibrarySettings = {
  serverUrl: "ws://127.0.0.1:8000/asr",
  audioLanguage: "de",
  captionLanguage: "de",
  collectCaptions: true,
  syncOffset: 0,
  captionPreferences: {},
  translationPreferences: {}
};
context.savedLibraryPrepared = {
  tab: {
    id: 8,
    title: "Test video",
    url: "https://www.youtube.com/watch?v=test123"
  },
  mediaTarget: {
    frameId: 0,
    context: {
      duration: 250,
      frameUrl: "https://www.youtube.com/watch?v=test123"
    }
  }
};
const restored = await vm.runInContext(
  "startLibraryExperiment(savedLibrarySettings, savedLibraryPrepared, savedLibraryRecord)",
  context
);
assert.equal(restored.mode, "library");
assert.equal(restored.restored, true);
assert.equal(session.activeExperiment.mode, "batch-ready");
assert.equal(local[`experiment:${restored.experimentId}`].asrSegments.length, 250);
assert.ok(tabMessages.some(({ tabId, message }) => (
  tabId === 8 && message.type === "BEGIN_SESSION" && message.segments.length === 250
)));

const incompleteActive = {
  ...active,
  experimentId: "incomplete-batch",
  batchJobId: "incomplete-job"
};
session.activeExperiment = structuredClone(incompleteActive);
local["experiment:incomplete-batch"] = {
  ...structuredClone(experiment),
  id: "incomplete-batch",
  asrSegments: [structuredClone(context.testFirstChunk[0])]
};
context.incompleteActive = structuredClone(incompleteActive);
context.incompleteCompleteMessage = {
  state: "batch_complete",
  jobId: "incomplete-job",
  duration: 200,
  segmentCount: 2
};
await assert.rejects(
  vm.runInContext(
    "completeBatchExperiment(incompleteActive, incompleteCompleteMessage)",
    context
  ),
  /received 1 of 2 transcript segments/
);

console.log("Batch lifecycle tests passed");

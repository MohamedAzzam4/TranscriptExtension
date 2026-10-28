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
      getManifest() {
        return { version: "0.9.4" };
      },
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      async getContexts() {
        return [{ contextType: "OFFSCREEN_DOCUMENT" }];
      },
      connectNative() {
        return {
          postMessage(message) {
            nativeMessages.push(structuredClone(message));
          },
          onMessage: listener,
          onDisconnect: listener
        };
      },
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

const injectionResult = await vm.runInContext("ensureContentScripts(7)", context);
assert.deepEqual(Array.from(injectionResult.frameIds), [0, 3]);
assert.equal(scriptInjections.length, 3);
assert.equal(scriptInjections[0].world, "MAIN");
assert.deepEqual(scriptInjections[0].files, ["media-observer-main.js"]);
assert.equal(scriptInjections[1].world, "ISOLATED");
assert.deepEqual(scriptInjections[1].files, ["media-observer-bridge.js"]);
assert.deepEqual(
  scriptInjections[2].files,
  [
    "typography.js",
    "learning-features.js",
    "german-pronunciation.js",
    "transcript-groups.js",
    "media-candidate.js",
    "local-media.js",
    "content.js"
  ]
);
assert.ok(scriptInjections.every(({ target }) => target.allFrames));
assert.ok(scriptInjections.every(({ injectImmediately }) => injectImmediately));

// Observer injection alone cannot establish a working player application.
const executeScriptBeforeFailure = context.chrome.scripting.executeScript;
context.chrome.scripting.executeScript = async (injection) => {
  if (injection.files.includes("content.js")) throw new Error("SyntaxError: missing ) after argument list");
  return [{ frameId: 0 }, { frameId: 3 }];
};
try {
  await assert.rejects(
    vm.runInContext("ensureContentScripts(7)", context),
    /Player script initialization failed: SyntaxError: missing \) after argument list/,
    "show the application injection failure instead of misreporting that no video exists"
  );
} finally {
  context.chrome.scripting.executeScript = executeScriptBeforeFailure;
}

// An unsuccessful new attempt must not display the previous experiment as its result.
local.lastExperimentId = "previous-complete";
local["experiment:previous-complete"] = { pipeline: { status: "complete" } };
context.chrome.tabs.query = async () => [{ id: 7, url: "https://video.example/episode-1" }];
context.chrome.scripting.executeScript = async (injection) => {
  if (injection.files.includes("content.js")) throw new Error("SyntaxError: missing ) after argument list");
  return [{ frameId: 0 }, { frameId: 3 }];
};
try {
  await assert.rejects(
    vm.runInContext('startSmartExperiment({ serverUrl: "ws://127.0.0.1:8000/asr" })', context),
    /Player script initialization failed/
  );
} finally {
  context.chrome.scripting.executeScript = executeScriptBeforeFailure;
  delete context.chrome.tabs.query;
}
assert.match(session.lastMediaPreparationFailure.message, /missing \)/, "persist the failed attempt separately from the previous experiment");
const preparationDiagnostics = await vm.runInContext("getVisibleDiagnostics()", context);
assert.equal(preparationDiagnostics.diagnostics.level, "error");
assert.equal(preparationDiagnostics.diagnostics.stage, "Player preparation failed");
assert.match(preparationDiagnostics.diagnostics.message, /initialization failed/);
assert.equal(local["experiment:previous-complete"].pipeline.status, "complete", "do not rewrite the saved experiment to record a preparation failure");
delete session.lastMediaPreparationFailure;
delete local.lastExperimentId;
delete local["experiment:previous-complete"];

const sendMessageBeforeInspection = context.chrome.tabs.sendMessage;
context.chrome.tabs.sendMessage = async (_tabId, _message, { frameId }) => frameId === 3
  ? { ok: false, error: "Browser pronunciation helpers were not loaded." }
  : { ok: false, context: null };
try {
  await assert.rejects(
    vm.runInContext("findMediaTarget(7, [0, 3])", context),
    /Player inspection failed: frame 3: Browser pronunciation helpers were not loaded/,
    "an inspection exception must not be reported as an absent video"
  );
  context.chrome.tabs.sendMessage = async (_tabId, _message, { frameId }) => {
    if (frameId === 3) return { ok: true, context: { width: 1280, height: 720, paused: true, readyState: 4 } };
    throw new Error("The unrelated frame has no listener.");
  };
  const usableFrame = await vm.runInContext("findMediaTarget(7, [0, 3])", context);
  assert.equal(usableFrame.frameId, 3, "a valid player wins over failures in unrelated frames");
  context.chrome.tabs.sendMessage = async () => { throw new Error("Frame navigated: https://media.example/watch?token=private-test-token"); };
  await assert.rejects(vm.runInContext("findMediaTarget(7, [3])", context), (error) => {
    assert.match(error.message, /Player inspection failed: frame 3: Frame navigated/);
    assert.doesNotMatch(error.message, /private-test-token/);
    return true;
  });
  context.chrome.tabs.sendMessage = async () => ({ ok: false, context: null });
  assert.equal(await vm.runInContext("findMediaTarget(7, [0, 3])", context), null,
    "a real empty frame remains distinct from an inspection failure");
} finally {
  context.chrome.tabs.sendMessage = sendMessageBeforeInspection;
}

context.genericMediaContext = {
  batchCandidates: [{
    url: "https://media.example/opaque?token=temporary",
    kind: "hls",
    source: "webrequest-observer",
    frameId: 3,
    requestType: "xmlhttprequest",
    headers: {
      referer: "https://playmogo.com/e/test",
      origin: "https://playmogo.com",
      "accept-language": "de-DE,de;q=0.9",
      cookie: "must-not-survive",
      authorization: "must-not-survive"
    }
  }],
  discoveryDiagnostics: {
    observer: {
      bridgeVersion: 8,
      mainWorldVersion: 8,
      ready: true
    }
  }
};
context.genericTab = {
  url: "https://aniworld.to/anime/test",
  title: "Embedded player test"
};
const genericCandidate = vm.runInContext(
  "chooseBatchCandidate(genericTab, genericMediaContext, 'de')",
  context
);
assert.equal(genericCandidate.supported, true, JSON.stringify(genericCandidate));
assert.equal(genericCandidate.sourceKind, "direct");
assert.equal(genericCandidate.sourceCandidates[0].kind, "hls");
assert.equal(
  genericCandidate.sourceCandidates[0].headers.referer,
  "https://playmogo.com/e/test"
);
assert.equal(
  genericCandidate.sourceCandidates[0].headers.origin,
  "https://playmogo.com"
);
assert.equal(genericCandidate.sourceCandidates[0].headers.cookie, undefined);
assert.equal(genericCandidate.sourceCandidates[0].headers.authorization, undefined);
assert.equal(genericCandidate.discoveryDiagnostics.observer.ready, true);

context.localMediaContext = {
  frameUrl: "http://127.0.0.1:8050/player.html",
  duration: 90,
  currentTime: 0,
  playbackRate: 1,
  sourceKind: "http",
  batchCandidates: [{
    url: "http://127.0.0.1:8050/example.mp4",
    kind: "media",
    source: "current-src",
    contentType: "video/mp4"
  }]
};
context.localMediaTab = {
  id: 9,
  url: "http://127.0.0.1:8050/player.html",
  title: "Local video"
};
const localCandidate = vm.runInContext(
  "chooseBatchCandidate(localMediaTab, localMediaContext, 'de')",
  context
);
assert.equal(localCandidate.supported, true, JSON.stringify(localCandidate));
assert.equal(localCandidate.loopbackMediaOrigin, "http://127.0.0.1:8050");
context.localCandidate = structuredClone(localCandidate);

context.publicTabWithLoopbackCandidate = {
  url: "https://media.example/player.html",
  title: "Untrusted remote page"
};
const publicLoopbackCandidate = vm.runInContext(
  "chooseBatchCandidate(publicTabWithLoopbackCandidate, localMediaContext, 'de')",
  context
);
assert.equal("loopbackMediaOrigin" in publicLoopbackCandidate, false);

context.localPrepared = {
  tab: context.localMediaTab,
  mediaTarget: { frameId: 0, context: context.localMediaContext }
};
context.localSettings = {
  serverUrl: "ws://127.0.0.1:8000/asr",
  audioLanguage: "de",
  captionLanguage: "de",
  collectCaptions: false,
  syncOffset: 0,
  captionPreferences: {},
  translationPreferences: {},
  batchModel: "small"
};
const localStart = await vm.runInContext(
  "startBatchExperiment(localSettings, localPrepared, localCandidate)",
  context
);
assert.equal(localStart.mode, "batch");
assert.equal(nativeMessages.at(-1).loopbackMediaOrigin, "http://127.0.0.1:8050");
nativeMessages.pop();

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
    state: "batch_worker_info",
    jobId: "batch-job",
    workerVersion: "0.9.4",
    pythonVersion: "3.12.10",
    pyavVersion: "18.0.0",
    libavcodecVersion: "62.28.102"
  });
  handleNativeHostMessage({
    state: "batch_candidate_attempt",
    jobId: "batch-job",
    attempt: 1,
    candidateCount: 2,
    sourceHost: "first.nflxvideo.net",
    sourceKind: "netflix-audio",
    languageHint: "deu",
    profileHint: "xhe-aac-dash"
  });
  handleNativeHostMessage({
    state: "batch_candidate_probe",
    jobId: "batch-job",
    attempt: 1,
    candidateCount: 2,
    sourceHost: "first.nflxvideo.net",
    sourceKind: "netflix-audio",
    codec: "aac",
    profile: "xHE-AAC",
    sampleRate: 48000,
    channels: 2
  });
  handleNativeHostMessage({
    state: "batch_candidate_failed",
    jobId: "batch-job",
    attempt: 1,
    candidateCount: 2,
    sourceHost: "first.nflxvideo.net",
    sourceKind: "netflix-audio",
    category: "decoder-unsupported",
    message: "https://first.nflxvideo.net/?token=secret could not decode xHE-AAC"
  });
  handleNativeHostMessage({
    state: "batch_candidate_attempt",
    jobId: "batch-job",
    attempt: 2,
    candidateCount: 2,
    sourceHost: "second.nflxvideo.net",
    sourceKind: "netflix-audio",
    languageHint: "deu",
    profileHint: "heaac-2-dash"
  });
  handleNativeHostMessage({
    state: "batch_candidate_playlist",
    jobId: "batch-job",
    attempt: 2,
    candidateCount: 2,
    sourceHost: "second.nflxvideo.net",
    sourceKind: "netflix-audio",
    playlistType: "master",
    audioRenditionCount: 2,
    variantCount: 3,
    mediaSegmentCount: 0,
    selectedAudioRendition: true,
    selectedChildHost: "audio.nflxvideo.net"
  });
  handleNativeHostMessage({
    state: "batch_candidate_wrapper",
    jobId: "batch-job",
    attempt: 2,
    candidateCount: 2,
    sourceHost: "second.nflxvideo.net",
    sourceKind: "netflix-audio",
    wrapperKind: "png-appended-mpegts",
    segmentCount: 290
  });
  handleNativeHostMessage({
    state: "batch_candidate_probe",
    jobId: "batch-job",
    attempt: 2,
    candidateCount: 2,
    sourceHost: "second.nflxvideo.net",
    sourceKind: "netflix-audio",
    codec: "aac",
    profile: "HE-AAC",
    sampleRate: 48000,
    channels: 2
  });
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
    title: "Test video",
    sourceKind: "netflix-audio",
    sourceHost: "second.nflxvideo.net"
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
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.worker.workerVersion, "0.9.4");
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.attempts.length, 2);
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.attempts[0].profile, "xHE-AAC");
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.attempts[0].failureCategory, "decoder-unsupported");
assert.doesNotMatch(
  local["experiment:batch-experiment"].pipeline.diagnostics.attempts[0].failureMessage,
  /token=secret/
);
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.attempts[1].phase, "succeeded");
assert.equal(
  local["experiment:batch-experiment"].pipeline.diagnostics.attempts[1].playlistType,
  "master"
);
assert.equal(
  local["experiment:batch-experiment"].pipeline.diagnostics.attempts[1].audioRenditionCount,
  2
);
assert.equal(
  local["experiment:batch-experiment"].pipeline.diagnostics.attempts[1].wrapperKind,
  "png-appended-mpegts"
);
assert.equal(
  local["experiment:batch-experiment"].pipeline.diagnostics.attempts[1].wrappedSegmentCount,
  290
);
assert.equal(local["experiment:batch-experiment"].pipeline.diagnostics.selectedAttempt, 2);
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
assert.equal(
  vm.runInContext(
    `redactTechnicalPageUrl("https://www.netflix.com/watch/81304576?trackId=secret#fragment")`,
    context
  ),
  "https://www.netflix.com/watch/81304576?query=redacted"
);
local["experiment:batch-experiment"].pipeline.fallbackReason =
  "candidate failed at https://media.example/master.m3u8?token=must-not-export";
local.lastExperimentId = "batch-experiment";
const technicalExport = await vm.runInContext("exportLastExperiment()", context);
assert.doesNotMatch(
  JSON.stringify(technicalExport.experiment.pipeline),
  /must-not-export|master\.m3u8/
);
assert.match(
  technicalExport.experiment.pipeline.fallbackReason,
  /https:\/\/media\.example\/\[redacted\]/
);

context.unsafeExperiment = structuredClone(local["experiment:batch-experiment"]);
context.unsafeExperiment.id = "unsafe-diagnostic";
context.unsafeExperiment.pipeline.fallbackReason =
  "native failure https://cdn.example/audio.m3u8?signature=must-not-persist";
await vm.runInContext("saveExperiment(unsafeExperiment)", context);
assert.doesNotMatch(
  local["experiment:unsafe-diagnostic"].pipeline.fallbackReason,
  /must-not-persist|audio\.m3u8/
);
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

local.savedVocabulary = [{ word: "Haus", englishDefinition: "house", englishSourceUrl: "https://en.wiktionary.org/wiki/Haus", context: "Historical context" }];
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
assert.equal(savedWords.entries[0].englishDefinition, undefined, "active normalized records exclude legacy English evidence");
assert.equal(local.savedVocabulary[0].englishDefinition, "house", "raw legacy fields remain preserved in storage");
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
assert.equal(translated.provider, "google-cloud-fallback");
assert.ok(Object.keys(local).some((key) => key.startsWith("translation:v2:de:en:browser-then-google:")));
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
const canonicalBeforeReplay = JSON.stringify(local[libraryKey]);
const originalSourceKey = `experiment:${local[libraryKey].sourceExperimentId}`;
const originalBeforeReplay = JSON.stringify(local[originalSourceKey]);
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
assert.equal(local[`experiment:${restored.experimentId}`].asrSegments.length, 0,
  "cached replay must not persist another complete transcript");
assert.equal(local[`experiment:${restored.experimentId}`].transcriptReference.libraryKey, libraryKey);
context.restoredExperimentId = restored.experimentId;
const hydratedReplay = await vm.runInContext("getExperiment(restoredExperimentId)", context);
assert.equal(hydratedReplay.asrSegments.length, 250, "runtime reads still expose the complete cached transcript");
assert.ok(tabMessages.some(({ tabId, message }) => (
  tabId === 8 && message.type === "BEGIN_SESSION" && message.segments.length === 250
)));

const hydratedBeforeMetadata = JSON.stringify(hydratedReplay.asrSegments);
const replayTextExport = await vm.runInContext("exportLastTranscriptText()", context);
assert.match(replayTextExport.text, /\[00:00\] Erster Teil 0\./);
const replayTechnicalExport = await vm.runInContext("exportLastExperiment()", context);
assert.equal(replayTechnicalExport.experiment.asrSegments.length, 250,
  "technical exports hydrate referenced cues instead of exporting an empty transcript");
await vm.runInContext("setSyncOffset(0.3)", context);
await vm.runInContext("updateDisplaySettings({ captionPreferences: { fontSize: 32 }, translationPreferences: {} })", context);
assert.equal(local[`experiment:${restored.experimentId}`].asrSegments.length, 0,
  "saving playback preferences must not re-persist hydrated transcript segments");
assert.equal(local[`experiment:${restored.experimentId}`].settings.syncOffset, 0.3);
await vm.runInContext("stopExperiment()", context);
assert.equal(local[`experiment:${restored.experimentId}`].asrSegments.length, 0,
  "stopping cached replay must retain reference-only storage");
const replayRecordIds = [restored.experimentId];
for (let repeat = 0; repeat < 3; repeat += 1) {
  const replay = await vm.runInContext("startLibraryExperiment(savedLibrarySettings, savedLibraryPrepared, savedLibraryRecord)", context);
  replayRecordIds.push(replay.experimentId);
  await vm.runInContext("stopExperiment()", context);
}
for (const id of replayRecordIds) {
  const record = local[`experiment:${id}`];
  assert.equal(record.asrSegments.length, 0);
  assert.equal(record.transcriptReference.libraryKey, libraryKey);
  assert.ok(JSON.stringify(record).length < canonicalBeforeReplay.length / 4,
    "replay history growth is metadata-sized rather than transcript-sized");
}
assert.equal(JSON.stringify(local[libraryKey]), canonicalBeforeReplay,
  "cached replay does not rewrite its canonical transcript");
assert.equal(JSON.stringify(local[originalSourceKey]), originalBeforeReplay,
  "cached replay does not mutate the original analysis record");

// A fresh worker must resolve persisted references without relying on a RAM cache.
let restartedContext;
restartedContext = vm.createContext({
  console, URL, URLSearchParams, crypto: globalThis.crypto, setTimeout, clearTimeout, structuredClone,
  chrome: context.chrome,
  importScripts(...files) {
    for (const file of files) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), restartedContext, { filename: file });
  },
  restoredExperimentId: restored.experimentId
});
vm.runInContext(source, restartedContext, { filename: "service-worker.js" });
const afterWorkerRestart = await vm.runInContext("getExperiment(restoredExperimentId)", restartedContext);
assert.equal(JSON.stringify(afterWorkerRestart.asrSegments), hydratedBeforeMetadata);

const savedIndexBeforeRemoval = structuredClone(local.transcriptLibraryIndex);
await vm.runInContext("removeTranscriptLibraryEntry(libraryKey)", context);
assert.equal(local[libraryKey], undefined);
assert.equal(JSON.stringify((await vm.runInContext("getExperiment(restoredExperimentId)", context)).asrSegments), hydratedBeforeMetadata,
  "library deletion still permits replay/export using the existing original analysis");
local[libraryKey] = structuredClone(context.savedLibraryRecord);
local.transcriptLibraryIndex = savedIndexBeforeRemoval;
local[libraryKey].segments[0].text = "A replacement transcript with the same identity and source ID.";
assert.equal(JSON.stringify((await vm.runInContext("getExperiment(restoredExperimentId)", context)).asrSegments), hydratedBeforeMetadata,
  "changed library content must not replace the transcript of an older replay");
const originalForMissingSource = local[originalSourceKey];
delete local[libraryKey];
delete local[originalSourceKey];
await assert.rejects(vm.runInContext("getExperiment(restoredExperimentId)", context), /no longer available/);
context.hydratedReplayForSave = hydratedReplay;
const metadataBeforeMissingSave = JSON.stringify(local[`experiment:${restored.experimentId}`]);
await assert.rejects(vm.runInContext("saveExperiment(hydratedReplayForSave)", context), /no longer available/);
assert.equal(JSON.stringify(local[`experiment:${restored.experimentId}`]), metadataBeforeMissingSave,
  "a broken reference must not erase or silently replace the stored replay");
local["experiment:circular-replay"] = {
  ...structuredClone(local[`experiment:${restored.experimentId}`]),
  id: "circular-replay",
  transcriptReference: { ...local[`experiment:${restored.experimentId}`].transcriptReference, sourceExperimentId: "circular-replay" }
};
await assert.rejects(vm.runInContext('getExperiment("circular-replay")', context), /circular/);
delete local["experiment:circular-replay"];
local[originalSourceKey] = originalForMissingSource;
local[libraryKey] = structuredClone(context.savedLibraryRecord);
assert.equal(JSON.stringify((await vm.runInContext('getExperiment("batch-experiment")', context)).asrSegments), JSON.stringify(originalForMissingSource.asrSegments),
  "historical inline experiments remain readable without migration");

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

const rawDecoderFailureActive = {
  ...active,
  experimentId: "raw-decoder-failure",
  batchJobId: "raw-decoder-job",
  browserDecodeAttempted: false,
  browserAudioFallback: {
    sourceUrl: "https://audio.nflxvideo.net/?token=secret",
    headers: {},
    durationHint: 120
  }
};
session.activeExperiment = structuredClone(rawDecoderFailureActive);
local["experiment:raw-decoder-failure"] = {
  ...structuredClone(experiment),
  id: "raw-decoder-failure",
  pipeline: {
    mode: "batch",
    status: "decoding",
    diagnostics: {
      extensionVersion: "0.9.4",
      worker: null,
      attempts: [],
      statusHistory: []
    }
  }
};
context.rawDecoderFailure = {
  state: "batch_error",
  jobId: "raw-decoder-job",
  message: "[Errno 1163346256] Not yet implemented in FFmpeg, patches welcome: 'avcodec_send_packet()'"
};
vm.runInContext("handleNativeHostMessage(rawDecoderFailure)", context);
await vm.runInContext("batchNativeMessageQueue", context);
assert.equal(session.activeExperiment.browserDecodeAttempted, true);
assert.equal(session.activeExperiment.mode, "batch-analyzing");
assert.equal(
  local["experiment:raw-decoder-failure"].pipeline.diagnostics.finalError.category,
  "decoder-unsupported"
);
assert.equal(
  local["experiment:raw-decoder-failure"].pipeline.diagnostics.browserDecoder.state,
  "preparing"
);
assert.ok(runtimeMessages.some((message) => (
  message.type === "OFFSCREEN_DECODE_BATCH_AUDIO"
  && message.jobId === "raw-decoder-job"
)));

const browserActive = {
  ...active,
  experimentId: "browser-batch",
  batchJobId: "browser-job",
  browserDecodeAttempted: true,
  browserAudioFallback: { durationHint: 60 }
};
session.activeExperiment = structuredClone(browserActive);
local["experiment:browser-batch"] = {
  ...structuredClone(experiment),
  id: "browser-batch",
  pipeline: {
    mode: "batch",
    status: "browser-decoding",
    diagnostics: { browserDecoder: { state: "decoding" } }
  }
};
context.browserBegin = {
  jobId: "browser-job",
  sampleRate: 16_000,
  channels: 1,
  duration: 60
};
context.browserChunk = {
  jobId: "browser-job",
  data: "AAAAAA=="
};
context.browserFinish = { jobId: "browser-job" };
await vm.runInContext("handleBrowserBatchPcmBegin(browserBegin)", context);
await vm.runInContext("handleBrowserBatchPcmChunk(browserChunk)", context);
await vm.runInContext("handleBrowserBatchPcmFinish(browserFinish)", context);
assert.deepEqual(
  nativeMessages.map((message) => message.command),
  ["browser_pcm_begin", "browser_pcm_chunk", "browser_pcm_finish"]
);
assert.equal(session.activeExperiment.browserAudioFallback, null);

session.activeExperiment = null;
local.lastExperimentId = "raw-decoder-failure";
const visibleDiagnostics = await vm.runInContext("getVisibleDiagnostics()", context);
assert.equal(visibleDiagnostics.diagnostics.level, "warning");
assert.equal(visibleDiagnostics.diagnostics.category, "decoder-unsupported");
assert.match(visibleDiagnostics.diagnostics.message, /audio was found/i);
assert.ok(visibleDiagnostics.diagnostics.details.some((detail) => detail.label === "Versions"));

const storageSetBeforeQuota = context.chrome.storage.local.set;
const storageRemoveBeforeQuota = context.chrome.storage.local.remove;
const manifestBeforeQuota = context.chrome.runtime.getManifest;
const retainedExperiment = structuredClone(local["experiment:raw-decoder-failure"]);
let deletedForQuota = false;
context.chrome.storage.local.set = async () => { throw new Error("Resource::kQuotaBytes quota exceeded"); };
context.chrome.storage.local.remove = async () => { deletedForQuota = true; };
context.quotaExperiment = { id: "quota-test", asrSegments: [{ text: "Saved text", start: 0, end: 1 }] };
try {
  await assert.rejects(vm.runInContext("saveExperiment(quotaExperiment)", context), (error) => {
    assert.equal(error.storageArea, "local");
    assert.match(error.message, /local storage quota.*saving analysis/);
    return true;
  });
  assert.equal(deletedForQuota, false, "quota handling must not delete saved records");
  assert.deepEqual(local["experiment:raw-decoder-failure"], retainedExperiment);
  assert.equal(local["experiment:quota-test"], undefined, "do not claim a failed analysis save succeeded");
  const failureDiagnostics = await vm.runInContext("getVisibleDiagnostics()", context);
  assert.equal(failureDiagnostics.diagnostics.stage, "Analysis storage failed");
  context.chrome.storage.local.getBytesInUse = async () => 11 * 1_048_576;
  context.chrome.runtime.getManifest = () => ({ version: "0.11.0", permissions: ["storage", "unlimitedStorage"] });
  const capacity = await vm.runInContext("getLocalStorageDiagnostic()", context);
  assert.match(capacity.value, /11\.00 MiB.*standard local quota lifted/);
} finally {
  context.chrome.storage.local.set = storageSetBeforeQuota;
  context.chrome.storage.local.remove = storageRemoveBeforeQuota;
  context.chrome.runtime.getManifest = manifestBeforeQuota;
  delete context.chrome.storage.local.getBytesInUse;
  delete session.lastMediaPreparationFailure;
}

console.log("Batch lifecycle tests passed");

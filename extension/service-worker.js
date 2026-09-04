importScripts(
  "learning-features.js",
  "netflix-research.js",
  "network-media-observer.js",
  "local-media.js"
);

const ACTIVE_KEY = "activeExperiment";
const LAST_KEY = "lastExperimentId";
const SETTINGS_KEY = "experimentSettings";
const EXPERIMENT_PREFIX = "experiment:";
const DEFINITION_PREFIX = "definition:v3:de-en:";
const VOCABULARY_KEY = "savedVocabulary";
const TRANSLATION_SECRETS_KEY = "translationSecrets";
const TRANSCRIPT_LIBRARY_INDEX_KEY = "transcriptLibraryIndex";
const TRANSCRIPT_LIBRARY_LIMIT = 20;
const TRANSCRIPT_LIBRARY_BYTES_LIMIT = 7_500_000;
const NETFLIX_RESEARCH_INDEX_KEY = "netflixResearchIndex:v1";
const NETFLIX_RESEARCH_LAST_KEY = "lastNetflixResearchId";
const NETFLIX_RESEARCH_LIMIT = 60;
const NATIVE_HOST_NAME = "com.dub_transcript_lab.recognizer";
const learning = globalThis.DubTranscriptLearning;
const netflixResearch = globalThis.DubTranscriptNetflixResearch;
const networkMedia = globalThis.DubTranscriptNetworkMedia;
const localMedia = globalThis.DubTranscriptLocalMedia;
const networkMediaStore = networkMedia.createStore();
const networkMediaObserverAvailable = networkMedia.attachChromeObserver(chrome, networkMediaStore);
const mediaClocks = new Map();
const runtimeSampleTimes = new Map();
const audioCoverageRanges = new Map();
const audioCoverageSaveTimes = new Map();
let nativeHostPort = null;
let nativeHostWaiter = null;
let batchNativeMessageQueue = Promise.resolve();
const pendingCaptionDiscoveryJobs = new Map();

const YOUTUBE_CAPTION_TRACKS = new Map();

function extractYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1).split(/[?#]/)[0];
    }
    if (parsed.hostname.endsWith("youtube.com")) {
      return parsed.searchParams.get("v") || parsed.pathname.match(/^\/(?:shorts|embed|watch)\/([^/?#]+)/)?.[1] || null;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryFetchYouTubeAutomaticCaptions(pageUrl, audioLanguage, videoDuration) {
  const videoId = extractYouTubeVideoId(pageUrl);
  if (!videoId) return { ok: false, reason: "Could not extract YouTube video ID", diagnostics: {} };
  const jobId = `caption-discovery-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const request = { jobId, sourceUrl: pageUrl, language: audioLanguage, captionLanguage: audioLanguage };
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const pending = pendingCaptionDiscoveryJobs.get(jobId);
      if (pending) {
        pendingCaptionDiscoveryJobs.delete(jobId);
        reject(new Error("Caption discovery timed out"));
      }
    }, 30000);
    pendingCaptionDiscoveryJobs.set(jobId, {
      resolve: (value) => { clearTimeout(timeoutId); pendingCaptionDiscoveryJobs.delete(jobId); resolve(value); },
      reject: (err) => { clearTimeout(timeoutId); pendingCaptionDiscoveryJobs.delete(jobId); reject(err); },
      timeoutId
    });
    try {
      const port = ensureNativeHostPort();
      port.postMessage({ command: "youtube_caption_discovery", ...request });
    } catch (error) {
      const pending = pendingCaptionDiscoveryJobs.get(jobId);
      if (pending) { clearTimeout(pending.timeoutId); pendingCaptionDiscoveryJobs.delete(jobId); }
      reject(error);
    }
  }).then(async (raw) => {
    if (!raw || raw.ok === false) {
      return { ok: false, reason: raw?.reason || raw?.message || "Caption discovery failed", diagnostics: raw?.diagnostics || {} };
    }
    if (!raw.segments || !raw.segments.length) {
      return { ok: false, reason: raw.reason || "No valid caption segments returned", diagnostics: raw.diagnostics || {} };
    }
    return { ok: true, segments: raw.segments, language: raw.language, trackInfo: raw.trackInfo, videoDuration: raw.videoDuration, diagnostics: raw.diagnostics || {} };
  }).catch((error) => {
    const msg = String(error?.message || error || "Caption discovery failed");
    if (msg.toLowerCase().includes("unknown native host command") || msg.toLowerCase().includes("unknown command")) {
      return { ok: false, reason: "The local helper is outdated. Close the browser, run INSTALL.cmd once, then reload the extension.", diagnostics: { outdatedHelper: true } };
    }
    return { ok: false, reason: msg, diagnostics: {} };
  });
}

function selectEligibleYouTubeAutomaticCaption(tracks, requestedLanguage) {
  const targetBase = String(requestedLanguage || "").toLowerCase().split("-")[0];
  if (!targetBase) return null;
  const eligible = tracks.filter((track) => {
    const trackLangBase = String(track.languageCode || "").toLowerCase().split("-")[0];
    if (trackLangBase !== targetBase) return false;
    const vssId = track.vssId || "";
    if (vssId.includes("tlang=")) return false;
    return true;
  });
  if (!eligible.length) return null;
  const origTrack = eligible.find((track) => track.vssId?.endsWith("-orig"));
  if (origTrack) return origTrack;
  return eligible[0];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  networkMediaStore.clearTab(tabId);
  void stopIfActiveTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    networkMediaStore.clearTab(tabId);
    void stopIfActiveTab(tabId);
  }
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "START_EXPERIMENT":
      return startSmartExperiment(message.settings);
    case "STOP_EXPERIMENT":
      await stopExperiment();
      return {};
    case "EXPORT_LAST_EXPERIMENT":
      return exportLastExperiment();
    case "EXPORT_LAST_TRANSCRIPT_TEXT":
      return exportLastTranscriptText();
    case "GET_TRANSCRIPT_LIBRARY":
      return getTranscriptLibrary();
    case "GET_VISIBLE_DIAGNOSTICS":
      return getVisibleDiagnostics();
    case "ANALYZE_NETFLIX_TITLE":
      return analyzeNetflixTitle(message.audioLanguage);
    case "GET_NETFLIX_RESEARCH_STATE":
      return getNetflixResearchState();
    case "ATTACH_NETFLIX_SUBTITLE_SAMPLE":
      return attachNetflixSubtitleSample();
    case "EXPORT_LAST_NETFLIX_RESEARCH":
      return exportLastNetflixResearch();
    case "EXPORT_NETFLIX_RESEARCH_DATASET":
      return exportNetflixResearchDataset();
    case "EXPORT_LIBRARY_TRANSCRIPT_TEXT":
      return exportLibraryTranscriptText(message.key);
    case "REMOVE_TRANSCRIPT_LIBRARY_ENTRY":
      return removeTranscriptLibraryEntry(message.key);
    case "PING_CONTENT":
      return {};
    case "CAPTION_SEGMENT":
      await appendCaption(sender.tab?.id, sender.frameId, message.segment);
      return {};
    case "MEDIA_EVENT":
      await handleMediaEvent(sender.tab?.id, sender.frameId, message.event);
      return {};
    case "MEDIA_CLOCK":
      await handleMediaClock(
        sender.tab?.id,
        sender.frameId,
        message.currentTime,
        message.playbackRate
      );
      return {};
    case "LOOKUP_WORD":
      return lookupBilingualWord(message.word);
    case "SAVE_WORD":
      return saveVocabularyWord(message.entry);
    case "REMOVE_SAVED_WORD":
      return removeSavedWord(message.word);
    case "GET_SAVED_WORDS":
      return getSavedWords();
    case "TRANSLATE_TEXT":
      return translateText(message);
    case "UPDATE_DISPLAY_SETTINGS":
      return updateDisplaySettings(message);
    case "SET_SYNC_OFFSET":
      return setSyncOffset(message.offset);
    case "OFFSCREEN_TRANSCRIPT":
      await replaceEpochTranscript(message);
      return {};
    case "OFFSCREEN_EPOCH_ANCHORED":
      await anchorEpoch(message);
      return {};
    case "OFFSCREEN_AUDIO_COVERAGE":
      await appendAudioCoverage(message);
      return {};
    case "OFFSCREEN_READY":
      await handleRecognizerReady();
      return {};
    case "OFFSCREEN_STATUS":
      await broadcastStatus(message.status, message.error);
      return {};
    case "BROWSER_BATCH_PROGRESS":
      await handleBrowserBatchProgress(message);
      return {};
    case "BROWSER_BATCH_PCM_BEGIN":
      await handleBrowserBatchPcmBegin(message);
      return {};
    case "BROWSER_BATCH_PCM_CHUNK":
      await handleBrowserBatchPcmChunk(message);
      return {};
    case "BROWSER_BATCH_PCM_FINISH":
      await handleBrowserBatchPcmFinish(message);
      return {};
    case "BROWSER_BATCH_PCM_ABORT":
      await handleBrowserBatchPcmAbort(message);
      return {};
    case "BROWSER_BATCH_ERROR":
      await handleBrowserBatchError(message);
      return {};
    default:
      return {};
  }
}

async function startSmartExperiment(settings) {
  settings = normalizeRuntimeSettings(settings);
  validateSettings(settings);
  const existing = await getActive();
  if (existing) await stopExperiment();

  const prepared = await prepareMediaTarget();
  const context = prepared.mediaTarget.context;
  const isYouTube = identifyPlatform(prepared.tab.url) === "youtube";
  const youtubeTranscriptSource = settings.youtubeTranscriptSource;

  let candidate = chooseBatchCandidate(prepared.tab, context, settings.audioLanguage);

  if (isYouTube && youtubeTranscriptSource === "youtube-auto-first" && candidate.supported) {
    const captionResult = await tryFetchYouTubeAutomaticCaptions(prepared.tab.url, settings.audioLanguage, context.duration);
    if (captionResult.ok) {
      candidate = {
        ...candidate,
        supported: true,
        sourceKind: "youtube-caption-reuse",
        captionTracks: captionResult.segments,
        captionLanguage: captionResult.language,
        captionTrackInfo: captionResult.trackInfo,
        fallbackReason: null,
        youtubeCaptionAttempt: { attempted: true, result: "succeeded", track: captionResult.trackInfo }
      };
    } else {
      candidate.youtubeCaptionAttempt = {
        attempted: true,
        result: "failed",
        reason: captionResult.reason || "No eligible original automatic caption track found",
        diagnostics: captionResult.diagnostics || {}
      };
      // After failed caption discovery, optionally look for ASR cache before running batch
      const fallbackAsrCache = await getStoredTranscript(identity, "local-asr");
      if (fallbackAsrCache && isStoredTranscriptCompatible(fallbackAsrCache, context)) {
        // Preserve caption failure diagnostics for pipeline
        const asrCandidateWithDiagnostics = { ...candidate, youtubeCaptionAttempt: candidate.youtubeCaptionAttempt };
        // Save fallback diagnostics to be used in startBatchExperiment's pipeline
        candidate.fallbackAsrCache = fallbackAsrCache;
      }
    }
  }
  // If we have a fallback ASR cache and youtube-auto-first failed, restore it instead of batch
  if (candidate.fallbackAsrCache && isStoredTranscriptCompatible(candidate.fallbackAsrCache, context)) {
    return startLibraryExperiment(settings, prepared, candidate.fallbackAsrCache);
  }

  const identity = transcriptIdentityForCandidate(
    prepared.tab.url,
    settings.audioLanguage,
    candidate
  );
  const savedTranscript = await getStoredTranscript(identity, settings.youtubeTranscriptSource);
  if (savedTranscript && isStoredTranscriptCompatible(savedTranscript, context)) {
    return startLibraryExperiment(settings, prepared, savedTranscript);
  }
  if (candidate.supported) {
    if (candidate.sourceKind === "youtube-caption-reuse") {
      return startCaptionReuseExperiment(settings, prepared, candidate);
    }
    return startBatchExperiment(settings, prepared, candidate);
  }
  return startLiveExperiment(settings, prepared, candidate.reason, candidate);
}

async function startCaptionReuseExperiment(settings, prepared, candidate) {
  const { tab, mediaTarget } = prepared;
  const context = mediaTarget.context;
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const experiment = createExperimentRecord(id, tab, context, settings, {
    requested: "auto",
    mode: "batch",
    status: "complete",
    sourceKind: "youtube-caption-reuse",
    sourceHost: "youtube.com",
    fallbackReason: null,
    transcriptIdentity: transcriptIdentityForCandidate(tab.url, settings.audioLanguage, candidate),
    selectedCaptionTrack: candidate.captionTrackInfo,
    diagnostics: {
      extensionVersion: installedExtensionVersion(),
      worker: null,
      attempts: [],
      statusHistory: [],
      discovery: candidate.discoveryDiagnostics || null
    }
  });
  experiment.captionSegments = candidate.captionTracks;
  experiment.captionsUsedAsInput = true;
  experiment.transcriptSource = {
    kind: "youtube-auto-caption",
    provider: "youtube",
    language: candidate.captionLanguage,
    purpose: "transcript-input",
    timingProvenance: "platform-cue",
    track: candidate.captionTrackInfo,
    model: null,
    device: null
  };
  const duration = Math.max(
    Number(context.duration) || 0,
    candidate.captionTracks.reduce((maximum, segment) => Math.max(maximum, segment.end), 0)
  );
  const range = { start: 0, end: round(duration) };
  experiment.audioCoverage = [];
  experiment.pipeline = {
    ...experiment.pipeline,
    status: "complete",
    progress: 100,
    duration: range.end,
    language: candidate.captionLanguage,
    device: null,
    segmentCount: candidate.captionTracks.length,
    completedAt: new Date().toISOString()
  };
  experiment.finishedAt = new Date().toISOString();
  await trySaveTranscriptToLibrary(experiment);
  await saveExperiment(experiment);
  const active = {
    experimentId: id,
    tabId: tab.id,
    mediaFrameId: mediaTarget.frameId,
    mode: "batch-ready",
    settings,
    syncOffset: normalizeSyncOffset(settings.syncOffset),
    replay: range,
    batchDuration: range.end,
    recognizerReady: true
  };
  await setActive(active);
  await sendToFrame(tab.id, mediaTarget.frameId, {
    type: "BEGIN_SESSION",
    experimentId: id,
    collectCaptions: false,
    syncOffset: active.syncOffset,
    captionPreferences: settings.captionPreferences,
    translationPreferences: settings.translationPreferences,
    audioLanguage: settings.audioLanguage,
    segments: selectedTranscriptSegments(experiment),
    hideNativeYouTubeCaptions: (experiment.transcriptSource?.kind === "youtube-auto-caption")
  });
  await sendToActiveFrame(active, { type: "SET_REPLAY_MODE", enabled: true, range });
  const response = await sendToActiveFrame(active, { type: "CONTROL_MEDIA", action: "play" });
  await broadcastStatus(response?.ok
    ? "Using YouTube automatic transcript. Playback started without local transcription."
    : "Using YouTube automatic transcript. Press play when you are ready.",
  response?.ok ? null : response?.error);
  return { experimentId: id, mode: "youtube-caption-reuse", restored: false };
}

async function startLibraryExperiment(settings, prepared, savedTranscript) {
  const { tab, mediaTarget } = prepared;
  const context = mediaTarget.context;
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const experiment = createExperimentRecord(id, tab, context, settings, {
    requested: "auto",
    mode: "library",
    status: "complete",
    sourceKind: "local-library",
    sourceHost: null,
    fallbackReason: null,
    restoredFrom: savedTranscript.sourceExperimentId || null,
    transcriptIdentity: savedTranscript.identity || null
  });
  const selectedSegments = sanitizeTranscriptSegments(savedTranscript.segments);
  const sourceKind = savedTranscript.transcriptSource?.kind || "legacy-local-asr";
  if (sourceKind === "youtube-auto-caption") {
    experiment.captionSegments = selectedSegments;
    experiment.asrSegments = [];
  } else {
    experiment.asrSegments = selectedSegments;
    experiment.captionSegments = savedTranscript.captionSegments || [];
  }
  experiment.transcriptSource = savedTranscript.transcriptSource || {
    kind: "legacy-local-asr",
    provider: null,
    language: settings.audioLanguage,
    purpose: "transcript-input",
    timingProvenance: "estimated",
    track: null,
    model: null,
    device: null
  };
  const duration = Math.max(
    Number(savedTranscript.duration) || 0,
    Number(context.duration) || 0,
    selectedSegments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0)
  );
  const range = { start: 0, end: round(duration) };
  experiment.audioCoverage = sourceKind === "youtube-auto-caption" ? [] : [range];
  experiment.finishedAt = new Date().toISOString();
  const active = {
    experimentId: id,
    tabId: tab.id,
    mediaFrameId: mediaTarget.frameId,
    mode: "batch-ready",
    settings,
    syncOffset: normalizeSyncOffset(settings.syncOffset),
    replay: range,
    batchDuration: range.end,
    recognizerReady: true
  };

  await saveExperiment(experiment);
  await setActive(active);
  await sendToFrame(tab.id, mediaTarget.frameId, {
    type: "BEGIN_SESSION",
    experimentId: id,
    collectCaptions: false,
    syncOffset: active.syncOffset,
    captionPreferences: settings.captionPreferences,
    translationPreferences: settings.translationPreferences,
    audioLanguage: settings.audioLanguage,
    segments: selectedTranscriptSegments(experiment),
    hideNativeYouTubeCaptions: (experiment.transcriptSource?.kind === "youtube-auto-caption")
  });
  await sendToActiveFrame(active, { type: "SET_REPLAY_MODE", enabled: true, range });
  const response = await sendToActiveFrame(active, { type: "CONTROL_MEDIA", action: "play" });
  await broadcastStatus(response?.ok
    ? "Saved transcript restored locally. Playback started without transcribing again."
    : "Saved transcript restored locally. Press play when you are ready.",
  response?.ok ? null : response?.error);
  return { experimentId: id, mode: "library", restored: true };
}

function isStoredTranscriptCompatible(record, context) {
  if (!Array.isArray(record?.segments) || !record.segments.length) return false;
  const savedDuration = Number(record.duration);
  const currentDuration = Number(context?.duration);
  if (!Number.isFinite(savedDuration) || !Number.isFinite(currentDuration)
    || savedDuration <= 0 || currentDuration <= 0) return true;
  return Math.abs(savedDuration - currentDuration) <= Math.max(3, currentDuration * 0.03);
}

async function prepareMediaTarget() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("http")) {
    throw new Error("Open a normal web video tab before starting the experiment.");
  }
  const injection = await ensureContentScripts(tab.id);
  const mediaTarget = await findMediaTarget(tab.id, injection.frameIds);
  if (!mediaTarget) {
    throw new Error(
      "No accessible HTML video was found in this tab or its player frames. "
      + "Start playback, reload the extension if it requested broader site access, then try again."
    );
  }
  const pauseResponse = await sendToFrame(tab.id, mediaTarget.frameId, {
    type: "CONTROL_MEDIA",
    action: "pause"
  });
  if (!pauseResponse?.ok) {
    throw new Error(pauseResponse?.error || "Could not pause the video while preparing.");
  }
  const networkSnapshot = networkMediaStore.snapshot(
    tab.id,
    mediaTarget.frameId,
    mediaTarget.context.frameUrl
  );
  mediaTarget.context.batchCandidates = mergeMediaCandidateLists(
    mediaTarget.context.batchCandidates,
    networkSnapshot.candidates
  );
  mediaTarget.context.discoveryDiagnostics = {
    observerInjection: injection.diagnostics,
    pageObserver: sanitizePageObserverDiagnostics(mediaTarget.context.observerDiagnostics),
    networkObserver: {
      available: networkMediaObserverAvailable,
      ...networkSnapshot.diagnostics
    },
    currentSourceKind: diagnosticText(mediaTarget.context.sourceKind, 32) || "unknown"
  };
  return { tab, mediaTarget };
}

async function startBatchExperiment(settings, prepared, candidate) {
  const { tab, mediaTarget } = prepared;
  const context = mediaTarget.context;
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const jobId = crypto.randomUUID();
  const experiment = createExperimentRecord(id, tab, context, settings, {
    requested: "auto",
    mode: "batch",
    status: "queued",
    sourceKind: candidate.sourceKind,
    sourceHost: safeHost(candidate.sourceUrl),
    discoveryKind: candidate.discoveryKind || candidate.sourceKind,
    candidateSummary: summarizeBatchCandidates(candidate),
    transcriptIdentity: transcriptIdentityForCandidate(tab.url, settings.audioLanguage, candidate),
    selectedAudioTrack: summarizeSelectedAudioTrack(candidate),
    diagnostics: {
      extensionVersion: installedExtensionVersion(),
      worker: null,
      attempts: [],
      statusHistory: [],
      discovery: candidate.discoveryDiagnostics || null
    },
    fallbackReason: null,
    youtubeCaptionAttempt: candidate.youtubeCaptionAttempt || null
  });
  // Also persist youtubeCaptionAttempt diagnostics
  if (candidate.youtubeCaptionAttempt) {
    experiment.pipeline.diagnostics.youtubeCaptionAttempt = candidate.youtubeCaptionAttempt;
  }
  experiment.transcriptSource = {
    kind: "local-whisper-batch",
    provider: "faster-whisper",
    language: settings.audioLanguage,
    purpose: "recognized-audio",
    timingProvenance: "exact",
    track: null,
    model: settings.batchModel || "small",
    device: null
  };
  const active = {
    experimentId: id,
    tabId: tab.id,
    mediaFrameId: mediaTarget.frameId,
    mode: "batch-analyzing",
    batchJobId: jobId,
    browserAudioFallback: candidate.discoveryKind === "netflix-audio" ? {
      sourceUrl: candidate.sourceUrl,
      sourceCandidates: candidate.sourceCandidates,
      headers: candidate.headers,
      durationHint: Number(context.duration) || null
    } : null,
    browserDecodeAttempted: false,
    settings,
    syncOffset: normalizeSyncOffset(settings.syncOffset),
    replay: null,
    recognizerReady: false
  };

  await saveExperiment(experiment);
  await setActive(active);
await sendToFrame(tab.id, mediaTarget.frameId, {
    type: "BEGIN_SESSION",
    experimentId: id,
    collectCaptions: false,
    syncOffset: active.syncOffset,
    captionPreferences: settings.captionPreferences,
    translationPreferences: settings.translationPreferences,
    audioLanguage: settings.audioLanguage,
    segments: selectedTranscriptSegments(experiment),
    hideNativeYouTubeCaptions: true
  });

  try {
    ensureNativeHostPort().postMessage({
      command: "batch_transcribe",
      jobId,
      sourceKind: candidate.sourceKind,
      sourceUrl: candidate.sourceUrl,
      sourceCandidates: candidate.sourceCandidates,
      headers: candidate.headers,
      ...(candidate.loopbackMediaOrigin
        ? { loopbackMediaOrigin: candidate.loopbackMediaOrigin }
        : {}),
      durationHint: context.duration,
      language: settings.audioLanguage,
      captionLanguage: settings.captionLanguage,
      collectCaptions: settings.collectCaptions,
      model: settings.batchModel || "small"
    });
  } catch (error) {
    await fallbackBatchToLive(active, `Could not start full-video analysis: ${error.message}`);
    return { experimentId: id, mode: "live-fallback" };
  }

  const sourceStatus = candidate.discoveryKind === "netflix-audio"
    ? "Clear Netflix audio track found. Acquiring and analyzing it locally before playback…"
    : "Full-video source found. Analyzing the audio locally before playback…";
  await broadcastStatus(sourceStatus);
  return { experimentId: id, mode: "batch" };
}

async function startLiveExperiment(settings, prepared, fallbackReason = null, candidate = null) {
  const { tab, mediaTarget } = prepared;
  const safeFallbackReason = diagnosticMessage(fallbackReason);
  await ensureRecognizerRunning(settings.serverUrl);
  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const context = mediaTarget.context;
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const epoch = createEpoch(context.currentTime, context.playbackRate, "start");
  const experiment = createExperimentRecord(id, tab, context, settings, {
    requested: "auto",
    mode: safeFallbackReason ? "live-fallback" : "live",
    status: "running",
    sourceKind: null,
    sourceHost: null,
    discoveryKind: candidate?.discoveryKind || null,
    candidateSummary: candidate?.candidateSummary || [],
    diagnostics: {
      extensionVersion: installedExtensionVersion(),
      worker: null,
      attempts: [],
      statusHistory: [],
      discovery: candidate?.discoveryDiagnostics || null
    },
    fallbackReason: safeFallbackReason
  });
  experiment.transcriptSource = {
    kind: "local-whisper-live",
    provider: "whisperlivekit",
    language: settings.audioLanguage,
    purpose: "recognized-audio",
    timingProvenance: "estimated",
    track: null,
    model: null,
    device: null
  };
  experiment.epochs = [epoch];
  const active = {
    experimentId: id,
    tabId: tab.id,
    mediaFrameId: mediaTarget.frameId,
    mode: "live",
    settings,
    syncOffset: normalizeSyncOffset(settings.syncOffset),
    epoch,
    replay: null,
    recognizerReady: false
  };

  await saveExperiment(experiment);
  await setActive(active);
  audioCoverageRanges.set(id, []);
  audioCoverageSaveTimes.set(id, Date.now());

  await sendToFrame(tab.id, mediaTarget.frameId, {
    type: "BEGIN_SESSION",
    experimentId: id,
    collectCaptions: settings.collectCaptions,
    syncOffset: active.syncOffset,
    captionPreferences: settings.captionPreferences,
    translationPreferences: settings.translationPreferences,
    audioLanguage: settings.audioLanguage,
    segments: [],
    hideNativeYouTubeCaptions: false
  });
  const captureResponse = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START",
    streamId,
    settings,
    epoch,
    playing: false,
    mediaClock: {
      currentTime: context.currentTime,
      playbackRate: context.playbackRate
    }
  });
  if (!captureResponse?.ok) {
    await stopExperiment();
    throw new Error(captureResponse?.error || "Tab capture failed.");
  }
  await broadcastStatus(safeFallbackReason
    ? `Full-video analysis is unavailable (${safeFallbackReason}). Preparing live transcription automatically.`
    : "Preparing recognizer. The video will start automatically when ready.");
  return { experimentId: id, mode: safeFallbackReason ? "live-fallback" : "live" };
}

function selectedTranscriptSegments(experiment) {
  if (!experiment) return [];
  const source = experiment.transcriptSource || {
    kind: "legacy-local-asr",
    provider: null,
    language: experiment.audioLanguage,
    purpose: "transcript-input",
    timingProvenance: "estimated",
    track: null,
    model: null,
    device: null
  };
  if (source.kind === "youtube-auto-caption") {
    return experiment.captionSegments || [];
  }
  return experiment.asrSegments || [];
}

function createExperimentRecord(id, tab, context, settings, pipeline) {
  return {
    schemaVersion: 4,
    id,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    platform: identifyPlatform(tab.url),
    page: {
      title: tab.title || "Untitled video",
      url: tab.url,
      videoIdentity: pipeline.transcriptIdentity
        || learning.stableVideoIdentity(tab.url, settings.audioLanguage),
      playerFrameUrl: context.frameUrl || tab.url,
      duration: context.duration
    },
    audioLanguage: settings.audioLanguage,
    captionLanguage: settings.captionLanguage,
    captionsUsedAsInput: false,
    settings: {
      collectCaptions: settings.collectCaptions,
      serverUrl: settings.serverUrl,
      batchModel: settings.batchModel || "small",
      syncOffset: normalizeSyncOffset(settings.syncOffset),
      captionPreferences: settings.captionPreferences,
      translationPreferences: settings.translationPreferences
    },
    pipeline,
    epochs: [],
    asrSegments: [],
    captionSegments: [],
    evaluation: null,
    audioCoverage: [],
    runtimeSamples: [],
    transcriptSource: {
      kind: "legacy-local-asr",
      provider: null,
      language: settings.audioLanguage,
      purpose: "transcript-input",
      timingProvenance: "estimated",
      track: null,
      model: null,
      device: null
    }
  };
}

function chooseBatchCandidate(tab, context, audioLanguage = "") {
  const discoveryDiagnostics = context.discoveryDiagnostics || null;
  if (identifyPlatform(tab.url) === "youtube") {
    return {
      supported: true,
      sourceKind: "youtube",
      sourceUrl: tab.url,
      headers: {},
      ...(discoveryDiagnostics ? { discoveryDiagnostics } : {})
    };
  }
  let sourceCandidates = rankBatchCandidates(context.batchCandidates, audioLanguage);
  if (context.drmProtected) {
    sourceCandidates = sourceCandidates.filter((candidate) => (
      isValidatedNetflixAudioCandidate(tab, candidate)
    ));
    const requestedLanguage = normalizeMediaLanguageHint(audioLanguage);
    const matchingLanguage = requestedLanguage
      ? sourceCandidates.filter((candidate) => (
        normalizeMediaLanguageHint(candidate.language) === requestedLanguage
      ))
      : [];
    if (requestedLanguage && !matchingLanguage.length) {
      return {
        supported: false,
        reason: `no clear Netflix audio track matched ${requestedLanguage}`,
        candidateSummary: summarizeCandidateValues(sourceCandidates),
        ...(discoveryDiagnostics ? { discoveryDiagnostics } : {})
      };
    }
    if (matchingLanguage.length) sourceCandidates = matchingLanguage;
    if (sourceCandidates[0]?.kind === "netflix-audio") {
      const selectedTrack = sourceCandidates[0];
      sourceCandidates = sourceCandidates.filter((candidate) => (
        isSameNetflixAudioTrack(candidate, selectedTrack)
      ));
    }
    if (!sourceCandidates.length) {
      return {
        supported: false,
        reason: "the player reported encrypted media",
        candidateSummary: [],
        ...(discoveryDiagnostics ? { discoveryDiagnostics } : {})
      };
    }
  }
  if (!sourceCandidates.length) {
    return {
      supported: false,
      reason: context.sourceKind === "blob"
        ? "the player exposes only a blob stream"
        : "no accessible HTTP media source was detected",
      candidateSummary: [],
      ...(discoveryDiagnostics ? { discoveryDiagnostics } : {})
    };
  }
  const headers = networkMedia.cleanReplayHeaders({
    "user-agent": context.userAgent || "",
    "accept-language": context.browserLanguage || "",
    referer: context.frameUrl || context.frameReferrer || tab.url
  });
  try {
    headers.origin = new URL(context.frameUrl || tab.url).origin;
  } catch {
    // Referer and user agent are sufficient when the frame URL is unusual.
  }
  const loopbackMediaOrigin = localMedia.authorizedLoopbackOrigin(tab.url);
  return {
    supported: true,
    sourceKind: "direct",
    discoveryKind: sourceCandidates[0].kind,
    sourceUrl: sourceCandidates[0].url,
    sourceCandidates,
    headers,
    ...(loopbackMediaOrigin ? { loopbackMediaOrigin } : {}),
    ...(discoveryDiagnostics ? { discoveryDiagnostics } : {})
  };
}

function isSameNetflixAudioTrack(candidate, selected) {
  const candidateId = diagnosticText(candidate?.trackId || candidate?.downloadableId, 128);
  const selectedId = diagnosticText(selected?.trackId || selected?.downloadableId, 128);
  if (selectedId) return candidateId === selectedId;
  const candidateRole = String(candidate?.role || "main").toLowerCase();
  const selectedRole = String(selected?.role || "main").toLowerCase();
  return normalizeMediaLanguageHint(candidate?.language || candidate?.languageDescription)
      === normalizeMediaLanguageHint(selected?.language || selected?.languageDescription)
    && candidateRole === selectedRole;
}

function rankBatchCandidates(rawCandidates, audioLanguage = "") {
  const language = normalizeMediaLanguageHint(audioLanguage);
  const unique = new Map();
  for (const [index, rawCandidate] of (rawCandidates || []).entries()) {
    const candidate = typeof rawCandidate === "string"
      ? { url: rawCandidate, source: "legacy", kind: "" }
      : { ...rawCandidate };
    let parsed;
    try {
      parsed = new URL(String(candidate.url || ""));
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) continue;
    parsed.hash = "";
    const url = parsed.href;
    const text = `${url} ${candidate.contentType || ""}`.toLowerCase();
    let kind = String(candidate.kind || "").toLowerCase();
    if (["netflix-audio", "hls", "dash", "audio", "media", "unknown-media"].includes(kind)) {
      // A content-type-aware observer can classify query-only media URLs that
      // have no useful filename extension.
    } else if (/\.m3u8(?:$|[\s?#])|mpegurl/.test(text)) kind = "hls";
    else if (/\.mpd(?:$|[\s?#])|dash\+xml/.test(text)) kind = "dash";
    else if (/\.(?:m4a|mp3|aac|oga|ogg|opus)(?:$|[\s?#])|audio\//.test(text)) kind = "audio";
    else if (/\.(?:mp4|webm|mov|mkv)(?:$|[\s?#])|video\//.test(text)) kind = "media";
    else if (!/(?:videoplayback|manifest|playlist)(?:[/?#=&]|$)/.test(text)) continue;
    else kind = "unknown-media";

    if (/\.(?:vtt|srt|ass|ssa|ttml)(?:$|[?#])|(?:subtitle|caption|timedtext)/.test(text)) continue;
    let score = {
      "netflix-audio": 170,
      hls: 120,
      dash: 115,
      audio: 105,
      media: 80,
      "unknown-media": 60
    }[kind] || 0;
    const source = String(candidate.source || "").toLowerCase();
    if (source === "current-src") score += 25;
    else if (source === "source-element" || source === "media-element") score += 20;
    else if (source.startsWith("xhr") || source.startsWith("fetch")) score += 15;
    else if (source === "performance") score += 5;
    if (/(?:^|[/?&_.=-])audio(?:[/?&_.=-]|$)|(?:^|[/?&_.=-])bestaudio(?:[/?&_.=-]|$)/.test(text)) score += 15;
    const candidateLanguage = normalizeMediaLanguageHint(
      candidate.language || candidate.languageDescription
    );
    if (language && candidateLanguage === language) score += 60;
    else if (language && candidateLanguage) score -= 25;
    else if (language && new RegExp(`(?:^|[/?&_.=-])(?:${language}|deu|ger|german)(?:[/?&_.=-]|$)`, "i").test(text)) score += 10;
    const bitrate = Math.max(0, Number(candidate.bitrate) || 0);
    const codec = String(candidate.codec || "").slice(0, 64);
    const profile = String(candidate.profile || "").slice(0, 96);
    const codecDescription = `${codec} ${profile}`.toLowerCase();
    if (kind === "netflix-audio") {
      if (candidate.selected === true) score += 500;
      if (String(candidate.role || "").toLowerCase() === "audio-description") {
        score += candidate.selected === true ? 40 : -220;
      }
      if (/(?:aac[- _]?lc|mp4a\.40\.2|he[- _]?aac|heaac)/.test(codecDescription)
        && !/(?:xhe|x-he|usac|mp4a\.40\.42)/.test(codecDescription)) score += 35;
      if (/(?:e-?ac-?3|ec-3|ddplus)/.test(codecDescription)) score += 20;
      if (/(?:xhe|x-he|usac|mp4a\.40\.42)/.test(codecDescription)) score -= 80;
      if (/(?:ac-?4|atmos)/.test(codecDescription)) score -= 30;
      if (bitrate) score += Math.min(5, bitrate / 200_000);
    }
    if (/(?:^|[/?&_.=-])(?:ad|ads|advert|promo|trailer)(?:[/?&_.=-]|$)/.test(text)) score -= 80;
    score -= Math.min(index, 30) * 0.01;

    const previous = unique.get(url);
    if (!previous || score > previous.score) {
      const ranked = {
        url,
        kind,
        source: String(candidate.source || "page").slice(0, 64),
        score
      };
      if (candidate.contentType) {
        ranked.contentType = String(candidate.contentType).slice(0, 160);
      }
      const responseStatus = Math.max(0, Number(candidate.statusCode) || 0);
      if (responseStatus >= 100 && responseStatus <= 599) {
        ranked.responseStatus = responseStatus;
      }
      const replayHeaders = networkMedia.cleanReplayHeaders(candidate.headers);
      if (Object.keys(replayHeaders).length) ranked.headers = replayHeaders;
      if (candidate.language) ranked.language = String(candidate.language).slice(0, 64);
      if (candidate.languageDescription) {
        ranked.languageDescription = String(candidate.languageDescription).slice(0, 128);
      }
      if (candidate.trackId) ranked.trackId = String(candidate.trackId).slice(0, 128);
      if (candidate.downloadableId) {
        ranked.downloadableId = String(candidate.downloadableId).slice(0, 128);
      }
      if (kind === "netflix-audio") {
        if (candidate.role) ranked.role = String(candidate.role).slice(0, 32);
        if (typeof candidate.selected === "boolean") ranked.selected = candidate.selected;
      }
      if (codec) ranked.codec = codec;
      if (profile) ranked.profile = profile;
      const channels = Math.max(0, Number(candidate.channels) || 0);
      if (channels) ranked.channels = channels;
      const representationIndex = Math.max(0, Number(candidate.representationIndex) || 0);
      if (representationIndex) ranked.representationIndex = representationIndex;
      if (bitrate) ranked.bitrate = bitrate;
      if (Number.isInteger(candidate.frameId)) ranked.frameId = candidate.frameId;
      if (candidate.requestType) ranked.requestType = String(candidate.requestType).slice(0, 32);
      unique.set(url, ranked);
    }
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ score: _score, ...candidate }) => candidate);
}

function summarizeCandidateValues(values) {
  return (values || []).slice(0, 10).map((value, index) => ({
    index: index + 1,
    sourceHost: safeHost(value.url),
    kind: String(value.kind || "direct").slice(0, 32),
    discoverySource: String(value.source || "").slice(0, 64) || null,
    requestType: String(value.requestType || "").slice(0, 32) || null,
    observedFrameId: Number.isInteger(value.frameId) ? value.frameId : null,
    ...(value.contentType ? {
      contentType: String(value.contentType).slice(0, 160)
    } : {}),
    ...(Math.max(0, Number(value.responseStatus) || 0) ? {
      responseStatus: Math.max(0, Number(value.responseStatus) || 0)
    } : {}),
    replayHeaderNames: Object.keys(networkMedia.cleanReplayHeaders(value.headers)).sort()
  }));
}

function normalizeMediaLanguageHint(value) {
  const raw = String(value || "").trim().toLowerCase();
  const primary = raw.split(/[-_]/)[0].replace(/[^a-z]/g, "");
  const aliases = {
    deu: "de",
    ger: "de",
    german: "de",
    deutsch: "de",
    eng: "en",
    english: "en",
    jpn: "ja",
    japanese: "ja"
  };
  return aliases[primary] || (primary.length >= 2 ? primary.slice(0, 2) : primary);
}

function isValidatedNetflixAudioCandidate(tab, candidate) {
  if (candidate?.kind !== "netflix-audio" || candidate?.source !== "netflix-player-metadata") {
    return false;
  }
  let pageHost;
  let mediaUrl;
  try {
    pageHost = new URL(tab.url).hostname.toLowerCase();
    mediaUrl = new URL(candidate.url);
  } catch {
    return false;
  }
  const isNetflixPage = pageHost === "netflix.com" || pageHost.endsWith(".netflix.com");
  const mediaHost = mediaUrl.hostname.toLowerCase();
  const isNetflixMedia = mediaHost === "nflxvideo.net" || mediaHost.endsWith(".nflxvideo.net");
  return isNetflixPage && mediaUrl.protocol === "https:" && isNetflixMedia;
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function installedExtensionVersion() {
  try {
    return chrome.runtime.getManifest?.().version || null;
  } catch {
    return null;
  }
}

function summarizeBatchCandidates(candidate) {
  const values = candidate.sourceCandidates?.length
    ? candidate.sourceCandidates
    : [{ url: candidate.sourceUrl, kind: candidate.discoveryKind || candidate.sourceKind }];
  return values.slice(0, 10).map((value, index) => ({
    index: index + 1,
    sourceHost: safeHost(value.url),
    kind: String(value.kind || "direct").slice(0, 32),
    discoverySource: String(value.source || "").slice(0, 64) || null,
    language: String(value.language || "").slice(0, 32) || null,
    languageDescription: String(value.languageDescription || "").slice(0, 128) || null,
    trackId: String(value.trackId || "").slice(0, 128) || null,
    downloadableId: String(value.downloadableId || "").slice(0, 128) || null,
    role: String(value.role || "main").slice(0, 32),
    selected: value.selected === true,
    codecHint: String(value.codec || "").slice(0, 64) || null,
    profileHint: String(value.profile || "").slice(0, 96) || null,
    requestType: String(value.requestType || "").slice(0, 32) || null,
    observedFrameId: Number.isInteger(value.frameId) ? value.frameId : null,
    ...(value.contentType ? {
      contentType: String(value.contentType).slice(0, 160)
    } : {}),
    ...(Math.max(0, Number(value.responseStatus) || 0) ? {
      responseStatus: Math.max(0, Number(value.responseStatus) || 0)
    } : {}),
    replayHeaderNames: Object.keys(networkMedia.cleanReplayHeaders(value.headers)).sort(),
    bitrate: Math.max(0, Number(value.bitrate) || 0) || null,
    channels: Math.max(0, Number(value.channels) || 0) || null,
    representationIndex: Math.max(0, Number(value.representationIndex) || 0)
  }));
}

function summarizeSelectedAudioTrack(candidate) {
  const selected = candidate?.sourceCandidates?.[0];
  if (!selected || selected.kind !== "netflix-audio") return null;
  return {
    language: diagnosticText(selected.language, 32),
    label: diagnosticText(selected.languageDescription, 128),
    trackId: diagnosticText(selected.trackId, 128),
    downloadableId: diagnosticText(selected.downloadableId, 128),
    role: diagnosticText(selected.role, 32) || "main",
    selectedByPlayer: selected.selected === true,
    codecHint: diagnosticText(selected.codec, 64),
    profileHint: diagnosticText(selected.profile, 96),
    bitrate: Math.max(0, Number(selected.bitrate) || 0) || null,
    representationIndex: Math.max(0, Number(selected.representationIndex) || 0)
  };
}

function transcriptIdentityForCandidate(rawUrl, audioLanguage, candidate) {
  const base = learning.stableVideoIdentity(rawUrl, audioLanguage);
  if (!base || identifyPlatform(rawUrl) !== "netflix.com") return base;
  const selected = candidate?.sourceCandidates?.[0];
  if (!candidate?.supported || selected?.kind !== "netflix-audio") {
    return `${base}|track:live-unknown`;
  }
  const language = normalizeMediaLanguageHint(selected.language || audioLanguage) || "unknown";
  const role = String(selected.role || "main").toLowerCase() === "audio-description"
    ? "audio-description"
    : "main";
  const stableTrackId = diagnosticText(selected.trackId || selected.downloadableId, 128);
  const trackKey = stableTrackId
    ? stableTrackId.replace(/[^a-z0-9._-]+/gi, "-")
    : `${language}-${role}`;
  return `${base}|track:${trackKey}|role:${role}`;
}

async function ensureRecognizerRunning(serverUrl) {
  const url = new URL(serverUrl);
  if (url.hostname !== "127.0.0.1" || url.port !== "8000") {
    throw new Error("Automatic startup currently requires ws://127.0.0.1:8000/asr.");
  }
  if (nativeHostWaiter) return nativeHostWaiter.promise;

  const port = ensureNativeHostPort();

  let resolveWaiter;
  let rejectWaiter;
  const promise = new Promise((resolve, reject) => {
    resolveWaiter = resolve;
    rejectWaiter = reject;
  });
  const timeout = setTimeout(() => {
    rejectNativeHostWaiter("The local recognizer did not become ready within 10 minutes.");
  }, 10 * 60_000);
  nativeHostWaiter = { promise, resolve: resolveWaiter, reject: rejectWaiter, timeout };

  try {
    port.postMessage({ command: "ensure_running" });
  } catch (error) {
    rejectNativeHostWaiter(error.message);
  }
  return promise;
}

function ensureNativeHostPort() {
  if (!nativeHostPort) {
    nativeHostPort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    nativeHostPort.onMessage.addListener(handleNativeHostMessage);
    nativeHostPort.onDisconnect.addListener(handleNativeHostDisconnect);
  }
  return nativeHostPort;
}

function handleNativeHostMessage(message) {
  if (message?.state?.startsWith("caption_discovery_")) {
    const jobId = message.jobId || message.job_id;
    const pending = jobId ? pendingCaptionDiscoveryJobs.get(jobId) : null;
    if (!pending) return;
    if (message.state === "caption_discovery_queued" || message.state === "caption_discovery_status") {
      return;
    }
    if (message.state === "caption_discovery_complete") {
      pending.resolve(message);
      return;
    }
    if (message.state === "caption_discovery_error") {
      pending.reject(new Error(message.message || message.reason || "Caption discovery failed"));
      return;
    }
    return;
  }
  if (message?.state?.startsWith("batch_")) {
    batchNativeMessageQueue = batchNativeMessageQueue
      .then(() => handleBatchNativeMessage(message))
      .catch(async (error) => {
        console.error("Failed to process an ordered batch message", error);
        await fallbackActiveBatch(`the extension could not assemble the transcript: ${error.message}`);
      });
    return;
  }
  if (message?.state === "starting") {
    void broadcastStatus("Starting the local recognizer automatically…");
    return;
  }
  if (message?.state === "ready") {
    const waiter = nativeHostWaiter;
    nativeHostWaiter = null;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    waiter.resolve();
    return;
  }
  if (message?.state === "error") {
    rejectNativeHostWaiter(message.message || "The native recognizer host reported an error.");
    void fallbackActiveBatch(message.message || "the native batch host reported an error");
  }
}

function handleNativeHostDisconnect() {
  const error = chrome.runtime.lastError?.message
    || "The local recognizer launcher disconnected.";
  nativeHostPort = null;
  rejectNativeHostWaiter(error);
  void fallbackActiveBatch(error);
  for (const [jobId, pending] of pendingCaptionDiscoveryJobs.entries()) {
    try { pending.reject(new Error(error)); } catch {}
  }
  pendingCaptionDiscoveryJobs.clear();
}

function rejectNativeHostWaiter(error) {
  const waiter = nativeHostWaiter;
  nativeHostWaiter = null;
  if (!waiter) return;
  clearTimeout(waiter.timeout);
  waiter.reject(new Error(error));
}

async function handleBatchNativeMessage(message) {
  const active = await getActive();
  if (
    !active
    || active.mode !== "batch-analyzing"
    || active.batchJobId !== message.jobId
  ) return;

  if (message.state === "batch_error" || message.state === "batch_candidate_failed") {
    message = {
      ...message,
      category: batchFailureCategory(message)
    };
  }

  await persistBatchDiagnostic(active, message);

  if (message.state === "batch_queued") {
    await broadcastStatus("Full-video analysis queued locally.");
    return;
  }
  if (message.state === "batch_status") {
    await broadcastStatus(message.message || "Preparing full-video analysis locally.");
    return;
  }
  if (message.state === "batch_started") {
    const experiment = await getExperiment(active.experimentId);
    if (experiment) {
      experiment.pipeline.status = "transcribing";
      experiment.pipeline.duration = Number(message.duration) || experiment.page.duration;
      experiment.pipeline.decodeProgress = 100;
      experiment.pipeline.decodedSeconds = experiment.pipeline.duration;
      experiment.pipeline.title = message.title || null;
      experiment.pipeline.acquisitionKind = message.sourceKind || experiment.pipeline.sourceKind;
      experiment.pipeline.sourceHost = message.sourceHost || experiment.pipeline.sourceHost;
      const attempts = experiment.pipeline.diagnostics?.attempts || [];
      const selectedAttempt = [...attempts].reverse().find((attempt) => (
        !message.sourceHost || attempt.sourceHost === message.sourceHost
      ));
      if (selectedAttempt) {
        selectedAttempt.phase = "succeeded";
        selectedAttempt.firstDecodedAudioPts = message.firstDecodedAudioPts ?? null;
        selectedAttempt.decodedSampleCount = message.decodedSampleCount ?? null;
        selectedAttempt.decodedAudioDuration = message.decodedAudioDuration ?? null;
        experiment.pipeline.diagnostics.selectedAttempt = selectedAttempt.attempt;
      }
      if (
        message.sourceKind === "browser-decoded-xhe-aac"
        && experiment.pipeline.diagnostics?.browserDecoder
      ) {
        experiment.pipeline.diagnostics.browserDecoder.state = "decoded";
      }
      await saveExperiment(experiment);
    }
    await broadcastStatus("Audio decoded. Transcribing the complete video locally…");
    return;
  }
  if (message.state === "batch_download_progress") {
    const percent = Number(message.percent);
    const downloadedBytes = Math.max(0, Number(message.downloadedBytes) || 0);
    const bytesPerSecond = Math.max(0, Number(message.bytesPerSecond) || 0);
    const experiment = await getExperiment(active.experimentId);
    if (experiment) {
      experiment.pipeline.status = "downloading-audio";
      experiment.pipeline.downloadProgress = Number.isFinite(percent) ? percent : null;
      experiment.pipeline.downloadedBytes = downloadedBytes;
      experiment.pipeline.downloadBytesPerSecond = bytesPerSecond || null;
      await saveExperiment(experiment);
    }
    const speed = bytesPerSecond ? ` (${formatTransferRate(bytesPerSecond)})` : "";
    await broadcastStatus(Number.isFinite(percent)
      ? `Downloading the audio locally… ${Math.max(0, Math.min(100, percent))}%${speed}`
      : `Downloading the audio locally… ${formatMegabytes(downloadedBytes)} received${speed}`);
    return;
  }
  if (message.state === "batch_decode_progress") {
    const percent = Number(message.percent);
    const decodedSeconds = Math.max(0, Number(message.decodedSeconds) || 0);
    const experiment = await getExperiment(active.experimentId);
    if (experiment) {
      experiment.pipeline.status = "decoding";
      experiment.pipeline.decodeProgress = Number.isFinite(percent) ? percent : null;
      experiment.pipeline.decodedSeconds = round(decodedSeconds);
      await saveExperiment(experiment);
    }
    await broadcastStatus(Number.isFinite(percent)
      ? `Decoding the full audio locally… ${Math.max(0, Math.min(99, percent))}%`
      : `Decoding the full audio locally… ${formatClock(decodedSeconds)} processed`);
    return;
  }
  if (message.state === "batch_progress") {
    const percent = Math.max(0, Math.min(99, Number(message.percent) || 0));
    const experiment = await getExperiment(active.experimentId);
    if (experiment) {
      experiment.pipeline.status = "transcribing";
      experiment.pipeline.progress = percent;
      await saveExperiment(experiment);
    }
    await broadcastStatus(`Transcribing the complete video locally… ${percent}%`);
    return;
  }
  if (message.state === "batch_segments") {
    const experiment = await getExperiment(active.experimentId);
    if (!experiment) return;
    const byId = new Map(experiment.asrSegments.map((segment) => [segment.id, segment]));
    for (const segment of message.segments || []) byId.set(segment.id, segment);
    experiment.asrSegments = [...byId.values()]
      .sort((a, b) => a.start - b.start || a.end - b.end);
    await saveExperiment(experiment);
    return;
  }
  if (message.state === "batch_captions") {
    const experiment = await getExperiment(active.experimentId);
    if (!experiment) return;
    const byId = new Map(experiment.captionSegments.map((segment) => [segment.id, segment]));
    for (const segment of message.segments || []) byId.set(segment.id, segment);
    experiment.captionSegments = [...byId.values()]
      .sort((a, b) => a.start - b.start || a.end - b.end);
    await saveExperiment(experiment);
    return;
  }
  if (message.state === "batch_complete") {
    await completeBatchExperiment(active, message);
    return;
  }
  if (message.state === "batch_error") {
    if (
      batchFailureCategory(message) === "decoder-unsupported"
      && active.browserAudioFallback
      && !active.browserDecodeAttempted
    ) {
      await startBrowserAudioFallback(active, message);
      return;
    }
    await fallbackBatchToLive(active, message.message || "the media source could not be analyzed");
  }
}

function batchFailureCategory(message = {}) {
  const explicit = diagnosticText(message.category, 64);
  if (explicit) return explicit;
  const detail = String(message.message || "").toLowerCase();
  if (
    detail.includes("not yet implemented in ffmpeg")
    || detail.includes("patches welcome")
    || detail.includes("avcodec_send_packet")
    || detail.includes("aac usac esbr")
    || detail.includes("chrome/windows decoder fallback is required")
    || (/unsupported|cannot decode|could not decode/.test(detail) && /xhe[- ]?aac|esbr/.test(detail))
  ) return "decoder-unsupported";
  return null;
}

async function persistBatchDiagnostic(active, message) {
  const trackedStates = new Set([
    "batch_worker_info",
    "batch_candidate_attempt",
    "batch_candidate_playlist",
    "batch_candidate_wrapper",
    "batch_candidate_probe",
    "batch_candidate_failed",
    "batch_status",
    "batch_error"
  ]);
  if (!trackedStates.has(message.state)) return;
  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;
  experiment.pipeline.diagnostics ||= {
    extensionVersion: installedExtensionVersion(),
    worker: null,
    attempts: [],
    statusHistory: []
  };
  const diagnostics = experiment.pipeline.diagnostics;
  diagnostics.attempts ||= [];
  diagnostics.statusHistory ||= [];

  if (message.state === "batch_worker_info") {
    diagnostics.worker = {
      workerVersion: diagnosticText(message.workerVersion, 32),
      pythonVersion: diagnosticText(message.pythonVersion, 32),
      pyavVersion: diagnosticText(message.pyavVersion, 32),
      libavcodecVersion: diagnosticText(message.libavcodecVersion, 32),
      inspectionError: diagnosticMessage(message.pyavInspectionError)
    };
  } else if (message.state.startsWith("batch_candidate_")) {
    const sourceAttempt = Math.max(1, Number(message.attempt) || 1);
    const sourceKind = diagnosticText(message.sourceKind, 32) || "direct";
    const attemptKey = `${sourceKind}:${sourceAttempt}`;
    let attempt = diagnostics.attempts.find((value) => value.attemptKey === attemptKey);
    if (!attempt) {
      attempt = {
        attempt: diagnostics.attempts.length + 1,
        attemptKey,
        sourceAttempt
      };
      diagnostics.attempts.push(attempt);
    }
    Object.assign(attempt, {
      candidateCount: Math.max(1, Number(message.candidateCount) || 1),
      sourceHost: diagnosticText(message.sourceHost, 255),
      sourceKind
    });
    if (message.state === "batch_candidate_attempt") {
      Object.assign(attempt, {
        phase: "attempting",
        discoverySource: diagnosticText(message.discoverySource, 64),
        languageHint: diagnosticText(message.languageHint, 32),
        codecHint: diagnosticText(message.codecHint, 64),
        profileHint: diagnosticText(message.profileHint, 96),
        bitrate: Math.max(0, Number(message.bitrate) || 0) || null,
        channels: Math.max(0, Number(message.channels) || 0) || null,
        representationIndex: Math.max(0, Number(message.representationIndex) || 0)
      });
    } else if (message.state === "batch_candidate_playlist") {
      Object.assign(attempt, {
        phase: "playlist-inspected",
        playlistType: diagnosticText(message.playlistType, 32),
        audioRenditionCount: Math.max(0, Number(message.audioRenditionCount) || 0),
        availableAudioLanguages: (message.availableAudioLanguages || [])
          .map((value) => diagnosticText(value, 16))
          .filter(Boolean)
          .slice(0, 12),
        variantCount: Math.max(0, Number(message.variantCount) || 0),
        mediaSegmentCount: Math.max(0, Number(message.mediaSegmentCount) || 0),
        selectedAudioRendition: message.selectedAudioRendition === true,
        selectedChildHost: diagnosticText(message.selectedChildHost, 255)
      });
    } else if (message.state === "batch_candidate_wrapper") {
      Object.assign(attempt, {
        phase: "unwrapping",
        wrapperKind: diagnosticText(message.wrapperKind, 64),
        wrappedSegmentCount: Math.max(0, Number(message.segmentCount) || 0)
      });
    } else if (message.state === "batch_candidate_probe") {
      Object.assign(attempt, {
        phase: "decoding",
        containerFormat: diagnosticText(message.containerFormat, 64),
        codec: diagnosticText(message.codec, 64),
        codecLongName: diagnosticText(message.codecLongName, 96),
        profile: diagnosticText(message.profile, 96),
        sampleRate: Math.max(0, Number(message.sampleRate) || 0) || null,
        channels: Math.max(0, Number(message.channels) || 0) || attempt.channels || null,
        layout: diagnosticText(message.layout, 64),
        detectedLanguage: diagnosticText(message.language, 32)
      });
    } else {
      Object.assign(attempt, {
        phase: "failed",
        failureCategory: diagnosticText(message.category, 64),
        failureMessage: diagnosticMessage(message.message)
      });
    }
    diagnostics.attempts.sort((left, right) => left.attempt - right.attempt);
    diagnostics.attempts = diagnostics.attempts.slice(0, 10);
  } else {
    diagnostics.statusHistory.push({
      at: new Date().toISOString(),
      type: message.state === "batch_error" ? "error" : "status",
      category: diagnosticText(message.category, 64),
      message: diagnosticMessage(message.message)
    });
    diagnostics.statusHistory = diagnostics.statusHistory.slice(-30);
    if (message.state === "batch_error") {
      diagnostics.finalError = {
        category: diagnosticText(message.category, 64),
        message: diagnosticMessage(message.message),
        workerVersion: diagnosticText(message.workerVersion, 32)
      };
    }
  }
  await saveExperiment(experiment);
}

function diagnosticText(value, limit) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, limit) || null;
}

function diagnosticMessage(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => {
      const host = safeHost(url);
      return host ? `https://${host}/[redacted]` : "[redacted-url]";
    })
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 800) || null;
}

function sanitizeTechnicalDiagnosticValue(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (typeof value === "string") return diagnosticMessage(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTechnicalDiagnosticValue(item, depth + 1));
  }
  if (typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sanitizeTechnicalDiagnosticValue(item, depth + 1)
  ]));
}

async function startBrowserAudioFallback(active, nativeError) {
  const latest = await getActive();
  if (
    !latest
    || latest.mode !== "batch-analyzing"
    || latest.batchJobId !== active.batchJobId
    || latest.browserDecodeAttempted
  ) return;
  latest.browserDecodeAttempted = true;
  await setActive(latest);

  const experiment = await getExperiment(latest.experimentId);
  if (!experiment) return;
  experiment.pipeline.status = "browser-decoder-preparing";
  experiment.pipeline.diagnostics ||= {};
  experiment.pipeline.diagnostics.browserDecoder = {
    state: "preparing",
    reason: diagnosticMessage(nativeError.message),
    implementation: "Chrome decodeAudioData + MP4Box/WebCodecs"
  };
  await saveExperiment(experiment);
  await broadcastStatus(
    "FFmpeg cannot decode this Netflix xHE-AAC track. Retrying with Chrome’s Windows audio decoder…"
  );

  try {
    await ensureOffscreenDocument();
    const response = await sendToOffscreen({
      type: "OFFSCREEN_DECODE_BATCH_AUDIO",
      jobId: latest.batchJobId,
      sourceUrl: latest.browserAudioFallback.sourceUrl,
      sourceCandidates: latest.browserAudioFallback.sourceCandidates,
      headers: latest.browserAudioFallback.headers,
      referrer: experiment.page.playerFrameUrl || experiment.page.url,
      durationHint: latest.browserAudioFallback.durationHint
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome audio decoding could not start.");
  } catch (error) {
    await handleBrowserBatchError({
      jobId: latest.batchJobId,
      error: error.message
    });
  }
}

async function handleBrowserBatchProgress(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;
  const phase = diagnosticText(message.phase, 48) || "preparing";
  const percent = Number(message.percent);
  const receivedBytes = Math.max(0, Number(message.receivedBytes) || 0);
  const totalBytes = Math.max(0, Number(message.totalBytes) || 0);
  const previousBrowserDecoder = experiment.pipeline.diagnostics?.browserDecoder || {};
  experiment.pipeline.status = `browser-${phase}`;
  experiment.pipeline.diagnostics ||= {};
  experiment.pipeline.diagnostics.browserDecoder = {
    ...(experiment.pipeline.diagnostics.browserDecoder || {}),
    state: phase,
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
    receivedBytes: receivedBytes || null,
    totalBytes: totalBytes || null,
    decodedDuration: Math.max(0, Number(message.decodedDuration) || 0) || null,
    pcmBytesSent: Math.max(0, Number(message.pcmBytesSent) || 0) || null,
    strategy: diagnosticText(message.strategy, 64) || previousBrowserDecoder.strategy || null,
    candidateIndex: Math.max(0, Number(message.candidateIndex) || 0)
      || previousBrowserDecoder.candidateIndex || null,
    candidateCount: Math.max(0, Number(message.candidateCount) || 0)
      || previousBrowserDecoder.candidateCount || null,
    sourceHost: diagnosticText(message.sourceHost, 255) || previousBrowserDecoder.sourceHost || null,
    codecHint: diagnosticText(message.codecHint, 64) || previousBrowserDecoder.codecHint || null,
    profileHint: diagnosticText(message.profileHint, 96) || previousBrowserDecoder.profileHint || null,
    expectedBytes: Math.max(0, Number(message.expectedBytes) || 0)
      || previousBrowserDecoder.expectedBytes || null,
    coverageRatio: Number.isFinite(Number(message.coverageRatio))
      ? Math.max(0, Number(message.coverageRatio))
      : previousBrowserDecoder.coverageRatio ?? null,
    responseStatus: Math.max(0, Number(message.responseStatus) || 0)
      || previousBrowserDecoder.responseStatus || null,
    contentRange: diagnosticText(message.contentRange, 128)
      || previousBrowserDecoder.contentRange || null,
    webCodecsSupported: typeof message.webCodecsSupported === "boolean"
      ? message.webCodecsSupported
      : experiment.pipeline.diagnostics.browserDecoder?.webCodecsSupported
  };
  if (phase === "candidate-failed") {
    experiment.pipeline.diagnostics.browserDecoder.attempts ||= [];
    experiment.pipeline.diagnostics.browserDecoder.attempts.push({
      candidateIndex: Math.max(1, Number(message.candidateIndex) || 1),
      sourceHost: diagnosticText(message.sourceHost, 255),
      strategy: diagnosticText(message.strategy, 64),
      category: diagnosticText(message.category, 64),
      error: diagnosticMessage(message.error),
      receivedBytes: receivedBytes || null,
      expectedBytes: Math.max(0, Number(message.expectedBytes) || 0) || null,
      coverageRatio: Number.isFinite(Number(message.coverageRatio))
        ? Math.max(0, Number(message.coverageRatio))
        : null
    });
    experiment.pipeline.diagnostics.browserDecoder.attempts =
      experiment.pipeline.diagnostics.browserDecoder.attempts.slice(-10);
  }
  await saveExperiment(experiment);
  if (phase === "candidate-failed") {
    const suffix = Number(message.candidateCount) > 1
      ? ` ${Math.max(1, Number(message.candidateIndex) || 1)}/${Number(message.candidateCount)}`
      : "";
    await broadcastStatus(
      `Audio representation${suffix} failed (${message.category || "decoder error"}); trying another one.`
    );
    return;
  }
  if (phase === "decoding" && message.strategy) {
    await broadcastStatus(`Chrome is decoding the audio with ${message.strategy}.`);
    return;
  }
  const status = phase === "downloading"
    ? (Number.isFinite(percent)
      ? `Chrome is downloading the xHE-AAC track locally… ${Math.round(percent)}%`
      : `Chrome is downloading the xHE-AAC track locally… ${formatMegabytes(receivedBytes)} received`)
    : phase === "decoding"
      ? "Chrome is decoding the xHE-AAC track with the Windows media decoder…"
      : phase === "sending-pcm"
        ? (Number.isFinite(percent)
          ? `Sending browser-decoded audio to local Whisper… ${Math.round(percent)}%`
          : "Sending browser-decoded audio to local Whisper…")
        : "Preparing Chrome’s Windows audio decoder…";
  await broadcastStatus(status);
}

async function handleBrowserBatchPcmBegin(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  const sampleRate = Math.max(8_000, Math.min(96_000, Number(message.sampleRate) || 16_000));
  const channels = Math.max(1, Math.min(2, Number(message.channels) || 1));
  ensureNativeHostPort().postMessage({
    command: "browser_pcm_begin",
    jobId: active.batchJobId,
    sampleRate,
    channels,
    durationHint: Number(message.duration) || active.browserAudioFallback?.durationHint || null,
    language: active.settings.audioLanguage,
    model: active.settings.batchModel || "small",
    captionLanguage: active.settings.captionLanguage,
    collectCaptions: false
  });
}

async function handleBrowserBatchPcmChunk(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  const data = String(message.data || "");
  if (!data || data.length > 900_000) throw new Error("A browser-decoded PCM chunk exceeded the local safety limit.");
  ensureNativeHostPort().postMessage({
    command: "browser_pcm_chunk",
    jobId: active.batchJobId,
    data
  });
}

async function handleBrowserBatchPcmFinish(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  ensureNativeHostPort().postMessage({
    command: "browser_pcm_finish",
    jobId: active.batchJobId
  });
  active.browserAudioFallback = null;
  await setActive(active);
}

async function handleBrowserBatchPcmAbort(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  try {
    ensureNativeHostPort().postMessage({
      command: "cancel_batch",
      jobId: active.batchJobId
    });
  } catch {
    // The decoder error remains available even if no temporary PCM stream existed.
  }
}

async function handleBrowserBatchError(message) {
  const active = await getActive();
  if (!active || active.mode !== "batch-analyzing" || active.batchJobId !== message.jobId) return;
  const experiment = await getExperiment(active.experimentId);
  const lastCategory = experiment?.pipeline?.diagnostics?.browserDecoder?.attempts?.at(-1)?.category;
  const reasonPrefix = lastCategory === "incomplete-download"
    ? "Netflix returned incomplete audio representations"
    : "Chrome/Windows audio decoding failed";
  const reason = `${reasonPrefix}: ${diagnosticMessage(message.error) || "unknown error"}`;
  if (experiment) {
    experiment.pipeline.diagnostics ||= {};
    experiment.pipeline.diagnostics.browserDecoder = {
      ...(experiment.pipeline.diagnostics.browserDecoder || {}),
      state: "failed",
      error: diagnosticMessage(message.error)
    };
    await saveExperiment(experiment);
  }
  await sendToOffscreen({ type: "OFFSCREEN_STOP" });
  await fallbackBatchToLive(active, reason);
}

async function completeBatchExperiment(active, message) {
  const latest = await getActive();
  if (!latest || latest.batchJobId !== active.batchJobId || latest.mode !== "batch-analyzing") return;
  const experiment = await getExperiment(latest.experimentId);
  if (!experiment) return;
  const expectedSegmentCount = Number(message.segmentCount);
  if (
    Number.isInteger(expectedSegmentCount)
    && expectedSegmentCount >= 0
    && experiment.asrSegments.length !== expectedSegmentCount
  ) {
    throw new Error(
      `received ${experiment.asrSegments.length} of ${expectedSegmentCount} transcript segments`
    );
  }
  const expectedCaptionCount = Number(message.captionSegmentCount);
  if (
    Number.isInteger(expectedCaptionCount)
    && expectedCaptionCount >= 0
    && experiment.captionSegments.length !== expectedCaptionCount
  ) {
    throw new Error(
      `received ${experiment.captionSegments.length} of ${expectedCaptionCount} answer-key segments`
    );
  }
  const lastCueEnd = experiment.asrSegments.reduce(
    (maximum, segment) => Math.max(maximum, Number(segment.end) || 0),
    0
  );
  const duration = Math.max(
    Number(message.duration) || 0,
    Number(experiment.page.duration) || 0,
    lastCueEnd
  );
  const range = { start: 0, end: round(duration) };
  experiment.audioCoverage = [range];
  experiment.pipeline = {
    ...experiment.pipeline,
    status: "complete",
    progress: 100,
    duration: range.end,
    language: message.language || experiment.audioLanguage,
    device: message.device || null,
    segmentCount: experiment.asrSegments.length,
    completedAt: new Date().toISOString()
  };
  if (experiment.pipeline.diagnostics?.browserDecoder?.state === "decoded") {
    experiment.pipeline.diagnostics.browserDecoder.state = "complete";
  }
  experiment.evaluation = message.evaluation || null;
  experiment.transcriptSource = {
    kind: "local-whisper-batch",
    provider: "faster-whisper",
    language: message.language || experiment.audioLanguage,
    purpose: "recognized-audio",
    timingProvenance: "exact",
    track: null,
    model: experiment.settings?.batchModel || "small",
    device: message.device || null
  };
  if (experiment.platform === "youtube" && experiment.pipeline.sourceKind !== "youtube-caption-reuse") {
    experiment.youtubeTimingDiagnostics = buildYouTubeTimingDiagnostics(experiment, experiment.pipeline);
  }
  await saveExperiment(experiment);
  await trySaveTranscriptToLibrary(experiment);
  audioCoverageRanges.set(experiment.id, [range]);

  latest.mode = "batch-ready";
  latest.replay = range;
  latest.batchDuration = range.end;
  await setActive(latest);
  await sendToActiveFrame(latest, {
    type: "TRANSCRIPT_UPDATE",
    segments: selectedTranscriptSegments(experiment),
    buffer: "",
    remainingTimeTranscription: 0,
    processingLag: 0,
    stabilizationDelay: 0
  });
  await sendToActiveFrame(latest, { type: "SET_REPLAY_MODE", enabled: true, range });
  if (latest.settings.collectCaptions && experiment.captionSegments.length === 0) {
    await sendToActiveFrame(latest, { type: "SET_CAPTION_COLLECTION", enabled: true });
  }
  const response = await sendToActiveFrame(latest, { type: "CONTROL_MEDIA", action: "play" });
  const evaluationSuffix = formatEvaluationSummary(experiment.evaluation);
  await broadcastStatus(response?.ok
    ? `Full transcript ready. Playback started from cached batch data.${evaluationSuffix}`
    : `Full transcript ready. Press play when you are ready.${evaluationSuffix}`,
  response?.ok ? null : response?.error);
}

async function fallbackActiveBatch(error) {
  const active = await getActive();
  if (active?.mode === "batch-analyzing") await fallbackBatchToLive(active, error);
}

async function fallbackBatchToLive(active, reason) {
  const latest = await getActive();
  if (!latest || latest.mode !== "batch-analyzing" || latest.batchJobId !== active.batchJobId) return;
  const safeReason = diagnosticMessage(reason)
    || "The full-video media source could not be analyzed.";
  const contextResponse = await sendToActiveFrame(latest, { type: "GET_MEDIA_CONTEXT" });
  if (!contextResponse?.ok || !contextResponse.context) {
    await broadcastStatus(
      null,
      `Full-video analysis failed and live fallback could not inspect the player: ${safeReason}`
    );
    return;
  }

  const experiment = await getExperiment(latest.experimentId);
  if (!experiment) return;
  const context = contextResponse.context;
  const epoch = createEpoch(context.currentTime, context.playbackRate, "batch-fallback");
  experiment.asrSegments = [];
  experiment.audioCoverage = [];
  experiment.epochs = [epoch];
  experiment.pipeline = {
    ...experiment.pipeline,
    mode: "live-fallback",
    status: "preparing-live",
    fallbackReason: safeReason,
    progress: null
  };
  latest.mode = "live";
  latest.epoch = epoch;
  latest.replay = null;
  latest.recognizerReady = false;
  delete latest.batchJobId;
  await saveExperiment(experiment);
  await setActive(latest);
  audioCoverageRanges.set(experiment.id, []);
  audioCoverageSaveTimes.set(experiment.id, Date.now());
  await sendToActiveFrame(latest, {
    type: "TRANSCRIPT_UPDATE",
    segments: [],
    buffer: ""
  });
  await sendToActiveFrame(latest, {
    type: "SET_CAPTION_COLLECTION",
    enabled: latest.settings.collectCaptions
  });
  await sendToActiveFrame(latest, { type: "SET_REPLAY_MODE", enabled: false });
  await broadcastStatus(
    `Full-video analysis was unavailable (${safeReason}). Starting live transcription automatically…`
  );

  try {
    await ensureRecognizerRunning(latest.settings.serverUrl);
    await ensureOffscreenDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: latest.tabId });
    const captureResponse = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START",
      streamId,
      settings: latest.settings,
      epoch,
      playing: false,
      mediaClock: {
        currentTime: context.currentTime,
        playbackRate: context.playbackRate
      }
    });
    if (!captureResponse?.ok) throw new Error(captureResponse?.error || "Tab capture failed.");
  } catch (error) {
    experiment.pipeline.status = "error";
    experiment.pipeline.fallbackError = error.message;
    await saveExperiment(experiment);
    await broadcastStatus(null, `Both full-video and live transcription failed: ${error.message}`);
  }
}

async function handleRecognizerReady() {
  const active = await getActive();
  if (!active || !isLiveMode(active) || active.recognizerReady) return;

  active.recognizerReady = true;
  await setActive(active);
  const response = await sendToActiveFrame(active, {
    type: "CONTROL_MEDIA",
    action: "play"
  });
  if (response?.ok) {
    await broadcastStatus("Recognizer ready. Playback started automatically.");
  } else {
    await broadcastStatus("Recognizer ready. Press play to begin.", response?.error || null);
  }
}

async function stopExperiment() {
  const active = await getActive();
  if (!active) return;

  const wasLive = isLiveMode(active);
  const batchJobId = active.mode === "batch-analyzing" ? active.batchJobId : null;
  active.mode = "stopping";
  await setActive(active);
  await sendToActiveFrame(active, { type: "END_SESSION" });
  if (batchJobId && nativeHostPort) {
    try { nativeHostPort.postMessage({ command: "cancel_batch", jobId: batchJobId }); } catch { }
  }
  if (wasLive || active.browserDecodeAttempted) {
    await sendToOffscreen({ type: "OFFSCREEN_STOP" });
  }
  if (wasLive) {
    await persistAudioCoverage(active, true);
  }

  const experiment = await getExperiment(active.experimentId);
  if (experiment) {
    experiment.finishedAt = new Date().toISOString();
    await saveExperiment(experiment);
    if (wasLive && hasCompleteLiveCoverage(experiment)) {
      await trySaveTranscriptToLibrary(experiment);
    }
  }
  await chrome.storage.session.remove(ACTIVE_KEY);
  mediaClocks.delete(active.tabId);
  runtimeSampleTimes.delete(active.experimentId);
  audioCoverageRanges.delete(active.experimentId);
  audioCoverageSaveTimes.delete(active.experimentId);
  await broadcastStatus("Experiment stopped and cached locally.");
}

async function stopIfActiveTab(tabId) {
  const active = await getActive();
  if (active?.tabId === tabId) await stopExperiment();
}

async function replaceEpochTranscript(message) {
  const active = await getActive();
  if (!active || active.epoch?.id !== message.epochId) return;
  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;

  const incomingSegments = message.segments || [];
  let retainedSegments = experiment.asrSegments
    .filter((segment) => segment.epochId !== message.epochId);
  if (incomingSegments.length) {
    const replacementStart = Math.min(...incomingSegments.map((segment) => segment.start));
    const replacementEnd = Math.max(...incomingSegments.map((segment) => segment.end));
    retainedSegments = retainedSegments.filter((segment) => (
      segment.end <= replacementStart + 0.05
      || segment.start >= replacementEnd - 0.05
    ));
  }

  experiment.asrSegments = retainedSegments
    .concat(incomingSegments)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const now = Date.now();
  const lastSample = runtimeSampleTimes.get(active.experimentId) || 0;
  if (now - lastSample >= 1000) {
    const clock = mediaClocks.get(active.tabId);
    experiment.runtimeSamples ||= [];
    experiment.runtimeSamples.push({
      observedAt: new Date(now).toISOString(),
      epochId: message.epochId,
      mediaTime: clock?.currentTime ?? null,
      remainingTimeTranscription: message.remainingTimeTranscription,
      processingLag: message.processingLag,
      stabilizationDelay: message.stabilizationDelay,
      committedSegmentCount: message.segments.length,
      hasLiveBuffer: Boolean(message.buffer)
    });
    runtimeSampleTimes.set(active.experimentId, now);
  }
  await saveExperiment(experiment);
  await sendToActiveFrame(active, {
    type: "TRANSCRIPT_UPDATE",
    segments: experiment.asrSegments,
    buffer: message.buffer,
    remainingTimeTranscription: message.remainingTimeTranscription,
    processingLag: message.processingLag,
    stabilizationDelay: message.stabilizationDelay
  });
}

async function anchorEpoch(message) {
  const active = await getActive();
  if (!active || active.epoch?.id !== message.epochId) return;

  active.epoch = {
    ...active.epoch,
    mediaStart: round(message.mediaStart),
    playbackRate: Number(message.playbackRate) || 1,
    anchored: true,
    anchoredAt: new Date().toISOString()
  };
  await setActive(active);

  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;
  experiment.epochs = experiment.epochs.map((epoch) => (
    epoch.id === message.epochId ? active.epoch : epoch
  ));
  await saveExperiment(experiment);
}

async function appendAudioCoverage(message) {
  const active = await getActive();
  if (!active || active.epoch?.id !== message.epochId) return;
  const start = Number(message.start);
  const end = Number(message.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

  let ranges = audioCoverageRanges.get(active.experimentId);
  if (!ranges) {
    const experiment = await getExperiment(active.experimentId);
    ranges = experiment?.audioCoverage || [];
  }
  ranges = mergeCoverageRanges(ranges.concat({ start: round(start), end: round(end) }));
  audioCoverageRanges.set(active.experimentId, ranges);
  await persistAudioCoverage(active, false);
}

async function persistAudioCoverage(active, force) {
  const ranges = audioCoverageRanges.get(active.experimentId);
  if (!ranges) return;
  const now = Date.now();
  const lastSave = audioCoverageSaveTimes.get(active.experimentId) || 0;
  if (!force && now - lastSave < 2_000) return;

  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;
  experiment.audioCoverage = ranges;
  await saveExperiment(experiment);
  audioCoverageSaveTimes.set(active.experimentId, now);
}

async function appendCaption(tabId, frameId, segment) {
  const active = await getActive();
  if (!isActiveMediaFrame(active, tabId, frameId) || !segment?.text) return;
  const experiment = await getExperiment(active.experimentId);
  if (!experiment) return;

  const previous = experiment.captionSegments.at(-1);
  const duplicate = previous
    && previous.text === segment.text
    && Math.abs(previous.start - segment.start) < 0.25;
  if (!duplicate) {
    experiment.captionSegments.push({
      id: crypto.randomUUID(),
      start: round(segment.start),
      end: round(Math.max(segment.start, segment.end)),
      text: String(segment.text).trim(),
      source: segment.source || "visible-caption"
    });
    await saveExperiment(experiment);
  }
}

async function handleMediaEvent(tabId, frameId, event) {
  const active = await getActive();
  if (!isActiveMediaFrame(active, tabId, frameId)) return;

  if (event.name === "play" || event.name === "pause") {
    if (active.mode === "batch-analyzing") {
      if (event.name === "play") {
        await sendToActiveFrame(active, { type: "CONTROL_MEDIA", action: "pause" });
        await broadcastStatus("Full-video analysis is still running; playback will start when it is ready.");
      }
      return;
    }
    if (!isLiveMode(active)) return;
    await sendToOffscreen({
      type: "OFFSCREEN_SET_PLAYING",
      playing: event.name === "play"
    });
    return;
  }

  if (event.name === "seeking") {
    if (isLiveMode(active)) {
      await sendToOffscreen({ type: "OFFSCREEN_SET_CAPTURE_ENABLED", enabled: false });
    }
    return;
  }

  if (event.name === "seeked") {
    await handleSeek(active, event.currentTime, event.playbackRate);
  } else if (event.name === "ratechange" && isLiveMode(active)) {
    await beginEpoch(active, event.currentTime, event.playbackRate, "ratechange");
  }
}

async function handleSeek(active, currentTime, playbackRate) {
  if (active.mode === "batch-analyzing" || active.mode === "stopping") return;
  const experiment = await getExperiment(active.experimentId);
  const coverage = audioCoverageRanges.get(active.experimentId)
    || experiment?.audioCoverage
    || [];
  const range = findCoveredRange(coverage, experiment?.asrSegments || [], currentTime);
  if (range) {
    active.replay = range;
    await setActive(active);
    if (isLiveMode(active)) {
      await sendToOffscreen({ type: "OFFSCREEN_SET_CAPTURE_ENABLED", enabled: false });
    }
    await sendToActiveFrame(active, { type: "SET_REPLAY_MODE", enabled: true, range });
    return;
  }
  if (active.mode === "batch-ready") return;
  await beginEpoch(active, currentTime, playbackRate, "seek");
}

async function handleMediaClock(tabId, frameId, currentTime, playbackRate) {
  const active = await getActive();
  if (!isActiveMediaFrame(active, tabId, frameId)) return;
  mediaClocks.set(tabId, { currentTime, playbackRate });
  if (isLiveMode(active)) {
    await sendToOffscreen({
      type: "OFFSCREEN_MEDIA_CLOCK",
      currentTime,
      playbackRate
    });
  }
  if (active.mode === "batch-ready" || active.mode === "batch-analyzing") return;
  if (!active.replay) return;
  const outsideReplay = currentTime < active.replay.start - 0.5
    || currentTime >= active.replay.end - 0.15;
  if (outsideReplay) await beginEpoch(active, currentTime, playbackRate, "after-cached-replay");
}

async function beginEpoch(active, currentTime, playbackRate, reason) {
  if (!isLiveMode(active)) return;
  const epoch = createEpoch(currentTime, playbackRate, reason);
  active.epoch = epoch;
  active.replay = null;
  await setActive(active);

  const experiment = await getExperiment(active.experimentId);
  if (experiment) {
    experiment.epochs.push(epoch);
    await saveExperiment(experiment);
  }

  await sendToActiveFrame(active, { type: "SET_REPLAY_MODE", enabled: false });
  await sendToOffscreen({ type: "OFFSCREEN_RESET_EPOCH", epoch });
}

function findCoveredRange(audioCoverage, segments, currentTime) {
  const explicitCoverage = mergeCoverageRanges(audioCoverage || []);
  const inferredCoverage = coverageFromSegments(segments || []);
  const ranges = explicitCoverage.length
    ? mergeCoverageRanges(explicitCoverage.concat(inferredCoverage))
    : inferredCoverage;
  return ranges.find((range) => (
    currentTime >= range.start - 0.4
    && currentTime < range.end + 0.1
  )) || null;
}

function coverageFromSegments(segments) {
  if (!segments.length) return [];
  return mergeCoverageRanges(segments.map((segment) => ({
    start: segment.start,
    end: segment.end
  })), 3);
}

function mergeCoverageRanges(ranges, gapTolerance = 0.75) {
  const sorted = ranges
    .map((range) => ({ start: Number(range.start), end: Number(range.end) }))
    .filter((range) => (
      Number.isFinite(range.start)
      && Number.isFinite(range.end)
      && range.end > range.start
    ))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const segment of sorted) {
    const previous = merged.at(-1);
    if (previous && segment.start <= previous.end + gapTolerance) {
      previous.end = Math.max(previous.end, segment.end);
    } else {
      merged.push({ start: segment.start, end: segment.end });
    }
  }
  return merged.map((range) => ({ start: round(range.start), end: round(range.end) }));
}

async function exportLastExperiment() {
  const stored = await chrome.storage.local.get(LAST_KEY);
  const id = stored[LAST_KEY];
  if (!id) throw new Error("Run an experiment before exporting.");
  const experiment = await getExperiment(id);
  if (!experiment) throw new Error("The last experiment is no longer in local storage.");
  const title = experiment.page.title.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "video";
  const technicalExperiment = structuredClone(experiment);
  if (technicalExperiment.page) {
    technicalExperiment.page.url = redactTechnicalPageUrl(technicalExperiment.page.url);
    technicalExperiment.page.playerFrameUrl = redactTechnicalPageUrl(
      technicalExperiment.page.playerFrameUrl
    );
  }
  technicalExperiment.pipeline = sanitizeTechnicalDiagnosticValue(
    technicalExperiment.pipeline
  );
  return {
    experiment: technicalExperiment,
    filename: `dub-transcript-lab/${title}-${id}.json`
  };
}

async function getVisibleDiagnostics() {
  const active = await getActive();
  const stored = await chrome.storage.local.get(LAST_KEY);
  const experimentId = active?.experimentId || stored[LAST_KEY];
  const experiment = experimentId ? await getExperiment(experimentId) : null;
  if (!experiment) {
    return {
      diagnostics: {
        level: "idle",
        stage: "Ready",
        message: "No analysis has been run yet.",
        action: null,
        details: []
      }
    };
  }
  const pipeline = experiment.pipeline || {};
  const diagnostics = pipeline.diagnostics || {};
  const browser = diagnostics.browserDecoder || {};
  const completed = pipeline.status === "complete" || pipeline.mode === "library";
  const finalError = completed ? null : (
    pipeline.fallbackError
      || browser.error
      || diagnostics.finalError?.message
      || pipeline.fallbackReason
      || null
  );
  const category = completed ? null : (
    browser.attempts?.at(-1)?.category
      || diagnostics.finalError?.category
      || (String(finalError || "").toLowerCase().includes("incomplete")
        ? "incomplete-download"
        : null)
  );
  let level = "working";
  if (completed) level = "success";
  else if (pipeline.status === "error") level = "error";
  else if (pipeline.mode === "live-fallback" || finalError) level = "warning";
  const details = [];
  details.push({ label: "Mode", value: diagnosticModeLabel(pipeline) });
  if (pipeline.sourceKind === "youtube-caption-reuse" && pipeline.selectedCaptionTrack) {
    const track = pipeline.selectedCaptionTrack;
    details.push({
      label: "YouTube caption track",
      value: [track.name || track.languageCode, track.vssId, track.kind].filter(Boolean).join(" · ")
    });
  }
  if (pipeline.selectedAudioTrack) {
    const track = pipeline.selectedAudioTrack;
    details.push({
      label: "Audio track",
      value: [track.label || track.language, track.role, track.selectedByPlayer ? "player-selected" : null]
        .filter(Boolean).join(" · ")
    });
  }
  if (diagnostics.extensionVersion || diagnostics.worker?.workerVersion) {
    details.push({
      label: "Versions",
      value: `extension ${diagnostics.extensionVersion || "?"} · worker ${diagnostics.worker?.workerVersion || "not reported"}`
    });
  }
  if (diagnostics.discovery) {
    const pageObserver = diagnostics.discovery.pageObserver || {};
    const networkObserver = diagnostics.discovery.networkObserver || {};
    const observerVersion = pageObserver.mainWorldVersion
      ? `main v${pageObserver.mainWorldVersion} · bridge v${pageObserver.bridgeVersion || "?"}`
      : "main observer not ready";
    details.push({
      label: "Media observer",
      value: `${observerVersion} · network ${networkObserver.available ? "ready" : "unavailable"}`
    });
    details.push({
      label: "HTTP discovery",
      value: `${Math.max(0, Number(networkObserver.candidateCount) || 0)} candidate`
        + `${Number(networkObserver.candidateCount) === 1 ? "" : "s"}`
        + ` · ${Math.max(0, Number(networkObserver.segmentEvidenceCount) || 0)} segment request`
        + `${Number(networkObserver.segmentEvidenceCount) === 1 ? "" : "s"}`
    });
    if (networkObserver.replayHeaderNames?.length) {
      details.push({
        label: "Safe request context",
        value: networkObserver.replayHeaderNames.join(", ")
      });
    }
  }
  if (diagnostics.attempts?.length) {
    details.push({
      label: "Local decoder",
      value: `${diagnostics.attempts.length} representation attempt${diagnostics.attempts.length === 1 ? "" : "s"}`
    });
    const playlistAttempt = [...diagnostics.attempts].reverse().find((attempt) => (
      attempt.playlistType
    ));
    if (playlistAttempt) {
      details.push({
        label: "HLS inspection",
        value: `${playlistAttempt.playlistType}`
          + ` · ${playlistAttempt.audioRenditionCount || 0} audio rendition`
          + `${playlistAttempt.audioRenditionCount === 1 ? "" : "s"}`
          + ` · ${playlistAttempt.variantCount || 0} variant`
          + `${playlistAttempt.variantCount === 1 ? "" : "s"}`
      });
    }
    const wrappedAttempt = [...diagnostics.attempts].reverse().find((attempt) => (
      attempt.wrapperKind
    ));
    if (wrappedAttempt) {
      details.push({
        label: "HLS segment transport",
        value: `${wrappedAttempt.wrapperKind}`
          + ` Â· ${wrappedAttempt.wrappedSegmentCount || 0} segment`
          + `${wrappedAttempt.wrappedSegmentCount === 1 ? "" : "s"}`
      });
    }
  }
  if (browser.state) {
    const candidate = browser.candidateCount
      ? ` · candidate ${browser.candidateIndex || 1}/${browser.candidateCount}`
      : "";
    details.push({
      label: "Browser decoder",
      value: `${browser.state}${candidate}${browser.strategy ? ` · ${browser.strategy}` : ""}`
    });
  }
  if (browser.receivedBytes || browser.expectedBytes) {
    details.push({
      label: "Audio received",
      value: `${formatMegabytes(browser.receivedBytes || 0)}`
        + (browser.expectedBytes ? ` / about ${formatMegabytes(browser.expectedBytes)}` : "")
    });
  }
  let message = finalError || diagnosticStageMessage(pipeline, browser);
  let action = null;
  if (category === "incomplete-download") {
    message = "Netflix returned only part of the selected audio representation. The extension will try the remaining representations before using live transcription.";
    action = "Keep the Netflix tab open and try Analyze automatically again. If every candidate is partial, the visible candidate counter will show it.";
  } else if (category === "decoder-unsupported" || /xhe|esbr|webcodecs|decode/i.test(finalError || "")) {
    message = "The audio was found, but the available FFmpeg/Chrome decoder paths could not decode this codec configuration.";
    action = "Try another Netflix audio track if one exists. Otherwise the extension will use live transcription for this title.";
  } else if (diagnostics.finalError && !diagnostics.worker) {
    action = "The native worker did not report its version. Run CHECK-SETUP.cmd and repair native-host registration if it is marked FAIL.";
  } else if (category === "invalid-playlist") {
    action = "The media endpoint returned something other than an HLS playlist. Reload the player to obtain a fresh source, then try again.";
  } else if (category === "no-audio") {
    action = "The detected playlist did not expose an audio stream. The extension will use live transcription unless another audio rendition is observed.";
  } else if (category === "language-mismatch") {
    action = "The playlist's declared audio languages do not include the language selected in the extension. Select the language that is actually playing, then analyze again.";
  } else if (category === "segment-wrapper-error") {
    action = "The player changed its clear HLS segment wrapper during analysis. Reload the player to obtain one consistent source, then try again.";
  } else if (/no accessible http media source/i.test(finalError || "")) {
    const discovery = diagnostics.discovery || {};
    const pageReady = discovery.pageObserver?.ready === true;
    const networkCount = Math.max(0, Number(discovery.networkObserver?.observedRequestCount) || 0);
    action = !pageReady
      ? "The page media observer was not ready. Refresh the video page once after reloading the extension."
      : networkCount
        ? "The browser saw media traffic, but no reusable clear manifest. Live transcription is available."
        : "No reusable media request was observed. Keep playback running briefly or use live transcription.";
  }
  if (experiment.youtubeTimingDiagnostics) {
    const yt = experiment.youtubeTimingDiagnostics;
    details.push({ label: "YouTube timing diagnostics", value: "Available (see technical export)" });
    details.push({ label: "yt-dlp format", value: yt.ytDlpFormatId || "unknown" });
    details.push({ label: "Container", value: yt.container || "unknown" });
    details.push({ label: "Audio codec", value: yt.audioCodec || "unknown" });
    details.push({ label: "Sample rate", value: yt.sampleRate ? `${yt.sampleRate} Hz` : "unknown" });
    details.push({ label: "Detected language", value: yt.detectedLanguage || "unknown" });
    details.push({ label: "Source-reported duration", value: yt.sourceReportedDuration ? `${yt.sourceReportedDuration.toFixed(1)}s` : "unknown" });
    details.push({ label: "Player duration", value: yt.playerDuration ? `${yt.playerDuration.toFixed(1)}s` : "unknown" });
    details.push({ label: "Container start time", value: yt.containerStartTime !== null ? `${yt.containerStartTime.toFixed(3)}s` : "unknown" });
    details.push({ label: "Audio stream start time", value: yt.audioStreamStartTime !== null ? `${yt.audioStreamStartTime.toFixed(3)}s` : "unknown" });
    details.push({ label: "Stream time base", value: yt.streamTimeBase || "unknown" });
    details.push({ label: "First decoded audio PTS", value: yt.firstDecodedAudioPts !== null ? `${yt.firstDecodedAudioPts.toFixed(3)}s` : "unknown" });
    details.push({ label: "Decoded sample count", value: yt.decodedSampleCount ? yt.decodedSampleCount.toLocaleString() : "unknown" });
    details.push({ label: "Decoded audio duration", value: yt.decodedAudioDuration ? `${yt.decodedAudioDuration.toFixed(1)}s` : "unknown" });
    if (yt.firstRawAsrWordTimestamp) {
      details.push({ label: "First raw ASR word", value: `${yt.firstRawAsrWordTimestamp.start.toFixed(3)}s – ${yt.firstRawAsrWordTimestamp.end.toFixed(3)}s (${yt.firstRawAsrWordTimestamp.timing})` });
    }
    if (yt.lastRawAsrWordTimestamp) {
      details.push({ label: "Last raw ASR word", value: `${yt.lastRawAsrWordTimestamp.start.toFixed(3)}s – ${yt.lastRawAsrWordTimestamp.end.toFixed(3)}s (${yt.lastRawAsrWordTimestamp.timing})` });
    }
    if (yt.firstNormalizedCueTimestamp) {
      details.push({ label: "First normalized cue", value: `${yt.firstNormalizedCueTimestamp.start.toFixed(3)}s – ${yt.firstNormalizedCueTimestamp.end.toFixed(3)}s` });
    }
    if (yt.lastNormalizedCueTimestamp) {
      details.push({ label: "Last normalized cue", value: `${yt.lastNormalizedCueTimestamp.start.toFixed(3)}s – ${yt.lastNormalizedCueTimestamp.end.toFixed(3)}s` });
    }
    if (yt.firstDisplayGroupTimestamp) {
      details.push({ label: "First display group", value: `${yt.firstDisplayGroupTimestamp.start.toFixed(3)}s – ${yt.firstDisplayGroupTimestamp.end.toFixed(3)}s` });
    }
    if (yt.lastDisplayGroupTimestamp) {
      details.push({ label: "Last display group", value: `${yt.lastDisplayGroupTimestamp.start.toFixed(3)}s – ${yt.lastDisplayGroupTimestamp.end.toFixed(3)}s` });
    }
    details.push({ label: "Manual sync offset", value: `${yt.manualSyncOffset >= 0 ? "+" : ""}${yt.manualSyncOffset.toFixed(1)}s` });
  }
  return {
    diagnostics: {
      level,
      stage: diagnosticStageLabel(pipeline.status),
      message: diagnosticMessage(message) || "Waiting for the next analysis update.",
      action,
      category,
      updatedAt: experiment.finishedAt || experiment.createdAt,
      details
    }
  };
}

function diagnosticModeLabel(pipeline) {
  if (pipeline.mode === "library") return "saved transcript replay";
  if (pipeline.mode === "live-fallback") return "live transcription fallback";
  if (pipeline.mode === "batch") return "full-video analysis";
  if (pipeline.sourceKind === "youtube-caption-reuse") return "YouTube automatic transcript";
  return pipeline.mode || pipeline.requested || "unknown";
}

function diagnosticStageLabel(status) {
  const labels = {
    queued: "Queued",
    "downloading-audio": "Downloading audio",
    decoding: "Decoding audio",
    transcribing: "Transcribing",
    "browser-decoder-preparing": "Preparing browser decoder",
    "browser-preparing": "Preparing browser decoder",
    "browser-downloading": "Browser downloading audio",
    "browser-decoding": "Browser decoding audio",
    "browser-candidate-failed": "Trying another audio representation",
    "browser-sending-pcm": "Sending decoded audio to Whisper",
    "preparing-live": "Preparing live transcription",
    running: "Live transcription",
    complete: "Complete",
    error: "Failed"
  };
  return labels[status] || String(status || "Ready").replace(/-/g, " ");
}

function diagnosticStageMessage(pipeline, browser) {
  if (pipeline.status === "complete") return "The complete transcript is ready and cached locally.";
  if (pipeline.status === "browser-downloading") {
    return browser.percent != null
      ? `The browser has downloaded ${Math.round(browser.percent)}% of this audio candidate.`
      : "The browser is downloading the selected audio candidate.";
  }
  if (pipeline.status === "decoding" && pipeline.decodeProgress != null) {
    return `The local decoder has processed ${Math.round(pipeline.decodeProgress)}% of the audio.`;
  }
  return "Analysis is still running. This panel updates automatically.";
}

function redactTechnicalPageUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.hash = "";
    if (parsed.search) parsed.search = "?query=redacted";
    return parsed.href;
  } catch {
    return diagnosticText(value, 500);
  }
}

async function exportLastTranscriptText() {
  const stored = await chrome.storage.local.get(LAST_KEY);
  const id = stored[LAST_KEY];
  if (!id) throw new Error("Analyze a video before downloading its transcript.");
  const experiment = await getExperiment(id);
  const selectedSegments = selectedTranscriptSegments(experiment);
  if (!selectedSegments?.length) {
    throw new Error("The last experiment does not contain a transcript yet.");
  }
  return transcriptTextExport(experiment);
}

async function inspectCurrentMediaTarget() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || identifyPlatform(tab.url) !== "netflix.com") {
    throw new Error("Open a Netflix movie or episode player before running research mode.");
  }
  const injection = await ensureContentScripts(tab.id);
  const mediaTarget = await findMediaTarget(tab.id, injection.frameIds);
  if (!mediaTarget) {
    throw new Error("Start Netflix playback once, then click Analyze this Netflix title again.");
  }
  return { tab, mediaTarget };
}

async function analyzeNetflixTitle(rawAudioLanguage = "de") {
  const { tab, mediaTarget } = await inspectCurrentMediaTarget();
  const context = mediaTarget.context || {};
  const audioLanguage = netflixResearch.normalizeLanguage(rawAudioLanguage) || "de";
  const metadata = context.netflixMetadata && typeof context.netflixMetadata === "object"
    ? context.netflixMetadata
    : { title: {}, audioTracks: [], subtitleTracks: [] };
  const currentNetflixId = netflixWatchId(tab.url);
  const observedNetflixId = netflixResearch.safeText(metadata.title?.videoId, 64);
  if (observedNetflixId && currentNetflixId && observedNetflixId !== currentNetflixId) {
    throw new Error(
      "The observer still contains metadata from the previous Netflix title. "
      + "Start this title once, wait a moment, and run research mode again."
    );
  }
  const groups = netflixResearch.groupAudioRepresentations(
    context.batchCandidates,
    audioLanguage
  );
  if (!groups.length) {
    throw new Error(
      "Netflix track metadata has not been observed yet. Reload this Netflix tab, start playback, "
      + "confirm the desired audio track, and run research mode again."
    );
  }
  const matchingGroups = groups.filter((group) => group.language === audioLanguage);
  const inspectedGroups = (matchingGroups.length ? matchingGroups : groups).slice(0, 8);
  const selectedTrack = selectNetflixResearchAudioTrack(
    metadata.audioTracks,
    groups,
    audioLanguage
  );
  const subtitleInventory = netflixResearch.subtitleInventory(
    metadata.subtitleTracks,
    audioLanguage
  );
  await ensureOffscreenDocument();
  const offscreenResponse = await sendToOffscreen({
    type: "OFFSCREEN_INSPECT_NETFLIX_AUDIO",
    durationHint: context.duration,
    candidates: inspectedGroups.map((group) => ({
      representationKey: group.key,
      url: group.urls[0],
      codec: group.codecHint,
      profile: group.profileHint,
      bitrate: group.bitrate,
      channels: group.channels
    }))
  });
  if (!offscreenResponse?.ok) {
    throw new Error(offscreenResponse?.error || "The Netflix container inspection failed.");
  }

  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const titleMetadata = metadata.title && typeof metadata.title === "object"
    ? metadata.title
    : {};
  const netflixId = currentNetflixId
    || netflixResearch.safeText(titleMetadata.videoId, 64)
    || null;
  const visibleTitle = netflixResearch.safeText(context.visibleTitleText, 400);
  const documentTitle = netflixResearch.safeText(context.documentTitle || tab.title, 300);
  const bestTitle = netflixResearch.safeText(
    titleMetadata.episodeTitle
      || titleMetadata.title
      || visibleTitle
      || (/^netflix$/i.test(documentTitle) ? "" : documentTitle),
    240
  ) || `Netflix ${netflixId || "title"}`;
  const report = {
    schemaVersion: netflixResearch.REPORT_SCHEMA_VERSION,
    id,
    collectedAt: new Date().toISOString(),
    collector: {
      name: "Dub Transcript Lab Netflix research mode",
      extensionVersion: installedExtensionVersion(),
      scope: "metadata-and-initialization-only"
    },
    page: {
      netflixId,
      title: bestTitle,
      documentTitle: documentTitle || null,
      visibleTitleText: visibleTitle || null,
      contentType: netflixResearch.safeText(titleMetadata.contentType, 32) || "unknown",
      seriesId: netflixResearch.safeText(titleMetadata.seriesId, 64) || null,
      seriesTitle: netflixResearch.safeText(titleMetadata.seriesTitle, 240) || null,
      episodeTitle: netflixResearch.safeText(titleMetadata.episodeTitle, 240) || null,
      seasonNumber: safeResearchInteger(titleMetadata.seasonNumber),
      episodeNumber: safeResearchInteger(titleMetadata.episodeNumber),
      releaseYear: safeResearchYear(titleMetadata.releaseYear),
      durationSeconds: round(Number(context.duration) || 0)
    },
    environment: {
      collectedLanguage: audioLanguage,
      browserLanguage: netflixResearch.safeText(context.browserLanguage, 32) || null,
      platform: netflixResearch.safeText(context.browserPlatform, 64) || null,
      userAgentFamily: browserFamily(context.userAgent),
      webCodecsAvailable: offscreenResponse.environment?.webCodecsAvailable === true,
      offlineAudioContextAvailable: offscreenResponse.environment?.offlineAudioContextAvailable === true
    },
    drm: {
      protectedPlaybackObserved: Boolean(context.drmProtected),
      mediaKeysAttached: Boolean(context.drmSignals?.mediaKeysAttached),
      encryptedEventObserved: Boolean(context.drmSignals?.encryptedEventObserved),
      observerReportedDrm: Boolean(context.drmSignals?.observerReportedDrm)
    },
    audio: {
      requestedLanguage: audioLanguage,
      selectedTrack,
      tracks: (Array.isArray(metadata.audioTracks) ? metadata.audioTracks : [])
        .map(netflixResearch.sanitizeAudioTrack)
        .filter(Boolean),
      representationGroups: groups.map(netflixResearch.representationSummary),
      inspectedRepresentationCount: inspectedGroups.length
    },
    subtitles: subtitleInventory,
    alignment: {
      status: "not-sampled",
      agreementEstimate: null,
      note: "Metadata cannot prove that subtitle wording matches the selected dub. Attach a manual ASR/caption sample."
    },
    deliveryInspections: offscreenResponse.inspections || [],
    summary: null,
    privacy: {
      audioStored: false,
      mediaUrlsStored: false,
      queryTokensStored: false,
      cookiesStored: false,
      accountDataStored: false,
      licenseTrafficInspected: false,
      drmKeysCollected: false
    }
  };
  report.summary = netflixResearchSummary(report);
  await saveNetflixResearchReport(report);
  return { report: netflixResearchReportMetadata(report) };
}

function selectNetflixResearchAudioTrack(rawTracks, groups, audioLanguage) {
  const tracks = (Array.isArray(rawTracks) ? rawTracks : [])
    .map(netflixResearch.sanitizeAudioTrack)
    .filter(Boolean);
  const selected = tracks.find((track) => track.selected && track.language === audioLanguage)
    || tracks.find((track) => track.language === audioLanguage && track.role === "main")
    || tracks.find((track) => track.language === audioLanguage)
    || tracks.find((track) => track.selected)
    || tracks[0];
  if (selected) return selected;
  const group = groups.find((value) => value.selected && value.language === audioLanguage)
    || groups.find((value) => value.language === audioLanguage && value.role === "main")
    || groups[0];
  return group ? {
    language: group.language,
    label: group.label,
    trackId: group.trackId,
    role: group.role,
    selected: group.selected,
    channels: group.channels,
    representationCount: groups.filter((value) => value.trackId === group.trackId).length
  } : null;
}

function netflixResearchSummary(report) {
  const inspections = Array.isArray(report.deliveryInspections) ? report.deliveryInspections : [];
  const inspected = inspections.filter((item) => item.status === "inspected");
  const protectionDetectedCount = inspected.filter((item) => item.protection?.detected).length;
  const shortEntityCount = inspected.filter(
    (item) => item.response?.deliveryShape === "short-entity"
  ).length;
  const webCodecsSupportedCount = inspected.filter(
    (item) => item.webCodecs?.configSupported === true
  ).length;
  const parseFailureCount = inspected.filter((item) => item.container?.parsed === false).length
    + inspections.filter((item) => item.status === "inspection-failed").length;
  let conclusion = "No representation initialization data was inspected.";
  if (inspected.length && protectionDetectedCount === inspected.length) {
    conclusion = "Every inspected representation contains content-protection signals.";
  } else if (protectionDetectedCount) {
    conclusion = "The selected audio exposes a mixture of protected and apparently clear representations.";
  } else if (inspected.length) {
    conclusion = "No MP4 protection box was detected in the inspected initialization ranges.";
  }
  return {
    inspectedRepresentationCount: inspected.length,
    protectionDetectedCount,
    shortEntityCount,
    webCodecsSupportedCount,
    parseFailureCount,
    sameLanguageSubtitleCount: Number(report.subtitles?.sameLanguageCount) || 0,
    subtitleConclusion: report.subtitles?.conclusion || "unknown",
    conclusion
  };
}

async function saveNetflixResearchReport(report) {
  const key = `${netflixResearch.RESEARCH_PREFIX}${report.id}`;
  const stored = await chrome.storage.local.get(NETFLIX_RESEARCH_INDEX_KEY);
  const existing = Array.isArray(stored[NETFLIX_RESEARCH_INDEX_KEY])
    ? stored[NETFLIX_RESEARCH_INDEX_KEY]
    : [];
  const metadata = netflixResearchReportMetadata(report);
  const updated = [metadata, ...existing.filter((entry) => entry.id !== report.id)]
    .slice(0, NETFLIX_RESEARCH_LIMIT);
  const retainedIds = new Set(updated.map((entry) => entry.id));
  const removedKeys = existing
    .filter((entry) => !retainedIds.has(entry.id))
    .map((entry) => `${netflixResearch.RESEARCH_PREFIX}${entry.id}`);
  if (removedKeys.length) await chrome.storage.local.remove(removedKeys);
  await chrome.storage.local.set({
    [key]: report,
    [NETFLIX_RESEARCH_LAST_KEY]: report.id,
    [NETFLIX_RESEARCH_INDEX_KEY]: updated
  });
}

function netflixResearchReportMetadata(report) {
  return {
    id: report.id,
    title: report.page?.title || "Netflix title",
    netflixId: report.page?.netflixId || null,
    contentType: report.page?.contentType || "unknown",
    collectedAt: report.collectedAt,
    audioLanguage: report.audio?.requestedLanguage || null,
    selectedRole: report.audio?.selectedTrack?.role || null,
    protectionDetectedCount: Number(report.summary?.protectionDetectedCount) || 0,
    inspectedRepresentationCount: Number(report.summary?.inspectedRepresentationCount) || 0,
    subtitleConclusion: report.summary?.subtitleConclusion || "unknown",
    alignmentStatus: report.alignment?.status || "not-sampled",
    agreementEstimate: report.alignment?.agreementEstimate != null
      && Number.isFinite(Number(report.alignment.agreementEstimate))
      ? Number(report.alignment.agreementEstimate)
      : null
  };
}

async function getNetflixResearchState() {
  const stored = await chrome.storage.local.get([
    NETFLIX_RESEARCH_LAST_KEY,
    NETFLIX_RESEARCH_INDEX_KEY
  ]);
  const entries = Array.isArray(stored[NETFLIX_RESEARCH_INDEX_KEY])
    ? stored[NETFLIX_RESEARCH_INDEX_KEY].slice(0, NETFLIX_RESEARCH_LIMIT)
    : [];
  const lastId = stored[NETFLIX_RESEARCH_LAST_KEY] || null;
  return {
    lastReport: entries.find((entry) => entry.id === lastId) || null,
    entries
  };
}

async function getNetflixResearchReport(id) {
  if (!id) return null;
  const key = `${netflixResearch.RESEARCH_PREFIX}${id}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function attachNetflixSubtitleSample() {
  const state = await getNetflixResearchState();
  if (!state.lastReport?.id) throw new Error("Inspect a Netflix title before attaching a subtitle sample.");
  const report = await getNetflixResearchReport(state.lastReport.id);
  const stored = await chrome.storage.local.get(LAST_KEY);
  const experiment = await getExperiment(stored[LAST_KEY]);
  if (!report || !experiment) throw new Error("No recent transcript experiment is available.");
  if (
    report.page?.netflixId
    && netflixWatchId(experiment.page?.url) !== report.page.netflixId
  ) {
    throw new Error("The latest transcript belongs to a different Netflix title.");
  }
  const alignment = netflixResearch.estimateSubtitleAlignment(
    experiment.asrSegments,
    experiment.captionSegments
  );
  report.alignment = {
    ...alignment,
    sourceExperimentId: experiment.id,
    audioLanguage: experiment.audioLanguage,
    captionLanguage: experiment.captionLanguage,
    asrSegmentCount: experiment.asrSegments?.length || 0,
    captionSegmentCount: experiment.captionSegments?.length || 0
  };
  report.summary = netflixResearchSummary(report);
  await saveNetflixResearchReport(report);
  return { report: netflixResearchReportMetadata(report), alignment: report.alignment };
}

async function exportLastNetflixResearch() {
  const state = await getNetflixResearchState();
  const report = await getNetflixResearchReport(state.lastReport?.id);
  if (!report) throw new Error("Inspect a Netflix title before exporting a research report.");
  return {
    report,
    filename: `dub-transcript-lab/netflix-research/${learning.safeFilename(report.page?.title || "netflix-title")}-${report.id}.json`
  };
}

async function exportNetflixResearchDataset() {
  const state = await getNetflixResearchState();
  if (!state.entries.length) throw new Error("No Netflix research reports have been collected.");
  const reports = (await Promise.all(
    state.entries.map((entry) => getNetflixResearchReport(entry.id))
  )).filter(Boolean);
  const headers = [
    "collectedAt",
    "netflixId",
    "contentType",
    "seriesTitle",
    "title",
    "seasonNumber",
    "episodeNumber",
    "releaseYear",
    "durationSeconds",
    "audioLanguage",
    "audioRole",
    "audioTrackCount",
    "representationCount",
    "inspectedRepresentationCount",
    "protectionDetectedCount",
    "shortEntityCount",
    "webCodecsSupportedCount",
    "sameLanguageSubtitleCount",
    "subtitleConclusion",
    "alignmentStatus",
    "agreementEstimate"
  ];
  const rows = reports.map((report) => [
    report.collectedAt,
    report.page?.netflixId,
    report.page?.contentType,
    report.page?.seriesTitle,
    report.page?.title,
    report.page?.seasonNumber,
    report.page?.episodeNumber,
    report.page?.releaseYear,
    report.page?.durationSeconds,
    report.audio?.requestedLanguage,
    report.audio?.selectedTrack?.role,
    report.audio?.tracks?.length || 0,
    report.audio?.representationGroups?.length || 0,
    report.summary?.inspectedRepresentationCount || 0,
    report.summary?.protectionDetectedCount || 0,
    report.summary?.shortEntityCount || 0,
    report.summary?.webCodecsSupportedCount || 0,
    report.summary?.sameLanguageSubtitleCount || 0,
    report.summary?.subtitleConclusion,
    report.alignment?.status,
    report.alignment?.agreementEstimate
  ]);
  return {
    csv: [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
    filename: `dub-transcript-lab/netflix-research/netflix-audio-dataset-${new Date().toISOString().slice(0, 10)}.csv`,
    reportCount: reports.length
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function netflixWatchId(url) {
  try {
    return new URL(String(url || "")).pathname.match(/^\/watch\/(\d+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function safeResearchInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function safeResearchYear(value) {
  const number = Number(value);
  const currentYear = new Date().getUTCFullYear();
  return Number.isInteger(number) && number >= 1888 && number <= currentYear + 2
    ? number
    : null;
}

function browserFamily(userAgent) {
  const text = String(userAgent || "");
  const match = text.match(/(?:Edg|Chrome)\/(\d+)/);
  return match ? `${text.includes("Edg/") ? "Edge" : "Chrome"} ${match[1]}` : "Chromium-compatible";
}

async function exportLibraryTranscriptText(key) {
  const record = await getTranscriptLibraryRecord(key);
  if (!record) throw new Error("That saved transcript is no longer available.");
  return transcriptTextExport(record);
}

function transcriptTextExport(record) {
  const title = record.title || record.page?.title || "video";
  const language = record.audioLanguage || "unknown";
  const segments = record.segments || record.asrSegments || record.captionSegments || [];
  return {
    text: learning.transcriptToText({ ...record, segments }),
    filename: `dub-transcript-lab/transcripts/${learning.safeFilename(title)}-${language}.txt`
  };
}

async function setSyncOffset(rawOffset) {
  const syncOffset = normalizeSyncOffset(rawOffset);
  const active = await getActive();
  if (!active) return { syncOffset };

  active.syncOffset = syncOffset;
  active.settings = { ...active.settings, syncOffset };
  await setActive(active);
  const experiment = await getExperiment(active.experimentId);
  if (experiment) {
    experiment.settings ||= {};
    experiment.settings.syncOffset = syncOffset;
    await saveExperiment(experiment);
  }
  await sendToActiveFrame(active, { type: "SET_SYNC_OFFSET", offset: syncOffset });
  return { syncOffset };
}

async function updateDisplaySettings(message) {
  const captionPreferences = learning.normalizeCaptionPreferences(message.captionPreferences);
  const translationPreferences = learning.normalizeTranslationPreferences(
    message.translationPreferences
  );
  const storedSettings = await chrome.storage.local.get(SETTINGS_KEY);
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...(storedSettings[SETTINGS_KEY] || {}),
      captionPreferences,
      translationPreferences
    }
  });
  const active = await getActive();
  if (!active) return { captionPreferences, translationPreferences };

  active.settings = {
    ...active.settings,
    captionPreferences,
    translationPreferences
  };
  await setActive(active);
  const experiment = await getExperiment(active.experimentId);
  if (experiment) {
    experiment.settings ||= {};
    experiment.settings.captionPreferences = captionPreferences;
    experiment.settings.translationPreferences = translationPreferences;
    await saveExperiment(experiment);
  }
  await sendToActiveFrame(active, {
    type: "APPLY_DISPLAY_SETTINGS",
    captionPreferences,
    translationPreferences,
    resetTranslationCache: Boolean(message.resetTranslationCache)
  });
  return { captionPreferences, translationPreferences };
}

async function translateText(message) {
  const text = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (!text) return { translatedText: "", provider: "none" };
  const sourceLanguage = String(message.sourceLanguage || "de").slice(0, 16).toLowerCase();
  const preferences = learning.normalizeTranslationPreferences(message.translationPreferences);
  const targetLanguage = preferences.targetLanguage;
  if (sourceLanguage === targetLanguage) return { translatedText: text, provider: "identity" };

  const cacheKey = learning.translationCacheKey(text, sourceLanguage, targetLanguage);
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]?.sourceText === text && cached[cacheKey]?.translatedText) {
    return cached[cacheKey];
  }

  let browserError = null;
  if (preferences.provider !== "google") {
    try {
      await ensureOffscreenDocument();
      const response = await sendToOffscreen({
        type: "OFFSCREEN_TRANSLATE_TEXT",
        text,
        sourceLanguage,
        targetLanguage
      });
      if (!response?.ok || !response.translatedText) {
        throw new Error(response?.error || "The browser Translator API is unavailable.");
      }
      const result = {
        sourceText: text,
        translatedText: String(response.translatedText),
        provider: "browser",
        translatedAt: new Date().toISOString()
      };
      await chrome.storage.local.set({ [cacheKey]: result });
      return result;
    } catch (error) {
      browserError = error;
      if (preferences.provider === "browser") throw error;
    }
  }

  const stored = await chrome.storage.local.get(TRANSLATION_SECRETS_KEY);
  const apiKey = String(stored[TRANSLATION_SECRETS_KEY]?.googleApiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      browserError?.message
        ? `On-device translation is unavailable (${browserError.message}). Add an optional Google Cloud Translation API key in the extension settings.`
        : "Add a Google Cloud Translation API key in the extension settings."
    );
  }

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: "text"
      })
    }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.error?.message || `Google Cloud Translation returned HTTP ${response.status}.`
    );
  }
  const payload = await response.json();
  const translatedText = learning.htmlToPlainText(
    payload?.data?.translations?.[0]?.translatedText
  );
  if (!translatedText) throw new Error("Google Cloud Translation returned no text.");
  const result = {
    sourceText: text,
    translatedText,
    provider: "google",
    translatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [cacheKey]: result });
  return result;
}

async function lookupBilingualWord(rawWord) {
  const word = learning.sanitizeWord(rawWord);
  if (!word) throw new Error("Select a German word first.");

  const normalized = learning.normalizedWord(word);
  const cacheKey = `${DEFINITION_PREFIX}${normalized}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    return { ...cached[cacheKey], saved: await isVocabularyWordSaved(normalized) };
  }

  const [germanResult, englishResult] = await Promise.allSettled([
    fetchGermanWiktionaryEntry(word),
    fetchEnglishWiktionaryEntry(word)
  ]);
  if (germanResult.status === "rejected" && englishResult.status === "rejected") {
    throw new Error(
      `Both Wiktionary lookups failed (${germanResult.reason?.message || "German lookup"}; `
      + `${englishResult.reason?.message || "English lookup"}).`
    );
  }

  const german = germanResult.status === "fulfilled" ? germanResult.value : {};
  const english = englishResult.status === "fulfilled" ? englishResult.value : {};
  const title = german.title || word;
  const examples = deduplicateExamples([
    ...(german.examples || []),
    ...(english.examples || [])
  ]);
  const result = {
    word,
    title,
    germanDefinition: german.germanDefinition || null,
    englishDefinition: english.englishDefinition || null,
    germanDefinitions: german.germanDefinitions || [],
    englishDefinitions: english.englishDefinitions || [],
    example: examples[0]?.german || english.example || null,
    exampleTranslation: examples[0]?.english || english.exampleTranslation || null,
    examples,
    collocations: german.collocations || [],
    synonyms: german.synonyms || [],
    domains: german.domains || [],
    grammar: german.grammar || null,
    wordType: german.wordType || english.partOfSpeech || null,
    pronunciation: german.pronunciation || null,
    germanSourceUrl: `https://de.wiktionary.org/wiki/${encodeURIComponent(title)}`,
    englishSourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    fetchedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [cacheKey]: result });
  return { ...result, saved: await isVocabularyWordSaved(normalized) };
}

async function fetchGermanWiktionaryEntry(word) {
  const url = new URL("https://de.wiktionary.org/w/api.php");
  url.search = new URLSearchParams({
    action: "parse",
    page: word,
    prop: "text",
    format: "json",
    formatversion: "2",
    origin: "*"
  }).toString();

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) throw new Error(`German Wiktionary returned HTTP ${response.status}.`);
  const payload = await response.json();
  const title = payload.parse?.title || word;
  return {
    title,
    ...learning.extractGermanWiktionaryEntry(payload.parse?.text)
  };
}

async function fetchEnglishWiktionaryEntry(word) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) throw new Error(`English Wiktionary returned HTTP ${response.status}.`);
  return learning.extractEnglishWiktionaryEntry(await response.json());
}

function deduplicateExamples(values) {
  const seen = new Set();
  return values.filter((example) => {
    const german = String(example?.german || "").trim();
    if (!german) return false;
    const key = german.toLocaleLowerCase("de");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

async function getSavedWords() {
  const stored = await chrome.storage.local.get(VOCABULARY_KEY);
  const entries = Array.isArray(stored[VOCABULARY_KEY]) ? stored[VOCABULARY_KEY] : [];
  return {
    entries: entries
      .map((entry) => learning.normalizeVocabularyEntry(entry))
      .filter(Boolean)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  };
}

async function saveVocabularyWord(rawEntry) {
  const initiatingActive = await getActive();
  const initiatingId = initiatingActive?.experimentId || null;
  const active = initiatingActive;
  const experiment = active ? await getExperiment(active.experimentId) : null;
  const entry = learning.normalizeVocabularyEntry({
    ...rawEntry,
    video: rawEntry?.video || (experiment?.page?.videoIdentity ? {
      key: experiment.page.videoIdentity,
      title: experiment.page.title,
      url: experiment.page.url,
      platform: experiment.platform
    } : null),
    savedAt: new Date().toISOString()
  });
  if (!entry) throw new Error("Select a German word before saving it.");
  const { entries } = await getSavedWords();
  const updated = [entry, ...entries.filter((item) => item.normalizedWord !== entry.normalizedWord)];
  await chrome.storage.local.set({ [VOCABULARY_KEY]: updated.slice(0, 2_000) });
  const currentActive = await getActive();
  if (currentActive?.experimentId === initiatingId) {
    void broadcastVocabularyUpdate(entry.normalizedWord, true);
  }
  return { entry, saved: true, count: updated.length };
}

async function removeSavedWord(rawWord) {
  const initiatingActive = await getActive();
  const initiatingId = initiatingActive?.experimentId || null;
  const normalized = learning.normalizedWord(rawWord);
  const { entries } = await getSavedWords();
  const updated = entries.filter((entry) => entry.normalizedWord !== normalized);
  await chrome.storage.local.set({ [VOCABULARY_KEY]: updated });
  const currentActive = await getActive();
  if (currentActive?.experimentId === initiatingId) {
    void broadcastVocabularyUpdate(normalized, false);
  }
  return { saved: false, count: updated.length };
}

async function broadcastVocabularyUpdate(normalizedWord, saved) {
  try {
    const active = await getActive();
    if (active) await sendToActiveFrame(active, {
      type: "VOCABULARY_UPDATED",
      word: normalizedWord,
      saved
    });
    // Also notify popup via runtime if needed
    try { await chrome.runtime.sendMessage({ type: "VOCABULARY_UPDATED", word: normalizedWord, saved }); } catch {}
    // Also notify popup via runtime if needed
    try { await chrome.runtime.sendMessage({ type: "VOCABULARY_UPDATED", word: normalizedWord, saved }); } catch {}
  } catch {
    // Popup may be closed
  }
}

function buildYouTubeTimingDiagnostics(experiment, pipeline) {
  if (!experiment || experiment.platform !== "youtube") return null;
  if (pipeline.sourceKind === "youtube-caption-reuse") return null;
  if (!pipeline.diagnostics?.attempts?.length) return null;
  const attempt = pipeline.diagnostics.attempts.find((a) => a.phase === "succeeded");
  if (!attempt) return null;
  const asrSegments = experiment.asrSegments || [];
  if (!asrSegments.length) return null;
  const firstRawWord = asrSegments[0]?.words?.[0];
  const lastRawWord = asrSegments[asrSegments.length - 1]?.words?.at(-1);
  const firstCue = asrSegments[0];
  const lastCue = asrSegments[asrSegments.length - 1];
  const displayGroups = (globalThis.DubTranscriptGroups ? globalThis.DubTranscriptGroups.buildDisplayGroups(experiment.asrSegments || []) : (experiment.displayGroups || []));
  const firstDisplay = displayGroups[0];
  const lastDisplay = displayGroups[displayGroups.length - 1];
  return {
    ytDlpFormatId: attempt.formatId ?? null,
    container: attempt.containerFormat ?? null,
    extension: attempt.mediaExtension ?? null,
    audioCodec: attempt.codec ?? null,
    sampleRate: attempt.sampleRate ?? null,
    detectedLanguage: attempt.detectedLanguage ?? null,
    sourceReportedDuration: attempt.duration ?? null,
    playerDuration: experiment.page?.duration ?? null,
    containerStartTime: attempt.containerStartTime ?? null,
    audioStreamStartTime: attempt.audioStreamStartTime ?? null,
    streamTimeBase: attempt.streamTimeBase ?? null,
    firstDecodedAudioPts: attempt.firstDecodedAudioPts ?? null,
    decodedSampleCount: attempt.decodedSampleCount ?? null,
    decodedAudioDuration: attempt.decodedAudioDuration ?? null,
    firstRawAsrWordTimestamp: firstRawWord ? { start: firstRawWord.start, end: firstRawWord.end, timing: firstRawWord.timing } : null,
    lastRawAsrWordTimestamp: lastRawWord ? { start: lastRawWord.start, end: lastRawWord.end, timing: lastRawWord.timing } : null,
    firstNormalizedCueTimestamp: firstCue ? { start: firstCue.start, end: firstCue.end } : null,
    lastNormalizedCueTimestamp: lastCue ? { start: lastCue.start, end: lastCue.end } : null,
    firstDisplayGroupTimestamp: firstDisplay ? { start: firstDisplay.start, end: firstDisplay.end } : null,
    lastDisplayGroupTimestamp: lastDisplay ? { start: lastDisplay.start, end: lastDisplay.end } : null,
    manualSyncOffset: experiment.settings?.syncOffset || 0,
    referenceCaptionComparison: null
  };
}

async function isVocabularyWordSaved(normalized) {
  const { entries } = await getSavedWords();
  return entries.some((entry) => entry.normalizedWord === normalized);
}

function hasCompleteLiveCoverage(experiment) {
  if (!experiment?.asrSegments?.length) return false;
  const duration = Number(experiment.page?.duration) || 0;
  if (duration <= 0) return false;
  const ranges = mergeCoverageRanges(experiment.audioCoverage || []);
  return ranges.length === 1
    && ranges[0].start <= 1
    && ranges[0].end >= duration - 1;
}

async function saveTranscriptToLibrary(experiment) {
  const identity = experiment?.page?.videoIdentity
    || learning.stableVideoIdentity(experiment?.page?.url, experiment?.audioLanguage);
  const key = learning.transcriptStorageKey(identity);
  const segments = sanitizeTranscriptSegments(selectedTranscriptSegments(experiment));
  if (!identity || !key || !segments.length) return null;
  const duration = Math.max(
    Number(experiment.page?.duration) || 0,
    segments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0)
  );
  const now = new Date().toISOString();
  const source = experiment.transcriptSource || {
    kind: "legacy-local-asr",
    provider: null,
    language: experiment.audioLanguage,
    purpose: "transcript-input",
    timingProvenance: "estimated",
    track: null,
    model: null,
    device: null
  };
  const record = {
    schemaVersion: 1,
    key,
    identity,
    title: experiment.page?.title || "Untitled video",
    url: learning.stablePageUrl(experiment.page?.url),
    platform: experiment.platform || null,
    audioLanguage: experiment.audioLanguage || "de",
    duration: round(duration),
    segmentCount: segments.length,
    sourceExperimentId: experiment.id || null,
    savedAt: now,
    updatedAt: now,
    segments,
    transcriptSource: source
  };
  record.bytes = JSON.stringify(record).length * 2;
  if (record.bytes > TRANSCRIPT_LIBRARY_BYTES_LIMIT) {
    throw new Error("This transcript is too large for the browser-local transcript library.");
  }
  const { entries } = await getTranscriptLibrary();
  const metadata = transcriptLibraryMetadata(record);
  const updated = [metadata, ...entries.filter((entry) => entry.key !== key)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const retained = [];
  let retainedBytes = 0;
  for (const entry of updated) {
    const bytes = Math.max(0, Number(entry.bytes) || 0);
    if (retained.length >= TRANSCRIPT_LIBRARY_LIMIT) continue;
    if (retainedBytes + bytes > TRANSCRIPT_LIBRARY_BYTES_LIMIT) continue;
    retained.push(entry);
    retainedBytes += bytes;
  }
  const retainedKeys = new Set(retained.map((entry) => entry.key));
  const removed = updated.filter((entry) => !retainedKeys.has(entry.key));
  if (!retainedKeys.has(key)) {
    throw new Error("This transcript is too large for the browser-local transcript library.");
  }
  if (removed.length) await chrome.storage.local.remove(removed.map((entry) => entry.key));
  await chrome.storage.local.set({
    [key]: record,
    [TRANSCRIPT_LIBRARY_INDEX_KEY]: retained
  });
  return metadata;
}

async function trySaveTranscriptToLibrary(experiment) {
  try {
    return await saveTranscriptToLibrary(experiment);
  } catch (error) {
    console.warn("Could not add the completed transcript to the reusable library", error);
    return null;
  }
}

function sanitizeTranscriptSegments(rawSegments) {
  return (Array.isArray(rawSegments) ? rawSegments : [])
    .map((segment, index) => {
      const start = Number(segment?.start);
      const end = Number(segment?.end);
      const text = String(segment?.text || "").trim().slice(0, 2_000);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !text) return null;
      const words = (Array.isArray(segment.words) ? segment.words : [])
        .map((word) => ({
          text: String(word?.text || "").trim().slice(0, 100),
          start: round(Number(word?.start)),
          end: round(Number(word?.end))
        }))
        .filter((word) => word.text && Number.isFinite(word.start)
          && Number.isFinite(word.end) && word.end >= word.start);
      return {
        id: String(segment.id || `saved-${index}`),
        start: round(start),
        end: round(end),
        text,
        complete: segment.complete !== false,
        boundary: String(segment.boundary || "sentence").slice(0, 40),
        ...(words.length ? { words } : {})
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

async function getStoredTranscript(identity, sourcePolicy = "youtube-auto-first") {
  const key = learning.transcriptStorageKey(identity);
  if (!key) return null;
  const record = await getTranscriptLibraryRecord(key);
  if (!record || record.identity !== identity) return null;
  const recordSourceKind = record.transcriptSource?.kind || "legacy-local-asr";
  // Cache compatibility: local-asr must not restore youtube-auto-caption records
  if (sourcePolicy === "local-asr" && recordSourceKind === "youtube-auto-caption") {
    return null;
  }
  // youtube-auto-first can restore compatible youtube-auto-caption records
  return record;
}

async function getTranscriptLibraryRecord(key) {
  if (!String(key || "").startsWith("transcript-library:v1:")) return null;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function getTranscriptLibrary() {
  const stored = await chrome.storage.local.get(TRANSCRIPT_LIBRARY_INDEX_KEY);
  const entries = Array.isArray(stored[TRANSCRIPT_LIBRARY_INDEX_KEY])
    ? stored[TRANSCRIPT_LIBRARY_INDEX_KEY]
    : [];
  return {
    entries: entries
      .filter((entry) => String(entry?.key || "").startsWith("transcript-library:v1:"))
      .slice(0, TRANSCRIPT_LIBRARY_LIMIT)
  };
}

function transcriptLibraryMetadata(record) {
  return {
    key: record.key,
    title: record.title,
    url: record.url,
    platform: record.platform,
    audioLanguage: record.audioLanguage,
    duration: record.duration,
    segmentCount: record.segmentCount,
    bytes: record.bytes,
    updatedAt: record.updatedAt
  };
}

async function removeTranscriptLibraryEntry(key) {
  if (!String(key || "").startsWith("transcript-library:v1:")) {
    throw new Error("Invalid saved transcript key.");
  }
  const { entries } = await getTranscriptLibrary();
  await chrome.storage.local.remove(key);
  const updated = entries.filter((entry) => entry.key !== key);
  await chrome.storage.local.set({ [TRANSCRIPT_LIBRARY_INDEX_KEY]: updated });
  return { entries: updated };
}

async function ensureContentScripts(tabId) {
  const diagnostics = {
    mainWorldObserver: { injected: false, frameCount: 0, error: null },
    isolatedBridge: { injected: false, frameCount: 0, error: null },
    application: { injected: false, frameCount: 0, error: null }
  };
  const frameIds = new Set();
  const injections = [
    {
      key: "mainWorldObserver",
      files: ["media-observer-main.js"],
      world: "MAIN"
    },
    {
      key: "isolatedBridge",
      files: ["media-observer-bridge.js"],
      world: "ISOLATED"
    },
    {
      key: "application",
      files: [
        "learning-features.js",
        "transcript-groups.js",
        "media-candidate.js",
        "local-media.js",
        "content.js"
      ],
      world: "ISOLATED"
    }
  ];
  for (const injection of injections) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: injection.files,
        world: injection.world,
        injectImmediately: true
      });
      for (const result of results) frameIds.add(result.frameId);
      diagnostics[injection.key] = {
        injected: true,
        frameCount: results.length,
        error: null
      };
    } catch (error) {
      diagnostics[injection.key].error = diagnosticMessage(error?.message || error);
    }
  }
  if (!frameIds.size) {
    throw new Error(
      diagnostics.application.error
        || "The extension could not inspect any frame in the active video tab."
    );
  }
  return { frameIds: [...frameIds], diagnostics };
}

function mergeMediaCandidateLists(...lists) {
  const unique = new Map();
  for (const candidate of lists.flat()) {
    try {
      const parsed = new URL(String(candidate?.url || ""));
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) continue;
      parsed.hash = "";
      const url = parsed.href;
      const previous = unique.get(url);
      unique.set(url, {
        ...(previous || {}),
        ...candidate,
        url,
        headers: networkMedia.cleanReplayHeaders({
          ...(previous?.headers || {}),
          ...(candidate?.headers || {})
        })
      });
    } catch {
      // Malformed, blob, and non-HTTP values cannot be batch candidates.
    }
  }
  return [...unique.values()].slice(0, 100);
}

function sanitizePageObserverDiagnostics(value) {
  if (!value || typeof value !== "object") return {
    ready: false,
    bridgeVersion: null,
    mainWorldVersion: null,
    candidateCount: 0,
    lastSnapshotAt: null
  };
  return {
    ready: value.ready === true,
    bridgeVersion: Math.max(0, Number(value.bridgeVersion) || 0) || null,
    mainWorldVersion: Math.max(0, Number(value.mainWorldVersion) || 0) || null,
    candidateCount: Math.max(0, Number(value.candidateCount) || 0),
    lastSnapshotAt: Math.max(0, Number(value.lastSnapshotAt) || 0) || null
  };
}

async function findMediaTarget(tabId, frameIds) {
  const candidates = await Promise.all(frameIds.map(async (frameId) => {
    const response = await sendToFrame(tabId, frameId, { type: "GET_MEDIA_CONTEXT" });
    if (!response?.ok || !response.context) return null;
    return { frameId, context: response.context };
  }));
  return candidates
    .filter(Boolean)
    .sort((a, b) => mediaTargetScore(b.context) - mediaTargetScore(a.context))[0]
    || null;
}

function mediaTargetScore(context) {
  const area = Math.max(0, Number(context.width) * Number(context.height)) || 0;
  return (context.paused ? 0 : 1_000_000_000)
    + (context.visible ? 100_000_000 : 0)
    + (Number(context.readyState) > 0 ? 10_000_000 : 0)
    + (Number(context.currentTime) > 0 ? 1_000_000 : 0)
    + area;
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture the user-selected tab audio for a local transcription experiment."
  });
}

async function sendToOffscreen(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return null;
  }
}

async function sendToFrame(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    return null;
  }
}

async function sendToActiveFrame(active, message) {
  return sendToFrame(active.tabId, active.mediaFrameId ?? 0, message);
}

function isActiveMediaFrame(active, tabId, frameId) {
  return Boolean(active)
    && active.tabId === tabId
    && (active.mediaFrameId ?? 0) === (frameId ?? 0);
}

function isLiveMode(active) {
  return Boolean(active) && (!active.mode || active.mode === "live");
}

async function broadcastStatus(status, error = null) {
  try {
    await chrome.runtime.sendMessage({ type: "EXPERIMENT_STATUS", status, error });
  } catch {
    // The popup is usually closed while an experiment runs.
  }
  const active = await getActive();
  if (active) await sendToActiveFrame(active, { type: "STATUS_UPDATE", status, error });
}

async function getActive() {
  const stored = await chrome.storage.session.get(ACTIVE_KEY);
  return stored[ACTIVE_KEY] || null;
}

async function setActive(active) {
  await chrome.storage.session.set({ [ACTIVE_KEY]: active });
}

async function getExperiment(id) {
  const key = `${EXPERIMENT_PREFIX}${id}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || null;
}

async function saveExperiment(experiment) {
  const liveCoverage = audioCoverageRanges.get(experiment.id);
  if (liveCoverage) {
    experiment.audioCoverage = liveCoverage.map((range) => ({ ...range }));
  }
  if (experiment.pipeline?.fallbackReason) {
    experiment.pipeline.fallbackReason = diagnosticMessage(
      experiment.pipeline.fallbackReason
    );
  }
  if (experiment.pipeline?.fallbackError) {
    experiment.pipeline.fallbackError = diagnosticMessage(
      experiment.pipeline.fallbackError
    );
  }
  await chrome.storage.local.set({
    [`${EXPERIMENT_PREFIX}${experiment.id}`]: experiment,
    [LAST_KEY]: experiment.id
  });
}

function createEpoch(mediaStart, playbackRate, reason) {
  return {
    id: crypto.randomUUID(),
    mediaStart: round(Number(mediaStart) || 0),
    playbackRate: Number(playbackRate) || 1,
    anchored: false,
    reason,
    createdAt: new Date().toISOString()
  };
}

function normalizeRuntimeSettings(settings = {}) {
  const rawSource = String(settings.youtubeTranscriptSource || "auto").toLowerCase();
  const canonicalSource = (rawSource === "local" || rawSource === "local-asr")
    ? "local-asr"
    : "youtube-auto-first";
  return {
    serverUrl: String(settings.serverUrl || "").trim(),
    audioLanguage: String(settings.audioLanguage || "de").trim().slice(0, 16) || "de",
    captionLanguage: String(settings.captionLanguage || "de").trim().slice(0, 16) || "de",
    collectCaptions: settings.collectCaptions !== false,
    batchModel: String(settings.batchModel || "small").slice(0, 64),
    syncOffset: normalizeSyncOffset(settings.syncOffset),
    youtubeTranscriptSource: canonicalSource,
    captionPreferences: learning.normalizeCaptionPreferences(settings.captionPreferences),
    translationPreferences: learning.normalizeTranslationPreferences(
      settings.translationPreferences
    )
  };
}

function validateSettings(settings) {
  if (!settings) throw new Error("Experiment settings are missing.");
  const url = new URL(settings.serverUrl);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error("The server URL must use ws:// or wss://.");
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error("For this experiment the transcription server must run locally.");
  }
}

function identifyPlatform(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  return host;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatClock(seconds) {
  const wholeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatMegabytes(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTransferRate(bytesPerSecond) {
  const speed = Math.max(0, Number(bytesPerSecond) || 0);
  if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(0)} KB/s`;
  return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
}

function normalizeSyncOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(Math.max(-3, Math.min(3, number)) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatEvaluationSummary(evaluation) {
  const agreement = Number(evaluation?.metrics?.wordAgreementEstimate);
  if (!Number.isFinite(agreement)) return "";
  return ` Caption agreement estimate: ${(agreement * 100).toFixed(1)}%.`;
}

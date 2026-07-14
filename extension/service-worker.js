const ACTIVE_KEY = "activeExperiment";
const LAST_KEY = "lastExperimentId";
const EXPERIMENT_PREFIX = "experiment:";
const DEFINITION_PREFIX = "definition:de:";
const NATIVE_HOST_NAME = "com.dub_transcript_lab.recognizer";
const mediaClocks = new Map();
const runtimeSampleTimes = new Map();
const audioCoverageRanges = new Map();
const audioCoverageSaveTimes = new Map();
let nativeHostPort = null;
let nativeHostWaiter = null;
let batchNativeMessageQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void stopIfActiveTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") void stopIfActiveTab(tabId);
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
      return lookupGermanWord(message.word);
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
    default:
      return {};
  }
}

async function startSmartExperiment(settings) {
  validateSettings(settings);
  const existing = await getActive();
  if (existing) await stopExperiment();

  const prepared = await prepareMediaTarget();
  const candidate = chooseBatchCandidate(prepared.tab, prepared.mediaTarget.context);
  if (candidate.supported) {
    return startBatchExperiment(settings, prepared, candidate);
  }
  return startLiveExperiment(settings, prepared, candidate.reason);
}

async function prepareMediaTarget() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("http")) {
    throw new Error("Open a normal web video tab before starting the experiment.");
  }
  const frameIds = await ensureContentScripts(tab.id);
  const mediaTarget = await findMediaTarget(tab.id, frameIds);
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
    fallbackReason: null
  });
  const active = {
    experimentId: id,
    tabId: tab.id,
    mediaFrameId: mediaTarget.frameId,
    mode: "batch-analyzing",
    batchJobId: jobId,
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
    segments: []
  });

  try {
    ensureNativeHostPort().postMessage({
      command: "batch_transcribe",
      jobId,
      sourceKind: candidate.sourceKind,
      sourceUrl: candidate.sourceUrl,
      headers: candidate.headers,
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

  await broadcastStatus("Full-video source found. Analyzing the audio locally before playback…");
  return { experimentId: id, mode: "batch" };
}

async function startLiveExperiment(settings, prepared, fallbackReason = null) {
  const { tab, mediaTarget } = prepared;
  await ensureRecognizerRunning(settings.serverUrl);
  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const context = mediaTarget.context;
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const epoch = createEpoch(context.currentTime, context.playbackRate, "start");
  const experiment = createExperimentRecord(id, tab, context, settings, {
    requested: "auto",
    mode: fallbackReason ? "live-fallback" : "live",
    status: "running",
    sourceKind: null,
    sourceHost: null,
    fallbackReason
  });
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
    segments: []
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
  await broadcastStatus(fallbackReason
    ? `Full-video analysis is unavailable (${fallbackReason}). Preparing live transcription automatically.`
    : "Preparing recognizer. The video will start automatically when ready.");
  return { experimentId: id, mode: fallbackReason ? "live-fallback" : "live" };
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
      syncOffset: normalizeSyncOffset(settings.syncOffset)
    },
    pipeline,
    epochs: [],
    asrSegments: [],
    captionSegments: [],
    evaluation: null,
    audioCoverage: [],
    runtimeSamples: []
  };
}

function chooseBatchCandidate(tab, context) {
  if (context.drmProtected) {
    return { supported: false, reason: "the player reported encrypted media" };
  }
  if (identifyPlatform(tab.url) === "youtube") {
    return {
      supported: true,
      sourceKind: "youtube",
      sourceUrl: tab.url,
      headers: {}
    };
  }
  const sourceUrl = (context.batchCandidates || [])
    .find((url) => /^https?:\/\//i.test(url));
  if (!sourceUrl) {
    return {
      supported: false,
      reason: context.sourceKind === "blob"
        ? "the player exposes only a blob stream"
        : "no accessible HTTP media source was detected"
    };
  }
  const headers = {
    "user-agent": context.userAgent || "",
    referer: context.frameUrl || context.frameReferrer || tab.url
  };
  try {
    headers.origin = new URL(context.frameUrl || tab.url).origin;
  } catch {
    // Referer and user agent are sufficient when the frame URL is unusual.
  }
  return { supported: true, sourceKind: "direct", sourceUrl, headers };
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
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
    void broadcastStatus("Starting the local GPU recognizer automatically…");
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
    await fallbackBatchToLive(active, message.message || "the media source could not be analyzed");
  }
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
  experiment.evaluation = message.evaluation || null;
  await saveExperiment(experiment);
  audioCoverageRanges.set(experiment.id, [range]);

  latest.mode = "batch-ready";
  latest.replay = range;
  latest.batchDuration = range.end;
  await setActive(latest);
  await sendToActiveFrame(latest, {
    type: "TRANSCRIPT_UPDATE",
    segments: experiment.asrSegments,
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
  const contextResponse = await sendToActiveFrame(latest, { type: "GET_MEDIA_CONTEXT" });
  if (!contextResponse?.ok || !contextResponse.context) {
    await broadcastStatus(null, `Full-video analysis failed and live fallback could not inspect the player: ${reason}`);
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
    fallbackReason: reason,
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
  await broadcastStatus(`Full-video analysis was unavailable (${reason}). Starting live transcription automatically…`);

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
  if (wasLive) {
    await sendToOffscreen({ type: "OFFSCREEN_STOP" });
    await persistAudioCoverage(active, true);
  }

  const experiment = await getExperiment(active.experimentId);
  if (experiment) {
    experiment.finishedAt = new Date().toISOString();
    await saveExperiment(experiment);
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
  return {
    experiment,
    filename: `dub-transcript-lab/${title}-${id}.json`
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

async function lookupGermanWord(rawWord) {
  const word = String(rawWord || "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}'’-]/gu, "")
    .slice(0, 64);
  if (!word) throw new Error("Select a German word first.");

  const normalized = word.toLocaleLowerCase("de-DE");
  const cacheKey = `${DEFINITION_PREFIX}${normalized}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

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
  if (!response.ok) throw new Error(`Wiktionary returned HTTP ${response.status}.`);
  const payload = await response.json();
  const title = payload.parse?.title || word;
  const result = {
    word,
    title,
    definition: extractGermanMeanings(payload.parse?.text),
    sourceUrl: `https://de.wiktionary.org/wiki/${encodeURIComponent(title)}`,
    fetchedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [cacheKey]: result });
  return result;
}

function extractGermanMeanings(html) {
  const source = String(html || "");
  const germanStart = source.search(/<h2[^>]*>[^<]*(?:<[^>]+>)*[^<]*Deutsch/i);
  const relevant = germanStart >= 0 ? source.slice(germanStart) : source;
  const match = relevant.match(/Bedeutungen:\s*<\/p>\s*<dl>([\s\S]*?)<\/dl>/i);
  if (!match) return null;

  const meanings = [...match[1].matchAll(/<dd>([\s\S]*?)<\/dd>/gi)]
    .slice(0, 3)
    .map((entry) => htmlToPlainText(entry[1]))
    .filter(Boolean);
  return meanings.length ? meanings.join(" ").slice(0, 600) : null;
}

function htmlToPlainText(value) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (entity, name) => namedEntities[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureContentScripts(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["transcript-groups.js", "content.js"]
  });
  return [...new Set(results.map((result) => result.frameId))];
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

let mediaStream = null;
let audioContext = null;
let workletNode = null;
let socket = null;
let socketGeneration = 0;
let captureEnabled = true;
let playing = false;
let configuredForPcm = false;
let settings = null;
let epoch = null;
let epochAnchored = false;
let epochAudioSecondsSent = 0;
let latestMediaClock = null;
let reconnectTimer = null;
let connectionWaitStartedAt = null;
const PCM_CHUNK_SECONDS = 0.5;
const RECONNECT_INTERVAL_MS = 2_000;
const SERVER_WAIT_TIMEOUT_MS = 10 * 60_000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message.type?.startsWith("OFFSCREEN_")) return false;
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      reportStatus(null, error.message);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "OFFSCREEN_START":
      await stopCapture(false);
      settings = message.settings;
      epoch = message.epoch;
      epochAnchored = false;
      epochAudioSecondsSent = 0;
      latestMediaClock = message.mediaClock || null;
      playing = message.playing;
      captureEnabled = true;
      await startCapture(message.streamId);
      return {};
    case "OFFSCREEN_STOP":
      await stopCapture(true);
      return {};
    case "OFFSCREEN_SET_PLAYING":
      playing = message.playing;
      workletNode?.port.postMessage({ type: "reset" });
      return {};
    case "OFFSCREEN_SET_CAPTURE_ENABLED":
      captureEnabled = message.enabled;
      workletNode?.port.postMessage({ type: "reset" });
      return {};
    case "OFFSCREEN_RESET_EPOCH":
      epoch = message.epoch;
      epochAnchored = false;
      epochAudioSecondsSent = 0;
      captureEnabled = true;
      workletNode?.port.postMessage({ type: "reset" });
      await openSocket();
      return {};
    case "OFFSCREEN_MEDIA_CLOCK":
      latestMediaClock = {
        currentTime: Number(message.currentTime) || 0,
        playbackRate: Number(message.playbackRate) || 1
      };
      return {};
    default:
      throw new Error(`Unknown offscreen command: ${message.type}`);
  }
}

async function startCapture(streamId) {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("audio-worklet.js");
  const source = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "pcm16-worklet");
  const silentOutput = audioContext.createGain();
  silentOutput.gain.value = 0;

  // tabCapture removes the tab from normal playback, so route it back to the user.
  source.connect(audioContext.destination);
  source.connect(workletNode).connect(silentOutput).connect(audioContext.destination);

  workletNode.port.onmessage = (event) => {
    if (!playing || !captureEnabled || !configuredForPcm) return;
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (!epochAnchored) anchorEpochToFirstChunk();
    const chunkSeconds = event.data.byteLength / (16_000 * Int16Array.BYTES_PER_ELEMENT);
    const coverageStart = epoch.mediaStart + epochAudioSecondsSent * epoch.playbackRate;
    epochAudioSecondsSent += chunkSeconds;
    const coverageEnd = epoch.mediaStart + epochAudioSecondsSent * epoch.playbackRate;
    socket.send(event.data);
    void chrome.runtime.sendMessage({
      type: "OFFSCREEN_AUDIO_COVERAGE",
      epochId: epoch.id,
      start: round(coverageStart),
      end: round(coverageEnd)
    });
  };

  await audioContext.resume();
  connectionWaitStartedAt = Date.now();
  await openSocket();
  reportStatus("Tab audio is ready; preparing the recognizer.");
}

function anchorEpochToFirstChunk() {
  const playbackRate = latestMediaClock?.playbackRate || epoch.playbackRate || 1;
  const chunkEnd = latestMediaClock?.currentTime ?? epoch.mediaStart;
  const mediaStart = round(Math.max(0, chunkEnd - PCM_CHUNK_SECONDS * playbackRate));
  epoch = { ...epoch, mediaStart, playbackRate, anchored: true };
  epochAnchored = true;
  void chrome.runtime.sendMessage({
    type: "OFFSCREEN_EPOCH_ANCHORED",
    epochId: epoch.id,
    mediaStart,
    playbackRate
  });
}

async function openSocket() {
  const generation = ++socketGeneration;
  configuredForPcm = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  await closeSocket();

  const url = buildSocketUrl(settings.serverUrl, settings.audioLanguage);
  const nextSocket = new WebSocket(url);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (generation === socketGeneration) reportStatus("Recognizer found; waiting for its model.");
  });

  nextSocket.addEventListener("message", (event) => {
    if (generation !== socketGeneration || typeof event.data !== "string") return;
    const payload = JSON.parse(event.data);

    if (payload.type === "config") {
      if (!payload.useAudioWorklet) {
        reportStatus(null, "WhisperLiveKit did not accept PCM input. Start it with --pcm-input.");
        return;
      }
      configuredForPcm = true;
      connectionWaitStartedAt = null;
      reportStatus("Transcribing the played audio.");
      void chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" });
      return;
    }

    if (Array.isArray(payload.lines)) {
      const segments = payload.lines
        .filter((line) => line?.text && Number(line.speaker) !== -2)
        .flatMap((line, lineIndex) => {
          const sourceStart = parseClock(line.start);
          const sourceEnd = parseClock(line.end);
          const cues = DubTranscriptSegmentation.cuesForSourceLine(
            line,
            sourceStart,
            sourceEnd
          );
          return cues.map((cue, cueIndex) => ({
            id: `${epoch.id}:${lineIndex}:${cueIndex}:${cue.start}:${cue.end}`,
            epochId: epoch.id,
            start: round(epoch.mediaStart + cue.start * epoch.playbackRate),
            end: round(epoch.mediaStart + cue.end * epoch.playbackRate),
            text: cue.text,
            speaker: line.speaker,
            rawStart: formatClock(cue.start),
            rawEnd: formatClock(cue.end),
            sourceRawStart: line.start,
            sourceRawEnd: line.end,
            complete: line.complete !== false,
            boundary: line.boundary || null,
            timing: line.timing
              || (cues.length > 1 ? "proportional-within-source-line" : "source-line")
          }));
        })
        .filter((segment) => segment.text && segment.end >= segment.start);

      void chrome.runtime.sendMessage({
        type: "OFFSCREEN_TRANSCRIPT",
        epochId: epoch.id,
        segments,
        buffer: payload.buffer_transcription || "",
        remainingTimeTranscription: payload.remaining_time_transcription ?? null,
        processingLag: payload.remaining_time_transcription_processing
          ?? payload.remaining_time_transcription
          ?? null,
        stabilizationDelay: payload.remaining_time_transcription_policy ?? null
      });
    }
  });

  nextSocket.addEventListener("error", () => {
    if (generation === socketGeneration) {
      reportStatus("Recognizer is still starting; retrying automatically.");
    }
  });

  nextSocket.addEventListener("close", () => {
    if (generation !== socketGeneration) return;
    configuredForPcm = false;
    if (mediaStream && settings) scheduleReconnect(generation);
  });
}

function scheduleReconnect(generation) {
  if (generation !== socketGeneration || !mediaStream) return;
  connectionWaitStartedAt ||= Date.now();
  const elapsed = Date.now() - connectionWaitStartedAt;
  if (elapsed >= SERVER_WAIT_TIMEOUT_MS) {
    reportStatus(null, "The local recognizer did not become ready within 10 minutes.");
    return;
  }

  const elapsedSeconds = Math.floor(elapsed / 1000);
  reportStatus(`Preparing recognizer… retrying automatically (${elapsedSeconds}s).`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (generation === socketGeneration && mediaStream) void openSocket();
  }, RECONNECT_INTERVAL_MS);
}

async function closeSocket(signalEnd = false) {
  const current = socket;
  socket = null;
  if (!current) return;
  if (signalEnd && current.readyState === WebSocket.OPEN) current.send(new ArrayBuffer(0));
  current.close();
}

async function stopCapture(signalEnd) {
  socketGeneration += 1;
  configuredForPcm = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  connectionWaitStartedAt = null;
  await closeSocket(signalEnd);
  workletNode?.disconnect();
  workletNode = null;
  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  audioContext = null;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

function buildSocketUrl(baseUrl, language) {
  const url = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error("This experiment only connects to a local transcription server.");
  }
  url.searchParams.set("language", language);
  url.searchParams.set("mode", "full");
  return url.toString();
}

function parseClock(value) {
  if (typeof value === "number") return value;
  const parts = String(value || "0").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0);
}

function formatClock(value) {
  const total = Math.max(0, Number(value) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toFixed(3).padStart(6, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function reportStatus(status, error = null) {
  void chrome.runtime.sendMessage({ type: "OFFSCREEN_STATUS", status, error });
}

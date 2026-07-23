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
let batchDecodeController = null;
const translators = new Map();
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
      batchDecodeController?.abort();
      batchDecodeController = null;
      await stopCapture(true);
      return {};
    case "OFFSCREEN_DECODE_BATCH_AUDIO":
      batchDecodeController?.abort();
      batchDecodeController = new AbortController();
      void decodeBrowserBatchAudio(message, batchDecodeController.signal)
        .catch((error) => chrome.runtime.sendMessage({
          type: "BROWSER_BATCH_ERROR",
          jobId: message.jobId,
          error: error.name === "AbortError" ? "Browser audio decoding was cancelled." : error.message
        }));
      return { started: true };
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
    case "OFFSCREEN_TRANSLATE_TEXT":
      return translateWithBrowser(message);
    default:
      throw new Error(`Unknown offscreen command: ${message.type}`);
  }
}

async function decodeBrowserBatchAudio(message, signal) {
  const candidates = normalizeBrowserAudioCandidates(message);
  const failures = [];
  for (const [index, candidate] of candidates.entries()) {
    const candidateMessage = {
      ...message,
      ...candidate,
      sourceUrl: candidate.url,
      candidateIndex: index + 1,
      candidateCount: candidates.length
    };
    const sourceHost = new URL(candidate.url).hostname.toLowerCase();
    await sendBrowserBatchMessage({
      type: "BROWSER_BATCH_PROGRESS",
      jobId: message.jobId,
      phase: "preparing",
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      sourceHost,
      codecHint: candidate.codec || null,
      profileHint: candidate.profile || null
    });
    try {
      await decodeBrowserBatchAudioCandidate(candidateMessage, signal);
      return;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const category = browserAudioFailureCategory(error);
      failures.push(`candidate ${index + 1}: ${error.message || error.name}`);
      await sendBrowserBatchMessage({
        type: "BROWSER_BATCH_PROGRESS",
        jobId: message.jobId,
        phase: "candidate-failed",
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        sourceHost,
        codecHint: candidate.codec || null,
        profileHint: candidate.profile || null,
        category,
        error: error.message || error.name,
        receivedBytes: error.receivedBytes || null,
        expectedBytes: error.expectedBytes || null,
        coverageRatio: error.coverageRatio ?? null,
        strategy: error.strategy || null,
        webCodecsSupported: error.webCodecsSupported
      });
    }
  }
  throw new Error(`All ${candidates.length} Netflix audio representations failed. ${failures.join(" | ")}`);
}

function normalizeBrowserAudioCandidates(message) {
  const raw = Array.isArray(message.sourceCandidates) && message.sourceCandidates.length
    ? message.sourceCandidates
    : [{ url: message.sourceUrl }];
  const unique = new Map();
  for (const value of raw) {
    try {
      const parsed = new URL(String(value?.url || value || ""));
      const host = parsed.hostname.toLowerCase();
      if (
        parsed.protocol !== "https:"
        || (host !== "nflxvideo.net" && !host.endsWith(".nflxvideo.net"))
      ) continue;
      parsed.hash = "";
      if (!unique.has(parsed.href)) unique.set(parsed.href, {
        ...(typeof value === "object" ? value : {}),
        url: parsed.href
      });
    } catch {
      // Ignore malformed or non-Netflix candidates.
    }
  }
  const candidates = [...unique.values()].slice(0, 10);
  if (!candidates.length) {
    throw new Error("The browser decoder accepts only HTTPS Netflix media CDN audio.");
  }
  return candidates;
}

function browserAudioFailureCategory(error) {
  const detail = String(error?.message || "").toLowerCase();
  if (detail.includes("incomplete") || detail.includes("does not match the active video")) {
    return "incomplete-download";
  }
  if (detail.includes("webcodecs") || detail.includes("decode") || detail.includes("codec")) {
    return "decoder-unsupported";
  }
  if (detail.includes("http") || detail.includes("empty audio")) return "download-failed";
  return "browser-audio-failed";
}

function parseContentRange(value) {
  const match = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match || match[3] === "*") return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total)
    && start >= 0 && end >= start && total > end
    ? { start, end, total }
    : null;
}

async function decodeBrowserBatchAudioCandidate(message, signal) {
  const sourceUrl = new URL(String(message.sourceUrl || ""));
  const sourceHost = sourceUrl.hostname.toLowerCase();
  if (
    sourceUrl.protocol !== "https:"
    || (sourceHost !== "nflxvideo.net" && !sourceHost.endsWith(".nflxvideo.net"))
  ) {
    throw new Error("The browser decoder accepts only HTTPS Netflix media CDN audio.");
  }
  const response = await fetch(sourceUrl.href, {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "audio/mp4,video/mp4,application/octet-stream,*/*" },
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`Netflix audio returned HTTP ${response.status || "unknown"} to Chrome.`);
  }
  const totalBytes = Math.max(0, Number(response.headers.get("content-length")) || 0);
  const contentRange = String(response.headers.get("content-range") || "").slice(0, 128);
  const maximumBytes = 256 * 1024 * 1024;
  if (totalBytes > maximumBytes) throw new Error("The Netflix audio file exceeds the 256 MB browser-decoder limit.");
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  let lastReportedPercent = -5;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) throw new Error("The Netflix audio file exceeded the 256 MB browser-decoder limit.");
    chunks.push(value);
    const percent = totalBytes ? Math.min(100, receivedBytes / totalBytes * 100) : null;
    if (percent == null || percent >= lastReportedPercent + 5) {
      await sendBrowserBatchMessage({
        type: "BROWSER_BATCH_PROGRESS",
        jobId: message.jobId,
        phase: "downloading",
        percent,
        receivedBytes,
        totalBytes: totalBytes || null,
        candidateIndex: message.candidateIndex,
        candidateCount: message.candidateCount,
        sourceHost,
        codecHint: message.codec || null,
        profileHint: message.profile || null,
        responseStatus: response.status,
        contentRange
      });
      if (percent != null) lastReportedPercent = percent;
    }
  }
  const initialRange = parseContentRange(contentRange);
  if (
    initialRange
    && initialRange.start === 0
    && initialRange.end + 1 === receivedBytes
    && initialRange.total > receivedBytes
  ) {
    if (initialRange.total > maximumBytes) {
      throw new Error("The complete Netflix audio range exceeds the 256 MB browser-decoder limit.");
    }
    const continuation = await fetch(sourceUrl.href, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: "audio/mp4,video/mp4,application/octet-stream,*/*",
        Range: `bytes=${receivedBytes}-`
      },
      signal
    });
    const continuationRange = parseContentRange(continuation.headers.get("content-range"));
    if (
      continuation.ok
      && continuation.body
      && continuation.status === 206
      && continuationRange?.start === receivedBytes
      && continuationRange.total === initialRange.total
    ) {
      const continuationReader = continuation.body.getReader();
      while (true) {
        const { done, value } = await continuationReader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        receivedBytes += value.byteLength;
        if (receivedBytes > maximumBytes) {
          throw new Error("The Netflix audio file exceeded the 256 MB browser-decoder limit.");
        }
        chunks.push(value);
        await sendBrowserBatchMessage({
          type: "BROWSER_BATCH_PROGRESS",
          jobId: message.jobId,
          phase: "downloading",
          percent: Math.min(100, receivedBytes / initialRange.total * 100),
          receivedBytes,
          totalBytes: initialRange.total,
          candidateIndex: message.candidateIndex,
          candidateCount: message.candidateCount,
          sourceHost,
          codecHint: message.codec || null,
          profileHint: message.profile || null,
          responseStatus: continuation.status,
          contentRange: continuation.headers.get("content-range") || contentRange,
          strategy: "HTTP range reconstruction"
        });
      }
    }
  }
  if (!receivedBytes) throw new Error("Netflix returned an empty audio file to Chrome.");

  const durationHint = Math.max(0, Number(message.durationHint) || 0);
  const rawBitrate = Math.max(0, Number(message.bitrate) || 0);
  const bitrate = rawBitrate && rawBitrate < 1_000 ? rawBitrate * 1_000 : rawBitrate;
  const bitrateExpectedBytes = bitrate && durationHint >= 60
    ? Math.round(bitrate * durationHint / 8)
    : 0;
  const expectedBytes = initialRange?.total || bitrateExpectedBytes;
  const coverageRatio = expectedBytes ? receivedBytes / expectedBytes : null;
  if (expectedBytes && coverageRatio < 0.35) {
    const error = new Error(
      `The CDN response is incomplete: ${receivedBytes} bytes received, about ${expectedBytes} expected for this representation.`
    );
    Object.assign(error, { receivedBytes, expectedBytes, coverageRatio, strategy: "download-validation" });
    throw error;
  }

  const compressed = new Uint8Array(receivedBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  await sendBrowserBatchMessage({
    type: "BROWSER_BATCH_PROGRESS",
    jobId: message.jobId,
    phase: "decoding",
    percent: null,
    receivedBytes,
    totalBytes: totalBytes || receivedBytes,
    expectedBytes: expectedBytes || null,
    coverageRatio,
    candidateIndex: message.candidateIndex,
    candidateCount: message.candidateCount,
    sourceHost,
    codecHint: message.codec || null,
    profileHint: message.profile || null,
    responseStatus: response.status,
    contentRange,
    strategy: "decodeAudioData"
  });

  if (!("OfflineAudioContext" in globalThis)) {
    throw new Error("This Chrome build does not expose OfflineAudioContext.");
  }
  const targetSampleRate = 16_000;
  const decoderContext = new OfflineAudioContext(1, 1, targetSampleRate);
  let audioBuffer;
  try {
    // decodeAudioData may detach its input. Keep the original bytes for the WebCodecs retry.
    audioBuffer = await decoderContext.decodeAudioData(compressed.buffer.slice(0));
  } catch (decodeAudioDataError) {
    try {
      audioBuffer = await decodeMp4WithWebCodecs(compressed.buffer, signal, {
        ...message,
        sourceHost,
        receivedBytes,
        expectedBytes,
        coverageRatio
      });
    } catch (webCodecsError) {
      const error = new Error(
        `decodeAudioData failed (${decodeAudioDataError.message || decodeAudioDataError.name}); `
        + `WebCodecs failed (${webCodecsError.message || webCodecsError.name}).`
      );
      Object.assign(error, {
        receivedBytes,
        expectedBytes,
        coverageRatio,
        strategy: "decodeAudioData + WebCodecs",
        webCodecsSupported: webCodecsError.webCodecsSupported
      });
      throw error;
    }
  }
  if (!audioBuffer.length || !audioBuffer.numberOfChannels) {
    throw new Error("Chrome decoded no audio samples from the Netflix file.");
  }
  if (durationHint >= 60) {
    const ratio = audioBuffer.duration / durationHint;
    if (ratio < 0.70 || ratio > 1.30) {
      throw new Error(
        `Chrome decoded ${audioBuffer.duration.toFixed(1)}s, which does not match the active video (${durationHint.toFixed(1)}s).`
      );
    }
  }

  await sendBrowserBatchMessage({
    type: "BROWSER_BATCH_PCM_BEGIN",
    jobId: message.jobId,
    sampleRate: audioBuffer.sampleRate,
    channels: 1,
    duration: audioBuffer.duration,
    totalFrames: audioBuffer.length
  });
  const channelData = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_unused, index) => audioBuffer.getChannelData(index)
  );
  const framesPerChunk = 128 * 1024;
  let pcmBytesSent = 0;
  let lastPcmPercent = -5;
  for (let start = 0; start < audioBuffer.length; start += framesPerChunk) {
    if (signal.aborted) throw new DOMException("Browser audio decoding was cancelled.", "AbortError");
    const frameCount = Math.min(framesPerChunk, audioBuffer.length - start);
    const pcm = new Int16Array(frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      let mixed = 0;
      for (const channel of channelData) mixed += channel[start + frame] || 0;
      mixed = Math.max(-1, Math.min(1, mixed / channelData.length));
      pcm[frame] = mixed < 0 ? Math.round(mixed * 32768) : Math.round(mixed * 32767);
    }
    const bytes = new Uint8Array(pcm.buffer);
    await sendBrowserBatchMessage({
      type: "BROWSER_BATCH_PCM_CHUNK",
      jobId: message.jobId,
      data: bytesToBase64(bytes)
    });
    pcmBytesSent += bytes.byteLength;
    const percent = Math.min(100, (start + frameCount) / audioBuffer.length * 100);
    if (percent >= lastPcmPercent + 5 || percent >= 100) {
      await sendBrowserBatchMessage({
        type: "BROWSER_BATCH_PROGRESS",
        jobId: message.jobId,
        phase: "sending-pcm",
        percent,
        decodedDuration: audioBuffer.duration,
        pcmBytesSent
      });
      lastPcmPercent = percent;
    }
  }
  await sendBrowserBatchMessage({ type: "BROWSER_BATCH_PCM_FINISH", jobId: message.jobId });
  if (batchDecodeController?.signal === signal) batchDecodeController = null;
}

async function decodeMp4WithWebCodecs(arrayBuffer, signal, context) {
  if (!("AudioDecoder" in globalThis) || !("EncodedAudioChunk" in globalThis)) {
    const error = new Error("This Chrome build does not expose the WebCodecs AudioDecoder.");
    error.webCodecsSupported = false;
    throw error;
  }
  const moduleUrl = chrome.runtime.getURL("vendor/mp4box.all.mjs");
  const { createFile } = await import(moduleUrl);
  const extracted = await extractMp4AudioSamples(createFile, arrayBuffer);
  if (!extracted.samples.length) throw new Error("MP4Box found no encoded audio samples.");

  const firstDescription = extracted.samples[0]?.description;
  const entry = firstDescription || extracted.sampleEntry;
  const esds = entry?.esds || entry?.wave?.esds;
  const decoderConfigDescriptor = esds?.esd?.findDescriptor?.(4);
  const decoderSpecificInfo = decoderConfigDescriptor?.findDescriptor?.(5)?.data;
  const description = decoderSpecificInfo?.byteLength
    ? new Uint8Array(decoderSpecificInfo).slice()
    : null;
  const codec = String(extracted.track.codec || inferAacCodec(context)).trim();
  if (!codec) throw new Error("MP4Box could not identify the audio codec string.");
  if (/^mp4a/i.test(codec) && !description) {
    throw new Error("MP4Box found AAC samples but no AudioSpecificConfig for WebCodecs.");
  }
  const config = {
    codec,
    sampleRate: Math.max(8_000, Number(extracted.track.audio?.sample_rate) || 48_000),
    numberOfChannels: Math.max(1, Number(extracted.track.audio?.channel_count) || 2),
    ...(description ? { description } : {})
  };
  const support = await AudioDecoder.isConfigSupported(config);
  if (!support?.supported) {
    const error = new Error(`WebCodecs reports ${codec} as unsupported on this computer.`);
    error.webCodecsSupported = false;
    throw error;
  }
  await sendBrowserBatchMessage({
    type: "BROWSER_BATCH_PROGRESS",
    jobId: context.jobId,
    phase: "decoding",
    strategy: `WebCodecs ${codec}`,
    webCodecsSupported: true,
    candidateIndex: context.candidateIndex,
    candidateCount: context.candidateCount,
    sourceHost: context.sourceHost,
    codecHint: codec,
    profileHint: context.profile || null,
    receivedBytes: context.receivedBytes,
    expectedBytes: context.expectedBytes || null,
    coverageRatio: context.coverageRatio
  });

  const targetSampleRate = 16_000;
  const outputChunks = [];
  let outputFrames = 0;
  let outputError = null;
  let sourceSampleRate = null;
  let resampler = null;
  const decoder = new AudioDecoder({
    output(audioData) {
      try {
        if (signal.aborted) throw new DOMException("Browser audio decoding was cancelled.", "AbortError");
        if (sourceSampleRate == null) {
          sourceSampleRate = audioData.sampleRate;
          resampler = new StreamingMonoResampler(sourceSampleRate, targetSampleRate);
        } else if (audioData.sampleRate !== sourceSampleRate) {
          throw new Error(
            `WebCodecs changed sample rate from ${sourceSampleRate} to ${audioData.sampleRate} Hz mid-stream.`
          );
        }
        const mono = copyAudioDataToMono(audioData);
        const output = resampler.push(mono);
        if (output.length) {
          outputChunks.push(output);
          outputFrames += output.length;
        }
      } catch (error) {
        outputError ||= error;
      } finally {
        audioData.close();
      }
    },
    error(error) {
      outputError ||= error;
    }
  });
  decoder.configure(support.config || config);
  try {
    for (const sample of extracted.samples) {
      if (signal.aborted) throw new DOMException("Browser audio decoding was cancelled.", "AbortError");
      if (!sample.data?.byteLength) continue;
      decoder.decode(new EncodedAudioChunk({
        type: "key",
        timestamp: Math.max(0, Math.round(sample.cts / sample.timescale * 1_000_000)),
        duration: Math.max(0, Math.round(sample.duration / sample.timescale * 1_000_000)),
        data: sample.data
      }));
      while (decoder.decodeQueueSize > 80) {
        await waitForDecoderDequeue(decoder, signal);
        if (outputError) throw outputError;
      }
    }
    await decoder.flush();
    if (outputError) throw outputError;
    const finalChunk = resampler?.finish() || new Float32Array(0);
    if (finalChunk.length) {
      outputChunks.push(finalChunk);
      outputFrames += finalChunk.length;
    }
  } catch (error) {
    error.webCodecsSupported = true;
    throw error;
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
  if (!outputFrames) throw new Error("WebCodecs decoded no audio frames.");
  const mono = new Float32Array(outputFrames);
  let offset = 0;
  for (const chunk of outputChunks) {
    mono.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    sampleRate: targetSampleRate,
    numberOfChannels: 1,
    length: mono.length,
    duration: mono.length / targetSampleRate,
    getChannelData() { return mono; }
  };
}

function inferAacCodec(context) {
  const text = `${context.codec || ""} ${context.profile || ""}`.toLowerCase();
  if (/xhe|x-he|usac|mp4a\.40\.42/.test(text)) return "mp4a.40.42";
  if (/heaac|he-aac|mp4a\.40\.5/.test(text)) return "mp4a.40.5";
  if (/aac|mp4a/.test(text)) return "mp4a.40.2";
  return "";
}

function extractMp4AudioSamples(createFile, sourceBuffer) {
  return new Promise((resolve, reject) => {
    const file = createFile(true);
    const samples = [];
    let track = null;
    let sampleEntry = null;
    let ready = false;
    file.onError = (error) => reject(new Error(`MP4Box could not parse the audio file: ${error}`));
    file.onReady = (info) => {
      track = info.audioTracks?.[0] || info.tracks?.find((value) => value.audio);
      if (!track) {
        reject(new Error("MP4Box found no audio track in the downloaded MP4."));
        return;
      }
      sampleEntry = file.getTrackById(track.id)?.mdia?.minf?.stbl?.stsd?.entries?.[0] || null;
      file.setExtractionOptions(track.id, null, {
        nbSamples: 1_000,
        rapAlignement: false
      });
      file.start();
      ready = true;
    };
    file.onSamples = (_trackId, _user, batch) => samples.push(...batch);
    try {
      const buffer = sourceBuffer.slice(0);
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
    } catch (error) {
      reject(new Error(`MP4Box failed while reconstructing the MP4 fragments: ${error.message || error}`));
      return;
    }
    setTimeout(() => {
      if (!ready) reject(new Error("MP4Box did not find a complete MP4 initialization section."));
      else resolve({ file, track, sampleEntry, samples });
    }, 0);
  });
}

function copyAudioDataToMono(audioData) {
  const channels = Math.max(1, audioData.numberOfChannels);
  const mono = new Float32Array(audioData.numberOfFrames);
  for (let channel = 0; channel < channels; channel += 1) {
    const plane = new Float32Array(audioData.numberOfFrames);
    audioData.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
    for (let index = 0; index < mono.length; index += 1) mono[index] += plane[index] / channels;
  }
  return mono;
}

class StreamingMonoResampler {
  constructor(sourceRate, targetRate) {
    this.ratio = sourceRate / targetRate;
    this.buffer = new Float32Array(0);
    this.position = 0;
  }

  push(input) {
    const combined = new Float32Array(this.buffer.length + input.length);
    combined.set(this.buffer);
    combined.set(input, this.buffer.length);
    const values = [];
    while (this.position + 1 < combined.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      values.push(combined[left] + (combined[left + 1] - combined[left]) * fraction);
      this.position += this.ratio;
    }
    const drop = Math.min(Math.floor(this.position), Math.max(0, combined.length - 1));
    this.buffer = combined.slice(drop);
    this.position -= drop;
    return Float32Array.from(values);
  }

  finish() {
    if (!this.buffer.length) return new Float32Array(0);
    const values = [];
    while (this.position < this.buffer.length) {
      values.push(this.buffer[Math.min(this.buffer.length - 1, Math.round(this.position))]);
      this.position += this.ratio;
    }
    this.buffer = new Float32Array(0);
    return Float32Array.from(values);
  }
}

function waitForDecoderDequeue(decoder, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Browser audio decoding was cancelled.", "AbortError"));
      return;
    }
    const timeout = setTimeout(done, 50);
    function done() {
      clearTimeout(timeout);
      decoder.removeEventListener("dequeue", done);
      resolve();
    }
    decoder.addEventListener("dequeue", done, { once: true });
  });
}

async function sendBrowserBatchMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The local browser-audio bridge rejected a message.");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function translateWithBrowser(message) {
  if (!("Translator" in globalThis)) {
    throw new Error("This browser does not expose the on-device Translator API.");
  }
  const text = String(message.text || "").trim();
  const sourceLanguage = String(message.sourceLanguage || "de").toLowerCase();
  const targetLanguage = String(message.targetLanguage || "en").toLowerCase();
  if (!text) return { translatedText: "", provider: "browser" };
  const key = `${sourceLanguage}:${targetLanguage}`;
  let translator = translators.get(key);
  if (!translator) {
    const availability = await globalThis.Translator.availability({
      sourceLanguage,
      targetLanguage
    });
    if (availability === "unavailable") {
      throw new Error(`On-device ${sourceLanguage}→${targetLanguage} translation is unavailable.`);
    }
    translator = await globalThis.Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          const percent = Math.round(Math.max(0, Math.min(1, Number(event.loaded) || 0)) * 100);
          reportStatus(`Downloading the on-device translation model… ${percent}%`);
        });
      }
    });
    translators.set(key, translator);
  }
  return {
    translatedText: await translator.translate(text),
    provider: "browser"
  };
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

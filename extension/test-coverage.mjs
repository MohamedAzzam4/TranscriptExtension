import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const listener = { addListener() {} };
let context;
context = vm.createContext({
  importScripts(...files) {
    for (const file of files) {
      const imported = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      vm.runInContext(imported, context, { filename: file });
    }
  },
  chrome: {
    runtime: { onMessage: listener },
    tabs: { onRemoved: listener, onUpdated: listener }
  },
  console,
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams
});

const source = fs.readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "service-worker.js" });

function evaluate(expression) {
  return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

assert.deepEqual(
  evaluate("mergeCoverageRanges([{start: 0, end: 0.5}, {start: 0.5, end: 1}, {start: 1.2, end: 1.7}])"),
  [{ start: 0, end: 1.7 }],
  "PCM chunks and small scheduling gaps should become one cached range"
);

const replayFromSilence = evaluate(
  "findCoveredRange([{start: 0, end: 30}], [{start: 5, end: 8}], 22)"
);
assert.deepEqual(
  replayFromSilence,
  { start: 0, end: 30 },
  "a rewind into analyzed silence should use audio coverage, not retranscribe"
);
assert.deepEqual(
  evaluate("findCoveredRange([{start: 0, end: 30}], [{start: 5, end: 8}], 22)"),
  replayFromSilence,
  "repeating the same rewind should keep using the same cached range"
);

assert.deepEqual(
  evaluate("findCoveredRange([], [{start: 0, end: 10}, {start: 12, end: 20}], 11)"),
  { start: 0, end: 20 },
  "older experiments should retain the speech-segment fallback"
);
assert.equal(
  evaluate("findCoveredRange([{start: 0, end: 30}], [], 40)"),
  null,
  "audio that was never analyzed must start a new recognition epoch"
);

assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://www.youtube.com/watch?v=public"},
    {drmProtected: false, sourceKind: "blob", batchCandidates: []}
  )`),
  {
    supported: true,
    sourceKind: "youtube",
    sourceUrl: "https://www.youtube.com/watch?v=public",
    headers: {}
  },
  "YouTube pages should use the page-level batch adapter even when the video element is a blob"
);
assert.equal(
  evaluate(`chooseBatchCandidate(
    {url: "https://video.example/watch"},
    {drmProtected: true, batchCandidates: ["https://cdn.example/video.mp4"]}
  )`).supported,
  false,
  "encrypted media must never be sent to the batch downloader"
);
assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://www.netflix.com/watch/123"},
    {
      drmProtected: true,
      batchCandidates: [
        {
          url: "https://cdn-english.nflxvideo.net/?o=one&v=two",
          kind: "netflix-audio",
          source: "netflix-player-metadata",
          language: "eng",
          bitrate: 128000
        },
        {
          url: "https://cdn-german.nflxvideo.net/?o=three&v=four",
          kind: "netflix-audio",
          source: "netflix-player-metadata",
          language: "deu",
          bitrate: 96000
        }
      ],
      frameUrl: "https://www.netflix.com/watch/123",
      userAgent: "Test Browser"
    },
    "de"
  )`),
  {
    supported: true,
    sourceKind: "direct",
    discoveryKind: "netflix-audio",
    sourceUrl: "https://cdn-german.nflxvideo.net/?o=three&v=four",
    sourceCandidates: [{
      url: "https://cdn-german.nflxvideo.net/?o=three&v=four",
      kind: "netflix-audio",
      source: "netflix-player-metadata",
      language: "deu",
      bitrate: 96000
    }],
    headers: {
      "user-agent": "Test Browser",
      referer: "https://www.netflix.com/watch/123",
      origin: "https://www.netflix.com"
    }
  },
  "a clear German Netflix audio URL from player metadata should pass the video DRM gate"
);
assert.equal(
  evaluate(`chooseBatchCandidate(
    {url: "https://www.netflix.com/watch/123"},
    {
      drmProtected: true,
      batchCandidates: [{
        url: "https://attacker.example/audio.mp4",
        kind: "netflix-audio",
        source: "netflix-player-metadata",
        language: "deu"
      }]
    },
    "de"
  )`).supported,
  false,
  "the Netflix DRM exception must reject non-Netflix media hosts"
);
assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://www.netflix.com/watch/123"},
    {
      drmProtected: true,
      batchCandidates: [{
        url: "https://cdn-english.nflxvideo.net/?o=one&v=two",
        kind: "netflix-audio",
        source: "netflix-player-metadata",
        language: "eng"
      }]
    },
    "de"
  )`),
  {
    supported: false,
    reason: "no clear Netflix audio track matched de"
  },
  "Netflix must fall back to live capture instead of transcribing the wrong dub"
);
assert.deepEqual(
  evaluate(`chooseBatchCandidate(
    {url: "https://video.example/watch"},
    {
      drmProtected: false,
      batchCandidates: ["https://cdn.example/master.m3u8"],
      frameUrl: "https://player.example/embed/1",
      userAgent: "Test Browser"
    }
  )`),
  {
    supported: true,
    sourceKind: "direct",
    discoveryKind: "hls",
    sourceUrl: "https://cdn.example/master.m3u8",
    sourceCandidates: [{
      url: "https://cdn.example/master.m3u8",
      kind: "hls",
      source: "legacy"
    }],
    headers: {
      "user-agent": "Test Browser",
      referer: "https://player.example/embed/1",
      origin: "https://player.example"
    }
  },
  "a direct non-DRM HLS source should be eligible for local batch analysis"
);

assert.deepEqual(
  evaluate(`rankBatchCandidates([
    {url: "https://cdn.example/advert.m3u8", kind: "hls", source: "fetch-response"},
    {url: "https://cdn.example/movie.mp4", kind: "media", source: "current-src"},
    {url: "https://cdn.example/de/audio/master.m3u8", kind: "hls", source: "xhr-response"},
    {url: "https://cdn.example/subtitles-de.vtt", kind: "unknown-media", source: "performance"}
  ], "de")`),
  [
    {url: "https://cdn.example/de/audio/master.m3u8", kind: "hls", source: "xhr-response"},
    {url: "https://cdn.example/movie.mp4", kind: "media", source: "current-src"},
    {url: "https://cdn.example/advert.m3u8", kind: "hls", source: "fetch-response"}
  ],
  "audio-language manifests should outrank direct video and advertisements"
);

assert.deepEqual(
  evaluate(`rankBatchCandidates([
    {
      url: "https://xhe.nflxvideo.net/?o=one",
      kind: "netflix-audio",
      source: "netflix-player-metadata",
      language: "deu",
      codec: "aac",
      profile: "xhe-aac-dash",
      bitrate: 160000
    },
    {
      url: "https://heaac.nflxvideo.net/?o=two",
      kind: "netflix-audio",
      source: "netflix-player-metadata",
      language: "deu",
      codec: "aac",
      profile: "heaac-2-dash",
      bitrate: 96000,
      channels: 2
    }
  ], "de")`),
  [
    {
      url: "https://heaac.nflxvideo.net/?o=two",
      kind: "netflix-audio",
      source: "netflix-player-metadata",
      language: "deu",
      codec: "aac",
      profile: "heaac-2-dash",
      channels: 2,
      bitrate: 96000
    },
    {
      url: "https://xhe.nflxvideo.net/?o=one",
      kind: "netflix-audio",
      source: "netflix-player-metadata",
      language: "deu",
      codec: "aac",
      profile: "xhe-aac-dash",
      bitrate: 160000
    }
  ],
  "locally decodable HE-AAC should be tried before xHE-AAC even at a lower bitrate"
);

const selectedTrackRanking = evaluate(`rankBatchCandidates([
  {
    url: "https://main.nflxvideo.net/?o=main",
    kind: "netflix-audio",
    source: "netflix-player-metadata",
    language: "deu",
    trackId: "main-track",
    role: "main",
    selected: false,
    codec: "aac",
    profile: "heaac-2-dash"
  },
  {
    url: "https://ad.nflxvideo.net/?o=ad",
    kind: "netflix-audio",
    source: "netflix-player-metadata",
    language: "deu",
    trackId: "ad-track",
    role: "audio-description",
    selected: true,
    codec: "aac",
    profile: "xhe-aac-dash"
  }
], "de")`);
assert.equal(selectedTrackRanking[0].trackId, "ad-track");
assert.equal(selectedTrackRanking[0].role, "audio-description");
const exactSelectedTrack = evaluate(`chooseBatchCandidate(
  {url: "https://www.netflix.com/watch/123"},
  {
    drmProtected: true,
    frameUrl: "https://www.netflix.com/watch/123",
    batchCandidates: ${JSON.stringify(selectedTrackRanking)}
  },
  "de"
)`);
assert.equal(exactSelectedTrack.sourceCandidates.length, 1);
assert.equal(exactSelectedTrack.sourceCandidates[0].trackId, "ad-track");
assert.match(
  evaluate(`transcriptIdentityForCandidate(
    "https://www.netflix.com/watch/123",
    "de",
    {supported: true, sourceCandidates: [${JSON.stringify(selectedTrackRanking[0])}]}
  )`),
  /track:ad-track\|role:audio-description$/,
  "the cache identity must distinguish the selected audio-description track"
);

assert.equal(
  evaluate(`batchFailureCategory({
    message: "[Errno 1163346256] Not yet implemented in FFmpeg, patches welcome: 'avcodec_send_packet()'"
  })`),
  "decoder-unsupported",
  "the raw Netflix FFmpeg PatchWelcome error must trigger the Chrome/Windows decoder"
);
assert.equal(
  evaluate(`batchFailureCategory({
    category: "protected-media",
    message: "xHE-AAC was mentioned only as context"
  })`),
  "protected-media",
  "an explicit native-worker category must take precedence"
);
assert.equal(
  evaluate(`batchFailureCategory({ message: "The Netflix CDN request timed out." })`),
  null,
  "ordinary network errors must not be misclassified as decoder incompatibility"
);

console.log("Replay coverage tests passed");

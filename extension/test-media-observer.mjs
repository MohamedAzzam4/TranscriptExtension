import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const messages = [];

class FakeXMLHttpRequest {
  addEventListener() {}
  open() {}
}

class FakeHTMLMediaElement {
  setMediaKeys() {
    return Promise.resolve();
  }
}

class FakePerformanceObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}
}

const sandbox = {
  console,
  URL,
  location: {
    hostname: "www.netflix.com",
    href: "https://www.netflix.com/watch/123",
    pathname: "/watch/123"
  },
  document: {
    documentElement: {},
    addEventListener() {},
    querySelectorAll() { return []; }
  },
  performance: {
    getEntriesByType() { return []; }
  },
  PerformanceObserver: FakePerformanceObserver,
  MutationObserver: FakeMutationObserver,
  XMLHttpRequest: FakeXMLHttpRequest,
  HTMLMediaElement: FakeHTMLMediaElement,
  fetch: async () => ({ ok: true, headers: { get() { return ""; } } }),
  postMessage(message) {
    messages.push(structuredClone(message));
  },
  addEventListener() {}
};
sandbox.window = sandbox;

const context = vm.createContext(sandbox);
const source = fs.readFileSync(new URL("./media-observer-main.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "media-observer-main.js" });

const metadata = JSON.stringify({
  result: {
    movieId: 123,
    videoType: "episode",
    releaseYear: 2024,
    seriesTitle: "Research Series",
    episodeTitle: "Research Episode",
    seasonNumber: 2,
    episodeNumber: 5,
    timedTextTracks: [
      {
        language: "deu",
        languageDescription: "Deutsch [CC]",
        trackId: "german-sdh",
        isSDH: true,
        isSelected: true
      },
      {
        language: "eng",
        languageDescription: "English",
        trackId: "english-standard"
      }
    ],
    audioTracks: [
      {
        language: "eng",
        languageDescription: "English",
        streams: [{
          bitrate: 128000,
          codec: "aac",
          contentProfile: "xhe-aac-dash",
          urls: ["https://ipv4-c001.example.nflxvideo.net/?o=one&v=two"]
        }]
      },
      {
        language: "deu",
        languageDescription: "Deutsch - Audiodeskription",
        trackId: "german-ad-track",
        isAudioDescription: true,
        isSelected: true,
        streams: [{
          bitrate: 96000,
          codecName: "aac",
          profile: "heaac-2-dash",
          channelCount: 2,
          downloadUrls: [{ url: "https://ipv4-c002.example.nflxvideo.net/?o=three&v=four" }]
        }, {
          urls: ["https://not-netflix.example/audio.mp4"]
        }]
      }
    ]
  }
});

vm.runInContext(`JSON.parse(${JSON.stringify(metadata)})`, context);

const candidates = messages.flatMap((message) => message.candidates || []);
assert.equal(
  messages.filter((message) => message.observerVersion).at(-1)?.observerVersion,
  6
);
const netflixCandidates = [...new Map(
  candidates
    .filter((candidate) => candidate.kind === "netflix-audio")
    .map((candidate) => [candidate.url, candidate])
).values()];

assert.equal(netflixCandidates.length, 2);
assert.deepEqual(
  netflixCandidates.map((candidate) => candidate.language).sort(),
  ["deu", "eng"]
);
assert.ok(netflixCandidates.every((candidate) => candidate.source === "netflix-player-metadata"));
assert.ok(netflixCandidates.every((candidate) => new URL(candidate.url).hostname.endsWith(".nflxvideo.net")));
assert.equal(
  netflixCandidates.find((candidate) => candidate.language === "deu").bitrate,
  96000
);
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").codec, "aac");
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").profile, "heaac-2-dash");
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").channels, 2);
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").role, "audio-description");
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").trackId, "german-ad-track");
assert.equal(netflixCandidates.find((candidate) => candidate.language === "deu").selected, true);

const latestMetadata = messages.map((message) => message.netflixMetadata).filter(Boolean).at(-1);
assert.equal(latestMetadata.title.videoId, "123");
assert.equal(latestMetadata.title.contentType, "episode");
assert.equal(latestMetadata.title.releaseYear, 2024);
assert.equal(latestMetadata.title.seriesTitle, "Research Series");
assert.equal(latestMetadata.title.episodeTitle, "Research Episode");
assert.equal(latestMetadata.subtitleTracks.length, 2);
assert.equal(latestMetadata.subtitleTracks.find((track) => track.trackId === "german-sdh").sdh, true);
assert.equal(latestMetadata.audioTracks.find((track) => track.trackId === "german-ad-track").role, "audio-description");

console.log("Netflix media-observer tests passed");

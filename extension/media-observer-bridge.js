(() => {
  const BRIDGE_VERSION = 7;
  if (globalThis.__dubTranscriptMediaObserverBridgeVersion === BRIDGE_VERSION) return;
  globalThis.__dubTranscriptMediaObserverBridgeVersion = BRIDGE_VERSION;

  const MESSAGE_SOURCE = "dub-transcript-media-observer";
  const candidates = new Map();
  let drmProtected = false;
  let netflixMetadata = null;
  let netflixMovieId = "";
  let mainWorldVersion = null;
  let lastSnapshotAt = null;

  function cloneMetadata(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function mergeCandidate(candidate) {
    if (!candidate || typeof candidate !== "object") return;
    try {
      const parsed = new URL(String(candidate.url || ""));
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return;
      parsed.hash = "";
      const url = parsed.href;
      candidates.set(url, {
        url,
        kind: String(candidate.kind || "unknown-media").slice(0, 32),
        source: String(candidate.source || "page").slice(0, 64),
        contentType: String(candidate.contentType || "").slice(0, 160),
        language: String(candidate.language || "").slice(0, 64),
        languageDescription: String(candidate.languageDescription || "").slice(0, 128),
        trackId: String(candidate.trackId || "").slice(0, 128),
        downloadableId: String(candidate.downloadableId || "").slice(0, 128),
        role: String(candidate.role || "main").slice(0, 32),
        selected: candidate.selected === true,
        codec: String(candidate.codec || "").slice(0, 64),
        profile: String(candidate.profile || "").slice(0, 96),
        channels: Math.max(0, Number(candidate.channels) || 0) || null,
        representationIndex: Math.max(0, Number(candidate.representationIndex) || 0),
        bitrate: Math.max(0, Number(candidate.bitrate) || 0) || null,
        lastSeen: Math.max(0, Number(candidate.lastSeen) || Date.now())
      });
      while (candidates.size > 100) candidates.delete(candidates.keys().next().value);
    } catch {
      // Ignore malformed or non-HTTP media candidates.
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data?.type === "request-snapshot") return;
    mainWorldVersion = Math.max(0, Number(event.data?.observerVersion) || 0) || mainWorldVersion;
    lastSnapshotAt = Date.now();
    drmProtected ||= Boolean(event.data?.drmProtected);
    if (event.data?.netflixMetadata && typeof event.data.netflixMetadata === "object") {
      const incoming = cloneMetadata(event.data.netflixMetadata);
      const incomingMovieId = String(incoming?.title?.videoId || "").slice(0, 64);
      if (netflixMovieId && incomingMovieId && netflixMovieId !== incomingMovieId) {
        candidates.clear();
      }
      if (incomingMovieId) netflixMovieId = incomingMovieId;
      netflixMetadata = incoming;
    }
    for (const candidate of event.data?.candidates || []) mergeCandidate(candidate);
  });

  document.addEventListener("encrypted", () => {
    drmProtected = true;
  }, true);

  globalThis.__dubTranscriptMediaObserver = Object.freeze({
    snapshot() {
      window.postMessage({ source: MESSAGE_SOURCE, type: "request-snapshot" }, "*");
      return {
        drmProtected,
        netflixMetadata: netflixMetadata ? cloneMetadata(netflixMetadata) : null,
        observer: {
          bridgeVersion: BRIDGE_VERSION,
          mainWorldVersion,
          ready: Boolean(mainWorldVersion),
          candidateCount: candidates.size,
          lastSnapshotAt
        },
        candidates: [...candidates.values()]
          .sort((left, right) => right.lastSeen - left.lastSeen)
      };
    }
  });

  window.postMessage({ source: MESSAGE_SOURCE, type: "request-snapshot" }, "*");
})();

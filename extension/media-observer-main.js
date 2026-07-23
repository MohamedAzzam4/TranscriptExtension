(() => {
  if (globalThis.__dubTranscriptMediaObserverMainVersion === 4) return;
  globalThis.__dubTranscriptMediaObserverMainVersion = 4;

  const MESSAGE_SOURCE = "dub-transcript-media-observer";
  const IS_NETFLIX = /(^|\.)netflix\.com$/i.test(location.hostname);
  const candidates = new Map();
  let drmProtected = false;

  function mediaKind(url, contentType = "") {
    const value = `${url} ${contentType}`.toLowerCase();
    if (/\.m3u8(?:$|[\s?#])|mpegurl/.test(value)) return "hls";
    if (/\.mpd(?:$|[\s?#])|dash\+xml/.test(value)) return "dash";
    if (/\.(?:m4a|mp3|aac|oga|ogg|opus)(?:$|[\s?#])|audio\//.test(value)) return "audio";
    if (/\.(?:mp4|webm|mov|mkv)(?:$|[\s?#])|video\//.test(value)) return "media";
    if (/(?:videoplayback|manifest|playlist)(?:[/?#=&]|$)/.test(value)) return "unknown-media";
    return null;
  }

  function normalizeUrl(value) {
    try {
      const parsed = new URL(String(value || ""), location.href);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
      parsed.hash = "";
      return parsed.href;
    } catch {
      return null;
    }
  }

  function publish(type = "update") {
    window.postMessage({
      source: MESSAGE_SOURCE,
      type,
      drmProtected,
      candidates: [...candidates.values()]
    }, "*");
  }

  function remember(value, source, contentType = "", metadata = {}) {
    const url = normalizeUrl(value);
    let kind = String(metadata.kind || "");
    if (kind === "netflix-audio") {
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (!IS_NETFLIX || (host !== "nflxvideo.net" && !host.endsWith(".nflxvideo.net"))) return;
      } catch {
        return;
      }
    } else {
      kind = url ? mediaKind(url, contentType) : null;
    }
    if (!url || !kind) return;
    const previous = candidates.get(url);
    candidates.set(url, {
      url,
      kind: kind === "netflix-audio"
        ? kind
        : (previous?.kind === "unknown-media" ? kind : (previous?.kind || kind)),
      source: previous?.source || String(source || "page"),
      contentType: String(contentType || previous?.contentType || "").slice(0, 160),
      language: String(metadata.language || previous?.language || "").slice(0, 64),
      languageDescription: String(
        metadata.languageDescription || previous?.languageDescription || ""
      ).slice(0, 128),
      trackId: String(metadata.trackId || previous?.trackId || "").slice(0, 128),
      downloadableId: String(metadata.downloadableId || previous?.downloadableId || "").slice(0, 128),
      role: String(metadata.role || previous?.role || "main").slice(0, 32),
      selected: metadata.selected === true || previous?.selected === true,
      codec: String(metadata.codec || previous?.codec || "").slice(0, 64),
      profile: String(metadata.profile || previous?.profile || "").slice(0, 96),
      channels: Math.max(0, Number(metadata.channels) || Number(previous?.channels) || 0) || null,
      representationIndex: Math.max(
        0,
        Number(metadata.representationIndex) || Number(previous?.representationIndex) || 0
      ),
      bitrate: Math.max(0, Number(metadata.bitrate) || Number(previous?.bitrate) || 0) || null,
      lastSeen: Date.now()
    });
    while (candidates.size > 100) candidates.delete(candidates.keys().next().value);
    publish();
  }

  function markDrm() {
    if (drmProtected) return;
    drmProtected = true;
    publish();
  }

  function netflixAudioTracks(payload) {
    if (!IS_NETFLIX || !payload || typeof payload !== "object") return [];
    const result = payload.result && typeof payload.result === "object"
      ? payload.result
      : payload;
    const tracks = result.audioTracks || result.audio_tracks;
    return result.movieId && Array.isArray(tracks) ? tracks : [];
  }

  function netflixDownloadUrls(value, depth = 0) {
    if (depth > 3 || value == null) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.flatMap((item) => netflixDownloadUrls(item, depth + 1));
    }
    if (typeof value !== "object") return [];
    if (typeof value.url === "string") return [value.url];
    return Object.values(value).flatMap((item) => netflixDownloadUrls(item, depth + 1));
  }

  function inspectNetflixPlayerMetadata(payload) {
    for (const track of netflixAudioTracks(payload)) {
      if (!track || typeof track !== "object") continue;
      const language = track.language || track.bcp47 || track.languageCode || "";
      const languageDescription = track.languageDescription || track.displayName || track.name || "";
      const trackId = track.trackId || track.id || track.new_track_id || track.newTrackId || "";
      const downloadableId = track.downloadableId || track.downloadable_id || "";
      const selected = [track.selected, track.isSelected, track.active, track.isActive]
        .some((value) => value === true);
      const roleText = [
        track.rawTrackType,
        track.trackType,
        track.role,
        track.roles,
        languageDescription
      ].flat().filter(Boolean).join(" ").toLowerCase();
      const isAudioDescription = [
        track.isAudioDescription,
        track.audioDescription,
        track.isDescriptive,
        track.descriptive
      ].some((value) => value === true)
        || /audio\s*description|descriptive|audiodeskription|h[öo]rfilm/.test(roleText);
      const role = isAudioDescription ? "audio-description" : "main";
      const streams = Array.isArray(track.streams) && track.streams.length
        ? track.streams
        : [track];
      for (const [representationIndex, stream] of streams.entries()) {
        if (!stream || typeof stream !== "object") continue;
        const streamSelected = selected || [
          stream.selected,
          stream.isSelected,
          stream.active,
          stream.isActive
        ].some((value) => value === true);
        const collections = [stream.urls, stream.downloadUrls, stream.url];
        const urls = [...new Set(collections.flatMap((value) => netflixDownloadUrls(value)))];
        for (const url of urls) {
          remember(url, "netflix-player-metadata", "audio/mp4", {
            kind: "netflix-audio",
            language,
            languageDescription,
            trackId: stream.trackId || trackId,
            downloadableId: stream.downloadableId || stream.downloadable_id || downloadableId,
            role,
            selected: streamSelected,
            codec: stream.codec || stream.codecName || stream.codec_name
              || stream.audioCodec || stream.audio_codec || track.codec || "",
            profile: stream.contentProfile || stream.content_profile || stream.profile
              || stream.codecProfile || stream.codec_profile || track.profile || "",
            channels: stream.channels || stream.channelCount || stream.channel_count
              || track.channels || track.channelCount || track.channel_count,
            representationIndex,
            bitrate: stream.bitrate || stream.bitRate || track.bitrate || track.bitRate
          });
        }
      }
    }
  }

  if (IS_NETFLIX) {
    const originalJsonParse = JSON.parse;
    JSON.parse = function observedJsonParse(...args) {
      const parsed = originalJsonParse.apply(this, args);
      try {
        inspectNetflixPlayerMetadata(parsed);
      } catch {
        // Netflix metadata formats change often; playback must never depend on this observer.
      }
      return parsed;
    };
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function observedFetch(input, init) {
      remember(typeof input === "string" ? input : input?.url, "fetch-request");
      const result = originalFetch.call(this, input, init);
      return Promise.resolve(result).then((response) => {
        try {
          remember(response?.url, "fetch-response", response?.headers?.get("content-type") || "");
        } catch {
          // A response with opaque headers can still be useful through its request URL.
        }
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function observedOpen(method, url, ...rest) {
    remember(url, "xhr-request");
    this.addEventListener("loadend", () => {
      let contentType = "";
      try {
        contentType = this.getResponseHeader("content-type") || "";
      } catch {
        // Cross-origin XHR responses may hide their headers.
      }
      remember(this.responseURL || url, "xhr-response", contentType);
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) remember(entry.name, "performance");
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    for (const entry of performance.getEntriesByType("resource")) {
      remember(entry.name, "performance");
    }
  }

  function inspectMediaElements() {
    for (const element of document.querySelectorAll("video, audio")) {
      remember(element.currentSrc || element.src, "media-element", element.currentSrc ? element.type : "");
      for (const source of element.querySelectorAll("source[src]")) {
        remember(source.src, "source-element", source.type || "");
      }
      if (element.mediaKeys) markDrm();
    }
  }

  document.addEventListener("encrypted", markDrm, true);
  document.addEventListener("loadedmetadata", inspectMediaElements, true);
  const originalSetMediaKeys = HTMLMediaElement.prototype.setMediaKeys;
  if (typeof originalSetMediaKeys === "function") {
    HTMLMediaElement.prototype.setMediaKeys = function observedSetMediaKeys(mediaKeys) {
      if (mediaKeys) markDrm();
      return originalSetMediaKeys.call(this, mediaKeys);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) return;
    if (event.data?.type === "request-snapshot") {
      inspectMediaElements();
      publish("snapshot");
    }
  });

  if (document.documentElement) {
    new MutationObserver(inspectMediaElements).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      inspectMediaElements();
      new MutationObserver(inspectMediaElements).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"]
      });
    }, { once: true });
  }

  inspectMediaElements();
  publish("ready");
})();

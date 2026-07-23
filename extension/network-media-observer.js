(() => {
  const OBSERVATION_TTL_MS = 10 * 60 * 1_000;
  const MAX_TAB_OBSERVATIONS = 160;
  const MAX_PENDING_REQUESTS = 400;
  const SAFE_REPLAY_HEADER_NAMES = new Set([
    "accept",
    "accept-language",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent"
  ]);
  const TRACKED_REQUEST_TYPES = new Set(["media", "xmlhttprequest", "other"]);

  function normalizeHttpUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
      parsed.hash = "";
      return parsed.href;
    } catch {
      return null;
    }
  }

  function cleanReplayHeaders(rawHeaders) {
    const values = Array.isArray(rawHeaders)
      ? rawHeaders.map((header) => [header?.name, header?.value])
      : Object.entries(rawHeaders || {});
    const cleaned = {};
    for (const [rawName, rawValue] of values) {
      const name = String(rawName || "").trim().toLowerCase();
      if (!SAFE_REPLAY_HEADER_NAMES.has(name)) continue;
      const value = String(rawValue || "").replace(/[\r\n]/g, "").trim();
      if (value) cleaned[name] = value.slice(0, 1_024);
    }
    return cleaned;
  }

  function responseContentType(rawHeaders) {
    for (const header of rawHeaders || []) {
      if (String(header?.name || "").toLowerCase() !== "content-type") continue;
      return String(header?.value || "").replace(/[\r\n]/g, "").trim().slice(0, 160);
    }
    return "";
  }

  function classifyMediaRequest(url, contentType = "", requestType = "") {
    const value = `${url || ""} ${contentType || ""}`.toLowerCase();
    if (/\.m3u8(?:$|[\s?#])|(?:application\/(?:vnd\.apple\.|x-)?|audio\/(?:x-)?)mpegurl/.test(value)) {
      return "hls";
    }
    if (/\.mpd(?:$|[\s?#])|application\/dash\+xml/.test(value)) return "dash";
    if (/\.(?:ts|m2ts)(?:$|[\s?#])|video\/mp2t/.test(value)) return "hls-segment";
    if (/\.(?:m4s|cmfa|cmfv)(?:$|[\s?#])/.test(value)) return "dash-segment";
    if (/\.(?:m4a|mp3|aac|oga|ogg|opus)(?:$|[\s?#])|audio\//.test(value)) return "audio";
    if (/\.(?:mp4|webm|mov|mkv)(?:$|[\s?#])|video\//.test(value)) return "media";
    if (/(?:videoplayback|manifest|playlist)(?:[/?#=&]|$)/.test(value)) return "unknown-media";
    if (requestType === "media") return "media";
    return null;
  }

  function safeOrigin(value) {
    try {
      const parsed = new URL(String(value || ""));
      return /^https?:$/.test(parsed.protocol) ? parsed.origin : null;
    } catch {
      return null;
    }
  }

  function createStore({ now = () => Date.now() } = {}) {
    const pending = new Map();
    const byTab = new Map();

    function eligible(details) {
      return Number.isInteger(details?.tabId)
        && details.tabId >= 0
        && (!details.method || details.method === "GET")
        && TRACKED_REQUEST_TYPES.has(String(details.type || ""));
    }

    function pendingRequest(details) {
      if (!eligible(details)) return null;
      const url = normalizeHttpUrl(details.url);
      if (!url) return null;
      let observation = pending.get(details.requestId);
      if (!observation) {
        observation = {
          requestId: String(details.requestId || ""),
          tabId: details.tabId,
          frameId: Number.isInteger(details.frameId) ? details.frameId : -1,
          parentFrameId: Number.isInteger(details.parentFrameId) ? details.parentFrameId : -1,
          initiator: safeOrigin(details.initiator),
          requestType: String(details.type || ""),
          url,
          headers: {},
          contentType: "",
          statusCode: null,
          lastSeen: Math.max(0, Number(details.timeStamp) || now())
        };
        pending.set(details.requestId, observation);
        while (pending.size > MAX_PENDING_REQUESTS) {
          pending.delete(pending.keys().next().value);
        }
      }
      return observation;
    }

    function remember(observation, explicitKind = null) {
      if (!observation) return;
      const kind = explicitKind || classifyMediaRequest(
        observation.url,
        observation.contentType,
        observation.requestType
      );
      if (!kind) return;
      let values = byTab.get(observation.tabId);
      if (!values) {
        values = new Map();
        byTab.set(observation.tabId, values);
      }
      const previous = values.get(observation.url);
      values.set(observation.url, {
        url: observation.url,
        kind,
        source: "webrequest-observer",
        contentType: observation.contentType || previous?.contentType || "",
        requestType: observation.requestType || previous?.requestType || "",
        frameId: observation.frameId,
        parentFrameId: observation.parentFrameId,
        initiator: observation.initiator || previous?.initiator || null,
        headers: {
          ...(previous?.headers || {}),
          ...cleanReplayHeaders(observation.headers)
        },
        statusCode: observation.statusCode || previous?.statusCode || null,
        lastSeen: Math.max(observation.lastSeen || 0, previous?.lastSeen || 0, now())
      });
      pruneTab(observation.tabId);
    }

    function pruneTab(tabId) {
      const values = byTab.get(tabId);
      if (!values) return;
      const cutoff = now() - OBSERVATION_TTL_MS;
      for (const [url, observation] of values) {
        if (observation.lastSeen < cutoff) values.delete(url);
      }
      while (values.size > MAX_TAB_OBSERVATIONS) {
        values.delete(values.keys().next().value);
      }
      if (!values.size) byTab.delete(tabId);
    }

    function beforeRequest(details) {
      const observation = pendingRequest(details);
      if (!observation) return;
      remember(observation);
    }

    function beforeSendHeaders(details) {
      const observation = pendingRequest(details);
      if (!observation) return;
      // Sensitive headers can be present in this callback. Only the explicit
      // replay allowlist survives beyond this stack frame.
      observation.headers = cleanReplayHeaders(details.requestHeaders);
      observation.lastSeen = Math.max(observation.lastSeen, Number(details.timeStamp) || now());
      remember(observation);
    }

    function headersReceived(details) {
      const observation = pendingRequest(details);
      if (!observation) return;
      observation.contentType = responseContentType(details.responseHeaders);
      observation.statusCode = Math.max(0, Number(details.statusCode) || 0) || null;
      observation.lastSeen = Math.max(observation.lastSeen, Number(details.timeStamp) || now());
      remember(observation);
    }

    function completed(details) {
      if (details?.requestId != null) pending.delete(details.requestId);
    }

    function clearTab(tabId) {
      byTab.delete(tabId);
      for (const [requestId, observation] of pending) {
        if (observation.tabId === tabId) pending.delete(requestId);
      }
    }

    function snapshot(tabId, selectedFrameId = null, frameUrl = "") {
      pruneTab(tabId);
      const all = [...(byTab.get(tabId)?.values() || [])]
        .sort((left, right) => right.lastSeen - left.lastSeen);
      const frameOrigin = safeOrigin(frameUrl);
      const directlyRelated = all.filter((observation) => (
        observation.frameId === selectedFrameId
        || (frameOrigin && observation.initiator === frameOrigin)
        || observation.frameId < 0
      ));
      const relevant = directlyRelated.length ? directlyRelated : all;
      const batchCandidates = relevant
        .filter((observation) => !observation.kind.endsWith("-segment"))
        .slice(0, 40)
        .map((observation) => ({
          url: observation.url,
          kind: observation.kind,
          source: observation.source,
          contentType: observation.contentType,
          requestType: observation.requestType,
          frameId: observation.frameId,
          initiator: observation.initiator,
          headers: cleanReplayHeaders(observation.headers),
          lastSeen: observation.lastSeen
        }));
      const kinds = {};
      const headerNames = new Set();
      for (const observation of relevant) {
        kinds[observation.kind] = (kinds[observation.kind] || 0) + 1;
        for (const name of Object.keys(cleanReplayHeaders(observation.headers))) headerNames.add(name);
      }
      return {
        candidates: batchCandidates,
        diagnostics: {
          observedRequestCount: relevant.length,
          candidateCount: batchCandidates.length,
          segmentEvidenceCount: relevant.filter((value) => value.kind.endsWith("-segment")).length,
          directlyRelatedCount: directlyRelated.length,
          kinds,
          replayHeaderNames: [...headerNames].sort(),
          newestSeenAt: relevant[0]?.lastSeen || null
        }
      };
    }

    return Object.freeze({
      beforeRequest,
      beforeSendHeaders,
      headersReceived,
      completed,
      clearTab,
      snapshot
    });
  }

  function attachChromeObserver(chromeApi, store) {
    if (!chromeApi?.webRequest?.onBeforeRequest?.addListener) return false;
    const filter = { urls: ["http://*/*", "https://*/*"] };
    chromeApi.webRequest.onBeforeRequest.addListener(store.beforeRequest, filter);
    try {
      chromeApi.webRequest.onBeforeSendHeaders.addListener(
        store.beforeSendHeaders,
        filter,
        ["requestHeaders", "extraHeaders"]
      );
    } catch {
      chromeApi.webRequest.onBeforeSendHeaders.addListener(
        store.beforeSendHeaders,
        filter,
        ["requestHeaders"]
      );
    }
    chromeApi.webRequest.onHeadersReceived.addListener(
      store.headersReceived,
      filter,
      ["responseHeaders"]
    );
    chromeApi.webRequest.onCompleted.addListener(store.completed, filter);
    chromeApi.webRequest.onErrorOccurred.addListener(store.completed, filter);
    return true;
  }

  globalThis.DubTranscriptNetworkMedia = Object.freeze({
    SAFE_REPLAY_HEADER_NAMES,
    normalizeHttpUrl,
    cleanReplayHeaders,
    classifyMediaRequest,
    createStore,
    attachChromeObserver
  });
})();

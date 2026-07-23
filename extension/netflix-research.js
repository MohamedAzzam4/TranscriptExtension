(() => {
  const REPORT_SCHEMA_VERSION = 1;
  const RESEARCH_PREFIX = "netflix-research:v1:";

  function normalizeLanguage(value) {
    const raw = String(value || "").trim().toLowerCase();
    const primary = raw.split(/[-_]/)[0].replace(/[^a-z]/g, "");
    return {
      deu: "de",
      ger: "de",
      german: "de",
      deutsch: "de",
      eng: "en",
      english: "en",
      jpn: "ja",
      japanese: "ja"
    }[primary] || primary.slice(0, 8);
  }

  function safeText(value, limit = 160) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function safeHost(value) {
    try {
      return new URL(String(value || "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function sanitizeAudioTrack(track) {
    if (!track || typeof track !== "object") return null;
    const language = normalizeLanguage(track.language);
    const label = safeText(track.languageDescription || track.label, 128);
    const role = safeText(track.role, 32) || "main";
    const trackId = safeText(track.trackId, 128);
    if (!language && !label && !trackId) return null;
    return {
      language: language || null,
      label: label || null,
      trackId: trackId || null,
      role,
      selected: track.selected === true,
      channels: positiveNumber(track.channels),
      representationCount: Math.max(0, Number(track.representationCount) || 0)
    };
  }

  function sanitizeSubtitleTrack(track) {
    if (!track || typeof track !== "object") return null;
    const language = normalizeLanguage(track.language);
    const label = safeText(track.languageDescription || track.label, 128);
    const trackId = safeText(track.trackId, 128);
    if (!language && !label && !trackId) return null;
    const role = safeText(track.role, 32) || (
      track.forced ? "forced" : track.sdh ? "sdh" : "subtitle"
    );
    return {
      language: language || null,
      label: label || null,
      trackId: trackId || null,
      role,
      selected: track.selected === true,
      forced: track.forced === true,
      sdh: track.sdh === true,
      closedCaptions: track.closedCaptions === true
    };
  }

  function representationKey(candidate) {
    return [
      safeText(candidate.trackId || candidate.languageDescription, 128),
      normalizeLanguage(candidate.language),
      safeText(candidate.role, 32) || "main",
      safeText(candidate.profile, 96).toLowerCase(),
      safeText(candidate.codec, 64).toLowerCase(),
      Math.max(0, Number(candidate.bitrate) || 0),
      Math.max(0, Number(candidate.channels) || 0),
      Math.max(0, Number(candidate.representationIndex) || 0)
    ].join("|");
  }

  function groupAudioRepresentations(rawCandidates, requestedLanguage = "") {
    const requested = normalizeLanguage(requestedLanguage);
    const groups = new Map();
    for (const raw of Array.isArray(rawCandidates) ? rawCandidates : []) {
      if (!raw || raw.kind !== "netflix-audio") continue;
      let parsed;
      try {
        parsed = new URL(String(raw.url || ""));
      } catch {
        continue;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        parsed.protocol !== "https:"
        || (host !== "nflxvideo.net" && !host.endsWith(".nflxvideo.net"))
      ) continue;
      const key = representationKey(raw);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          language: normalizeLanguage(raw.language) || null,
          label: safeText(raw.languageDescription, 128) || null,
          trackId: safeText(raw.trackId, 128) || null,
          role: safeText(raw.role, 32) || "main",
          selected: raw.selected === true,
          codecHint: safeText(raw.codec, 64) || null,
          profileHint: safeText(raw.profile, 96) || null,
          bitrate: positiveNumber(raw.bitrate),
          channels: positiveNumber(raw.channels),
          representationIndex: Math.max(0, Number(raw.representationIndex) || 0),
          urls: [],
          hosts: []
        };
        groups.set(key, group);
      }
      if (!group.urls.includes(parsed.href)) group.urls.push(parsed.href);
      if (!group.hosts.includes(host)) group.hosts.push(host);
      group.selected ||= raw.selected === true;
    }
    return [...groups.values()]
      .sort((left, right) => (
        Number(right.selected) - Number(left.selected)
        || Number(right.language === requested) - Number(left.language === requested)
        || Number(left.role !== "main") - Number(right.role !== "main")
        || (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0)
      ));
  }

  function representationSummary(group) {
    return {
      language: group.language,
      label: group.label,
      trackId: group.trackId,
      role: group.role,
      selected: group.selected,
      codecHint: group.codecHint,
      profileHint: group.profileHint,
      bitrate: group.bitrate,
      channels: group.channels,
      representationIndex: group.representationIndex,
      mirrorCount: group.urls.length,
      sourceHosts: group.hosts.map((host) => safeText(host, 255)).filter(Boolean)
    };
  }

  function subtitleInventory(rawTracks, audioLanguage) {
    const tracks = (Array.isArray(rawTracks) ? rawTracks : [])
      .map(sanitizeSubtitleTrack)
      .filter(Boolean);
    const requested = normalizeLanguage(audioLanguage);
    const sameLanguage = tracks.filter((track) => track.language === requested);
    const candidates = sameLanguage.map((track) => ({
      trackId: track.trackId,
      label: track.label,
      role: track.role,
      expectation: track.forced
        ? "not-a-full-dialogue-track"
        : track.sdh || track.closedCaptions
          ? "candidate-for-dub-match"
          : "unknown-until-sampled"
    }));
    return {
      tracks,
      sameLanguageCount: sameLanguage.length,
      dubMatchCandidates: candidates,
      conclusion: !sameLanguage.length
        ? "no-same-language-track"
        : candidates.some((track) => track.expectation === "candidate-for-dub-match")
          ? "candidate-present-not-verified"
          : "same-language-track-present-not-verified"
    };
  }

  function estimateSubtitleAlignment(asrSegments, captionSegments) {
    const asr = normalizeSegments(asrSegments);
    const captions = normalizeSegments(captionSegments, true);
    const asrWords = asr.flatMap((segment) => tokenize(segment.text));
    const captionWords = captions.flatMap((segment) => tokenize(segment.text));
    const rangeStart = Math.max(
      asr.length ? asr[0].start : 0,
      captions.length ? captions[0].start : 0
    );
    const rangeEnd = Math.min(
      asr.length ? asr.at(-1).end : 0,
      captions.length ? captions.at(-1).end : 0
    );
    const sampleDuration = Math.max(0, rangeEnd - rangeStart);
    if (
      sampleDuration < 20
      || asrWords.length < 30
      || captionWords.length < 30
    ) {
      return {
        status: "insufficient-sample",
        sampledAt: new Date().toISOString(),
        sampleDuration: round(sampleDuration),
        asrWordCount: asrWords.length,
        captionWordCount: captionWords.length,
        agreementEstimate: null,
        note: "Collect at least 20 seconds and roughly 30 spoken and caption words."
      };
    }
    const distance = levenshtein(asrWords, captionWords);
    const agreement = Math.max(0, 1 - distance / Math.max(asrWords.length, captionWords.length, 1));
    const status = agreement >= 0.72
      ? "likely-dub-matching"
      : agreement < 0.42
        ? "likely-not-dub-matching"
        : "uncertain";
    return {
      status,
      sampledAt: new Date().toISOString(),
      sampleDuration: round(sampleDuration),
      asrWordCount: asrWords.length,
      captionWordCount: captionWords.length,
      agreementEstimate: round(agreement),
      note: "This is an ASR-based estimate, not a certification of the subtitle asset."
    };
  }

  function normalizeSegments(rawSegments, stripAccessibilityCues = false) {
    return (Array.isArray(rawSegments) ? rawSegments : [])
      .map((segment) => {
        const start = Number(segment?.start);
        const end = Number(segment?.end);
        let text = safeText(segment?.text, 4_000);
        if (stripAccessibilityCues) {
          text = text
            .replace(/\[[^\]]{1,120}\]/g, " ")
            .replace(/[♪♫]+/g, " ")
            .replace(/^\s*[-–—]\s*/gm, "");
        }
        return Number.isFinite(start) && Number.isFinite(end) && end >= start && text
          ? { start, end, text }
          : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function tokenize(text) {
    return String(text || "")
      .toLocaleLowerCase("de")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function levenshtein(left, right) {
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= right.length; j += 1) {
        current[j] = left[i - 1] === right[j - 1]
          ? previous[j - 1]
          : 1 + Math.min(previous[j], current[j - 1], previous[j - 1]);
      }
      previous = current;
    }
    return previous[right.length];
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function round(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 1_000) / 1_000 : null;
  }

  globalThis.DubTranscriptNetflixResearch = Object.freeze({
    REPORT_SCHEMA_VERSION,
    RESEARCH_PREFIX,
    normalizeLanguage,
    safeText,
    safeHost,
    sanitizeAudioTrack,
    sanitizeSubtitleTrack,
    groupAudioRepresentations,
    representationSummary,
    subtitleInventory,
    estimateSubtitleAlignment
  });
})();

(() => {
  if (globalThis.DubTranscriptGroups?.version === 1) return;

  const DEFAULT_OPTIONS = Object.freeze({
    maxCharacters: 150,
    maxDuration: 12,
    continuationGap: 1.8
  });

  function buildDisplayGroups(rawSegments, rawOptions = {}) {
    const options = {
      maxCharacters: positiveNumber(rawOptions.maxCharacters, DEFAULT_OPTIONS.maxCharacters),
      maxDuration: positiveNumber(rawOptions.maxDuration, DEFAULT_OPTIONS.maxDuration),
      continuationGap: positiveNumber(rawOptions.continuationGap, DEFAULT_OPTIONS.continuationGap)
    };
    const segments = (rawSegments || [])
      .filter((segment) => (
        segment
        && segment.complete !== false
        && String(segment.text || "").trim()
        && Number.isFinite(Number(segment.start))
        && Number.isFinite(Number(segment.end))
      ))
      .map((segment) => ({
        ...segment,
        start: Number(segment.start),
        end: Math.max(Number(segment.start), Number(segment.end)),
        text: String(segment.text).replace(/\s+/g, " ").trim()
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const groups = [];
    let current = [];

    const finish = (reason) => {
      if (!current.length) return;
      const first = current[0];
      const last = current.at(-1);
      groups.push({
        id: `display:${first.id || first.start}:${last.id || last.end}`,
        start: first.start,
        end: last.end,
        text: current.map((segment) => segment.text).join(" "),
        segmentIds: current.map((segment) => segment.id).filter(Boolean),
        complete: last.boundary === "sentence" || hasTerminalEnding(last.text),
        reason
      });
      current = [];
    };

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const next = segments[index + 1];
      const prospectiveText = [...current, segment]
        .map((item) => item.text)
        .join(" ");
      const prospectiveDuration = current.length
        ? segment.end - current[0].start
        : segment.end - segment.start;
      if (
        current.length
        && (
          prospectiveText.length > options.maxCharacters
          || prospectiveDuration > options.maxDuration
        )
      ) {
        finish("display-limit");
      }

      current.push(segment);
      if (segment.boundary === "sentence") {
        finish("sentence");
        continue;
      }

      if (segment.boundary === "silence") {
        const gap = next ? next.start - segment.end : Number.POSITIVE_INFINITY;
        if (hasTerminalEnding(segment.text) || gap > options.continuationGap) {
          finish(hasTerminalEnding(segment.text) ? "sentence" : "silence");
        }
      }
    }
    finish("tail");
    return groups;
  }

  function normalizeSyncOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const rounded = Math.round(Math.max(-3, Math.min(3, number)) * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function hasTerminalEnding(text) {
    return /[.!?][\s"'’”»)]*$/.test(String(text || "").trim());
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  globalThis.DubTranscriptGroups = Object.freeze({
    version: 1,
    buildDisplayGroups,
    normalizeSyncOffset
  });
})();

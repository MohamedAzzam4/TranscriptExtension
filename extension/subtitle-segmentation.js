(() => {
  const DEFAULT_MAX_CUE_CHARS = 72;
  const MIN_TIMING_WEIGHT = 24;

  function splitTimedText(text, start, end, maxCueChars = DEFAULT_MAX_CUE_CHARS) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const safeStart = Number.isFinite(Number(start)) ? Number(start) : 0;
    const safeEnd = Math.max(safeStart, Number.isFinite(Number(end)) ? Number(end) : safeStart);
    if (!normalized) return [];

    const chunks = splitText(normalized, maxCueChars);
    if (chunks.length === 1) return [{ text: chunks[0], start: safeStart, end: safeEnd }];

    const weights = chunks.map((chunk) => Math.max(
      MIN_TIMING_WEIGHT,
      [...chunk.replace(/\s/g, "")].length
    ));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const totalDuration = safeEnd - safeStart;
    let cursor = safeStart;

    return chunks.map((chunk, index) => {
      const cueStart = cursor;
      const cueEnd = index === chunks.length - 1
        ? safeEnd
        : cueStart + totalDuration * (weights[index] / totalWeight);
      cursor = cueEnd;
      return {
        text: chunk,
        start: round(cueStart),
        end: round(cueEnd)
      };
    });
  }

  function cuesForSourceLine(line, start, end) {
    const normalized = String(line?.text || "").replace(/\s+/g, " ").trim();
    const safeStart = Number.isFinite(Number(start)) ? Number(start) : 0;
    const safeEnd = Math.max(safeStart, Number.isFinite(Number(end)) ? Number(end) : safeStart);
    if (!normalized) return [];

    // The server already split these lines on exact word timestamps. Running
    // the proportional fallback again can strand the final word (for example
    // "von") in a one-word cue.
    if (line?.timing === "word-timestamps") {
      return [{ text: normalized, start: safeStart, end: safeEnd }];
    }
    return splitTimedText(normalized, safeStart, safeEnd);
  }

  function splitText(text, maxCueChars) {
    const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)/gu) || [text];
    const chunks = [];
    let current = "";

    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if (sentence.length > maxCueChars) {
        if (current) chunks.push(current);
        current = "";
        chunks.push(...splitLongText(sentence, maxCueChars));
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxCueChars) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }

    if (current) chunks.push(current);
    return chunks.length ? chunks : [text];
  }

  function splitLongText(text, maxCueChars) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCueChars || !current) {
        current = candidate;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  globalThis.DubTranscriptSegmentation = Object.freeze({
    cuesForSourceLine,
    splitTimedText
  });
})();

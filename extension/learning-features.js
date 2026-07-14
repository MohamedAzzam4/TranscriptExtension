(() => {
  if (globalThis.DubTranscriptLearning?.version === 1) return;

  const DEFAULT_CAPTION_PREFERENCES = Object.freeze({
    fontSize: 31,
    horizontalPosition: 50,
    verticalPosition: 11,
    backgroundOpacity: 86,
    textOpacity: 100,
    textColor: "#FFFFFF",
    backgroundColor: "#05070C",
    fontFamily: "sans",
    edgeStyle: "shadow"
  });
  const DEFAULT_TRANSLATION_PREFERENCES = Object.freeze({
    enabled: true,
    targetLanguage: "en",
    provider: "auto"
  });
  const FONT_FAMILIES = Object.freeze({
    sans: "Inter, ui-sans-serif, system-ui, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Cascadia Mono', Consolas, monospace"
  });
  const EDGE_STYLES = new Set(["none", "shadow", "outline"]);
  const TRANSLATION_PROVIDERS = new Set(["auto", "browser", "google"]);

  function normalizeCaptionPreferences(raw = {}) {
    const fontFamily = String(raw.fontFamily || "").toLowerCase();
    const edgeStyle = String(raw.edgeStyle || "").toLowerCase();
    return {
      fontSize: clampNumber(raw.fontSize, 16, 52, DEFAULT_CAPTION_PREFERENCES.fontSize),
      horizontalPosition: clampNumber(
        raw.horizontalPosition,
        2,
        98,
        DEFAULT_CAPTION_PREFERENCES.horizontalPosition
      ),
      verticalPosition: clampNumber(
        raw.verticalPosition,
        3,
        70,
        DEFAULT_CAPTION_PREFERENCES.verticalPosition
      ),
      backgroundOpacity: clampNumber(
        raw.backgroundOpacity,
        0,
        100,
        DEFAULT_CAPTION_PREFERENCES.backgroundOpacity
      ),
      textOpacity: clampNumber(
        raw.textOpacity,
        25,
        100,
        DEFAULT_CAPTION_PREFERENCES.textOpacity
      ),
      textColor: normalizeHexColor(raw.textColor, DEFAULT_CAPTION_PREFERENCES.textColor),
      backgroundColor: normalizeHexColor(
        raw.backgroundColor,
        DEFAULT_CAPTION_PREFERENCES.backgroundColor
      ),
      fontFamily: Object.hasOwn(FONT_FAMILIES, fontFamily) ? fontFamily : "sans",
      edgeStyle: EDGE_STYLES.has(edgeStyle) ? edgeStyle : "shadow"
    };
  }

  function normalizeTranslationPreferences(raw = {}) {
    const targetLanguage = String(raw.targetLanguage || "")
      .trim()
      .replace(/[^a-z0-9-]/gi, "")
      .slice(0, 16)
      .toLowerCase();
    const provider = String(raw.provider || "").toLowerCase();
    return {
      enabled: raw.enabled !== false,
      targetLanguage: targetLanguage || DEFAULT_TRANSLATION_PREFERENCES.targetLanguage,
      provider: TRANSLATION_PROVIDERS.has(provider) ? provider : "auto"
    };
  }

  function fontFamilyValue(key) {
    return FONT_FAMILIES[key] || FONT_FAMILIES.sans;
  }

  function rgbaFromHex(hex, opacityPercent) {
    const normalized = normalizeHexColor(hex, "#000000").slice(1);
    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);
    const alpha = clampNumber(opacityPercent, 0, 100, 100) / 100;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function sanitizeWord(rawWord) {
    return String(rawWord || "")
      .normalize("NFC")
      .replace(/[^\p{L}\p{M}'’\-]/gu, "")
      .slice(0, 64);
  }

  function normalizedWord(rawWord) {
    return sanitizeWord(rawWord).toLocaleLowerCase("de-DE");
  }

  function translationCacheKey(text, sourceLanguage, targetLanguage) {
    const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
    return [
      "translation:v1",
      String(sourceLanguage || "auto").toLowerCase(),
      String(targetLanguage || "en").toLowerCase(),
      hashText(normalizedText)
    ].join(":");
  }

  function extractEnglishWiktionaryEntry(payload) {
    const entries = Array.isArray(payload?.de) ? payload.de : [];
    const definitions = [];
    let example = null;
    let exampleTranslation = null;
    for (const entry of entries) {
      for (const item of entry?.definitions || []) {
        const definition = htmlToPlainText(item?.definition);
        if (definition && !definitions.includes(definition)) definitions.push(definition);
        const parsedExample = Array.isArray(item?.parsedExamples)
          ? item.parsedExamples.find((candidate) => candidate?.example)
          : null;
        if (!example && parsedExample) {
          example = htmlToPlainText(parsedExample.example);
          exampleTranslation = htmlToPlainText(parsedExample.translation);
        }
        if (definitions.length >= 3) break;
      }
      if (definitions.length >= 3) break;
    }
    return {
      englishDefinition: definitions.length ? definitions.join("; ").slice(0, 600) : null,
      example,
      exampleTranslation
    };
  }

  function htmlToPlainText(value) {
    const namedEntities = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\""
    };
    return String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&([a-z]+);/gi, (entity, name) => namedEntities[name.toLowerCase()] ?? entity)
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim();
  }

  function normalizeVocabularyEntry(raw = {}) {
    const word = sanitizeWord(raw.word);
    if (!word) return null;
    return {
      word,
      normalizedWord: normalizedWord(word),
      title: String(raw.title || word).slice(0, 128),
      germanDefinition: nullableText(raw.germanDefinition, 800),
      englishDefinition: nullableText(raw.englishDefinition, 800),
      example: nullableText(raw.example, 600),
      exampleTranslation: nullableText(raw.exampleTranslation, 600),
      context: nullableText(raw.context, 600),
      contextTranslation: nullableText(raw.contextTranslation, 600),
      germanSourceUrl: safeWiktionaryUrl(raw.germanSourceUrl, "de"),
      englishSourceUrl: safeWiktionaryUrl(raw.englishSourceUrl, "en"),
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString()
    };
  }

  function safeWiktionaryUrl(value, language) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol === "https:" && url.hostname === `${language}.wiktionary.org`) {
        return url.toString();
      }
    } catch {
      // Use a null source when the provided URL is malformed or unexpected.
    }
    return null;
  }

  function normalizeHexColor(value, fallback) {
    const candidate = String(value || "").trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : fallback;
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.round(Math.max(minimum, Math.min(maximum, number)) * 10) / 10;
  }

  function nullableText(value, maximumLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, maximumLength) : null;
  }

  function hashText(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  globalThis.DubTranscriptLearning = Object.freeze({
    version: 1,
    DEFAULT_CAPTION_PREFERENCES,
    DEFAULT_TRANSLATION_PREFERENCES,
    normalizeCaptionPreferences,
    normalizeTranslationPreferences,
    fontFamilyValue,
    rgbaFromHex,
    sanitizeWord,
    normalizedWord,
    translationCacheKey,
    extractEnglishWiktionaryEntry,
    htmlToPlainText,
    normalizeVocabularyEntry
  });
})();

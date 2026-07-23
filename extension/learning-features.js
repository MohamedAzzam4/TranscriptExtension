(() => {
  if (globalThis.DubTranscriptLearning?.version === 4) return;

  const DEFAULT_CAPTION_PREFERENCES = Object.freeze({
    fontSize: 31,
    horizontalPosition: 50,
    verticalPosition: 11,
    backgroundOpacity: 86,
    textOpacity: 100,
    textColor: "#FFFFFF",
    backgroundColor: "#05070C",
    fontFamily: "sans",
    edgeStyle: "shadow",
    bold: true
  });
  const DEFAULT_TRANSLATION_PREFERENCES = Object.freeze({
    enabled: true,
    targetLanguage: "en",
    provider: "auto",
    fontSize: 21,
    textOpacity: 100,
    textColor: "#FFD166",
    fontFamily: "sans",
    bold: false
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
      edgeStyle: EDGE_STYLES.has(edgeStyle) ? edgeStyle : "shadow",
      bold: raw.bold !== false
    };
  }

  function normalizeTranslationPreferences(raw = {}) {
    const targetLanguage = String(raw.targetLanguage || "")
      .trim()
      .replace(/[^a-z0-9-]/gi, "")
      .slice(0, 16)
      .toLowerCase();
    const provider = String(raw.provider || "").toLowerCase();
    const fontFamily = String(raw.fontFamily || "").toLowerCase();
    return {
      enabled: raw.enabled !== false,
      targetLanguage: targetLanguage || DEFAULT_TRANSLATION_PREFERENCES.targetLanguage,
      provider: TRANSLATION_PROVIDERS.has(provider) ? provider : "auto",
      fontSize: clampNumber(
        raw.fontSize,
        12,
        42,
        DEFAULT_TRANSLATION_PREFERENCES.fontSize
      ),
      textOpacity: clampNumber(
        raw.textOpacity,
        25,
        100,
        DEFAULT_TRANSLATION_PREFERENCES.textOpacity
      ),
      textColor: normalizeHexColor(
        raw.textColor,
        DEFAULT_TRANSLATION_PREFERENCES.textColor
      ),
      fontFamily: Object.hasOwn(FONT_FAMILIES, fontFamily) ? fontFamily : "sans",
      bold: raw.bold === true
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

  function selectionHasText(...candidates) {
    return candidates
      .flat()
      .some((selection) => {
        try {
          return Boolean(
            selection
            && selection.isCollapsed === false
            && String(selection.toString()).trim()
          );
        } catch {
          return false;
        }
      });
  }

  function wordActivationDecision({
    suppressed = false,
    hasSelection = false,
    word = ""
  } = {}) {
    if (suppressed) return "suppress";
    if (hasSelection) return "preserve-selection";
    return sanitizeWord(word) ? "lookup" : "ignore";
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
    const examples = [];
    let partOfSpeech = null;
    for (const entry of entries) {
      partOfSpeech ||= nullableText(entry?.partOfSpeech, 80);
      for (const item of entry?.definitions || []) {
        const definition = htmlToPlainText(item?.definition);
        if (definition && !definitions.includes(definition)) definitions.push(definition);
        for (const parsedExample of item?.parsedExamples || []) {
          const german = htmlToPlainText(parsedExample?.example);
          const english = htmlToPlainText(parsedExample?.translation);
          if (german && !examples.some((candidate) => candidate.german === german)) {
            examples.push({ german, english: english || null, source: "English Wiktionary" });
          }
          if (examples.length >= 3) break;
        }
        if (definitions.length >= 3) break;
      }
      if (definitions.length >= 3) break;
    }
    return {
      englishDefinition: definitions.length ? definitions.join("; ").slice(0, 600) : null,
      englishDefinitions: definitions.slice(0, 3),
      example: examples[0]?.german || null,
      exampleTranslation: examples[0]?.english || null,
      examples,
      partOfSpeech
    };
  }

  function extractGermanWiktionaryEntry(html) {
    const source = isolateGermanSection(String(html || ""));
    const wordType = htmlToPlainText(source.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]) || null;
    const germanDefinitions = extractLabeledItems(source, "Bedeutungen", 4);
    const examples = extractLabeledItems(source, "Beispiele", 3)
      .map((german) => ({ german, english: null, source: "German Wiktionary" }));
    const collocations = extractLabeledItems(source, "Charakteristische Wortkombinationen", 6);
    const synonymItems = extractLabeledItems(source, "Synonyme", 4);
    const grammarSummary = extractLabeledItems(source, "Worttrennung", 1)[0] || null;
    const nominative = extractNominativeForms(source);
    const preterite = labeledGrammarValue(grammarSummary, "Präteritum");
    const participle = labeledGrammarValue(grammarSummary, "Partizip II");
    const auxiliary = extractAuxiliary(source);
    const grammar = {
      summary: grammarSummary,
      article: nominative.article,
      singular: nominative.singular,
      plural: nominative.plural,
      preterite,
      participle,
      auxiliary,
      perfect: auxiliary && participle
        ? `${auxiliary === "sein" ? "ist" : "hat"} ${participle}`
        : null,
      separable: /(?:Kategorie|Hilfe)[^"<]{0,80}trennbar|trennbares\s+Verb/i.test(source)
        || inferSeparableVerb(grammarSummary, participle)
    };
    const domains = germanDefinitions
      .map((definition) => definition.match(/^([^:]{1,100}):\s/)?.[1] || "")
      .flatMap((value) => value.split(/\s*,\s*/))
      .map((value) => value.trim())
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .slice(0, 6);
    const synonyms = synonymItems
      .flatMap((item) => item.replace(/^\[\d+\]\s*/, "").split(/\s*[,;]\s*/))
      .map((item) => item.replace(/\s*\([^)]*\)\s*/g, " ").trim())
      .filter((item, index, values) => item && item.length <= 80 && values.indexOf(item) === index)
      .slice(0, 5);
    const pronunciation = htmlToPlainText(
      source.match(/IPA(?:<\/a>)?:\s*\[<span[^>]*class="ipa"[^>]*>([\s\S]*?)<\/span>/i)?.[1]
    ) || null;

    return {
      germanDefinition: germanDefinitions.length ? germanDefinitions.join(" ").slice(0, 900) : null,
      germanDefinitions,
      examples,
      collocations,
      synonyms,
      domains,
      grammar,
      wordType,
      pronunciation
    };
  }

  function isolateGermanSection(source) {
    const germanStart = source.search(/<h2[^>]*>[\s\S]{0,300}?Deutsch[\s\S]{0,100}?<\/h2>/i);
    if (germanStart < 0) return source;
    const remaining = source.slice(germanStart);
    const nextLanguage = remaining.slice(10).search(/<h2[^>]*>/i);
    return nextLanguage >= 0 ? remaining.slice(0, nextLanguage + 10) : remaining;
  }

  function extractLabeledItems(source, label, maximum) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(
      `<p[^>]*>[\\s\\S]{0,240}?${escaped}:?[\\s\\S]{0,80}?<\\/p>\\s*<dl>([\\s\\S]*?)<\\/dl>`,
      "i"
    ));
    if (!match) return [];
    return [...match[1].matchAll(/<dd>([\s\S]*?)<\/dd>/gi)]
      .map((entry) => cleanDictionaryItem(entry[1]))
      .filter(Boolean)
      .slice(0, maximum);
  }

  function cleanDictionaryItem(value) {
    return htmlToPlainText(String(value || "")
      .replace(/<sup[\s\S]*?<\/sup>/gi, " "))
      .replace(/^\[\d+\]\s*/, "")
      .replace(/\s*\[\d+\]\s*$/, "")
      .slice(0, 500)
      .trim();
  }

  function extractNominativeForms(source) {
    const match = source.match(
      /Nominativ[\s\S]{0,160}?<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i
    );
    const singular = htmlToPlainText(match?.[1]) || null;
    const plural = htmlToPlainText(match?.[2]) || null;
    const article = singular?.match(/^(der|die|das)\b/i)?.[1]?.toLowerCase() || null;
    return { article, singular, plural };
  }

  function labeledGrammarValue(summary, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(summary || "").match(new RegExp(`${escaped}:\\s*([^,;]+)`, "i"));
    return match?.[1]?.trim() || null;
  }

  function extractAuxiliary(source) {
    const index = source.search(/Hilfsverb/i);
    if (index < 0) return null;
    return htmlToPlainText(
      source.slice(index, index + 1_200).match(/<td[^>]*>\s*<a[^>]*>(haben|sein)<\/a>/i)?.[1]
    ) || null;
  }

  function inferSeparableVerb(summary, participle) {
    const lemma = String(summary || "").split(",")[0].replace(/[·\s-]/g, "").toLowerCase();
    const perfectForm = String(participle || "").replace(/[·\s-]/g, "").toLowerCase();
    const prefixes = [
      "heraus", "hinein", "hinauf", "herunter", "zurück", "zusammen", "weiter",
      "statt", "teil", "vorbei", "wieder", "ab", "an", "auf", "aus", "bei", "ein",
      "fest", "fort", "her", "hin", "los", "mit", "nach", "vor", "weg", "zu"
    ];
    return prefixes.some((prefix) => (
      lemma.startsWith(prefix)
      && lemma.length > prefix.length + 2
      && perfectForm.startsWith(`${prefix}ge`)
    ));
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
      germanDefinitions: normalizeTextList(raw.germanDefinitions, 4, 500),
      englishDefinitions: normalizeTextList(raw.englishDefinitions, 4, 500),
      example: nullableText(raw.example, 600),
      exampleTranslation: nullableText(raw.exampleTranslation, 600),
      examples: normalizeExamples(raw.examples),
      collocations: normalizeTextList(raw.collocations, 6, 300),
      synonyms: normalizeTextList(raw.synonyms, 6, 100),
      domains: normalizeTextList(raw.domains, 6, 80),
      wordType: nullableText(raw.wordType, 100),
      pronunciation: nullableText(raw.pronunciation, 100),
      grammar: normalizeGrammar(raw.grammar),
      context: nullableText(raw.context, 600),
      contextTranslation: nullableText(raw.contextTranslation, 600),
      clip: normalizeClip(raw.clip),
      video: normalizeVideoReference(raw.video),
      germanSourceUrl: safeWiktionaryUrl(raw.germanSourceUrl, "de"),
      englishSourceUrl: safeWiktionaryUrl(raw.englishSourceUrl, "en"),
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString()
    };
  }

  function normalizeTextList(values, maximumItems, maximumLength) {
    return (Array.isArray(values) ? values : [])
      .map((value) => nullableText(value, maximumLength))
      .filter((value, index, items) => value && items.indexOf(value) === index)
      .slice(0, maximumItems);
  }

  function normalizeExamples(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => ({
        german: nullableText(item?.german, 600),
        english: nullableText(item?.english, 600),
        source: nullableText(item?.source, 80)
      }))
      .filter((item) => item.german)
      .slice(0, 4);
  }

  function normalizeGrammar(raw = {}) {
    const grammar = {
      summary: nullableText(raw?.summary, 400),
      article: /^(der|die|das)$/i.test(String(raw?.article || ""))
        ? String(raw.article).toLowerCase()
        : null,
      singular: nullableText(raw?.singular, 120),
      plural: nullableText(raw?.plural, 120),
      preterite: nullableText(raw?.preterite, 120),
      participle: nullableText(raw?.participle, 120),
      auxiliary: /^(haben|sein)$/i.test(String(raw?.auxiliary || ""))
        ? String(raw.auxiliary).toLowerCase()
        : null,
      perfect: nullableText(raw?.perfect, 140),
      separable: Boolean(raw?.separable)
    };
    return Object.values(grammar).some(Boolean) ? grammar : null;
  }

  function normalizeClip(raw = {}) {
    const start = Number(raw?.start);
    const end = Number(raw?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return {
      start: Math.max(0, Math.round(start * 1000) / 1000),
      end: Math.max(0, Math.round(end * 1000) / 1000),
      timing: nullableText(raw?.timing, 80) || "estimated"
    };
  }

  function normalizeVideoReference(raw = {}) {
    const key = nullableText(raw?.key, 500);
    if (!key) return null;
    return {
      key,
      title: nullableText(raw?.title, 240),
      url: stablePageUrl(raw?.url),
      platform: nullableText(raw?.platform, 100)
    };
  }

  function stableVideoIdentity(rawUrl, audioLanguage = "de") {
    try {
      const url = new URL(String(rawUrl || ""));
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      let resource = null;
      if (host === "youtu.be") resource = url.pathname.split("/").filter(Boolean)[0] || null;
      if (host.endsWith("youtube.com")) {
        resource = url.searchParams.get("v")
          || url.pathname.match(/^\/(?:shorts|embed)\/([^/?#]+)/i)?.[1]
          || null;
      }
      const canonical = resource && (host === "youtu.be" || host.endsWith("youtube.com"))
        ? `youtube:${resource}`
        : `${host}:${decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/"}`;
      const language = String(audioLanguage || "de").trim().toLowerCase().slice(0, 16) || "de";
      return `${canonical}|audio:${language}`;
    } catch {
      return null;
    }
  }

  function stablePageUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      if (!/^https?:$/.test(url.protocol)) return null;
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (host === "youtu.be" || host.endsWith("youtube.com")) {
        const identity = stableVideoIdentity(url.toString(), "de");
        const id = identity?.match(/^youtube:([^|]+)/)?.[1];
        return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : null;
      }
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function transcriptStorageKey(identity) {
    return identity ? `transcript-library:v1:${hashText(identity)}` : null;
  }

  function transcriptToText(record = {}) {
    const title = nullableText(record?.title || record?.page?.title, 300) || "Untitled video";
    const language = nullableText(record?.audioLanguage, 20) || "unknown";
    const url = stablePageUrl(record?.url || record?.page?.url);
    const segments = Array.isArray(record?.segments) ? record.segments : record?.asrSegments;
    const lines = [];
    let previousText = null;
    for (const segment of [...(segments || [])].sort((a, b) => Number(a.start) - Number(b.start))) {
      const text = nullableText(segment?.text, 2_000);
      if (!text || text === previousText) continue;
      lines.push(`[${formatTimestamp(segment.start)}] ${text}`);
      previousText = text;
    }
    return [
      title,
      `Language: ${language}`,
      ...(url ? [`Source: ${url}`] : []),
      "",
      ...lines,
      ""
    ].join("\n");
  }

  function safeFilename(value) {
    return String(value || "video")
      .normalize("NFKD")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      || "video";
  }

  function formatTimestamp(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
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
    version: 4,
    DEFAULT_CAPTION_PREFERENCES,
    DEFAULT_TRANSLATION_PREFERENCES,
    normalizeCaptionPreferences,
    normalizeTranslationPreferences,
    fontFamilyValue,
    rgbaFromHex,
    sanitizeWord,
    normalizedWord,
    selectionHasText,
    wordActivationDecision,
    translationCacheKey,
    extractEnglishWiktionaryEntry,
    extractGermanWiktionaryEntry,
    htmlToPlainText,
    normalizeVocabularyEntry,
    stableVideoIdentity,
    stablePageUrl,
    transcriptStorageKey,
    transcriptToText,
    safeFilename,
    hashText
  });
})();

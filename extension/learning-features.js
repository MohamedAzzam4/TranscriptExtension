(() => {
  if (globalThis.DubTranscriptLearning?.version === 11) return;

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
    bold: true,
    highlightCurrentWord: true,
    pauseOnWordHover: false
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
      bold: raw.bold !== false,
      highlightCurrentWord: raw.highlightCurrentWord !== false,
      pauseOnWordHover: raw.pauseOnWordHover === true
    };
  }

  function normalizeTranslationPreferences(raw = {}) {
    const targetLanguage = String(raw.targetLanguage || "")
      .trim()
      .replace(/[^a-z0-9-]/gi, "")
      .slice(0, 16)
      .toLowerCase();
    const requestedProvider = String(raw.provider || "").toLowerCase();
    // Historical Google-first preferences now mean browser-first with configured fallback.
    const provider = requestedProvider === "google" ? "auto" : requestedProvider;
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

  function normalizeYouTubePreferences(raw = {}) {
    return {
      enabled: raw.enabled !== false,
      mode: raw.mode === 'audio' ? 'audio' : 'captions',
      translationSource: raw.translationSource === 'extension' ? 'extension' : 'youtube'
    };
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

  function savedVocabularyIndex(entries) {
    // Legacy records use the same normalization; no migration or morphology guesses.
    const index = new Map();
    for (const raw of Array.isArray(entries) ? entries : []) {
      if (!raw || typeof raw.word !== "string") continue;
      const entry = normalizeVocabularyEntry(raw);
      if (entry && !index.has(entry.normalizedWord)) index.set(entry.normalizedWord, entry);
    }
    return index;
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

  function resolveCaptionBottom(basePosition, controlAvoidance = 0) {
    const base = clampNumber(
      basePosition,
      3,
      70,
      DEFAULT_CAPTION_PREFERENCES.verticalPosition
    );
    const avoidance = clampNumber(controlAvoidance, 0, 35, 0);
    return Math.round(Math.max(base, avoidance) * 10) / 10;
  }

  function translationCacheKey(text, sourceLanguage, targetLanguage, providerPolicy = "auto") {
    const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
    return [
      "translation:v2",
      String(sourceLanguage || "auto").toLowerCase(),
      String(targetLanguage || "en").toLowerCase(),
      String(providerPolicy || "auto").toLowerCase(),
      hashText(normalizedText)
    ].join(":");
  }

  function extractEnglishWiktionaryEntry(payload) {
    const entries = Array.isArray(payload?.de) ? payload.de : [];
    const definitions = [];
    const examples = [];
    let lemma = null;
    let partOfSpeech = null;
    for (const entry of entries) {
      partOfSpeech ||= nullableText(entry?.partOfSpeech, 80);
      for (const item of entry?.definitions || []) {
        const definition = htmlToPlainText(item?.definition);
        lemma ||= dictionaryFormLemma(definition);
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
      directMeanings: directWordMeanings({ englishDefinitions: definitions }),
      lemma,
      grammarNotes: definitions.filter(isGrammaticalDefinition).slice(0, 3),
      example: examples[0]?.german || null,
      exampleTranslation: examples[0]?.english || null,
      examples,
      partOfSpeech
    };
  }

  function isGrammaticalDefinition(value) {
    return /^(?:\([^)]*\)\s*)?(?:(?:first|second|third)[ -]person\b|(?:past|present|perfect)\s+participle\b|(?:inflection|inflected|alternative|alternate|obsolete|archaic|comparative|superlative|plural|singular|genitive|dative|accusative|nominative|feminine|masculine|neuter|imperative|indicative|subjunctive|simple past|past tense)\b.*\b(?:of|form)\b)/i.test(String(value || ""));
  }

  function dictionaryFormLemma(definition) {
    if (!isGrammaticalDefinition(definition)) return null;
    const match = String(definition).match(/\bof\s+[“"'‘]?([\p{L}\p{M}]+(?:[-’'][\p{L}\p{M}]+)*)/u);
    return match ? sanitizeWord(match[1]) : null;
  }

  function directWordMeanings(entry = {}) {
    const definitions = entry.directMeanings?.length ? entry.directMeanings
      : entry.englishDefinitions?.length ? entry.englishDefinitions
        : String(entry.englishDefinition || "").split(/\s*;\s*/);
    return normalizeTextList(definitions, 4, 300).filter((value) => !isGrammaticalDefinition(value));
  }

  function germanWordDefinitions(entry = {}) {
    const values = entry.germanDefinitions?.length ? entry.germanDefinitions : [entry.germanDefinition];
    return normalizeTextList(values, 256, 4000).filter((value) => !/für diese bedeutung fehlt|bedeutung.*(?:fehlt|ergänzen)|keine.*definition|bedeutungen.*\?/i.test(value));
  }

  function extractCaseGovernment(value) {
    const source = String(value || "");
    // A leading annotation has a bounded delimiter. Case names in ordinary prose
    // are never enough to classify a sentence as a government rule.
    const match = source.match(/^\s*(\([^)]*\b(?:Akkusativ|Dativ|Genitiv)\b[^)]*\)|(?:(?:Wechselpräposition|Präposition|Postposition)\s*[,;]?\s*)?mit\s+(?:dem\s+)?(?:Akkusativ|Dativ|Genitiv)\b[^:]*:)/i)
      || source.match(/^\s*(mit\s+(?:dem\s+)?(?:Akkusativ|Dativ|Genitiv)(?:\s+(?:und|oder)\s+(?:dem\s+)?(?:Akkusativ|Dativ|Genitiv))*)\s*[,;–-]?\s*/i);
    if (!match) return { definition: source.trim(), cases: [], government: null };
    const cases = [...match[1].matchAll(/Akkusativ|Dativ|Genitiv/gi)]
      .map((item) => item[0][0].toUpperCase() + item[0].slice(1).toLowerCase())
      .filter((item, index, all) => all.indexOf(item) === index);
    const definition = source.slice(match[0].length);
    return { definition: definition.replace(/^\s*[:;,]\s*/, "").trim(), cases,
      government: match[1].replace(/^\(|\)$|:$/g, "").trim() };
  }

  function highlightedTextParts(text, phrases = [], language = "de") {
    // Match displayed phrases, never invent an alignment for a paraphrased translation.
    const source = String(text || "");
    const needles = normalizeTextList(phrases, 12, 300).sort((a, b) => b.length - a.length);
    const ranges = [];
    for (const phrase of needles) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(escaped, "giu");
      for (const match of source.matchAll(pattern)) {
        const start = match.index;
        let end = start + match[0].length;
        const before = source.slice(0, start).match(/[\p{L}\p{M}]+$/u)?.[0] || "";
        const after = source.slice(end).match(/^[\p{L}\p{M}]+/u)?.[0] || "";
        const arabicSuffix = /^ar(?:-|$)/i.test(language) && !before && /^(?:ني|نا|ه|ها|هم|هن|هما|ك|كما|كم|كن)$/u.test(after);
        if (before || (after && !arabicSuffix)) continue;
        if (arabicSuffix) end += after.length;
        if (!ranges.some((range) => start < range.end && end > range.start)) ranges.push({ start, end });
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) parts.push({ text: source.slice(cursor, range.start), highlighted: false });
      parts.push({ text: source.slice(range.start, range.end), highlighted: true });
      cursor = range.end;
    }
    if (cursor < source.length) parts.push({ text: source.slice(cursor), highlighted: false });
    return parts;
  }

  function distinctMatchingCandidates(text, candidates = [], language = "en") {
    // Count candidate identities before resolving ranges: overlap is still ambiguity.
    const source = String(text || "");
    const distinct = normalizeTextList(candidates, 16, 500)
      .map((value) => value.normalize("NFC").trim())
      .filter((value, index, values) => values.findIndex((other) => other.toLocaleLowerCase(language) === value.toLocaleLowerCase(language)) === index);
    return distinct.filter((candidate) => highlightedTextParts(source, [candidate], language).some((part) => part.highlighted));
  }

  function extractGermanWiktionaryEntry(html) {
    return readStructuredGermanEntry(String(html || ""));
  }

  // Small inert HTML tree: no DOM, scripts, network, or browser dependencies.
  // Retaining ancestry is essential: nested dd elements and repeated sense
  // numbers cannot be extracted reliably with a single cross-section regex.
  function dictionaryTree(html) {
    const root = { tag: "root", children: [], attrs: {} };
    const stack = [root];
    for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || []) {
      if (/^<!/.test(token)) continue;
      const closing = token.match(/^<\/([\w-]+)/);
      if (closing) {
        const index = stack.findLastIndex((node) => node.tag === closing[1].toLowerCase());
        if (index > 0) stack.length = index;
      } else if (token.startsWith("<")) {
        const tag = token.match(/^<([\w-]+)/)?.[1]?.toLowerCase();
        if (!tag) continue;
        const attrs = {};
        for (const match of token.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1]] = match[2] ?? match[3];
        const node = { tag, attrs, children: [], parent: stack.at(-1) };
        stack.at(-1).children.push(node);
        if (!/^(br|hr|img|input|meta|link|wbr|source)$/.test(tag) && !/\/>$/.test(token)) stack.push(node);
      } else stack.at(-1).children.push({ tag: "#text", value: token });
    }
    return root;
  }

  function dictionaryText(node, omitLists = false) {
    if (node.tag === "#text") return htmlToPlainText(node.value);
    if (/^(sup|script|style)$/.test(node.tag) || /(?:^|\s)(?:mw-editsection|reference|noprint)(?:\s|$)/.test(node.attrs?.class || "")) return "";
    const value = node.children.filter((child) => !omitLists || !/^(dl|ul|ol)$/.test(child.tag))
      .map((child) => dictionaryText(child, omitLists)).join(" ").replace(/\s+/g, " ").replace(/\s+([,.!?;:)])/g, "$1").replace(/\(\s+/g, "(").trim();
    if (node.tag === "span" && /^(?:•\s*)?Diese Bedeutungsangabe muss überarbeitet werden|^—\s*Kommentar:/.test(value)) return "";
    return value;
  }

  function normalizeExampleQuotation(text) {
    let value = String(text || "").trim();
    // Remove only repeated outer pairs; preserve one source pair and internal quotes.
    while (/^„„[\s\S]*““$/.test(value)) value = value.slice(1, -1);
    return /^[„“»«"‚‘]/.test(value) ? value : `„${value}“`;
  }

  function readStructuredGermanEntry(html) {
    const root = dictionaryTree(html);
    const nodes = [];
    const visit = (node) => { nodes.push(node); for (const child of node.children || []) visit(child); };
    visit(root);
    const languageHeadings = nodes.filter((node) => node.tag === "h2");
    const hasWordHeadings = nodes.some((node) => node.tag === "h3");
    let german = languageHeadings.length === 0; // small historical fixtures omit language headings
    let section = null;
    let mode = "";
    const sections = [];
    const createSection = (heading = "") => {
      const item = { id: `de-${sections.length + 1}`, heading, definitions: [], examples: [], governments: [], tables: [], summary: null, lemma: null };
      sections.push(item); return item;
    };
    const labelPattern = /^(Bedeutungen|Beispiele|Worttrennung|Grammatische Merkmale|Grammatik|Anmerkung|Anmerkungen|Aussprache|Herkunft|Synonyme|Gegenwörter|Oberbegriffe|Unterbegriffe|Redewendungen|Charakteristische Wortkombinationen|Wortbildungen|Übersetzungen|Referenzen|Quellen|Ähnliche Wörter|Nebenformen|Alternative Schreibweisen)\s*:/;
    for (const node of nodes) {
      if (node.tag === "h2") {
        german = /\bDeutsch\b/.test(dictionaryText(node)); section = null; mode = ""; continue;
      }
      if (!german) continue;
      if (node.tag === "h3") { section = createSection(dictionaryText(node)); mode = ""; continue; }
      if (/^h[4-6]$/.test(node.tag)) { mode = dictionaryText(node).replace(/:$/, ""); continue; }
      const text = dictionaryText(node, true);
      if (node.tag === "p" || node.tag === "dt") {
        const label = text.match(labelPattern);
        if (label) { mode = label[1]; section && (section.contextGovernment = null); continue; }
        if (node.tag === "p" && text.endsWith(":" ) && text.length < 120) { mode = text.slice(0, -1); continue; }
        if (node.tag === "dt" && mode === "Bedeutungen" && /(?:mit|Präposition|Postposition).*\b(?:Akkusativ|Dativ|Genitiv)\b/i.test(text)) {
          section ||= createSection(); section.contextGovernment = text.replace(/:$/, ""); continue;
        }
        if (node.tag === "p" && mode && !/^(Bedeutungen|Beispiele|Worttrennung|Grammatik|Anmerkung)/.test(mode)) continue;
      }
      if (!section && !hasWordHeadings && (/^(dd|li|table)$/.test(node.tag))) section = createSection();
      if (!section) continue;
      if (node.tag === "table") { section.tables.push(node); continue; }
      // Do not treat navigation/list entries or table cells as dictionary list items.
      if (!/^(dd|li)$/.test(node.tag) || !text) continue;
      let ancestor = node.parent;
      let insideTable = false;
      while (ancestor) { if (ancestor.tag === "table") insideTable = true; ancestor = ancestor.parent; }
      if (insideTable) continue;
      const marker = text.match(/^(?:\[[\da-z\s,.–-]+\]\s*)+/i);
      const refs = marker ? [...marker[0].matchAll(/\[([^\]]+)\]/g)].flatMap(match => expandMeaningReferences(match[1])) : [];
      const body = marker ? text.slice(marker[0].length).trim() : text;
      if (mode === "Bedeutungen" && body && !/für diese bedeutung fehlt|bedeutung.*ergänzen/i.test(body)) {
        if (!marker && /^(?:(?:Präposition|Postposition|Wechselpräposition).*|mit\s+).*\b(?:Akkusativ|Dativ|Genitiv)\b/i.test(body)) {
          section.contextGovernment = body.replace(/:$/, "");
          section.governments.push({ text: section.contextGovernment, senseId: null, sectionId: section.id }); continue;
        }
        if (!marker && body.endsWith(":")) continue; // list-group label, not a definition
        let parentItem = node.parent;
        while (parentItem && !/^(dd|li)$/.test(parentItem.tag)) parentItem = parentItem.parent;
        if (!refs.length && parentItem) continue;
        const clean = extractCaseGovernment(body);
        const withoutLabels = stripDictionaryLabels(clean.definition);
        const auxiliaryAnnotation = withoutLabels.match(/^\s*Hilfsverb\s+(haben|sein)\s*:\s*/i);
        const annotated = auxiliaryAnnotation ? withoutLabels.slice(auxiliaryAnnotation[0].length) : withoutLabels;
        const id = `${section.id}:${refs[0] || `unlabeled-${section.definitions.length + 1}`}`;
        if (clean.government) section.governments.push({ text: clean.government, senseId: id, sectionId: section.id });
        if (annotated) section.definitions.push({ id, sectionId: section.id, sourceSenseId: refs[0] || null, sourceText: body, definition: annotated, government: clean.government, auxiliary: auxiliaryAnnotation?.[1]?.toLowerCase() || null, examples: [] });
        for (const nested of node.children.filter((child) => /^(dl|ul|ol)$/.test(child.tag))) {
          const annotation = dictionaryText(nested);
          if (/Gebrauch\s*\(Grammatik\)|Grammatik:/.test(annotation)) section.governments.push({ text: annotation, senseId: id, sectionId: section.id });
        }
      } else if (mode === "Beispiele" && body) {
        section.examples.push({ german: body, sectionId: section.id, sourceSenseIds: refs, source: "German Wiktionary" });
      } else if (mode === "Worttrennung") section.summary ||= text;
      else if (/Grammatik|Anmerkung/.test(mode) && /\b(?:Akkusativ|Dativ|Genitiv)\b/.test(body) && /(?:mit|regiert|verlangt|fordert|Präposition|Postposition)/i.test(body)) {
        section.governments.push({ text: body, senseId: null, sectionId: section.id });
      }
    }
    for (const item of sections) {
      for (const example of item.examples) {
        const matches = item.definitions.filter((sense) => sense.sourceSenseId && example.sourceSenseIds.includes(sense.sourceSenseId));
        example.senseIds = matches.map((sense) => sense.id);
        example.senseId = matches.length === 1 ? matches[0].id : null;
        example.unassigned = matches.length === 0;
        for (const sense of matches) sense.examples.push(example);
      }
    }
    const senses = sections.flatMap((item) => item.definitions);
    const examples = sections.flatMap((item) => item.examples);
    const verbSections = sections.filter((item) => /\bVerb\b/.test(item.heading) && !/Adverb/.test(item.heading));
    const baseForms = [];
    for (const item of sections.filter(section => /Konjugierte Form|\bVerb\b/.test(section.heading))) {
      for (const table of item.tables) {
        if (!/(?:flektierte|konjugierte) Form (?:von|zu)/i.test(dictionaryText(table))) continue;
        const links = [];
        const collect = node => { if (node.tag === 'a') links.push(node); for (const child of node.children || []) collect(child); };
        collect(table);
        const link = links.find(node => /^\/wiki\/[^#?:]+$/.test(node.attrs.href || ''));
        if (link) {
          try { baseForms.push({ sectionId: item.id, infinitive: sanitizeWord(decodeURIComponent(link.attrs.href.slice(6)).replace(/_/g, ' ')) }); } catch { /* malformed source link has no trusted base */ }
        }
      }
    }
    const summary = verbSections[0]?.summary || null;
    const conjugations = verbSections.flatMap((item) => item.tables.flatMap((table) => readConjugationTable(table, item.id)));
    const governments = sections.flatMap((item) => item.governments);
    const participle = labeledGrammarValue(summary, "Partizip II")?.replace(/·/g, "") || null;
    const auxiliary = extractAuxiliary(html);
    return {
      germanDefinition: senses.map((item) => item.definition).join(" ") || null,
      germanDefinitions: senses.map((item) => item.definition), senses, examples,
      sections: sections.map(({ id, heading }) => ({ id, heading })),
      grammar: { summary, governments, baseForms, infinitive: baseForms[0]?.infinitive || null,
        cases: [...new Set(governments.flatMap((item) => item.text.match(/Akkusativ|Dativ|Genitiv/g) || []))],
        auxiliaries: senses.filter(sense => sense.auxiliary).map(sense => ({ senseId: sense.id, auxiliary: sense.auxiliary,
          perfect: participle ? `${sense.auxiliary === 'sein' ? 'ist' : 'hat'} ${participle}` : null })),
        conjugations, present: conjugations.filter((item) => item.tense === "Präsens" && item.mood === "Indikativ").map((item) => `${item.person} ${item.form}`).join("; ") || null,
        preterite: labeledGrammarValue(summary, "Präteritum") || null, participle: labeledGrammarValue(summary, "Partizip II"), auxiliary,
        perfect: auxiliary && participle ? `${auxiliary === "sein" ? "ist" : "hat"} ${labeledGrammarValue(summary, "Partizip II")}` : null,
        separable: inferSeparableVerb(summary, participle) },
      isVerb: verbSections.length > 0 || baseForms.length > 0,
      lemma: senses.length ? null : (baseForms[0]?.infinitive || extractExplicitGermanLemma(isolateGermanSection(html))),
      pronunciation: htmlToPlainText(isolateGermanSection(html).match(/class="ipa"[^>]*>([\s\S]*?)<\/span>/i)?.[1]) || null
    };
  }

  function expandMeaningReferences(value) {
    const refs = [];
    for (const part of value.split(",")) {
      const range = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range && Number(range[2]) - Number(range[1]) < 100) {
        for (let n = Number(range[1]); n <= Number(range[2]); n++) refs.push(String(n));
      } else if (/^\d+(?:\.\d+)*[a-z]?$/.test(part.trim())) refs.push(part.trim());
    }
    return [...new Set(refs)];
  }

  function stripDictionaryLabels(text) {
    // Only bounded, leading dictionary labels; never delete terms inside prose.
    const labels = /^(?:(?:Interrogativpronomen|Indefinitpronomen|Relativpronomen|transitiv|intransitiv|reflexiv|umgangssprachlich|veraltet|regional|gehoben|salopp|selten|meist umgangssprachliche Kurzform für)\s*[,;:]\s*)/i;
    let result = text;
    while (labels.test(result)) result = result.replace(labels, "");
    return result;
  }

  function readConjugationTable(table, sectionId) {
    const rows = [];
    const walk = (node) => { if (node.tag === "tr") rows.push(node); else for (const child of node.children || []) walk(child); };
    walk(table);
    let tense = null;
    let rowMood = null;
    let headers = [];
    const result = [];
    for (const row of rows) {
      const cells = row.children.filter((node) => /^(th|td)$/.test(node.tag));
      const texts = cells.map((node) => dictionaryText(node));
      const heading = texts.join(" ");
      const rowLabel = texts[cells.findIndex(cell => cell.tag === 'th')] || '';
      if (/^Konjunktiv/.test(rowLabel)) { tense = rowLabel; rowMood = rowLabel; }
      if (/^Imperativ/.test(rowLabel)) { tense = 'Imperativ'; rowMood = 'Imperativ'; }
      if (cells.some((node) => node.tag === "th") && /Präsens|Präteritum|Perfekt|Futur|Plusquamperfekt/.test(heading)) {
        tense = heading.match(/Plusquamperfekt|Präteritum|Präsens|Perfekt|Futur(?: II| I)?/)?.[0];
        headers = texts;
        rowMood = null;
        if (!texts.some((text) => /^(ich|du|er, sie, es|wir|ihr|sie)$/.test(text))) continue;
      }
      if (/Indikativ|Konjunktiv|Imperativ/.test(heading) && cells.every((node) => node.tag === "th")) { headers = texts; continue; }
      const personPattern = /^(?:ich|du|er,? sie,? es|wir|ihr|sie|Singular|Plural)$/i;
      if (!tense || !texts.some((text) => personPattern.test(text))) continue;
      const personIndex = texts.findIndex((text) => personPattern.test(text));
      for (let index = personIndex + 1; index < cells.length; index++) {
        if (!texts[index] || /^[—–-]$/.test(texts[index])) continue;
        // German Wiktionary's compact verb overview explicitly names its row
        // tense, person and Wortform; those Präsens/Präteritum rows are indicative.
        const mood = rowMood || headers[index]?.match(/Indikativ|Konjunktiv(?: I| II)?|Imperativ/)?.[0]
          || (/^(Präsens|Präteritum)$/.test(tense) && cells[index].attrs.colspan === "3" ? "Indikativ" : null);
        const variants = [''];
        for (const child of cells[index].children) {
          if (child.tag === 'br') variants.push('');
          else variants[variants.length - 1] += ` ${dictionaryText(child)}`;
        }
        if (mood) for (const variant of variants.map(value => value.trim()).filter(Boolean)) result.push({ sectionId, tense, mood, person: texts[personIndex], form: variant });
      }
    }
    return result;
  }

  function extractExplicitGermanLemma(source) {
    // Accept only the linked lemma in a German "form of" relation, never a help/category link.
    const relation = String(source).match(/(?:flektierte|konjugierte)\s+Form\s+(?:von|zu)|Grundform[\s\S]{0,80}?(?:von|ist)/i);
    if (!relation) return null;
    const nearby = String(source).slice(relation.index, relation.index + 700);
    const match = nearby.match(/href="\/wiki\/([^"#?:]+)"[^>]*>([^<]+)<\/a>/i);
    if (!match) return null;
    try { return sanitizeWord(decodeURIComponent(match[1]).replace(/_/g, " ")) || null; }
    catch { return null; }
  }

  function isolateGermanSection(source) {
    const germanStart = source.search(/<h2[^>]*>[\s\S]{0,300}?Deutsch[\s\S]{0,100}?<\/h2>/i);
    if (germanStart < 0) return /<h2\b/i.test(source) ? '' : source;
    const remaining = source.slice(germanStart);
    const nextLanguage = remaining.slice(10).search(/<h2[^>]*>/i);
    return nextLanguage >= 0 ? remaining.slice(0, nextLanguage + 10) : remaining;
  }

  function extractLabeledItems(source, label, maximum) {
    return extractLabeledItemsWithSense(source, label, maximum).map((item) => item.text);
  }

  function extractLabeledItemsWithSense(source, label, maximum) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(
      `<p[^>]*>[\\s\\S]{0,240}?${escaped}:?[\\s\\S]{0,80}?<\\/p>\\s*<dl>([\\s\\S]*?)<\\/dl>`,
      "i"
    ));
    if (!match) return [];
    return [...match[1].matchAll(/<dd>([\s\S]*?)<\/dd>/gi)]
      .map((entry) => {
        const raw = entry[1];
        return { senseId: htmlToPlainText(raw).match(/^\s*\[(\d+(?:\.\d+)?)\]/)?.[1] || null, text: cleanDictionaryItem(raw) };
      })
      .filter((item) => item.text)
      .slice(0, maximum);
  }

  function cleanDictionaryItem(value) {
    return htmlToPlainText(String(value || "")
      .replace(/<sup[\s\S]*?<\/sup>/gi, " "))
      .replace(/^\[\d+(?:\.\d+)?\]\s*/, "")
      .replace(/\s*\[\d+(?:\.\d+)?\]\s*$/, "")
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
      germanDefinitions: normalizeTextList(raw.germanDefinitions, 256, 4000),
      senses: normalizeSenses(raw.senses),
      lemma: sanitizeWord(raw.lemma) || null,
      definitionLemma: sanitizeWord(raw.definitionLemma) || null,
      example: nullableText(raw.example, 600),
      exampleTranslation: nullableText(raw.exampleTranslation, 600),
      examples: normalizeExamples(raw.examples),
      isVerb: Boolean(raw.isVerb),
      pronunciation: nullableText(raw.pronunciation, 100),
      grammar: normalizeGrammar(raw.grammar),
      context: nullableText(raw.context, 600),
      contextTranslation: nullableText(raw.contextTranslation, 600),
      clip: normalizeClip(raw.clip),
      video: normalizeVideoReference(raw.video),
      germanSourceUrl: safeWiktionaryUrl(raw.germanSourceUrl, "de"),
      dictionaryContract: ["de-wiktionary:v1", "de-wiktionary:v2", "de-wiktionary:v3"].includes(raw.dictionaryContract) && safeWiktionaryUrl(raw.germanSourceUrl, "de")
        ? raw.dictionaryContract
        : null,
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
        german: nullableText(item?.german, 8000),
        senseId: nullableText(item?.senseId, 64),
        sectionId: nullableText(item?.sectionId, 64),
        senseIds: normalizeTextList(item?.senseIds, 256, 64),
        sourceSenseIds: normalizeTextList(item?.sourceSenseIds, 256, 32),
        unassigned: Boolean(item?.unassigned),
        source: nullableText(item?.source, 80)
      }))
      .filter((item) => item.german)
      .slice(0, 512);
  }

  function normalizeSenses(values) {
    return (Array.isArray(values) ? values : []).map((item) => ({
      id: nullableText(item?.id, 48),
      sourceSenseId: nullableText(item?.sourceSenseId, 32),
      sectionId: nullableText(item?.sectionId, 64),
      definition: nullableText(item?.definition, 4000),
      government: nullableText(item?.government, 4000),
      auxiliary: /^(haben|sein)$/.test(item?.auxiliary || '') ? item.auxiliary : null,
      examples: normalizeExamples(item?.examples)
    })).filter((item) => item.id && item.definition).slice(0, 256);
  }

  function normalizeGrammar(raw = {}) {
    const grammar = {
      summary: nullableText(raw?.summary, 400),
      preterite: nullableText(raw?.preterite, 120),
      present: nullableText(raw?.present, 2000),
      conjugations: (Array.isArray(raw?.conjugations) ? raw.conjugations : []).map((item) => ({
        sectionId: nullableText(item?.sectionId, 64), tense: nullableText(item?.tense, 80),
        mood: nullableText(item?.mood, 80), person: nullableText(item?.person, 80), form: nullableText(item?.form, 300)
      })).filter((item) => item.tense && item.person && item.form).slice(0, 512),
      auxiliaries: (Array.isArray(raw?.auxiliaries) ? raw.auxiliaries : []).map(item => ({
        senseId: nullableText(item?.senseId, 64), auxiliary: /^(haben|sein)$/.test(item?.auxiliary || '') ? item.auxiliary : null,
        perfect: nullableText(item?.perfect, 300)
      })).filter(item => item.auxiliary),
      baseForms: (Array.isArray(raw?.baseForms) ? raw.baseForms : []).map(item => ({
        sectionId: nullableText(item?.sectionId, 64), infinitive: nullableText(item?.infinitive, 120)
      })).filter(item => item.infinitive),
      infinitive: nullableText(raw?.infinitive, 120),
      participle: nullableText(raw?.participle, 120),
      auxiliary: /^(haben|sein)$/i.test(String(raw?.auxiliary || ""))
        ? String(raw.auxiliary).toLowerCase()
        : null,
      perfect: nullableText(raw?.perfect, 140),
      separable: Boolean(raw?.separable),
      cases: normalizeTextList(raw?.cases, 3, 24).filter((item) => /^(Akkusativ|Dativ|Genitiv)$/.test(item)),
      governments: (Array.isArray(raw?.governments) ? raw.governments : []).map((item) => ({
        text: nullableText(item?.text, 4000), senseId: nullableText(item?.senseId, 64), sectionId: nullableText(item?.sectionId, 64)
      })).filter((item) => item.text)
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
      url.username = "";
      url.password = "";
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
    const segments = Array.isArray(record?.segments) ? record.segments
      : record.transcriptSource?.provider === 'youtube' ? record.captionSegments : record?.asrSegments;
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
      ...(record.transcriptSource?.provider === 'youtube' ? [`Transcript: ${record.transcriptSource.kind} (${record.transcriptSource.language})`] : []),
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
        return stablePageUrl(url.toString());
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
    version: 11,
    DEFAULT_CAPTION_PREFERENCES,
    DEFAULT_TRANSLATION_PREFERENCES,
    normalizeCaptionPreferences,
    normalizeYouTubePreferences,
    normalizeTranslationPreferences,
    fontFamilyValue,
    rgbaFromHex,
    sanitizeWord,
    normalizedWord,
    savedVocabularyIndex,
    selectionHasText,
    wordActivationDecision,
    resolveCaptionBottom,
    translationCacheKey,
    extractEnglishWiktionaryEntry,
    directWordMeanings,
    germanWordDefinitions,
    extractCaseGovernment,
    dictionaryFormLemma,
    highlightedTextParts,
    distinctMatchingCandidates,
    extractGermanWiktionaryEntry,
    normalizeExampleQuotation,
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

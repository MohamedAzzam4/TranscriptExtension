(() => {
  const CONTENT_SCRIPT_VERSION = 29;
  if (globalThis.__dubTranscriptLabVersion === CONTENT_SCRIPT_VERSION) return;

  const transcriptGroups = globalThis.DubTranscriptGroups;
  const learning = globalThis.DubTranscriptLearning;
  const mediaCandidate = globalThis.DubTranscriptMediaCandidate;
  const localMedia = globalThis.DubTranscriptLocalMedia;
  // Only the extension popup can mount a standalone review. Ordinary sites keep
  // the player lifecycle and its required discovery dependencies.
  const reviewContainer = globalThis.location?.protocol === "chrome-extension:"
    ? document.querySelector("#savedWordDetailCard") : null;
  if (!reviewContainer && !transcriptGroups) throw new Error("Transcript grouping helpers were not loaded.");
  if (!learning) throw new Error("Learning feature helpers were not loaded.");
  if (!reviewContainer && !mediaCandidate) throw new Error("Media candidate helpers were not loaded.");
  if (!reviewContainer && !localMedia) throw new Error("Local media helpers were not loaded.");

  let pronunciationController = null;
  let hoverPause = null;
  const transientNotices = new Map();
  const WORD_CARD_HELP_TEXT = "Dictionary definitions; translations use your selected provider. Highlights mark matching terms.";

  let video = null;
  let session = null;
  let clockTimer = null;
  let wordHighlightFrame = null;
  let captionTimer = null;
  let seekTimer = null;
  let overlayHost = null;
  let playerContainer = null;
  let playerInlinePosition = null;
  let wrapElement = null;
  let captionBoxElement = null;
  let captionDragHandleElement = null;
  let transcriptElement = null;
  let wordTimingProvenanceElement = null;
  let translationElement = null;
  let statusElement = null;
  let wordCardElement = null;
  let wordTitleElement = null;
  let wordMetaElement = null;
  let wordTranslatedDefinitionElement = null;
  let wordGermanDefinitionElement = null;
  let wordExamplesElement = null;
  let wordCollocationsElement = null;
  let wordGrammarElement = null;
  let wordRelatedElement = null;
  let wordSaveElement = null;
  let wordReplayElement = null;
  let wordYouglishElement = null;
  let wordSpeakElement = null;
  let wordVoiceStatusElement = null;
  let wordReturnSourceElement = null;
  let wordGermanSourceElement = null;
  let wordEnglishSourceElement = null;
  let wordSavedContextElement = null;
  let wordAlternativesElement = null;
  let wordDefinitionNoteElement = null;
  let wordTranslationStatusElement = null;
  let currentCaption = null;
  let captionDrag = null;
  let suppressTranscriptClick = false;
  let wordReplay = null;
  let listeners = [];
  let savedVocabulary = new Map();
  let vocabularyRevision = 0;
  const mediaSecurityStates = new WeakMap();
  let reviewCallbacks = null;

  if (reviewContainer) {
    globalThis.DubSavedWordReview = {
      open: openSavedWordReview, close: closeWordCard,
      suspend: () => pronunciationController?.cancel(),
      getState: () => ({ expanded: [...(wordCardElement?.querySelectorAll("details") || [])].map(detail => Boolean(detail.open)) }),
      restoreState(state) {
        if (!Array.isArray(state?.expanded)) return;
        [...(wordCardElement?.querySelectorAll("details") || [])].forEach((detail, index) => {
          detail.open = Boolean(state.expanded[index]);
        });
      }
    };
    return;
  }

  document.addEventListener("pointerdown", dismissWordCardOutside, true);

  function dismissWordCardOutside(event) {
    const path = event.composedPath();
    if (path.includes(wordCardElement)
      || (path.includes(transcriptElement) && path.some((element) => element?.classList?.contains("word")))) return;
    if (session) {
      if (wordCardElement && !wordCardElement.hidden) closeWordCard();
    } else {
      // A click in the parent document must also dismiss a card inside an embedded player.
      void chrome.runtime.sendMessage({ type: "DISMISS_WORD_CARD" }).catch(() => {});
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.experimentSettings && session) {
      const settings = changes.experimentSettings.newValue || {};
      applyDisplaySettings(settings.captionPreferences, settings.translationPreferences);
      session.syncOffset = Number(settings.syncOffset) || 0;
    }
    if (areaName !== "local" || !changes.savedVocabulary) return;
    vocabularyRevision += 1;
    updateSavedVocabulary(changes.savedVocabulary.newValue);
  });

  function updateSavedVocabulary(entries) {
    savedVocabulary = learning.savedVocabularyIndex(entries);
    refreshSavedWordMarks();
  }

  async function loadSavedVocabulary() {
    const owner = session;
    const revision = vocabularyRevision;
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_SAVED_WORDS" });
      if (session !== owner || vocabularyRevision !== revision) return;
      if (!response?.ok) throw new Error(response?.error || "Saved words are unavailable.");
      updateSavedVocabulary(response.entries);
    } catch (error) {
      if (session === owner) renderStatus(`Saved-word markers unavailable: ${error.message}`, true);
    }
  }

  function applySavedWordMark(element) {
    const saved = savedVocabulary.has(learning.normalizedWord(element.dataset.word));
    element.classList.toggle("saved-word", saved);
    element.setAttribute("aria-label", `Look up ${element.dataset.word}${saved ? ", saved word" : ""}`);
    element.title = saved ? "Saved word — click to review" : "Click to look up";
  }

  function refreshSavedWordMarks() {
    // Update spans in place: replacing the cue would destroy native selection/focus.
    for (const element of transcriptElement?.querySelectorAll(".word") || []) applySavedWordMark(element);
    if (session?.selectedWordResult) {
      const saved = savedVocabulary.has(learning.normalizedWord(session.selectedWord));
      session.selectedWordResult.saved = saved;
      renderSaveState(saved, false);
      renderSavedWordContext(savedVocabulary.get(learning.normalizedWord(session.selectedWord)));
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      switch (message.type) {
        case "PING_CONTENT":
          sendResponse({ ok: true, ready: true, version: CONTENT_SCRIPT_VERSION });
          break;
        case "GET_MEDIA_CONTEXT": {
          video = findPrimaryVideo();
          sendResponse({ ok: Boolean(video), context: video ? mediaContext(video) : null });
          break;
        }
        case "CONTROL_MEDIA": {
          video = video || findPrimaryVideo();
          if (!video) throw new Error("No video element is available.");
          if (message.action === "pause") {
            video.pause();
            sendResponse({ ok: true });
            break;
          }
          if (message.action === "play") {
            Promise.resolve(video.play())
              .then(() => sendResponse({ ok: true }))
              .catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
          }
          throw new Error(`Unknown media action: ${message.action}`);
        }
        case "BEGIN_SESSION":
          beginSession(message);
          sendResponse({ ok: true });
          break;
        case "END_SESSION":
          endSession();
          sendResponse({ ok: true });
          break;
        case "DISMISS_WORD_CARD":
          closeWordCard();
          sendResponse({ ok: true });
          break;
        case "TRANSCRIPT_UPDATE":
          if (session) {
            const nextSegments = message.segments || [];
            const previousIds = new Set(
              session.segments.filter(isDisplayReady).map((segment) => segment.id)
            );
            const newlyCommitted = nextSegments
              .filter((segment) => isDisplayReady(segment) && !previousIds.has(segment.id))
              .at(-1);
            if (newlyCommitted?.text) {
              session.lastCommitted = {
                text: newlyCommitted.text,
                receivedAt: performance.now()
              };
            }
            session.segments = nextSegments;
            session.displayGroups = transcriptGroups.buildDisplayGroups(nextSegments);
            session.buffer = message.buffer || "";
            session.remainingTimeTranscription = message.remainingTimeTranscription;
            session.processingLag = message.processingLag;
            session.stabilizationDelay = message.stabilizationDelay;
            renderTranscript();
            if (!session.replay) renderLiveStatus();
          }
          sendResponse({ ok: true });
          break;
        case "SET_SYNC_OFFSET":
          if (session) {
            session.syncOffset = transcriptGroups.normalizeSyncOffset(message.offset);
            renderTranscript();
          }
          sendResponse({ ok: true, syncOffset: session?.syncOffset ?? 0 });
          break;
        case "APPLY_DISPLAY_SETTINGS":
          applyDisplaySettings(
            message.captionPreferences,
            message.translationPreferences,
            message.resetTranslationCache
          );
          sendResponse({ ok: true });
          break;
        case "SET_CAPTION_COLLECTION":
          setCaptionCollection(Boolean(message.enabled));
          sendResponse({ ok: true });
          break;
        case "SET_REPLAY_MODE":
          if (session) {
            session.replay = message.enabled;
            renderTranscript();
            if (!message.enabled) renderLiveStatus();
          }
          sendResponse({ ok: true });
          break;
        case "STATUS_UPDATE":
          renderStatus(message.error || message.status, Boolean(message.error));
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: true });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return false;
  });

  function beginSession(message) {
    endSession();
    video = findPrimaryVideo();
    if (!video) throw new Error("No video element is available.");
    session = {
      id: message.experimentId,
      youtubeCaptions: Boolean(message.youtubeCaptions),
      youtubeRequest: message.youtubeRequest || null,
      sourceVideo: message.sourceVideo || null,
      platformTranslations: message.platformTranslations || [],
      platformTranslationLanguage: message.platformTranslationLanguage || '',
      platformTranslationPending: Boolean(message.platformTranslationPending),
      collectCaptions: false,
      segments: message.segments || [],
      displayGroups: transcriptGroups.buildDisplayGroups(message.segments || []),
      syncOffset: transcriptGroups.normalizeSyncOffset(message.syncOffset),
      buffer: "",
      replay: false,
      displayedText: null,
      uiDiagnostics: {},
      displayedTimingKey: null,
      selectedWord: null,
      selectedWordResult: null,
      selectedWordClip: null,
      selectedWordContext: null,
      wordCardRevision: 0,
      wordCardTranslations: new Map(),
      remainingTimeTranscription: null,
      processingLag: null,
      stabilizationDelay: null,
      processingWarning: false,
      lastCommitted: null,
      audioLanguage: String(message.audioLanguage || "de").toLowerCase(),
      captionPreferences: learning.normalizeCaptionPreferences(message.captionPreferences),
      translationPreferences: learning.normalizeTranslationPreferences(
        message.translationPreferences
      ),
      translationCache: new Map(),
      translationPending: new Map(),
      displayedTranslation: "",
      controlAvoidance: 0
    };

    if (globalThis.DubWordInteractions) {
      hoverPause = globalThis.DubWordInteractions.createHoverPause({ media: video });
      hoverPause.configure(session.captionPreferences.pauseOnWordHover);
    }
    createOverlay();
    void loadSavedVocabulary();
    const manualPlaybackIntent = event => {
      if (event.type === 'keydown' && event.composedPath().some(element => element.classList?.contains('word') || element.classList?.contains('word-card'))) return;
      if (event.type === 'keydown' && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
      if ((event.type === 'keydown' && [' ', 'k', 'K', 'MediaPlayPause'].includes(event.key))
        || (event.type === 'pointerdown' && (event.target === video || event.target.closest?.('.ytp-play-button')))) hoverPause?.interrupt();
    };
    for (const name of ['keydown', 'pointerdown']) {
      document.addEventListener(name, manualPlaybackIntent, true);
      listeners.push({ target: document, name, handler: manualPlaybackIntent, options: true });
    }
    addVideoListener("play", () => sendMediaEvent("play"));
    addVideoListener("pause", () => sendMediaEvent("pause"));
    addVideoListener("seeking", () => sendMediaEvent("seeking"));
    addVideoListener("seeked", scheduleSeekedEvent);
    addVideoListener("ratechange", () => sendMediaEvent("ratechange"));
    addVideoListener("play", startCurrentWordHighlight);
    addVideoListener("pause", updateCurrentWordHighlight);
    addVideoListener("seeking", updateCurrentWordHighlight);
    addVideoListener("seeked", updateCurrentWordHighlight);
    document.addEventListener("fullscreenchange", placeOverlay);

    clockTimer = setInterval(() => {
      if (!video || !session) return;
      if (!wordReplay && !session.youtubeCaptions) {
        void chrome.runtime.sendMessage({
          type: "MEDIA_CLOCK",
          currentTime: video.currentTime,
          playbackRate: video.playbackRate
        });
      }
      renderTranscript();
      updatePlayerAwarePosition();
    }, 250);
    updateCurrentWordHighlight();
    if (!video.paused) startCurrentWordHighlight();

    setCaptionCollection(Boolean(message.collectCaptions));
    if (session.youtubeCaptions) { session.replay = true; renderTranscript(); }
    else renderStatus("Preparing the local recognizer…");
  }

  function setCaptionCollection(enabled) {
    if (!session) return;
    if (!enabled) finalizeCaption();
    clearInterval(captionTimer);
    captionTimer = null;
    session.collectCaptions = enabled;
    if (enabled) captionTimer = setInterval(sampleCaption, 120);
  }

  function endSession({ resumeHover = false } = {}) {
    hoverPause?.dispose(resumeHover); hoverPause = null;
    for (const element of transientNotices.keys()) stopTransientNotice(element);
    transientNotices.clear();
    finalizeCaption();
    clearInterval(clockTimer);
    if (wordHighlightFrame) cancelAnimationFrame(wordHighlightFrame);
    wordHighlightFrame = null;
    clearInterval(captionTimer);
    clearTimeout(seekTimer);
    clockTimer = null;
    captionTimer = null;
    seekTimer = null;
    for (const { target, name, handler, options } of listeners) {
      target.removeEventListener(name, handler, options);
    }
    listeners = [];
    restoreWordReplay(false, true);
    pronunciationController?.cancel();
    document.removeEventListener("fullscreenchange", placeOverlay);
    overlayHost?.remove();
    restorePlayerPosition();
    overlayHost = null;
    playerContainer = null;
    transcriptElement = null;
    wordTimingProvenanceElement = null;
    statusElement = null;
    wordCardElement = null;
    wordTitleElement = null;
    wordMetaElement = null;
    wordTranslatedDefinitionElement = null;
    wordGermanDefinitionElement = null;
    wordExamplesElement = null;
    wordCollocationsElement = null;
    wordGrammarElement = null;
    wordRelatedElement = null;
    wordSaveElement = null;
    wordReplayElement = null;
    wordSpeakElement = null;
    wordVoiceStatusElement = null;
    wordReturnSourceElement = null;
    wordYouglishElement = null;
    wordGermanSourceElement = null;
    wordEnglishSourceElement = null;
    wordSavedContextElement = null;
    wordAlternativesElement = null;
    wordDefinitionNoteElement = null;
    wordTranslationStatusElement = null;
    removeCaptionDragListeners();
    captionDrag = null;
    suppressTranscriptClick = false;
    wrapElement = null;
    captionBoxElement = null;
    captionDragHandleElement = null;
    translationElement = null;
    session = null;
  }

  function addVideoListener(name, handler) {
    video.addEventListener(name, handler);
    listeners.push({ target: video, name, handler });
  }

  function sendMediaEvent(name) {
    if (!video || !session || wordReplay || session.youtubeCaptions) return;
    void chrome.runtime.sendMessage({
      type: "MEDIA_EVENT",
      event: {
        name,
        currentTime: video.currentTime,
        playbackRate: video.playbackRate
      }
    });
  }

  function scheduleSeekedEvent() {
    if (wordReplay) return;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => sendMediaEvent("seeked"), 300);
  }

  function sampleCaption() {
    if (!video || !session) return;
    const next = readVisibleCaption();
    if (next.text === currentCaption?.text) return;
    finalizeCaption();
    if (next.text) {
      currentCaption = {
        text: next.text,
        source: next.source,
        start: video.currentTime
      };
    }
  }

  function finalizeCaption() {
    if (!currentCaption || !video) return;
    const completed = {
      ...currentCaption,
      end: Math.max(currentCaption.start, video.currentTime)
    };
    currentCaption = null;
    void chrome.runtime.sendMessage({ type: "CAPTION_SEGMENT", segment: completed });
  }

  function readVisibleCaption() {
    const youtube = [...document.querySelectorAll(".ytp-caption-segment")]
      .map((element) => element.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (youtube) return { text: youtube, source: "youtube-visible-caption" };

    for (const track of video.textTracks || []) {
      const text = [...(track.activeCues || [])]
        .map((cue) => cue.text?.replace(/<[^>]+>/g, " ").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return { text, source: "html5-active-cue" };
    }
    return { text: "", source: null };
  }

  function openSavedWordReview(entry, preferences, callbacks = {}) {
    if (session) closeWordCard();
    reviewCallbacks = callbacks;
    session = {
      selectedWord: null, selectedWordResult: null, selectedWordClip: null,
      wordCardRevision: 0, wordCardTranslations: new Map(), displayedText: "",
      translationPreferences: learning.normalizeTranslationPreferences(preferences)
    };
    savedVocabulary = learning.savedVocabularyIndex([entry]);
    createOverlay();
    // Use the same lookup, legacy fallback, localization and grammar renderer as
    // a caption click, without inventing a playback interval or media session.
    const selection = document.createElement("span");
    return showWordDefinition(entry.word, selection);
  }

  function createOverlay() {
    document.getElementById("dub-transcript-lab-overlay")?.remove();
    overlayHost = document.createElement("div");
    overlayHost.id = "dub-transcript-lab-overlay";
    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        ${globalThis.DubTypography?.css || ""}
        :host {
          all: initial;
          position: absolute !important;
          inset: 0 !important;
          z-index: 2147483646 !important;
          display: block !important;
          overflow: visible !important;
          pointer-events: none !important;
        }
        :host([data-viewport-fixed="true"]) {
          position: fixed !important;
        }
        :host([data-suspended="true"]) { display: none !important; }
        .wrap {
          position: absolute;
          left: var(--caption-left, 50%);
          bottom: var(--caption-bottom, 11%);
          transform: translateX(-50%);
          width: min(880px, 88%);
          pointer-events: none;
          font-family: var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          text-align: center;
          transition: bottom .18s ease;
        }
        .wrap.controls-visible .status {
          border-color: rgba(167, 139, 250, .42);
        }
        .caption-box {
          position: relative;
          box-sizing: border-box;
          display: inline-block;
          max-width: 100%;
          padding: 8px 13px;
          border-radius: 8px;
          background: var(--caption-background, rgba(5, 7, 12, .86));
          border: 1px solid rgba(255,255,255,.14);
          backdrop-filter: blur(14px) saturate(1.22);
          -webkit-backdrop-filter: blur(14px) saturate(1.22);
          line-height: 1.25;
          box-shadow: 0 4px 20px rgba(0,0,0,.35);
          pointer-events: auto;
          user-select: text;
          -webkit-user-select: text;
          cursor: text;
        }
        .caption-box.dragging { user-select: none; -webkit-user-select: none; }
        .caption-box[hidden] { display: none; }
        .caption-drag-handle {
          position: absolute;
          top: 50%;
          left: -27px;
          width: 22px;
          height: 32px;
          transform: translateY(-50%);
          border: 1px solid rgba(255,255,255,.22);
          border-radius: 7px;
          padding: 0;
          background: rgba(5, 7, 12, .78);
          color: rgba(255,255,255,.82);
          font: 700 var(--ui-size-section, 18px)/1 var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          text-shadow: none;
          cursor: grab;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          opacity: .74;
        }
        .caption-box:hover .caption-drag-handle,
        .caption-drag-handle:focus-visible { opacity: 1; }
        .caption-drag-handle:focus-visible {
          outline: 2px solid #8dc49b;
          outline-offset: 2px;
        }
        .caption-box.dragging .caption-drag-handle { cursor: grabbing; opacity: 1; }
        .transcript,
        .translation,
        .word {
          user-select: text;
          -webkit-user-select: text;
        }
        .transcript::selection,
        .translation::selection,
        .word::selection {
          background: rgba(74, 124, 89, .9);
          color: white;
        }
        .transcript {
          max-height: 2.5em;
          overflow: hidden;
          color: var(--transcript-color, white);
          font-family: var(--transcript-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
          font-size: var(--transcript-font-size, 31px);
          font-weight: var(--transcript-font-weight, 700);
          text-shadow: var(--caption-text-shadow, 0 1px 2px black);
        }
        .transcript.long {
          max-height: 3.75em;
          font-size: calc(var(--transcript-font-size, 31px) * .84);
        }
        .translation {
          margin-top: 4px;
          color: var(--translation-color, #ffd166);
          font-family: var(--translation-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
          font-size: var(--translation-font-size, 21px);
          font-weight: var(--translation-font-weight, 400);
          line-height: 1.3;
          text-shadow: var(--caption-text-shadow, 0 1px 2px black);
        }
        .translation[hidden] { display: none; }
        .translation.pending { opacity: .62; font-style: italic; }
        .translation.error { color: #ffc0c0; font-size: .48em; }
        .translation.long {
          max-height: 2.6em;
          overflow: hidden;
        }
        .word {
          display: inline;
          border-radius: 3px;
          margin: 0;
          padding: 0 1px;
          background: transparent;
          color: inherit;
          font: inherit;
          font-weight: inherit;
          line-height: inherit;
          text-shadow: inherit;
          cursor: pointer;
        }
        .word.saved-word {
          text-decoration: underline;
          text-decoration-color: #e2c583;
          text-decoration-thickness: 2px;
          text-underline-offset: 5px;
          background: rgba(74, 124, 89, .22);
        }
        .word.current-word {
          background: rgba(153, 211, 159, .42);
          border-radius: .2em;
          box-shadow: 0 0 0 1px rgba(205, 242, 209, .58);
        }
        .word:hover,
        .word:focus-visible,
        .word.selected {
          outline: none;
          background: rgba(74, 124, 89, .55);
          box-shadow: 0 0 0 2px rgba(255,255,255,.28);
        }
        .status {
          display: block;
          width: max-content;
          max-width: 80%;
          margin: 0 auto 6px;
          padding: 4px 7px;
          border-radius: 999px;
          background: rgba(15, 21, 17, .9);
          color: #c2bfb5;
          font-size: var(--ui-size-meta, 12px);
          font-weight: 500;
        }
        .status:empty { display: none; }
        .status.error { color: #ff9b9b; }
        .status, .word-timing-provenance { transition: opacity .7s ease; }
        .notice-fading { opacity: 0; }
        .status[hidden], .word-timing-provenance[hidden] { display: none; }
        .word-card {
          position: absolute;
          left: calc(50% + var(--word-card-offset, 0px));
          bottom: calc(100% + 12px);
          transform: translateX(-50%);
          box-sizing: border-box;
          width: min(520px, 92%);
          max-height: min(46vh, 390px);
          margin: 0;
          padding: 11px 13px;
          border: 1px solid rgba(255,255,255,.18);
          border-radius: 10px;
          background: linear-gradient(145deg, rgba(20, 28, 22, .97), rgba(12, 17, 14, .96));
          backdrop-filter: blur(22px) saturate(1.2);
          -webkit-backdrop-filter: blur(22px) saturate(1.2);
          color: #f5f5f0;
          box-shadow: 0 8px 32px rgba(0,0,0,.48);
          font: 400 var(--ui-size-body, 14px)/1.5 var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          text-align: left;
          pointer-events: auto;
          user-select: text;
          -webkit-user-select: text;
          overflow-y: auto;
          color-scheme: dark;
          scrollbar-width: thin;
          scrollbar-color: #46644e #111a14;
        }
        .word-card::-webkit-scrollbar { width: 7px; }
        .word-card::-webkit-scrollbar-track { background: #111a14; border-radius: 10px; }
        .word-card::-webkit-scrollbar-thumb { background: #46644e; border: 2px solid #111a14; border-radius: 10px; }
        .word-card::-webkit-scrollbar-thumb:hover { background: #63866c; }
        .word-card::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
        .word-card::-webkit-scrollbar-corner { background: #111a14; }
        .word-card[hidden] { display: none; }
        :host([data-saved-review]) {
          position: static !important; inset: auto !important;
          z-index: auto !important; pointer-events: auto !important;
        }
        :host([data-saved-review]) .wrap { position: static; width: 100%; transform: none; text-align: left; }
        :host([data-saved-review]) .status,
        :host([data-saved-review]) .caption-box { display: none; }
        :host([data-saved-review]) .word-card {
          position: static; width: 100%; max-height: none; transform: none;
          overflow: visible; box-shadow: none;
        }
        .word-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .word-heading { min-width: 0; }
        .word-title { font: 750 var(--ui-size-page, 22px)/1.35 var(--ui-font, Tahoma, Arial, system-ui, sans-serif); color: #e2c583; overflow-wrap: anywhere; }
        .word-alternatives { margin-top: 7px; color: #d7c9a5; font-size: var(--ui-size-body, 14px); line-height: 1.5; }
        .word-alternatives > div + div { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(141,196,155,.15); }
        .word-more-meanings { margin-top: 9px; padding-top: 4px; border-top: 1px solid rgba(141,196,155,.15); }
        .word-more-examples { margin-top: 5px; }
        .word-card details > summary {
          width: fit-content;
          max-width: 100%;
          padding: 4px 0;
          color: #b5bcb1;
          font: 600 var(--ui-size-meta, 12px)/1.5 var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          text-align: start;
          cursor: pointer;
          border-radius: 3px;
        }
        .word-card details > summary::marker { color: #8dc49b; font-size: var(--ui-size-meta, 12px); }
        .word-card details > summary:hover { color: #e6e7df; }
        .word-card details > summary:focus-visible,
        .word-table-scroll:focus-visible { outline: 2px solid #8dc49b; outline-offset: 3px; }
        .word-title, .word-alternatives, .word-definition-target, .word-example-target { text-align: start; }
        .word-highlight { padding: 0 2px; border-radius: 3px; background: rgba(74,124,89,.35); color: #f0d596; font-weight: 750; text-decoration: underline; text-decoration-color: #8dc49b; text-underline-offset: 3px; }
        .word-definition-note, .word-translation-status { margin-top: 7px; color: #a4aaa3; font: var(--ui-size-meta, 12px)/1.5 var(--ui-font, Tahoma, Arial, system-ui, sans-serif); }
        .word-meta { margin-top: 2px; color: #a4aaa3; font-size: var(--ui-size-meta, 12px); }
        .word-card-header { flex-wrap: wrap; }
        .word-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .word-action {
          border: 1px solid #63926f;
          border-radius: 6px;
          padding: 5px 8px;
          background: #4a7c59;
          color: white;
          font-size: var(--ui-size-meta, 12px);
          font-family: var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          font-weight: 600;
          line-height: 1.4;
          text-decoration: none;
          cursor: pointer;
        }
        .word-action.secondary { border-color: #3c5142; background: #1c281f; }
        .word-speak { display: inline-flex; align-items: center; gap: .3rem; }
        .word-status { position: relative; display: inline-flex; align-items: center; gap: 3px; }
        .word-status[hidden] { display: none; }
        .word-status-trigger {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px; padding: 3px; border: 1px solid #3c5142;
          border-radius: 50%; background: #1c281f; color: #b5bcb1;
          font: 700 var(--ui-size-meta, 12px)/1 var(--ui-font, Tahoma, Arial, system-ui, sans-serif); cursor: help;
        }
        .word-status-trigger[data-state="ready"] { color: #8dc49b; }
        .word-status-trigger[data-state="warning"] { color: #e2c583; }
        .word-status-retry { cursor: pointer; }
        .word-status-trigger:hover { border-color: #63866c; }
        .word-status-trigger svg { width: 15px; height: 15px; }
        .word-status-trigger:focus-visible { outline: 2px solid #8dc49b; outline-offset: 2px; }
        .word-status-tooltip {
          position: absolute; z-index: 2; top: calc(100% + 7px); right: 0;
          width: max-content; max-width: min(280px, 75vw); padding: 8px 10px;
          border: 1px solid #46644e; border-radius: 7px; background: #111a14;
          box-shadow: 0 4px 14px rgba(0,0,0,.3); color: #e6e7df;
          font: 400 var(--ui-size-meta, 12px)/1.5 var(--ui-font, Tahoma, Arial, system-ui, sans-serif); text-align: start;
          white-space: normal; overflow-wrap: anywhere; visibility: hidden; opacity: 0;
        }
        .word-status:hover .word-status-tooltip,
        .word-status:focus-within .word-status-tooltip { visibility: visible; opacity: 1; }
        .word-status[data-tooltip-dismissed="true"] .word-status-tooltip { visibility: hidden; opacity: 0; }
        .word-dictionary-status .word-status-tooltip { top: auto; bottom: calc(100% + 7px); left: 0; right: auto; }
        .word-speak svg { width: 17px; height: 17px; flex: 0 0 17px; }
        .word-timing-provenance { margin-top: .2rem; color: rgba(232, 244, 234, .7); font-size: var(--ui-size-meta, 12px); line-height: 1.2; text-align: center; }
        .word-action:disabled { cursor: default; opacity: .48; }
        .word-save.saved { border-color: #376b57; background: #244b3d; }
        .word-action:focus-visible, .word-close:focus-visible { outline: 2px solid #8dc49b; outline-offset: 2px; }
        .word-close {
          border: 0;
          padding: 2px 6px;
          background: transparent;
          color: #c2bfb5;
          font-family: var(--ui-font, Tahoma, Arial, system-ui, sans-serif);
          font-size: var(--ui-size-section, 18px);
          cursor: pointer;
        }
        .word-section { margin-top: 11px; }
        .word-section[hidden] { display: none; }
        .word-label {
          color: #c2b48f;
          font-size: var(--ui-size-body, 14px);
          font-weight: 750;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .word-definition,
        .word-example-de,
        .word-example-target,
        .word-list,
        .word-grammar {
          margin: 3px 0 0;
          color: #e6e7df;
          font-size: var(--ui-size-body, 14px);
          line-height: 1.45;
          text-shadow: none;
        }
        .word-definition { white-space: pre-line; }
        .word-definition-target { color: #b5bcb1; font-size: var(--ui-size-body, 14px); }
        .word-example-card {
          margin-top: 6px;
          padding: 7px 9px;
          border-left: 3px solid #4a7c59;
          border-radius: 5px;
          background: rgba(255,255,255,.04);
        }
        .word-example-de { margin: 0; color: #f5f5f0; font-style: italic; }
        .word-example-target { margin-top: 3px; color: #b5bcb1; font-size: var(--ui-size-body, 14px); }
        .word-list { margin: 4px 0 0; padding-left: 18px; }
        .word-list li + li { margin-top: 3px; }
        .word-grammar { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: 5px 9px; }
        .word-grammar > dt { color: #c2b48f; font-size: var(--ui-size-meta, 12px); font-weight: 700; overflow-wrap: anywhere; }
        .word-grammar > dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
        .word-grammar > .word-verb-block-label,
        .word-grammar > .word-verb-block { grid-column: 1 / -1; }
        .word-grammar > .word-verb-block-label { margin-top: 5px; }
        .word-table-scroll { max-width: 100%; overflow-x: auto; border: 1px solid rgba(141,196,155,.2); border-radius: 7px; }
        .word-verb-table { width: 100%; border-collapse: collapse; color: #e6e7df; font: 400 var(--ui-size-body, 14px)/1.45 var(--ui-font, Tahoma, Arial, system-ui, sans-serif); text-align: left; }
        .word-verb-table th,
        .word-verb-table td { padding: 7px 10px; border-bottom: 1px solid rgba(141,196,155,.13); vertical-align: top; overflow-wrap: anywhere; }
        .word-verb-table th + th,
        .word-verb-table th + td,
        .word-verb-table td + td { border-left: 1px solid rgba(141,196,155,.1); }
        .word-verb-table th { color: #d7c9a5; font-size: var(--ui-size-meta, 12px); font-weight: 650; }
        .word-verb-table thead { background: rgba(74,124,89,.17); }
        .word-verb-table th[scope="rowgroup"] { width: 33%; background: rgba(74,124,89,.07); }
        .word-verb-overview th { width: 28%; }
        .word-verb-table tbody:last-child tr:last-child > * { border-bottom: 0; }
        .word-verb-table tbody tr:hover { background: rgba(141,196,155,.05); }
        .word-sources { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
        .word-source { color: #8dc49b; font-size: var(--ui-size-meta, 12px); }
        @media (prefers-reduced-motion: reduce) {
          .wrap { transition: none; }
          .status, .word-timing-provenance { transition: none; }
        }
      </style>
      <div class="wrap">
        <div class="status" hidden></div>
        <div class="caption-box" role="group" aria-label="Interactive captions" hidden>
          <button class="caption-drag-handle" type="button" aria-label="Drag captions" title="Drag captions">&#8942;</button>
          <div class="transcript" aria-live="polite" aria-atomic="true"></div>
          <div class="word-timing-provenance" aria-live="polite"></div>
          <div class="translation" aria-live="polite" aria-atomic="true" hidden></div>
        </div>
        <div class="word-card" role="region" aria-label="Word details" hidden>
          <div class="word-card-header">
            <div class="word-heading">
              <div class="word-title"></div>
              <div class="word-meta"></div>
            </div>
            <div class="word-card-actions">
              <button class="word-action secondary word-replay" type="button">Replay clip</button>
              <button class="word-action secondary word-speak" type="button" aria-label="Pronounce German word" title="Pronounce German word"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4zm12 0a4 4 0 0 1 0 4m2-6a7 7 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="word-speak-label">Speak</span></button>
              <div class="word-status word-voice-status" hidden></div>
              <button class="word-action secondary word-return-source" type="button" hidden>Return to source</button>
              <a class="word-action secondary word-youglish" target="_blank" rel="noopener noreferrer">YouGlish</a>
              <button class="word-action word-save" type="button">Save word</button>
              <button class="word-close" type="button" aria-label="Close definition">×</button>
            </div>
          </div>
          <div class="word-section word-meaning-section">
            <div class="word-label">Meaning</div>
            <div class="word-definition-note" hidden></div>
            <div class="word-definition word-definition-de" lang="de"></div>
            <div class="word-definition word-definition-target" dir="auto"></div>
            <details class="word-more-meanings" hidden><summary>Other meanings</summary><div class="word-alternatives" dir="auto"></div></details>
          </div>
          <div class="word-saved-context word-example-card" hidden></div>
          <div class="word-section word-examples-section">
            <div class="word-label">Examples</div>
            <div class="word-examples"></div>
          </div>
          <div class="word-section word-grammar-section" hidden>
            <div class="word-label">Grammar</div>
            <dl class="word-grammar"></dl>
          </div>
          <div class="word-translation-status" role="status" hidden></div>
          <div class="word-sources">
            <a class="word-source word-source-de" target="_blank" rel="noopener noreferrer">German Wiktionary</a>
            <div class="word-status word-dictionary-status"></div>
          </div>
        </div>
      </div>`;

    wrapElement = shadow.querySelector(".wrap");
    captionBoxElement = shadow.querySelector(".caption-box");
    captionDragHandleElement = shadow.querySelector(".caption-drag-handle");
    transcriptElement = shadow.querySelector(".transcript");
    wordTimingProvenanceElement = shadow.querySelector(".word-timing-provenance");
    translationElement = shadow.querySelector(".translation");
    statusElement = shadow.querySelector(".status");
    wordCardElement = shadow.querySelector(".word-card");
    wordTitleElement = shadow.querySelector(".word-title");
    wordMetaElement = shadow.querySelector(".word-meta");
    wordTranslatedDefinitionElement = shadow.querySelector(".word-definition-target");
    wordGermanDefinitionElement = shadow.querySelector(".word-definition-de");
    wordExamplesElement = shadow.querySelector(".word-examples");
    wordCollocationsElement = shadow.querySelector(".word-collocations");
    wordGrammarElement = shadow.querySelector(".word-grammar");
    wordRelatedElement = shadow.querySelector(".word-related");
    wordSaveElement = shadow.querySelector(".word-save");
    wordReplayElement = shadow.querySelector(".word-replay");
    wordSpeakElement = shadow.querySelector(".word-speak");
    wordVoiceStatusElement = shadow.querySelector(".word-voice-status");
    wordReturnSourceElement = shadow.querySelector(".word-return-source");
    wordYouglishElement = shadow.querySelector(".word-youglish");
    wordGermanSourceElement = shadow.querySelector(".word-source-de");
    wordSavedContextElement = shadow.querySelector(".word-saved-context");
    wordAlternativesElement = shadow.querySelector(".word-alternatives");
    wordDefinitionNoteElement = shadow.querySelector(".word-definition-note");
    wordTranslationStatusElement = shadow.querySelector(".word-translation-status");
    renderStatusIndicator(shadow.querySelector('.word-dictionary-status'), WORD_CARD_HELP_TEXT, 'info', 'Dictionary card information', 'dictionary-card-help');
    reportUiDiagnostic('dictionary', WORD_CARD_HELP_TEXT);
    shadow.querySelector(".word-close").addEventListener("click", closeWordCard);
    wordSaveElement.addEventListener("click", toggleSavedWord);
    wordReplayElement.addEventListener("click", replaySelectedWord);
    wordSpeakElement.addEventListener("click", pronounceSelectedWord);
    wordReturnSourceElement.addEventListener("click", returnToSavedSource);
    captionDragHandleElement.addEventListener("pointerdown", startCaptionDrag);
    transcriptElement.addEventListener("click", handleTranscriptClick);
    transcriptElement.addEventListener("keydown", handleTranscriptKeydown);
    transcriptElement.addEventListener('pointerover', event => { if (event.target.closest('.word')) hoverPause?.enter(); });
    transcriptElement.addEventListener('pointerout', event => {
      if (event.target.closest('.word') && !event.relatedTarget?.closest?.('.word')) hoverPause?.leave();
    });
    captionBoxElement.addEventListener("pointerdown", stopPlayerClick);
    captionBoxElement.addEventListener("copy", stopPlayerClick);
    captionBoxElement.addEventListener("dblclick", stopPlayerClick);
    captionBoxElement.addEventListener("click", stopPlayerClick);
    wordCardElement.addEventListener("pointerdown", stopPlayerClick);
    wordCardElement.addEventListener("click", (event) => event.stopPropagation());
    if (reviewContainer) {
      overlayHost.dataset.savedReview = "true";
      wordReplayElement.hidden = true;
      wordCardElement.setAttribute("aria-live", "polite");
      wordCardElement.addEventListener("toggle", () => reviewCallbacks?.onChange?.(), true);
      reviewContainer.replaceChildren(overlayHost);
    } else {
      applyDisplaySettings(session.captionPreferences, session.translationPreferences);
      placeOverlay();
    }
  }

  function applyDisplaySettings(
    rawCaptionPreferences,
    rawTranslationPreferences,
    resetTranslationCache = false
  ) {
    if (!session) return;
    const previousTranslation = JSON.stringify(session.translationPreferences || {});
    const previousTarget = session.translationPreferences?.targetLanguage;
    const previousProvider = session.translationPreferences?.provider;
    session.captionPreferences = learning.normalizeCaptionPreferences(rawCaptionPreferences);
    hoverPause?.configure(session.captionPreferences.pauseOnWordHover);
    updateCurrentWordHighlight();
    if (video && !video.paused) startCurrentWordHighlight();
    session.translationPreferences = learning.normalizeTranslationPreferences(
      rawTranslationPreferences
    );
    if (previousTranslation !== JSON.stringify(session.translationPreferences)) {
      session.displayedTranslation = "";
    }
    if (resetTranslationCache) session.translationCache.clear();
    if (!wrapElement || !captionBoxElement) return;

    const caption = session.captionPreferences;
    const translation = session.translationPreferences;
    wrapElement.style.setProperty("--caption-left", `${caption.horizontalPosition}%`);
    updatePlayerAwarePosition(true);
    wrapElement.style.setProperty("--transcript-font-size", `${caption.fontSize}px`);
    wrapElement.style.setProperty("--transcript-font-family", learning.fontFamilyValue(caption.fontFamily));
    wrapElement.style.setProperty("--transcript-font-weight", caption.bold ? "700" : "400");
    wrapElement.style.setProperty("--translation-font-size", `${translation.fontSize}px`);
    wrapElement.style.setProperty(
      "--translation-font-family",
      learning.fontFamilyValue(translation.fontFamily)
    );
    wrapElement.style.setProperty("--translation-font-weight", translation.bold ? "700" : "400");
    wrapElement.style.setProperty(
      "--caption-background",
      learning.rgbaFromHex(caption.backgroundColor, caption.backgroundOpacity)
    );
    wrapElement.style.setProperty(
      "--transcript-color",
      learning.rgbaFromHex(caption.textColor, caption.textOpacity)
    );
    wrapElement.style.setProperty(
      "--translation-color",
      learning.rgbaFromHex(translation.textColor, translation.textOpacity)
    );
    const shadows = {
      none: "none",
      shadow: "0 1px 2px black",
      outline: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
    };
    wrapElement.style.setProperty("--caption-text-shadow", shadows[caption.edgeStyle]);
    if (!session.translationPreferences.enabled) {
      session.displayedTranslation = "";
      translationElement.textContent = "";
      translationElement.hidden = true;
    } else if (session.displayedText) {
      void renderTranslation(session.displayedText);
    }
    if (session.selectedWordResult && wordCardElement && !wordCardElement.hidden
      && (previousTarget !== translation.targetLanguage || previousProvider !== translation.provider || resetTranslationCache)) {
      if (resetTranslationCache) session.wordCardTranslations.clear();
      void localizeSelectedWord(session.selectedWordResult);
    }
  }

  function placeOverlay() {
    if (!overlayHost || !video) return;
    const placement = localMedia.overlayPlacement(video, document);
    const nextContainer = placement.container;
    if (!nextContainer) return;
    if (playerContainer !== nextContainer) {
      restorePlayerPosition();
      playerContainer = nextContainer;
      if (!placement.viewportFixed && getComputedStyle(playerContainer).position === "static") {
        playerInlinePosition = playerContainer.style.position;
        playerContainer.style.position = "relative";
      }
    }
    overlayHost.dataset.viewportFixed = String(placement.viewportFixed);
    if (overlayHost.parentNode !== playerContainer) playerContainer.append(overlayHost);
    updatePlayerAwarePosition(true);
    positionWordCard();
  }

  function startCaptionDrag(event) {
    if (!session || !playerContainer || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const playerRect = playerContainer.getBoundingClientRect();
    const captionRect = captionBoxElement.getBoundingClientRect();
    const wrapRect = wrapElement.getBoundingClientRect();
    if (!playerRect.width || !playerRect.height) return;
    const horizontalMargin = Math.min(
      48,
      Math.max(2, (captionRect.width / 2 + 30) / playerRect.width * 100 + 1)
    );
    const wrapHeight = Math.max(0, wrapRect.height / playerRect.height * 100);
    captionDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startHorizontal: session.captionPreferences.horizontalPosition,
      startVertical: session.captionPreferences.verticalPosition,
      playerWidth: playerRect.width,
      playerHeight: playerRect.height,
      minimumHorizontal: horizontalMargin,
      maximumHorizontal: 100 - horizontalMargin,
      maximumVertical: Math.max(3, 98 - wrapHeight),
      moved: false
    };
    window.addEventListener("pointermove", moveCaptionDrag, true);
    window.addEventListener("pointerup", finishCaptionDrag, true);
    window.addEventListener("pointercancel", finishCaptionDrag, true);
    captionBoxElement.classList.add("dragging");
    event.preventDefault();
    event.stopPropagation();
  }

  function moveCaptionDrag(event) {
    if (!captionDrag || event.pointerId !== captionDrag.pointerId || !session) return;
    const deltaX = event.clientX - captionDrag.startX;
    const deltaY = event.clientY - captionDrag.startY;
    if (!captionDrag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    captionDrag.moved = true;
    event.preventDefault();
    event.stopPropagation();

    const horizontalPosition = clamp(
      captionDrag.startHorizontal + deltaX / captionDrag.playerWidth * 100,
      captionDrag.minimumHorizontal,
      captionDrag.maximumHorizontal
    );
    const verticalPosition = clamp(
      captionDrag.startVertical - deltaY / captionDrag.playerHeight * 100,
      3,
      captionDrag.maximumVertical
    );
    session.captionPreferences = learning.normalizeCaptionPreferences({
      ...session.captionPreferences,
      horizontalPosition,
      verticalPosition
    });
    wrapElement.style.setProperty(
      "--caption-left",
      `${session.captionPreferences.horizontalPosition}%`
    );
    updatePlayerAwarePosition(true);
    positionWordCard();
  }

  function finishCaptionDrag(event) {
    if (!captionDrag || event.pointerId !== captionDrag.pointerId) return;
    const moved = captionDrag.moved;
    removeCaptionDragListeners();
    captionBoxElement.classList.remove("dragging");
    captionDrag = null;
    event.stopPropagation();
    if (!moved || !session) return;

    suppressTranscriptClick = true;
    setTimeout(() => { suppressTranscriptClick = false; }, 0);
    void chrome.runtime.sendMessage({
      type: "UPDATE_DISPLAY_SETTINGS",
      captionPreferences: session.captionPreferences,
      translationPreferences: session.translationPreferences
    });
  }

  function removeCaptionDragListeners() {
    window.removeEventListener("pointermove", moveCaptionDrag, true);
    window.removeEventListener("pointerup", finishCaptionDrag, true);
    window.removeEventListener("pointercancel", finishCaptionDrag, true);
  }

  function positionWordCard() {
    if (!wordCardElement || wordCardElement.hidden || !playerContainer || !captionBoxElement) return;
    const playerRect = playerContainer.getBoundingClientRect();
    const captionRect = captionBoxElement.getBoundingClientRect();
    const cardRect = wordCardElement.getBoundingClientRect();
    if (!playerRect.width || !cardRect.width) return;
    const desiredCenter = captionRect.left + captionRect.width / 2;
    const minimumCenter = playerRect.left + cardRect.width / 2 + 8;
    const maximumCenter = playerRect.right - cardRect.width / 2 - 8;
    const clampedCenter = clamp(desiredCenter, minimumCenter, maximumCenter);
    wordCardElement.style.setProperty(
      "--word-card-offset",
      `${clampedCenter - desiredCenter}px`
    );
  }

  function updatePlayerAwarePosition(force = false) {
    if (!session || !wrapElement || !video) return;
    const nextAvoidance = measureVisiblePlayerControls();
    if (force || Math.abs(nextAvoidance - session.controlAvoidance) >= 0.5) {
      session.controlAvoidance = nextAvoidance;
    }
    const basePosition = session.captionPreferences.verticalPosition;
    const effectivePosition = learning.resolveCaptionBottom(
      basePosition,
      session.controlAvoidance
    );
    wrapElement.style.setProperty("--caption-bottom", `${effectivePosition}%`);
    wrapElement.classList.toggle(
      "controls-visible",
      effectivePosition > Number(basePosition) + 0.1
    );
  }

  function measureVisiblePlayerControls() {
    if (!playerContainer || !video) return 0;
    const playerRect = playerContainer.getBoundingClientRect();
    if (!playerRect.width || !playerRect.height) return 0;
    const selectors = [
      ".ytp-chrome-bottom",
      ".ytp-progress-bar-container",
      "[data-uia='controls-standard']",
      "[data-uia='player-controls']",
      ".watch-video--bottom-controls-container",
      ".PlayerControlsNeo__layout",
      "[class*='control-bar']",
      "[class*='controls-bottom']"
    ];
    let minimumBottom = video.paused ? 14 : 0;
    for (const element of playerContainer.querySelectorAll(selectors.join(","))) {
      const style = getComputedStyle(element);
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity || 1) < 0.08
      ) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      const intersectsBottom = rect.bottom > playerRect.top
        && rect.top < playerRect.bottom
        && rect.left < playerRect.right
        && rect.right > playerRect.left;
      if (
        !intersectsBottom
        || rect.height < 8
        || rect.height > playerRect.height * 0.35
        || rect.top < playerRect.top + playerRect.height * 0.5
      ) {
        continue;
      }
      const occupiedPercent = (playerRect.bottom - rect.top) / playerRect.height * 100;
      minimumBottom = Math.max(minimumBottom, occupiedPercent + 2.5);
    }
    return Math.max(0, Math.min(35, Math.round(minimumBottom * 10) / 10));
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function renderTranscript() {
    if (!video || !session || !transcriptElement) return;
    const time = video.currentTime - session.syncOffset;
    const displayGroups = session.displayGroups || [];
    const active = displayGroups
      .filter((group) => time >= group.start - (session.youtubeCaptions ? 0 : 0.15) && time <= group.end + (session.youtubeCaptions ? 0 : 0.8))
      .at(-1);
    const recent = [...displayGroups]
      .reverse()
      .find((group) => group.end <= time && time - group.end < 2.2);
    const freshCommit = !session.replay
      && session.lastCommitted
      && performance.now() - session.lastCommitted.receivedAt < 3_500
      ? session.lastCommitted.text
      : "";
    const text = active?.text || freshCommit || (!session.youtubeCaptions && recent?.text) || "";
    session.displayedCue = active || null;
    const timingGroup = active || (freshCommit ? null : recent);
    renderClickableText(text, timingGroup?.words || []);
    updateCurrentWordHighlight();
    void renderTranslation(text);
    if (session.replay) {
      if (!session.youtubeCaptions) renderStatus("Cached transcript replay — audio is not being transcribed again.");
    }
  }

  function isDisplayReady(segment) {
    return segment?.complete !== false;
  }

  function renderClickableText(text, wordTimings = []) {
    captionBoxElement.hidden = !text;
    const timingKey = `${text}|${wordTimings.map((timing) => `${timing?.text || ""}:${timing?.start ?? ""}:${timing?.end ?? ""}:${timing?.timing || ""}`).join("|")}`;
    if (session.displayedText === text && session.displayedTimingKey !== timingKey) {
      applyTimingMetadataInPlace(mapValidatedWordTimings(text, wordTimings));
      session.displayedTimingKey = timingKey;
      return;
    }
    if (session.displayedTimingKey === timingKey) return;
    hoverPause?.release();
    session.displayedText = text;
    session.displayedTimingKey = timingKey;
    transcriptElement.classList.toggle("long", text.length > 110);
    const tokens = text.match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*|\s+|[^\s]/gu) || [];
    const fragment = document.createDocumentFragment();
    const timingByWordIndex = mapValidatedWordTimings(text, wordTimings);
    let wordIndex = 0;
    for (const token of tokens) {
      if (/^[\p{L}\p{M}]/u.test(token)) {
        const wordElement = document.createElement("span");
        wordElement.className = "word";
        wordElement.dataset.word = token;
        wordElement.tabIndex = 0;
        wordElement.setAttribute("role", "button");
        applySavedWordMark(wordElement);
        const timing = timingByWordIndex[wordIndex++];
        if (timing && Number.isFinite(Number(timing.start)) && Number.isFinite(Number(timing.end))) {
          wordElement.dataset.start = String(timing.start);
          wordElement.dataset.end = String(timing.end);
          wordElement.dataset.timing = timing.timing || "estimated";
        }
        wordElement.textContent = token;
        fragment.append(wordElement);
      } else {
        fragment.append(document.createTextNode(token));
      }
    }
    transcriptElement.replaceChildren(fragment);
  }

  function applyTimingMetadataInPlace(timings) {
    const spans = [...transcriptElement.querySelectorAll(".word")];
    for (const [index, element] of spans.entries()) {
      const timing = timings[index];
      if (!timing) {
        delete element.dataset.start;
        delete element.dataset.end;
        delete element.dataset.timing;
      } else {
        element.dataset.start = String(timing.start);
        element.dataset.end = String(timing.end);
        element.dataset.timing = timing.timing || "estimated-within-cue";
      }
    }
  }

  function mapValidatedWordTimings(text, wordTimings) {
    const tokens = String(text || "").match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || [];
    const timings = Array.isArray(wordTimings) ? wordTimings : [];
    if (!tokens.length || tokens.length !== timings.length) return [];
    return timings.every((timing, index) => (
      learning.normalizedWord(timing?.text) === learning.normalizedWord(tokens[index])
      && Number.isFinite(Number(timing?.start)) && Number.isFinite(Number(timing?.end))
      && Number(timing.end) >= Number(timing.start)
    )) ? timings : [];
  }

  function startCurrentWordHighlight() {
    if (session?.captionPreferences.highlightCurrentWord === false) return;
    if (wordHighlightFrame) return;
    const update = () => {
      wordHighlightFrame = null;
      updateCurrentWordHighlight();
      if (video && session && session.captionPreferences.highlightCurrentWord !== false && !video.paused && !wordReplay) wordHighlightFrame = requestAnimationFrame(update);
    };
    wordHighlightFrame = requestAnimationFrame(update);
  }

  function updateCurrentWordHighlight() {
    if (!transcriptElement || !video || !session) return;
    const time = video.currentTime - session.syncOffset;
    let current = null;
    for (const element of transcriptElement.querySelectorAll(".word")) {
      const start = Number(element.dataset.start);
      const end = Number(element.dataset.end);
      const active = session.captionPreferences?.highlightCurrentWord !== false && !current && Number.isFinite(start) && Number.isFinite(end) && time >= start && time < end;
      element.classList.toggle("current-word", active);
      if (active) current = element;
    }
    const timingMode = current?.dataset.timing || transcriptElement.querySelector('.word')?.dataset.timing || "unavailable";
    transcriptElement.dataset.wordTiming = timingMode;
    const timingLabel = timingMode !== 'unavailable'
      ? (timingMode === "word-timestamps" ? "Word timing: recognizer word timestamps" : timingMode === 'platform-word-offsets' ? 'Word timing: YouTube segment offsets' : "Word timing: estimated within caption")
      : "Word timing unavailable";
    showTransientNotice(wordTimingProvenanceElement, timingLabel);
    reportUiDiagnostic('timing', timingLabel);
  }

  async function renderTranslation(text) {
    if (!session || !translationElement) return;
    const preferences = session.translationPreferences;
    if (!preferences.enabled || !text) {
      session.displayedTranslation = "";
      translationElement.textContent = "";
      translationElement.hidden = true;
      return;
    }

    translationElement.hidden = false;
    if (session.youtubeCaptions && session.platformTranslationLanguage === preferences.targetLanguage && session.displayedCue) {
      const translated = globalThis.DubYouTubeCaptions?.alignTranslation(session.platformTranslations, session.displayedCue.start, session.displayedCue.end);
      if (translated) { showTranslation(translated, 'ready'); return; }
    }
    if (session.youtubeCaptions && session.platformTranslationPending) {
      showTranslation('Preparing translation…', 'pending'); return;
    }
    const owner = session;
    const requestKey = translationSessionKey(text, preferences);
    const cached = session.translationCache.get(requestKey);
    if (cached?.translatedText) {
      showTranslation(cached.translatedText, "ready");
      return;
    }
    if (cached?.error) {
      showTranslation(cached.error, "error");
      return;
    }

    showTranslation("Translating…", "pending");
    let pending = session.translationPending.get(requestKey);
    if (!pending) {
      pending = chrome.runtime.sendMessage({
        type: "TRANSLATE_TEXT",
        text,
        sourceLanguage: session.audioLanguage,
        translationPreferences: preferences
      });
      session.translationPending.set(requestKey, pending);
    }

    try {
      const result = await pending;
      if (session !== owner) return;
      if (!result?.ok || !result.translatedText) {
        throw new Error(result?.error || "Translation is unavailable.");
      }
      session.translationCache.set(requestKey, { translatedText: result.translatedText });
      if (
        session.displayedText === text
        && translationSessionKey(text, session.translationPreferences) === requestKey
        && session.translationPreferences.enabled
      ) {
        showTranslation(result.translatedText, "ready");
      }
    } catch (error) {
      if (session !== owner) return;
      const message = error.message || "Translation is unavailable.";
      session.translationCache.set(requestKey, { error: message });
      if (
        session.displayedText === text
        && translationSessionKey(text, session.translationPreferences) === requestKey
        && session.translationPreferences.enabled
      ) {
        showTranslation(message, "error");
      }
    } finally {
      owner.translationPending.delete(requestKey);
    }
  }

  function translationSessionKey(text, preferences) {
    return `${preferences.provider}:${preferences.targetLanguage}:${text}`;
  }

  function showTranslation(text, state) {
    session.displayedTranslation = state === "ready" ? text : "";
    translationElement.textContent = text;
    translationElement.hidden = false;
    translationElement.classList.toggle("pending", state === "pending");
    translationElement.classList.toggle("error", state === "error");
    translationElement.classList.toggle("long", text.length > 150);
  }

  function handleTranscriptClick(event) {
    event.stopPropagation();
    const wordElement = event.target.closest(".word");
    const decision = learning.wordActivationDecision({
      suppressed: suppressTranscriptClick,
      hasSelection: hasActiveCaptionSelection(),
      word: wordElement?.dataset.word
    });
    if (decision === "suppress") {
      event.preventDefault();
      return;
    }
    if (decision !== "lookup") return;
    event.preventDefault();
    void showWordDefinition(wordElement.dataset.word, wordElement);
  }

  function handleTranscriptKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const wordElement = event.target.closest(".word");
    if (!wordElement || hasActiveCaptionSelection()) return;
    event.preventDefault();
    event.stopPropagation();
    void showWordDefinition(wordElement.dataset.word, wordElement);
  }

  function hasActiveCaptionSelection() {
    const root = transcriptElement?.getRootNode();
    let rootSelection = null;
    let windowSelection = null;
    try {
      if (typeof root?.getSelection === "function") rootSelection = root.getSelection();
    } catch {
      // Some ShadowRoot implementations expose getSelection but reject the call.
    }
    try {
      if (typeof window.getSelection === "function") windowSelection = window.getSelection();
    } catch {
      // A missing page selection should not disable ordinary word activation.
    }
    return learning.selectionHasText(rootSelection, windowSelection);
  }

  async function showWordDefinition(word, wordButton) {
    const owner = session;
    pronunciationController?.cancel();
    transcriptElement.querySelector(".word.selected")?.classList.remove("selected");
    wordButton.classList.add("selected");
    owner.selectedWord = word;
    owner.selectedWordResult = null;
    owner.ttsRequestId = null;
    owner.wordCardEpoch = (owner.wordCardEpoch || 0) + 1;
    const cardEpoch = owner.wordCardEpoch;
    const revision = ++owner.wordCardRevision;
    const targetLanguage = owner.translationPreferences.targetLanguage;
    owner.selectedWordContext = {
      text: owner.displayedText,
      translations: new Map(owner.displayedTranslation ? [[targetLanguage, owner.displayedTranslation]] : [])
    };
    const start = Number(wordButton.dataset.start);
    const end = Number(wordButton.dataset.end);
    owner.selectedWordClip = Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? { start, end, timing: wordButton.dataset.timing || "estimated" }
      : null;
    wordCardElement.hidden = false;
    requestAnimationFrame(positionWordCard);
    wordTitleElement.textContent = "Loading meaning…";
    wordMetaElement.textContent = "German dictionary entry";
    wordAlternativesElement.parentElement.hidden = true;
    wordDefinitionNoteElement.hidden = true;
    wordTranslationStatusElement.hidden = true;
    renderSavedWordContext(savedVocabulary.get(learning.normalizedWord(word)));
    renderVoiceStatus("Checking browser German voices…", false);
    wordTranslatedDefinitionElement.textContent = "";
    wordGermanDefinitionElement.textContent = "Loading…";
    renderWordExamples([], word, [], targetLanguage);
    renderWordGrammar(null, false);
    wordGermanSourceElement.href = `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    wordYouglishElement.href = `https://de.youglish.com/pronounce/${encodeURIComponent(word)}/german`;
    wordReplayElement.disabled = !owner.selectedWordClip;
    wordSpeakElement.disabled = true;
    wordSpeakElement.querySelector(".word-speak-label").textContent = "Speak";
    wordReplayElement.title = owner.selectedWordClip?.timing === "word-timestamps"
      ? "Replay this word using exact word timestamps"
      : "Replay an estimated word interval from this caption";
    renderSaveState(false, true);
    const saved = savedVocabulary.get(learning.normalizedWord(word));
    void checkGermanVoiceAvailability(owner, word, cardEpoch);

    try {
      let result = saved?.dictionaryContract === "de-wiktionary:v3" ? { ...saved, ok: true, saved: true }
        : await chrome.runtime.sendMessage({ type: "LOOKUP_WORD", word });
      if (session !== owner || owner.selectedWord !== word || owner.wordCardRevision !== revision) return;
      if (!result?.ok) throw new Error(result?.error || "Definition lookup failed.");
      result.word = word;
      owner.selectedWordResult = result;
      wordMetaElement.textContent = [result.pronunciation, result.lemma ? `Base form: ${result.lemma}` : null]
        .filter(Boolean).join(" · ") || "German dictionary entry";
      renderWordGrammar(result.grammar, result.isVerb);
      wordGermanSourceElement.href = result.germanSourceUrl || `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`;
      result.saved = savedVocabulary.has(learning.normalizedWord(word));
      renderSaveState(result.saved, false);
      await localizeSelectedWord(result);
    } catch (error) {
      if (session !== owner || owner.selectedWord !== word || owner.wordCardRevision !== revision) return;
      const legacyDefinitions = learning.germanWordDefinitions(saved || {}).map((value) => learning.extractCaseGovernment(value));
      owner.selectedWordResult = saved ? {
        ...saved,
        word,
        germanDefinitions: legacyDefinitions.map((item) => item.definition).filter(Boolean),
        germanDefinition: legacyDefinitions.map((item) => item.definition).filter(Boolean).join(" ") || null,
        grammar: {
          ...(saved.grammar || {}),
          governments: legacyDefinitions.map((item) => item.government).filter(Boolean)
            .filter((text, index, all) => all.indexOf(text) === index)
            .map((text) => ({ text, senseId: null, legacy: true }))
        },
        saved: true
      } : { word, title: word, saved: false };
      wordMetaElement.textContent = "Dictionary unavailable — the saved word remains available.";
      renderSaveState(owner.selectedWordResult.saved, false);
      await localizeSelectedWord(owner.selectedWordResult, error.message);
    }
  }

  async function translateWordCardText(owner, text, sourceLanguage, preferences) {
    if (!text) return "";
    if (sourceLanguage === preferences.targetLanguage) return text;
    const key = `${preferences.provider}:${sourceLanguage}:${preferences.targetLanguage}:${text}`;
    if (!owner.wordCardTranslations.has(key)) {
      const pending = chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", text, sourceLanguage, translationPreferences: preferences })
        .then((response) => {
          if (!response?.ok || !response.translatedText) throw new Error(response?.error || "Translation is unavailable.");
          return response.translatedText;
        });
      owner.wordCardTranslations.set(key, pending);
      if (owner.wordCardTranslations.size > 128) owner.wordCardTranslations.delete(owner.wordCardTranslations.keys().next().value);
      // Failed translations can be retried after changing provider/key or reopening the card.
      void pending.catch(() => {
        if (owner.wordCardTranslations.get(key) === pending) owner.wordCardTranslations.delete(key);
      });
    }
    return owner.wordCardTranslations.get(key);
  }

  async function localizeSelectedWord(result, dictionaryError = "") {
    const owner = session;
    const word = owner.selectedWord;
    const revision = ++owner.wordCardRevision;
    const preferences = { ...owner.translationPreferences };
    const language = preferences.targetLanguage;
    const current = () => session === owner && owner.selectedWordResult === result && owner.wordCardRevision === revision;
    const rawDefinitions = learning.germanWordDefinitions(result);
    const senses = (result.senses?.length ? result.senses : rawDefinitions.map((definition, index) => ({ id: `legacy-${index + 1}`, definition, examples: [] })))
      .filter((item) => item?.definition && learning.germanWordDefinitions({ germanDefinitions: [item.definition] }).length);
    const definitions = senses.map((item) => item.definition);
    const definition = senses[0]?.definition || "";
    const examples = [];
    const unassignedExamples = [];
    const selectedContext = owner.selectedWordContext;
    const sourceExamples = senses[0]?.sourceSenseId
      ? (senses[0].examples || [])
      : (result.senses?.length ? [] : result.examples || []);
    for (const example of [...sourceExamples].sort((left, right) => left.german.length - right.german.length)) {
      // Never claim a video cue is a dictionary example; use only matching complete source examples.
      if (example.german && wordOccursInGermanExample(example.german, word) && !examples.some((item) => item.german === example.german)) examples.push({ german: example.german, translation: null });
    }
    for (const example of result.examples || []) {
      if ((example.unassigned || (!example.senseIds?.length && !example.senseId)) && example.german && wordOccursInGermanExample(example.german, word)) unassignedExamples.push({ german: example.german, translation: null, unassigned: true });
    }
    wordTitleElement.textContent = "Translating meaning…";
    wordTitleElement.lang = language;
    wordTitleElement.dir = "auto";
    wordAlternativesElement.parentElement.hidden = true;
    wordGermanDefinitionElement.textContent = definition ? meaningDisplayText(definition, 1) : "Keine Wörterbuchdefinition verfügbar.";
    wordTranslatedDefinitionElement.textContent = definition ? "Translating definition…" : "";
    wordTranslatedDefinitionElement.hidden = !definition || language === "de";
    wordTranslatedDefinitionElement.lang = language;
    wordDefinitionNoteElement.hidden = !result.definitionLemma;
    wordDefinitionNoteElement.textContent = result.definitionLemma ? `Definition for base form: ${result.definitionLemma}` : "";
    wordTranslationStatusElement.hidden = true;
    renderWordExamples(examples, word, [], language, unassignedExamples);
    requestAnimationFrame(positionWordCard);

    const failures = [];
    const translate = async (text, sourceLanguage) => {
      try { return await translateWordCardText(owner, text, sourceLanguage, preferences); }
      catch (error) { failures.push(error.message); return ""; }
    };
    const directRequest = translate(word, "de").then((value) => {
      if (current() && value) wordTitleElement.textContent = value;
      return value;
    });
    const translateSenseExamples = async (sense) => {
      const matchingExamples = (sense.examples || [])
        .filter((example) => example.german && wordOccursInGermanExample(example.german, word));
      return Promise.all(matchingExamples.map(async (example) => ({
        ...example,
        translation: await translate(example.german, "de")
      })));
    };
    const [direct, translatedDefinitions, translatedExamples, translatedUnassignedExamples, translatedSenseExamples] = await Promise.all([
      directRequest,
      Promise.all(senses.map((sense) => translate(sense.definition, "de"))),
      Promise.all(examples.map(async (example) => ({ ...example, translation: example.translation || await translate(example.german, "de") }))),
      Promise.all(unassignedExamples.map(async (example) => ({ ...example, translation: await translate(example.german, "de") }))),
      Promise.all(senses.map(translateSenseExamples))
    ]);
    if (!current()) return;
    const heading = direct;
    wordTitleElement.textContent = heading || "Meaning unavailable";
    wordTitleElement.title = `Selected German word: ${word}`;
    const definitionTranslations = translatedDefinitions.map((value) => value || "");
    const applyExampleCandidates = (example) => {
      const candidates = learning.distinctMatchingCandidates(example.translation || "", [heading, ...definitionTranslations], language);
      return { ...example, targetPhrases: candidates.length === 1 ? candidates : [] };
    };
    wordAlternativesElement.replaceChildren(...senses.slice(1).map((sense, index) => {
      const row = document.createElement("div");
      const german = document.createElement("div");
      german.lang = "de";
      german.textContent = meaningDisplayText(sense.definition, index + 2);
      row.append(german);
      if (definitionTranslations[index + 1]) {
        const target = document.createElement("div");
        target.lang = language;
        target.dir = "auto";
        target.textContent = meaningDisplayText(definitionTranslations[index + 1]);
        row.append(target);
      }
      const examplesForSense = (translatedSenseExamples[index + 1] || []).map(applyExampleCandidates);
      if (examplesForSense.length) {
        const examples = document.createElement("div");
        examples.className = "word-alternatives-examples";
        renderWordExamplesInto(examples, examplesForSense, word, language);
        row.append(examples);
      }
      return row;
    }));
    wordAlternativesElement.lang = language;
    wordAlternativesElement.parentElement.hidden = senses.length < 2;
    wordAlternativesElement.parentElement.querySelector("summary").textContent = `Other meanings (${Math.max(0, senses.length - 1)})`;
    wordAlternativesElement.setAttribute("aria-label", "Alternative meanings");
    wordTranslatedDefinitionElement.textContent = meaningDisplayText(definitionTranslations[0]) || (definition ? "Definition translation unavailable." : "");
    renderWordExamples(translatedExamples.map(applyExampleCandidates), word, [], language, translatedUnassignedExamples.map(applyExampleCandidates));
    const governments = result.grammar?.governments?.length
      ? result.grammar.governments
      : (result.grammar?.cases || []).map((value) => ({ text: `mit ${value}`, senseId: null, legacy: true }));
    const translatedGovernments = await Promise.all(governments.map(async (government) => ({ ...government, translation: await translate(government.text, "de") })));
    if (!current()) return;
    renderWordGrammar(result.grammar, result.isVerb, translatedGovernments);
    const contextExample = translatedExamples.find((example) => example.german === selectedContext?.text);
    if (contextExample?.translation) selectedContext.translations.set(language, contextExample.translation);
    const errors = [...new Set([dictionaryError, ...failures].filter(Boolean))];
    wordTranslationStatusElement.hidden = errors.length === 0;
    wordTranslationStatusElement.textContent = errors.length ? `Some word details are unavailable: ${errors[0]}` : "";
    requestAnimationFrame(positionWordCard);
  }

  function renderSavedWordContext(entry) {
    // Context and video provenance remain stored metadata, never card copy or a definition fallback.
    if (wordSavedContextElement) {
      wordSavedContextElement.hidden = true;
      wordSavedContextElement.textContent = "";
    }
    if (wordReturnSourceElement) wordReturnSourceElement.hidden = !entry?.video?.url;
  }

  function returnToSavedSource(event) {
    event.stopPropagation();
    const entry = savedVocabulary.get(learning.normalizedWord(session?.selectedWord));
    const source = entry?.video?.url;
    if (!source) return;
    if (reviewContainer) {
      const url = learning.stablePageUrl(source);
      if (url) void chrome.tabs.create({ url }).catch((error) => {
        wordTranslationStatusElement.hidden = false;
        wordTranslationStatusElement.textContent = `Could not open the saved source: ${error.message}`;
      });
      return;
    }
    const clipStart = Number(entry?.clip?.start);
    if (video && learning.stablePageUrl(location.href) === learning.stablePageUrl(source) && Number.isFinite(clipStart)) {
      const seekable = video.seekable;
      for (let index = 0; index < seekable.length; index += 1) {
        const start = seekable.start(index);
        const end = seekable.end(index);
        if (clipStart >= start && clipStart <= end) {
          video.currentTime = Math.max(start, Math.min(end, clipStart));
          return;
        }
      }
    }
    // The saved URL is normally the top-level video page; an embedded frame must not navigate itself.
    void chrome.runtime.sendMessage({ type: "RETURN_SAVED_WORD_SOURCE", word: entry.word }).catch((error) => {
      renderStatus(`Could not return to the saved source: ${error.message}`, true);
    });
  }

  function renderVoiceStatus(text, showCheckAgain) {
    if (!wordVoiceStatusElement) return;
    wordVoiceStatusElement.hidden = !text;
    if (!text) return;
    const state = showCheckAgain ? 'warning' : /ready|finished|speaking with/i.test(text) ? 'ready' : /checking|waiting/i.test(text) ? 'pending' : 'info';
    renderStatusIndicator(wordVoiceStatusElement, text, state, 'German pronunciation status', 'german-voice-status');
    reportUiDiagnostic('voice', text);
    if (showCheckAgain) {
      const check = document.createElement("button");
      check.type = "button";
      check.className = "word-status-trigger word-status-retry";
      check.setAttribute('aria-label', 'Check German voices again');
      check.title = 'Check again';
      check.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M15 7a6 6 0 1 0 .2 6M15 3v4h-4"/></svg>';
      check.addEventListener("click", (event) => {
        event.stopPropagation();
        const owner = session;
        if (owner?.selectedWord) void checkGermanVoiceAvailability(owner, owner.selectedWord, owner.wordCardEpoch);
      });
      wordVoiceStatusElement.append(check);
    }
  }

  function renderStatusIndicator(container, text, state, label, tooltipId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'word-status-trigger';
    button.dataset.state = state;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-describedby', tooltipId);
    const glyph = state === 'ready' ? '<path d="m5 10 3 3 7-7"/>'
      : state === 'warning' ? '<path d="M10 5v6m0 3v1"/>'
      : state === 'pending' ? '<circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/>'
      : '<path d="M10 9v6m0-10v1"/>';
    button.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="8"/>${glyph}</svg>`;
    const tooltip = document.createElement('span');
    tooltip.id = tooltipId;
    tooltip.className = 'word-status-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = text;
    container.replaceChildren(button, tooltip);
    container.onmouseenter = container.onfocusin = () => { delete container.dataset.tooltipDismissed; };
    container.onkeydown = event => {
      if (event.key !== 'Escape') return;
      container.dataset.tooltipDismissed = 'true';
      event.stopPropagation();
    };
  }

  function meaningDisplayText(value, ordinal = null) {
    const text = String(value || '').replace(/^\s*(?:\[\d+(?:\.\d+)*[a-z]?(?:\s*[,–-]\s*\d+(?:\.\d+)*[a-z]?)*\]\s*)+/iu, '');
    return ordinal === null ? text : `${ordinal}. ${text}`;
  }

  function getPronunciationController() {
    if (!pronunciationController) {
      // Speech is optional: its loading/availability must never disable player discovery.
      const pronunciation = globalThis.DubTranscriptPronunciation;
      if (typeof pronunciation?.createController !== "function") {
        throw new Error("Browser pronunciation component is unavailable. Reload the extension and refresh this page to enable speech. Video analysis remains available.");
      }
      pronunciationController = pronunciation.createController({
        synthesis: globalThis.speechSynthesis,
        Utterance: globalThis.SpeechSynthesisUtterance,
        onVoicesChanged() {
          const owner = session;
          if (owner?.selectedWord && !owner.ttsRequestId && !wordCardElement?.hidden) {
            checkGermanVoiceAvailability(owner, owner.selectedWord, owner.wordCardEpoch);
          }
        }
      });
    }
    return pronunciationController;
  }

  function checkGermanVoiceAvailability(owner, word, cardEpoch) {
    try {
      const response = getPronunciationController().availability();
      if (session !== owner || owner.selectedWord !== word || owner.wordCardEpoch !== cardEpoch || wordCardElement?.hidden) return;
      if (response?.state === "available") {
        wordSpeakElement.disabled = false;
        renderVoiceStatus(`German voice ready (${response.online ? "online" : "local"}): ${response.voice.name}.`, false);
      } else {
        wordSpeakElement.disabled = true;
        renderVoiceStatus(response.state === "unsupported"
          ? "Speech synthesis is not supported by this browser."
          : "No German browser voice is available yet. Other languages will not be used. Check again or enable a German voice in your browser/system.", true);
      }
    } catch (error) {
      if (session === owner && owner.selectedWord === word && owner.wordCardEpoch === cardEpoch && !wordCardElement?.hidden) {
        wordSpeakElement.disabled = true;
        renderVoiceStatus(`Could not check browser German voices: ${error.message}`, true);
      }
    }
  }

  function renderHighlightedText(container, text, phrases, language) {
    const fragment = document.createDocumentFragment();
    for (const part of learning.highlightedTextParts(text, phrases, language)) {
      if (part.highlighted) {
        const mark = document.createElement("mark");
        mark.className = "word-highlight";
        mark.textContent = part.text;
        fragment.append(mark);
      } else fragment.append(document.createTextNode(part.text));
    }
    container.replaceChildren(fragment);
  }

  function renderWordExamples(examples, word, targetPhrases, targetLanguage, unassignedExamples = []) {
    const fragment = document.createDocumentFragment();
    const sourceExamples = examples.filter((item) => item.german);
    const createExampleCard = (example) => {
      const card = document.createElement("div");
      card.className = "word-example-card";
      const german = document.createElement("div");
      german.className = "word-example-de";
      german.lang = "de";
      renderHighlightedText(german, learning.normalizeExampleQuotation(example.german), [word], "de");
      card.append(german);
      if (example.translation) {
        const translated = document.createElement("div");
        translated.className = "word-example-target";
        translated.lang = targetLanguage;
        translated.dir = "auto";
        renderHighlightedText(translated, example.translation, example.targetPhrases || targetPhrases, targetLanguage);
        card.append(translated);
      }
      return card;
    };
    if (sourceExamples[0]) {
      if (sourceExamples[0].german.length <= 180) fragment.append(createExampleCard(sourceExamples[0]));
      else {
        const full = document.createElement("details");
        full.className = "word-more-examples";
        const summary = document.createElement("summary");
        summary.textContent = "Show full example";
        full.append(summary, createExampleCard(sourceExamples[0]));
        fragment.append(full);
      }
    }
    const remaining = sourceExamples.slice(1);
    if (remaining.length) {
      const more = document.createElement("details");
      more.className = "word-more-examples";
      const summary = document.createElement("summary");
      summary.textContent = `More examples (${remaining.length})`;
      more.append(summary, ...remaining.map(createExampleCard));
      fragment.append(more);
    }
    if (unassignedExamples.length) {
      const unassigned = document.createElement("details");
      unassigned.className = "word-more-examples";
      const summary = document.createElement("summary");
      summary.textContent = `Unassigned source examples (${unassignedExamples.length})`;
      unassigned.append(summary, ...unassignedExamples.map(createExampleCard));
      fragment.append(unassigned);
    }
    wordExamplesElement.replaceChildren(fragment);
    wordExamplesElement.parentElement.hidden = !examples.some((example) => example.german) && !unassignedExamples.some((example) => example.german);
  }

  function wordOccursInGermanExample(example, word) {
    return learning.highlightedTextParts(example, [word], "de").some((part) => part.highlighted);
  }

  function renderWordExamplesInto(container, examples, word, targetLanguage) {
    for (const example of examples) {
      const card = document.createElement("div");
      card.className = "word-example-card";
      const german = document.createElement("div");
      german.className = "word-example-de";
      german.lang = "de";
      renderHighlightedText(german, learning.normalizeExampleQuotation(example.german), [word], "de");
      card.append(german);
      if (example.translation) {
        const translated = document.createElement("div");
        translated.className = "word-example-target";
        translated.lang = targetLanguage;
        translated.dir = "auto";
        renderHighlightedText(translated, example.translation, example.targetPhrases || [], targetLanguage);
        card.append(translated);
      }
      container.append(card);
    }
  }

  function renderWordList(container, values) {
    const items = (values || []).filter(Boolean);
    const list = document.createElement("ul");
    list.className = "word-list";
    for (const value of items) {
      const item = document.createElement("li");
      item.textContent = value;
      list.append(item);
    }
    container.replaceChildren(...(items.length ? [list] : []));
    container.parentElement.hidden = items.length === 0;
  }

  function renderWordGrammar(grammar, isVerb = false, governments = []) {
    if (!isVerb && !governments.length) {
      wordGrammarElement.replaceChildren();
      wordGrammarElement.parentElement.hidden = true;
      return;
    }
    const caseRows = governments.map((government) => [
        government.senseId ? `Government [${government.senseId}]` : "Government",
        `${government.text}${government.translation ? ` — ${government.translation}` : ""}`
      ]);
    const verbRows = (isVerb ? [
        ["Infinitiv", grammar?.infinitive],
        ["Präsens", grammar?.present],
        ["Präteritum", grammar?.preterite],
        ["Partizip II", grammar?.participle],
        ["Perfekt", grammar?.perfect]
      ].concat((grammar?.baseForms || []).map(item => [`Grundform [${item.sectionId}]`, item.infinitive]))
        .concat((grammar?.auxiliaries || []).map(item => [`Hilfsverb / Perfekt [${item.senseId}]`, item.perfect || item.auxiliary])) : [])
      .filter(([, value]) => value);
    const fragment = document.createDocumentFragment();
    for (const [label, value] of caseRows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.dir = "auto";
      definition.textContent = value;
      fragment.append(term, definition);
    }
    if (verbRows.length) {
      const term = document.createElement('dt');
      term.className = 'word-verb-block-label';
      term.textContent = 'Verb overview';
      const definition = document.createElement('dd');
      definition.className = 'word-verb-block';
      const table = document.createElement('table');
      table.className = 'word-verb-table word-verb-overview';
      table.setAttribute('aria-label', 'German verb overview');
      table.lang = 'de';
      const body = document.createElement('tbody');
      for (const [label, value] of verbRows) {
        const row = document.createElement('tr');
        const heading = document.createElement('th');
        heading.scope = 'row';
        heading.textContent = label;
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(heading, cell);
        body.append(row);
      }
      table.append(body);
      definition.append(createWordTableScroller(table, 'Verb overview'));
      fragment.append(term, definition);
    }
    if (isVerb && grammar?.conjugations?.length) {
      const term = document.createElement('dt');
      term.className = 'word-verb-block-label';
      term.textContent = 'Verb forms';
      const definition = document.createElement('dd');
      definition.className = 'word-verb-block';
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Conjugations (${grammar.conjugations.length})`;
      const table = document.createElement('table');
      table.className = 'word-verb-table word-conjugation-table';
      table.setAttribute('aria-label', 'German verb conjugations');
      table.lang = 'de';
      const header = document.createElement('thead');
      header.lang = 'en';
      const headerRow = document.createElement('tr');
      for (const label of ['Tense / mood', 'Person', 'Form']) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        headerRow.append(cell);
      }
      header.append(headerRow);
      table.append(header);
      // Group only presentation rows sharing source section and tense/mood.
      // Every supplied form/alternative keeps its person and source relationship.
      const groups = new Map();
      for (const form of grammar.conjugations) {
        const key = JSON.stringify([form.sectionId, form.tense, form.mood]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(form);
      }
      for (const forms of groups.values()) {
        const body = document.createElement('tbody');
        forms.forEach((form, index) => {
          const row = document.createElement('tr');
          if (index === 0) {
            const tense = document.createElement('th');
            tense.scope = 'rowgroup';
            tense.rowSpan = forms.length;
            tense.textContent = [...new Set([form.tense, form.mood].filter(Boolean))].join(' · ');
            row.append(tense);
          }
          const person = document.createElement('th');
          person.scope = 'row';
          person.textContent = form.person;
          const value = document.createElement('td');
          value.textContent = form.form;
          row.append(person, value);
          body.append(row);
        });
        table.append(body);
      }
      details.append(summary, createWordTableScroller(table, 'Verb conjugations'));
      definition.append(details);
      fragment.append(term, definition);
    }
    wordGrammarElement.replaceChildren(fragment);
    wordGrammarElement.parentElement.hidden = !caseRows.length && !verbRows.length && !(isVerb && grammar?.conjugations?.length);
  }

  function createWordTableScroller(table, label) {
    const scroller = document.createElement('div');
    scroller.className = 'word-table-scroll';
    scroller.dir = 'ltr';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', label);
    scroller.append(table);
    return scroller;
  }

  function pronounceSelectedWord(event) {
    event.stopPropagation();
    const word = session?.selectedWord;
    if (!word || !wordSpeakElement) return;
    const owner = session;
    const cardEpoch = owner.wordCardEpoch;
    const requestId = `${cardEpoch}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    owner.ttsRequestId = requestId;
    wordSpeakElement.disabled = true;
    wordSpeakElement.querySelector(".word-speak-label").textContent = "Waiting…";
    renderVoiceStatus("Waiting for the German browser voice to start…", false);
    try {
      const response = getPronunciationController().speak(word, (state) => {
        handleGermanTtsEvent({ ...state, word, requestId });
      });
      if (!response?.ok) throw new Error(response?.error || "German pronunciation is unavailable.");
    } catch (error) {
      if (session === owner && owner.selectedWord === word && owner.wordCardEpoch === cardEpoch && !wordCardElement?.hidden) {
        wordSpeakElement.disabled = false;
        wordSpeakElement.querySelector(".word-speak-label").textContent = "Speak";
        owner.ttsRequestId = null;
        renderVoiceStatus(error.message, true);
      }
    }
  }

  function handleGermanTtsEvent(message) {
    const owner = session;
    if (!owner || owner.ttsRequestId !== message.requestId || owner.selectedWord !== message.word || wordCardElement?.hidden) return;
    const label = wordSpeakElement?.querySelector(".word-speak-label");
    if (message.state === "accepted") return;
    if (message.state === "speaking") { if (label) label.textContent = "Speaking…"; renderVoiceStatus(`Speaking with a German voice (${message.online ? "online" : "local"}).`, false); return; }
    owner.ttsRequestId = null;
    if (message.state === "end") { if (label) label.textContent = "Speak"; wordSpeakElement.disabled = false; renderVoiceStatus("Pronunciation finished.", false); return; }
    if (message.state === "interrupted" || message.state === "cancelled") { if (label) label.textContent = "Speak"; wordSpeakElement.disabled = false; renderVoiceStatus("Pronunciation did not finish.", false); return; }
    if (message.state === "completion-unconfirmed" || message.state === "start-unconfirmed") { if (label) label.textContent = "Speak"; wordSpeakElement.disabled = false; renderVoiceStatus(message.state === "start-unconfirmed" ? "Playback could not be confirmed." : "Playback started; completion could not be confirmed.", true); return; }
    if (label) label.textContent = "Speak";
    wordSpeakElement.disabled = false;
    renderVoiceStatus(message.error || "German pronunciation failed.", true);
  }

  function replaySelectedWord(event) {
    event.stopPropagation();
    const clip = session?.selectedWordClip;
    if (!video || !clip) return;
    restoreWordReplay(false, true);
    const originalTime = video.currentTime;
    const state = {
      originalTime,
      originalRate: video.playbackRate,
      wasPaused: video.paused,
      start: Math.max(0, clip.start - 0.18),
      end: Math.min(Number(video.duration) || Infinity, Math.max(clip.end + 0.22, clip.start + 0.35)),
      timer: null,
      releaseTimer: null
    };
    wordReplay = state;
    wordReplayElement.disabled = true;
    wordReplayElement.textContent = "Playing…";
    video.pause();
    video.playbackRate = 1;
    video.currentTime = state.start;
    Promise.resolve(video.play()).catch((error) => {
      renderStatus(`Could not replay the word: ${error.message}`, true);
      restoreWordReplay(true);
    });
    state.timer = setInterval(() => {
      if (!video || wordReplay !== state) return;
      if (video.currentTime >= state.end || video.ended) restoreWordReplay(true);
    }, 40);
  }

  function restoreWordReplay(resumePlayback = true, releaseImmediately = false) {
    const state = wordReplay;
    if (!state || !video) return;
    clearInterval(state.timer);
    clearTimeout(state.releaseTimer);
    video.pause();
    video.playbackRate = state.originalRate;
    video.currentTime = state.originalTime;
    if (resumePlayback && !state.wasPaused) void video.play().catch(() => {});
    if (wordReplayElement) {
      wordReplayElement.disabled = !session?.selectedWordClip;
      wordReplayElement.textContent = "Replay clip";
    }
    if (releaseImmediately) {
      if (wordReplay === state) wordReplay = null;
      return;
    }
    state.releaseTimer = setTimeout(() => {
      if (wordReplay === state) {
        wordReplay = null;
        if (!video.paused) startCurrentWordHighlight();
      }
    }, 450);
  }

  async function toggleSavedWord(event) {
    event.stopPropagation();
    const result = session?.selectedWordResult;
    if (!result) return;
    if (reviewContainer) {
      const owner = session;
      wordSaveElement.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: "REMOVE_SAVED_WORD", word: result.word });
        if (!response?.ok) throw new Error(response?.error || "Could not remove saved word.");
        if (session !== owner) return;
        const changed = reviewCallbacks?.onRemoved;
        closeWordCard();
        changed?.();
      } catch (error) {
        if (session?.selectedWordResult !== result) return;
        wordSaveElement.disabled = false;
        wordTranslationStatusElement.hidden = false;
        wordTranslationStatusElement.textContent = error.message;
      }
      return;
    }
    const owner = session;
    const wasSaved = Boolean(result.saved);
    const revision = vocabularyRevision;
    const context = session.selectedWordContext?.text || session.displayedText;
    const contextTranslation = session.selectedWordContext?.translations.get(session.translationPreferences.targetLanguage) || "";
    const clip = session.selectedWordClip;
    wordSaveElement.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage(wasSaved
        ? { type: "REMOVE_SAVED_WORD", word: result.word }
        : {
            type: "SAVE_WORD",
            entry: {
              ...result,
              ...(owner.sourceVideo ? { video: owner.sourceVideo } : {}),
              context,
              contextTranslation,
              clip
            }
          });
      if (!response?.ok) throw new Error(response?.error || "Could not update saved words.");
      // onChanged may already have applied this mutation before sendMessage resolves.
      if (vocabularyRevision === revision) {
        if (wasSaved) savedVocabulary.delete(learning.normalizedWord(result.word));
        else savedVocabulary.set(learning.normalizedWord(result.word), response.entry || { ...result, context, contextTranslation });
        vocabularyRevision += 1;
      }
      refreshSavedWordMarks();
    } catch (error) {
      if (session === owner) renderStatus(error.message, true);
    } finally {
      if (session === owner && session.selectedWordResult === result) wordSaveElement.disabled = false;
    }
  }

  function renderSaveState(saved, disabled) {
    wordSaveElement.disabled = disabled;
    wordSaveElement.classList.toggle("saved", saved);
    wordSaveElement.textContent = saved ? "Saved ✓" : "Save word";
    if (reviewContainer && saved) wordSaveElement.textContent = "Remove saved word";
  }

  function closeWordCard(event) {
    event?.stopPropagation();
    restoreWordReplay(true);
    if (session) {
      session.wordCardRevision += 1;
      session.ttsRequestId = null;
      session.selectedWord = null;
      session.selectedWordContext = null;
      pronunciationController?.cancel();
    }
    if (session) session.selectedWordResult = null;
    if (session) session.selectedWordClip = null;
    transcriptElement?.querySelector(".word.selected")?.classList.remove("selected");
    if (wordCardElement) wordCardElement.hidden = true;
    if (reviewContainer && session) {
      session = null;
      overlayHost?.remove();
      const closed = reviewCallbacks?.onClose;
      reviewCallbacks = null;
      closed?.();
    }
  }

  function stopPlayerClick(event) {
    event.stopPropagation();
  }

  function renderLiveStatus() {
    const processingLag = Number(session?.processingLag);
    if (Number.isFinite(processingLag)) {
      if (processingLag > 2.5) session.processingWarning = true;
      if (processingLag < 1) session.processingWarning = false;
    }
    if (session.processingWarning && Number.isFinite(processingLag)) {
      renderStatus(`Recognizer is processing ${processingLag.toFixed(1)}s behind`);
      return;
    }
    renderStatus("");
  }

  function renderStatus(text, isError = false) {
    if (!statusElement) return;
    text = String(text || '');
    const replayNotice = !isError && /^Cached transcript replay\b/.test(text);
    if (replayNotice && statusElement.classList.contains('error')) return;
    if (statusElement.textContent === text && statusElement.classList.contains('error') === isError) return;
    reportUiDiagnostic('status', text);
    statusElement.classList.toggle("error", isError);
    if (replayNotice) {
      if (!showTransientNotice(statusElement, text) && statusElement.textContent !== text) {
        stopTransientNotice(statusElement);
        statusElement.textContent = text;
        statusElement.hidden = true;
      }
      return;
    }
    stopTransientNotice(statusElement);
    statusElement.textContent = text;
    statusElement.hidden = !text;
  }

  function showTransientNotice(element, text) {
    if (!element || !text) return false;
    let notice = transientNotices.get(element);
    if (!notice) {
      notice = { seen: new Set(), timers: [], generation: 0 };
      transientNotices.set(element, notice);
    }
    // Rendering runs every frame; a previously explained provenance must not
    // restart the deadline or flash again between words/cues in this session.
    if (notice.seen.has(text)) return false;
    stopTransientNotice(element);
    notice.seen.add(text);
    const generation = notice.generation;
    element.textContent = text;
    element.hidden = false;
    notice.timers.push(setTimeout(() => {
      if (notice.generation !== generation) return;
      element.classList.add('notice-fading');
      const fadeDuration = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 700;
      notice.timers.push(setTimeout(() => {
        if (notice.generation === generation) element.hidden = true;
      }, fadeDuration));
    }, 2000));
    return true;
  }

  function stopTransientNotice(element) {
    const notice = transientNotices.get(element);
    if (notice) {
      for (const timer of notice.timers) clearTimeout(timer);
      notice.timers = [];
      notice.generation++;
    }
    element?.classList.remove('notice-fading');
  }

  function reportUiDiagnostic(kind, value) {
    if (reviewContainer || !session || !value || session.uiDiagnostics[kind] === value) return;
    session.uiDiagnostics[kind] = value;
    try {
      void chrome.runtime.sendMessage(session.youtubeRequest
        ? { type: 'YOUTUBE_OVERLAY_DIAGNOSTIC', ...session.youtubeRequest, kind, value }
        : { type: 'UI_DIAGNOSTIC', experimentId: session.id, kind, value }).catch(() => {});
    } catch { /* Optional diagnostics must not interrupt caption or word-card rendering. */ }
  }

  function findPrimaryVideo() {
    return [...document.querySelectorAll("video")]
      .filter((candidate) => candidate.readyState > 0)
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0]
      || document.querySelector("video");
  }

  function restorePlayerPosition() {
    if (playerContainer && playerInlinePosition !== null) {
      playerContainer.style.position = playerInlinePosition;
    }
    playerInlinePosition = null;
  }

  function mediaContext(element) {
    let security = mediaSecurityStates.get(element);
    if (!security) {
      security = { encrypted: false };
      element.addEventListener("encrypted", () => {
        security.encrypted = true;
      });
      mediaSecurityStates.set(element, security);
    }
    const rect = element.getBoundingClientRect();
    const currentSrc = String(element.currentSrc || element.src || "");
    const observedMedia = globalThis.__dubTranscriptMediaObserver?.snapshot?.() || {
      drmProtected: false,
      netflixMetadata: null,
      observer: null,
      candidates: []
    };
    const mediaKeysAttached = Boolean(element.mediaKeys);
    const encryptedEventObserved = Boolean(security.encrypted);
    const observerReportedDrm = Boolean(observedMedia.drmProtected);
    return {
      currentTime: element.currentTime,
      playbackRate: element.playbackRate,
      paused: element.paused,
      duration: Number.isFinite(element.duration) ? element.duration : null,
      readyState: element.readyState,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: rect.width > 0 && rect.height > 0,
      frameUrl: location.href,
      frameReferrer: document.referrer || null,
      documentTitle: String(document.title || "").replace(/\s+/g, " ").trim().slice(0, 300),
      visibleTitleText: netflixVisibleTitleText(),
      currentSrc,
      sourceKind: currentSrc.startsWith("blob:") ? "blob" : (currentSrc ? "direct" : "empty"),
      batchCandidates: mediaBatchCandidates(element, currentSrc, observedMedia.candidates),
      observerDiagnostics: observedMedia.observer || null,
      netflixMetadata: observedMedia.netflixMetadata || null,
      drmProtected: Boolean(
        mediaKeysAttached
        || encryptedEventObserved
        || observerReportedDrm
      ),
      drmSignals: {
        mediaKeysAttached,
        encryptedEventObserved,
        observerReportedDrm
      },
      userAgent: navigator.userAgent,
      browserLanguage: navigator.language || null,
      browserPlatform: navigator.userAgentData?.platform || navigator.platform || null
    };
  }

  function netflixVisibleTitleText() {
    if (!/(^|\.)netflix\.com$/i.test(location.hostname)) return "";
    const selectors = [
      "[data-uia='video-title']",
      "[data-uia='player-title']",
      "[data-uia='video-title'] h4",
      "[data-uia='video-title'] span"
    ];
    const values = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return [...new Set(values)].join(" · ").slice(0, 400);
  }

  function mediaBatchCandidates(element, currentSrc, observedCandidates = []) {
    const sourceUrls = [...element.querySelectorAll("source[src]")]
      .map((source) => ({
        url: source.src,
        kind: mediaCandidateKind(source.src, source.type) || "unknown-media",
        source: "source-element",
        contentType: source.type || ""
      }));
    const resourceUrls = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .slice(-20)
      .reverse()
      .map((url) => {
        const kind = mediaCandidateKind(url);
        return kind ? {
          url,
          kind,
          source: "performance",
          contentType: ""
        } : null;
      })
      .filter(Boolean);
    const rawCandidates = [
      {
        url: currentSrc,
        kind: mediaCandidateKind(currentSrc, element.type)
          || (/^https?:/i.test(currentSrc) ? "unknown-media" : null),
        source: "current-src",
        contentType: element.type || ""
      },
      ...sourceUrls,
      ...observedCandidates,
      ...resourceUrls
    ];
    const unique = new Map();
    for (const candidate of rawCandidates) {
      if (!candidate?.kind) continue;
      try {
        const parsed = new URL(String(candidate?.url || ""));
        if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) continue;
        parsed.hash = "";
        const url = parsed.href;
        if (!unique.has(url)) unique.set(url, { ...candidate, url });
      } catch {
        // Ignore blob URLs and malformed resource names.
      }
    }
    return [...unique.values()].slice(0, 100);
  }

  function mediaCandidateKind(url, contentType = "") {
    return mediaCandidate.classify(url, contentType, location.href);
  }
  // Publish readiness only after dependencies and message listeners initialized successfully.
  globalThis.DubYouTubeOverlay = {
    start: message => beginSession({ ...message, youtubeCaptions: true, collectCaptions: false }),
    update(message) {
      if (!session?.youtubeCaptions || session.youtubeRequest?.requestId !== message.youtubeRequest?.requestId
        || session.youtubeRequest?.videoId !== message.youtubeRequest?.videoId) return;
      if (message.experimentId) session.id = message.experimentId;
      if (message.platformTranslations) {
        session.platformTranslations = message.platformTranslations;
        session.platformTranslationLanguage = message.platformTranslationLanguage || '';
        session.platformTranslationPending = Boolean(message.platformTranslationPending);
        void renderTranslation(session.displayedText || '');
      }
    },
    stop(resumeHover = false) { if (session?.youtubeCaptions) endSession({ resumeHover }); },
    suspend(value) {
      if (!session?.youtubeCaptions || !overlayHost) return;
      overlayHost.dataset.suspended = String(Boolean(value));
      if (value) hoverPause?.release(false);
    }
  };
  globalThis.__dubTranscriptLabVersion = CONTENT_SCRIPT_VERSION;
})();

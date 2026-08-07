(() => {
  if (globalThis.__dubTranscriptLabVersion === 16) return;
  globalThis.__dubTranscriptLabVersion = 16;

  const transcriptGroups = globalThis.DubTranscriptGroups;
  const learning = globalThis.DubTranscriptLearning;
  const mediaCandidate = globalThis.DubTranscriptMediaCandidate;
  const localMedia = globalThis.DubTranscriptLocalMedia;
  if (!transcriptGroups) throw new Error("Transcript grouping helpers were not loaded.");
  if (!learning) throw new Error("Learning feature helpers were not loaded.");
  if (!mediaCandidate) throw new Error("Media candidate helpers were not loaded.");
  if (!localMedia) throw new Error("Local media helpers were not loaded.");

  let video = null;
  let session = null;
  let clockTimer = null;
  let captionTimer = null;
  let seekTimer = null;
  let overlayHost = null;
  let playerContainer = null;
  let playerInlinePosition = null;
  let wrapElement = null;
  let captionBoxElement = null;
  let captionDragHandleElement = null;
  let transcriptElement = null;
  let translationElement = null;
  let statusElement = null;
  let wordCardElement = null;
  let wordTitleElement = null;
  let wordMetaElement = null;
  let wordEnglishDefinitionElement = null;
  let wordGermanDefinitionElement = null;
  let wordExamplesElement = null;
  let wordCollocationsElement = null;
  let wordGrammarElement = null;
  let wordRelatedElement = null;
  let wordSaveElement = null;
  let wordReplayElement = null;
  let wordYouglishElement = null;
  let wordGermanSourceElement = null;
  let wordEnglishSourceElement = null;
  let currentCaption = null;
  let captionDrag = null;
  let suppressTranscriptClick = false;
  let wordReplay = null;
  let listeners = [];
  const mediaSecurityStates = new WeakMap();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      switch (message.type) {
        case "PING_CONTENT":
          sendResponse({ ok: true });
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
      collectCaptions: false,
      segments: message.segments || [],
      displayGroups: transcriptGroups.buildDisplayGroups(message.segments || []),
      syncOffset: transcriptGroups.normalizeSyncOffset(message.syncOffset),
      buffer: "",
      replay: false,
      displayedText: null,
      displayedTimingKey: null,
      selectedWord: null,
      selectedWordResult: null,
      selectedWordClip: null,
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

    createOverlay();
    addVideoListener("play", () => sendMediaEvent("play"));
    addVideoListener("pause", () => sendMediaEvent("pause"));
    addVideoListener("seeking", () => sendMediaEvent("seeking"));
    addVideoListener("seeked", scheduleSeekedEvent);
    addVideoListener("ratechange", () => sendMediaEvent("ratechange"));
    document.addEventListener("fullscreenchange", placeOverlay);

    clockTimer = setInterval(() => {
      if (!video || !session) return;
      if (!wordReplay) {
        void chrome.runtime.sendMessage({
          type: "MEDIA_CLOCK",
          currentTime: video.currentTime,
          playbackRate: video.playbackRate
        });
      }
      renderTranscript();
      updatePlayerAwarePosition();
    }, 250);

    setCaptionCollection(Boolean(message.collectCaptions));
    renderStatus("Preparing the local recognizer…");
  }

  function setCaptionCollection(enabled) {
    if (!session) return;
    if (!enabled) finalizeCaption();
    clearInterval(captionTimer);
    captionTimer = null;
    session.collectCaptions = enabled;
    if (enabled) captionTimer = setInterval(sampleCaption, 120);
  }

  function endSession() {
    finalizeCaption();
    clearInterval(clockTimer);
    clearInterval(captionTimer);
    clearTimeout(seekTimer);
    clockTimer = null;
    captionTimer = null;
    seekTimer = null;
    for (const { target, name, handler } of listeners) {
      target.removeEventListener(name, handler);
    }
    listeners = [];
    restoreWordReplay(false, true);
    document.removeEventListener("fullscreenchange", placeOverlay);
    overlayHost?.remove();
    restorePlayerPosition();
    overlayHost = null;
    playerContainer = null;
    transcriptElement = null;
    statusElement = null;
    wordCardElement = null;
    wordTitleElement = null;
    wordMetaElement = null;
    wordEnglishDefinitionElement = null;
    wordGermanDefinitionElement = null;
    wordExamplesElement = null;
    wordCollocationsElement = null;
    wordGrammarElement = null;
    wordRelatedElement = null;
    wordSaveElement = null;
    wordReplayElement = null;
    wordYouglishElement = null;
    wordGermanSourceElement = null;
    wordEnglishSourceElement = null;
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
    if (!video || !session || wordReplay) return;
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

  function createOverlay() {
    document.getElementById("dub-transcript-lab-overlay")?.remove();
    overlayHost = document.createElement("div");
    overlayHost.id = "dub-transcript-lab-overlay";
    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
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
        .wrap {
          position: absolute;
          left: var(--caption-left, 50%);
          bottom: var(--caption-bottom, 11%);
          transform: translateX(-50%);
          width: min(880px, 88%);
          pointer-events: none;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
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
          font: 700 17px/1 system-ui, sans-serif;
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
          outline: 2px solid #9b87ff;
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
          background: rgba(121, 91, 255, .86);
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
        .word:hover,
        .word:focus-visible,
        .word.selected {
          outline: none;
          background: rgba(121, 91, 255, .8);
          box-shadow: 0 0 0 2px rgba(255,255,255,.28);
        }
        .status {
          display: block;
          width: max-content;
          max-width: 80%;
          margin: 0 auto 6px;
          padding: 4px 7px;
          border-radius: 999px;
          background: rgba(18, 20, 27, .78);
          color: #cbd1dc;
          font-size: 11px;
          font-weight: 500;
        }
        .status:empty { display: none; }
        .status.error { color: #ff9b9b; }
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
          background: linear-gradient(145deg, rgba(20, 24, 36, .9), rgba(7, 10, 17, .84));
          backdrop-filter: blur(22px) saturate(1.2);
          -webkit-backdrop-filter: blur(22px) saturate(1.2);
          color: #f5f7fb;
          box-shadow: 0 8px 32px rgba(0,0,0,.48);
          text-align: left;
          pointer-events: auto;
          user-select: text;
          -webkit-user-select: text;
          overflow-y: auto;
        }
        .word-card[hidden] { display: none; }
        .word-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .word-heading { min-width: 0; }
        .word-title { font-size: 18px; font-weight: 750; }
        .word-meta { margin-top: 2px; color: #aeb6c5; font-size: 11px; }
        .word-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .word-action {
          border: 1px solid #7560e8;
          border-radius: 6px;
          padding: 5px 8px;
          background: #5b43cf;
          color: white;
          font-size: 11px;
          line-height: 1.2;
          text-decoration: none;
          cursor: pointer;
        }
        .word-action.secondary { border-color: #4d5668; background: #272e3c; }
        .word-action:disabled { cursor: default; opacity: .48; }
        .word-save.saved { border-color: #376b57; background: #244b3d; }
        .word-close {
          border: 0;
          padding: 2px 6px;
          background: transparent;
          color: #c6ccd7;
          font-size: 18px;
          cursor: pointer;
        }
        .word-section { margin-top: 11px; }
        .word-section[hidden] { display: none; }
        .word-label {
          color: #9ca6b8;
          font-size: 10px;
          font-weight: 750;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .word-definition,
        .word-example-de,
        .word-example-en,
        .word-list,
        .word-grammar {
          margin: 3px 0 0;
          color: #dce1ea;
          font-size: 13px;
          line-height: 1.45;
          text-shadow: none;
        }
        .word-definition { white-space: pre-line; }
        .word-definition-en { color: #b8c0ce; font-size: 12px; }
        .word-example-card {
          margin-top: 6px;
          padding: 7px 9px;
          border-left: 3px solid #6e55e6;
          border-radius: 5px;
          background: rgba(255,255,255,.04);
        }
        .word-example-de { margin: 0; color: #f3f4f7; font-style: italic; }
        .word-example-en { margin-top: 3px; color: #b8c0ce; font-size: 12px; }
        .word-list { margin: 4px 0 0; padding-left: 18px; }
        .word-list li + li { margin-top: 3px; }
        .word-grammar { display: grid; grid-template-columns: auto 1fr; gap: 3px 9px; }
        .word-grammar dt { color: #9ca6b8; font-size: 11px; font-weight: 700; }
        .word-grammar dd { margin: 0; }
        .word-note { margin-top: 9px; color: #858fa1; font-size: 10px; }
        .word-sources { display: flex; gap: 12px; margin-top: 10px; }
        .word-source { color: #a998ff; font-size: 11px; }
        @media (prefers-reduced-motion: reduce) {
          .wrap { transition: none; }
        }
      </style>
      <div class="wrap">
        <div class="status">Starting…</div>
        <div class="caption-box" role="group" aria-label="Interactive captions" hidden>
          <button class="caption-drag-handle" type="button" aria-label="Drag captions" title="Drag captions">&#8942;</button>
          <div class="transcript" aria-live="polite" aria-atomic="true"></div>
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
              <a class="word-action secondary word-youglish" target="_blank" rel="noopener noreferrer">YouGlish</a>
              <button class="word-action word-save" type="button">Save word</button>
              <button class="word-close" type="button" aria-label="Close definition">×</button>
            </div>
          </div>
          <div class="word-section">
            <div class="word-label">Meaning</div>
            <div class="word-definition word-definition-de"></div>
            <div class="word-definition word-definition-en"></div>
          </div>
          <div class="word-section word-examples-section">
            <div class="word-label">Examples</div>
            <div class="word-examples"></div>
          </div>
          <div class="word-section word-collocations-section" hidden>
            <div class="word-label">Common combinations</div>
            <div class="word-collocations"></div>
          </div>
          <div class="word-section word-grammar-section" hidden>
            <div class="word-label">Grammar</div>
            <dl class="word-grammar"></dl>
          </div>
          <div class="word-section word-related-section" hidden>
            <div class="word-label">Related words</div>
            <div class="word-related"></div>
          </div>
          <div class="word-note">Source-based dictionary information; no AI-generated advice.</div>
          <div class="word-sources">
            <a class="word-source word-source-de" target="_blank" rel="noopener noreferrer">German Wiktionary</a>
            <a class="word-source word-source-en" target="_blank" rel="noopener noreferrer">English Wiktionary</a>
          </div>
        </div>
      </div>`;

    wrapElement = shadow.querySelector(".wrap");
    captionBoxElement = shadow.querySelector(".caption-box");
    captionDragHandleElement = shadow.querySelector(".caption-drag-handle");
    transcriptElement = shadow.querySelector(".transcript");
    translationElement = shadow.querySelector(".translation");
    statusElement = shadow.querySelector(".status");
    wordCardElement = shadow.querySelector(".word-card");
    wordTitleElement = shadow.querySelector(".word-title");
    wordMetaElement = shadow.querySelector(".word-meta");
    wordEnglishDefinitionElement = shadow.querySelector(".word-definition-en");
    wordGermanDefinitionElement = shadow.querySelector(".word-definition-de");
    wordExamplesElement = shadow.querySelector(".word-examples");
    wordCollocationsElement = shadow.querySelector(".word-collocations");
    wordGrammarElement = shadow.querySelector(".word-grammar");
    wordRelatedElement = shadow.querySelector(".word-related");
    wordSaveElement = shadow.querySelector(".word-save");
    wordReplayElement = shadow.querySelector(".word-replay");
    wordYouglishElement = shadow.querySelector(".word-youglish");
    wordGermanSourceElement = shadow.querySelector(".word-source-de");
    wordEnglishSourceElement = shadow.querySelector(".word-source-en");
    shadow.querySelector(".word-close").addEventListener("click", closeWordCard);
    wordSaveElement.addEventListener("click", toggleSavedWord);
    wordReplayElement.addEventListener("click", replaySelectedWord);
    captionDragHandleElement.addEventListener("pointerdown", startCaptionDrag);
    transcriptElement.addEventListener("click", handleTranscriptClick);
    transcriptElement.addEventListener("keydown", handleTranscriptKeydown);
    captionBoxElement.addEventListener("pointerdown", stopPlayerClick);
    captionBoxElement.addEventListener("copy", stopPlayerClick);
    captionBoxElement.addEventListener("dblclick", stopPlayerClick);
    captionBoxElement.addEventListener("click", stopPlayerClick);
    wordCardElement.addEventListener("pointerdown", stopPlayerClick);
    wordCardElement.addEventListener("click", (event) => event.stopPropagation());
    applyDisplaySettings(session.captionPreferences, session.translationPreferences);
    placeOverlay();
  }

  function applyDisplaySettings(
    rawCaptionPreferences,
    rawTranslationPreferences,
    resetTranslationCache = false
  ) {
    if (!session) return;
    const previousTranslation = JSON.stringify(session.translationPreferences || {});
    session.captionPreferences = learning.normalizeCaptionPreferences(rawCaptionPreferences);
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
      .filter((group) => time >= group.start - 0.15 && time <= group.end + 0.8)
      .at(-1);
    const recent = [...displayGroups]
      .reverse()
      .find((group) => group.end <= time && time - group.end < 2.2);
    const freshCommit = !session.replay
      && session.lastCommitted
      && performance.now() - session.lastCommitted.receivedAt < 3_500
      ? session.lastCommitted.text
      : "";
    const text = active?.text || freshCommit || recent?.text || "";
    const timingGroup = active || (freshCommit ? null : recent);
    renderClickableText(text, timingGroup?.words || []);
    void renderTranslation(text);
    if (session.replay) {
      renderStatus("Cached transcript replay — audio is not being transcribed again.");
    }
  }

  function isDisplayReady(segment) {
    return segment?.complete !== false;
  }

  function renderClickableText(text, wordTimings = []) {
    captionBoxElement.hidden = !text;
    const timingKey = `${text}|${wordTimings.length}|${wordTimings[0]?.start ?? ""}`;
    if (session.displayedTimingKey === timingKey) return;
    session.displayedText = text;
    session.displayedTimingKey = timingKey;
    transcriptElement.classList.toggle("long", text.length > 110);
    const tokens = text.match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*|\s+|[^\s]/gu) || [];
    const fragment = document.createDocumentFragment();
    let wordIndex = 0;
    for (const token of tokens) {
      if (/^[\p{L}\p{M}]/u.test(token)) {
        const wordElement = document.createElement("span");
        wordElement.className = "word";
        wordElement.dataset.word = token;
        wordElement.tabIndex = 0;
        wordElement.setAttribute("role", "button");
        wordElement.setAttribute("aria-label", `Look up ${token}`);
        const timing = wordTimings[wordIndex++];
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
      session?.translationPending.delete(requestKey);
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
    transcriptElement.querySelector(".word.selected")?.classList.remove("selected");
    wordButton.classList.add("selected");
    session.selectedWord = word;
    session.selectedWordResult = null;
    const start = Number(wordButton.dataset.start);
    const end = Number(wordButton.dataset.end);
    session.selectedWordClip = Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? { start, end, timing: wordButton.dataset.timing || "estimated" }
      : null;
    wordCardElement.hidden = false;
    requestAnimationFrame(positionWordCard);
    wordTitleElement.textContent = word;
    wordMetaElement.textContent = "German dictionary entry";
    wordEnglishDefinitionElement.textContent = "Loading…";
    wordGermanDefinitionElement.textContent = "Loading…";
    renderWordExamples([], session.displayedText, session.displayedTranslation);
    renderWordList(wordCollocationsElement, []);
    renderWordGrammar(null);
    renderWordList(wordRelatedElement, []);
    wordGermanSourceElement.href = `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    wordEnglishSourceElement.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    wordYouglishElement.href = `https://de.youglish.com/pronounce/${encodeURIComponent(word)}/german`;
    wordReplayElement.disabled = !session.selectedWordClip;
    wordReplayElement.title = session.selectedWordClip?.timing === "word-timestamps"
      ? "Replay this word using exact word timestamps"
      : "Replay an estimated word interval from this caption";
    renderSaveState(false, true);

    try {
      const result = await chrome.runtime.sendMessage({ type: "LOOKUP_WORD", word });
      if (!session || session.selectedWord !== word) return;
      if (!result?.ok) throw new Error(result?.error || "Definition lookup failed.");
      session.selectedWordResult = result;
      wordTitleElement.textContent = result.title || word;
      wordMetaElement.textContent = [result.wordType, result.pronunciation, ...(result.domains || [])]
        .filter(Boolean)
        .join(" · ") || "German dictionary entry";
      wordEnglishDefinitionElement.textContent = result.englishDefinition
        ? `English: ${result.englishDefinition}`
        : "English: No short translation was found for this word form.";
      wordGermanDefinitionElement.textContent = (result.germanDefinitions || []).length
        ? result.germanDefinitions.map((definition, index) => `${index + 1}. ${definition}`).join("\n")
        : result.germanDefinition || "Keine kurze deutsche Bedeutung wurde gefunden.";
      renderWordExamples(result.examples || [], session.displayedText, session.displayedTranslation);
      renderWordList(wordCollocationsElement, result.collocations || []);
      renderWordGrammar(result.grammar);
      renderWordList(wordRelatedElement, result.synonyms || []);
      wordGermanSourceElement.href = result.germanSourceUrl;
      wordEnglishSourceElement.href = result.englishSourceUrl;
      renderSaveState(Boolean(result.saved), false);
      requestAnimationFrame(positionWordCard);
    } catch (error) {
      if (!session || session.selectedWord !== word) return;
      wordEnglishDefinitionElement.textContent = error.message;
      wordGermanDefinitionElement.textContent = "Definition lookup failed.";
      renderSaveState(false, true);
      requestAnimationFrame(positionWordCard);
    }
  }

  function renderWordExamples(sourceExamples, context, contextTranslation) {
    const examples = [];
    if (context) examples.push({ german: context, english: contextTranslation || null });
    for (const example of sourceExamples || []) {
      if (!example?.german || examples.some((item) => item.german === example.german)) continue;
      examples.push(example);
      if (examples.length >= 4) break;
    }
    const fragment = document.createDocumentFragment();
    for (const example of examples) {
      const card = document.createElement("div");
      card.className = "word-example-card";
      const german = document.createElement("div");
      german.className = "word-example-de";
      german.textContent = `„${example.german}“`;
      card.append(german);
      if (example.english) {
        const english = document.createElement("div");
        english.className = "word-example-en";
        english.textContent = example.english;
        card.append(english);
      }
      fragment.append(card);
    }
    wordExamplesElement.replaceChildren(fragment);
    wordExamplesElement.parentElement.hidden = examples.length === 0;
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

  function renderWordGrammar(grammar) {
    const rows = [
      ["Artikel", grammar?.article],
      ["Singular", grammar?.singular],
      ["Plural", grammar?.plural],
      ["Präteritum", grammar?.preterite],
      ["Partizip II", grammar?.participle],
      ["Perfekt", grammar?.perfect],
      ["Trennbar", grammar?.separable ? "ja" : null]
    ].filter(([, value]) => value);
    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      term.textContent = label;
      const definition = document.createElement("dd");
      definition.textContent = value;
      fragment.append(term, definition);
    }
    wordGrammarElement.replaceChildren(fragment);
    wordGrammarElement.parentElement.hidden = rows.length === 0;
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
      if (wordReplay === state) wordReplay = null;
    }, 450);
  }

  async function toggleSavedWord(event) {
    event.stopPropagation();
    const result = session?.selectedWordResult;
    if (!result) return;
    wordSaveElement.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage(result.saved
        ? { type: "REMOVE_SAVED_WORD", word: result.word }
        : {
            type: "SAVE_WORD",
            entry: {
              ...result,
              context: session.displayedText,
              contextTranslation: session.displayedTranslation,
              clip: session.selectedWordClip
            }
          });
      if (!response?.ok) throw new Error(response?.error || "Could not update saved words.");
      result.saved = !result.saved;
      renderSaveState(result.saved, false);
    } catch (error) {
      renderStatus(error.message, true);
    } finally {
      wordSaveElement.disabled = false;
    }
  }

  function renderSaveState(saved, disabled) {
    wordSaveElement.disabled = disabled;
    wordSaveElement.classList.toggle("saved", saved);
    wordSaveElement.textContent = saved ? "Saved ✓" : "Save word";
  }

  function closeWordCard(event) {
    event?.stopPropagation();
    restoreWordReplay(true);
    if (session) session.selectedWord = null;
    if (session) session.selectedWordResult = null;
    if (session) session.selectedWordClip = null;
    transcriptElement?.querySelector(".word.selected")?.classList.remove("selected");
    if (wordCardElement) wordCardElement.hidden = true;
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
    statusElement.textContent = text;
    statusElement.classList.toggle("error", isError);
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
})();

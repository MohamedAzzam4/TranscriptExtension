(() => {
  if (globalThis.__dubTranscriptLabVersion === 8) return;
  globalThis.__dubTranscriptLabVersion = 8;

  const transcriptGroups = globalThis.DubTranscriptGroups;
  const learning = globalThis.DubTranscriptLearning;
  if (!transcriptGroups) throw new Error("Transcript grouping helpers were not loaded.");
  if (!learning) throw new Error("Learning feature helpers were not loaded.");

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
  let transcriptElement = null;
  let translationElement = null;
  let statusElement = null;
  let wordCardElement = null;
  let wordTitleElement = null;
  let wordEnglishDefinitionElement = null;
  let wordGermanDefinitionElement = null;
  let wordExampleElement = null;
  let wordExampleTranslationElement = null;
  let wordSaveElement = null;
  let wordGermanSourceElement = null;
  let wordEnglishSourceElement = null;
  let currentCaption = null;
  let captionDrag = null;
  let suppressTranscriptClick = false;
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
      selectedWord: null,
      selectedWordResult: null,
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
      displayedTranslation: ""
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
      void chrome.runtime.sendMessage({
        type: "MEDIA_CLOCK",
        currentTime: video.currentTime,
        playbackRate: video.playbackRate
      });
      renderTranscript();
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
    document.removeEventListener("fullscreenchange", placeOverlay);
    overlayHost?.remove();
    restorePlayerPosition();
    overlayHost = null;
    playerContainer = null;
    transcriptElement = null;
    statusElement = null;
    wordCardElement = null;
    wordTitleElement = null;
    wordEnglishDefinitionElement = null;
    wordGermanDefinitionElement = null;
    wordExampleElement = null;
    wordExampleTranslationElement = null;
    wordSaveElement = null;
    wordGermanSourceElement = null;
    wordEnglishSourceElement = null;
    removeCaptionDragListeners();
    captionDrag = null;
    suppressTranscriptClick = false;
    wrapElement = null;
    captionBoxElement = null;
    translationElement = null;
    session = null;
  }

  function addVideoListener(name, handler) {
    video.addEventListener(name, handler);
    listeners.push({ target: video, name, handler });
  }

  function sendMediaEvent(name) {
    if (!video || !session) return;
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
        .wrap {
          position: absolute;
          left: var(--caption-left, 50%);
          bottom: var(--caption-bottom, 11%);
          transform: translateX(-50%);
          width: min(880px, 88%);
          pointer-events: none;
          font-family: var(--caption-font-family, Inter, ui-sans-serif, system-ui, sans-serif);
          text-align: center;
        }
        .caption-box {
          box-sizing: border-box;
          display: inline-block;
          max-width: 100%;
          padding: 8px 13px;
          border-radius: 8px;
          background: var(--caption-background, rgba(5, 7, 12, .86));
          color: var(--caption-color, white);
          font-size: var(--caption-font-size, 31px);
          font-weight: 650;
          line-height: 1.25;
          text-shadow: var(--caption-text-shadow, 0 1px 2px black);
          box-shadow: 0 4px 20px rgba(0,0,0,.35);
          pointer-events: auto;
          user-select: text;
          cursor: grab;
          touch-action: none;
        }
        .caption-box.dragging { cursor: grabbing; user-select: none; }
        .caption-box[hidden] { display: none; }
        .transcript {
          max-height: 2.5em;
          overflow: hidden;
        }
        .transcript.long {
          max-height: 3.75em;
          font-size: .84em;
        }
        .translation {
          margin-top: 4px;
          color: inherit;
          font-size: .68em;
          font-weight: 500;
          line-height: 1.3;
          opacity: .92;
          text-shadow: inherit;
        }
        .translation[hidden] { display: none; }
        .translation.pending { opacity: .62; font-style: italic; }
        .translation.error { color: #ffc0c0; font-size: .48em; }
        .translation.long {
          max-height: 2.6em;
          overflow: hidden;
        }
        .word {
          appearance: none;
          border: 0;
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
          background: rgba(13, 16, 24, .96);
          color: #f5f7fb;
          box-shadow: 0 8px 32px rgba(0,0,0,.48);
          text-align: left;
          pointer-events: auto;
          overflow-y: auto;
        }
        .word-card[hidden] { display: none; }
        .word-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .word-title { font-size: 17px; font-weight: 750; }
        .word-card-actions { display: flex; align-items: center; gap: 6px; }
        .word-save {
          border: 1px solid #7560e8;
          border-radius: 6px;
          padding: 5px 8px;
          background: #5b43cf;
          color: white;
          font-size: 11px;
          cursor: pointer;
        }
        .word-save.saved { border-color: #376b57; background: #244b3d; }
        .word-close {
          border: 0;
          padding: 2px 6px;
          background: transparent;
          color: #c6ccd7;
          font-size: 18px;
          cursor: pointer;
        }
        .word-section { margin-top: 9px; }
        .word-label {
          color: #9ca6b8;
          font-size: 10px;
          font-weight: 750;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        .word-definition,
        .word-example,
        .word-example-translation {
          margin: 3px 0 0;
          color: #dce1ea;
          font-size: 13px;
          line-height: 1.45;
          text-shadow: none;
        }
        .word-example { color: #f3f4f7; font-style: italic; }
        .word-example-translation { color: #b8c0ce; font-size: 12px; }
        .word-sources { display: flex; gap: 12px; margin-top: 10px; }
        .word-source { color: #a998ff; font-size: 11px; }
      </style>
      <div class="wrap">
        <div class="status">Starting…</div>
        <div class="caption-box" hidden>
          <div class="transcript"></div>
          <div class="translation" hidden></div>
        </div>
        <div class="word-card" hidden>
          <div class="word-card-header">
            <div class="word-title"></div>
            <div class="word-card-actions">
              <button class="word-save" type="button">Save word</button>
              <button class="word-close" type="button" aria-label="Close definition">×</button>
            </div>
          </div>
          <div class="word-section">
            <div class="word-label">English definition</div>
            <div class="word-definition word-definition-en"></div>
          </div>
          <div class="word-section">
            <div class="word-label">German definition</div>
            <div class="word-definition word-definition-de"></div>
          </div>
          <div class="word-section word-example-section">
            <div class="word-label">Example</div>
            <div class="word-example"></div>
            <div class="word-example-translation"></div>
          </div>
          <div class="word-sources">
            <a class="word-source word-source-de" target="_blank" rel="noopener noreferrer">German Wiktionary</a>
            <a class="word-source word-source-en" target="_blank" rel="noopener noreferrer">English Wiktionary</a>
          </div>
        </div>
      </div>`;

    wrapElement = shadow.querySelector(".wrap");
    captionBoxElement = shadow.querySelector(".caption-box");
    transcriptElement = shadow.querySelector(".transcript");
    translationElement = shadow.querySelector(".translation");
    statusElement = shadow.querySelector(".status");
    wordCardElement = shadow.querySelector(".word-card");
    wordTitleElement = shadow.querySelector(".word-title");
    wordEnglishDefinitionElement = shadow.querySelector(".word-definition-en");
    wordGermanDefinitionElement = shadow.querySelector(".word-definition-de");
    wordExampleElement = shadow.querySelector(".word-example");
    wordExampleTranslationElement = shadow.querySelector(".word-example-translation");
    wordSaveElement = shadow.querySelector(".word-save");
    wordGermanSourceElement = shadow.querySelector(".word-source-de");
    wordEnglishSourceElement = shadow.querySelector(".word-source-en");
    shadow.querySelector(".word-close").addEventListener("click", closeWordCard);
    wordSaveElement.addEventListener("click", toggleSavedWord);
    captionBoxElement.addEventListener("pointerdown", startCaptionDrag);
    transcriptElement.addEventListener("click", handleTranscriptClick);
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
    wrapElement.style.setProperty("--caption-left", `${caption.horizontalPosition}%`);
    wrapElement.style.setProperty("--caption-bottom", `${caption.verticalPosition}%`);
    wrapElement.style.setProperty("--caption-font-size", `${caption.fontSize}px`);
    wrapElement.style.setProperty("--caption-font-family", learning.fontFamilyValue(caption.fontFamily));
    wrapElement.style.setProperty(
      "--caption-background",
      learning.rgbaFromHex(caption.backgroundColor, caption.backgroundOpacity)
    );
    wrapElement.style.setProperty(
      "--caption-color",
      learning.rgbaFromHex(caption.textColor, caption.textOpacity)
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
    const nextContainer = findPlayerContainer(video);
    if (!nextContainer) return;
    if (playerContainer !== nextContainer) {
      restorePlayerPosition();
      playerContainer = nextContainer;
      if (getComputedStyle(playerContainer).position === "static") {
        playerInlinePosition = playerContainer.style.position;
        playerContainer.style.position = "relative";
      }
    }
    if (overlayHost.parentNode !== playerContainer) playerContainer.append(overlayHost);
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
      Math.max(2, captionRect.width / 2 / playerRect.width * 100 + 1)
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
    wrapElement.style.setProperty(
      "--caption-bottom",
      `${session.captionPreferences.verticalPosition}%`
    );
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
    renderClickableText(text);
    void renderTranslation(text);
    if (session.replay) {
      renderStatus("Cached transcript replay — audio is not being transcribed again.");
    }
  }

  function isDisplayReady(segment) {
    return segment?.complete !== false;
  }

  function renderClickableText(text) {
    captionBoxElement.hidden = !text;
    if (session.displayedText === text) return;
    session.displayedText = text;
    transcriptElement.classList.toggle("long", text.length > 110);
    const tokens = text.match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*|\s+|[^\s]/gu) || [];
    const fragment = document.createDocumentFragment();
    for (const token of tokens) {
      if (/^[\p{L}\p{M}]/u.test(token)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "word";
        button.dataset.word = token;
        button.textContent = token;
        fragment.append(button);
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
    if (suppressTranscriptClick) {
      event.preventDefault();
      return;
    }
    const wordButton = event.target.closest(".word");
    if (!wordButton) return;
    event.preventDefault();
    void showWordDefinition(wordButton.dataset.word, wordButton);
  }

  async function showWordDefinition(word, wordButton) {
    transcriptElement.querySelector(".word.selected")?.classList.remove("selected");
    wordButton.classList.add("selected");
    session.selectedWord = word;
    session.selectedWordResult = null;
    wordCardElement.hidden = false;
    requestAnimationFrame(positionWordCard);
    wordTitleElement.textContent = word;
    wordEnglishDefinitionElement.textContent = "Loading…";
    wordGermanDefinitionElement.textContent = "Loading…";
    wordExampleElement.textContent = session.displayedText || "";
    wordExampleTranslationElement.textContent = session.displayedTranslation || "";
    wordGermanSourceElement.href = `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    wordEnglishSourceElement.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    renderSaveState(false, true);

    try {
      const result = await chrome.runtime.sendMessage({ type: "LOOKUP_WORD", word });
      if (!session || session.selectedWord !== word) return;
      if (!result?.ok) throw new Error(result?.error || "Definition lookup failed.");
      session.selectedWordResult = result;
      wordTitleElement.textContent = result.title || word;
      wordEnglishDefinitionElement.textContent = result.englishDefinition
        || "No short English definition was found for this word form.";
      wordGermanDefinitionElement.textContent = result.germanDefinition
        || "No short German definition was found for this word form.";
      wordExampleElement.textContent = result.example || session.displayedText || "";
      wordExampleTranslationElement.textContent = result.exampleTranslation
        || session.displayedTranslation
        || "";
      wordExampleElement.parentElement.hidden = !wordExampleElement.textContent
        && !wordExampleTranslationElement.textContent;
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
              contextTranslation: session.displayedTranslation
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
    if (session) session.selectedWord = null;
    if (session) session.selectedWordResult = null;
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

  function findPlayerContainer(element) {
    return element.closest(
      "#movie_player, .html5-video-player, [data-uia='video-canvas'], [class*='video-player'], [class*='videoPlayer'], [class*='player-container']"
    ) || element.parentElement;
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
      currentSrc,
      sourceKind: currentSrc.startsWith("blob:") ? "blob" : "direct",
      batchCandidates: mediaBatchCandidates(element, currentSrc),
      drmProtected: Boolean(element.mediaKeys || security.encrypted),
      userAgent: navigator.userAgent
    };
  }

  function mediaBatchCandidates(element, currentSrc) {
    const sourceUrls = [...element.querySelectorAll("source[src]")]
      .map((source) => source.src);
    const resourceUrls = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /(?:\.m3u8|\.mpd|\.mp4|\.m4a|\.webm|videoplayback|manifest|playlist)/i.test(url))
      .slice(-20)
      .reverse();
    return [...new Set([currentSrc, ...sourceUrls, ...resourceUrls])]
      .filter((url) => /^https?:\/\//i.test(url))
      .slice(0, 20);
  }
})();

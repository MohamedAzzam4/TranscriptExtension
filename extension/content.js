(() => {
  if (globalThis.__dubTranscriptLabVersion === 6) return;
  globalThis.__dubTranscriptLabVersion = 6;

  const transcriptGroups = globalThis.DubTranscriptGroups;
  if (!transcriptGroups) throw new Error("Transcript grouping helpers were not loaded.");

  let video = null;
  let session = null;
  let clockTimer = null;
  let captionTimer = null;
  let seekTimer = null;
  let overlayHost = null;
  let playerContainer = null;
  let playerInlinePosition = null;
  let transcriptElement = null;
  let statusElement = null;
  let wordCardElement = null;
  let wordTitleElement = null;
  let wordDefinitionElement = null;
  let wordSourceElement = null;
  let currentCaption = null;
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
      remainingTimeTranscription: null,
      processingLag: null,
      stabilizationDelay: null,
      processingWarning: false,
      lastCommitted: null
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
    wordDefinitionElement = null;
    wordSourceElement = null;
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
          left: 50%;
          bottom: max(11%, 56px);
          transform: translateX(-50%);
          width: min(880px, 88%);
          pointer-events: none;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
          text-align: center;
        }
        .transcript {
          display: inline-block;
          max-width: 100%;
          max-height: 2.5em;
          overflow: hidden;
          padding: 8px 13px;
          border-radius: 8px;
          background: rgba(5, 7, 12, .86);
          color: white;
          font-size: clamp(18px, 2.2vw, 31px);
          font-weight: 650;
          line-height: 1.25;
          text-shadow: 0 1px 2px black;
          box-shadow: 0 4px 20px rgba(0,0,0,.35);
          pointer-events: auto;
          user-select: text;
        }
        .transcript:empty { display: none; }
        .transcript.long {
          max-height: 3.75em;
          font-size: clamp(16px, 1.8vw, 26px);
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
          box-sizing: border-box;
          width: min(520px, 92%);
          margin: 8px auto 0;
          padding: 11px 13px;
          border: 1px solid rgba(255,255,255,.18);
          border-radius: 10px;
          background: rgba(13, 16, 24, .96);
          color: #f5f7fb;
          box-shadow: 0 8px 32px rgba(0,0,0,.48);
          text-align: left;
          pointer-events: auto;
        }
        .word-card[hidden] { display: none; }
        .word-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .word-title { font-size: 17px; font-weight: 750; }
        .word-close {
          border: 0;
          padding: 2px 6px;
          background: transparent;
          color: #c6ccd7;
          font-size: 18px;
          cursor: pointer;
        }
        .word-definition {
          margin: 7px 0;
          color: #dce1ea;
          font-size: 13px;
          line-height: 1.45;
          text-shadow: none;
        }
        .word-source { color: #a998ff; font-size: 12px; }
      </style>
      <div class="wrap">
        <div class="status">Starting…</div>
        <div class="transcript"></div>
        <div class="word-card" hidden>
          <div class="word-card-header">
            <div class="word-title"></div>
            <button class="word-close" type="button" aria-label="Close definition">×</button>
          </div>
          <div class="word-definition"></div>
          <a class="word-source" target="_blank" rel="noopener noreferrer">Open German Wiktionary</a>
        </div>
      </div>`;

    transcriptElement = shadow.querySelector(".transcript");
    statusElement = shadow.querySelector(".status");
    wordCardElement = shadow.querySelector(".word-card");
    wordTitleElement = shadow.querySelector(".word-title");
    wordDefinitionElement = shadow.querySelector(".word-definition");
    wordSourceElement = shadow.querySelector(".word-source");
    shadow.querySelector(".word-close").addEventListener("click", closeWordCard);
    transcriptElement.addEventListener("pointerdown", stopPlayerClick);
    transcriptElement.addEventListener("click", handleTranscriptClick);
    wordCardElement.addEventListener("pointerdown", stopPlayerClick);
    wordCardElement.addEventListener("click", (event) => event.stopPropagation());
    placeOverlay();
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
    renderClickableText(active?.text || freshCommit || recent?.text || "");
    if (session.replay) {
      renderStatus("Cached transcript replay — audio is not being transcribed again.");
    }
  }

  function isDisplayReady(segment) {
    return segment?.complete !== false;
  }

  function renderClickableText(text) {
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

  function handleTranscriptClick(event) {
    event.stopPropagation();
    const wordButton = event.target.closest(".word");
    if (!wordButton) return;
    event.preventDefault();
    void showWordDefinition(wordButton.dataset.word, wordButton);
  }

  async function showWordDefinition(word, wordButton) {
    transcriptElement.querySelector(".word.selected")?.classList.remove("selected");
    wordButton.classList.add("selected");
    session.selectedWord = word;
    wordCardElement.hidden = false;
    wordTitleElement.textContent = word;
    wordDefinitionElement.textContent = "Loading definition…";
    wordSourceElement.href = `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`;

    try {
      const result = await chrome.runtime.sendMessage({ type: "LOOKUP_WORD", word });
      if (!session || session.selectedWord !== word) return;
      if (!result?.ok) throw new Error(result?.error || "Definition lookup failed.");
      wordTitleElement.textContent = result.title || word;
      wordDefinitionElement.textContent = result.definition
        || "No short German Wiktionary definition was found for this word form.";
      wordSourceElement.href = result.sourceUrl;
    } catch (error) {
      if (!session || session.selectedWord !== word) return;
      wordDefinitionElement.textContent = error.message;
    }
  }

  function closeWordCard(event) {
    event?.stopPropagation();
    if (session) session.selectedWord = null;
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

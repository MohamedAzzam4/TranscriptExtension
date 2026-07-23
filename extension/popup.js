const learning = globalThis.DubTranscriptLearning;
const elements = {
  serverUrl: document.querySelector("#serverUrl"),
  audioLanguage: document.querySelector("#audioLanguage"),
  captionLanguage: document.querySelector("#captionLanguage"),
  collectCaptions: document.querySelector("#collectCaptions"),
  translationEnabled: document.querySelector("#translationEnabled"),
  translationLanguage: document.querySelector("#translationLanguage"),
  translationProvider: document.querySelector("#translationProvider"),
  googleTranslateApiKey: document.querySelector("#googleTranslateApiKey"),
  translationAvailability: document.querySelector("#translationAvailability"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  horizontalPosition: document.querySelector("#horizontalPosition"),
  horizontalPositionValue: document.querySelector("#horizontalPositionValue"),
  verticalPosition: document.querySelector("#verticalPosition"),
  verticalPositionValue: document.querySelector("#verticalPositionValue"),
  backgroundOpacity: document.querySelector("#backgroundOpacity"),
  backgroundOpacityValue: document.querySelector("#backgroundOpacityValue"),
  textOpacity: document.querySelector("#textOpacity"),
  textOpacityValue: document.querySelector("#textOpacityValue"),
  fontFamily: document.querySelector("#fontFamily"),
  transcriptBold: document.querySelector("#transcriptBold"),
  edgeStyle: document.querySelector("#edgeStyle"),
  textColor: document.querySelector("#textColor"),
  translationFontSize: document.querySelector("#translationFontSize"),
  translationFontSizeValue: document.querySelector("#translationFontSizeValue"),
  translationTextOpacity: document.querySelector("#translationTextOpacity"),
  translationTextOpacityValue: document.querySelector("#translationTextOpacityValue"),
  translationFontFamily: document.querySelector("#translationFontFamily"),
  translationTextColor: document.querySelector("#translationTextColor"),
  translationBold: document.querySelector("#translationBold"),
  backgroundColor: document.querySelector("#backgroundColor"),
  syncEarlier: document.querySelector("#syncEarlier"),
  syncLater: document.querySelector("#syncLater"),
  syncOffset: document.querySelector("#syncOffset"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  diagnosticPanel: document.querySelector("#diagnosticPanel"),
  diagnosticBadge: document.querySelector("#diagnosticBadge"),
  diagnosticStage: document.querySelector("#diagnosticStage"),
  diagnosticMessage: document.querySelector("#diagnosticMessage"),
  diagnosticAction: document.querySelector("#diagnosticAction"),
  diagnosticDetails: document.querySelector("#diagnosticDetails"),
  downloadTranscript: document.querySelector("#downloadTranscript"),
  export: document.querySelector("#export"),
  savedTranscripts: document.querySelector("#savedTranscripts"),
  savedTranscriptCount: document.querySelector("#savedTranscriptCount"),
  savedWords: document.querySelector("#savedWords"),
  savedWordCount: document.querySelector("#savedWordCount"),
  status: document.querySelector("#status")
};

const SETTINGS_KEY = "experimentSettings";
const TRANSLATION_SECRETS_KEY = "translationSecrets";
let currentSyncOffset = 0;
let displayUpdateTimer = null;
let resetTranslationCache = false;

void restoreState();
const diagnosticRefreshTimer = setInterval(() => void refreshDiagnostics(), 1_200);
window.addEventListener("unload", () => clearInterval(diagnosticRefreshTimer), { once: true });

elements.syncEarlier.addEventListener("click", () => void adjustSyncOffset(-0.1));
elements.syncLater.addEventListener("click", () => void adjustSyncOffset(0.1));

for (const element of [
  elements.translationEnabled,
  elements.translationLanguage,
  elements.translationProvider,
  elements.fontSize,
  elements.horizontalPosition,
  elements.verticalPosition,
  elements.backgroundOpacity,
  elements.textOpacity,
  elements.fontFamily,
  elements.transcriptBold,
  elements.edgeStyle,
  elements.textColor,
  elements.translationFontSize,
  elements.translationTextOpacity,
  elements.translationFontFamily,
  elements.translationTextColor,
  elements.translationBold,
  elements.backgroundColor
]) {
  element.addEventListener("input", scheduleDisplaySettingsUpdate);
  element.addEventListener("change", scheduleDisplaySettingsUpdate);
}
elements.googleTranslateApiKey.addEventListener("change", scheduleDisplaySettingsUpdate);

elements.start.addEventListener("click", async () => {
  setStatus("Checking whether the complete video can be analyzed locally…");
  elements.start.disabled = true;
  const settings = readSettings();
  await persistSettings(settings);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_EXPERIMENT",
      settings
    });
    if (!response?.ok) throw new Error(response?.error || "Could not start the experiment.");
    setStatus(response.mode === "batch"
      ? "Full-video analysis started. Playback will begin when the transcript is ready."
      : response.mode === "library"
        ? "Saved transcript restored. Playback started without transcribing again."
        : "Live transcription fallback is preparing automatically.");
    await refreshTranscriptLibrary();
    await refreshDiagnostics();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.start.disabled = false;
  }
});

elements.stop.addEventListener("click", async () => {
  setStatus("Stopping…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_EXPERIMENT" });
    if (!response?.ok) throw new Error(response?.error || "Could not stop the experiment.");
    setStatus("Stopped. The result is cached locally and ready to export.");
    await refreshTranscriptLibrary();
    await refreshDiagnostics();
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.downloadTranscript.addEventListener("click", async () => {
  setStatus("Preparing transcript text…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_LAST_TRANSCRIPT_TEXT" });
    if (!response?.ok) throw new Error(response?.error || "There is no transcript to download.");
    await downloadTextFile(response.text, response.filename);
    setStatus("Transcript downloaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.export.addEventListener("click", async () => {
  setStatus("Preparing export…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_LAST_EXPERIMENT" });
    if (!response?.ok) throw new Error(response?.error || "There is no experiment to export.");

    const blob = new Blob([JSON.stringify(response.experiment, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: response.filename,
      saveAs: true
    });
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus("Export created.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "EXPERIMENT_STATUS") {
    setStatus(message.error || message.status, Boolean(message.error));
    void refreshDiagnostics();
    if (/transcript ready|saved transcript|cached locally/i.test(message.status || "")) {
      void refreshTranscriptLibrary();
    }
  }
});

async function restoreState() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, TRANSLATION_SECRETS_KEY]);
  const settings = stored[SETTINGS_KEY] || {};
  const caption = learning.normalizeCaptionPreferences(settings.captionPreferences);
  const translation = learning.normalizeTranslationPreferences(settings.translationPreferences);

  elements.serverUrl.value = settings.serverUrl || elements.serverUrl.value;
  elements.audioLanguage.value = settings.audioLanguage || "de";
  elements.captionLanguage.value = settings.captionLanguage || "de";
  elements.collectCaptions.checked = settings.collectCaptions !== false;
  elements.translationEnabled.checked = translation.enabled;
  elements.translationLanguage.value = translation.targetLanguage;
  elements.translationProvider.value = translation.provider;
  elements.googleTranslateApiKey.value = stored[TRANSLATION_SECRETS_KEY]?.googleApiKey || "";
  elements.fontSize.value = caption.fontSize;
  elements.horizontalPosition.value = caption.horizontalPosition;
  elements.verticalPosition.value = caption.verticalPosition;
  elements.backgroundOpacity.value = caption.backgroundOpacity;
  elements.textOpacity.value = caption.textOpacity;
  elements.fontFamily.value = caption.fontFamily;
  elements.transcriptBold.checked = caption.bold;
  elements.edgeStyle.value = caption.edgeStyle;
  elements.textColor.value = caption.textColor.toLowerCase();
  elements.translationFontSize.value = translation.fontSize;
  elements.translationTextOpacity.value = translation.textOpacity;
  elements.translationFontFamily.value = translation.fontFamily;
  elements.translationTextColor.value = translation.textColor.toLowerCase();
  elements.translationBold.checked = translation.bold;
  elements.backgroundColor.value = caption.backgroundColor.toLowerCase();
  currentSyncOffset = normalizeSyncOffset(settings.syncOffset);
  renderControls();
  await refreshSavedWords();
  await refreshTranscriptLibrary();
  await refreshDiagnostics();
}

async function refreshDiagnostics() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_VISIBLE_DIAGNOSTICS" });
    if (!response?.ok) throw new Error(response?.error || "Diagnostics are unavailable.");
    renderDiagnostics(response.diagnostics || {});
  } catch (error) {
    renderDiagnostics({
      level: "error",
      stage: "Diagnostics unavailable",
      message: error.message,
      details: []
    });
  }
}

function renderDiagnostics(diagnostics) {
  const level = ["idle", "working", "success", "warning", "error"].includes(diagnostics.level)
    ? diagnostics.level
    : "idle";
  elements.diagnosticPanel.dataset.level = level;
  elements.diagnosticBadge.textContent = {
    idle: "Ready",
    working: "Working",
    success: "Complete",
    warning: "Fallback",
    error: "Failed"
  }[level];
  elements.diagnosticStage.textContent = diagnostics.stage || "Ready";
  elements.diagnosticMessage.textContent = diagnostics.message || "No diagnostic message.";
  elements.diagnosticAction.hidden = !diagnostics.action;
  elements.diagnosticAction.textContent = diagnostics.action || "";
  const fragment = document.createDocumentFragment();
  for (const detail of diagnostics.details || []) {
    if (!detail?.label || !detail?.value) continue;
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = detail.label;
    value.textContent = detail.value;
    row.append(term, value);
    fragment.append(row);
  }
  elements.diagnosticDetails.replaceChildren(fragment);
}

function readSettings() {
  return {
    serverUrl: elements.serverUrl.value.trim(),
    audioLanguage: elements.audioLanguage.value.trim() || "de",
    captionLanguage: elements.captionLanguage.value.trim() || "de",
    collectCaptions: elements.collectCaptions.checked,
    batchModel: "small",
    syncOffset: currentSyncOffset,
    captionPreferences: learning.normalizeCaptionPreferences({
      fontSize: elements.fontSize.value,
      horizontalPosition: elements.horizontalPosition.value,
      verticalPosition: elements.verticalPosition.value,
      backgroundOpacity: elements.backgroundOpacity.value,
      textOpacity: elements.textOpacity.value,
      fontFamily: elements.fontFamily.value,
      bold: elements.transcriptBold.checked,
      edgeStyle: elements.edgeStyle.value,
      textColor: elements.textColor.value,
      backgroundColor: elements.backgroundColor.value
    }),
    translationPreferences: learning.normalizeTranslationPreferences({
      enabled: elements.translationEnabled.checked,
      targetLanguage: elements.translationLanguage.value,
      provider: elements.translationProvider.value,
      fontSize: elements.translationFontSize.value,
      textOpacity: elements.translationTextOpacity.value,
      fontFamily: elements.translationFontFamily.value,
      textColor: elements.translationTextColor.value,
      bold: elements.translationBold.checked
    })
  };
}

async function persistSettings(settings = readSettings()) {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: settings,
    [TRANSLATION_SECRETS_KEY]: {
      googleApiKey: elements.googleTranslateApiKey.value.trim()
    }
  });
}

function scheduleDisplaySettingsUpdate(event) {
  if ([
    elements.translationEnabled,
    elements.translationLanguage,
    elements.translationProvider,
    elements.googleTranslateApiKey
  ].includes(event?.currentTarget)) {
    resetTranslationCache = true;
  }
  renderControls();
  clearTimeout(displayUpdateTimer);
  displayUpdateTimer = setTimeout(() => void applyDisplaySettings(), 160);
}

async function applyDisplaySettings() {
  const settings = readSettings();
  await persistSettings(settings);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_DISPLAY_SETTINGS",
      captionPreferences: settings.captionPreferences,
      translationPreferences: settings.translationPreferences,
      resetTranslationCache
    });
    if (!response?.ok) throw new Error(response?.error || "Could not update caption settings.");
    resetTranslationCache = false;
    setStatus("Caption settings updated.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function adjustSyncOffset(delta) {
  currentSyncOffset = normalizeSyncOffset(currentSyncOffset + delta);
  renderSyncOffset();
  await persistSettings();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SET_SYNC_OFFSET",
      offset: currentSyncOffset
    });
    if (!response?.ok) throw new Error(response?.error || "Could not adjust caption timing.");
    currentSyncOffset = normalizeSyncOffset(response.syncOffset);
    renderSyncOffset();
    setStatus(currentSyncOffset === 0
      ? "Caption timing reset."
      : `Captions shifted ${Math.abs(currentSyncOffset).toFixed(1)}s ${currentSyncOffset < 0 ? "earlier" : "later"}.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshSavedWords() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SAVED_WORDS" });
    if (!response?.ok) throw new Error(response?.error || "Could not load saved words.");
    renderSavedWords(response.entries || []);
  } catch (error) {
    elements.savedWords.replaceChildren(createTextElement("p", error.message, "empty-saved"));
  }
}

async function refreshTranscriptLibrary() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_TRANSCRIPT_LIBRARY" });
    if (!response?.ok) throw new Error(response?.error || "Could not load saved transcripts.");
    renderTranscriptLibrary(response.entries || []);
  } catch (error) {
    elements.savedTranscripts.replaceChildren(createTextElement("p", error.message, "empty-saved"));
  }
}

function renderTranscriptLibrary(entries) {
  elements.savedTranscriptCount.textContent = String(entries.length);
  if (!entries.length) {
    elements.savedTranscripts.replaceChildren(createTextElement(
      "p",
      "No complete transcript has been saved yet.",
      "empty-saved"
    ));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "saved-word transcript-library-row";
    const body = document.createElement("div");
    body.append(
      createTextElement("div", entry.title || "Untitled video", "saved-word-title"),
      createTextElement(
        "div",
        `${entry.audioLanguage || "?"} · ${entry.segmentCount || 0} segments`,
        "saved-word-definition"
      )
    );
    const actions = document.createElement("div");
    actions.className = "library-actions";
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "TXT";
    download.addEventListener("click", async () => {
      download.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "EXPORT_LIBRARY_TRANSCRIPT_TEXT",
          key: entry.key
        });
        if (!response?.ok) throw new Error(response?.error || "Could not export transcript.");
        await downloadTextFile(response.text, response.filename);
        setStatus("Transcript downloaded.");
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        download.disabled = false;
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_TRANSCRIPT_LIBRARY_ENTRY",
        key: entry.key
      });
      if (!response?.ok) {
        setStatus(response?.error || "Could not remove saved transcript.", true);
        remove.disabled = false;
        return;
      }
      await refreshTranscriptLibrary();
    });
    actions.append(download, remove);
    row.append(body, actions);
    fragment.append(row);
  }
  elements.savedTranscripts.replaceChildren(fragment);
}

async function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function renderSavedWords(entries) {
  elements.savedWordCount.textContent = String(entries.length);
  if (!entries.length) {
    elements.savedWords.replaceChildren(createTextElement(
      "p",
      "Click a transcript word and choose “Save word”.",
      "empty-saved"
    ));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "saved-word";
    const body = document.createElement("div");
    body.append(
      createTextElement("div", entry.word, "saved-word-title"),
      createTextElement(
        "div",
        entry.englishDefinition || entry.germanDefinition || entry.context || "Saved word",
        "saved-word-definition"
      )
    );
    const example = entry.context || entry.examples?.[0]?.german;
    if (example) body.append(createTextElement("div", `„${example}“`, "saved-word-context"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: "REMOVE_SAVED_WORD",
        word: entry.word
      });
      if (!response?.ok) {
        setStatus(response?.error || "Could not remove saved word.", true);
        remove.disabled = false;
        return;
      }
      await refreshSavedWords();
    });
    row.append(body, remove);
    fragment.append(row);
  }
  elements.savedWords.replaceChildren(fragment);
}

function createTextElement(tag, text, className) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function normalizeSyncOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(Math.max(-3, Math.min(3, number)) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function renderControls() {
  renderSyncOffset();
  elements.fontSizeValue.textContent = `${Number(elements.fontSize.value)} px`;
  elements.horizontalPositionValue.textContent = `${Number(elements.horizontalPosition.value)}%`;
  elements.verticalPositionValue.textContent = `${Number(elements.verticalPosition.value)}%`;
  elements.backgroundOpacityValue.textContent = `${Number(elements.backgroundOpacity.value)}%`;
  elements.textOpacityValue.textContent = `${Number(elements.textOpacity.value)}%`;
  elements.translationFontSizeValue.textContent = `${Number(elements.translationFontSize.value)} px`;
  elements.translationTextOpacityValue.textContent = `${Number(elements.translationTextOpacity.value)}%`;
  const browserTranslatorAvailable = "Translator" in globalThis;
  elements.translationAvailability.textContent = browserTranslatorAvailable
    ? "On-device translation is detected. Automatic mode uses it before Google Cloud."
    : "On-device translation is not detected in this browser. Automatic mode needs the optional Google Cloud key.";
}

function renderSyncOffset() {
  const sign = currentSyncOffset > 0 ? "+" : "";
  elements.syncOffset.textContent = `${sign}${currentSyncOffset.toFixed(1)} s`;
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", isError);
}

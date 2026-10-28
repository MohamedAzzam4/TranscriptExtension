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
  translationReadinessStatus: document.querySelector("#translationReadinessStatus"),
  setupTranslation: document.querySelector("#setupTranslation"),
  retryTranslationReadiness: document.querySelector("#retryTranslationReadiness"),
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
  resetAppearance: document.querySelector("#resetAppearance"),
  fontSizeDecrease: document.querySelector("#fontSizeDecrease"),
  fontSizeIncrease: document.querySelector("#fontSizeIncrease"),
  translationFontSizeDecrease: document.querySelector("#translationFontSizeDecrease"),
  translationFontSizeIncrease: document.querySelector("#translationFontSizeIncrease"),
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
  netflixResearchPanel: document.querySelector("#netflixResearchPanel"),
  netflixResearchCount: document.querySelector("#netflixResearchCount"),
  analyzeNetflixTitle: document.querySelector("#analyzeNetflixTitle"),
  attachNetflixSample: document.querySelector("#attachNetflixSample"),
  exportNetflixResearch: document.querySelector("#exportNetflixResearch"),
  exportNetflixDataset: document.querySelector("#exportNetflixDataset"),
  netflixResearchStatus: document.querySelector("#netflixResearchStatus"),
  netflixResearchDetails: document.querySelector("#netflixResearchDetails"),
  downloadTranscript: document.querySelector("#downloadTranscript"),
  export: document.querySelector("#export"),
  savedTranscripts: document.querySelector("#savedTranscripts"),
  savedTranscriptCount: document.querySelector("#savedTranscriptCount"),
  savedWords: document.querySelector("#savedWords"),
  savedWordCount: document.querySelector("#savedWordCount"),
  savedWordList: document.querySelector("#savedWordList"),
  savedWordDetail: document.querySelector("#savedWordDetail"),
  savedWordDetailTitle: document.querySelector("#savedWordDetailTitle"),
  backToWords: document.querySelector("#backToWords"),
  wordSearch: document.querySelector("#wordSearch"),
  wordResults: document.querySelector("#wordResults"),
  recentWords: document.querySelector("#recentWords"),
  connectionState: document.querySelector("#connectionState"),
  sessionTitle: document.querySelector("#sessionTitle"),
  activePlatform: document.querySelector("#activePlatform"),
  activeVideoDescription: document.querySelector("#activeVideoDescription"),
  previewTranscript: document.querySelector("#previewTranscript"),
  previewTranslation: document.querySelector("#previewTranslation"),
  previewCaption: document.querySelector("#previewCaption"),
  status: document.querySelector("#status")
};

const SETTINGS_KEY = "experimentSettings";
const TRANSLATION_SECRETS_KEY = "translationSecrets";
const UI_STATE_KEY = "popupUiState:v1";
let currentSyncOffset = 0;
let displayUpdateTimer = null;
let resetTranslationCache = false;
let savedVocabularyEntries = [];
let wordFilter = "all";
let previewLanguageKey = "";
let previewTranslationRevision = 0;
let previewConfigurationPending = false;
let popupUiState = { activeView: "home", scrollByView: {}, scrollAnchorByView: {}, expanded: {}, wordSearch: "", wordFilter: "all" };
let uiStateSaveTimer = null;
let uiStateHydrating = true;
const readinessManager = globalThis.DubTranslationReadiness?.createManager();
let readinessRevision = 0;
let reviewedWord = null;

async function refreshTranslationReadiness() {
  if (!elements.translationReadinessStatus) return;
  const revision = ++readinessRevision;
  const pair = { sourceLanguage: elements.audioLanguage.value, targetLanguage: elements.translationLanguage.value };
  elements.translationReadinessStatus.textContent = 'Checking translation…';
  elements.translationReadinessStatus.dataset.state = 'checking';
  elements.setupTranslation.hidden = true;
  elements.retryTranslationReadiness.hidden = true;
  try {
    if (!readinessManager) throw new Error('Translation readiness helper did not load. Reload the extension.');
    const result = await readinessManager.check(pair);
    if (revision !== readinessRevision) return;
    const state = result.availability === 'downloading' ? 'preparing' : result.state;
    elements.translationReadinessStatus.dataset.state = state;
    elements.translationReadinessStatus.textContent = state === 'ready' ? 'Translation ready.'
      : state === 'preparing' ? 'Chrome is downloading/preparing translation resources. Open setup to follow preparation.'
      : state === 'unavailable' ? 'Chrome translation is unavailable for this language pair.'
      : 'Translation preparation required.';
    elements.setupTranslation.hidden = !['preparation-required', 'preparing'].includes(state);
  } catch (error) {
    if (revision !== readinessRevision) return;
    elements.translationReadinessStatus.dataset.state = 'failed';
    elements.translationReadinessStatus.textContent = `Translation check failed: ${error.message}`;
    elements.retryTranslationReadiness.hidden = false;
  }
}
elements.setupTranslation?.addEventListener('click', () => {
  const query = new URLSearchParams({ source: elements.audioLanguage.value, target: elements.translationLanguage.value });
  void chrome.tabs.create({ url: chrome.runtime.getURL(`translation-setup.html?${query}`) });
});
elements.retryTranslationReadiness?.addEventListener('click', () => void refreshTranslationReadiness());
for (const element of [elements.audioLanguage, elements.translationLanguage]) element.addEventListener('change', () => void refreshTranslationReadiness());

for (const detail of document.querySelectorAll("details")) {
  const summaryKey = String(detail.querySelector("summary")?.textContent || "panel")
    .replace(/\s+/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  detail.dataset.uiStateKey = detail.id || detail.dataset.uiStateKey || `panel:${summaryKey}`;
  detail.addEventListener("toggle", () => void persistUiState());
}
window.addEventListener("scroll", scheduleUiStateSave, { passive: true });

for (const button of document.querySelectorAll("[data-open-view]")) {
  button.addEventListener("click", () => openView(button.dataset.openView));
}
elements.wordSearch.addEventListener("input", () => { renderSavedWords(savedVocabularyEntries); void persistUiState(); });
elements.backToWords.addEventListener("click", () => globalThis.DubSavedWordReview.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.savedWordDetail.hidden && !event.defaultPrevented) {
    event.preventDefault();
    globalThis.DubSavedWordReview.close();
  }
});
window.addEventListener("pagehide", () => {
  void persistUiState();
  globalThis.DubSavedWordReview.suspend();
});
for (const button of document.querySelectorAll("[data-word-filter]")) {
  button.addEventListener("click", () => {
    wordFilter = button.dataset.wordFilter;
    for (const filter of document.querySelectorAll("[data-word-filter]")) {
      filter.setAttribute("aria-pressed", String(filter === button));
    }
    renderSavedWords(savedVocabularyEntries);
    void persistUiState();
  });
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.savedVocabulary) renderSavedWords([...learning.savedVocabularyIndex(changes.savedVocabulary.newValue).values()]);
  if (changes.transcriptLibraryIndex) void refreshTranscriptLibrary();
});

function openView(name) {
  if (name !== "words" && reviewedWord) globalThis.DubSavedWordReview.close();
  const previous = popupUiState.activeView;
  if (!uiStateHydrating && previous) {
    popupUiState.scrollByView[previous] = window.scrollY;
    const outgoingAnchor = [...document.querySelectorAll(`#view-${previous} [data-scroll-anchor]`)].find((node) => node.getBoundingClientRect().bottom >= 0);
    if (outgoingAnchor) popupUiState.scrollAnchorByView[previous] = { key: outgoingAnchor.dataset.scrollAnchor, offset: outgoingAnchor.getBoundingClientRect().top };
  }
  for (const view of document.querySelectorAll(".app-view")) view.hidden = view.id !== `view-${name}`;
  for (const button of document.querySelectorAll(".bottom-nav button")) {
    if (button.dataset.openView === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  popupUiState.activeView = name;
  window.scrollTo(0, popupUiState.scrollByView[name] || 0);
  const anchorState = popupUiState.scrollAnchorByView?.[name];
  if (anchorState) requestAnimationFrame(() => {
    const anchor = [...document.querySelectorAll(`#view-${name} [data-scroll-anchor]`)].find((node) => node.dataset.scrollAnchor === anchorState.key);
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorState.offset);
  });
  if (name === "appearance") renderControls();
  if (!uiStateHydrating) void persistUiState();
}

function scheduleUiStateSave() {
  if (uiStateHydrating) return;
  clearTimeout(uiStateSaveTimer);
  uiStateSaveTimer = setTimeout(() => void persistUiState(), 180);
}

async function persistUiState() {
  const activeView = popupUiState.activeView || "home";
  popupUiState.scrollByView[activeView] = window.scrollY;
  if (reviewedWord) {
    popupUiState.reviewScroll = window.scrollY;
    popupUiState.reviewCardState = globalThis.DubSavedWordReview.getState();
  }
  const anchor = [...document.querySelectorAll(`#view-${activeView} [data-scroll-anchor]`)].find((node) => !node.closest("[hidden]") && node.getBoundingClientRect().bottom >= 0);
  if (anchor) popupUiState.scrollAnchorByView[activeView] = { key: anchor.dataset.scrollAnchor, offset: anchor.getBoundingClientRect().top };
  popupUiState.wordSearch = elements.wordSearch.value;
  popupUiState.wordFilter = wordFilter;
  popupUiState.expanded = Object.fromEntries([...document.querySelectorAll("details")].map((detail) => [detail.dataset.uiStateKey, detail.open]));
  await chrome.storage.local.set({ [UI_STATE_KEY]: popupUiState });
}

void restoreState();
const diagnosticRefreshTimer = setInterval(() => void refreshDiagnostics(), 1_200);
window.addEventListener("unload", () => clearInterval(diagnosticRefreshTimer), { once: true });

elements.syncEarlier.addEventListener("click", () => void adjustSyncOffset(-0.1));
elements.syncLater.addEventListener("click", () => void adjustSyncOffset(0.1));
bindRangeStep(elements.fontSizeDecrease, elements.fontSize, -1);
bindRangeStep(elements.fontSizeIncrease, elements.fontSize, 1);
bindRangeStep(elements.translationFontSizeDecrease, elements.translationFontSize, -1);
bindRangeStep(elements.translationFontSizeIncrease, elements.translationFontSize, 1);
elements.resetAppearance.addEventListener("click", () => void resetAppearance());

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
  element.addEventListener("input", (event) => { void persistSettings(readSettings()); scheduleDisplaySettingsUpdate(event); });
  element.addEventListener("change", (event) => { void persistSettings(readSettings()); scheduleDisplaySettingsUpdate(event); });
}
for (const element of [elements.serverUrl, elements.audioLanguage, elements.captionLanguage, elements.collectCaptions]) {
  element.addEventListener("input", () => void persistSettings(readSettings()));
  element.addEventListener("change", () => void persistSettings(readSettings()));
}
elements.googleTranslateApiKey.addEventListener("change", (event) => { void persistSettings(readSettings()); scheduleDisplaySettingsUpdate(event); });

elements.start.addEventListener("click", async () => {
  setStatus("Checking whether the complete video can be analyzed locally…");
  elements.start.disabled = true;
  const settings = readSettings();

  try {
    await persistSettings(settings);
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
    setStatus(/quota/i.test(error.message || "")
      ? "The extension's local storage limit was reached while starting analysis. Reload the updated extension to enable larger transcript storage. Saved words and transcripts have not been deleted."
      : error.message, true);
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

elements.analyzeNetflixTitle.addEventListener("click", async () => {
  elements.analyzeNetflixTitle.disabled = true;
  elements.netflixResearchPanel.open = true;
  elements.netflixResearchStatus.textContent = "Inspecting Netflix metadata and initialization ranges…";
  setStatus("Running privacy-safe Netflix research inspection…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_NETFLIX_TITLE",
      audioLanguage: elements.audioLanguage.value.trim() || "de"
    });
    if (!response?.ok) throw new Error(response?.error || "Netflix research inspection failed.");
    setStatus("Netflix research report saved locally.");
    await refreshNetflixResearch();
  } catch (error) {
    elements.netflixResearchStatus.textContent = error.message;
    setStatus(error.message, true);
  } finally {
    elements.analyzeNetflixTitle.disabled = false;
  }
});

elements.attachNetflixSample.addEventListener("click", async () => {
  elements.attachNetflixSample.disabled = true;
  setStatus("Comparing the latest ASR and caption sample…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "ATTACH_NETFLIX_SUBTITLE_SAMPLE" });
    if (!response?.ok) throw new Error(response?.error || "Could not attach the subtitle sample.");
    setStatus(`Subtitle alignment result: ${response.alignment?.status || "unknown"}.`);
    await refreshNetflixResearch();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.attachNetflixSample.disabled = false;
  }
});

elements.exportNetflixResearch.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_LAST_NETFLIX_RESEARCH" });
    if (!response?.ok) throw new Error(response?.error || "No Netflix research report is available.");
    await downloadDataFile(
      JSON.stringify(response.report, null, 2),
      response.filename,
      "application/json"
    );
    setStatus("Netflix research JSON exported.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.exportNetflixDataset.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_NETFLIX_RESEARCH_DATASET" });
    if (!response?.ok) throw new Error(response?.error || "No Netflix research dataset is available.");
    await downloadDataFile(response.csv, response.filename, "text/csv;charset=utf-8");
    setStatus(`Netflix research dataset exported (${response.reportCount} reports).`);
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
  if (message.type === 'UI_DIAGNOSTICS_UPDATED') void refreshDiagnostics();
  if (message.type === "EXPERIMENT_STATUS") {
    setStatus(message.error || message.status, Boolean(message.error));
    void refreshDiagnostics();
    if (/transcript ready|saved transcript|cached locally/i.test(message.status || "")) {
      void refreshTranscriptLibrary();
    }
  }
});

async function restoreState() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, TRANSLATION_SECRETS_KEY, UI_STATE_KEY]);
  const restoredUi = stored[UI_STATE_KEY];
  if (restoredUi && typeof restoredUi === "object") {
    popupUiState = { ...popupUiState, ...restoredUi, scrollByView: restoredUi.scrollByView || {}, scrollAnchorByView: restoredUi.scrollAnchorByView || {}, expanded: restoredUi.expanded || {} };
    wordFilter = popupUiState.wordFilter || "all";
    elements.wordSearch.value = popupUiState.wordSearch || "";
    for (const detail of document.querySelectorAll("details")) {
      if (Object.hasOwn(popupUiState.expanded, detail.dataset.uiStateKey)) detail.open = Boolean(popupUiState.expanded[detail.dataset.uiStateKey]);
    }
    for (const filter of document.querySelectorAll("[data-word-filter]")) filter.setAttribute("aria-pressed", String(filter.dataset.wordFilter === wordFilter));
  }
  const settings = stored[SETTINGS_KEY] || {};
  const caption = learning.normalizeCaptionPreferences(settings.captionPreferences);
  const translation = learning.normalizeTranslationPreferences(settings.translationPreferences);

  elements.serverUrl.value = settings.serverUrl || elements.serverUrl.value;
  setLanguageValue(elements.audioLanguage, settings.audioLanguage || "de");
  elements.captionLanguage.value = settings.captionLanguage || "de";
  elements.collectCaptions.checked = settings.collectCaptions !== false;
  elements.translationEnabled.checked = translation.enabled;
  setLanguageValue(elements.translationLanguage, translation.targetLanguage);
  elements.translationProvider.value = translation.provider;
  elements.googleTranslateApiKey.value = stored[TRANSLATION_SECRETS_KEY]?.googleApiKey || "";
  applyAppearanceToControls(caption, translation);
  currentSyncOffset = normalizeSyncOffset(settings.syncOffset);
  renderControls();
  void refreshTranslationReadiness();
  void refreshActiveVideo();
  await refreshSavedWords();
  await refreshTranscriptLibrary();
  await refreshDiagnostics();
  await refreshNetflixResearch();
  openView(popupUiState.activeView || "home");
  uiStateHydrating = false;
  if (popupUiState.activeView === "words" && popupUiState.reviewWord) {
    const entry = savedVocabularyEntries.find((item) => learning.normalizedWord(item.word) === popupUiState.reviewWord);
    if (entry) void openSavedWord(entry, true);
    else { popupUiState.reviewWord = null; void persistUiState(); }
  }
}

function setLanguageValue(select, code) {
  if (![...select.options].some((option) => option.value === code)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    select.append(option);
  }
  select.value = code;
}

async function refreshActiveVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https?:/.test(tab.url)) return;
    const page = new URL(tab.url);
    elements.sessionTitle.textContent = tab.title || "Current video";
    elements.sessionTitle.title = tab.title || "Current video";
    elements.activePlatform.textContent = page.hostname.replace(/^www\./, "");
    elements.activeVideoDescription.textContent = "Transcribe the spoken audio, translate it, and collect new words.";
  } catch {
    // A popup opened directly may not have an activeTab grant. Keep the honest idle copy.
  }
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
  elements.connectionState.lastChild.textContent = ` ${ { idle: "Ready", working: "Working", success: "Ready", warning: "Fallback", error: "Error" }[level]}`;
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

async function refreshNetflixResearch() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_NETFLIX_RESEARCH_STATE" });
    if (!response?.ok) throw new Error(response?.error || "Research reports are unavailable.");
    const entries = response.entries || [];
    const report = response.lastReport || null;
    elements.netflixResearchCount.textContent = `${entries.length} report${entries.length === 1 ? "" : "s"}`;
    if (!report) {
      elements.netflixResearchStatus.textContent = "No Netflix research report yet.";
      elements.netflixResearchDetails.replaceChildren();
      return;
    }
    const agreement = report.agreementEstimate == null
      ? null
      : Number(report.agreementEstimate);
    elements.netflixResearchStatus.textContent = `${report.title} · ${report.alignmentStatus}`;
    const details = [
      ["Type", report.contentType],
      ["Audio", `${report.audioLanguage || "?"} · ${report.selectedRole || "unknown role"}`],
      ["Representations", `${report.inspectedRepresentationCount} inspected`],
      ["Protection", `${report.protectionDetectedCount} protected`],
      ["Subtitles", String(report.subtitleConclusion || "unknown").replace(/-/g, " ")],
      ["Agreement", agreement != null && Number.isFinite(agreement)
        ? `${(agreement * 100).toFixed(1)}%`
        : "not sampled"]
    ];
    const fragment = document.createDocumentFragment();
    for (const [label, rawValue] of details) {
      if (!rawValue) continue;
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = label;
      value.textContent = rawValue;
      row.append(term, value);
      fragment.append(row);
    }
    elements.netflixResearchDetails.replaceChildren(fragment);
  } catch (error) {
    elements.netflixResearchStatus.textContent = error.message;
  }
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
    previewLanguageKey = "";
    previewConfigurationPending = true;
  }
  renderControls();
  clearTimeout(displayUpdateTimer);
  displayUpdateTimer = setTimeout(() => void applyDisplaySettings(), 160);
}

async function applyDisplaySettings() {
  const settings = readSettings();
  await persistSettings(settings);
  previewConfigurationPending = false;
  renderControls();
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

function applyAppearanceToControls(caption, translation) {
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
}

async function resetAppearance() {
  const currentTranslation = learning.normalizeTranslationPreferences({
    enabled: elements.translationEnabled.checked,
    targetLanguage: elements.translationLanguage.value,
    provider: elements.translationProvider.value
  });
  applyAppearanceToControls(
    learning.DEFAULT_CAPTION_PREFERENCES,
    {
      ...learning.DEFAULT_TRANSLATION_PREFERENCES,
      enabled: currentTranslation.enabled,
      targetLanguage: currentTranslation.targetLanguage,
      provider: currentTranslation.provider
    }
  );
  renderControls();
  await applyDisplaySettings();
  setStatus("Caption appearance reset to the defaults.");
}

function bindRangeStep(button, range, delta) {
  button.addEventListener("click", () => {
    const minimum = Number(range.min);
    const maximum = Number(range.max);
    const step = Number(range.step) || 1;
    const next = Math.max(minimum, Math.min(maximum, Number(range.value) + delta * step));
    range.value = String(next);
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
    row.dataset.scrollAnchor = `transcript:${entry.key}`;
    const body = document.createElement("div");
    body.append(
      createTextElement("div", entry.title || "Untitled video", "saved-word-title"),
      createTextElement(
        "div",
        `${entry.audioLanguage || "?"} · ${entry.segmentCount || 0} segments`,
        "saved-word-definition"
      )
    );
    body.append(createTextElement("div", `${entry.platform || "Video"} · ${Math.round((entry.duration || 0) / 60)} min · ${entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : "Saved locally"}`, "source-meta"));
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
    const sourceLink = createSourceLink(entry.url, "Open video ↗");
    actions.append(download);
    if (sourceLink) actions.append(sourceLink);
    actions.append(remove);
    row.append(body, actions);
    fragment.append(row);
  }
  elements.savedTranscripts.replaceChildren(fragment);
}

async function downloadTextFile(text, filename) {
  return downloadDataFile(text, filename, "text/plain;charset=utf-8");
}

async function downloadDataFile(text, filename, type) {
  const blob = new Blob([text], { type });
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
  savedVocabularyEntries = entries;
  if (reviewedWord && !entries.some((entry) => learning.normalizedWord(entry.word) === reviewedWord)) {
    globalThis.DubSavedWordReview.close();
  }
  elements.savedWordCount.textContent = String(entries.length);
  for (const total of document.querySelectorAll("[data-word-total]")) total.textContent = String(entries.length);
  renderRecentWords(entries);
  const filtered = filterVocabulary(entries, elements.wordSearch.value, wordFilter);
  elements.wordResults.textContent = `${filtered.length} of ${entries.length} saved words`;
  if (!filtered.length) {
    elements.savedWords.replaceChildren(createTextElement(
      "p",
      entries.length ? "No matching words. Try another search or filter." : "Click a transcript word and choose “Save word”. It will be marked when it appears in another show.",
      "empty-saved"
    ));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const entry of filtered) {
    const row = document.createElement("div");
    row.className = "saved-word";
    row.dataset.scrollAnchor = `word:${learning.normalizedWord(entry.word)}`;
    const body = document.createElement("div");
    body.append(
      createSavedWordButton(entry),
      createTextElement(
        "div",
        entry.germanDefinition || "Saved word",
        "saved-word-definition"
      )
    );
    const tags = document.createElement("div");
    tags.className = "word-tags";
    if (entry.isVerb) tags.append(createTextElement("span", "Verb", "word-tag"));
    body.append(tags);
    const example = entry.examples?.[0]?.german;
    if (example) body.append(createTextElement("div", `„${example}“`, "saved-word-context"));
    const actions = document.createElement("div");
    actions.className = "library-actions";
    const dictionary = createSourceLink(entry.germanSourceUrl, "Dictionary ↗");
    const video = createSourceLink(entry.video?.url, "Return to source ↗");
    if (dictionary) actions.append(dictionary);
    if (video) actions.append(video);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: "REMOVE_SAVED_WORD", word: entry.word });
        if (!response?.ok) throw new Error(response?.error || "Could not remove saved word.");
        await refreshSavedWords();
      } catch (error) {
        elements.wordResults.textContent = error.message;
        remove.disabled = false;
      }
    });
    actions.append(remove);
    row.append(body, actions);
    fragment.append(row);
  }
  elements.savedWords.replaceChildren(fragment);
}

function filterVocabulary(entries, query, type) {
  const search = String(query || "").normalize("NFC").trim().toLocaleLowerCase("de-DE");
  return entries.filter((entry) => {
    const category = entry.isVerb ? "verb" : "other";
    const searchable = [entry.word, entry.germanDefinition].filter(Boolean).join(" ").normalize("NFC").toLocaleLowerCase("de-DE");
    return (type === "all" || type === category) && (!search || searchable.includes(search));
  });
}

function createSavedWordButton(entry) {
  const button = createTextElement("button", entry.word, "saved-word-title saved-word-open");
  button.type = "button";
  button.dataset.reviewWord = learning.normalizedWord(entry.word);
  button.setAttribute("aria-label", `View full details for ${entry.word}`);
  button.setAttribute("aria-controls", "savedWordDetail");
  button.addEventListener("click", () => void openSavedWord(entry));
  return button;
}

async function openSavedWord(entry, restoring = false) {
  if (popupUiState.activeView !== "words") openView("words");
  if (!restoring) popupUiState.wordListScroll = window.scrollY;
  reviewedWord = learning.normalizedWord(entry.word);
  popupUiState.reviewWord = reviewedWord;
  const reviewScroll = restoring ? Number(popupUiState.reviewScroll) || 0 : 0;
  const reviewCardState = restoring ? popupUiState.reviewCardState : null;
  elements.savedWordList.hidden = true;
  elements.savedWordDetail.hidden = false;
  elements.savedWordDetailTitle.textContent = entry.word;
  elements.savedWordDetailTitle.focus({ preventScroll: true });
  window.scrollTo(0, reviewScroll);
  void persistUiState();
  const selected = reviewedWord;
  try {
    const pending = globalThis.DubSavedWordReview.open(entry, readSettings().translationPreferences, {
      onClose: closeSavedWordReview,
      onRemoved: () => void refreshSavedWords(),
      onChange: scheduleUiStateSave
    });
    window.scrollTo(0, reviewScroll);
    await pending;
    if (reviewedWord === selected && restoring) {
      globalThis.DubSavedWordReview.restoreState(reviewCardState);
      window.scrollTo(0, reviewScroll);
    }
  } catch (error) {
    if (reviewedWord !== selected) return;
    // Keep the list reachable even if mounting the optional detail view fails.
    globalThis.DubSavedWordReview.close();
    if (reviewedWord === selected) closeSavedWordReview();
    elements.wordResults.textContent = `Could not open word details: ${error.message}`;
  }
}

function closeSavedWordReview() {
  const selected = reviewedWord;
  reviewedWord = null;
  popupUiState.reviewWord = null;
  elements.savedWordDetail.hidden = true;
  elements.savedWordList.hidden = false;
  window.scrollTo(0, Number(popupUiState.wordListScroll) || 0);
  const opener = [...elements.savedWords.querySelectorAll("[data-review-word]")]
    .find((button) => button.dataset.reviewWord === selected);
  (opener || elements.wordSearch).focus({ preventScroll: true });
  void persistUiState();
}

function renderRecentWords(entries) {
  if (!entries.length) {
    elements.recentWords.replaceChildren(createTextElement("p", "Click any caption word to start your collection. Saved words will be marked in later shows.", "empty-saved"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "saved-word";
    row.append(createSavedWordButton(entry), createTextElement("div", entry.germanDefinition || "Saved vocabulary", "saved-word-definition"));
    fragment.append(row);
  }
  elements.recentWords.replaceChildren(fragment);
}

function createSourceLink(rawUrl, label) {
  const url = learning.stablePageUrl(rawUrl);
  if (!url) return null;
  const link = createTextElement("a", label, "source-link");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function formatClipTime(seconds) {
  const time = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;
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
  const caption = readSettings().captionPreferences;
  const translation = readSettings().translationPreferences;
  for (const [element, preferences] of [[elements.previewTranscript, caption], [elements.previewTranslation, translation]]) {
    element.style.color = learning.rgbaFromHex(preferences.textColor, preferences.textOpacity);
    element.style.fontFamily = learning.fontFamilyValue(preferences.fontFamily);
    element.style.fontSize = `${Math.round(preferences.fontSize * .7)}px`;
    element.style.fontWeight = preferences.bold ? "700" : "400";
  }
  elements.previewTranslation.hidden = !translation.enabled;
  elements.previewCaption.style.backgroundColor = learning.rgbaFromHex(caption.backgroundColor, caption.backgroundOpacity);
  elements.previewCaption.style.left = `${caption.horizontalPosition}%`;
  elements.previewCaption.style.bottom = `${caption.verticalPosition}%`;
  elements.previewCaption.style.transform = `translate(-${caption.horizontalPosition}%, ${caption.verticalPosition}%)`;
  const shadows = { none: "none", shadow: "0 1px 2px black", outline: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" };
  elements.previewCaption.style.textShadow = shadows[caption.edgeStyle];
  if (!document.querySelector("#view-appearance").hidden && translation.enabled && !previewConfigurationPending) void refreshPreviewLanguage(translation);
  const browserTranslatorAvailable = "Translator" in globalThis;
  elements.translationAvailability.textContent = browserTranslatorAvailable
    ? "On-device translation is detected. Automatic mode uses it before Google Cloud."
    : "On-device translation is not detected in this browser. Automatic mode needs the optional Google Cloud key.";
}

async function refreshPreviewLanguage(preferences) {
  const language = preferences.targetLanguage;
  const key = `${preferences.provider}:${language}`;
  if (previewLanguageKey === key) return;
  previewLanguageKey = key;
  const revision = ++previewTranslationRevision;
  elements.previewTranslation.lang = language;
  elements.previewTranslation.dir = "auto";
  const samples = { en: "That is a secret.", de: "Das ist ein Geheimnis." };
  if (samples[language]) {
    elements.previewTranslation.textContent = samples[language];
    return;
  }
  elements.previewTranslation.textContent = "…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", text: "Das ist ein Geheimnis.", sourceLanguage: "de", translationPreferences: preferences });
    if (!response?.ok || !response.translatedText) throw new Error(response?.error || "Preview translation unavailable.");
    if (revision === previewTranslationRevision) elements.previewTranslation.textContent = response.translatedText;
  } catch {
    if (revision === previewTranslationRevision) {
      elements.previewTranslation.textContent = "Translation unavailable";
    }
  }
}

function renderSyncOffset() {
  const sign = currentSyncOffset > 0 ? "+" : "";
  elements.syncOffset.textContent = `${sign}${currentSyncOffset.toFixed(1)} s`;
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", isError);
}

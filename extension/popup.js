const elements = {
  serverUrl: document.querySelector("#serverUrl"),
  audioLanguage: document.querySelector("#audioLanguage"),
  captionLanguage: document.querySelector("#captionLanguage"),
  collectCaptions: document.querySelector("#collectCaptions"),
  syncEarlier: document.querySelector("#syncEarlier"),
  syncLater: document.querySelector("#syncLater"),
  syncOffset: document.querySelector("#syncOffset"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop"),
  export: document.querySelector("#export"),
  status: document.querySelector("#status")
};

const SETTINGS_KEY = "experimentSettings";
let currentSyncOffset = 0;

void restoreSettings();

elements.syncEarlier.addEventListener("click", () => void adjustSyncOffset(-0.1));
elements.syncLater.addEventListener("click", () => void adjustSyncOffset(0.1));

elements.start.addEventListener("click", async () => {
  setStatus("Checking whether the complete video can be analyzed locally…");
  elements.start.disabled = true;
  const settings = readSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_EXPERIMENT",
      settings
    });
    if (!response?.ok) throw new Error(response?.error || "Could not start the experiment.");
    setStatus(response.mode === "batch"
      ? "Full-video analysis started. Playback will begin when the transcript is ready."
      : "Live transcription fallback is preparing automatically.");
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
  }
});

async function restoreSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY];
  if (!settings) return;
  elements.serverUrl.value = settings.serverUrl || elements.serverUrl.value;
  elements.audioLanguage.value = settings.audioLanguage || "de";
  elements.captionLanguage.value = settings.captionLanguage || "de";
  elements.collectCaptions.checked = settings.collectCaptions !== false;
  currentSyncOffset = normalizeSyncOffset(settings.syncOffset);
  renderSyncOffset();
}

function readSettings() {
  return {
    serverUrl: elements.serverUrl.value.trim(),
    audioLanguage: elements.audioLanguage.value.trim() || "de",
    captionLanguage: elements.captionLanguage.value.trim() || "de",
    collectCaptions: elements.collectCaptions.checked,
    batchModel: "small",
    syncOffset: currentSyncOffset
  };
}

async function adjustSyncOffset(delta) {
  currentSyncOffset = normalizeSyncOffset(currentSyncOffset + delta);
  renderSyncOffset();
  await chrome.storage.local.set({ [SETTINGS_KEY]: readSettings() });
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

function normalizeSyncOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(Math.max(-3, Math.min(3, number)) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function renderSyncOffset() {
  const sign = currentSyncOffset > 0 ? "+" : "";
  elements.syncOffset.textContent = `${sign}${currentSyncOffset.toFixed(1)} s`;
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", isError);
}

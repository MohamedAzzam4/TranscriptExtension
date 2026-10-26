(() => {
  if (globalThis.DubTranscriptPronunciation?.version === 1) return;

  function createController({ synthesis, Utterance, onVoicesChanged = () => {},
    setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
    let active = null;
    let ownedUtterance = null;

    function availability() {
      if (!synthesis || typeof Utterance !== "function") return { state: "unsupported" };
      const german = (synthesis.getVoices() || [])
        .filter((voice) => /^de(?:$|[-_])/i.test(voice.lang || ""));
      const voice = german.find((item) => /^de-DE$/i.test(item.lang)) || german[0];
      return voice ? { state: "available", voice, online: voice.localService === false } : { state: "missing" };
    }

    synthesis?.addEventListener("voiceschanged", onVoicesChanged);

    function finish(request, state, error) {
      if (active !== request) return;
      clearTimer(request.timer);
      active = null;
      if (!state.endsWith("unconfirmed")) ownedUtterance = null;
      request.onState({ state, voice: request.voice.name, online: request.voice.localService === false, error });
    }

    function cancel() {
      const request = active;
      if (request) finish(request, "cancelled");
      if (ownedUtterance || request) {
        ownedUtterance = null;
        synthesis.cancel();
      }
    }

    function speak(rawText, onState) {
      const text = String(rawText || "").trim();
      if (!text) return { ok: false, error: "Select a German word first." };
      const available = availability();
      if (available.state !== "available") return {
        ok: false,
        error: available.state === "unsupported"
          ? "Speech synthesis is not supported by this browser."
          : "No German browser voice is available. Playback was blocked instead of using another language."
      };
      cancel();
      // Match the reference site: replace queued speech and explicitly set a German voice.
      synthesis.cancel();
      const utterance = new Utterance(text);
      utterance.lang = available.voice.lang || "de-DE";
      utterance.voice = available.voice;
      utterance.rate = 0.92;
      utterance.pitch = 1;
      const request = { voice: available.voice, onState, timer: null, started: false };
      active = request;
      ownedUtterance = utterance;
      utterance.onstart = () => {
        if (active !== request) return;
        request.started = true;
        onState({ state: "speaking", voice: request.voice.name, online: available.online });
      };
      utterance.onend = () => finish(request, "end");
      utterance.onerror = (event) => {
        const code = String(event.error || "unknown");
        const state = code === "canceled" ? "cancelled" : code === "interrupted" ? "interrupted" : "error";
        finish(request, state, `German pronunciation failed: ${code}.`);
      };
      request.timer = setTimer(() => finish(request,
        request.started ? "completion-unconfirmed" : "start-unconfirmed"), 15_000);
      onState({ state: "accepted", voice: request.voice.name, online: available.online });
      try {
        // Keep this call synchronous with the speaker click to retain user activation.
        synthesis.speak(utterance);
      } catch (error) {
        finish(request, "error", error.message || "German pronunciation failed.");
        return { ok: false, error: error.message };
      }
      return { ok: true };
    }

    return { availability, speak, cancel };
  }

  globalThis.DubTranscriptPronunciation = Object.freeze({ version: 1, createController });
})();

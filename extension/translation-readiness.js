(() => {
  if (globalThis.DubTranslationReadiness) return;
  function bounded(operation, milliseconds, message, onTimeout = () => {}) {
    let timer;
    return Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error(message)); }, milliseconds);
    })]).finally(() => clearTimeout(timer));
  }
  function createManager(api = globalThis.Translator, options = {}) {
    const instances = new Map();
    const timeout = options.timeout || 30000;
    const preparationTimeout = options.preparationTimeout || 180000;
    const pairKey = (pair) => `${pair.sourceLanguage}:${pair.targetLanguage}`;
    async function availability(pair) {
      if (pair.sourceLanguage === pair.targetLanguage) return 'identity';
      if (!api) return 'unavailable';
      return bounded(api.availability(pair), timeout, 'Translation availability check timed out. Retry.');
    }
    // Called directly by the setup page's button, before any await/message hop.
    function prepare(pair, update = () => {}) {
      if (!api) return Promise.reject(new Error('This browser does not expose the Translator API.'));
      const controller = new AbortController();
      let expired = false;
      update({ state: 'preparing', progress: null });
      let creating;
      try {
        creating = api.create({ ...pair, signal: controller.signal, monitor(monitor) {
          monitor.addEventListener('downloadprogress', event => {
            if (expired) return;
            const loaded = Number(event.loaded);
            update({ state: 'downloading', progress: Number.isFinite(loaded) ? Math.round(Math.max(0, Math.min(1, loaded)) * 100) : null });
          });
        }});
      } catch (error) { creating = Promise.reject(error); }
      return bounded(Promise.resolve(creating).then(instance => {
        if (expired) { instance.destroy?.(); throw new Error('Translation preparation expired. Retry.'); }
        instances.get(pairKey(pair))?.destroy?.();
        instances.set(pairKey(pair), instance);
        update({ state: 'ready', progress: null });
        return instance;
      }), preparationTimeout, 'Translation preparation timed out. Keep this tab open and retry.', () => {
        expired = true; controller.abort();
      });
    }
    async function check(pair) {
      const state = await availability(pair);
      if (state === 'identity') return { state: 'ready', identity: true };
      if (state === 'unavailable') return { state: 'unavailable' };
      if (state !== 'available') return { state: 'preparation-required', availability: state };
      // Availability alone is not sufficient evidence that creation works.
      if (!instances.has(pairKey(pair))) await prepare(pair);
      return { state: 'ready' };
    }
    async function translate(pair, text) {
      if (pair.sourceLanguage === pair.targetLanguage) return text;
      let instance = instances.get(pairKey(pair));
      if (!instance) {
        const state = await availability(pair);
        if (state !== 'available') throw new Error(state === 'unavailable'
          ? 'This language pair is unavailable in Chrome.'
          : 'Translation preparation required. Open the extension and choose Set up translation.');
        instance = await prepare(pair);
      }
      const controller = new AbortController();
      try {
        const translated = await bounded(instance.translate(text, { signal: controller.signal }), timeout,
          'Translation timed out. Retry.', () => controller.abort());
        if (typeof translated !== 'string' || !translated.trim()) throw new Error('Translation returned no text. Retry.');
        return translated;
      } catch (error) {
        instances.delete(pairKey(pair)); instance.destroy?.(); throw error;
      }
    }
    return { availability, check, prepare, translate };
  }
  globalThis.DubTranslationReadiness = Object.freeze({ createManager, bounded });
})();

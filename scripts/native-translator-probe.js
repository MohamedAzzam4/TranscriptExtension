() => {
  // Execute through Chrome DevTools MCP on a disposable public test page.
  // No extension helper, service worker, cloud provider or user content involved.
  const probe = globalThis.rawTranslatorProbe = {
    startedAt: null, events: [], api: typeof Translator, userAgent: navigator.userAgent
  };
  const button = document.createElement('button');
  button.textContent = 'Run isolated Translator initialization check';
  button.onclick = event => {
    probe.startedAt = new Date().toISOString();
    probe.trustedClick = event.isTrusted;
    probe.userActivation = navigator.userActivation.isActive;
    probe.state = 'creating';
    const controller = new AbortController();
    const timer = setTimeout(() => {
      probe.state = 'timed-out';
      probe.timedOutAt = new Date().toISOString();
      controller.abort();
    }, 180000);
    try {
      Translator.create({ sourceLanguage: 'de', targetLanguage: 'en', signal: controller.signal,
        monitor(monitor) {
          probe.monitorAttached = true;
          monitor.addEventListener('downloadprogress', event => probe.events.push({ at: new Date().toISOString(), loaded: event.loaded }));
        }
      }).then(async translator => {
        clearTimeout(timer);
        probe.state = 'created';
        probe.translation = await translator.translate('Guten Tag.');
        probe.state = 'translated';
        translator.destroy();
      }, error => {
        clearTimeout(timer);
        probe.error = { name: error.name, message: error.message };
        if (probe.state !== 'timed-out') probe.state = 'failed';
      });
    } catch (error) {
      clearTimeout(timer);
      probe.state = 'failed';
      probe.error = { name: error.name, message: error.message };
    }
  };
  document.body.append(button);
  return { api: probe.api, buttonAdded: true };
}

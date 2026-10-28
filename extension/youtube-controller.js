(() => {
  if (globalThis.__dubYouTubeController) return;
  globalThis.__dubYouTubeController = true;
  const captions = globalThis.DubYouTubeCaptions;
  const learning = globalThis.DubTranscriptLearning;
  let settings = {}, videoId = null, generation = 0, requestId = '', selectedId = 'auto';
  let sourceTracks = [], playerMetadata = null, host = null, panel = null, status = null, trackSelect = null;
  let menuOpen = false, hasSession = false, lastVideo = null, stopped = false, disposed = false;
  let activeAudioLanguage = '', lastAudioProbe = 0, audioProbePending = false;
  let signature = '', suppressStyle = null, controlsStyle = null;
  let statusText = '';
  const pending = new Map();
  function preferences() { return learning.normalizeYouTubePreferences(settings.youtubePreferences); }
  function request(type, fields = {}) {
    return chrome.runtime.sendMessage({ type, videoId, requestId, requestEpoch: generation, ...fields }).then(response => {
      if (!response?.ok) throw new Error(response?.error || 'YouTube caption operation failed.');
      return response;
    });
  }
  function invalidate(resume = false) {
    if (requestId) {
      void chrome.runtime.sendMessage({ type: 'YOUTUBE_CANCEL', videoId, requestId }).catch(() => {});
      requestId = '';
    }
    generation++; globalThis.DubYouTubeOverlay?.stop(resume); hasSession = false;
    suppressStyle?.remove(); suppressStyle = null;
    for (const { resolve, timer } of pending.values()) { clearTimeout(timer); resolve(null); }
    pending.clear();
  }
  function setStatus(text, level = 'working') {
    statusText = text;
    if (status) status.textContent = text;
    if (requestId) void request('YOUTUBE_STATE', { stage: level === 'success' ? 'YouTube captions ready' : level === 'warning' ? hasSession ? 'YouTube captions ready with a warning' : 'YouTube captions unavailable' : level === 'idle' ? 'YouTube captions stopped' : 'Retrieving YouTube captions', message: text, level }).catch(() => {});
  }
  function snapshot() {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); resolve(null); }, 1500);
      pending.set(id, { resolve, timer });
      window.postMessage({ type: 'DUB_YT_METADATA_REQUEST', requestId: id, videoId }, location.origin);
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DUB_YT_METADATA_RESPONSE') return;
    const waiting = pending.get(event.data.requestId); if (!waiting) return;
    clearTimeout(waiting.timer); pending.delete(event.data.requestId);
    const value = event.data.snapshot;
    waiting.resolve(value?.videoId === videoId ? value : null);
  });
  function drawTracks() {
    if (!trackSelect) return;
    trackSelect.replaceChildren(new Option('Auto: creator subtitles first', 'auto'));
    for (const track of sourceTracks) {
      const option = new Option(`${track.name} · ${track.kind === 'manual' ? 'Creator-provided' : 'Automatic'}`, track.id);
      trackSelect.append(option);
    }
    trackSelect.value = sourceTracks.some(track => track.id === selectedId) ? selectedId : 'auto';
  }
  async function retrieve() {
    invalidate(captions.videoId(location.href) === videoId); const epoch = generation; const id = videoId;
    if (!id || !preferences().enabled || preferences().mode === 'audio' || stopped || disposed) {
      if (id && !disposed) setStatus(preferences().mode === 'audio' ? 'YouTube subtitle retrieval is off; local audio transcription is selected.' : 'Learning captions are off.', 'idle');
      return;
    }
    requestId = crypto.randomUUID();
    const valid = () => epoch === generation && id === captions.videoId(location.href) && !disposed;
    const scoped = async (type, fields = {}) => {
      if (!valid()) throw new Error('Previous video request cancelled.');
      const result = await request(type, fields);
      if (!valid()) throw new Error('Previous video request cancelled.');
      return result;
    };
    try {
      await scoped('YOUTUBE_BEGIN'); setStatus('Looking for YouTube subtitle tracks…');
      let metadata = null;
      for (let attempt = 0; attempt < 5 && valid(); attempt++) {
        const candidate = await snapshot();
        if (!valid()) return;
        metadata = candidate; if (metadata?.tracks?.length) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!valid()) return;
      playerMetadata = metadata;
      if (metadata?.isLive) throw new Error('Live streams need a separate rolling-caption session. Use audio transcription explicitly if needed.');
      const language = captions.language(metadata?.audioLanguage || settings.audioLanguage || 'de');
      const duration = Number(metadata?.duration) || Number(document.querySelector('#movie_player video')?.duration) || 0;
      sourceTracks = captions.tracks(metadata?.tracks, id);
      drawTracks();
      let track = captions.selectTrack(sourceTracks, language, selectedId);
      let segments = null, platformTranslations = [], retrieval = 'browser', cached = false;
      const targetLanguage = learning.normalizeTranslationPreferences(settings.translationPreferences).targetLanguage;
      const useYouTubeTranslation = preferences().translationSource === 'youtube' && settings.translationPreferences?.enabled !== false && targetLanguage !== language;
      if (track) {
        const cache = await scoped('YOUTUBE_GET_CACHE', { track });
        if (cache.record) {
          try {
            segments = captions.normalizeCues(cache.record.segments, duration); cached = true;
            platformTranslations = useYouTubeTranslation ? cache.record.transcriptTranslations?.find(item => item.targetLanguage === targetLanguage)?.segments || [] : [];
          } catch { /* Validate old/partial cache before reuse. */ }
        }
        if (!segments) {
          try { segments = (await scoped('YOUTUBE_FETCH_CAPTIONS', { url: track.url, duration })).segments; }
          catch { /* Try the existing local helper in subtitle-only mode below. */ }
        }
      }
      if (!segments) {
        if (selectedId !== 'auto' && !track) throw new Error('That source track is unavailable for the current spoken language. Choose Auto or another track.');
        setStatus('Browser captions unavailable. Trying the subtitle-only local helper…');
        const result = await scoped('YOUTUBE_NATIVE_CAPTIONS', { language, duration,
          trackId: selectedId === 'auto' ? '' : track?.id, targetLanguage: useYouTubeTranslation ? targetLanguage : '' });
        segments = result.segments; track = result.track; retrieval = 'yt-dlp';
        if (!track || captions.baseLanguage(track.language) !== captions.baseLanguage(language)) throw new Error('No source transcript matches the selected spoken language.');
        sourceTracks = result.tracks?.length ? result.tracks : [track]; drawTracks();
        platformTranslations = result.translationSegments || [];
      }
      if (useYouTubeTranslation && !platformTranslations.length && track.url && track.translatable && (!metadata?.translationLanguages?.length || metadata.translationLanguages.includes(targetLanguage))) {
        try { platformTranslations = (await scoped('YOUTUBE_FETCH_CAPTIONS', { url: track.url, targetLanguage, duration })).segments; }
        catch { /* Original remains usable; Chrome/configured Cloud translates visible cues. */ }
      }
      let saved, cacheWarning = '';
      try {
        saved = await scoped(cached ? 'YOUTUBE_BIND_CACHE' : 'YOUTUBE_SAVE_TRANSCRIPT', { track, segments, duration,
          title: metadata?.title || document.title, retrieval, translationSegments: platformTranslations, targetLanguage });
      } catch (error) {
        if (!valid()) return;
        cacheWarning = ` Video-history caching failed: ${error.message} Captions remain available in this tab.`;
        saved = { experimentId: `youtube-preview-${requestId}` };
      }
      if (!valid()) return;
      globalThis.DubYouTubeOverlay.start({ experimentId: saved.experimentId, segments,
        captionPreferences: settings.captionPreferences, translationPreferences: settings.translationPreferences,
        audioLanguage: track.language, syncOffset: Number(settings.syncOffset) || 0,
        platformTranslations, platformTranslationLanguage: platformTranslations.length ? targetLanguage : '',
        youtubeRequest: { videoId: id, requestId },
        sourceVideo: { key: captions.cacheIdentity(id, track), title: metadata?.title || document.title,
          url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube' } });
      hasSession = true;
      activeAudioLanguage = captions.language(metadata?.audioLanguage);
      globalThis.DubYouTubeOverlay.suspend(Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')));
      suppressStyle = document.createElement('style');
      suppressStyle.textContent = '#movie_player:not(.ad-showing):not(.ad-interrupting) .ytp-caption-window-container { visibility: hidden !important; }';
      document.documentElement.append(suppressStyle);
      setStatus(`${cached ? 'Saved' : 'Using'} YouTube ${track.kind === 'manual' ? 'creator-provided subtitles' : 'automatic transcript'} (${track.language}). ${platformTranslations.length ? 'YouTube translation ready.' : 'Translation uses the extension provider when needed.'}${cacheWarning}`, cacheWarning ? 'warning' : 'success');
    } catch (error) { if (valid()) setStatus(error.message, 'warning'); }
  }
  async function patch(fields) {
    const response = await request('YOUTUBE_PATCH_SETTINGS', fields);
    settings = response.settings;
  }
  function updateSettings(fields) {
    void patch(fields).catch(error => setStatus(error.message, 'warning'));
  }
  function addControl(parent, label, value, change, type = 'checkbox') {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const input = document.createElement('input'); input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value); else input.value = value;
    input.addEventListener('change', () => void change(type === 'checkbox' ? input.checked : input.value).catch(error => setStatus(error.message, 'warning')));
    wrapper.append(input); parent.append(wrapper); return input;
  }
  function buildPanel(shadow) {
    panel = document.createElement('section'); panel.className = 'menu'; panel.hidden = !menuOpen;
    panel.setAttribute('aria-label', 'Transcript Lab settings');
    const title = document.createElement('strong'); title.textContent = 'Transcript Lab'; panel.append(title);
    addControl(panel, 'Learning captions', preferences().enabled, enabled => patch({ youtubePreferences: { enabled } }));
    const trackLabel = document.createElement('label'); trackLabel.textContent = 'Source subtitle track';
    trackSelect = document.createElement('select'); trackSelect.addEventListener('change', () => {
      selectedId = trackSelect.value;
      const track = sourceTracks.find(item => item.id === selectedId);
      if (track && !playerMetadata?.audioLanguage && captions.baseLanguage(track.language) !== captions.baseLanguage(settings.audioLanguage)) void patch({ audioLanguage: track.language }).catch(error => setStatus(error.message, 'warning'));
      else void retrieve();
    });
    trackLabel.append(trackSelect); panel.append(trackLabel); drawTracks();
    const languageLabel = document.createElement('label'); languageLabel.textContent = 'Spoken language (when player does not report it)';
    const sourceLanguage = document.createElement('select');
    const languages = { de: 'German', en: 'English', ar: 'Arabic', ja: 'Japanese', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian', ko: 'Korean', zh: 'Chinese', tr: 'Turkish', nl: 'Dutch', pl: 'Polish', uk: 'Ukrainian' };
    for (const [code, name] of Object.entries(languages)) sourceLanguage.append(new Option(name, code));
    sourceLanguage.value = settings.audioLanguage || 'de';
    sourceLanguage.addEventListener('change', () => updateSettings({ audioLanguage: sourceLanguage.value })); languageLabel.append(sourceLanguage); panel.append(languageLabel);
    const caption = learning.normalizeCaptionPreferences(settings.captionPreferences);
    addControl(panel, 'Highlight current spoken word', caption.highlightCurrentWord, highlightCurrentWord => patch({ captionPreferences: { highlightCurrentWord } }));
    addControl(panel, 'Pause while hovering a word', caption.pauseOnWordHover, pauseOnWordHover => patch({ captionPreferences: { pauseOnWordHover } }));
    const translation = learning.normalizeTranslationPreferences(settings.translationPreferences);
    addControl(panel, 'Show translation', translation.enabled, enabled => patch({ translationPreferences: { enabled } }));
    const targetLabel = document.createElement('label'); targetLabel.textContent = 'Translation language';
    const target = document.createElement('select'); for (const [code, name] of Object.entries(languages)) target.append(new Option(name, code));
    target.value = translation.targetLanguage; target.addEventListener('change', () => updateSettings({ translationPreferences: { targetLanguage: target.value } })); targetLabel.append(target); panel.append(targetLabel);
    const providerLabel = document.createElement('label'); providerLabel.textContent = 'Translation source';
    const provider = document.createElement('select'); provider.append(new Option('YouTube, then extension fallback', 'youtube'), new Option('Extension translation provider', 'extension')); provider.value = preferences().translationSource;
    provider.addEventListener('change', () => updateSettings({ youtubePreferences: { translationSource: provider.value } })); providerLabel.append(provider); panel.append(providerLabel);
    const appearance = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Caption appearance'; appearance.append(summary);
    for (const [label, preferencesKey, values] of [['Original', 'captionPreferences', caption], ['Translation', 'translationPreferences', translation]]) {
      const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = label; group.append(legend);
      const size = addControl(group, 'Font size', values.fontSize, fontSize => patch({ [preferencesKey]: { fontSize } }), 'number'); size.min = preferencesKey === 'captionPreferences' ? '16' : '12'; size.max = preferencesKey === 'captionPreferences' ? '52' : '42';
      addControl(group, 'Text color', values.textColor, textColor => patch({ [preferencesKey]: { textColor } }), 'color');
      addControl(group, 'Bold', values.bold, bold => patch({ [preferencesKey]: { bold } }));
      const fontLabel = document.createElement('label'); fontLabel.textContent = 'Font'; const font = document.createElement('select');
      for (const [name, value] of [['Sans serif', 'sans'], ['Serif', 'serif'], ['Monospace', 'mono']]) font.append(new Option(name, value)); font.value = values.fontFamily;
      font.addEventListener('change', () => updateSettings({ [preferencesKey]: { fontFamily: font.value } })); fontLabel.append(font); group.append(fontLabel); appearance.append(group);
    }
    addControl(appearance, 'Background color', caption.backgroundColor, backgroundColor => patch({ captionPreferences: { backgroundColor } }), 'color');
    const opacity = addControl(appearance, 'Background opacity %', caption.backgroundOpacity, backgroundOpacity => patch({ captionPreferences: { backgroundOpacity } }), 'number'); opacity.min = '0'; opacity.max = '100'; panel.append(appearance);
    status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = statusText || (preferences().enabled ? 'Automatic subtitles enabled.' : 'Learning captions are off.'); panel.append(status);
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry retrieval'; retry.addEventListener('click', () => { stopped = false; void retrieve(); }); panel.append(retry);
    const audio = document.createElement('button'); audio.type = 'button'; audio.textContent = 'Use local audio transcription';
    audio.addEventListener('click', async () => {
      try {
        await patch({ youtubePreferences: { mode: 'audio' } });
        const response = await chrome.runtime.sendMessage({ type: 'START_EXPERIMENT', settings: { ...settings, youtubePreferences: { ...preferences(), mode: 'audio' } } });
        if (!response?.ok) throw new Error(response?.error || 'Local audio transcription failed.');
      } catch (error) { setStatus(error.message, 'warning'); }
    }); panel.append(audio);
    const captionsButton = document.createElement('button'); captionsButton.type = 'button'; captionsButton.textContent = 'Use YouTube subtitles'; captionsButton.addEventListener('click', () => updateSettings({ youtubePreferences: { mode: 'captions', enabled: true } })); panel.append(captionsButton);
    shadow.append(panel);
  }
  function mount() {
    const player = document.querySelector('#movie_player'), controls = player?.querySelector('.ytp-right-controls');
    if (!player || !controls) return;
    if (!controlsStyle) {
      controlsStyle = document.createElement('style');
      controlsStyle.textContent = '#movie_player.dub-transcript-menu-open .ytp-chrome-bottom { opacity: 1 !important; pointer-events: auto !important; }';
      document.documentElement.append(controlsStyle);
    }
    player.classList.toggle('dub-transcript-menu-open', menuOpen);
    const positionMenu = () => {
      if (!host?.isConnected) return;
      const bounds = player.getBoundingClientRect(), anchor = host.getBoundingClientRect();
      host.style.setProperty('--yt-panel-height', `${Math.max(80, bounds.height - 80)}px`);
      host.style.setProperty('--yt-panel-width', `${Math.max(140, bounds.width - 24)}px`);
      host.style.setProperty('--yt-panel-right', `${anchor.right - bounds.right + 12}px`);
    };
    if (host?.isConnected && host.parentElement === controls) { positionMenu(); return; }
    host?.remove(); host = document.createElement('span'); host.className = 'ytp-button'; host.style.cssText = 'display:inline-block;position:relative;width:48px;height:100%;vertical-align:top;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = `${globalThis.DubTypography?.css || ''}
      :host{font-family:var(--ui-font,Tahoma,sans-serif);color:#f5f5f0;text-align:left}
      button,select,input{font:inherit}button,select{cursor:pointer}.trigger{width:48px;height:100%;min-height:40px;border:0;background:transparent;color:white;display:grid;place-items:center}.trigger[aria-expanded=true]{color:#8dc49b}.trigger svg{width:25px;height:25px}
      .menu{position:absolute;bottom:calc(100% + 14px);right:var(--yt-panel-right,0px);width:min(330px,80vw,var(--yt-panel-width,80vw));max-height:min(65vh,520px,var(--yt-panel-height,65vh));overflow:auto;background:#111a14;border:1px solid #46644e;border-radius:12px;padding:16px;box-sizing:border-box;font-size:14px;line-height:1.5;box-shadow:0 8px 28px #0008;scrollbar-color:#46644e #111a14}.menu[hidden]{display:none}.menu strong{font-size:18px}label{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0}select{max-width:100%;width:100%;min-height:36px;background:#1c281f;color:#f5f5f0;border:1px solid #46644e;border-radius:6px}label:has(select){display:block}input[type=number]{width:70px}input[type=checkbox]{accent-color:#8dc49b;width:18px;height:18px}input[type=color]{width:48px}fieldset{border:1px solid #46644e;border-radius:7px}summary{cursor:pointer;font-weight:700}p{font-size:12px;color:#c2bfb5}button:not(.trigger){min-height:40px;margin:4px 0;padding:8px;border:1px solid #46644e;border-radius:6px;background:#1c281f;color:#f5f5f0;width:100%}:focus-visible{outline:2px solid #8dc49b;outline-offset:2px}`;
    shadow.append(style);
    const button = document.createElement('button'); button.className = 'trigger'; button.type = 'button'; button.title = 'Transcript Lab'; button.setAttribute('aria-label', 'Transcript Lab settings'); button.setAttribute('aria-expanded', String(menuOpen));
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 8h10M7 12h7M7 21h10"/></svg>';
    button.addEventListener('click', () => { menuOpen = !menuOpen; player.classList.toggle('dub-transcript-menu-open', menuOpen); panel.hidden = !menuOpen; button.setAttribute('aria-expanded', String(menuOpen)); });
    shadow.append(button); buildPanel(shadow);
    for (const name of ['click', 'pointerdown', 'keydown']) host.addEventListener(name, event => event.stopPropagation());
    shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); panel.hidden = true; menuOpen = false; player.classList.remove('dub-transcript-menu-open'); button.setAttribute('aria-expanded', 'false'); button.focus(); } });
    controls.prepend(host);
    positionMenu();
  }
  function tick() {
    if (disposed) return;
    const next = captions.videoId(location.href), media = document.querySelector('#movie_player video');
    mount();
    if (next && !media) return;
    if (next !== videoId || (hasSession && lastVideo && media !== lastVideo)) {
      invalidate(); videoId = next; selectedId = 'auto'; sourceTracks = []; stopped = false; lastVideo = media; drawTracks(); void retrieve();
    }
    if (hasSession) globalThis.DubYouTubeOverlay.suspend(Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')));
    if (hasSession && !audioProbePending && Date.now() - lastAudioProbe > 3000) {
      audioProbePending = true; lastAudioProbe = Date.now(); const epoch = generation;
      void snapshot().then(value => {
        if (epoch !== generation || !hasSession) return;
        const language = captions.language(value?.audioLanguage);
        if (language && language !== activeAudioLanguage) { selectedId = 'auto'; void retrieve(); }
      }).finally(() => { audioProbePending = false; });
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'YT_RETRIEVE_NOW') { stopped = false; void retrieve(); respond({ ok: true }); }
    if (message.type === 'YT_STOP') { stopped = true; invalidate(true); setStatus('Learning captions stopped for this video.', 'idle'); respond({ ok: true }); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.experimentSettings) return;
    const previous = signature; settings = changes.experimentSettings.newValue || {};
    signature = JSON.stringify([preferences(), settings.audioLanguage, learning.normalizeTranslationPreferences(settings.translationPreferences).targetLanguage, settings.translationPreferences?.enabled]);
    const focused = host?.shadowRoot?.activeElement;
    const focusIndex = focused ? [...host.shadowRoot.querySelectorAll('input,select,button,summary')].indexOf(focused) : -1;
    const expanded = [...(host?.shadowRoot?.querySelectorAll('details') || [])].map(detail => detail.open);
    const scroll = panel?.scrollTop || 0;
    host?.remove(); host = null; mount();
    [...(host?.shadowRoot?.querySelectorAll('details') || [])].forEach((detail, index) => { detail.open = Boolean(expanded[index]); });
    if (panel) panel.scrollTop = scroll;
    if (focusIndex >= 0) host?.shadowRoot.querySelectorAll('input,select,button,summary')[focusIndex]?.focus({ preventScroll: true });
    if (previous !== signature) { stopped = false; void retrieve(); }
  });
  document.addEventListener('pointerdown', event => { if (host && !event.composedPath().includes(host)) { menuOpen = false; document.querySelector('#movie_player')?.classList.remove('dub-transcript-menu-open'); if (panel) panel.hidden = true; host.shadowRoot.querySelector('.trigger').setAttribute('aria-expanded', 'false'); } }, true);
  let timer;
  window.addEventListener('pagehide', () => { disposed = true; invalidate(); host?.remove(); controlsStyle?.remove(); document.querySelector('#movie_player')?.classList.remove('dub-transcript-menu-open'); clearInterval(timer); });
  void chrome.storage.local.get('experimentSettings').then(stored => {
    settings = stored.experimentSettings || {}; signature = JSON.stringify([preferences(), settings.audioLanguage, learning.normalizeTranslationPreferences(settings.translationPreferences).targetLanguage, settings.translationPreferences?.enabled]);
    tick(); timer = setInterval(tick, 800);
  });
})();

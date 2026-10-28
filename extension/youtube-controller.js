(() => {
  if (globalThis.__dubYouTubeController) return;
  globalThis.__dubYouTubeController = true;
  const captions = globalThis.DubYouTubeCaptions;
  const learning = globalThis.DubTranscriptLearning;
  let settings = {}, videoId = null, generation = 0, requestId = '', selectedId = 'auto';
  let sourceTracks = [], playerMetadata = null, host = null, menuHost = null, panel = null, status = null, trackSelect = null;
  let menuOpen = false, hasSession = false, lastVideo = null, stopped = false, disposed = false;
  let activeAudioLanguage = '', lastAudioProbe = 0, audioProbePending = false;
  let signature = '', suppressStyle = null, controlsStyle = null;
  let statusText = '', statusLevel = 'idle';
  let notice = null, noticeTimer = null, preparationText = '', playbackNotice = '';
  let playback = null, playbackMedia = null, playbackVideoId = null, playbackState = {};
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
  function renderNotice() {
    if (!notice) return;
    const text = [preparationText, playbackNotice].filter(Boolean).join(' · ');
    const visible = Boolean(text) && !document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
    if (text && text !== notice.textContent) notice.textContent = text;
    notice.hidden = !notice.textContent;
    notice.dataset.visible = String(visible);
    notice.setAttribute('aria-hidden', String(!visible));
  }
  function setStatus(text, level = 'working', compactText = '') {
    statusText = text; statusLevel = level;
    clearTimeout(noticeTimer);
    preparationText = level === 'idle' ? '' : compactText || (level === 'success' ? 'Subtitles ready' : text);
    renderNotice();
    if (level === 'success') noticeTimer = setTimeout(() => { preparationText = ''; renderNotice(); }, 2000);
    renderMenuStatus();
    if (requestId) void request('YOUTUBE_STATE', { stage: level === 'success' ? 'YouTube captions ready' : level === 'warning' ? hasSession ? 'YouTube captions ready with a warning' : 'YouTube captions unavailable' : level === 'idle' ? 'YouTube captions stopped' : hasSession ? 'Preparing YouTube translation' : 'Retrieving YouTube captions', message: [text, playbackNotice].filter(Boolean).join(' '), level }).catch(() => {});
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
      setStatus('Preparing subtitles…');
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
          trackId: selectedId === 'auto' ? '' : track?.id, targetLanguage: '' });
        segments = result.segments; track = result.track; retrieval = 'yt-dlp';
        if (!track || captions.baseLanguage(track.language) !== captions.baseLanguage(language)) throw new Error('No source transcript matches the selected spoken language.');
        sourceTracks = result.tracks?.length ? result.tracks : [track]; drawTracks();
        platformTranslations = result.translationSegments || [];
      }
      if (!valid()) return;
      const translationPending = useYouTubeTranslation && !platformTranslations.length;
      const youtubeRequest = { videoId: id, requestId };
      globalThis.DubYouTubeOverlay.start({ experimentId: `youtube-preview-${requestId}`, segments,
        captionPreferences: settings.captionPreferences, translationPreferences: settings.translationPreferences,
        audioLanguage: track.language, syncOffset: Number(settings.syncOffset) || 0,
        platformTranslations, platformTranslationLanguage: platformTranslations.length ? targetLanguage : '',
        platformTranslationPending: translationPending, youtubeRequest,
        sourceVideo: { key: captions.cacheIdentity(id, track), title: metadata?.title || document.title,
          url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube' } });
      hasSession = true;
      activeAudioLanguage = captions.language(metadata?.audioLanguage);
      globalThis.DubYouTubeOverlay.suspend(Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')));
      suppressStyle = document.createElement('style');
      suppressStyle.textContent = '#movie_player:not(.ad-showing):not(.ad-interrupting) .ytp-caption-window-container { visibility: hidden !important; }';
      document.documentElement.append(suppressStyle);
      const sourceStatus = `${cached ? 'Saved' : 'Using'} YouTube ${track.kind === 'manual' ? 'creator-provided subtitles' : 'automatic transcript'} (${track.language}).`;
      setStatus(sourceStatus, translationPending ? 'working' : 'success', translationPending ? 'Captions ready · preparing translation…' : 'Subtitles ready');
      // Neither optional translation nor persistence can delay source rendering.
      // Store source first, then bind target captions to that same library entry.
      let cacheWarning = '';
      const savedPromise = scoped(cached ? 'YOUTUBE_BIND_CACHE' : 'YOUTUBE_SAVE_TRANSCRIPT', { track, segments, duration,
        title: metadata?.title || document.title, retrieval, translationSegments: platformTranslations, targetLanguage })
        .catch(error => {
          if (valid()) cacheWarning = ` Video-history caching failed: ${error.message} Captions remain available in this tab.`;
          return null;
        });
      if (translationPending) {
        try {
          if (retrieval === 'yt-dlp') {
            const translated = await scoped('YOUTUBE_NATIVE_CAPTIONS', { language, duration, trackId: track.id, targetLanguage });
            if (translated.track?.id === track.id && translated.track?.language === track.language) platformTranslations = translated.translationSegments || [];
          } else if (track.url && track.translatable && (!metadata?.translationLanguages?.length || metadata.translationLanguages.includes(targetLanguage))) {
            platformTranslations = (await scoped('YOUTUBE_FETCH_CAPTIONS', { url: track.url, targetLanguage, duration })).segments;
          }
        } catch { /* Keep source visible; use Chrome/configured Cloud for visible cues. */ }
        if (!valid()) return;
        globalThis.DubYouTubeOverlay.update({ youtubeRequest, platformTranslations,
          platformTranslationLanguage: platformTranslations.length ? targetLanguage : '', platformTranslationPending: false });
      }
      if (!valid()) return;
      const readyText = `${sourceStatus} ${platformTranslations.length ? 'YouTube translation ready.' : 'Translation uses the extension provider when needed.'}`;
      setStatus(readyText, 'success');
      const saved = await savedPromise;
      if (!valid()) return;
      if (saved) {
        globalThis.DubYouTubeOverlay.update({ youtubeRequest, experimentId: saved.experimentId });
        if (translationPending && platformTranslations.length) {
          try { await scoped('YOUTUBE_BIND_CACHE', { track, translationSegments: platformTranslations, targetLanguage }); }
          catch (error) { if (valid()) cacheWarning = ` Translation caching failed: ${error.message} Captions remain available in this tab.`; }
        }
      }
      if (valid() && cacheWarning) setStatus(`${readyText}${cacheWarning}`, 'warning');
    } catch (error) { if (valid()) setStatus(error.message, 'warning'); }
  }
  async function patch(fields) {
    const response = await request('YOUTUBE_PATCH_SETTINGS', fields);
    settings = response.settings;
  }
  function updateSettings(fields) {
    void patch(fields).catch(error => setStatus(error.message, 'warning'));
  }
  function setMenuOpen(value, focusTrigger = false) {
    menuOpen = value;
    if (panel) panel.hidden = !value;
    document.querySelector('#movie_player')?.classList.toggle('dub-transcript-menu-open', value);
    const trigger = host?.shadowRoot?.querySelector('.trigger');
    trigger?.setAttribute('aria-expanded', String(value));
    if (focusTrigger) trigger?.focus();
  }
  function renderMenuStatus() {
    if (!status) return;
    status.dataset.level = statusLevel;
    status.title = statusText;
    status.setAttribute('aria-label', statusText || 'Settings save automatically');
    status.textContent = statusLevel === 'success' ? 'Subtitles ready · changes save automatically'
      : statusLevel === 'working' ? hasSession ? 'Captions ready · preparing translation…' : 'Preparing subtitles…'
      : statusLevel === 'warning' ? statusText : 'Changes save automatically';
  }
  function addControl(parent, label, value, change, type = 'checkbox', help = '') {
    const wrapper = document.createElement('label');
    const input = document.createElement('input'); input.type = type;
    let state;
    if (type === 'checkbox') {
      wrapper.className = 'toggle-row';
      const copy = document.createElement('span'); copy.className = 'toggle-copy';
      const title = document.createElement('span'); title.className = 'toggle-label'; title.textContent = label; copy.append(title);
      if (help) { const note = document.createElement('span'); note.className = 'toggle-help'; note.textContent = help; copy.append(note); }
      input.checked = Boolean(value); input.setAttribute('role', 'switch');
      const control = document.createElement('span'); control.className = 'toggle-control';
      state = document.createElement('span'); state.className = 'toggle-state'; state.textContent = value ? 'On' : 'Off'; state.setAttribute('aria-hidden', 'true');
      const track = document.createElement('span'); track.className = 'switch-track'; track.setAttribute('aria-hidden', 'true');
      control.append(state, input, track); wrapper.append(copy, control);
    } else {
      wrapper.className = 'field-row'; wrapper.textContent = label; input.value = value; wrapper.append(input);
    }
    input.addEventListener('change', () => { if (state) state.textContent = input.checked ? 'On' : 'Off'; });
    input.addEventListener('change', () => void change(type === 'checkbox' ? input.checked : input.value).catch(error => setStatus(error.message, 'warning')));
    parent.append(wrapper); return input;
  }
  function buildPanel(shadow) {
    panel = document.createElement('section'); panel.className = 'menu'; panel.hidden = !menuOpen;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Transcript Lab settings');
    const header = document.createElement('header'); header.className = 'menu-header';
    const heading = document.createElement('div');
    const brand = document.createElement('span'); brand.className = 'menu-eyebrow'; brand.textContent = 'TRANSCRIPT LAB';
    const title = document.createElement('h2'); title.className = 'menu-title'; title.textContent = 'Caption settings'; heading.append(brand, title);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'menu-close'; close.setAttribute('aria-label', 'Close caption settings');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    close.addEventListener('click', () => setMenuOpen(false, true)); header.append(heading, close);
    const body = document.createElement('div'); body.className = 'menu-body';
    panel.append(header, body);
    const source = document.createElement('section'); source.className = 'menu-group';
    addControl(source, 'Learning captions', preferences().enabled, enabled => patch({ youtubePreferences: { enabled } }));
    const trackLabel = document.createElement('label'); trackLabel.className = 'field-row'; trackLabel.textContent = 'Subtitle track';
    trackSelect = document.createElement('select'); trackSelect.addEventListener('change', () => {
      selectedId = trackSelect.value;
      const track = sourceTracks.find(item => item.id === selectedId);
      if (track && !playerMetadata?.audioLanguage && captions.baseLanguage(track.language) !== captions.baseLanguage(settings.audioLanguage)) void patch({ audioLanguage: track.language }).catch(error => setStatus(error.message, 'warning'));
      else void retrieve();
    });
    trackLabel.append(trackSelect); source.append(trackLabel); body.append(source); drawTracks();
    const advanced = document.createElement('details'); const advancedSummary = document.createElement('summary'); advancedSummary.textContent = 'Source & troubleshooting'; advanced.append(advancedSummary);
    const languageLabel = document.createElement('label'); languageLabel.className = 'field-row'; languageLabel.textContent = 'Spoken language fallback';
    const sourceLanguage = document.createElement('select');
    const languages = { de: 'German', en: 'English', ar: 'Arabic', ja: 'Japanese', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ru: 'Russian', ko: 'Korean', zh: 'Chinese', tr: 'Turkish', nl: 'Dutch', pl: 'Polish', uk: 'Ukrainian' };
    for (const [code, name] of Object.entries(languages)) sourceLanguage.append(new Option(name, code));
    sourceLanguage.value = settings.audioLanguage || 'de';
    sourceLanguage.addEventListener('change', () => updateSettings({ audioLanguage: sourceLanguage.value })); languageLabel.append(sourceLanguage); advanced.append(languageLabel);
    const caption = learning.normalizeCaptionPreferences(settings.captionPreferences);
    const tools = document.createElement('section'); tools.className = 'menu-group';
    const toolsHeading = document.createElement('h3'); toolsHeading.className = 'group-title'; toolsHeading.textContent = 'Learning tools'; tools.append(toolsHeading);
    addControl(tools, 'Highlight current word', caption.highlightCurrentWord, highlightCurrentWord => patch({ captionPreferences: { highlightCurrentWord } }), 'checkbox', 'Follow the word being spoken.');
    addControl(tools, 'Pause while hovering', caption.pauseOnWordHover, pauseOnWordHover => patch({ captionPreferences: { pauseOnWordHover } }), 'checkbox', 'Resume when you leave the word.');
    body.append(tools);
    const translation = learning.normalizeTranslationPreferences(settings.translationPreferences);
    const translationGroup = document.createElement('details'), translationSummary = document.createElement('summary'); translationSummary.textContent = 'Translation'; translationGroup.append(translationSummary);
    addControl(translationGroup, 'Show translation', translation.enabled, enabled => patch({ translationPreferences: { enabled } }));
    const targetLabel = document.createElement('label'); targetLabel.className = 'field-row'; targetLabel.textContent = 'Translation language';
    const target = document.createElement('select'); for (const [code, name] of Object.entries(languages)) target.append(new Option(name, code));
    target.value = translation.targetLanguage; target.addEventListener('change', () => updateSettings({ translationPreferences: { targetLanguage: target.value } })); targetLabel.append(target); translationGroup.append(targetLabel);
    const providerLabel = document.createElement('label'); providerLabel.className = 'field-row'; providerLabel.textContent = 'Translation source';
    const provider = document.createElement('select'); provider.append(new Option('YouTube, then extension', 'youtube'), new Option('Extension only', 'extension')); provider.value = preferences().translationSource;
    provider.addEventListener('change', () => updateSettings({ youtubePreferences: { translationSource: provider.value } })); providerLabel.append(provider); translationGroup.append(providerLabel); body.append(translationGroup);
    const appearance = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Caption appearance'; appearance.append(summary);
    for (const [label, preferencesKey, values] of [['Original', 'captionPreferences', caption], ['Translation', 'translationPreferences', translation]]) {
      const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = label; group.append(legend);
      const size = addControl(group, 'Font size', values.fontSize, fontSize => patch({ [preferencesKey]: { fontSize } }), 'number'); size.min = preferencesKey === 'captionPreferences' ? '16' : '12'; size.max = preferencesKey === 'captionPreferences' ? '52' : '42';
      addControl(group, 'Text color', values.textColor, textColor => patch({ [preferencesKey]: { textColor } }), 'color');
      addControl(group, 'Bold', values.bold, bold => patch({ [preferencesKey]: { bold } }));
      const fontLabel = document.createElement('label'); fontLabel.className = 'field-row'; fontLabel.textContent = 'Font'; const font = document.createElement('select');
      for (const [name, value] of [['Sans serif', 'sans'], ['Serif', 'serif'], ['Monospace', 'mono']]) font.append(new Option(name, value)); font.value = values.fontFamily;
      font.addEventListener('change', () => updateSettings({ [preferencesKey]: { fontFamily: font.value } })); fontLabel.append(font); group.append(fontLabel); appearance.append(group);
    }
    addControl(appearance, 'Background color', caption.backgroundColor, backgroundColor => patch({ captionPreferences: { backgroundColor } }), 'color');
    const opacity = addControl(appearance, 'Background opacity %', caption.backgroundOpacity, backgroundOpacity => patch({ captionPreferences: { backgroundOpacity } }), 'number'); opacity.min = '0'; opacity.max = '100'; body.append(appearance);
    const actions = document.createElement('div'); actions.className = 'menu-actions';
    const retry = document.createElement('button'); retry.className = 'menu-action'; retry.type = 'button'; retry.textContent = 'Retry subtitle retrieval'; retry.addEventListener('click', () => { stopped = false; void retrieve(); }); actions.append(retry);
    const audio = document.createElement('button'); audio.type = 'button'; audio.textContent = 'Use local audio transcription';
    audio.className = 'menu-action';
    audio.addEventListener('click', async () => {
      try {
        await patch({ youtubePreferences: { mode: 'audio' } });
        const response = await chrome.runtime.sendMessage({ type: 'START_EXPERIMENT', settings: { ...settings, youtubePreferences: { ...preferences(), mode: 'audio' } } });
        if (!response?.ok) throw new Error(response?.error || 'Local audio transcription failed.');
      } catch (error) { setStatus(error.message, 'warning'); }
    }); actions.append(audio);
    const captionsButton = document.createElement('button'); captionsButton.className = 'menu-action'; captionsButton.type = 'button'; captionsButton.textContent = 'Use YouTube subtitles'; captionsButton.addEventListener('click', () => updateSettings({ youtubePreferences: { mode: 'captions', enabled: true } })); actions.append(captionsButton);
    advanced.append(actions); body.append(advanced);
    const footer = document.createElement('footer'); footer.className = 'menu-footer';
    status = document.createElement('p'); status.className = 'menu-status'; status.tabIndex = 0; status.setAttribute('role', 'status'); renderMenuStatus(); footer.append(status); panel.append(footer);
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
      if (!host?.isConnected || !menuHost) return;
      const bounds = player.getBoundingClientRect(), anchor = host.getBoundingClientRect();
      const width = Math.max(140, Math.min(350, bounds.width - 24));
      const bottom = Math.max(12, bounds.bottom - anchor.top + 10);
      menuHost.style.setProperty('--yt-panel-height', `${Math.max(60, bounds.height - bottom - 12)}px`);
      menuHost.style.setProperty('--yt-panel-width', `${width}px`);
      menuHost.style.setProperty('--yt-panel-bottom', `${bottom}px`);
      menuHost.style.setProperty('--yt-panel-right', `${Math.max(12, Math.min(bounds.right - anchor.right, bounds.width - width - 12))}px`);
    };
    if (host?.isConnected && host.parentElement === controls && menuHost?.isConnected && menuHost.parentElement === player) { positionMenu(); return; }
    host?.remove(); menuHost?.remove();
    host = document.createElement('span'); host.className = 'ytp-button'; host.style.cssText = 'display:inline-block;position:relative;width:48px;height:100%;vertical-align:top;pointer-events:auto;';
    // Native controls may clip their children. Keep only the icon in that
    // ancestry; the panel gets an isolated, fullscreen-safe player-level layer.
    menuHost = document.createElement('div'); menuHost.className = 'dub-transcript-player-menu';
    menuHost.style.cssText = 'all:initial;position:absolute;inset:0;z-index:2147483647;pointer-events:none;';
    const menuShadow = menuHost.attachShadow({ mode: 'open' });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${globalThis.DubTypography?.css || ''}\n${globalThis.DubYouTubeMenu.css}`;
    shadow.append(style);
    const button = document.createElement('button'); button.className = 'trigger'; button.type = 'button'; button.title = 'Transcript Lab'; button.setAttribute('aria-label', 'Transcript Lab settings'); button.setAttribute('aria-expanded', String(menuOpen));
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 8h10M7 12h7M7 21h10"/></svg>';
    button.addEventListener('click', () => setMenuOpen(!menuOpen));
    shadow.append(button); menuShadow.append(style.cloneNode(true)); buildPanel(menuShadow);
    notice = document.createElement('div'); notice.className = 'preparation-notice';
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); menuShadow.append(notice); renderNotice();
    for (const owner of [host, menuHost]) {
      for (const name of ['click', 'pointerdown', 'keydown']) owner.addEventListener(name, event => event.stopPropagation());
      owner.shadowRoot.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); setMenuOpen(false, true); } });
    }
    controls.prepend(host);
    player.append(menuHost);
    positionMenu();
  }
  function tick() {
    if (disposed) return;
    const next = captions.videoId(location.href), media = document.querySelector('#movie_player video');
    mount();
    if (next && !media) return;
    if (next !== playbackVideoId || media !== playbackMedia) {
      playback?.dispose(); playback = null; playbackMedia = media;
      if (next !== playbackVideoId) { playbackState = {}; playbackNotice = ''; preparationText = ''; clearTimeout(noticeTimer); }
      playbackVideoId = next;
      if (next && media) playback = globalThis.DubYouTubePlayback.create({ media, state: playbackState,
        eligible: () => !disposed && !document.hidden && !stopped && preferences().enabled && preferences().mode !== 'audio'
          && playerMetadata?.videoId === next
          && !document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'),
        report: (message, detail) => {
          playbackNotice = message; renderNotice();
          if (requestId) void request('YOUTUBE_OVERLAY_DIAGNOSTIC', { kind: 'playback', value: detail }).catch(() => {});
        } });
    }
    void playback?.tick(); renderNotice();
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
  // Capture explicit playback intent before a deferred initial attempt. Settings
  // clicks and word selection do not count as playback commands.
  const playbackIntent = event => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)) return;
    const path = event.composedPath();
    if (path.includes(host) || path.includes(menuHost) || !path.includes(document.querySelector('#movie_player'))) return;
    if ((event.type === 'keydown' && [' ', 'k', 'K', 'MediaPlayPause'].includes(event.key))
      || (event.type === 'pointerdown' && (event.target === playbackMedia || event.target.closest?.('.ytp-play-button, .ytp-large-play-button')))) playback?.interrupt();
  };
  for (const name of ['keydown', 'pointerdown']) document.addEventListener(name, playbackIntent, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.experimentSettings) return;
    const previous = signature; settings = changes.experimentSettings.newValue || {};
    signature = JSON.stringify([preferences(), settings.audioLanguage, learning.normalizeTranslationPreferences(settings.translationPreferences).targetLanguage, settings.translationPreferences?.enabled]);
    const focused = menuHost?.shadowRoot?.activeElement;
    const focusIndex = focused ? [...menuHost.shadowRoot.querySelectorAll('input,select,button,summary')].indexOf(focused) : -1;
    const triggerFocused = Boolean(host?.shadowRoot?.activeElement);
    const expanded = [...(menuHost?.shadowRoot?.querySelectorAll('details') || [])].map(detail => detail.open);
    const scroll = panel?.querySelector('.menu-body')?.scrollTop || 0;
    host?.remove(); menuHost?.remove(); host = null; menuHost = null; mount();
    [...(menuHost?.shadowRoot?.querySelectorAll('details') || [])].forEach((detail, index) => { detail.open = Boolean(expanded[index]); });
    const body = panel?.querySelector('.menu-body'); if (body) body.scrollTop = scroll;
    if (focusIndex >= 0) menuHost?.shadowRoot.querySelectorAll('input,select,button,summary')[focusIndex]?.focus({ preventScroll: true });
    else if (triggerFocused) host?.shadowRoot.querySelector('.trigger')?.focus({ preventScroll: true });
    if (previous !== signature) { stopped = false; void retrieve(); }
  });
  document.addEventListener('pointerdown', event => { if (host && !event.composedPath().includes(host) && !event.composedPath().includes(menuHost)) { menuOpen = false; document.querySelector('#movie_player')?.classList.remove('dub-transcript-menu-open'); if (panel) panel.hidden = true; host.shadowRoot.querySelector('.trigger').setAttribute('aria-expanded', 'false'); } }, true);
  let timer;
  window.addEventListener('pagehide', () => { disposed = true; invalidate(); playback?.dispose(); clearTimeout(noticeTimer);
    for (const name of ['keydown', 'pointerdown']) document.removeEventListener(name, playbackIntent, true);
    host?.remove(); menuHost?.remove(); controlsStyle?.remove(); document.querySelector('#movie_player')?.classList.remove('dub-transcript-menu-open'); clearInterval(timer); });
  void chrome.storage.local.get('experimentSettings').then(stored => {
    settings = stored.experimentSettings || {}; signature = JSON.stringify([preferences(), settings.audioLanguage, learning.normalizeTranslationPreferences(settings.translationPreferences).targetLanguage, settings.translationPreferences?.enabled]);
    tick(); timer = setInterval(tick, 800);
  });
})();

(() => {
  function create({ chrome, learning, captions, saveExperiment, saveLibrary, getLibrary, maxRecordBytes = 7500000 }) {
    const prefix = 'youtubeSession:';
    const controllers = new Map();
    let settingsQueue = Promise.resolve();
    let stateQueue = Promise.resolve();
    const key = sender => `${prefix}${sender.tab.id}`;
    async function validSender(sender, id) {
      if (sender.frameId !== 0 || !sender.tab?.id || captions.videoId(sender.tab.url) !== id) throw new Error('YouTube video changed; retry on the current video.');
      const tab = chrome.tabs.get ? await chrome.tabs.get(sender.tab.id) : sender.tab;
      if (captions.videoId(tab.url) !== id) throw new Error('YouTube video changed; stale result discarded.');
    }
    async function current(message, sender) {
      await validSender(sender, message.videoId);
      const state = (await chrome.storage.session.get(key(sender)))[key(sender)];
      if (!state || state.requestId !== message.requestId) throw new Error('Previous YouTube request cancelled.');
      return state;
    }
    async function stateWrite(sender, state, scope = 'bind') {
      const task = stateQueue.catch(() => {}).then(async () => {
        await validSender(sender, state.videoId);
        const latest = (await chrome.storage.session.get(key(sender)))[key(sender)];
        if (scope === 'begin' && latest?.documentId === state.documentId && Number.isFinite(state.requestEpoch)
          && Number.isFinite(latest?.requestEpoch) && latest.requestEpoch >= state.requestEpoch) throw new Error('Previous YouTube request cancelled.');
        if (scope !== 'begin' && latest?.requestId !== state.requestId) throw new Error('Previous YouTube request cancelled.');
        let value = state;
        if (scope !== 'begin') {
          const details = new Map((latest.details || []).map(item => [item.label, item]));
          for (const item of state.details || []) details.set(item.label, item);
          value = scope === 'status' ? { ...latest, stage: state.stage, level: state.level, message: state.message }
            : { ...latest, ...(scope === 'bind' ? { experimentId: state.experimentId } : {}), details: [...details.values()].slice(-8) };
        }
        await chrome.storage.session.set({ [key(sender)]: value });
        void chrome.runtime.sendMessage({ type: 'UI_DIAGNOSTICS_UPDATED' }).catch(() => {});
      });
      stateQueue = task; return task;
    }
    async function nativeCaptions(message, sender) {
      await current(message, sender);
      return new Promise((resolve, reject) => {
        let done = false, values = [], translations = [];
        const port = chrome.runtime.connectNative('com.dub_transcript_lab.recognizer');
        const jobId = `youtube-captions-${crypto.randomUUID()}`;
        const finish = (error, value) => {
          if (done) return; done = true; clearTimeout(timer);
          try { port.postMessage({ command: 'cancel_batch', jobId }); port.disconnect(); } catch { /* Already disconnected. */ }
          controllers.delete(sender.tab.id);
          if (error) reject(new Error(error)); else resolve(value);
        };
        const timer = setTimeout(() => finish('Subtitle-only local helper timed out. No audio transcription was started.'), 45000);
        controllers.set(sender.tab.id, { abort: () => finish('Previous subtitle retrieval cancelled.') });
        port.onMessage.addListener(value => {
          if (value.jobId !== jobId) return;
          if (value.state === 'batch_captions') values.push(...(value.segments || []));
          if (value.state === 'batch_translation_captions') translations.push(...(value.segments || []));
          if (value.state === 'batch_error') finish('The subtitle-only local helper could not retrieve this track.');
          if (value.state === 'batch_complete') {
            if (value.captionsOnly !== true) { finish('The installed helper does not support caption-only retrieval. Update the extension helper before retrying.'); return; }
            let translated = [];
            try { if (translations.length) translated = captions.normalizeCues(translations, message.duration); } catch { /* Translation must not discard the original. */ }
            try { finish(null, { segments: captions.normalizeCues(values, message.duration), track: value.track,
              tracks: value.tracks || [], translationSegments: translated, retrieval: 'yt-dlp' }); } catch (error) { finish(error.message); }
          }
        });
        port.onDisconnect.addListener(() => finish('Subtitle-only local helper disconnected. Check local setup or retry.'));
        port.postMessage({ command: 'batch_transcribe', jobId, captionsOnly: true,
          sourceKind: 'youtube', sourceUrl: `https://www.youtube.com/watch?v=${message.videoId}`,
          language: message.language, trackId: message.trackId || '', targetLanguage: message.targetLanguage || '' });
      });
    }
    async function handle(message, sender) {
      if (message.type === 'YOUTUBE_CANCEL') {
        // Navigation may already have changed the video URL. Cancel only the
        // matching top-frame request; never let its late cleanup stop a new one.
        if (sender.frameId !== 0 || !sender.tab?.id || !captions.videoId(sender.tab.url)) return {};
        const task = stateQueue.catch(() => {}).then(async () => {
          const state = (await chrome.storage.session.get(key(sender)))[key(sender)];
          if (state?.requestId !== message.requestId) return;
          controllers.get(sender.tab.id)?.abort(); controllers.delete(sender.tab.id);
          await chrome.storage.session.set({ [key(sender)]: { ...state, requestId: null, level: 'idle',
            stage: 'YouTube captions stopped', message: 'Previous caption retrieval cancelled. No audio transcription was started.' } });
        });
        stateQueue = task; await task; return {};
      }
      if (message.type === 'YOUTUBE_PATCH_SETTINGS') {
        const task = settingsQueue.catch(() => {}).then(async () => {
          const stored = (await chrome.storage.local.get('experimentSettings')).experimentSettings || {};
          const update = { ...stored };
          if (message.captionPreferences) update.captionPreferences = learning.normalizeCaptionPreferences({ ...stored.captionPreferences, ...message.captionPreferences });
          if (message.translationPreferences) update.translationPreferences = learning.normalizeTranslationPreferences({ ...stored.translationPreferences, ...message.translationPreferences });
          if (message.youtubePreferences) update.youtubePreferences = learning.normalizeYouTubePreferences({ ...stored.youtubePreferences, ...message.youtubePreferences });
          if (message.audioLanguage) update.audioLanguage = captions.language(message.audioLanguage);
          await chrome.storage.local.set({ experimentSettings: update });
          return { settings: update };
        });
        settingsQueue = task; return task;
      }
      if (message.type === 'YOUTUBE_BEGIN') {
        await validSender(sender, message.videoId);
        controllers.get(sender.tab.id)?.abort(); controllers.delete(sender.tab.id);
        const state = { videoId: message.videoId, requestId: String(message.requestId).slice(0, 100),
          documentId: sender.documentId || null, requestEpoch: Number.isSafeInteger(message.requestEpoch) ? message.requestEpoch : null,
          stage: 'Discovering YouTube captions', level: 'working', message: 'Looking for creator-provided subtitles, then original automatic captions.', details: [] };
        await stateWrite(sender, state, 'begin'); return {};
      }
      const state = await current(message, sender);
      if (message.type === 'YOUTUBE_STATE') {
        state.stage = String(message.stage || '').slice(0, 120);
        state.level = ['working', 'success', 'warning', 'idle'].includes(message.level) ? message.level : 'warning';
        state.message = String(message.message || '').slice(0, 700);
        // State text comes from our adapter; sanitize even ephemeral diagnostic strings.
        state.message = globalThis.DubPersistenceSafety.project({ message: state.message }).message;
        await stateWrite(sender, state, 'status'); return {};
      }
      if (message.type === 'YOUTUBE_NATIVE_CAPTIONS') return nativeCaptions(message, sender);
      if (message.type === 'YOUTUBE_FETCH_CAPTIONS') {
        controllers.get(sender.tab.id)?.abort();
        const controller = new AbortController(); controllers.set(sender.tab.id, controller);
        const timer = setTimeout(() => controller.abort(), 18000);
        try {
          const url = captions.captionUrl(message.url, message.videoId, message.targetLanguage);
          const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
          if (!response.ok) throw new Error(`Caption request returned HTTP ${response.status}.`);
          if (Number(response.headers?.get('content-length')) > 8000000) throw new Error('Caption response is too large.');
          const reader = response.body?.getReader();
          let text = '';
          if (reader) {
            const decoder = new TextDecoder(); let bytes = 0;
            while (true) {
              const part = await reader.read(); if (part.done) break;
              bytes += part.value.byteLength;
              if (bytes > 8000000) { await reader.cancel(); throw new Error('Caption response is too large.'); }
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          } else text = await response.text();
          if (text.length > 8000000) throw new Error('Caption response is too large.');
          await current(message, sender);
          return { segments: captions.parseJson3(JSON.parse(text), message.duration) };
        } finally { clearTimeout(timer); if (controllers.get(sender.tab.id) === controller) controllers.delete(sender.tab.id); }
      }
      if (message.type === 'YOUTUBE_GET_CACHE') {
        const identity = captions.cacheIdentity(message.videoId, message.track);
        const record = await getLibrary(learning.transcriptStorageKey(identity));
        return { record: record?.identity === identity && record.transcriptSource?.provider === 'youtube' && record.transcriptSource.sourceVersion === 1 ? record : null };
      }
      if (message.type === 'YOUTUBE_BIND_CACHE') {
        const identity = captions.cacheIdentity(message.videoId, message.track);
        const record = await getLibrary(learning.transcriptStorageKey(identity));
        if (record?.identity !== identity || record.transcriptSource?.provider !== 'youtube' || record.transcriptSource.sourceVersion !== 1) throw new Error('Saved YouTube captions are unavailable.');
        if (message.translationSegments?.length) {
          const segments = captions.normalizeCues(message.translationSegments, record.duration);
          const existing = record.transcriptTranslations?.find(item => item.targetLanguage === message.targetLanguage);
          if (!existing || JSON.stringify(existing.segments) !== JSON.stringify(segments)) {
            const translations = [{ targetLanguage: captions.language(message.targetLanguage), provider: 'youtube', segments },
              ...(record.transcriptTranslations || []).filter(item => item.targetLanguage !== message.targetLanguage)].slice(0, 2);
            await current(message, sender);
            await saveLibrary({ id: record.sourceExperimentId, platform: 'youtube', audioLanguage: record.audioLanguage,
              transcriptSource: record.transcriptSource, transcriptTranslations: translations, captionSegments: record.segments,
              page: { title: record.title, url: record.url, videoIdentity: record.identity, duration: record.duration } });
          }
        }
        state.experimentId = record.sourceExperimentId;
        state.details = [{ label: 'Source', value: `${record.transcriptSource.kind} · ${record.audioLanguage} · saved caption replay` },
          { label: 'Audio recognition', value: 'Not run' }];
        await stateWrite(sender, state); return { experimentId: record.sourceExperimentId };
      }
      if (message.type === 'YOUTUBE_OVERLAY_DIAGNOSTIC') {
        const labels = { voice: 'Pronunciation', timing: 'Word timing', dictionary: 'Word card information', status: 'Overlay notice' };
        if (!labels[message.kind]) return {};
        const value = globalThis.DubPersistenceSafety.project({ message: String(message.value || '').slice(0, 800) }).message;
        state.details = [...(state.details || []).filter(item => item.label !== labels[message.kind]), { label: labels[message.kind], value }].slice(-8);
        await stateWrite(sender, state, 'details'); return {};
      }
      if (message.type === 'YOUTUBE_SAVE_TRANSCRIPT') {
        const track = message.track;
        if (!track || !['manual', 'automatic'].includes(track.kind) || !track.id || !track.language) throw new Error('Missing caption provenance.');
        const segments = captions.normalizeCues(message.segments, message.duration);
        const identity = captions.cacheIdentity(message.videoId, track);
        const id = `youtube-${crypto.randomUUID()}`;
        const source = { sourceVersion: 1, provider: 'youtube', kind: `youtube-${track.kind}-caption`, language: String(track.language).slice(0, 32),
          trackId: String(track.id).slice(0, 240), name: String(track.name || '').slice(0, 180), retrieval: message.retrieval === 'yt-dlp' ? 'yt-dlp' : 'browser', timing: 'platform-cue' };
        const record = { schemaVersion: 4, id, createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
          platform: 'youtube', page: { title: String(message.title || sender.tab.title || 'YouTube video').slice(0, 300),
            url: `https://www.youtube.com/watch?v=${message.videoId}`, videoIdentity: identity, duration: Number(message.duration) || segments.at(-1).end },
          audioLanguage: source.language, captionLanguage: source.language, captionsUsedAsInput: true, transcriptSource: source,
          settings: {}, pipeline: { mode: 'youtube-captions', status: 'complete', sourceKind: source.kind },
          asrSegments: [], captionSegments: segments, audioCoverage: [], epochs: [], runtimeSamples: [],
          transcriptTranslations: message.translationSegments?.length ? [{ targetLanguage: captions.language(message.targetLanguage), provider: 'youtube',
            segments: captions.normalizeCues(message.translationSegments, message.duration) }] : [],
          evaluation: { status: 'not-applicable', note: 'Platform captions are the input; no audio recognition or agreement evaluation ran.' } };
        if (JSON.stringify(record).length * 2 > maxRecordBytes) throw new Error('This caption track exceeds the video-history cache limit.');
        await current(message, sender); await saveExperiment(record);
        await current(message, sender); await saveLibrary(record);
        await current(message, sender);
        state.experimentId = id; state.details = [{ label: 'Source', value: `${source.kind} · ${source.language} · ${source.retrieval}` },
          { label: 'Timing', value: 'YouTube cue timestamps; within-cue word timing is estimated' }, { label: 'Audio recognition', value: 'Not run' }];
        await stateWrite(sender, state);
        return { experimentId: id };
      }
      throw new Error('Unknown YouTube caption operation.');
    }
    async function visibleDiagnostics() {
      if (!chrome.tabs.query) return null;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !captions.videoId(tab.url)) return null;
      const settings = (await chrome.storage.local.get('experimentSettings')).experimentSettings || {};
      if (learning.normalizeYouTubePreferences(settings.youtubePreferences).mode === 'audio') return null;
      const state = (await chrome.storage.session.get(`${prefix}${tab.id}`))[`${prefix}${tab.id}`];
      return state?.videoId === captions.videoId(tab.url) ? { level: state.level, stage: state.stage, message: state.message,
        details: state.details || [], action: state.level === 'warning' ? 'Use the transcript button to retry or choose a track. Audio transcription is available only when explicitly selected.' : '' } : null;
    }
    function cancel(tabId) {
      controllers.get(tabId)?.abort(); controllers.delete(tabId);
      const task = stateQueue.catch(() => {}).then(() => chrome.storage.session.remove(`${prefix}${tabId}`));
      stateQueue = task;
    }
    return { handle, visibleDiagnostics, cancel };
  }
  globalThis.DubYouTubeWorker = { create };
})();

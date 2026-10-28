import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const events = new Map(), storageListeners = [], runtimeListeners = [], intervals = new Map();
let sequence = 0, response, cached = false, fetchBlocked = false, nativeFails = false, waitingFetch, starts = [], stops = [], suspended = [];
let translationBlocked = true, waitingTranslation, saveBlocked = true, waitingSave;
let translationFails = false, cacheFails = false;
const updates = [];
let settings = { audioLanguage: 'de', translationPreferences: { targetLanguage: 'ar' } };
const calls = [], styleNodes = [];
const id = 'abcdefghijk', nextId = 'zzzzzzzzzzz';
const location = { href: `https://www.youtube.com/watch?v=${id}`, origin: 'https://www.youtube.com' };
const media = { duration: 6, paused: true, readyState: 4, addEventListener() {}, removeEventListener() {}, play() { this.paused = false; return Promise.resolve(); } };
const player = { getPlayerResponse: () => response, getAudioTrack: () => ({ languageCode: 'de' }), querySelector: () => null, classList: { remove() {} } };
let ad = false;
const document = {
  title: 'A German video',
  querySelector(selector) {
    if (selector === '#movie_player') return player;
    if (selector === '#movie_player video') return media;
    if (selector.includes('.ad-showing')) return ad ? {} : null;
    return null;
  },
  addEventListener() {}, removeEventListener() {},
  createElement() { return { textContent: '', remove() { const index = styleNodes.indexOf(this); if (index >= 0) styleNodes.splice(index, 1); } }; },
  documentElement: { append(node) { styleNodes.push(node); } }
};
const window = {
  addEventListener(type, listener) { (events.get(type) || events.set(type, []).get(type)).push(listener); },
  postMessage(data) { for (const listener of events.get('message') || []) listener({ data, source: window, origin: location.origin }); }
};
const makeResponse = videoId => ({ videoDetails: { videoId, title: 'German video', lengthSeconds: '6' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [
    { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=de`, vssId: '.de', languageCode: 'de', name: { simpleText: 'German' }, isTranslatable: true },
    { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=de&kind=asr`, vssId: 'a.de', languageCode: 'de', kind: 'asr' }
  ], translationLanguages: [{ languageCode: 'ar' }] } } });
response = makeResponse(id);
const segments = [{ start: 0, end: 2, text: 'Hallo Welt.' }];
const context = vm.createContext({ console, URL, URLSearchParams, document, location, window, crypto: globalThis.crypto,
  setTimeout(fn, milliseconds) { if (milliseconds === 500) queueMicrotask(fn); return ++sequence; }, clearTimeout() {},
  setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
  DubYouTubeOverlay: { start(message) { starts.push(message); }, update(message) { updates.push(message); }, stop(resume) { stops.push(resume); }, suspend(value) { suspended.push(value); } },
  chrome: { runtime: {
    onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
    async sendMessage(message) {
      calls.push(message);
      if (message.type === 'YOUTUBE_GET_CACHE') return { ok: true, record: cached ? { segments, transcriptTranslations: [{ targetLanguage: 'ar', segments: [{ start: 0, end: 2, text: 'مرحبا' }] }] } : null };
      if (message.type === 'YOUTUBE_FETCH_CAPTIONS') {
        if (message.targetLanguage && translationBlocked) return new Promise(resolve => { waitingTranslation = resolve; });
        if (message.targetLanguage && translationFails) return { ok: false, error: 'Translation unavailable' };
        if (fetchBlocked) { fetchBlocked = false; return new Promise(resolve => { waitingFetch = resolve; }); }
        return { ok: true, segments: message.targetLanguage ? [{ start: 0, end: 2, text: 'مرحبا بالعالم' }] : segments };
      }
      if (message.type === 'YOUTUBE_SAVE_TRANSCRIPT' && saveBlocked) return new Promise(resolve => { waitingSave = resolve; });
      if (message.type === 'YOUTUBE_SAVE_TRANSCRIPT' && cacheFails) return { ok: false, error: 'Resource::kQuotaBytes quota exceeded' };
      if (message.type === 'YOUTUBE_SAVE_TRANSCRIPT' || message.type === 'YOUTUBE_BIND_CACHE') return { ok: true, experimentId: message.videoId };
      if (message.type === 'YOUTUBE_NATIVE_CAPTIONS') {
        if (message.targetLanguage && translationBlocked) return new Promise(resolve => { waitingTranslation = resolve; });
        return nativeFails ? { ok: false, error: 'No subtitles are available.' } : { ok: true, segments,
          translationSegments: message.targetLanguage ? [{ start: 0, end: 2, text: 'مرحبا' }] : [],
          track: { id: '.de', kind: 'manual', language: 'de', name: 'German' } };
      }
      return { ok: true };
    }
  }, storage: { local: { async get() { return { experimentSettings: settings }; } }, onChanged: { addListener(fn) { storageListeners.push(fn); } } } }
});
for (const file of ['learning-features.js', 'youtube-captions.js', 'youtube-page.js', 'youtube-menu.js', 'youtube-playback.js', 'youtube-controller.js']) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), context);
const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
const tick = () => { for (const fn of intervals.values()) fn(); };
await flush();
assert.equal(starts.length, 1, 'opening a video retrieves captions without Analyze');
assert.equal(starts[0].platformTranslationPending, true, 'source renders while translation and cache are blocked');
assert.equal(starts[0].audioLanguage, 'de');
translationBlocked = false;
waitingTranslation({ ok: true, segments: [{ start: 0, end: 2, text: 'مرحبا بالعالم' }] }); await flush();
assert.equal(updates.at(-1).platformTranslationLanguage, 'ar', 'translation attaches without waiting for storage');
assert.equal(starts.length, 1, 'translation does not restart the overlay');
saveBlocked = false; waitingSave({ ok: true, experimentId: id }); await flush();
assert.equal(calls.find(call => call.type === 'YOUTUBE_SAVE_TRANSCRIPT').track.kind, 'manual');
assert.ok(calls.every(call => !['START_EXPERIMENT', 'OFFSCREEN_START', 'START_BATCH'].includes(call.type)));
assert.equal(styleNodes.length, 1, 'native captions are visually suppressed only during an owned overlay');
ad = true; tick(); assert.equal(suspended.at(-1), true);
ad = false; tick(); assert.equal(suspended.at(-1), false);
assert.equal(media.paused, false, 'controller attempts playback after current-video metadata is ready');
cached = true;
const beforeFetch = calls.filter(call => call.type === 'YOUTUBE_FETCH_CAPTIONS').length;
location.href = `https://www.youtube.com/watch?v=${nextId}`; response = makeResponse(nextId); tick(); await flush();
assert.equal(starts.length, 2, 'SPA/playlist navigation retrieves the next transcript');
assert.equal(starts[1].sourceVideo.url, location.href);
assert.equal(calls.filter(call => call.type === 'YOUTUBE_FETCH_CAPTIONS').length, beforeFetch, 'cached source and target tracks need no caption fetch');
assert.equal(styleNodes.length, 1, 'old native-caption suppression is replaced, not accumulated');
cached = false; fetchBlocked = true;
runtimeListeners[0]({ type: 'YT_RETRIEVE_NOW' }, {}, () => {}); await flush();
const startsBefore = starts.length;
location.href = `https://www.youtube.com/watch?v=${id}`; response = makeResponse(id); tick(); await flush();
assert.equal(starts.length, startsBefore + 1);
waitingFetch({ ok: true, segments }); await flush();
assert.equal(starts.length, startsBefore + 1, 'late caption responses cannot resurrect a previous video');
translationBlocked = true;
runtimeListeners[0]({ type: 'YT_RETRIEVE_NOW' }, {}, () => {}); await flush();
const staleTranslation = waitingTranslation, oldRequest = starts.at(-1).youtubeRequest.requestId;
translationBlocked = false;
location.href = `https://www.youtube.com/watch?v=${nextId}`; response = makeResponse(nextId); tick(); await flush();
const updatesBefore = updates.length;
staleTranslation({ ok: true, segments: [{ start: 0, end: 2, text: 'old target' }] }); await flush();
assert.equal(updates.length, updatesBefore, 'late translation cannot update a newer overlay');
assert.notEqual(starts.at(-1).youtubeRequest.requestId, oldRequest);
translationFails = true; cacheFails = true;
runtimeListeners[0]({ type: 'YT_RETRIEVE_NOW' }, {}, () => {}); await flush();
assert.equal(starts.at(-1).segments[0].text, 'Hallo Welt.');
assert.equal(updates.filter(item => item.platformTranslations).at(-1).platformTranslations.length, 0);
assert.equal(updates.filter(item => item.platformTranslations).at(-1).platformTranslationPending, false, 'target failure releases extension-provider fallback');
assert.match(calls.filter(call => call.type === 'YOUTUBE_STATE').at(-1).message, /caching failed.*quota exceeded/);
translationFails = false; cacheFails = false;
response.captions.playerCaptionsTracklistRenderer.captionTracks = [];
translationBlocked = true;
const nativeBefore = calls.filter(call => call.type === 'YOUTUBE_NATIVE_CAPTIONS').length;
runtimeListeners[0]({ type: 'YT_RETRIEVE_NOW' }, {}, () => {}); await flush();
const nativeCalls = calls.filter(call => call.type === 'YOUTUBE_NATIVE_CAPTIONS').slice(nativeBefore);
assert.equal(nativeCalls[0].targetLanguage, '', 'native source request never waits for translation');
assert.equal(nativeCalls[1].targetLanguage, 'ar');
assert.equal(starts.at(-1).platformTranslationPending, true);
translationBlocked = false;
waitingTranslation({ ok: true, track: { id: '.de', language: 'de' }, translationSegments: [{ start: 0, end: 2, text: 'مرحبا' }] }); await flush();
assert.equal(updates.filter(item => item.platformTranslations).at(-1).platformTranslationLanguage, 'ar');
response = makeResponse(nextId);
settings = { ...settings, captionPreferences: { highlightCurrentWord: false, pauseOnWordHover: true } };
const beforePreference = calls.length;
storageListeners[0]({ experimentSettings: { newValue: settings } }, 'local'); await flush();
assert.equal(calls.length, beforePreference, 'word switches do not retrieve or transcribe again');
settings = { ...settings, youtubePreferences: { enabled: false } };
storageListeners[0]({ experimentSettings: { newValue: settings } }, 'local'); await flush();
assert.equal(styleNodes.length, 0);
assert.equal(stops.at(-1), true, 'disabling restores an extension-owned hover pause');
settings = { ...settings, youtubePreferences: { enabled: true } };
storageListeners[0]({ experimentSettings: { newValue: settings } }, 'local'); await flush();
assert.equal(styleNodes.length, 1);
runtimeListeners[0]({ type: 'YT_STOP' }, {}, () => {}); await flush(); tick(); await flush();
assert.equal(styleNodes.length, 0, 'explicit Stop is respected until retry or a new video');
nativeFails = true; location.href = 'https://www.youtube.com/watch?v=11111111111';
response = makeResponse('11111111111'); response.captions.playerCaptionsTracklistRenderer.captionTracks = [];
tick(); await flush();
assert.equal(calls.filter(call => call.type === 'YOUTUBE_STATE').at(-1).level, 'warning');
assert.ok(calls.every(call => call.type !== 'START_EXPERIMENT'), 'no captions must never launch audio transcription');
for (const fn of events.get('pagehide')) fn();
assert.equal(intervals.size, 0);
console.log('Real YouTube browser bridge/controller: automatic retrieval, creator priority, translations/cache, SPA navigation, ads, stale results, shared preferences, native-caption restoration and cleanup passed (player-menu layout unverified)');

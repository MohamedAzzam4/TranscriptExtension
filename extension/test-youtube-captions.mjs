import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const local = {}, session = {}, sent = [], native = [], tabs = new Map();
const listener = { addListener() {} };
let fetched = [], fetchImplementation;
const storage = values => ({
  async get(keys) { return typeof keys === 'string' ? { [keys]: values[keys] } : { ...values }; },
  async set(update) { Object.assign(values, structuredClone(update)); },
  async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
});
let context;
context = vm.createContext({ console, URL, URLSearchParams, crypto: globalThis.crypto, setTimeout, clearTimeout,
  AbortController, TextDecoder, structuredClone,
  importScripts(...files) { for (const file of files) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), context); },
  chrome: {
    runtime: { onMessage: listener, getManifest: () => ({ version: '0.12.0', permissions: ['unlimitedStorage'] }),
      async sendMessage(message) { sent.push(message); },
      connectNative() {
        let onMessage, onDisconnect;
        return { onMessage: { addListener(fn) { onMessage = fn; } }, onDisconnect: { addListener(fn) { onDisconnect = fn; } },
          postMessage(message) {
            native.push(message); if (message.command !== 'batch_transcribe') return;
            queueMicrotask(() => {
              onMessage({ jobId: message.jobId, state: 'batch_captions', segments: [{ start: 0, end: 2, text: 'Hallo Welt.' }] });
              onMessage({ jobId: message.jobId, state: 'batch_complete', captionsOnly: true, track: { id: '.de', kind: 'manual', language: 'de', name: 'German' } });
            });
          }, disconnect() { onDisconnect?.(); } };
      } },
    storage: { local: storage(local), session: storage(session) },
    tabs: { onRemoved: listener, onUpdated: listener, async get(id) { return tabs.get(id); }, async query() { return [tabs.get(7)]; }, async sendMessage() { return { ok: true }; } },
    scripting: { async executeScript() { return []; } }
  },
  async fetch(url, options) { fetched.push(String(url)); return fetchImplementation(url, options); }
});
vm.runInContext(fs.readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8'), context);
const yt = context.DubYouTubeCaptions, learning = context.DubTranscriptLearning;
const id = 'abcdefghijk', sourceUrl = `https://www.youtube.com/api/timedtext?v=${id}&lang=de&sig=SECRET`;
const sender = { tab: { id: 7, url: `https://www.youtube.com/watch?v=${id}`, title: 'A German video' }, frameId: 0 };
tabs.set(7, sender.tab);
const started = await context.startSmartExperiment({ youtubePreferences: { mode: 'captions' } });
assert.equal(started.mode, 'youtube-captions');
assert.equal(native.length, 0, 'the default YouTube start never opens an audio-recognition transport');
await assert.rejects(context.startSmartExperiment({ youtubePreferences: { enabled: false } }), /off/);
const raw = [
  { baseUrl: sourceUrl + '&kind=asr', languageCode: 'de', kind: 'asr', vssId: 'a.de', name: { simpleText: 'German automatic' } },
  { baseUrl: sourceUrl, languageCode: 'de', vssId: '.de', name: { runs: [{ text: 'German' }] }, isTranslatable: true },
  { baseUrl: sourceUrl + '&tlang=en', languageCode: 'en', vssId: '.en' },
  { baseUrl: 'https://evil.example/api/timedtext', languageCode: 'de' }
];
const tracks = yt.tracks(raw, id);
assert.equal(tracks.length, 2);
assert.equal(yt.selectTrack(tracks, 'de').kind, 'manual');
assert.equal(yt.selectTrack(tracks.slice(0, 1), 'de').kind, 'automatic');
assert.equal(yt.selectTrack(tracks, 'ar'), null);
assert.equal(yt.selectTrack(tracks, 'de', 'a.de').kind, 'automatic');
for (const value of ['http://www.youtube.com/api/timedtext', 'https://youtube.com.evil.test/api/timedtext', 'https://www.youtube.com/watch?v=x', sourceUrl + '&tlang=ar', sourceUrl.replace(id, 'zzzzzzzzzzz')]) assert.throws(() => yt.captionUrl(value, id));
assert.equal(new URL(yt.captionUrl(sourceUrl, id, 'ar')).searchParams.get('tlang'), 'ar');
assert.throws(() => yt.cacheIdentity(id, { id: 'secret?token=x', language: 'de', kind: 'manual' }));
const payload = { events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hallo ', tOffsetMs: 0 }, { utf8: 'Welt.', tOffsetMs: 800 }] },
  { tStartMs: 2500, dDurationMs: 1500, segs: [{ utf8: 'Wie geht es?' }] }
] };
const cues = yt.parseJson3(payload, 5);
assert.equal(cues[0].words[1].start, 0.8);
assert.equal(cues[0].timing, 'platform-word-offsets');
assert.equal(cues[1].timing, 'estimated-within-cue');
const rolling = yt.parseJson3({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hallo' }] }, { tStartMs: 500, dDurationMs: 1800, segs: [{ utf8: 'Hallo Welt' }] }] });
assert.equal(rolling.length, 1); assert.equal(rolling[0].text, 'Hallo Welt');
assert.throws(() => yt.normalizeCues([{ text: 'bad', start: 2, end: 1 }]));
assert.throws(() => yt.parseJson3({ events: [] }));
assert.throws(() => yt.normalizeCues([{ text: 'bad', start: 0, end: 500 }], 5));
assert.equal(yt.alignTranslation([{ start: 0, end: 1, text: 'مرحبا' }, { start: 1, end: 3, text: 'بالعالم' }], 0, 2), 'مرحبا بالعالم');
assert.equal(learning.normalizeCaptionPreferences({}).highlightCurrentWord, true);
assert.equal(learning.normalizeCaptionPreferences({}).pauseOnWordHover, false);
const handle = message => context.handleMessage({ videoId: id, requestId: 'one', ...message }, sender);
await handle({ type: 'YOUTUBE_BEGIN' });
fetchImplementation = async () => ({ ok: true, headers: { get() {} }, async text() { return JSON.stringify(payload); } });
const fetchedCues = await handle({ type: 'YOUTUBE_FETCH_CAPTIONS', url: sourceUrl, duration: 5 });
assert.equal(fetchedCues.segments.length, 2);
await handle({ type: 'YOUTUBE_SAVE_TRANSCRIPT', track: tracks[1], segments: fetchedCues.segments, duration: 5, retrieval: 'browser',
  translationSegments: [{ text: 'مرحبا بالعالم', start: 0, end: 2 }], targetLanguage: 'ar' });
const experimentKey = Object.keys(local).find(key => key.startsWith('experiment:'));
assert.deepEqual(local[experimentKey].asrSegments, []);
assert.deepEqual(local[experimentKey].audioCoverage, []);
assert.equal(local[experimentKey].captionsUsedAsInput, true);
assert.equal(local[experimentKey].transcriptSource.kind, 'youtube-manual-caption');
assert.equal(local[experimentKey].captionSegments[0].timing, 'platform-word-offsets');
assert.doesNotMatch(JSON.stringify(local), /SECRET|timedtext|sig=/);
const record = (await handle({ type: 'YOUTUBE_GET_CACHE', track: tracks[1] })).record;
assert.equal(record.transcriptTranslations[0].targetLanguage, 'ar');
assert.equal(record.transcriptSource.provider, 'youtube');
await Promise.all([
  handle({ type: 'YOUTUBE_STATE', level: 'success', stage: 'YouTube captions ready', message: 'Creator-provided German subtitles.' }),
  handle({ type: 'YOUTUBE_OVERLAY_DIAGNOSTIC', kind: 'timing', value: 'Estimated word timing.' })
]);
assert.equal(session['youtubeSession:7'].level, 'success');
assert.match(JSON.stringify(session['youtubeSession:7'].details), /Estimated word timing/);
await handle({ type: 'YOUTUBE_BIND_CACHE', track: tracks[1] });
assert.equal(Object.keys(local).filter(key => key.startsWith('experiment:')).length, 1, 'cached replay must not duplicate experiment cue payloads');
await Promise.all(['zzzzzzzzzzz', '11111111111'].map(videoId => context.saveTranscriptToLibrary({
  id: videoId, platform: 'youtube', audioLanguage: 'de', transcriptSource: record.transcriptSource,
  page: { title: videoId, url: `https://www.youtube.com/watch?v=${videoId}`, videoIdentity: yt.cacheIdentity(videoId, tracks[1]), duration: 5 },
  captionSegments: fetchedCues.segments
})));
assert.equal(local.transcriptLibraryIndex.length, 3, 'simultaneous tab completions retain every library entry');
const exported = await context.exportLastTranscriptText();
assert.match(exported.text, /youtube-manual-caption/); assert.match(exported.text, /Hallo Welt/);
await assert.rejects(handle({ type: 'YOUTUBE_SAVE_TRANSCRIPT', track: tracks[1], segments: cues, duration: 5,
  translationSegments: Array.from({ length: 2000 }, (_, index) => ({ start: index * 0.002, end: index * 0.002 + 0.001, text: 'x'.repeat(1900) })), targetLanguage: 'ar' }), /cache limit/);
await handle({ type: 'YOUTUBE_OVERLAY_DIAGNOSTIC', kind: 'voice', value: 'German voice ready.' });
assert.match(JSON.stringify((await context.getVisibleDiagnostics()).diagnostics), /German voice ready/);
await handle({ type: 'YOUTUBE_OVERLAY_DIAGNOSTIC', kind: 'playback', value: 'Chrome blocked automatic playback — press Play.' });
assert.match(JSON.stringify((await context.getVisibleDiagnostics()).diagnostics), /Playback.*Chrome blocked automatic playback/);
await handle({ type: 'YOUTUBE_PATCH_SETTINGS', captionPreferences: { highlightCurrentWord: false, pauseOnWordHover: true } });
assert.equal(local.experimentSettings.captionPreferences.pauseOnWordHover, true);
assert.equal(local.experimentSettings.captionPreferences.highlightCurrentWord, false);
await handle({ type: 'YOUTUBE_BEGIN', requestId: 'two' });
await assert.rejects(handle({ type: 'YOUTUBE_SAVE_TRANSCRIPT', track: tracks[1], segments: cues }), /cancelled/);
const nativeResult = await handle({ type: 'YOUTUBE_NATIVE_CAPTIONS', requestId: 'two', language: 'de', duration: 5 });
assert.equal(nativeResult.track.kind, 'manual');
assert.ok(native.some(message => message.captionsOnly === true));
assert.ok(native.every(message => !message.sourceUrl || message.sourceUrl.startsWith('https://www.youtube.com/watch?')));
await handle({ type: 'YOUTUBE_CANCEL', requestId: 'one' });
assert.equal(session['youtubeSession:7'].requestId, 'two', 'late cancellation cannot invalidate the next request');
await handle({ type: 'YOUTUBE_CANCEL', requestId: 'two' });
await assert.rejects(handle({ type: 'YOUTUBE_FETCH_CAPTIONS', requestId: 'two', url: sourceUrl }), /cancelled/);
await handle({ type: 'YOUTUBE_BEGIN', requestId: 'newer', requestEpoch: 10 });
await assert.rejects(handle({ type: 'YOUTUBE_BEGIN', requestId: 'older', requestEpoch: 9 }), /cancelled/);
assert.equal(session['youtubeSession:7'].requestId, 'newer');
tabs.set(7, { ...sender.tab, url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' });
await assert.rejects(handle({ type: 'YOUTUBE_FETCH_CAPTIONS', requestId: 'two', url: sourceUrl }), /changed/);
console.log('YouTube track priority, original-language guards, timing/rolling cues, translation alignment, real worker persistence/cache/export/privacy, stale navigation, settings and subtitle-only native transport passed');

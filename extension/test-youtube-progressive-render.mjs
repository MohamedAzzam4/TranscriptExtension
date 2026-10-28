import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const content = fs.readFileSync(new URL('./content.js', import.meta.url), 'utf8');
const shown = [], sent = [];
const request = { videoId: 'abcdefghijk', requestId: 'request-1' };
const originalSession = { youtubeCaptions: true, youtubeRequest: request,
  displayedText: 'Hallo Welt', displayedCue: { start: 0, end: 2 }, selectedWord: 'Welt',
  translationPreferences: { enabled: true, targetLanguage: 'ar', provider: 'browser' },
  translationPending: new Map(), translationCache: new Map(), platformTranslationPending: true };
const context = vm.createContext({ session: originalSession, translationElement: {}, shown,
  showTranslation: (...value) => shown.push(value),
  translationSessionKey: text => text,
  chrome: { runtime: { async sendMessage(message) { sent.push(message); return { ok: true, translatedText: 'مرحبا' }; } } },
  DubYouTubeCaptions: { alignTranslation: values => values[0]?.text }
});
vm.runInContext(content.slice(content.indexOf('  async function renderTranslation(text)'), content.indexOf('  function translationSessionKey')), context);
const api = content.slice(content.indexOf('  globalThis.DubYouTubeOverlay = '), content.indexOf('  globalThis.__dubTranscriptLabVersion = CONTENT_SCRIPT_VERSION;', content.indexOf('  globalThis.DubYouTubeOverlay = ')));
vm.runInContext(api, context);
await context.renderTranslation('Hallo Welt');
assert.equal(shown.at(-1)[1], 'pending'); assert.equal(sent.length, 0);
const update = { youtubeRequest: request, platformTranslations: [{ text: 'مرحبا بالعالم' }], platformTranslationLanguage: 'ar', platformTranslationPending: false };
context.DubYouTubeOverlay.update({ ...update, youtubeRequest: { ...request, requestId: 'old-request' } });
assert.equal(originalSession.platformTranslationPending, true, 'stale targets cannot update this overlay');
context.DubYouTubeOverlay.update(update);
assert.equal(shown.at(-1)[0], 'مرحبا بالعالم'); assert.equal(shown.at(-1)[1], 'ready');
assert.equal(context.session, originalSession, 'session is updated without rebuilding captions or word card');
assert.equal(originalSession.selectedWord, 'Welt'); assert.equal(originalSession.displayedText, 'Hallo Welt');
context.DubYouTubeOverlay.update({ youtubeRequest: request, experimentId: 'saved-id' });
assert.equal(originalSession.id, 'saved-id');
context.DubYouTubeOverlay.update({ youtubeRequest: request, platformTranslations: [], platformTranslationPending: false });
for (let index = 0; index < 15; index++) await Promise.resolve();
assert.equal(sent.length, 1, 'missing YouTube translation uses the extension provider after preparation');
assert.equal(shown.at(-1)[0], 'مرحبا');
console.log('Actual caption translation renderer: source stays present, pending state, in-place target update, stale guards and provider fallback passed');

const controller = fs.readFileSync(new URL('./youtube-controller.js', import.meta.url), 'utf8');
const timers = new Map(), diagnostics = [], notice = { textContent: '', dataset: {}, setAttribute(name, value) { this[name] = value; } };
let ad = false;
const feedback = vm.createContext({ notice, preparationText: '', playbackNotice: '', noticeTimer: null,
  statusText: '', statusLevel: 'idle', hasSession: false, requestId: 'current',
  document: { querySelector: () => ad ? {} : null }, renderMenuStatus() {},
  setTimeout(fn, delay) { timers.set(delay, fn); return delay; }, clearTimeout(id) { timers.delete(id); },
  request(type, value) { diagnostics.push({ type, ...value }); return Promise.resolve(); }
});
vm.runInContext(controller.slice(controller.indexOf('  function renderNotice()'), controller.indexOf('  function snapshot()')), feedback);
feedback.setStatus('Preparing subtitles…');
assert.equal(notice.dataset.visible, 'true'); assert.match(notice.textContent, /Preparing subtitles/);
feedback.hasSession = true; feedback.setStatus('Source ready; target downloading', 'working', 'Captions ready · preparing translation…');
assert.match(notice.textContent, /Captions ready/);
assert.equal(diagnostics.at(-1).stage, 'Preparing YouTube translation');
ad = true; feedback.renderNotice(); assert.equal(notice.dataset.visible, 'false');
ad = false; feedback.renderNotice(); assert.equal(notice.dataset.visible, 'true');
feedback.setStatus('Source and translation ready', 'success');
assert.ok(timers.has(2000)); timers.get(2000)();
assert.equal(notice.dataset.visible, 'false', 'ready feedback fades after two seconds');
assert.equal(notice['aria-hidden'], 'true');
assert.equal(diagnostics.at(-1).message, 'Source and translation ready', 'diagnostics retain the full status');
feedback.playbackNotice = 'Chrome blocked automatic playback — press Play.'; feedback.renderNotice();
assert.equal(notice.dataset.visible, 'true'); assert.match(notice.textContent, /press Play/);
console.log('Player preparation feedback: pending, translation-only stage, ad suppression, two-second dismissal and retained diagnostics passed');

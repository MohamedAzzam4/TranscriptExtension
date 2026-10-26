import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const local = {};
const listener = { addListener() {} };
let context;
context = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout, AbortController, structuredClone,
  importScripts(...files) { for (const file of files) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), context); },
  chrome: { runtime: { onMessage: listener, getManifest: () => ({ version: '0.11.0' }) },
    tabs: { onRemoved: listener, onUpdated: listener },
    storage: { local: { async get(key) { return typeof key === 'string' ? { [key]: local[key] } : { ...local }; },
      async set(update) { Object.assign(local, structuredClone(update)); } } } }
});
vm.runInContext(fs.readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8'), context);
const safety = context.DubPersistenceSafety;
const rawUrl = 'https://USER_SENTINEL:PASS_SENTINEL@example.org/episode?sig=SECRET_SENTINEL#token';
local.savedVocabulary = [{ word: 'helfen', normalizedWord: 'helfen', savedAt: 'old', context: 'Hilf mir.',
  video: { key: 'stable-id', url: rawUrl, title: 'Episode' }, authorization: 'SECRET_SENTINEL', pcm: [1,2], googleApiKey: 'SECRET_SENTINEL' }];
local['experiment:old'] = { id: 'old', schemaVersion: 4, page: { url: rawUrl, playerFrameUrl: rawUrl, title: 'Episode', videoIdentity: 'stable-id' },
  pipeline: { status: 'complete', sourceUrl: rawUrl, diagnostics: { error: 'https://example.org/file?sig=SECRET_SENTINEL', authorization: 'SECRET_SENTINEL' } },
  asrSegments: [{ id: 'cue', start: 0, end: 1, text: 'Hilf mir.', words: [{ text: 'Hilf', start: 0, end: 0.4 }] }], pcm: 'SECRET_SENTINEL' };
local['transcript-library:v1:old'] = { key: 'old', identity: 'stable-id', url: rawUrl, segments: local['experiment:old'].asrSegments, audio: 'SECRET_SENTINEL' };
local.translationSecrets = { googleApiKey: 'CONFIGURED_KEY_SENTINEL' };
await context.ensureSafePersistenceMigration();
const first = JSON.stringify(local);
await context.ensureSafePersistenceMigration();
assert.equal(JSON.stringify(local), first, 'migration is repeatable');
assert.equal(local.savedVocabulary.length, 1);
assert.equal(local.savedVocabulary[0].context, 'Hilf mir.');
assert.equal(local.savedVocabulary[0].video.url, 'https://example.org/episode');
assert.equal(local['experiment:old'].asrSegments[0].words[0].text, 'Hilf');
assert.equal(local['transcript-library:v1:old'].segments[0].id, 'cue');
assert.equal(local.translationSecrets.googleApiKey, 'CONFIGURED_KEY_SENTINEL');
assert.doesNotMatch(JSON.stringify([local.savedVocabulary, local['experiment:old'], local['transcript-library:v1:old']]), /SECRET_SENTINEL|USER_SENTINEL|PASS_SENTINEL/);
const safeYoutube = context.DubTranscriptLearning.stablePageUrl('https://user:pass@www.youtube.com/watch?v=abc123&sig=secret#fragment');
assert.equal(safeYoutube, 'https://www.youtube.com/watch?v=abc123');
assert.equal(safety.sanitizeRecord('experiment:x', local['experiment:old']).asrSegments[0].text, 'Hilf mir.');
delete local['safePersistenceMigration:v1'];
local['experiment:blocked'] = { id: 'blocked', page: { url: rawUrl }, asrSegments: [{ start: 0, end: 1, text: 'Original cue' }] };
const write = context.chrome.storage.local.set;
context.chrome.storage.local.set = async update => {
  if (Object.hasOwn(update, 'experiment:blocked')) throw new Error('simulated write failure');
  return write(update);
};
await assert.rejects(context.migrateSafePersistence(), /simulated write failure/);
assert.equal(local['experiment:blocked'].page.url, rawUrl, 'failed replacement keeps the original record');
assert.equal(local['safePersistenceMigration:v1'], undefined, 'failed migration has no success marker');
context.chrome.storage.local.set = write;
await context.migrateSafePersistence();
assert.equal(local['experiment:blocked'].asrSegments[0].text, 'Original cue');
assert.equal(local['experiment:blocked'].page.url, 'https://example.org/episode');
console.log('Safe record boundary, canonical links, migration and configured-key preservation passed');

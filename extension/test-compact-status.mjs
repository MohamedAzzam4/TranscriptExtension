import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual UI helpers with a fake clock: no browser or elapsed waits.
const source = fs.readFileSync(new URL('./content.js', import.meta.url), 'utf8');
const functions = ['meaningDisplayText', 'showTransientNotice', 'stopTransientNotice', 'renderStatus'];
const body = functions.map(name => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  function ', start + 5);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}).join('\n');
let now = 0;
let timerId = 0;
let reduced = false;
const timers = new Map();
const element = () => {
  const classes = new Set();
  return { hidden: true, textContent: '', classList: {
    add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
    toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
  }};
};
const status = element();
const context = vm.createContext({
  console, transientNotices: new Map(), statusElement: status, reportUiDiagnostic() {},
  matchMedia: () => ({ matches: reduced }),
  setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; },
  clearTimeout(id) { timers.delete(id); }
});
vm.runInContext(body, context);
function tick(milliseconds) {
  const until = now + milliseconds;
  while (true) {
    const next = [...timers.entries()].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  now = until;
}
const notice = element();
context.showTransientNotice(notice, 'Word timing: recognizer word timestamps');
tick(1900);
assert.equal(notice.hidden, false);
assert.equal(notice.classList.contains('notice-fading'), false);
context.showTransientNotice(notice, 'Word timing: recognizer word timestamps');
tick(100);
assert.equal(notice.classList.contains('notice-fading'), true, 'repeated frames must not restart the 2-second dwell');
tick(699);
assert.equal(notice.hidden, false);
tick(1);
assert.equal(notice.hidden, true);
context.showTransientNotice(notice, 'Word timing: recognizer word timestamps');
assert.equal(notice.hidden, true, 'same provenance must not flash again in the same session');
context.renderStatus('Cached transcript replay — audio is not being transcribed again.');
tick(2000);
context.renderStatus('Audio connection failed', true);
context.renderStatus('Cached transcript replay — audio is not being transcribed again.');
tick(10000);
assert.equal(status.hidden, false, 'old notice timer must not hide a new error');
assert.equal(status.textContent, 'Audio connection failed');
assert.equal(status.classList.contains('error'), true);
const cancelled = element();
context.showTransientNotice(cancelled, 'Cancelled notice');
context.stopTransientNotice(cancelled);
tick(10000);
assert.equal(cancelled.classList.contains('notice-fading'), false, 'cleanup cancels stale callbacks');
reduced = true;
const still = element();
context.showTransientNotice(still, 'Reduced motion notice');
tick(2000);
assert.equal(still.hidden, true, 'reduced motion keeps the dwell but skips the fade animation');
assert.equal(context.meaningDisplayText('[2] eine Entwicklung durchmachen', 2), '2. eine Entwicklung durchmachen');
assert.equal(context.meaningDisplayText('[1a] [2] Bedeutung', 3), '3. Bedeutung');
assert.equal(context.meaningDisplayText('[1, 2] explanation'), 'explanation');
assert.equal(context.meaningDisplayText('  [1.2a] explanation', 2), '2. explanation');
assert.equal(context.meaningDisplayText('Ordinary [2] reference', 1), '1. Ordinary [2] reference');
console.log('Compact notices: fake-clock dwell/fade, repeated frames, error safety, cleanup, reduced motion and meaning numbering passed');

// Exercise the real worker routing/session persistence using local Chrome mocks.
const local = {};
const sessionStorage = { activeExperiment: { experimentId: 'ui-test', tabId: 7, mediaFrameId: 3 } };
const storageArea = values => ({
  async get(key) {
    if (typeof key === 'string') return { [key]: values[key] };
    if (Array.isArray(key)) return Object.fromEntries(key.map(name => [name, values[name]]));
    return { ...values };
  },
  async set(update) { Object.assign(values, structuredClone(update)); }
});
function loadWorker() {
  const listener = { addListener() {} };
  let worker;
  worker = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout, structuredClone,
    importScripts(...files) { for (const file of files) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), worker); },
    chrome: {
      runtime: { onMessage: listener, getManifest: () => ({ version: '0.11.3' }), async sendMessage() {} },
      tabs: { onRemoved: listener, onUpdated: listener },
      storage: { local: storageArea(local), session: storageArea(sessionStorage) }
    }
  });
  vm.runInContext(fs.readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8'), worker);
  return worker;
}
const worker = loadWorker();
const sender = { tab: { id: 7 }, frameId: 3 };
for (const [kind, value] of Object.entries({ status: 'Cached transcript replay', timing: 'Recognizer word timestamps', voice: 'German voice ready (online): Example voice', dictionary: 'Dictionary definitions; highlights mark matching terms.' })) {
  await worker.handleMessage({ type: 'UI_DIAGNOSTIC', experimentId: 'ui-test', kind, value }, sender);
}
const snapshot = await worker.getVisibleDiagnostics();
assert.equal(snapshot.diagnostics.details.length, 4, 'popup retains all four details even with no experiment payload');
assert.ok(snapshot.diagnostics.details.some(detail => detail.label.startsWith('Pronunciation') && detail.value.includes('Example voice')));
const before = JSON.stringify(sessionStorage);
await worker.recordOverlayDiagnostic({ experimentId: 'ui-test', kind: 'voice', value: 'Wrong frame' }, { tab: { id: 7 }, frameId: 0 });
await worker.recordOverlayDiagnostic({ experimentId: 'stale-test', kind: 'voice', value: 'Stale experiment' }, sender);
assert.equal(JSON.stringify(sessionStorage), before);
const restarted = loadWorker();
assert.equal((await restarted.getOverlayDiagnosticDetails('ui-test')).length, 4, 'worker restart keeps session diagnostics');
sessionStorage.activeExperiment.experimentId = 'next-test';
assert.equal((await restarted.getOverlayDiagnosticDetails('next-test')).length, 0, 'new experiments do not display stale statuses');
await restarted.recordOverlayDiagnostic({ experimentId: 'next-test', kind: 'voice', value: 'Voice error https://user:pass@example.org/path?token=SECRET_SENTINEL' }, sender);
assert.doesNotMatch(JSON.stringify(await restarted.getOverlayDiagnosticDetails('next-test')), /SECRET_SENTINEL|user:pass/);
assert.equal(Object.keys(sessionStorage).filter(key => key.startsWith('overlayDiagnostic:')).length, 4, 'status updates use bounded session keys');
console.log('Popup UI diagnostics: routing, source-frame scope, sanitization, bounded storage and worker restart passed');

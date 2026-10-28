import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('./youtube-playback.js', import.meta.url), 'utf8'), context);
function fixture({ failure, state = {} } = {}) {
  const listeners = new Map(), reports = [];
  let eligible = true, calls = 0, resolver;
  const media = { paused: true, ended: false, readyState: 4,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    async play() {
      calls++;
      if (failure === 'pending') await new Promise(resolve => { resolver = resolve; });
      if (failure && failure !== 'pending') throw { name: failure };
      this.paused = false; listeners.get('play')?.();
    }
  };
  const controller = context.DubYouTubePlayback.create({ media, state, eligible: () => eligible,
    report: (...value) => reports.push(value) });
  return { media, controller, reports, listeners, state, get calls() { return calls; },
    allow(value) { eligible = value; }, resolve() { resolver(); } };
}
const initial = fixture();
initial.allow(false); await initial.controller.tick(); assert.equal(initial.calls, 0, 'ad/hidden/stale metadata blocks initial play');
initial.allow(true); initial.media.readyState = 0; await initial.controller.tick(); assert.equal(initial.calls, 0);
initial.media.readyState = 4; await initial.controller.tick(); await initial.controller.tick();
assert.equal(initial.calls, 1); assert.equal(initial.media.paused, false);
initial.media.paused = true; initial.listeners.get('pause')(); await initial.controller.tick();
assert.equal(initial.calls, 1, 'a later user or hover pause is never undone by polling');
for (const failure of ['NotAllowedError', 'NotSupportedError']) {
  const blocked = fixture({ failure }); await blocked.controller.tick(); await blocked.controller.tick();
  assert.equal(blocked.calls, 1); assert.match(blocked.reports.at(-1)[0], /press Play/);
  assert.equal(blocked.media.muted, undefined, 'never mute to bypass policy');
  blocked.listeners.get('play')(); assert.equal(blocked.reports.at(-1)[0], '', 'manual play clears blocked notice');
}
for (const interruption of ['interrupt', 'pause', 'playing', 'ended']) {
  const item = fixture();
  if (interruption === 'interrupt') item.controller.interrupt();
  if (interruption === 'pause') item.listeners.get('pause')();
  if (interruption === 'playing') item.media.paused = false;
  if (interruption === 'ended') item.media.ended = true;
  await item.controller.tick(); assert.equal(item.calls, 0, interruption);
}
const pending = fixture({ failure: 'pending' });
const attempt = pending.controller.tick(); pending.controller.dispose(); pending.resolve(); await attempt;
assert.equal(pending.reports.length, 0, 'disposed media cannot report into a new video');
assert.equal(pending.listeners.size, 0);
const replaced = fixture({ state: initial.state }); await replaced.controller.tick();
assert.equal(replaced.calls, 0, 'same-video media replacement preserves the attempt/user-intent state');
const navigation = fixture(); await navigation.controller.tick(); assert.equal(navigation.calls, 1, 'new video gets its own attempt');
console.log('YouTube initial playback: readiness, ads/visibility gate, once per video, user/hover pause, rejection, no forced mute, stale cleanup passed');

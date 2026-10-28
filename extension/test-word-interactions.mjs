import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const listeners = new Map(), timers = new Map(); let next = 0, plays = 0, pauses = 0;
const media = { paused: false, ended: false,
  addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name) { listeners.delete(name); },
  pause() { pauses++; this.paused = true; listeners.get('pause')?.(); },
  play() { plays++; this.paused = false; listeners.get('play')?.(); return Promise.resolve(); }
};
const context = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(new URL('./word-interactions.js', import.meta.url), 'utf8'), context);
const controller = context.DubWordInteractions.createHoverPause({ media,
  setTimer(fn) { const id = ++next; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); } });
const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
controller.enter(); assert.equal(pauses, 0, 'default hover pause is off');
controller.configure(true); controller.enter(); assert.equal(media.paused, true);
controller.leave(); controller.enter(); flush(); assert.equal(plays, 0, 'moving between adjacent words keeps pause ownership');
controller.leave(); flush(); assert.equal(plays, 1);
media.paused = true; controller.enter(); controller.leave(); flush(); assert.equal(plays, 1, 'an already-paused video remains paused');
media.paused = false; controller.enter(); controller.interrupt(); controller.leave(); flush(); assert.equal(plays, 1, 'manual pause intent prevents automatic resume');
media.paused = false; controller.enter(); controller.configure(false); assert.equal(plays, 2, 'disabling hover restores only owned playback');
controller.configure(true); controller.enter(); controller.dispose(false); flush(); assert.equal(plays, 2, 'navigation never starts the previous video');
assert.equal(listeners.size, 0);
// The real highlight renderer must preserve saved-word/selection state when off.
const content = fs.readFileSync(new URL('./content.js', import.meta.url), 'utf8');
const start = content.indexOf('  function updateCurrentWordHighlight(');
const finish = content.indexOf('\n  async function ', start);
const classes = new Set(['saved-word', 'selected']);
const span = { dataset: { start: '1', end: '2', timing: 'word-timestamps' }, classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } } };
const highlight = vm.createContext({
  transcriptElement: { dataset: {}, querySelectorAll: () => [span], querySelector: () => span },
  video: { currentTime: 1.5 }, session: { syncOffset: 0, captionPreferences: { highlightCurrentWord: true } },
  wordTimingProvenanceElement: {}, showTransientNotice() {}, reportUiDiagnostic() {}
});
vm.runInContext(content.slice(start, finish), highlight);
highlight.updateCurrentWordHighlight(); assert.equal(classes.has('current-word'), true);
vm.runInContext('session.captionPreferences.highlightCurrentWord = false;', highlight);
highlight.updateCurrentWordHighlight(); assert.equal(classes.has('current-word'), false);
assert.equal(classes.has('saved-word'), true); assert.equal(classes.has('selected'), true);
// Exercise actual stable-box listeners. pointerenter/leave are boundary events:
// moving between descendants does not leave the box or depend on a word target.
const delegated = {};
const attached = context.DubWordInteractions.createHoverPause({ media,
  setTimer(fn) { const id = ++next; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); } });
const wiring = vm.createContext({ captionBoxElement: { addEventListener(name, fn) { delegated[name] = fn; } }, hoverPause: attached });
const bindingStart = content.indexOf("    captionBoxElement.addEventListener('pointerenter'");
const bindingEnd = content.indexOf('\n    captionBoxElement.addEventListener("pointerdown"', bindingStart);
assert.ok(bindingStart >= 0 && bindingEnd > bindingStart);
vm.runInContext(content.slice(bindingStart, bindingEnd), wiring);
media.paused = false;
const previousPlays = plays, previousPauses = pauses;
delegated.pointerenter(); assert.equal(pauses, previousPauses, 'hover listener respects default-off');
attached.configure(true);
delegated.pointerenter();
assert.equal(media.paused, true, 'caption-box padding should pause without a word target');
flush(); assert.equal(plays, previousPlays, 'internal word/gap/translation movement has no box exit');
delegated.pointerleave(); flush(); assert.equal(plays, previousPlays + 1);
for (const region of ['original', 'translation', 'padding', 'drag handle']) {
  delegated.pointerenter(); assert.equal(media.paused, true, region);
  delegated.pointerleave(); flush(); assert.equal(media.paused, false, region);
}
delegated.pointerenter(); attached.interrupt();
const manualPlays = plays; delegated.pointerleave(); flush();
assert.equal(plays, manualPlays, 'box exit preserves explicit pause intent');
attached.dispose();
console.log('Caption-box hover ownership, default off, whole-box entry/exit, internal movement, manual pause, preference change, navigation and cleanup passed');

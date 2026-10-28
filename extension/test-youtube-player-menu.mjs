import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual menu creation/listeners/settings with a local DOM double.
// This verifies ownership outside clipped controls, not real browser CSS layout.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.listeners = {}; this.attributes = {}; this.className = ''; this.hidden = false;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      remove: name => this.classList.toggle(name, false),
      toggle: (name, value) => {
        const values = new Set(this.className.split(' ').filter(Boolean));
        if (value) values.add(name); else values.delete(name);
        this.className = [...values].join(' ');
      }
    };
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { this.append(node); this.children.unshift(this.children.pop()); }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  attachShadow() { this.shadowRoot = new Element('shadow'); this.shadowRoot.host = this; return this.shadowRoot; }
  get isConnected() { return this === root || Boolean((this.parentElement || this.host)?.isConnected); }
  getRootNode() { return this.parentElement?.getRootNode() || this; }
  focus() { this.getRootNode().activeElement = this; }
  cloneNode() { const copy = new Element(this.tagName); copy.textContent = this.textContent; return copy; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  async fire(name, fields = {}) {
    const event = { target: this, composedPath: () => [this, this.parentElement], stopPropagation() {}, preventDefault() {}, ...fields };
    for (const fn of this.listeners[name] || []) await fn(event);
  }
  matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : this.tagName.toLowerCase() === selector; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || selectors.some(value => child.matches(value)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return this === player ? { top: 100, bottom: 820, right: 1280, width: 1280, height: 720 } : { top: 770, bottom: 810, right: 1040, width: 48, height: 40 }; }
}
const root = new Element('document'), player = new Element('div');
let controls = new Element('div'); controls.className = 'ytp-right-controls'; controls.style.overflow = 'hidden';
root.append(player); player.append(controls);
assert.equal(player.querySelector('.ytp-right-controls'), controls);
const docListeners = {}, windowListeners = {}, storageListeners = [], intervals = [];
const requests = [];
let settings = { youtubePreferences: { enabled: false }, captionPreferences: { pauseOnWordHover: false } };
const document = {
  documentElement: root,
  querySelector: selector => selector === '#movie_player' ? player : null,
  createElement: tag => new Element(tag),
  addEventListener(name, fn) { (docListeners[name] ||= []).push(fn); }
};
const context = vm.createContext({ console, URL, document,
  location: { href: 'https://www.youtube.com/', origin: 'https://www.youtube.com' },
  window: { addEventListener(name, fn) { (windowListeners[name] ||= []).push(fn); } },
  Option: function(text, value) { const option = new Element('option'); option.textContent = text; option.value = value; return option; },
  setTimeout, clearTimeout, setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {},
  chrome: { runtime: { onMessage: { addListener() {} },
    async sendMessage(message) {
      requests.push(message);
      if (message.type !== 'YOUTUBE_PATCH_SETTINGS') return { ok: true };
      settings = { ...settings, captionPreferences: { ...settings.captionPreferences, ...message.captionPreferences }, youtubePreferences: { ...settings.youtubePreferences, ...message.youtubePreferences } };
      storageListeners.forEach(fn => fn({ experimentSettings: { newValue: settings } }, 'local'));
      return { ok: true, settings };
    } }, storage: { local: { async get() { return { experimentSettings: settings }; } },
    onChanged: { addListener(fn) { storageListeners.push(fn); } } } }
});
for (const file of ['learning-features.js', 'youtube-captions.js', 'youtube-controller.js']) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), context);
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
await flush();
const trigger = () => controls.children[0].shadowRoot.querySelector('.trigger');
const panel = () => {
  for (const host of [...player.children, ...controls.children]) {
    const menu = host.shadowRoot?.querySelector('.menu'); if (menu) return menu;
  }
  return null;
};
assert.ok(trigger(), 'transcript icon is mounted');
await trigger().fire('click');
assert.equal(panel().hidden, false, 'click actually opens settings');
assert.equal(trigger().attributes['aria-expanded'], 'true');
assert.equal(panel().getRootNode().host.parentElement === player, true,
  'settings panel must be outside clipped control/button ancestors');
const findCheckbox = text => panel().querySelectorAll('label').find(label => label.textContent.startsWith(text)).querySelector('input');
assert.equal(findCheckbox('Pause while hovering').checked, false);
assert.equal(findCheckbox('Highlight current').checked, true);
const details = panel().querySelector('details'); details.open = true; panel().scrollTop = 94;
const pause = findCheckbox('Pause while hovering'); pause.checked = true; pause.focus(); await pause.fire('change'); await flush();
assert.equal(settings.captionPreferences.pauseOnWordHover, true);
assert.equal(panel().hidden, false);
assert.equal(panel().querySelector('details').open, true);
assert.equal(panel().scrollTop, 94);
assert.equal(panel().getRootNode().activeElement, findCheckbox('Pause while hovering'));
await panel().getRootNode().fire('keydown', { key: 'Escape' });
assert.equal(panel().hidden, true); assert.equal(trigger().attributes['aria-expanded'], 'false');
await trigger().fire('click');
for (const fn of docListeners.pointerdown) fn({ composedPath: () => [panel(), panel().getRootNode().host] });
assert.equal(panel().hidden, false, 'clicks inside the detached panel are not outside clicks');
for (const fn of docListeners.pointerdown) fn({ composedPath: () => [player] });
assert.equal(panel().hidden, true);
controls.remove(); controls = new Element('div'); controls.className = 'ytp-right-controls'; player.append(controls);
intervals[0]();
assert.ok(trigger()); assert.equal(player.children.filter(node => node.shadowRoot?.querySelector('.menu')).length, 1);
await trigger().fire('click'); assert.equal(panel().hidden, false);
windowListeners.pagehide[0]();
assert.equal(player.children.filter(node => node.shadowRoot?.querySelector('.menu')).length, 0);
assert.ok(requests.every(message => message.type === 'YOUTUBE_PATCH_SETTINGS'), 'menu settings do not start retrieval or audio on a non-video page');
console.log('Actual YouTube player-menu DOM: button/open, independent panel, shared hover switches, focus/scroll/disclosures, Escape/outside, controls rebuild and cleanup passed');

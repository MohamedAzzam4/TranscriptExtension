import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Small local DOM double: exercises the real template and renderer, without a
// browser, live dictionary/provider, audio or application storage.
class Node {
  constructor(tag = 'div', text = '') {
    this.tag = tag; this.value = text; this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = {}; this.hidden = false; this.className = '';
    this.style = { setProperty() {} };
    this.classList = {
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, value) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (value) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }
    };
  }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.value = String(value); this.children = []; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.id = value;
    if (name === 'hidden') this.hidden = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) {
    for (const child of children) {
      if (child.tag === '#fragment') { this.append(...[...child.children]); continue; }
      child.remove(); child.parentElement = this; this.children.push(child);
    }
  }
  replaceChildren(...children) { this.value = ''; this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({ stopPropagation() {} }); }
  focus() { activeElement = this; }
  getBoundingClientRect() { return { top: 10, bottom: 50 }; }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[hidden]') return this.hidden;
    if (selector.startsWith('[data-')) return selector.slice(1, -1) in this.attributes || selector.slice(6, -1).replace(/-([a-z])/g, (_, char) => char.toUpperCase()) in this.dataset;
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? descendants : descendants.filter(node => node.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  attachShadow() { this.shadowRoot = new Node('#shadow'); return this.shadowRoot; }
  set innerHTML(html) {
    this.replaceChildren();
    const stack = [this];
    for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      const match = token.match(/^<([\w-]+)\b/);
      if (!match) { stack.at(-1).append(new Node('#text', token)); continue; }
      const node = new Node(match[1]);
      for (const attr of token.slice(match[0].length).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] || '');
      stack.at(-1).append(node);
      if (!token.endsWith('/>') && !['input', 'br', 'img', 'meta', 'link'].includes(node.tag)) stack.push(node);
    }
  }
}
let activeElement;
const document = new Node('#document');
document.createElement = tag => new Node(tag);
document.createTextNode = text => new Node('#text', text);
document.createDocumentFragment = () => new Node('#fragment');
document.getElementById = id => document.querySelector(`#${id}`);
document.innerHTML = fs.readFileSync(new URL('./popup.html', import.meta.url), 'utf8').replace(/<!DOCTYPE[^>]*>/i, '');
const requests = [];
let lookup = () => ({ ok: false, error: 'Dictionary offline' });
let translation = text => Promise.resolve({ ok: true, translatedText: `AR ${text}` });
let removalFails = false;
const openedUrls = [];
let persisted;
const context = vm.createContext({
  console, URL, document, location: { protocol: 'chrome-extension:' },
  requestAnimationFrame: fn => fn(),
  chrome: {
    runtime: {
      onMessage: { addListener() { assert.fail('Review must not subscribe to player messages'); } },
      async sendMessage(message) {
        requests.push(message);
        if (message.type === 'TRANSLATE_TEXT') return translation(message.text);
        if (message.type === 'LOOKUP_WORD') return lookup(message.word);
        if (message.type === 'REMOVE_SAVED_WORD') return { ok: !removalFails, error: 'Storage unavailable' };
        assert.fail(`Unexpected review side effect: ${message.type}`);
      }
    },
    tabs: { async create({ url }) { openedUrls.push(url); } },
    storage: { local: { async set(values) { persisted = values; } } }
  }
});
for (const file of ['learning-features.js', 'content.js']) vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), context);
const api = context.DubSavedWordReview;
assert.ok(api, 'Review mounts without player discovery dependencies');
const root = () => document.querySelector('#savedWordDetailCard').children[0].shadowRoot;
const card = selector => root().querySelector(selector);
const first = { german: 'Er wird Lehrer.', senseIds: ['s1'], senseId: 's1' };
const second = { german: 'Es wird kalt.', senseIds: ['s2'], senseId: 's2' };
const entry = {
  word: 'wird', dictionaryContract: 'de-wiktionary:v3', germanSourceUrl: 'https://de.wiktionary.org/wiki/wird', pronunciation: 'vɪʁt', isVerb: true,
  germanDefinition: '[1] seinen Zustand ändern', germanDefinitions: ['[1] seinen Zustand ändern', '[2] entstehen'],
  senses: [
    { id: 's1', sourceSenseId: '1', definition: '[1] seinen Zustand ändern', examples: [first] },
    { id: 's2', sourceSenseId: '2', definition: '[2] entstehen', examples: [second] }
  ], examples: [first, second],
  grammar: {
    infinitive: 'werden', present: 'er wird', preterite: 'wurde', participle: 'geworden',
    governments: [{ senseId: 's1', text: 'mit Dativ' }],
    conjugations: [{ sectionId: 'verb', tense: 'Präsens', mood: 'Indikativ', person: 'er', form: 'wird' }]
  }, context: 'PRIVATE VIDEO SENTENCE', video: { key: 'video:1', url: 'https://example.com/video', title: 'PRIVATE TITLE' }
};
const original = JSON.stringify(entry);
let closed = 0;
const callbacks = { onClose() { closed++; } };
await api.open(entry, { targetLanguage: 'ar' }, callbacks);
assert.equal(card('.status').hidden, true, 'shared template has no stale startup banner');
assert.equal(card('.status').textContent, '');
assert.equal(card('.word-title').textContent, 'AR wird');
assert.equal(card('.word-title').lang, 'ar');
assert.equal(card('.word-definition-de').textContent, '1. seinen Zustand ändern');
assert.equal(card('.word-more-meanings').hidden, false);
assert.match(card('.word-alternatives').textContent, /2\. entstehen/);
assert.match(card('.word-alternatives').textContent, /Es wird kalt/);
assert.ok(card('.word-verb-table'));
assert.match(card('.word-grammar').textContent, /werden.*wurde.*geworden/s);
assert.match(card('.word-grammar').textContent, /mit Dativ/);
assert.equal(card('.word-conjugation-table').querySelector('td').textContent, 'wird');
assert.equal(card('.word-highlight').textContent, 'wird');
assert.equal(card('.word-replay').hidden, true, 'No invented playback in the popup');
assert.equal(card('.word-save').textContent, 'Remove saved word');
assert.equal(card('.word-speak').disabled, true, 'Missing optional voice cannot prevent card review');
assert.doesNotMatch(card('.word-card').textContent, /PRIVATE VIDEO SENTENCE|PRIVATE TITLE/);
assert.ok(requests.every(message => message.type === 'TRANSLATE_TEXT'));
assert.ok(requests.every(message => message.sourceLanguage === 'de' && message.translationPreferences.targetLanguage === 'ar'));
assert.equal(JSON.stringify(entry), original, 'Opening a review never overwrites saved data');
card('.word-more-meanings').open = true;
const savedCardState = api.getState();
card('.word-more-meanings').open = false;
api.restoreState(savedCardState);
assert.equal(card('.word-more-meanings').open, true);
await card('.word-return-source').fire('click');
assert.deepEqual(openedUrls, ['https://example.com/video']);
removalFails = true;
await card('.word-save').fire('click');
assert.equal(closed, 0);
assert.match(card('.word-translation-status').textContent, /Storage unavailable/);
removalFails = false;
await card('.word-save').fire('click');
assert.equal(closed, 1);
assert.equal(document.querySelector('#savedWordDetailCard').children.length, 0);

// An old saved entry still opens when refreshing its dictionary is offline.
translation = () => Promise.resolve({ ok: false, error: 'Prepare translation first' });
await api.open({ word: 'ohne', germanDefinition: 'mit Akkusativ: ausschließend' }, { targetLanguage: 'en' }, callbacks);
assert.match(card('.word-definition-de').textContent, /ausschließend/);
assert.match(card('.word-grammar').textContent, /Akkusativ/);
assert.match(card('.word-translation-status').textContent, /Dictionary offline/);
assert.equal(card('.word-saved-context').hidden, true);
api.close();

// Switching/closing during a pending provider response cannot resurrect old UI.
const release = [];
translation = text => new Promise(resolve => release.push(() => resolve({ ok: true, translatedText: `OLD ${text}` })));
const stale = api.open(entry, { targetLanguage: 'ar' }, callbacks);
api.close();
translation = text => Promise.resolve({ ok: true, translatedText: `NEW ${text}` });
await api.open({ ...entry, word: 'werden' }, { targetLanguage: 'en' }, callbacks);
for (const finish of release) finish();
await stale;
assert.equal(card('.word-title').textContent, 'NEW werden');
api.close();

// Exercise actual popup navigation/filter/remove functions against the same DOM.
const popup = fs.readFileSync(new URL('./popup.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = popup.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  return popup.slice(start, popup.indexOf('\n}', start) + 2);
}
const elements = Object.fromEntries(['savedWords', 'savedWordCount', 'wordSearch', 'wordResults', 'recentWords', 'savedWordList', 'savedWordDetail', 'savedWordDetailTitle'].map(id => [id, document.querySelector(`#${id}`)]));
elements.wordSearch.value = '';
const window = { scrollY: 125, scrollTo(_x, y) { this.scrollY = y; } };
Object.assign(context, {
  elements, window, readSettings: () => ({ translationPreferences: { targetLanguage: 'de' } }),
  scheduleUiStateSave() {}, refreshSavedWords() {}
});
vm.runInContext(`const learning = DubTranscriptLearning; let savedVocabularyEntries = []; let wordFilter = 'all'; let reviewedWord = null;
  const UI_STATE_KEY = 'popupUiState:v1';
  const popupUiState = {activeView: 'words', scrollByView: {}, scrollAnchorByView: {}};
  ${['persistUiState', 'renderSavedWords', 'filterVocabulary', 'createSavedWordButton', 'openSavedWord', 'closeSavedWordReview', 'renderRecentWords', 'createSourceLink', 'createTextElement'].map(functionSource).join('\n')}
`, context);
context.renderSavedWords([entry]);
const button = elements.savedWords.querySelector('button');
assert.equal(button.type, 'button');
assert.match(button.attributes['aria-label'], /full details/);
await context.openSavedWord(entry);
assert.equal(elements.savedWordList.hidden, true);
assert.equal(elements.savedWordDetail.hidden, false);
assert.equal(activeElement, elements.savedWordDetailTitle);
card('.word-more-meanings').open = true;
window.scrollY = 88;
await context.persistUiState();
assert.equal(persisted['popupUiState:v1'].reviewWord, 'wird');
assert.equal(persisted['popupUiState:v1'].reviewScroll, 88);
// Reopening a popup recreates its renderer; restore the stored detail state.
const storedUi = JSON.parse(JSON.stringify(persisted['popupUiState:v1']));
api.close();
assert.equal(elements.savedWordList.hidden, false);
assert.equal(window.scrollY, 125);
assert.equal(activeElement, button);
vm.runInContext(`Object.assign(popupUiState, ${JSON.stringify(storedUi)})`, context);
await context.openSavedWord(entry, true);
assert.equal(window.scrollY, 88);
assert.equal(card('.word-more-meanings').open, true);
api.close();
elements.wordSearch.value = 'missing';
context.renderSavedWords([entry]);
assert.match(elements.savedWords.textContent, /No matching words/);
elements.wordSearch.value = '';
context.renderSavedWords([entry]);
await context.openSavedWord(entry);
context.renderSavedWords([]);
assert.equal(elements.savedWordDetail.hidden, true, 'Cross-tab deletion closes its review');
assert.equal(elements.savedWordCount.textContent, '0');
assert.doesNotMatch(requests.map(message => message.type).join(' '), /START_|SAVE_WORD|MEDIA_EVENT|UI_DIAGNOSTIC/);
console.log('Saved-word review: shared full card, direct translations, grammar/tables, metadata privacy, offline legacy data, stale responses, source/removal and popup navigation passed');

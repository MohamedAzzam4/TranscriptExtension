import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL("./german-pronunciation.js", import.meta.url), "utf8"), context);
const { createController } = context.DubTranscriptPronunciation;
let voices = [];
let changed;
let availabilityUpdates = 0;
const spoken = [];
const timers = new Map();
let nextTimer = 0;
let cancelCount = 0;
const synthesis = {
  getVoices: () => voices,
  addEventListener(name, callback) { assert.equal(name, "voiceschanged"); changed = callback; },
  cancel() { cancelCount += 1; },
  speak(utterance) { spoken.push(utterance); }
};
class Utterance { constructor(text) { this.text = text; } }
const controller = createController({
  synthesis, Utterance,
  onVoicesChanged() { availabilityUpdates += 1; },
  setTimer(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimer(id) { timers.delete(id); }
});
const events = [];
assert.equal(controller.availability().state, "missing");
assert.equal(controller.speak("ohne", (event) => events.push(event)).ok, false);
assert.equal(spoken.length, 0, "never speak through the default voice when German is missing");
voices = [{ name: "English", lang: "en-US", localService: true }];
assert.equal(controller.availability().state, "missing");

const austrian = { name: "Austrian", lang: "de-AT", localService: true };
const onlineGerman = { name: "Browser German", lang: "de-DE", localService: false };
voices.push(austrian, onlineGerman);
changed();
assert.equal(availabilityUpdates, 1, "late voice loading refreshes card availability without starting speech");
assert.equal(spoken.length, 0);
assert.equal(controller.availability().voice, onlineGerman, "prefer de-DE even when it is online");
assert.equal(controller.availability().online, true);
assert.equal(controller.speak("ohne", (event) => events.push(event)).ok, true);
const first = spoken.at(-1);
assert.equal(first.voice, onlineGerman);
assert.equal(first.lang, "de-DE");
assert.equal(first.text, "ohne");
assert.equal(first.rate, 0.92);
assert.equal(first.pitch, 1);
assert.equal(events.at(-1).state, "accepted", "request acceptance is not proof of audible playback");
first.onstart();
assert.equal(events.at(-1).state, "speaking");
first.onend();
assert.equal(events.at(-1).state, "end");
assert.equal(timers.size, 0);

const oldEvents = [];
const newEvents = [];
controller.speak("ich", (event) => oldEvents.push(event));
const stale = spoken.at(-1);
controller.speak("du", (event) => newEvents.push(event));
assert.equal(oldEvents.at(-1).state, "cancelled");
stale.onstart();
stale.onend();
assert.equal(newEvents.at(-1).state, "accepted", "late events must not repaint a newer request");
spoken.at(-1).onerror({ error: "network" });
assert.equal(newEvents.at(-1).state, "error");
assert.match(newEvents.at(-1).error, /network/);
controller.speak("wir", (event) => newEvents.push(event));
spoken.at(-1).onerror({ error: "not-allowed" });
assert.match(newEvents.at(-1).error, /not-allowed/);
controller.speak("ihr", (event) => newEvents.push(event));
spoken.at(-1).onerror({ error: "interrupted" });
assert.equal(newEvents.at(-1).state, "interrupted");

controller.speak("sie", (event) => newEvents.push(event));
[...timers.values()][0]();
assert.equal(newEvents.at(-1).state, "start-unconfirmed");
controller.speak("wir", (event) => newEvents.push(event));
spoken.at(-1).onstart();
[...timers.values()][0]();
assert.equal(newEvents.at(-1).state, "completion-unconfirmed");
controller.cancel();
assert.ok(cancelCount > 0);

voices = [austrian];
assert.equal(controller.availability().voice, austrian, "another explicit German variant is allowed");
assert.equal(controller.availability().online, false);
assert.equal(createController({}).availability().state, "unsupported");
console.log("German browser pronunciation lifecycle passed");

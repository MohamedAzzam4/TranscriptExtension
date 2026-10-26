import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
function harness() {
  const handlers = [];
  const video = {
    readyState: 4, clientWidth: 1280, clientHeight: 720,
    currentTime: 153, playbackRate: 1, paused: true, duration: 1415,
    currentSrc: "https://media.example/video.mp4", mediaKeys: null,
    addEventListener() {}, getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    console, URL,
    document: {
      addEventListener() {}, referrer: "https://aniworld.to/", title: "Embedded player",
      querySelectorAll: (selector) => selector === "video" ? [video] : [],
      querySelector: (selector) => selector === "video" ? video : null
    },
    location: { href: "https://player.example/embed", hostname: "player.example" },
    performance: { getEntriesByType: () => [] },
    navigator: { userAgent: "Local fixture", language: "en", platform: "Win32" },
    chrome: {
      runtime: { onMessage: { addListener: (handler) => handlers.push(handler) } },
      storage: { onChanged: { addListener() {} } }
    }
  });
  function load(file) { vm.runInContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), context, { filename: file }); }
  for (const file of ["transcript-groups.js", "media-candidate.js", "local-media.js"]) load(file);
  return { context, handlers, load };
}

const optionalMissing = harness();
optionalMissing.load("learning-features.js");
assert.doesNotThrow(() => vm.runInContext(source, optionalMissing.context),
  "missing optional pronunciation must not disable video discovery or cached replay");
assert.equal(optionalMissing.handlers.length, 1);
let media;
optionalMissing.handlers[0]({ type: "GET_MEDIA_CONTEXT" }, {}, (response) => { media = response; });
assert.equal(media.ok, true);
assert.equal(media.context.duration, 1415);
assert.equal(media.context.currentTime, 153);

const retry = harness();
assert.throws(() => vm.runInContext(source, retry.context), /Learning feature helpers were not loaded/);
assert.equal(retry.handlers.length, 0);
retry.load("learning-features.js");
assert.doesNotThrow(() => vm.runInContext(source, retry.context));
assert.equal(retry.handlers.length, 1, "failed initialization must not poison the next injection");
vm.runInContext(source, retry.context);
assert.equal(retry.handlers.length, 1, "successful reinjection must not duplicate listeners");
let ping;
retry.handlers[0]({ type: "PING_CONTENT" }, {}, (response) => { ping = response; });
assert.equal(ping.ready, true);
assert.equal(typeof ping.version, "number");
console.log("Content initialization, optional pronunciation and retry recovery passed");

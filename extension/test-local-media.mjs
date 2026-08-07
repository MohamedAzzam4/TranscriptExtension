import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ URL });
const source = fs.readFileSync(new URL("./local-media.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "local-media.js" });

const helpers = context.DubTranscriptLocalMedia;
assert.equal(helpers.authorizedLoopbackOrigin("http://127.0.0.1:8050/player.html"), "http://127.0.0.1:8050");
assert.equal(helpers.authorizedLoopbackOrigin("http://localhost:8050/"), "http://localhost:8050");
assert.equal(helpers.authorizedLoopbackOrigin("http://[::1]:8050/video.mp4"), "http://[::1]:8050");
assert.equal(helpers.authorizedLoopbackOrigin("https://media.example/video.mp4"), null);
assert.equal(helpers.authorizedLoopbackOrigin("http://localhost.evil.example/video.mp4"), null);
assert.equal(helpers.authorizedLoopbackOrigin("http://user:password@localhost:8050/video.mp4"), null);

const documentElement = { id: "document-root" };
const body = { id: "body" };
const documentRef = { body, documentElement };
const bareVideoPlacement = helpers.overlayPlacement({
  closest() { return null; },
  parentElement: body
}, documentRef);
assert.equal(bareVideoPlacement.container, documentElement);
assert.equal(bareVideoPlacement.viewportFixed, true);

const player = { id: "player" };
const wrappedVideoPlacement = helpers.overlayPlacement({
  closest() { return player; },
  parentElement: body
}, documentRef);
assert.equal(wrappedVideoPlacement.container, player);
assert.equal(wrappedVideoPlacement.viewportFixed, false);

console.log("Local media authorization and overlay tests passed");

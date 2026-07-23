import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ URL });
const source = fs.readFileSync(new URL("./media-candidate.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "media-candidate.js" });

const classify = context.DubTranscriptMediaCandidate.classify;
assert.equal(classify("https://media.example/master.m3u8?token=temporary"), "hls");
assert.equal(classify("https://media.example/manifest", "application/dash+xml"), "dash");
assert.equal(classify("https://media.example/video?id=1", "video/mp4"), "media");
assert.equal(
  classify("https://prd.jwpltx.com/v1/jwplayer6/ping.gif?event=playlist"),
  null
);
assert.equal(
  classify("/extensionless/playlist", "", "https://player.example/watch"),
  "unknown-media"
);

console.log("Media candidate classification tests passed");

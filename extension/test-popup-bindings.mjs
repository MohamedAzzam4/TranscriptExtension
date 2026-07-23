import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("./popup.html", import.meta.url), "utf8");
const javascript = fs.readFileSync(new URL("./popup.js", import.meta.url), "utf8");
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const queriedIds = [...javascript.matchAll(/querySelector\("#([^"]+)"\)/g)]
  .map((match) => match[1]);

for (const id of queriedIds) {
  assert.ok(htmlIds.has(id), `popup.js queries missing popup.html element #${id}`);
}
assert.equal(new Set(queriedIds).size, queriedIds.length, "popup element bindings must be unique");
assert.match(html, /id="translationEnabled"/);
assert.match(html, /id="fontSize"/);
assert.match(html, /id="translationFontSize"/);
assert.match(html, /id="translationTextColor"/);
assert.match(html, /id="transcriptBold"/);
assert.match(html, /id="savedWords"/);
assert.match(html, /id="downloadTranscript"/);
assert.match(html, /id="savedTranscripts"/);
assert.match(html, /id="analyzeNetflixTitle"/);
assert.match(html, /id="attachNetflixSample"/);
assert.match(html, /id="exportNetflixResearch"/);
assert.match(html, /id="exportNetflixDataset"/);

const content = fs.readFileSync(new URL("./content.js", import.meta.url), "utf8");
assert.match(content, /class="caption-drag-handle"/);
assert.match(content, /captionDragHandleElement\.addEventListener\("pointerdown", startCaptionDrag\)/);
assert.doesNotMatch(content, /captionBoxElement\.addEventListener\("pointerdown", startCaptionDrag\)/);
assert.match(content, /function hasActiveCaptionSelection\(\)/);
assert.match(content, /wordElement\.setAttribute\("role", "button"\)/);

console.log("Popup binding tests passed");

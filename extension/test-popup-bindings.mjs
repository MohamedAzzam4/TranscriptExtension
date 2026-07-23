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
assert.match(html, /id="resetAppearance"/);
assert.match(html, /id="fontSizeDecrease"/);
assert.match(html, /id="fontSizeIncrease"/);
assert.match(html, /id="translationFontSizeDecrease"/);
assert.match(html, /id="translationFontSizeIncrease"/);
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
assert.match(content, /learning\.selectionHasText\(rootSelection, windowSelection\)/);
assert.match(content, /learning\.wordActivationDecision\(/);
assert.match(content, /wordElement\.setAttribute\("role", "button"\)/);
assert.match(content, /captionBoxElement\.addEventListener\("copy", stopPlayerClick\)/);
assert.match(content, /captionBoxElement\.addEventListener\("dblclick", stopPlayerClick\)/);
assert.match(content, /<div class="word-label">Meaning<\/div>/);
assert.match(content, /<div class="word-label">Examples<\/div>/);
assert.match(content, /<div class="word-label">Common combinations<\/div>/);
assert.match(content, /<div class="word-label">Grammar<\/div>/);
assert.match(content, /<div class="word-label">Related words<\/div>/);
assert.match(content, /role="group" aria-label="Interactive captions"/);
assert.match(content, /role="region" aria-label="Word details"/);
assert.match(content, /function updatePlayerAwarePosition\(force = false\)/);
assert.match(content, /function measureVisiblePlayerControls\(\)/);
assert.match(content, /learning\.resolveCaptionBottom\(/);
assert.match(content, /\.ytp-chrome-bottom/);
assert.match(content, /\[data-uia='controls-standard'\]/);
assert.match(content, /wordYouglishElement\.href = `https:\/\/de\.youglish\.com/);
assert.match(content, /wordReplayElement\.addEventListener\("click", replaySelectedWord\)/);
assert.match(content, /wordSaveElement\.addEventListener\("click", toggleSavedWord\)/);

const css = fs.readFileSync(new URL("./popup.css", import.meta.url), "utf8");
assert.match(css, /backdrop-filter: blur\(22px\)/);
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(javascript, /function resetAppearance\(\)/);
assert.match(javascript, /learning\.DEFAULT_CAPTION_PREFERENCES/);
assert.match(javascript, /function bindRangeStep\(button, range, delta\)/);

console.log("Popup binding tests passed");

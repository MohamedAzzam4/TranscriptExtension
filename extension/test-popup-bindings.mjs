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
assert.match(html, /id="savedWords"/);

console.log("Popup binding tests passed");


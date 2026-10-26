import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./popup.js", import.meta.url), "utf8");
const start = source.indexOf('elements.start.addEventListener("click",');
const end = source.indexOf('elements.stop.addEventListener("click",', start);
assert.ok(start >= 0 && end > start);
let click;
const statuses = [];
let requests = 0;
const button = { disabled: false, addEventListener(_name, handler) { click = handler; } };
const context = vm.createContext({
  elements: { start: button }, readSettings: () => ({}),
  persistSettings: async () => { throw new Error("Resource::kQuotaBytes quota exceeded"); },
  setStatus: (message, error) => statuses.push({ message, error }),
  chrome: { runtime: { async sendMessage() { requests += 1; return { ok: true }; } } },
  refreshTranscriptLibrary: async () => {}, refreshDiagnostics: async () => {}
});
vm.runInContext(source.slice(start, end), context);
await assert.doesNotReject(click, "a settings-storage rejection must be handled inside the analysis action");
assert.equal(button.disabled, false, "storage failure must release the Analyze button");
assert.equal(requests, 0, "do not report that recognition started after settings failed to save");
assert.equal(statuses.at(-1).error, true);
assert.match(statuses.at(-1).message, /storage|quota/i);
const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
assert.ok(manifest.permissions.includes("unlimitedStorage"), "persist full transcript libraries without the standard 10 MB local cap");
console.log("Analysis startup storage failure and capacity contracts passed");

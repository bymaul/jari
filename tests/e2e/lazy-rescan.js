import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/lazy-rescan.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "lazy.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/lazy.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(1500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(500);

const count = () => evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);

const before = await count();
assert(before === 1, `one hint before the late link appears (got ${before})`);

// The fixture injects the link at 3000ms; the observer debounces 200ms and the
// background re-coordinates. Poll for up to ~5s.
let sawTwo = false;
for (let i = 0; i < 50 && !sawTwo; i++) {
  await wait(100);
  sawTwo = (await count()) === 2;
}
assert(sawTwo, `a second hint should appear after the late link is injected`);

// The new hint must sit on the injected link's top-left corner.
const lateRect = await evalValue(
  cdp,
  `(() => { const r = document.getElementById('late').getBoundingClientRect(); return { left: r.left, top: r.top }; })()`,
);
const hintBoxes = await evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1) };
})`);
console.log("late rect:", JSON.stringify(lateRect));
console.log("hints:", JSON.stringify(hintBoxes));
const fresh = hintBoxes.find(
  (h) => Math.abs(h.left - lateRect.left) < 10 && Math.abs(h.top - lateRect.top) < 10,
);
assert(fresh, `a hint label should cover the injected link (rect=${JSON.stringify(lateRect)})`);
for (const ch of fresh.label) {
  await key(cdp, ch);
  await wait(120);
}
await wait(1200);
const path = await evalValue(cdp, `location.pathname`);
console.log("path after pick:", path);
assert(path === "/b", `picking the fresh hint should navigate to /b (got ${path})`);

console.log(process.exitCode ? "lazy-rescan: FAIL" : "lazy-rescan: PASS");
cdp.close();
server.close();
process.exit(process.exitCode || 0);

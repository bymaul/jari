import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/stacked-hints.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "stacked.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/stacked.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const hints = await evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
})`);

const overlaps = [];
for (let i = 0; i < hints.length; i++) {
  for (let j = i + 1; j < hints.length; j++) {
    const a = hints[i];
    const b = hints[j];
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix <= 0 || iy <= 0) continue;
    const inter = ix * iy;
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    const ratio = inter / minArea;
    if (ratio > 0.5) overlaps.push({ a: a.label, b: b.label, ratio: +ratio.toFixed(2) });
  }
}

assert(hints.length === 4, "one hint per distinct region, stacked pairs collapsed");
assert(overlaps.length === 0, "no fully overlapping hint pairs");

console.log("total hints:", hints.length);
console.log("hints:", JSON.stringify(hints));
console.log("overlapping pairs:", JSON.stringify(overlaps));

cdp.close();
server.close();
process.exit(0);

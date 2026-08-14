import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/right-edge-label.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "right-edge.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/right-edge.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const vp = await evalValue(cdp, `({ w: window.innerWidth, h: window.innerHeight })`);
const hints = await evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
})`);

const pokeRight = hints.filter((h) => h.right > vp.w);
const pokeLeft = hints.filter((h) => h.left < 0);
const pokeTop = hints.filter((h) => h.top < 0);
const pokeBottom = hints.filter((h) => h.bottom > vp.h);

console.log("viewport:", JSON.stringify(vp));
console.log("hints:", JSON.stringify(hints));

assert(pokeRight.length === 0, `no hint pokes past the right edge: ${JSON.stringify(pokeRight)}`);
assert(pokeLeft.length === 0, `no hint pokes past the left edge: ${JSON.stringify(pokeLeft)}`);
assert(pokeTop.length === 0, `no hint pokes above the top edge: ${JSON.stringify(pokeTop)}`);
assert(pokeBottom.length === 0, `no hint pokes past the bottom edge: ${JSON.stringify(pokeBottom)}`);

cdp.close();
server.close();
process.exit(0);

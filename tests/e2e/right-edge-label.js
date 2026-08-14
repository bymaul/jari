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

const readHints = () =>
  evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
})`);

const assertInside = (hints, vp, phase) => {
  // A 1px epsilon absorbs sub-pixel rendering: the hint boxes are laid out at
  // the clamped position but their fractional getBoundingClientRect width can
  // nudge the right edge ~0.5px past the viewport. The LABEL_HEIGHT-proxy bug
  // this test guards against produces a ~5px+ overhang, far beyond that.
  const pokeRight = hints.filter((h) => h.right > vp.w + 1);
  const pokeLeft = hints.filter((h) => h.left < -1);
  const pokeTop = hints.filter((h) => h.top < -1);
  const pokeBottom = hints.filter((h) => h.bottom > vp.h + 1);
  assert(pokeRight.length === 0, `${phase}: no hint pokes past the right edge: ${JSON.stringify(pokeRight)}`);
  assert(pokeLeft.length === 0, `${phase}: no hint pokes past the left edge: ${JSON.stringify(pokeLeft)}`);
  assert(pokeTop.length === 0, `${phase}: no hint pokes above the top edge: ${JSON.stringify(pokeTop)}`);
  assert(pokeBottom.length === 0, `${phase}: no hint pokes past the bottom edge: ${JSON.stringify(pokeBottom)}`);
};

const vp = await evalValue(cdp, `({ w: window.innerWidth, h: window.innerHeight })`);
let hints = await readHints();

console.log("viewport:", JSON.stringify(vp));
console.log("hints (initial):", JSON.stringify(hints));

// The edge-clamping clamp only differs from the LABEL_HEIGHT (20px) proxy if a
// label is actually wider than 20px. The fixture's right-edge link must get a
// hint that wide, otherwise the scroll reposition would pass regardless.
assert(
  hints.some((h) => h.right - h.left > 20.5),
  `fixture must produce a label wider than the LABEL_HEIGHT proxy so the scroll clamp is exercised: ${JSON.stringify(hints)}`,
);
assertInside(hints, vp, "initial");

// Repositioning after a scroll must clamp labels with their measured width,
// not the LABEL_HEIGHT proxy, or wide labels near the right edge poke off.
await evalValue(cdp, `window.scrollTo(0, 300)`);
await wait(500);
hints = await readHints();

console.log("hints (after scroll):", JSON.stringify(hints));
assertInside(hints, vp, "after scroll");

cdp.close();
server.close();
process.exit(0);

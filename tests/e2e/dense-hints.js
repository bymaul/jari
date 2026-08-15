import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/dense-hints.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "dense.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/dense.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const hints = await evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
})`);
console.log("hints:", JSON.stringify(hints));

assert(hints.length === 3, `three hints expected (got ${JSON.stringify(hints)})`);

const overlaps = [];
for (let i = 0; i < hints.length; i++) {
  for (let j = i + 1; j < hints.length; j++) {
    const a = hints[i];
    const b = hints[j];
    // A 1px epsilon absorbs sub-pixel rendering; the de-overlap pad is 2px.
    if (
      a.right - 1 > b.left &&
      b.right - 1 > a.left &&
      a.bottom - 1 > b.top &&
      b.bottom - 1 > a.top
    ) {
      overlaps.push([a.label, b.label]);
    }
  }
}
assert(overlaps.length === 0, `hint labels overlap without nudging: ${JSON.stringify(overlaps)}`);

console.log(process.exitCode ? "dense-hints: FAIL" : "dense-hints: PASS");
cdp.close();
server.close();
process.exit(process.exitCode || 0);

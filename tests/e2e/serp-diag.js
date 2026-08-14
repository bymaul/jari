import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/serp-diag.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "serp.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/serp.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const data = await evalValue(cdp, `(() => {
  const inViewport = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const anchors = [...document.querySelectorAll('a[href]')].map((a) => {
    const r = a.getBoundingClientRect();
    return {
      cls: a.className.toString(),
      h3: a.querySelector('h3') !== null,
      rect: inViewport(r) ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null,
    };
  }).filter((a) => a.rect);
  const hints = [...document.querySelectorAll('.jari-hint')].map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  const titleHit = (a, h) =>
    h.l < a.rect.l + (a.rect.r - a.rect.l) * 0.5 && h.t < a.rect.b - 1 && h.b > a.rect.t + 1;
  return { anchors, hints, missing: anchors.filter((a) => a.h3 && !hints.some((h) => titleHit(a, h))) };
})()`);

assert(data.missing.length === 0, "every visible result title keeps its hint");
console.log("total hints:", data.hints.length);
console.log("hints:", JSON.stringify(data.hints));
console.log("missing titles:", JSON.stringify(data.missing));

cdp.close();
server.close();
process.exit(0);

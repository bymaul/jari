import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/largest-child.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const server = createServer((req, res) => {
  const body =
    req.url === "/activated"
      ? "<!doctype html><body>activated page</body>"
      : readFileSync(join(here, "fixtures", "largest-child.html"));
  res.setHeader("Content-Type", "text/html");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/largest-child.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const hints = await evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.textContent, left: +r.left.toFixed(1), top: +r.top.toFixed(1) };
})`);
console.log("hints:", JSON.stringify(hints));

assert(hints.length === 1, `exactly one hint expected (got ${JSON.stringify(hints)})`);

// The label must sit on the overflowing child link (left:160, top:5), not on
// the small wrapper (left:0, top:0). A 10px window absorbs sub-pixel jitter.
const childRect = await evalValue(
  cdp,
  `(() => { const r = document.getElementById('big-child').getBoundingClientRect(); return { left: r.left, top: r.top }; })()`,
);
console.log("big-child rect:", JSON.stringify(childRect));
const hint = hints[0];
assert(
  Math.abs(hint.left - childRect.left) < 10 && Math.abs(hint.top - childRect.top) < 10,
  `hint label should cover the big child (child=${JSON.stringify(childRect)}, hint=${JSON.stringify(hint)})`,
);

// Activating the hint clicks the child link and navigates to /activated.
for (const ch of hint.label) {
  await key(cdp, ch);
  await wait(120);
}
await wait(1200);

const path = await evalValue(cdp, `location.pathname`);
console.log("path after pick:", path);
assert(path === "/activated", `page should navigate to /activated (got ${path})`);

console.log(process.exitCode ? "largest-child: FAIL" : "largest-child: PASS");
cdp.close();
server.close();
process.exit(process.exitCode || 0);

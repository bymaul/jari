import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/frames.js <profile-dir> <extension-dir>");
  process.exit(2);
}

const readFile = (name) => readFileSync(join(here, "fixtures", name));
const pages = {
  "/frames": readFile("frames.html"),
  "/frame-child": readFile("frame-child.html"),
  "/top-a": "<!doctype html><body>top-a activated</body>",
  "/child-a": "<!doctype html><body>child-a activated</body>",
  "/child-b": "<!doctype html><body>child-b activated</body>",
};
const server = createServer((req, res) => {
  const body = pages[req.url] || "<!doctype html><body>not found</body>";
  res.setHeader("Content-Type", "text/html");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/frames`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

const topHints = () =>
  evalValue(cdp, `[...document.querySelectorAll('.jari-hint')].map((b) => b.textContent)`);
const frameHints = () =>
  evalValue(cdp, `[...document.querySelector('iframe').contentDocument.querySelectorAll('.jari-hint')].map((b) => b.textContent)`);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1500);

const topLabels = await topHints();
const childLabels = await frameHints();
console.log("top hints:", JSON.stringify(topLabels));
console.log("frame hints:", JSON.stringify(childLabels));

assert(topLabels.length === 1, `top frame should hint exactly one link (got ${JSON.stringify(topLabels)})`);
assert(childLabels.length === 2, `iframe should hint two links (got ${JSON.stringify(childLabels)})`);
const all = [...topLabels, ...childLabels];
assert(
  new Set(all).size === all.length,
  `labels must be globally unique across frames (got ${JSON.stringify(all)})`,
);

// Pick the iframe hint for /child-b by typing its label from the top frame.
// The key must reach the iframe through the background relay.
const targetLabel = childLabels[1];
console.log("typing iframe label:", targetLabel);
for (const ch of targetLabel) {
  await key(cdp, ch);
  await wait(120);
}
await wait(1000);

const framePath = await evalValue(
  cdp,
  `document.querySelector('iframe').contentDocument.location.pathname`,
);
console.log("iframe path after pick:", framePath);
assert(framePath === "/child-b", `iframe should navigate to /child-b (got ${framePath})`);

const topAfter = await evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);
const childAfter = await evalValue(
  cdp,
  `document.querySelector('iframe').contentDocument.querySelectorAll('.jari-hint').length`,
);
assert(topAfter === 0, `hints should close in the top frame after activation (count=${topAfter})`);
assert(childAfter === 0, `hints should close in the iframe after activation (count=${childAfter})`);

console.log(process.exitCode ? "frames: FAIL" : "frames: PASS");
cdp.close();
server.close();
process.exit(process.exitCode || 0);

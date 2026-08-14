import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/webpage-smoke.js <profile-dir> <extension-dir>");
  process.exit(2);
}

// Smoke: the content-script coordination path on a real web page still draws
// hints and Escape still cancels them. Needs network access for the fixture.
await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();

await cdp.send("Page.navigate", { url: "https://example.com/" });
await wait(3000);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1200);

const hintCount = await evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);
assert(hintCount > 0, `web page drew no hints (count=${hintCount})`);

await key(cdp, "Escape");
await wait(400);
const afterEscape = await evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);
assert(afterEscape === 0, `Escape did not clear hints (count=${afterEscape})`);

console.log(process.exitCode ? "webpage-smoke: FAIL" : "webpage-smoke: PASS");
cdp.close();
process.exit(process.exitCode || 0);

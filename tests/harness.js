// Test harness: loads the background service worker into a vm sandbox and
// exposes the globals it defines (normalizeUrl, clampCount). Content modules
// are ESM now and are imported directly by the test files — tests/setup.mjs
// provides the browser globals they touch at import time.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Node's vm context has no browser or Node globals, so the ones the script
// touches are injected explicitly.
const browserGlobals = { URL, console, setTimeout, clearTimeout };

export function loadBackground() {
  const sandbox = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    ...browserGlobals,
  };
  const code = fs.readFileSync(path.join(root, "background.js"), "utf8");
  vm.runInNewContext(code, sandbox, { filename: "background.js" });
  return sandbox;
}

// Test harness: loads a Jari script into a sandbox and exposes the globals it
// defines. Content scripts are browser IIFEs that write onto `window`, so they
// get a fresh plain object. The background service worker is the same shape
// but reads `chrome` — a stub is provided and function declarations become
// sandbox globals (e.g. normalizeUrl, clampCount).
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

// Node's vm context has no browser or Node globals, so the ones the scripts
// touch are injected explicitly.
const browserGlobals = { URL, console, setTimeout, clearTimeout };

function loadContentScript(name) {
  const sandbox = { window: {}, ...browserGlobals };
  const code = fs.readFileSync(path.join(root, "content", name), "utf8");
  vm.runInNewContext(code, sandbox, { filename: name });
  return sandbox.window.Jari;
}

function loadBackground() {
  const sandbox = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    ...browserGlobals,
  };
  const code = fs.readFileSync(path.join(root, "background.js"), "utf8");
  vm.runInNewContext(code, sandbox, { filename: "background.js" });
  return sandbox;
}

module.exports = { loadContentScript, loadBackground };

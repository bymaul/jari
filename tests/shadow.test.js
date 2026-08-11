"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// keymap.js's shadow helpers read the global `document`, which the standard
// harness does not provide — run it in a sandbox with a fake document.
function loadKeymapWith(document) {
  const sandbox = {
    window: {},
    document,
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  const code = fs.readFileSync(path.join(__dirname, "..", "content", "keymap.js"), "utf8");
  vm.runInNewContext(code, sandbox, { filename: "keymap.js" });
  return sandbox.window.Jari;
}

function element(name, shadowRoot) {
  return { name, shadowRoot, matches: (sel) => sel === name };
}

// A shadow root whose * returns its children, and a document whose * returns
// the light-DOM elements. Only the parts queryAll touches.
function rootWith(children) {
  return { querySelectorAll: (sel) => (sel === "*" ? children : []) };
}

test("queryAll finds matches inside open shadow roots, depth-first", () => {
  const shadowBtn = element("button");
  const shadowRoot = rootWith([shadowBtn]);
  const host = element("div", shadowRoot);
  const lightBtn = element("button");
  const lightA = element("a");
  const document = rootWith([lightA, host, lightBtn]);

  const Jari = loadKeymapWith(document);
  const matches = Jari.queryAll("button");
  assert.deepEqual(
    matches.map((e) => e.name),
    ["button", "button"],
  );
  assert.strictEqual(matches[0], shadowBtn);
  assert.strictEqual(matches[1], lightBtn);
});

test("queryAll calls onShadowRoot for each open root and nests into nested roots", () => {
  const nestedInner = element("a");
  const nestedRoot = rootWith([nestedInner]);
  const nestedHost = element("div", nestedRoot);
  const outerRoot = rootWith([nestedHost]);
  const host = element("div", outerRoot);
  const document = rootWith([host]);

  const Jari = loadKeymapWith(document);
  const seen = [];
  const matches = Jari.queryAll("a", (root) => seen.push(root));
  assert.deepEqual(
    matches.map((e) => e.name),
    ["a"],
  );
  assert.deepEqual(seen, [outerRoot, nestedRoot]);
});

test("queryAll without shadow roots returns only light-DOM matches", () => {
  const lightBtn = element("button");
  const lightA = element("a");
  const document = rootWith([lightA, lightBtn]);

  const Jari = loadKeymapWith(document);
  const seen = [];
  const matches = Jari.queryAll("button", (root) => seen.push(root));
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0], lightBtn);
  assert.deepEqual(seen, []);
});

test("deepActiveElement crosses shadow boundaries to the focused element", () => {
  const deepInput = element("input");
  const innerRoot = { activeElement: deepInput };
  const innerHost = element("div", innerRoot);
  const outerRoot = { activeElement: innerHost };
  const outerHost = element("div", outerRoot);
  const document = { activeElement: outerHost };

  const Jari = loadKeymapWith(document);
  assert.strictEqual(Jari.deepActiveElement(), deepInput);
});

test("deepActiveElement returns the host when focus does not reach into its root", () => {
  const emptyRoot = { activeElement: null };
  const host = element("div", emptyRoot);
  const document = { activeElement: host };

  const Jari = loadKeymapWith(document);
  assert.strictEqual(Jari.deepActiveElement(), host);
});

test("deepActiveElement with no shadow focus returns the document element", () => {
  const input = element("input");
  const document = { activeElement: input };

  const Jari = loadKeymapWith(document);
  assert.strictEqual(Jari.deepActiveElement(), input);
});

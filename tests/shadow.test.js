import { test } from "node:test";
import assert from "node:assert";
import { deepActiveElement, queryAll } from "../content/keymap.js";

// keymap.js's shadow helpers read the global `document` at call time. Each
// test swaps in a fake document for the duration and restores it afterwards.
function element(name, shadowRoot) {
  return { name, shadowRoot, matches: (sel) => sel === name };
}

// A shadow root whose * returns its children, and a document whose * returns
// the light-DOM elements. Only the parts queryAll touches.
function rootWith(children) {
  return { querySelectorAll: (sel) => (sel === "*" ? children : []) };
}

function withDocument(document, fn) {
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    fn();
  } finally {
    globalThis.document = previous;
  }
}

test("queryAll finds matches inside open shadow roots, depth-first", () => {
  const shadowBtn = element("button");
  const shadowRoot = rootWith([shadowBtn]);
  const host = element("div", shadowRoot);
  const lightBtn = element("button");
  const lightA = element("a");
  withDocument(rootWith([lightA, host, lightBtn]), () => {
    const matches = queryAll("button");
    assert.deepEqual(
      matches.map((e) => e.name),
      ["button", "button"],
    );
    assert.strictEqual(matches[0], shadowBtn);
    assert.strictEqual(matches[1], lightBtn);
  });
});

test("queryAll calls onShadowRoot for each open root and nests into nested roots", () => {
  const nestedInner = element("a");
  const nestedRoot = rootWith([nestedInner]);
  const nestedHost = element("div", nestedRoot);
  const outerRoot = rootWith([nestedHost]);
  const host = element("div", outerRoot);
  withDocument(rootWith([host]), () => {
    const seen = [];
    const matches = queryAll("a", (root) => seen.push(root));
    assert.deepEqual(
      matches.map((e) => e.name),
      ["a"],
    );
    assert.deepEqual(seen, [outerRoot, nestedRoot]);
  });
});

test("queryAll without shadow roots returns only light-DOM matches", () => {
  const lightBtn = element("button");
  const lightA = element("a");
  withDocument(rootWith([lightA, lightBtn]), () => {
    const seen = [];
    const matches = queryAll("button", (root) => seen.push(root));
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0], lightBtn);
    assert.deepEqual(seen, []);
  });
});

test("deepActiveElement crosses shadow boundaries to the focused element", () => {
  const deepInput = element("input");
  const innerRoot = { activeElement: deepInput };
  const innerHost = element("div", innerRoot);
  const outerRoot = { activeElement: innerHost };
  const outerHost = element("div", outerRoot);
  withDocument({ activeElement: outerHost }, () => {
    assert.strictEqual(deepActiveElement(), deepInput);
  });
});

test("deepActiveElement returns the host when focus does not reach into its root", () => {
  const emptyRoot = { activeElement: null };
  const host = element("div", emptyRoot);
  withDocument({ activeElement: host }, () => {
    assert.strictEqual(deepActiveElement(), host);
  });
});

test("deepActiveElement with no shadow focus returns the document element", () => {
  const input = element("input");
  withDocument({ activeElement: input }, () => {
    assert.strictEqual(deepActiveElement(), input);
  });
});

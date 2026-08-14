import { test } from "node:test";
import assert from "node:assert";
import { containsElement, deepActiveElement, queryAll } from "../content/keymap.js";

function element(name, { shadowRoot, parent, host } = {}) {
  return {
    name,
    shadowRoot: shadowRoot || null,
    parentElement: parent || null,
    matches: (sel) => sel === "*" || sel === name,

    getRootNode: () => ({ host: host || null }),
  };
}

function rootWith(children) {
  return { querySelectorAll: (sel) => children.filter((c) => c.matches(sel)) };
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
  const hostDiv = element("div", { shadowRoot: rootWith([shadowBtn]) });
  const hostBtn = element("button", { shadowRoot: rootWith([element("span")]) });
  const lightBtn = element("button");
  const lightA = element("a");
  withDocument(rootWith([lightA, hostDiv, hostBtn, lightBtn]), () => {
    const matches = queryAll("button");
    assert.deepEqual(
      matches.map((e) => e.name),
      ["button", "button", "button"],
    );
    assert.strictEqual(matches[0], shadowBtn);
    assert.strictEqual(matches[1], hostBtn);
    assert.strictEqual(matches[2], lightBtn);
  });
});

test("queryAll calls onShadowRoot for each open root and nests into nested roots", () => {
  const nestedInner = element("a");
  const nestedRoot = rootWith([nestedInner]);
  const nestedHost = element("a", { shadowRoot: nestedRoot });
  const outerRoot = rootWith([nestedHost]);
  const host = element("a", { shadowRoot: outerRoot });
  withDocument(rootWith([host]), () => {
    const seen = [];
    const matches = queryAll("a", (root) => seen.push(root));
    assert.deepEqual(
      matches.map((e) => e.name),
      ["a", "a", "a"],
    );
    assert.strictEqual(matches[0], host);
    assert.strictEqual(matches[1], nestedHost);
    assert.strictEqual(matches[2], nestedInner);
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

test("containsElement covers self and light-DOM ancestors", () => {
  const parent = element("div");
  const child = element("div", { parent });
  const other = element("span");
  assert.ok(containsElement(parent, child));
  assert.ok(containsElement(child, child));
  assert.ok(!containsElement(child, parent));
  assert.ok(!containsElement(parent, other));
});

test("containsElement crosses shadow boundaries to the host", () => {
  const host = element("div");
  const shadowBtn = element("button", { host });
  const deep = element("span", { parent: shadowBtn, host });
  const other = element("div");
  assert.ok(containsElement(host, shadowBtn));
  assert.ok(containsElement(host, deep));
  assert.ok(!containsElement(other, deep));
});

test("deepActiveElement crosses shadow boundaries to the focused element", () => {
  const deepInput = element("input");
  const innerRoot = { activeElement: deepInput };
  const innerHost = element("div", { shadowRoot: innerRoot });
  const outerRoot = { activeElement: innerHost };
  const outerHost = element("div", { shadowRoot: outerRoot });
  withDocument({ activeElement: outerHost }, () => {
    assert.strictEqual(deepActiveElement(), deepInput);
  });
});

test("deepActiveElement returns the host when focus does not reach into its root", () => {
  const emptyRoot = { activeElement: null };
  const host = element("div", { shadowRoot: emptyRoot });
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

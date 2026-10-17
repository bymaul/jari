import "./setup.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const { settings } = await import("../content/settings.js");
const { genLabels, normalizeCharset, classifyHintKey, __testHelpers } = await import("../content/hints.js");
const { collectMutationRoots, collectNewcomers } = await import("../content/hints-elements.js");
const { HINT_CHARSET_DEFAULT, keymapDefaults } = await import("../content/keymap.js");

const { isExplicitlyRequested, isElementClickable, collectIframeElements } =
  __testHelpers;

function assertPrefixFree(labels) {
  assert.equal(new Set(labels).size, labels.length, "labels must be unique");
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      if (i !== j) {
        assert.ok(
          !labels[j].startsWith(labels[i]),
          `prefix conflict: ${labels[i]} is a prefix of ${labels[j]}`,
        );
      }
    }
  }
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
    clickableSelector: "",
  });
});

test("genLabels returns single chars when count fits the charset", () => {
  assert.deepEqual(genLabels(3, "abc"), ["A", "B", "C"]);
  assert.deepEqual(genLabels(1, "ab"), ["A"]);
});

test("genLabels rejects empty counts and degenerate charsets", () => {
  assert.deepEqual(genLabels(0, "abc"), []);
  assert.deepEqual(genLabels(-1, "abc"), []);
  assert.deepEqual(genLabels(5, "a"), []);
});

test("genLabels is prefix-free across hint counts", () => {
  for (const count of [2, 5, 12, 13, 26, 50, 100, 200, 500]) {
    assertPrefixFree(genLabels(count, HINT_CHARSET_DEFAULT));
  }
});

test("normalizeCharset falls back to the shared default", () => {
  assert.equal(normalizeCharset(), HINT_CHARSET_DEFAULT);
});

test("isElementClickable honors selector matches without measuring", () => {
  assert.equal(isElementClickable({ matches: () => true }), true);
});

test("isElementClickable reuses a passed style for the cursor check", () => {
  const el = { matches: () => false, closest: () => null };
  assert.equal(isElementClickable(el, { cursor: "pointer" }), true);
  assert.equal(isElementClickable(el, { cursor: "url(foo.png)" }), true);
  assert.equal(isElementClickable(el, { cursor: "default" }), false);
});

test("iframe inners are hinted only for the focused frame", () => {
  const innerLink = {
    tagName: "A",
    matches: (s) => s === "[href]",
    getAttribute: (n) => (n === "href" ? "https://example.com/" : null),
    href: "https://example.com/",
    disabled: false,
    readOnly: false,
    closest: () => null,
    getRootNode: () => ({}),
    getBoundingClientRect: () => ({
      left: 10,
      top: 10,
      right: 100,
      bottom: 30,
      width: 90,
      height: 20,
    }),
  };
  const innerDoc = {
    body: { querySelectorAll: () => [innerLink] },
    URL: "https://example.com/inner",
  };
  innerLink.ownerDocument = innerDoc;
  const frame = {
    tagName: "IFRAME",
    matches: () => true,
    closest: () => null,
    contentDocument: innerDoc,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
    }),
  };
  const prevQsa = globalThis.document.querySelectorAll;
  const prevActive = globalThis.document.activeElement;
  const prevStyle = globalThis.window.getComputedStyle;
  const prevW = globalThis.window.innerWidth;
  const prevH = globalThis.window.innerHeight;
  globalThis.document.querySelectorAll = () => [frame];
  globalThis.window.innerWidth = 800;
  globalThis.window.innerHeight = 600;
  globalThis.window.getComputedStyle = () => ({
    opacity: "1",
    visibility: "visible",
    display: "block",
  });
  try {
    globalThis.document.activeElement = frame;
    assert.equal(collectIframeElements("open").length, 1);
    globalThis.document.activeElement = null;
    assert.equal(collectIframeElements("open").length, 0);
  } finally {
    globalThis.document.querySelectorAll = prevQsa;
    globalThis.document.activeElement = prevActive;
    globalThis.window.getComputedStyle = prevStyle;
    globalThis.window.innerWidth = prevW;
    globalThis.window.innerHeight = prevH;
  }
});

test("classifyHintKey routes scrolling keys before label matching", () => {
  const keymap = { j: "scrollDown", G: "scrollToBottom", f: "hintClick" };
  const ctx = { keymap, charset: "saewcmpf" };
  assert.deepEqual(classifyHintKey("j", { ...ctx, labels: [], prefix: "" }), {
    type: "scroll",
    command: "scrollDown",
  });
  assert.deepEqual(classifyHintKey("f", { ...ctx, labels: ["F", "FA"], prefix: "" }), {
    type: "activate",
    prefix: "F",
    label: "F",
  });
  assert.deepEqual(classifyHintKey("e", { ...ctx, labels: ["S", "SA"], prefix: "S" }), {
    type: "filter",
    prefix: "SE",
  });
  assert.deepEqual(classifyHintKey("x", { ...ctx, labels: [], prefix: "" }), {
    type: "ignore",
  });
  assert.deepEqual(classifyHintKey("Enter", { ...ctx, labels: [], prefix: "" }), {
    type: "ignore",
  });
});

test("classifyHintKey sends unbound g to the top", () => {
  const keymap = { j: "scrollDown" };
  assert.deepEqual(classifyHintKey("g", { labels: ["G"], prefix: "", keymap, charset: "saewcmp" }), {
    type: "scroll",
    command: "scrollToTop",
  });
  assert.deepEqual(
    classifyHintKey("g", { labels: ["G"], prefix: "", keymap: { g: "hintClick" }, charset: "saewcmp" }),
    { type: "ignore" },
  );
});

test("classifyHintKey never diverts cycle or reset commands", () => {
  const keymap = { w: "cycleScrollFrame", ";": "resetScrollTarget" };
  const ctx = { labels: ["W", "WA"], prefix: "", keymap, charset: "saewcmp" };
  assert.deepEqual(classifyHintKey("w", ctx), {
    type: "activate",
    prefix: "W",
    label: "W",
  });
  assert.deepEqual(
    classifyHintKey("w", { ...ctx, labels: ["WA"] }),
    { type: "filter", prefix: "W" },
  );
  assert.deepEqual(classifyHintKey(";", ctx), { type: "ignore" });
});

test("collectMutationRoots gathers added subtrees and changed targets", () => {
  const added = { nodeType: 1 };
  const target = { nodeType: 1 };
  const textParent = { nodeType: 1 };
  const out = [];
  collectMutationRoots(
    { addedNodes: [added, { nodeType: 3 }], target },
    out,
  );
  collectMutationRoots(
    { addedNodes: [], target: { nodeType: 3, parentElement: textParent } },
    out,
  );
  collectMutationRoots(null, out);
  assert.deepEqual(out, [added, target, textParent]);
});

test("collectNewcomers accepts visible clickables and skips the rest", () => {
  const prevW = globalThis.window.innerWidth;
  const prevH = globalThis.window.innerHeight;
  const prevStyle = globalThis.window.getComputedStyle;
  globalThis.window.innerWidth = 800;
  globalThis.window.innerHeight = 600;
  globalThis.window.getComputedStyle = () => ({
    opacity: "1",
    visibility: "visible",
    display: "block",
    cursor: "default",
    overflowY: "visible",
    overflowX: "visible",
  });
  const stubEl = (over = {}) => ({
    nodeType: 1,
    tagName: "DIV",
    matches: () => true,
    closest: () => null,
    getAttribute: () => null,
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    getRootNode: () => ({ host: null }),
    parentElement: null,
    contains: () => false,
    shadowRoot: null,
    getBoundingClientRect: () => ({
      left: 10,
      top: 10,
      right: 100,
      bottom: 30,
      width: 90,
      height: 20,
    }),
    querySelectorAll: () => [],
    ...over,
  });
  try {
    const good = stubEl();
    const hidden = stubEl({
      getBoundingClientRect: () => ({
        left: 10,
        top: 2000,
        right: 100,
        bottom: 2020,
        width: 90,
        height: 20,
      }),
    });
    const plain = stubEl({ matches: () => false });
    const root = stubEl({ querySelectorAll: () => [good, hidden, plain] });
    assert.deepEqual(collectNewcomers([root], "click", new Set([good])), [root]);
    assert.deepEqual(collectNewcomers([root], "click", new Set()), [root, good]);
    assert.deepEqual(collectNewcomers([], "click", new Set()), []);
    const input = stubEl({ tagName: "INPUT", type: "text" });
    const inputRoot = stubEl({ matches: () => false, querySelectorAll: () => [input] });
    assert.deepEqual(collectNewcomers([inputRoot], "input", new Set()), [input]);
  } finally {
    globalThis.window.innerWidth = prevW;
    globalThis.window.innerHeight = prevH;
    globalThis.window.getComputedStyle = prevStyle;
  }
});

test("isExplicitlyRequested honors the custom clickable selector", () => {
  assert.equal(isExplicitlyRequested({ matches: () => true }), false);
  settings.set({ clickableSelector: "div.card" });
  assert.equal(isExplicitlyRequested({ matches: (s) => s === "div.card" }), true);
  assert.equal(isExplicitlyRequested({ matches: () => false }), false);
  settings.set({ clickableSelector: "[" });
  assert.equal(
    isExplicitlyRequested({
      matches: () => {
        throw new Error("invalid selector");
      },
    }),
    false,
  );
  settings.set({ clickableSelector: "" });
});

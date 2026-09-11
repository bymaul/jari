import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";

const { __visualCaret } = await import("../content/visual.js");
const {
  isUsableCaretRect,
  firstUsableRect,
  lineHeightForElement,
  resolveCaretGeometry,
  isWordChar,
  findNextWordEnd,
} = __visualCaret;

const ZERO = { left: 100, top: 200, right: 100, bottom: 200, width: 0, height: 0 };

test("zero-area collapsed rect on whitespace is not usable", () => {
  assert.equal(isUsableCaretRect(ZERO), false);
  assert.equal(isUsableCaretRect(null), false);
  // Collapsed caret rects legitimately have zero width but nonzero height.
  assert.equal(
    isUsableCaretRect({ left: 100, top: 200, width: 0, height: 18 }),
    true,
  );
});

test("firstUsableRect skips collapsed whitespace rects", () => {
  const good = { left: 10, top: 20, width: 5, height: 18 };
  assert.equal(firstUsableRect([ZERO, good]), good);
  assert.equal(firstUsableRect([ZERO]), null);
  assert.equal(firstUsableRect(null), null);
});

test("whitespace caret never takes parent block height", () => {
  const geo = resolveCaretGeometry({
    collapsed: ZERO,
    clientRects: [],
    before: null,
    after: null,
    parentRect: { left: 8, top: 50, width: 600, height: 200 },
    fallbackHeight: 19,
  });
  assert.deepEqual(geo, { left: 8, top: 50, height: 19, width: 600 });
});

test("usable collapsed rect wins over everything else", () => {
  const collapsed = { left: 100, top: 200, width: 0, height: 18 };
  const geo = resolveCaretGeometry({
    collapsed,
    clientRects: [{ left: 1, top: 2, width: 50, height: 40 }],
    before: { left: 90, top: 200, right: 100, width: 10, height: 18 },
    after: null,
    parentRect: { left: 8, top: 50, width: 600, height: 200 },
    fallbackHeight: 19,
  });
  assert.deepEqual(geo, { left: 100, top: 200, height: 18, width: 0 });
});

test("caret inside whitespace run anchors to neighbor char edge", () => {
  const before = { left: 90, top: 200, right: 98, width: 8, height: 18 };
  const after = { left: 110, top: 200, right: 118, width: 8, height: 18 };
  const geo = resolveCaretGeometry({
    collapsed: ZERO,
    clientRects: [],
    before,
    after,
    parentRect: null,
    fallbackHeight: 16,
  });
  assert.deepEqual(geo, { left: 98, top: 200, height: 18, width: 0 });
});

test("leading whitespace anchors to next rendered char", () => {
  const after = { left: 30, top: 200, right: 38, width: 8, height: 18 };
  const geo = resolveCaretGeometry({
    collapsed: ZERO,
    clientRects: [],
    before: null,
    after,
    parentRect: null,
    fallbackHeight: 16,
  });
  assert.deepEqual(geo, { left: 30, top: 200, height: 18, width: 0 });
});

test("no measurable rect returns null", () => {
  assert.equal(
    resolveCaretGeometry({
      collapsed: ZERO,
      clientRects: [],
      before: null,
      after: null,
      parentRect: null,
      fallbackHeight: 16,
    }),
    null,
  );
});

test("lineHeightForElement falls back to 16 without computed style", () => {
  assert.equal(lineHeightForElement(null), 16);
  assert.equal(lineHeightForElement({}), 16);
});

test("lineHeightForElement uses computed line height", () => {
  const win = globalThis.window;
  globalThis.window = {
    ...win,
    getComputedStyle: () => ({ lineHeight: "24px", fontSize: "16px" }),
  };
  try {
    assert.equal(lineHeightForElement({}), 24);
  } finally {
    globalThis.window = win;
  }
});

test("isWordChar covers non-ASCII letters and digits", () => {
  assert.equal(isWordChar("a"), true);
  assert.equal(isWordChar("Z"), true);
  assert.equal(isWordChar("5"), true);
  assert.equal(isWordChar("_"), true);
  assert.equal(isWordChar("é"), true);
  assert.equal(isWordChar("中"), true);
  assert.equal(isWordChar("-"), false);
  assert.equal(isWordChar(" "), false);
  assert.equal(isWordChar(""), false);
  assert.equal(isWordChar(null), false);
});

function fakeTextNode(value, tag = "DIV") {
  return { nodeValue: value, parentElement: { tagName: tag } };
}

function stubWordWalker(nodes) {
  const NF = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 3 };
  globalThis.NodeFilter = NF;
  globalThis.document.createTreeWalker = (root, what, filter) => {
    const list = nodes.filter((n) => {
      if (!filter || typeof filter.acceptNode !== "function") return true;
      try {
        return filter.acceptNode(n) === NF.FILTER_ACCEPT;
      } catch {
        return true;
      }
    });
    let i = 0;
    return { nextNode: () => (i < list.length ? list[i++] : null) };
  };
  return (focusNode, focusOffset) => {
    globalThis.window.getSelection = () => ({ focusNode, focusOffset });
  };
}

function restoreWordStubs(saved) {
  if (saved.walker === undefined) delete globalThis.document.createTreeWalker;
  else globalThis.document.createTreeWalker = saved.walker;
  if (saved.nf === undefined) delete globalThis.NodeFilter;
  else globalThis.NodeFilter = saved.nf;
  if (saved.getSelection === undefined) delete globalThis.window.getSelection;
  else globalThis.window.getSelection = saved.getSelection;
}

test("findNextWordEnd lands on words ending at node boundaries", () => {
  const saved = {
    walker: globalThis.document.createTreeWalker,
    nf: globalThis.NodeFilter,
    getSelection: globalThis.window.getSelection,
  };
  const hello = fakeTextNode("hello");
  const rest = fakeTextNode(" you");
  const setFocus = stubWordWalker([hello, rest]);
  try {
    setFocus(hello, 0);
    assert.deepEqual(findNextWordEnd(1), { node: hello, offset: 4 });
    setFocus(hello, 0);
    assert.deepEqual(findNextWordEnd(2), { node: rest, offset: 3 });
  } finally {
    restoreWordStubs(saved);
  }
});

test("findNextWordEnd follows words split across nodes", () => {
  const saved = {
    walker: globalThis.document.createTreeWalker,
    nf: globalThis.NodeFilter,
    getSelection: globalThis.window.getSelection,
  };
  const hel = fakeTextNode("hel");
  const lo = fakeTextNode("lo there");
  const setFocus = stubWordWalker([hel, lo]);
  try {
    setFocus(hel, 0);
    assert.deepEqual(findNextWordEnd(1), { node: lo, offset: 1 });
  } finally {
    restoreWordStubs(saved);
  }
});

test("findNextWordEnd skips script text", () => {
  const saved = {
    walker: globalThis.document.createTreeWalker,
    nf: globalThis.NodeFilter,
    getSelection: globalThis.window.getSelection,
  };
  const hello = fakeTextNode("hello");
  const big = fakeTextNode(" big");
  const code = fakeTextNode("secret", "SCRIPT");
  const setFocus = stubWordWalker([hello, big, code]);
  try {
    setFocus(hello, 0);
    assert.deepEqual(findNextWordEnd(2), { node: big, offset: 3 });
  } finally {
    restoreWordStubs(saved);
  }
});

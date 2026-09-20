import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import {
  isUsableCaretRect,
  firstUsableRect,
  lineHeightForElement,
  resolveCaretGeometry,
} from "../content/visual/caret-geometry.js";

const ZERO = { left: 100, top: 200, right: 100, bottom: 200, width: 0, height: 0 };

test("caret-geometry direct import: zero-area collapsed rect not usable", () => {
  assert.equal(isUsableCaretRect(ZERO), false);
  assert.equal(isUsableCaretRect({ left: 100, top: 200, width: 0, height: 18 }), true);
});

test("caret-geometry direct import: firstUsableRect skips whitespace", () => {
  const good = { left: 10, top: 20, width: 5, height: 18 };
  assert.equal(firstUsableRect([ZERO, good]), good);
  assert.equal(firstUsableRect([ZERO]), null);
});

test("caret-geometry direct import: resolveCaretGeometry prefers collapsed", () => {
  const collapsed = { left: 100, top: 200, width: 0, height: 18 };
  const geo = resolveCaretGeometry({
    collapsed,
    clientRects: [{ left: 1, top: 2, width: 50, height: 40 }],
    before: null,
    after: null,
    parentRect: { left: 8, top: 50, width: 600, height: 200 },
    fallbackHeight: 19,
  });
  assert.deepEqual(geo, { left: 100, top: 200, height: 18, width: 0 });
});

test("caret-geometry direct import: lineHeightForElement fallback", () => {
  assert.equal(lineHeightForElement(null), 16);
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

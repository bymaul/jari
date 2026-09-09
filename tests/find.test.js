import "./setup.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  Find,
  __testHelpers,
  __getFindTestState,
  __resetFindState,
  __setFindTestState,
} from "../content/find.js";

const {
  rectIntersectsViewport,
  findFixedAncestor,
  nearestScrollableAncestor,
  scrollFixedMatchIntoView,
  buildMatcher,
  findToggleCommandFor,
} = __testHelpers;

const hadInnerWidth = "innerWidth" in globalThis.window;
const hadInnerHeight = "innerHeight" in globalThis.window;
const hadGetComputedStyle = "getComputedStyle" in globalThis.window;
const savedInnerWidth = globalThis.window.innerWidth;
const savedInnerHeight = globalThis.window.innerHeight;
const savedGetComputedStyle = globalThis.window.getComputedStyle;

function fakeEl({
  position = "static",
  parent = null,
  host = null,
  rect = null,
  scrollHeight = 10,
  clientHeight = 10,
  scrollWidth = 10,
  clientWidth = 10,
  overflow = "visible",
} = {}) {
  return {
    nodeType: 1,
    isConnected: true,
    parentElement: parent,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight,
    clientHeight,
    scrollWidth,
    clientWidth,
    _rect: rect || {
      top: 0,
      bottom: 10,
      left: 0,
      right: 10,
      width: 10,
      height: 10,
    },
    _style: {
      position,
      display: "block",
      visibility: "visible",
      overflowY: overflow,
      overflowX: overflow,
    },
    getRootNode: () => ({ host }),
    getBoundingClientRect() {
      return this._rect;
    },
  };
}

beforeEach(() => {
  globalThis.window.innerWidth = 800;
  globalThis.window.innerHeight = 600;
  globalThis.window.getComputedStyle = (el) =>
    (el && el._style) || {
      position: "static",
      display: "block",
      visibility: "visible",
      overflowY: "visible",
      overflowX: "visible",
    };
});

afterEach(() => {
  if (hadInnerWidth) globalThis.window.innerWidth = savedInnerWidth;
  else delete globalThis.window.innerWidth;
  if (hadInnerHeight) globalThis.window.innerHeight = savedInnerHeight;
  else delete globalThis.window.innerHeight;
  if (hadGetComputedStyle) globalThis.window.getComputedStyle = savedGetComputedStyle;
  else delete globalThis.window.getComputedStyle;
});

test("rectIntersectsViewport detects on-screen rects", () => {
  assert.equal(
    rectIntersectsViewport({ top: 10, bottom: 20, left: 10, right: 20 }),
    true,
  );
  assert.equal(
    rectIntersectsViewport({ top: -20, bottom: -1, left: 10, right: 20 }),
    false,
  );
  assert.equal(
    rectIntersectsViewport({ top: 600, bottom: 620, left: 10, right: 20 }),
    false,
  );
  assert.equal(
    rectIntersectsViewport({ top: 590, bottom: 610, left: 10, right: 20 }),
    true,
  );
  assert.equal(rectIntersectsViewport(null), false);
});

test("findFixedAncestor walks the parent chain", () => {
  const page = fakeEl();
  const mid = fakeEl({ parent: page });
  const leaf = fakeEl({ parent: mid });
  assert.equal(findFixedAncestor(leaf), null);

  const fixed = fakeEl({ position: "fixed", parent: page });
  const inner = fakeEl({ parent: fixed });
  const deepLeaf = fakeEl({ parent: inner });
  assert.equal(findFixedAncestor(deepLeaf), fixed);
  assert.equal(findFixedAncestor(fixed), fixed);
});

test("findFixedAncestor crosses shadow hosts", () => {
  const host = fakeEl();
  const leaf = fakeEl({ parent: null, host });
  assert.equal(findFixedAncestor(leaf), null);
  const fixedHost = fakeEl({ position: "fixed" });
  const shadowLeaf = fakeEl({ parent: null, host: fixedHost });
  assert.equal(findFixedAncestor(shadowLeaf), fixedHost);
});

test("nearestScrollableAncestor finds the inner scroller", () => {
  const page = fakeEl();
  const scroller = fakeEl({
    parent: page,
    scrollHeight: 500,
    clientHeight: 100,
    overflow: "auto",
  });
  const leaf = fakeEl({ parent: scroller });
  assert.equal(nearestScrollableAncestor(leaf, null), scroller);
  assert.equal(nearestScrollableAncestor(leaf, scroller), scroller);
});

test("nearestScrollableAncestor never escapes past a fixed container", () => {
  const pageScroller = fakeEl({
    scrollHeight: 2000,
    clientHeight: 600,
    overflow: "auto",
  });
  const fixed = fakeEl({ position: "fixed", parent: pageScroller });
  const leaf = fakeEl({ parent: fixed });
  assert.equal(nearestScrollableAncestor(leaf, fixed), null);

  const fixedScroller = fakeEl({
    position: "fixed",
    parent: pageScroller,
    scrollHeight: 500,
    clientHeight: 100,
    overflow: "auto",
  });
  const innerLeaf = fakeEl({ parent: fixedScroller });
  assert.equal(nearestScrollableAncestor(innerLeaf, fixedScroller), fixedScroller);
});

test("scrollFixedMatchIntoView scrolls only the inner container", () => {
  const fixed = fakeEl({
    position: "fixed",
    scrollHeight: 500,
    clientHeight: 100,
    overflow: "auto",
  });
  fixed._rect = { top: 0, bottom: 100, left: 0, right: 200 };
  const leaf = fakeEl({
    parent: fixed,
    rect: { top: 700, bottom: 710, left: 10, right: 100 },
  });
  scrollFixedMatchIntoView(leaf, fixed, leaf._rect);
  assert.equal(fixed.scrollTop, 610);

  fixed.scrollTop = 0;
  leaf._rect = { top: -30, bottom: -20, left: 10, right: 100 };
  scrollFixedMatchIntoView(leaf, fixed, leaf._rect);
  assert.equal(fixed.scrollTop, -30);

  fixed.scrollTop = 0;
  leaf._rect = { top: 10, bottom: 20, left: 10, right: 100 };
  scrollFixedMatchIntoView(leaf, fixed, leaf._rect);
  assert.equal(fixed.scrollTop, 0);
});

test("scrollFixedMatchIntoView does nothing without an inner scroller", () => {
  const fixed = fakeEl({ position: "fixed" });
  fixed._rect = { top: 0, bottom: 100, left: 0, right: 200 };
  const leaf = fakeEl({
    parent: fixed,
    rect: { top: 700, bottom: 710, left: 10, right: 100 },
  });
  assert.doesNotThrow(() => scrollFixedMatchIntoView(leaf, fixed, leaf._rect));
});

test("buildMatcher compiles substring, regex and whole-word patterns", () => {
  const sub = buildMatcher("a.c");
  assert.ok(sub.test("a.c"));
  assert.ok(!sub.test("aXc"));
  assert.ok(sub.test("A.C"));
  assert.ok(!sub.test("ABC"));

  const sensitive = buildMatcher("Abc", { caseSensitive: true });
  assert.ok(sensitive.test("Abc"));
  assert.ok(!sensitive.test("abc"));

  const word = buildMatcher("cat", { wholeWord: true });
  assert.ok(word.test("a cat sat"));
  assert.ok(!word.test("concatenate"));

  const rx = buildMatcher("a+c", { regex: true });
  assert.ok(rx.test("aaac"));
  assert.ok(!rx.test("abc"));

  assert.equal(buildMatcher(""), null);
  assert.equal(buildMatcher("(unclosed", { regex: true }), null);
  assert.equal(buildMatcher("x", { regex: true, wholeWord: true }).source, "x");
});

test("findToggleCommandFor resolves only toggle commands", () => {
  const keymap = {
    "alt+r": "toggleFindRegex",
    "alt+w": "toggleFindWholeWord",
    "alt+c": "toggleFindCase",
    j: "scrollDown",
  };
  assert.equal(findToggleCommandFor(keymap, "alt+r"), "toggleFindRegex");
  assert.equal(findToggleCommandFor(keymap, "alt+w"), "toggleFindWholeWord");
  assert.equal(findToggleCommandFor(keymap, "alt+c"), "toggleFindCase");
  assert.equal(findToggleCommandFor(keymap, "j"), null);
  assert.equal(findToggleCommandFor(keymap, "alt+x"), null);
  assert.equal(findToggleCommandFor(null, "alt+r"), null);
  assert.equal(
    findToggleCommandFor({ "F2": "toggleFindRegex" }, "F2"),
    "toggleFindRegex",
  );
});

function escEvent() {
  return {
    key: "Escape",
    preventDefault() {},
    stopImmediatePropagation() {},
  };
}

function fakeMatch() {
  const parent = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 10, bottom: 20, left: 10, right: 20 }),
  };
  return {
    startContainer: { isConnected: true, parentElement: parent },
    endContainer: { isConnected: true },
  };
}

test("Esc hides find highlights without forgetting the query", () => {
  __resetFindState();
  try {
    __setFindTestState({ matches: [fakeMatch(), fakeMatch()], query: "foo" });
    assert.equal(Find.hasHighlights(), true);
    assert.equal(Find.handleGlobalEsc(escEvent()), true);
    assert.equal(Find.hasHighlights(), false);
    assert.deepEqual(__getFindTestState(), {
      matchCount: 2,
      currentIdx: 0,
      lastQuery: "foo",
      highlightsHidden: true,
    });
    // A second Esc is a no-op so the key reaches the page.
    assert.equal(Find.handleGlobalEsc(escEvent()), false);
    assert.equal(__getFindTestState().lastQuery, "foo");
  } finally {
    __resetFindState();
  }
});

test("n resumes hidden find highlights and steps to the next match", () => {
  __resetFindState();
  try {
    __setFindTestState({ matches: [fakeMatch(), fakeMatch()], query: "foo" });
    Find.handleGlobalEsc(escEvent());
    assert.equal(Find.hasHighlights(), false);
    Find.next(1, false);
    assert.equal(Find.hasHighlights(), true);
    assert.deepEqual(__getFindTestState(), {
      matchCount: 2,
      currentIdx: 1,
      lastQuery: "foo",
      highlightsHidden: false,
    });
  } finally {
    __resetFindState();
  }
});

test("clearing find highlights resets the hidden flag", () => {
  __resetFindState();
  try {
    __setFindTestState({ matches: [fakeMatch()], query: "foo" });
    Find.handleGlobalEsc(escEvent());
    Find.clearHighlights();
    assert.deepEqual(__getFindTestState(), {
      matchCount: 0,
      currentIdx: 0,
      lastQuery: "foo",
      highlightsHidden: false,
    });
  } finally {
    __resetFindState();
  }
});

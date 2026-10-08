import "./setup.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const { Scroll, __resetScrollCache, __adoptNewDialog, __pruneObserved, __observedRootCount } = await import("../content/scroll.js");

const VW = 800;
const VH = 600;

globalThis.Node = { ELEMENT_NODE: 1 };

const windowCalls = { focus: 0, blur: 0 };
globalThis.window.innerWidth = VW;
globalThis.window.innerHeight = VH;
globalThis.window.scrollX = 0;
globalThis.window.scrollY = 0;
globalThis.window.focus = () => {
  windowCalls.focus++;
};
globalThis.window.blur = () => {
  windowCalls.blur++;
};
globalThis.window.getComputedStyle = () => ({
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflowY: "auto",
  overflowX: "auto",
});

function makeArea() {
  return {
    tagName: "DIV",
    nodeType: 1,
    isConnected: true,
    parentElement: null,
    clientHeight: 200,
    clientWidth: 200,
    scrollHeight: 600,
    scrollWidth: 200,
    focusCalls: 0,
    blurCalls: 0,
    closest: () => null,
    contains: () => false,
    getAttribute: () => null,
    hasAttribute: () => false,
    getRootNode: () => ({ host: null }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
    }),
    scrollIntoView: () => {},
    focus() {
      this.focusCalls++;
    },
    blur() {
      this.blurCalls++;
    },
    matches: (sel) => sel === "*",
  };
}

function makeFrame() {
  const el = makeArea();
  el.tagName = "IFRAME";
  el.matches = () => true;
  el.contentWindow = {
    focusCalls: 0,
    focus() {
      this.focusCalls++;
    },
  };
  return el;
}

// One shared fixture set: the scroll module caches element lookups per
// scan epoch, so fixtures must stay identical across tests.
const area = makeArea();
const frame = makeFrame();
globalThis.document.querySelectorAll = () => [area, frame];
globalThis.document.scrollingElement = { scrollHeight: 1200, clientHeight: 600 };
globalThis.document.createElement = () => ({
  style: {},
  appendChild: () => {},
  remove: () => {},
});
globalThis.document.body = { appendChild: () => {} };

function resetCalls() {
  area.focusCalls = 0;
  area.blurCalls = 0;
  frame.focusCalls = 0;
  frame.blurCalls = 0;
  frame.contentWindow.focusCalls = 0;
  windowCalls.focus = 0;
  windowCalls.blur = 0;
}

beforeEach(() => {
  globalThis.window.top = globalThis.window;
  globalThis.document.activeElement = null;
  resetCalls();
});

// The top-frame rotation is global -> area -> frame -> global.
function rotateTo(target) {
  for (let i = 0; i < 4; i++) {
    if (Scroll.getTarget() === target) return;
    Scroll.cycle();
  }
  assert.fail("could not rotate to the expected scroll target");
}

test("w cycles global -> area -> frame -> global", () => {
  rotateTo(globalThis.window);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), area);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("W cycles backward global -> frame -> area -> global", () => {
  rotateTo(globalThis.window);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), area);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("a repeat count skips stops in either direction", () => {
  rotateTo(area);
  Scroll.cycle(2);
  assert.equal(Scroll.getTarget(), globalThis.window);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle(-2);
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("reset returns to the page after cycling onto an area", () => {
  rotateTo(area);
  assert.equal(Scroll.getTarget(), area);

  Scroll.reset();

  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("reset releases frame focus and returns to the page", () => {
  rotateTo(frame);
  assert.equal(Scroll.getTarget(), frame);
  globalThis.document.activeElement = frame;
  resetCalls();

  Scroll.reset();

  assert.equal(Scroll.getTarget(), globalThis.window);
  assert.ok(frame.blurCalls > 0, "expected the frame to be blurred");
  assert.ok(windowCalls.focus > 0, "expected focus to return to the page");
});

function makeAreaAt({ top = 0, left = 0, w = 200, h = 200, overflow = 400, tag = "DIV" } = {}) {
  const el = makeArea();
  el.tagName = tag;
  el.clientHeight = h;
  el.clientWidth = w;
  el.scrollHeight = h + overflow;
  el.scrollWidth = w;
  el.getBoundingClientRect = () => ({
    left,
    top,
    right: left + w,
    bottom: top + h,
    width: w,
    height: h,
  });
  return el;
}

const defaultFixtures = globalThis.document.querySelectorAll;

function useFixtures(list) {
  globalThis.document.querySelectorAll = () => list;
  __resetScrollCache();
  Scroll.reset();
}

function restoreFixtures() {
  globalThis.document.querySelectorAll = defaultFixtures;
  globalThis.document.scrollingElement = { scrollHeight: 1200, clientHeight: 600 };
  globalThis.document.activeElement = null;
  __resetScrollCache();
  Scroll.reset();
}

test("the first cycle step prefers the largest overflow", () => {
  const small = makeAreaAt({ overflow: 50 });
  const big = makeAreaAt({ left: 300, overflow: 900 });
  useFixtures([small, big]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), big);
  } finally {
    restoreFixtures();
  }
});

test("an open dialog wins the first step even when the page scrolls", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const dialog = makeAreaAt({ left: 300, overflow: 50, tag: "DIALOG" });
  useFixtures([plain, dialog]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), dialog);
  } finally {
    restoreFixtures();
  }
});

test("the focused area wins the first step", () => {
  const big = makeAreaAt({ overflow: 900 });
  const small = makeAreaAt({ left: 300, overflow: 50 });
  const inner = { nodeType: 1 };
  small.contains = (node) => node === inner;
  globalThis.document.querySelectorAll = () => [big, small];
  __resetScrollCache();
  Scroll.reset();
  globalThis.document.activeElement = inner;
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), small);
  } finally {
    restoreFixtures();
  }
});

test("stops after the first pick follow visual top-to-bottom order", () => {
  const bottom = makeAreaAt({ top: 400 });
  const top = makeAreaAt({ top: 0 });
  useFixtures([bottom, top]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), top);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), bottom);
  } finally {
    restoreFixtures();
  }
});

test("nested wrappers collapse to a single stop", () => {
  const outer = makeAreaAt({ overflow: 900 });
  const inner = makeAreaAt({ left: 10, top: 10, w: 100, h: 100, overflow: 400 });
  outer.contains = (node) => node === inner;
  useFixtures([outer, inner]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), inner);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), globalThis.window);
  } finally {
    restoreFixtures();
  }
});

test("a fresh dialog steals the target from a plain area", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const dialog = makeAreaAt({ left: 300, overflow: 50, tag: "DIALOG" });
  useFixtures([plain]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), plain);
    globalThis.document.querySelectorAll = () => [plain, dialog];
    __resetScrollCache();
    __adoptNewDialog([]);
    assert.equal(Scroll.getTarget(), dialog);
  } finally {
    restoreFixtures();
  }
});

test("adoption leaves an open dialog alone and ignores stale dialogs", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const first = makeAreaAt({ left: 300, overflow: 50, tag: "DIALOG" });
  const second = makeAreaAt({ left: 500, overflow: 50, tag: "DIALOG" });
  useFixtures([plain, first]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), first);
    globalThis.document.querySelectorAll = () => [plain, first, second];
    __resetScrollCache();
    __adoptNewDialog([plain, first]);
    assert.equal(Scroll.getTarget(), first);
  } finally {
    restoreFixtures();
  }
  useFixtures([plain]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), plain);
    globalThis.document.querySelectorAll = () => [plain, first];
    __resetScrollCache();
    __adoptNewDialog([plain, first]);
    assert.equal(Scroll.getTarget(), plain);
  } finally {
    restoreFixtures();
  }
});

test("getTarget prefers an open modal over a scrolling page", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const dialog = makeAreaAt({ left: 300, overflow: 50, tag: "DIALOG" });
  useFixtures([plain, dialog]);
  try {
    assert.equal(Scroll.getTarget(), dialog);
  } finally {
    restoreFixtures();
  }
});

test("getTarget prefers an aria-modal div over a scrolling page", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const modal = makeAreaAt({ left: 300, overflow: 50 });
  modal.getAttribute = (name) => (name === "aria-modal" ? "true" : null);
  useFixtures([plain, modal]);
  try {
    assert.equal(Scroll.getTarget(), modal);
  } finally {
    restoreFixtures();
  }
});

test("a plain role=dialog panel does not steal the page", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const panel = makeAreaAt({ left: 300, overflow: 50 });
  panel.getAttribute = (name) => (name === "role" ? "dialog" : null);
  useFixtures([plain, panel]);
  try {
    assert.equal(Scroll.getTarget(), globalThis.window);
  } finally {
    restoreFixtures();
  }
});

test("detached observed roots are pruned instead of leaking", () => {
  const host = makeAreaAt({ overflow: 900 });
  const deadShadow = { isConnected: false, querySelectorAll: () => [] };
  host.shadowRoot = deadShadow;
  useFixtures([host]);
  try {
    Scroll.getTarget();
    const before = __observedRootCount();
    assert.ok(before >= 1, "expected the shadow root to be observed");
    __pruneObserved();
    assert.equal(__observedRootCount(), before - 1);
  } finally {
    restoreFixtures();
    __pruneObserved();
  }
});

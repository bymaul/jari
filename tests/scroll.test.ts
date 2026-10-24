import "./setup.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const { Scroll, frameScrollBox, __smoothFrameMove } =
  await import("../content/scroll.ts");

const VW = 800;
const VH = 600;

globalThis.Node = { ELEMENT_NODE: 1 } as unknown as typeof Node;

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
globalThis.window.getComputedStyle = (() => ({
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflowY: "auto",
  overflowX: "auto",
})) as unknown as typeof window.getComputedStyle;

interface FakeArea {
  tagName: string;
  nodeType: number;
  isConnected: boolean;
  parentElement: null;
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollWidth: number;
  focusCalls: number;
  blurCalls: number;
  closest: () => null;
  contains: (node: unknown) => boolean;
  getAttribute: () => null;
  hasAttribute: () => boolean;
  getRootNode: () => { host: null };
  getBoundingClientRect: () => {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  scrollIntoView: () => void;
  focus(): void;
  blur(): void;
  matches: (sel: string) => boolean;
  contentWindow?: { focusCalls: number; focus(): void };
  contentDocument?: unknown;
}

function makeArea(): FakeArea {
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

function makeFrame(): FakeArea {
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

// One shared fixture set, reset explicitly between cases.
const area = makeArea();
const frame = makeFrame();
const doc = globalThis.document as unknown as Record<string, unknown>;
const win = globalThis.window as unknown as Record<string, unknown>;
doc.querySelectorAll = () => [area, frame];
doc.scrollingElement = { scrollHeight: 1200, clientHeight: 600 };
doc.createElement = () => ({
  style: {},
  appendChild: () => {},
  remove: () => {},
});
doc.body = { appendChild: () => {} };

function resetCalls() {
  area.focusCalls = 0;
  area.blurCalls = 0;
  frame.focusCalls = 0;
  frame.blurCalls = 0;
  frame.contentWindow!.focusCalls = 0;
  windowCalls.focus = 0;
  windowCalls.blur = 0;
}

beforeEach(() => {
  win.top = globalThis.window;
  doc.activeElement = null;
  resetCalls();
});

function rotateTo(target: unknown) {
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

test("cycle walks the DOM once per press", () => {
  rotateTo(globalThis.window);
  const prevQsa = globalThis.document.querySelectorAll;
  let queries = 0;
  globalThis.document.querySelectorAll = ((...args: [string]) => {
    queries++;
    return prevQsa(...args);
  }) as unknown as typeof globalThis.document.querySelectorAll;
  try {
    queries = 0;
    Scroll.cycle();
    assert.equal(queries, 2);
  } finally {
    globalThis.document.querySelectorAll = prevQsa;
  }
});

function makeChatFrame() {
  const inner = makeArea();
  const innerDoc = {
    scrollingElement: {
      scrollHeight: 300,
      clientHeight: 300,
      scrollWidth: 300,
      clientWidth: 300,
    },
    body: { querySelectorAll: () => [inner] },
  };
  const frame = makeFrame();
  frame.scrollHeight = 200;
  frame.scrollWidth = 200;
  frame.contentDocument = innerDoc;
  return { frame, inner };
}

function makeDeadFrame() {
  const frame = makeFrame();
  frame.scrollHeight = 200;
  frame.scrollWidth = 200;
  frame.contentDocument = {
    scrollingElement: {
      scrollHeight: 300,
      clientHeight: 300,
      scrollWidth: 300,
      clientWidth: 300,
    },
    body: { querySelectorAll: () => [] },
  };
  return frame;
}

test("a frame with a scrollable inner panel is a stop", () => {
  const { frame } = makeChatFrame();
  useFixtures([frame]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), frame);
  } finally {
    restoreFixtures();
  }
});

test("frameScrollBox resolves the inner panel, null for the rest", () => {
  const { frame, inner } = makeChatFrame();
  assert.equal(frameScrollBox(frame as unknown as HTMLIFrameElement), inner);
  assert.equal(
    frameScrollBox(makeDeadFrame() as unknown as HTMLIFrameElement),
    null,
  );
  assert.equal(frameScrollBox(area as unknown as HTMLIFrameElement), null);
});

test("a frame with no scrollable content is not a stop", () => {
  useFixtures([makeDeadFrame()]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), globalThis.window);
  } finally {
    restoreFixtures();
  }
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
  doc.activeElement = frame;
  resetCalls();

  Scroll.reset();

  assert.equal(Scroll.getTarget(), globalThis.window);
  assert.ok(frame.blurCalls > 0, "expected the frame to be blurred");
  assert.ok(windowCalls.focus > 0, "expected focus to return to the page");
});

function makeAreaAt({
  top = 0,
  left = 0,
  w = 200,
  h = 200,
  overflow = 400,
  tag = "DIV",
}: {
  top?: number;
  left?: number;
  w?: number;
  h?: number;
  overflow?: number;
  tag?: string;
} = {}) {
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

function useFixtures(list: unknown[]) {
  doc.querySelectorAll = () => list;
  Scroll.reset();
}

function restoreFixtures() {
  doc.querySelectorAll = defaultFixtures;
  doc.scrollingElement = { scrollHeight: 1200, clientHeight: 600 };
  doc.activeElement = null;
  Scroll.reset();
}

test("the first cycle step follows visual order, not overflow size", () => {
  const small = makeAreaAt({ overflow: 50 });
  const big = makeAreaAt({ left: 300, overflow: 900 });
  useFixtures([small, big]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), small);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), big);
  } finally {
    restoreFixtures();
  }
});

test("a dialog is a plain stop in visual order", () => {
  const plain = makeAreaAt({ overflow: 900 });
  const dialog = makeAreaAt({ left: 300, overflow: 50, tag: "DIALOG" });
  useFixtures([plain, dialog]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), plain);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), dialog);
  } finally {
    restoreFixtures();
  }
});

test("getTarget stays on the page until an explicit cycle", () => {
  const big = makeAreaAt({ overflow: 900 });
  const small = makeAreaAt({ left: 300, overflow: 50 });
  const inner = { nodeType: 1 };
  small.contains = (node) => node === inner;
  doc.querySelectorAll = () => [big, small];
  Scroll.reset();
  doc.activeElement = inner;
  try {
    assert.equal(Scroll.getTarget(), globalThis.window);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), big);
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
  const inner = makeAreaAt({
    left: 10,
    top: 10,
    w: 100,
    h: 100,
    overflow: 400,
  });
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

test("offscreen areas are not stops, even with huge overflow", () => {
  const visible = makeAreaAt({ overflow: 50 });
  const offscreen = makeAreaAt({ top: 2000, overflow: 5000 });
  useFixtures([visible, offscreen]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), visible);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), globalThis.window);
  } finally {
    restoreFixtures();
  }
});

test("a sliver peeking into the viewport is not a stop", () => {
  const visible = makeAreaAt({ overflow: 50 });
  const sliver = makeAreaAt({ top: -190, overflow: 400 });
  useFixtures([visible, sliver]);
  try {
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), visible);
    Scroll.cycle();
    assert.equal(Scroll.getTarget(), globalThis.window);
  } finally {
    restoreFixtures();
  }
});

test("getTarget performs no DOM scan", () => {
  const big = makeAreaAt({ overflow: 900 });
  const prevQsa = globalThis.document.querySelectorAll;
  const prevStyle = globalThis.window.getComputedStyle;
  let queries = 0;
  let styles = 0;
  globalThis.document.querySelectorAll = (() => {
    queries++;
    return [big];
  }) as unknown as typeof globalThis.document.querySelectorAll;
  globalThis.window.getComputedStyle = ((...args: [Element]) => {
    styles++;
    return prevStyle(...args);
  }) as unknown as typeof window.getComputedStyle;
  try {
    Scroll.reset();
    queries = 0;
    styles = 0;
    for (let i = 0; i < 5; i++) {
      assert.equal(Scroll.getTarget(), globalThis.window);
    }
    assert.equal(queries, 0, "expected no DOM walk on plain scroll keys");
    assert.equal(styles, 0, "expected no style reads on plain scroll keys");
  } finally {
    globalThis.document.querySelectorAll = prevQsa;
    globalThis.window.getComputedStyle = prevStyle;
    restoreFixtures();
  }
});

test("__smoothFrameMove covers 40% of pending per 60fps frame", () => {
  assert.equal(__smoothFrameMove(120, 1000 / 60), 48);
  assert.equal(__smoothFrameMove(-120, 1000 / 60), -48);
});

test("__smoothFrameMove compensates dropped frames with bigger steps", () => {
  const base = __smoothFrameMove(120, 1000 / 60);
  const dropped = __smoothFrameMove(120, 50);
  assert.ok(dropped > base, "expected a bigger step after a long frame");
  assert.equal(dropped, 94);
});

test("__smoothFrameMove caps the per-frame share and keeps a 1px minimum", () => {
  assert.equal(__smoothFrameMove(100000, 1000 / 60), 80);
  assert.equal(__smoothFrameMove(1, 1000 / 60), 1);
  assert.equal(__smoothFrameMove(0, 1000 / 60), 0);
});

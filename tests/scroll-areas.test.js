import "./setup.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const observers = [];
globalThis.window.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    observers.push(this);
  }
  observe(target, options) {
    this.targets.push({ target, options });
  }
  disconnect() {}
};

const messageListeners = [];
const baseAddEventListener =
  globalThis.window.addEventListener.bind(globalThis.window);
globalThis.window.addEventListener = (type, fn, ...rest) => {
  if (type === "message" && typeof fn === "function") {
    messageListeners.push(fn);
    return;
  }
  baseAddEventListener(type, fn, ...rest);
};

function documentObservers() {
  return observers.filter((o) =>
    o.targets.some(
      (t) =>
        t.target === globalThis.document ||
        t.target === globalThis.document.documentElement,
    ),
  );
}

const { Scroll, __resetScrollCache } = await import("../content/scroll.js");

// TikTok-shaped viewport: feed column, comments panel, and a narrow side
// column with a few pixels of overflow. Every qualifying stop must stay
// reachable: filtering near-empty ranges regressed sidebar detection.
const VW = 1440;
const VH = 1039;

globalThis.Node = { ELEMENT_NODE: 1 };

globalThis.window.innerWidth = VW;
globalThis.window.innerHeight = VH;
globalThis.window.scrollX = 0;
globalThis.window.scrollY = 0;
globalThis.window.top = globalThis.window;
globalThis.window.focus = () => {};
globalThis.window.blur = () => {};
globalThis.window.getComputedStyle = (el) => ({
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflowY: (el && el.overflowY) || "scroll",
  overflowX: (el && el.overflowX) || "visible",
});

const created = [];
globalThis.document.createElement = (tag) => {
  const el = { tagName: tag, style: {}, children: [], textContent: "" };
  el.appendChild = (child) => {
    el.children.push(child);
    return child;
  };
  el.remove = () => {};
  created.push(el);
  return el;
};
globalThis.document.body = { appendChild: () => {} };

function makeDiv({
  clientWidth,
  clientHeight,
  scrollWidth,
  scrollHeight,
  rect,
  overflowY = "scroll",
  overflowX = "visible",
}) {
  return {
    tagName: "DIV",
    nodeType: 1,
    isConnected: true,
    parentElement: null,
    clientWidth,
    clientHeight,
    scrollWidth: scrollWidth ?? clientWidth,
    scrollHeight,
    overflowY,
    overflowX,
    closest: () => null,
    hasAttribute: () => false,
    getRootNode: () => ({ host: null }),
    getBoundingClientRect: () => ({ ...rect }),
    scrollIntoView: () => {},
    focus: () => {},
    blur: () => {},
    matches: (sel) => sel === "*",
  };
}

function rectOf(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

let current = [];
globalThis.document.querySelectorAll = () => current;

function useFixtures(elements, pageScrollHeight = VH) {
  current = elements;
  globalThis.document.scrollingElement = {
    scrollHeight: pageScrollHeight,
    clientHeight: VH,
  };
  __resetScrollCache();
  Scroll.reset();
  created.length = 0;
}

function tiktokFixtures() {
  const feed = makeDiv({
    clientWidth: 791,
    clientHeight: 1039,
    scrollHeight: 21819,
    rect: rectOf(240, 0, 791, 1039),
  });
  const junk = makeDiv({
    clientWidth: 208,
    clientHeight: 935,
    scrollHeight: 953,
    rect: rectOf(16, 104, 208, 935),
  });
  const comments = makeDiv({
    clientWidth: 352,
    clientHeight: 901,
    scrollHeight: 1849,
    rect: rectOf(1047, 60, 352, 901),
  });
  return { feed, junk, comments };
}

function labels() {
  return created
    .filter((el) => el.tagName === "span")
    .map((el) => el.textContent);
}

beforeEach(() => {
  globalThis.window.top = globalThis.window;
  globalThis.document.activeElement = null;
});

test("auto-pick lands on the feed, every stop stays reachable", () => {
  const { feed, junk, comments } = tiktokFixtures();
  useFixtures([feed, junk, comments]);
  assert.equal(Scroll.getTarget(), feed);

  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    Scroll.cycle();
    seen.add(Scroll.getTarget());
  }
  assert.ok(seen.has(feed), "expected the feed among cycle stops");
  assert.ok(seen.has(comments), "expected the comments panel among cycle stops");
  assert.ok(seen.has(junk), "expected the sidebar among cycle stops");
  assert.equal(seen.size, 3);
});

test("cycle rotates feed -> sidebar -> comments -> feed", () => {
  const { feed, junk, comments } = tiktokFixtures();
  useFixtures([feed, junk, comments]);
  assert.equal(Scroll.getTarget(), feed);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), junk);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), comments);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), feed);
});

test("highlight label shows the area name", () => {
  const { feed } = tiktokFixtures();
  useFixtures([feed, tiktokFixtures().junk, tiktokFixtures().comments]);
  Scroll.showHighlight();
  assert.deepEqual(labels(), ["current scroll area"]);
  created.length = 0;
  Scroll.cycle();
  assert.deepEqual(labels(), ["current scroll area"]);
});

test("sliver with a few pixels of range still qualifies as a stop", () => {
  const sliver = makeDiv({
    clientWidth: 208,
    clientHeight: 935,
    scrollHeight: 953,
    rect: rectOf(16, 104, 208, 935),
  });
  useFixtures([sliver]);
  assert.equal(Scroll.getTarget(), sliver);
});

test("horizontal-only scroller still qualifies", () => {
  const carousel = makeDiv({
    clientWidth: 800,
    clientHeight: 100,
    scrollWidth: 2000,
    scrollHeight: 102,
    rect: rectOf(0, 0, 800, 100),
    overflowX: "scroll",
  });
  useFixtures([carousel]);
  assert.equal(Scroll.getTarget(), carousel);
});

test("document observation watches class attributes, not style churn", () => {
  const { feed } = tiktokFixtures();
  useFixtures([feed]);
  const docs = documentObservers();
  assert.ok(docs.length > 0, "expected the document to be observed");
  for (const observer of docs) {
    for (const { options } of observer.targets) {
      assert.equal(options.childList, true);
      assert.equal(options.subtree, true);
      assert.equal(options.attributes, true);
      assert.deepEqual(options.attributeFilter, ["class"]);
    }
  }
});

test("a panel added later becomes a stop after document mutation", async () => {
  const { feed, junk, comments } = tiktokFixtures();
  useFixtures([feed, junk]);
  assert.equal(Scroll.getTarget(), feed);

  // The comments panel opens after the first scan.
  useFixturesWithoutReset([feed, junk, comments]);
  const docs = documentObservers();
  assert.ok(docs.length > 0, "expected the document to be observed");
  for (const observer of docs) observer.callback([], observer);
  await new Promise((r) => setTimeout(r, 250));

  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    Scroll.cycle();
    seen.add(Scroll.getTarget());
  }
  assert.ok(seen.has(comments), "late panel must become a cycle stop");
  assert.ok(seen.has(feed), "existing stops must survive the rescan");
  assert.ok(seen.has(junk), "existing stops must survive the rescan");
  assert.equal(seen.size, 3);
});

function useFixturesWithoutReset(elements) {
  current = elements;
}

function makeFrame({ contentWindow, contentDocument } = {}) {
  const el = makeDiv({
    clientWidth: 352,
    clientHeight: 901,
    scrollHeight: 901,
    rect: rectOf(1047, 60, 352, 901),
  });
  el.tagName = "IFRAME";
  el.matches = () => true;
  if (contentWindow !== undefined) el.contentWindow = contentWindow;
  if (contentDocument !== undefined) el.contentDocument = contentDocument;
  return el;
}

function cycleMessage(source) {
  for (const fn of messageListeners) fn({ data: { type: "jari-cycle-scroll" }, source });
}

test("cycle ignores messages from non-frame sources", () => {
  const { feed, junk } = tiktokFixtures();
  useFixtures([feed, junk]);
  assert.equal(Scroll.getTarget(), feed);
  created.length = 0;
  cycleMessage({});
  cycleMessage(globalThis.window);
  cycleMessage(null);
  for (const fn of messageListeners) fn({ data: { type: "other" }, source: {} });
  assert.equal(Scroll.getTarget(), feed);
  assert.deepEqual(
    created.filter((el) => el.tagName === "div"),
    [],
  );
});

test("cycle runs for messages from a direct child frame", () => {
  const { feed } = tiktokFixtures();
  const frameWin = {};
  const frame = makeFrame({ contentWindow: frameWin });
  useFixtures([feed]);
  assert.equal(Scroll.getTarget(), feed);
  useFixturesWithoutReset([feed, frame]);
  __resetScrollCache();
  cycleMessage(frameWin);
  assert.equal(Scroll.getTarget(), frame);
});

test("same-origin frames without scrollable content are not stops", () => {
  const flat = makeFrame({
    contentWindow: {},
    contentDocument: {
      scrollingElement: {
        scrollHeight: 901,
        clientHeight: 901,
        scrollWidth: 352,
        clientWidth: 352,
      },
      documentElement: null,
      body: null,
    },
  });
  useFixtures([flat]);
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("cross-origin frames stay admitted as stops", () => {
  const foreign = makeFrame({ contentWindow: {} });
  Object.defineProperty(foreign, "contentDocument", {
    get() {
      throw new Error("denied");
    },
  });
  useFixtures([foreign]);
  assert.equal(Scroll.getTarget(), foreign);
});

test("auto-picked target survives until a real rescan", () => {
  const { feed, junk } = tiktokFixtures();
  useFixtures([feed, junk]);
  assert.equal(Scroll.getTarget(), feed);
  // A mutation marks the cache stale but must not drop a still-connected
  // auto-picked target before the rescan runs.
  const docs = documentObservers();
  assert.ok(docs.length > 0, "expected the document to be observed");
  for (const observer of docs) observer.callback([], observer);
  assert.equal(Scroll.getTarget(), feed);
});

test("showHighlight tolerates a missing body", () => {
  const { feed } = tiktokFixtures();
  useFixtures([feed]);
  const savedBody = globalThis.document.body;
  globalThis.document.body = null;
  try {
    Scroll.showHighlight();
  } finally {
    globalThis.document.body = savedBody;
  }
});

test("reset from a frame forwards without a local highlight", () => {
  const { feed } = tiktokFixtures();
  useFixtures([feed]);
  created.length = 0;
  globalThis.window.top = {};
  try {
    Scroll.reset();
  } finally {
    globalThis.window.top = globalThis.window;
  }
  assert.deepEqual(
    created.filter((el) => el.tagName === "div"),
    [],
  );
});

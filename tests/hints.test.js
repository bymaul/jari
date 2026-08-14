import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Hints } from "../content/hints.js";
import { settings } from "../content/settings.js";

function withChars(chars, fn) {
  const original = settings.getHintChars;
  settings.getHintChars = () => chars;
  try {
    fn();
  } finally {
    settings.getHintChars = original;
  }
}

test("generateLabels returns exactly the requested count of labels", () => {
  withChars("SADFJKLEWCMPGH", () => {
    for (const count of [1, 2, 50, 196, 197, 500, 10000]) {
      const labels = Hints.generateLabels(count);
      assert.strictEqual(labels.length, count);
    }
  });
});

test("generateLabels labels are unique", () => {
  withChars("SADFJKLEWCMPGH", () => {
    for (const count of [100, 500, 1000, 10000]) {
      const labels = Hints.generateLabels(count);
      assert.strictEqual(new Set(labels).size, count);
    }
  });
});

test("generateLabels builds labels only from the configured alphabet", () => {

  withChars("XY", () => {
    const labels = Hints.generateLabels(5);
    assert.deepEqual(labels, ["XX", "XY", "YX", "YY", "XXX"]);
  });
  withChars("AB", () => {
    const labels = Hints.generateLabels(4);
    assert.deepEqual(labels, ["AA", "AB", "BA", "BB"]);
  });
});

test("generateLabels starts at two characters and grows past the alphabet square", () => {

  withChars("SADFJKLEWCMPGH", () => {
    const first = Hints.generateLabels(196);
    assert.ok(first.every((label) => label.length === 2));
    const grown = Hints.generateLabels(200);
    assert.strictEqual(grown[196].length, 3);
    assert.strictEqual(grown[199].length, 3);
  });

  withChars("ABCDEFGHIJKLMNOPQRSTUVWXYZ", () => {
    const labels = Hints.generateLabels(700);
    assert.strictEqual(labels[0].length, 2);
    assert.strictEqual(labels[675].length, 2);
    assert.strictEqual(labels[676].length, 3);
  });
});

function withWindow(innerWidth, innerHeight, fn) {
  const previous = globalThis.window;
  globalThis.window = { innerWidth, innerHeight };
  try {
    fn();
  } finally {
    globalThis.window = previous;
  }
}

test("visiblePortion keeps fully on-screen rects as-is", () => {
  withWindow(1000, 800, () => {
    assert.deepEqual(
      Hints.visiblePortion({ left: 100, top: 100, right: 300, bottom: 200 }),
      {
        left: 100,
        top: 100,
        right: 300,
        bottom: 200,
      },
    );
  });
});

test("visiblePortion clamps rects cut off by the fold or edges", () => {
  withWindow(1000, 800, () => {

    assert.deepEqual(
      Hints.visiblePortion({ left: 0, top: 700, right: 300, bottom: 900 }),
      {
        left: 0,
        top: 700,
        right: 300,
        bottom: 800,
      },
    );

    assert.deepEqual(
      Hints.visiblePortion({ left: -50, top: 100, right: 200, bottom: 150 }),
      {
        left: 0,
        top: 100,
        right: 200,
        bottom: 150,
      },
    );
  });
});

test("visiblePortion rejects rects entirely outside the viewport", () => {
  withWindow(1000, 800, () => {
    assert.equal(
      Hints.visiblePortion({ left: 0, top: 900, right: 100, bottom: 1000 }),
      null,
    );
    assert.equal(
      Hints.visiblePortion({ left: 1100, top: 0, right: 1200, bottom: 100 }),
      null,
    );
    assert.equal(
      Hints.visiblePortion({ left: 0, top: 0, right: 100, bottom: -50 }),
      null,
    );
  });
});

test("labelPlacement anchors the label at the requested grid cell", () => {
  const rect = { left: 100, top: 100, right: 300, bottom: 200 };
  const pos = (position) =>
    Hints.labelPlacement(rect, position, 0, 300, 1000, 800);

  assert.deepEqual(pos("top-left"), {
    left: 100,
    top: 400,
    transform: "translate(0%, 0%)",
  });
  assert.deepEqual(pos("top-center"), {
    left: 200,
    top: 400,
    transform: "translate(-50%, 0%)",
  });
  assert.deepEqual(pos("top-right"), {
    left: 300,
    top: 400,
    transform: "translate(-100%, 0%)",
  });
  assert.deepEqual(pos("middle-left"), {
    left: 100,
    top: 450,
    transform: "translate(0%, -50%)",
  });
  assert.deepEqual(pos("middle-center"), {
    left: 200,
    top: 450,
    transform: "translate(-50%, -50%)",
  });
  assert.deepEqual(pos("middle-right"), {
    left: 300,
    top: 450,
    transform: "translate(-100%, -50%)",
  });
  assert.deepEqual(pos("bottom-left"), {
    left: 100,
    top: 500,
    transform: "translate(0%, -100%)",
  });
  assert.deepEqual(pos("bottom-center"), {
    left: 200,
    top: 500,
    transform: "translate(-50%, -100%)",
  });
  assert.deepEqual(pos("bottom-right"), {
    left: 300,
    top: 500,
    transform: "translate(-100%, -100%)",
  });
});

test("labelPlacement clamps labels on screen at the fold edges", () => {
  assert.deepEqual(
    Hints.labelPlacement(
      { left: 0, top: -50, right: 100, bottom: 10 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    { left: 0, top: 0, transform: "translate(0%, 0%)" },
  );

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 0, top: 790, right: 100, bottom: 900 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    { left: 0, top: 780, transform: "translate(0%, 0%)" },
  );

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 950, top: 0, right: 1050, bottom: 20 },
      "middle-right",
      0,
      0,
      1000,
      800,
    ),
    { left: 1000, top: 10, transform: "translate(-100%, -50%)" },
  );
});

test("labelPlacement clamps with the measured label width, not the height proxy", () => {
  const nearRight = { left: 795, top: 100, right: 810, bottom: 130 };
  assert.deepEqual(
    Hints.labelPlacement(nearRight, "top-left", 0, 0, 800, 600, 26),
    { left: 774, top: 100, transform: "translate(0%, 0%)" },
  );
  assert.deepEqual(
    Hints.labelPlacement(nearRight, "middle-center", 0, 0, 800, 600, 26),
    { left: 787, top: 115, transform: "translate(-50%, -50%)" },
  );
  const nearLeft = { left: 0, top: 100, right: 20, bottom: 130 };
  assert.deepEqual(
    Hints.labelPlacement(nearLeft, "middle-center", 0, 0, 800, 600, 26),
    { left: 13, top: 115, transform: "translate(-50%, -50%)" },
  );
});

test("labelPlacement returns null when the element is off-screen or has no box", () => {  assert.equal(
    Hints.labelPlacement(
      { left: 100, top: -200, right: 600, bottom: -100 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    null,
  );
  assert.equal(
    Hints.labelPlacement(
      { left: 0, top: 900, right: 100, bottom: 1000 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    null,
  );
  assert.equal(
    Hints.labelPlacement(
      { left: 1100, top: 0, right: 1200, bottom: 100 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    null,
  );

  assert.equal(
    Hints.labelPlacement(
      { left: 0, top: 0, right: 0, bottom: 0 },
      "top-left",
      0,
      0,
      1000,
      800,
    ),
    null,
  );
});

function element(name, { parent = null, host = null, role = null } = {}) {
  return {
    name,
    parentElement: parent,
    role,
    getRootNode: () => ({ host }),
    getAttribute: (attr) => (attr === "role" ? role : null),
  };
}

const alwaysPasses = () => true;
const alwaysVisible = () => ({ ok: 1 });
const neverOccluded = () => false;

test("scanElements keeps top-level matches in document order", () => {
  const a = element("a");
  const b = element("b", { parent: a });
  const c = element("c");
  const { top, rects, total } = Hints.scanElements([a, b, c], {
    passes: alwaysPasses,
    visible: alwaysVisible,
    occluded: neverOccluded,
    max: 100,
  });
  assert.deepEqual(top, [a, c]);

  assert.strictEqual(rects.size, 3);
  assert.strictEqual(total, 3);
});

test("scanElements drops elements the filter rejects", () => {
  const a = element("a");
  const b = element("b");
  const { top, total } = Hints.scanElements([a, b], {
    passes: (el) => el.name === "a",
    visible: alwaysVisible,
    occluded: neverOccluded,
    max: 100,
  });
  assert.deepEqual(top, [a]);
  assert.strictEqual(total, 1);
});

test("scanElements skips invisible elements and does not count them", () => {
  const a = element("a");
  const b = element("b");
  const { top, total } = Hints.scanElements([a, b], {
    passes: alwaysPasses,
    visible: (el) => (el.name === "b" ? { ok: 1 } : null),
    occluded: neverOccluded,
    max: 100,
  });
  assert.deepEqual(top, [b]);
  assert.strictEqual(total, 1);
});

test("scanElements skips occluded elements and does not count them", () => {
  const a = element("a");
  const b = element("b");
  const { top, total } = Hints.scanElements([a, b], {
    passes: alwaysPasses,
    visible: alwaysVisible,
    occluded: (el) => el.name === "a",
    max: 100,
  });
  assert.deepEqual(top, [b]);
  assert.strictEqual(total, 1);
});

test("scanElements stops occlusion testing once the cap is reached", () => {
  const many = Array.from({ length: 10 }, (_, i) => element(`e${i}`));
  let occlusionTests = 0;
  const { top, total } = Hints.scanElements(many, {
    passes: alwaysPasses,
    visible: alwaysVisible,
    occluded: () => {
      occlusionTests++;
      return false;
    },
    max: 3,
  });
  assert.strictEqual(top.length, 3);
  assert.strictEqual(occlusionTests, 3);

  assert.strictEqual(total, 10);
});

test("scanElements treats shadow content as nested under its host", () => {
  const host = element("host");
  const shadowButton = element("shadow-button", { host });
  const { top } = Hints.scanElements([host, shadowButton], {
    passes: alwaysPasses,
    visible: alwaysVisible,
    occluded: neverOccluded,
    max: 100,
  });
  assert.deepEqual(top, [host]);
});

test("scanElements nests every match by default, and the predicate can exempt pairs", () => {
  const folder = element("docs", { role: "treeitem" });
  const file = element("file.md", { role: "treeitem", parent: folder });
  const opts = {
    passes: alwaysPasses,
    visible: alwaysVisible,
    occluded: neverOccluded,
    max: 100,
  };

  assert.deepEqual(Hints.scanElements([folder, file], opts).top, [folder]);

  const tree = Hints.scanElements([folder, file], {
    ...opts,
    nested: Hints.treeItemNested,
  });
  assert.deepEqual(tree.top, [folder, file]);
  assert.strictEqual(tree.total, 2);
});

function withFakeWindow(fn) {
  const listeners = [];
  const fake = {
    addEventListener(type, handler, options) {
      listeners.push({ type, handler, options });
    },
    removeEventListener(type, handler) {
      const i = listeners.findIndex(
        (l) => l.type === type && l.handler === handler,
      );
      if (i !== -1) listeners.splice(i, 1);
    },
  };
  const previous = globalThis.window;
  globalThis.window = fake;
  try {
    fn(fake, listeners);
  } finally {
    globalThis.window = previous;
  }
}

test("setWheelBlocking installs a non-passive capture wheel listener that cancels scroll", () => {
  withFakeWindow((win, listeners) => {
    try {
      Hints.setWheelBlocking(true);
      assert.strictEqual(listeners.length, 1);
      assert.strictEqual(listeners[0].type, "wheel");
      assert.deepEqual(listeners[0].options, { capture: true, passive: false });
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      listeners[0].handler(event);
      assert.strictEqual(event.prevented, true);
    } finally {

      Hints.setWheelBlocking(false);
    }
  });
});

test("setWheelBlocking removes the listener when disabled and never double-installs", () => {
  withFakeWindow((win, listeners) => {
    Hints.setWheelBlocking(true);
    Hints.setWheelBlocking(true);
    assert.strictEqual(listeners.length, 1);
    Hints.setWheelBlocking(false);
    assert.strictEqual(listeners.length, 0);
    Hints.setWheelBlocking(false);
    assert.strictEqual(listeners.length, 0);
  });
});

test("setScrollTracking installs a passive capture scroll listener that schedules one reposition per frame", () => {
  const frames = [];
  const previousRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => frames.push(cb);
  try {
    withFakeWindow((win, listeners) => {
      try {
        Hints.setScrollTracking(true);
        assert.strictEqual(listeners.length, 1);
        assert.strictEqual(listeners[0].type, "scroll");
        assert.deepEqual(listeners[0].options, {
          capture: true,
          passive: true,
        });

        listeners[0].handler();
        listeners[0].handler();
        assert.strictEqual(frames.length, 1);
      } finally {
        Hints.setScrollTracking(false);
      }
    });
  } finally {
    globalThis.requestAnimationFrame = previousRAF;
  }
});

test("setScrollTracking removes the listener when disabled and never double-installs", () => {
  withFakeWindow((win, listeners) => {
    Hints.setScrollTracking(true);
    Hints.setScrollTracking(true);
    assert.strictEqual(listeners.length, 1);
    Hints.setScrollTracking(false);
    assert.strictEqual(listeners.length, 0);
    Hints.setScrollTracking(false);
    assert.strictEqual(listeners.length, 0);
  });
});

function scrollContainer({
  left = 0,
  top = 0,
  width = 500,
  height = 300,
  scrollLeft = 0,
  scrollTop = 0,
} = {}) {
  return {
    scrollLeft,
    scrollTop,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
    }),
  };
}

test("rectOverlapsScrollport rejects elements scrolled out of the container", () => {
  const container = scrollContainer({
    top: 0,
    width: 500,
    height: 300,
    scrollTop: 300,
  });

  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 10, top: 350, right: 60, bottom: 380 },
      container,
    ),
    false,
  );
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 10, top: 50, right: 60, bottom: 80 },
      container,
    ),
    true,
  );
});

test("rectOverlapsScrollport rejects elements on each side of the scrollport", () => {
  const container = scrollContainer({ width: 500, height: 300 });
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 0, top: 320, right: 100, bottom: 400 },
      container,
    ),
    false,
  );
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 0, top: -100, right: 100, bottom: -20 },
      container,
    ),
    false,
  );
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 520, top: 10, right: 600, bottom: 50 },
      container,
    ),
    false,
  );
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: -100, top: 10, right: -20, bottom: 50 },
      container,
    ),
    false,
  );
});

test("rectOverlapsScrollport keeps anything overlapping the scrollport", () => {
  const container = scrollContainer({ width: 500, height: 300 });
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 0, top: 0, right: 100, bottom: 100 },
      container,
    ),
    true,
  );
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 100, top: 100, right: 300, bottom: 200 },
      container,
    ),
    true,
  );

  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 450, top: 100, right: 550, bottom: 200 },
      container,
    ),
    true,
  );
});

function withViewport({ innerWidth = 800, innerHeight = 457 }, fn) {
  const previous = globalThis.window;
  globalThis.window = {
    innerWidth,
    innerHeight,

    getComputedStyle: (node) => node,
  };
  try {
    fn();
  } finally {
    globalThis.window = previous;
  }
}

function scrolledRootElement() {
  return {
    scrollWidth: 2000,
    clientWidth: 800,
    scrollHeight: 5000,
    clientHeight: 457,
    overflowX: "visible",
    overflowY: "scroll",
    getBoundingClientRect: () => ({
      left: 0,
      top: -900,
      right: 800,
      bottom: -443,
    }),
    getRootNode: () => ({ host: null }),
  };
}

function viewportOnlyChain() {
  const html = scrolledRootElement();
  const body = {
    scrollWidth: 2000,
    clientWidth: 800,
    scrollHeight: 5000,
    clientHeight: 457,
    overflowX: "visible",
    overflowY: "visible",
    parentElement: html,
    getRootNode: () => ({ host: null }),
  };
  return { html, body };
}

function onScreenEl(parent, rect) {
  const el = {
    parentElement: parent,
    matches: () => false,
    getBoundingClientRect: () => rect,
    getRootNode: () => ({ elementFromPoint: () => el }),
  };
  return el;
}

test("isOccluded ignores the scrolled root element (Instagram scrolls the window)", () => {
  const { html, body } = viewportOnlyChain();
  const rect = { left: 100, top: 100, right: 200, bottom: 130 };
  withViewport({}, () => {
    withDocument({ documentElement: html, body }, () => {
      assert.equal(Hints.isOccluded(onScreenEl(body, rect), rect), false);
    });
  });
});

test("isOccluded still rejects elements scrolled out of a real container", () => {
  const { html, body } = viewportOnlyChain();
  const tray = carouselTray(body);
  const below = { left: 10, top: 200, right: 60, bottom: 230 };
  withViewport({}, () => {
    withDocument({ documentElement: html, body }, () => {
      assert.equal(Hints.isOccluded(onScreenEl(tray, below), below), true);
    });
  });
});

function carouselTray(parent) {
  return {
    scrollWidth: 500,
    clientWidth: 500,
    scrollHeight: 400,
    clientHeight: 100,
    overflowX: "auto",
    overflowY: "auto",
    parentElement: parent,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 100 }),
  };
}

test("scanElements keeps on-screen links on a window-scrolled page (Instagram)", () => {
  const { html, body } = viewportOnlyChain();
  const rect = { left: 100, top: 100, right: 200, bottom: 130 };
  const a = onScreenEl(body, rect);
  const b = onScreenEl(body, rect);
  withViewport({}, () => {
    withDocument({ documentElement: html, body }, () => {
      const { top, total } = Hints.scanElements([a, b], {
        passes: () => true,
        visible: () => rect,
        occluded: Hints.isOccluded,
        max: 100,
      });
      assert.deepEqual(top, [a, b]);
      assert.strictEqual(total, 2);
    });
  });
});

test("scanElements drops elements scrolled out of a real container", () => {
  const { html, body } = viewportOnlyChain();
  const tray = carouselTray(body);
  const offTray = onScreenEl(tray, {
    left: 10,
    top: 200,
    right: 60,
    bottom: 230,
  });
  const onTray = onScreenEl(tray, { left: 10, top: 20, right: 60, bottom: 50 });
  withViewport({}, () => {
    withDocument({ documentElement: html, body }, () => {
      const { top, total } = Hints.scanElements([offTray, onTray], {
        passes: () => true,
        visible: (el) => el.getBoundingClientRect(),
        occluded: Hints.isOccluded,
        max: 100,
      });
      assert.deepEqual(top, [onTray]);
      assert.strictEqual(total, 1);
    });
  });
});

function withDocument(document, fn) {
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    fn();
  } finally {
    globalThis.document = previous;
  }
}

function mockEl(id, parent = null) {
  return {
    id,
    parentElement: parent,
    assignedSlot: null,
    getRootNode: () => ({ host: null }),
  };
}

const FULL_RECT = { left: 0, top: 0, right: 100, bottom: 50 };

test("rectsNearIdentical accepts fully overlapping rects and rejects partial ones", () => {
  assert.ok(Hints.rectsNearIdentical(FULL_RECT, { left: 0, top: 0, right: 100, bottom: 50 }));
  assert.ok(Hints.rectsNearIdentical(FULL_RECT, { left: 10, top: 0, right: 110, bottom: 50 }));
  assert.ok(!Hints.rectsNearIdentical(FULL_RECT, { left: 60, top: 0, right: 160, bottom: 50 }));
  assert.ok(!Hints.rectsNearIdentical(FULL_RECT, { left: 120, top: 0, right: 220, bottom: 80 }));
});

test("rectsNearIdentical rejects a tiny rect contained in a large one", () => {
  const big = { left: 0, top: 0, right: 300, bottom: 74 };
  const small = { left: 40, top: 12, right: 68, bottom: 32 };
  assert.ok(!Hints.rectsNearIdentical(big, small));
});

test("dedupeOverlapping keeps only the element on top at the shared center", () => {
  const a = mockEl("a");
  const b = mockEl("b");
  const rects = new Map([
    [a, FULL_RECT],
    [b, FULL_RECT],
  ]);
  withDocument({ elementFromPoint: () => b }, () => {
    assert.deepEqual(Hints.dedupeOverlapping([a, b], rects), [b]);
  });
});

test("dedupeOverlapping counts a descendant hit as the ancestor element", () => {
  const a = mockEl("a");
  const inner = mockEl("inner", a);
  const b = mockEl("b");
  const rects = new Map([
    [a, FULL_RECT],
    [b, FULL_RECT],
  ]);
  withDocument({ elementFromPoint: () => inner }, () => {
    assert.deepEqual(Hints.dedupeOverlapping([a, b], rects), [a]);
  });
});

test("dedupeOverlapping falls back to the smaller rect when the hit is unrelated", () => {
  const a = mockEl("a");
  const b = mockEl("b");
  const big = { left: 0, top: 0, right: 300, bottom: 50 };
  const small = { left: 0, top: 0, right: 130, bottom: 50 };
  const rects = new Map([
    [a, big],
    [b, small],
  ]);
  withDocument({ elementFromPoint: () => null }, () => {
    assert.deepEqual(Hints.dedupeOverlapping([a, b], rects), [b]);
  });
});

test("dedupeOverlapping keeps partially overlapping elements as distinct targets", () => {
  const a = mockEl("a");
  const b = mockEl("b");
  const rectA = { left: 0, top: 0, right: 300, bottom: 50 };
  const rectB = { left: 120, top: 0, right: 220, bottom: 80 };
  const rects = new Map([
    [a, rectA],
    [b, rectB],
  ]);
  withDocument({ elementFromPoint: () => b }, () => {
    assert.deepEqual(Hints.dedupeOverlapping([a, b], rects), [a, b]);
  });
});

test("isPointerCursor accepts pointer and custom cursors, nothing else", () => {
  assert.equal(Hints.isPointerCursor({ cursor: "pointer" }), true);
  assert.equal(
    Hints.isPointerCursor({ cursor: "url(cursor.png) 4 12, auto" }),
    true,
  );
  assert.equal(Hints.isPointerCursor({ cursor: "auto" }), false);
  assert.equal(Hints.isPointerCursor({ cursor: "default" }), false);
  assert.equal(Hints.isPointerCursor({}), false);
  assert.equal(Hints.isPointerCursor(null), false);
});

test("clickable selector includes menuitemcheckbox and menuitemradio roles", () => {
  for (const role of ["menuitemcheckbox", "menuitemradio"]) {
    assert.ok(Hints.clickableSelector.includes(`[role='${role}']`));
  }
});

test("clickable selector has no jsaction: it is parsed by isJsactionClick", () => {
  assert.ok(!Hints.clickableSelector.includes("jsaction"));
});

test("isJsactionClick reads the jsaction attribute for real click actions", () => {
  const jsaction = (value) => ({ getAttribute: (name) => (name === "jsaction" ? value : null) });
  assert.equal(Hints.isJsactionClick(jsaction("")), false);
  assert.equal(Hints.isJsactionClick(jsaction("rcuQ6b:npT2md;xjhTIf:.CLIENT;O2vyse:.CLIENT;IVKTfe:.CLIENT;E")), false);
  assert.equal(Hints.isJsactionClick(jsaction("click:foo.bar")), true);
  assert.equal(Hints.isJsactionClick(jsaction("foo.bar")), true);
  assert.equal(Hints.isJsactionClick(jsaction("click:npT2md")), false);
  assert.equal(Hints.isJsactionClick(jsaction("mousedown:foo.bar")), false);
  assert.equal(Hints.isJsactionClick(jsaction("click:none.foo")), false);
  assert.equal(Hints.isJsactionClick(jsaction("click:_")), false);
  assert.equal(Hints.isJsactionClick(jsaction("xjhTIf:.CLIENT;click:oFNije.gmhGzd")), true);
  assert.equal(Hints.isJsactionClick({ getAttribute: () => null }), false);
  assert.equal(Hints.isJsactionClick({}), false);
});

test("clickable selector has no tabindex: focus containers would swallow their links", () => {
  assert.ok(!Hints.clickableSelector.includes("tabindex"));
});

function pointerEl(
  name,
  { cursor = "default", visibility = "visible", rect, shadowRoot, className, jsaction } = {},
) {
  return {
    name,
    className,
    cursor,
    visibility,
    shadowRoot: shadowRoot || null,
    childElementCount: 0,
    matches: (sel) =>
      sel === "*" || sel === name || sel === "." + (className || ""),
    getAttribute: (attr) => (attr === "jsaction" ? jsaction ?? null : null),
    getBoundingClientRect: () =>
      rect || {
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
      },
    getClientRects: () => [],
  };
}

function rootWith(children) {
  return { querySelectorAll: (sel) => children.filter((c) => c.matches(sel)) };
}

function withHintsWindow({ width = 1000, height = 800 } = {}, fn) {
  const previous = globalThis.window;
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    getComputedStyle: (el) => ({
      visibility: el.visibility,
      cursor: el.cursor,
    }),
  };
  try {
    fn();
  } finally {
    globalThis.window = previous;
  }
}

test("queryClickables adds pointer-cursor elements the selector missed, in document order", () => {
  const link = pointerEl("a");
  const widget = pointerEl("div", { cursor: "pointer" });
  const plain = pointerEl("span", { cursor: "default" });
  withDocument(rootWith([link, widget, plain]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a");
      assert.deepEqual(
        found.map((e) => e.name),
        ["a", "div"],
      );
    });
  });
});

test("queryClickables skips hidden, zero-size, and off-screen pointer elements", () => {
  const offScreen = pointerEl("div", {
    cursor: "pointer",
    rect: {
      left: 2000,
      top: 0,
      right: 2100,
      bottom: 20,
      width: 100,
      height: 20,
    },
  });
  const hidden = pointerEl("div", { cursor: "pointer", visibility: "hidden" });
  const zero = pointerEl("div", {
    cursor: "pointer",
    rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
  });
  const onScreen = pointerEl("div", { cursor: "pointer" });
  withDocument(rootWith([offScreen, hidden, zero, onScreen]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a");
      assert.deepEqual(
        found.map((e) => e.name),
        ["div"],
      );
    });
  });
});

test("queryClickables finds pointer-cursor elements inside shadow roots", () => {
  const shadowWidget = pointerEl("div", { cursor: "pointer" });
  const host = pointerEl("div", { shadowRoot: rootWith([shadowWidget]) });
  withDocument(rootWith([host]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a");
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0], shadowWidget);
    });
  });
});

test("queryClickables caps pointer additions but keeps collecting selector matches", () => {
  const many = Array.from({ length: 205 }, (_, i) =>
    pointerEl(`div${i}`, { cursor: "pointer" }),
  );
  const link = pointerEl("a");
  withDocument(rootWith([...many, link]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a");
      assert.strictEqual(found.length, 201);
      assert.strictEqual(found[200], link);
    });
  });
});

test("queryClickables can disable the pointer-cursor pass", () => {
  const widget = pointerEl("div", { cursor: "pointer" });
  withDocument(rootWith([widget]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a", { pointerCursor: false });
      assert.strictEqual(found.length, 0);
    });
  });
});

test("queryClickables marks weak-selector matches so they never swallow strong targets", () => {
  const link = pointerEl("a");
  const wrapper = pointerEl("div", { className: "link-list" });
  withDocument(rootWith([wrapper, link]), () => {
    withHintsWindow({}, () => {
      const { candidates, weak } = Hints.queryClickables("a", {
        weak: ".link-list",
      });
      assert.deepEqual(candidates.map((e) => e.name), ["div", "a"]);
      assert.ok(weak.has(wrapper));
      assert.ok(!weak.has(link));
    });
  });
});

test("queryClickables only collects jsaction click handlers, not event-stamped containers", () => {
  const realButton = pointerEl("div", { jsaction: "click:oFNije.gmhGzd" });
  const googleBody = pointerEl("body", {
    jsaction: "rcuQ6b:npT2md;xjhTIf:.CLIENT;O2vyse:.CLIENT;IVKTfe:.CLIENT;E",
  });
  withDocument(rootWith([realButton, googleBody]), () => {
    withHintsWindow({}, () => {
      const { candidates: found } = Hints.queryClickables("a");
      assert.deepEqual(found.map((e) => e.name), ["div"]);
    });
  });
});

function flatEl(name, { parent = null, assignedSlot = null, host = null } = {}) {
  return {
    name,
    parentElement: parent,
    assignedSlot,
    getRootNode: () => ({ host }),
  };
}

test("flatContains follows assigned slots into a shadow wrapper", () => {
  const wrapper = flatEl("wrapper");
  const slot = flatEl("slot", { parent: wrapper });
  const tabsWrap = flatEl("tabsWrap", { assignedSlot: slot });
  const tab = flatEl("tab", { parent: tabsWrap });
  assert.equal(Hints.flatContains(wrapper, tab), true);
  assert.equal(Hints.flatContains(tab, wrapper), false);
});

test("flatContains leaves DOM containment untouched and stops at the top", () => {
  const outer = flatEl("outer");
  const inner = flatEl("inner", { parent: outer });
  const leaf = flatEl("leaf", { parent: inner });
  assert.equal(Hints.flatContains(outer, leaf), true);
  assert.equal(Hints.flatContains(inner, outer), false);
  assert.equal(Hints.flatContains(leaf, outer), false);
  const orphan = flatEl("orphan");
  assert.equal(Hints.flatContains(orphan, leaf), false);
});

test("hintRect returns the fallback rect", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const el = {
    getClientRects: () => [
      { left: 8, top: 406, right: 300, bottom: 422 },
      { left: 8, top: 376, right: 250, bottom: 392 },
    ],
  };
  assert.deepEqual(Hints.hintRect(el, fallback), fallback);
});

test("placeCaretAtEnd moves the caret to the end of an input and textarea", () => {
  const calls = [];
  const input = {
    tagName: "INPUT",
    value: "hello world",
    setSelectionRange(start, end) {
      calls.push({ start, end });
    },
  };
  Hints.placeCaretAtEnd(input);
  assert.deepEqual(calls, [{ start: 11, end: 11 }]);

  const textarea = {
    tagName: "TEXTAREA",
    value: "abc",
    setSelectionRange(start, end) {
      calls.push({ start, end });
    },
  };
  Hints.placeCaretAtEnd(textarea);
  assert.deepEqual(calls[calls.length - 1], { start: 3, end: 3 });
});

test("placeCaretAtEnd collapses the selection at the end of a contenteditable", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let collapsedAt = null;
  let rangeAdded = null;
  globalThis.window = {
    getSelection: () => ({
      removeAllRanges() {},
      addRange(range) {
        rangeAdded = range;
      },
    }),
  };
  globalThis.document = {
    createRange: () => ({
      selectNodeContents(el) {
        this.target = el;
      },
      collapse(toEnd) {
        collapsedAt = toEnd;
      },
    }),
  };
  try {
    const block = { tagName: "DIV", isContentEditable: true };
    Hints.placeCaretAtEnd(block);
    assert.strictEqual(collapsedAt, false);
    assert.strictEqual(rangeAdded.target, block);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test("placeCaretAtEnd never throws on stub-hostile elements", () => {
  assert.doesNotThrow(() => Hints.placeCaretAtEnd({ tagName: "INPUT" }));
});

function hintStubElement(name, rect) {
  const el = {
    name,
    tagName: "A",
    disabled: false,
    parentElement: null,
    children: [],
    style: {},
    className: "",
    offsetWidth: 20,
    isConnected: true,
    listeners: {},
    set textContent(value) {
      this._text = value;
    },
    get textContent() {
      return this._text;
    },
    matches: (sel) => sel.includes("a[href]"),
    closest: () => null,
    getAttribute: (attr) =>
      attr === "href" ? "https://example.com" : null,
    getBoundingClientRect: () => rect,
    getRootNode: () => ({ host: null, elementFromPoint: () => el }),
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      return child;
    },
    remove() {
      this.isConnected = false;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    classList: { toggle() {}, add() {} },
  };
  return el;
}

function hintStubDocument(candidate) {
  const created = [];
  return {
    created,
    activeElement: null,
    body: { appendChild() {}, removeChild() {} },
    documentElement: {},
    querySelectorAll: () => (candidate ? [candidate] : []),
    createElement: (tag) => {
      const el = hintStubElement(tag, {
        left: 100,
        top: 100,
        right: 300,
        bottom: 200,
        width: 200,
        height: 100,
      });
      created.push(el);
      return el;
    },
    createDocumentFragment: () => ({ appendChild() {} }),
  };
}

test("start draws hints locally when the background asks it to (extension page)", async () => {
  const candidate = hintStubElement("a", {
    left: 100,
    top: 100,
    right: 300,
    bottom: 200,
    width: 200,
    height: 100,
  });
  const document = hintStubDocument(candidate);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousId = chrome.runtime.id;
  const previousSend = chrome.runtime.sendMessage;
  const previousChars = settings.getHintChars;
  const previousPosition = settings.getHintPosition;
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCAF = globalThis.cancelAnimationFrame;
  chrome.runtime.id = "test-id";
  chrome.runtime.sendMessage = async () => ({
    needsRelay: false,
    drawLocally: true,
  });
  settings.getHintChars = () => "SADFJKLEWCMPGH";
  settings.getHintPosition = () => "top-left";
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = document;
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: () => ({
      visibility: "visible",
      opacity: "1",
      cursor: "default",
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    await Hints.start("click");
    assert.equal(Hints.isActive(), true);
    assert.ok(document.created.some((el) => el.className === "jari-hint"));
  } finally {
    Hints.cancel();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    chrome.runtime.id = previousId;
    chrome.runtime.sendMessage = previousSend;
    settings.getHintChars = previousChars;
    settings.getHintPosition = previousPosition;
    globalThis.requestAnimationFrame = previousRAF;
    globalThis.cancelAnimationFrame = previousCAF;
  }
});

test("start skips the local draw when the background relays to other frames", async () => {
  const document = hintStubDocument(null);
  const previousDocument = globalThis.document;
  const previousId = chrome.runtime.id;
  const previousSend = chrome.runtime.sendMessage;
  chrome.runtime.id = "test-id";
  chrome.runtime.sendMessage = async () => ({ needsRelay: true });
  globalThis.document = document;
  try {
    await Hints.start("click");
    assert.equal(Hints.isActive(), false);
  } finally {
    globalThis.document = previousDocument;
    chrome.runtime.id = previousId;
    chrome.runtime.sendMessage = previousSend;
  }
});

test("onKeyDown still relays the closing key when activation cancels the relay session", async () => {
  const candidate = hintStubElement("a", {
    left: 100,
    top: 100,
    right: 300,
    bottom: 200,
    width: 200,
    height: 100,
  });
  const document = hintStubDocument(candidate);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousId = chrome.runtime.id;
  const previousSend = chrome.runtime.sendMessage;
  const previousChars = settings.getHintChars;
  const previousPosition = settings.getHintPosition;
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCAF = globalThis.cancelAnimationFrame;
  const sent = [];
  chrome.runtime.id = "test-id";
  settings.getHintChars = () => "SADFJKLEWCMPGH";
  settings.getHintPosition = () => "top-left";
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = document;
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: () => ({
      visibility: "visible",
      opacity: "1",
      cursor: "default",
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  let resolveCoordinate;
  const coordinate = new Promise((resolve) => {
    resolveCoordinate = resolve;
  });
  chrome.runtime.sendMessage = (msg) => {
    if (msg.type === "HINTS_KEY") {
      sent.push({ key: msg.key, remaining: msg.remaining, closed: msg.closed });
    }
    if (msg.type === "COORDINATE_HINTS") {
      return coordinate;
    }
    return {};
  };
  const onMessage = (type, payload) => {
    for (const fn of chrome.runtime.onMessage._listeners) {
      const response = fn({ type, ...payload }, {}, () => {});
      if (response !== undefined) return response;
    }
  };
  try {
    const startPromise = Hints.start("click");
    onMessage("COUNT_HINTS", { mode: "click" });
    onMessage("DRAW_HINTS", { startIndex: 0 });
    resolveCoordinate({ needsRelay: true });
    await startPromise;
    assert.equal(Hints.isActive(), true);
    const hintBox = document.created.find((el) => el.className === "jari-hint");
    assert.ok(hintBox);
    assert.deepEqual(hintBox.children.map((span) => span._text), ["S", "S"]);
    const event = (key) => ({ key, preventDefault() {}, stopImmediatePropagation() {} });
    Hints.onKeyDown(event("s"));
    Hints.onKeyDown(event("s"));
    assert.equal(Hints.isActive(), false);
    assert.deepEqual(sent, [
      { key: "s", remaining: 1, closed: false },
      { key: "s", remaining: 0, closed: true },
    ]);
  } finally {
    Hints.cancel();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    chrome.runtime.id = previousId;
    chrome.runtime.sendMessage = previousSend;
    settings.getHintChars = previousChars;
    settings.getHintPosition = previousPosition;
    globalThis.requestAnimationFrame = previousRAF;
    globalThis.cancelAnimationFrame = previousCAF;
  }
});

class MockEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.button = init.button;
    this.buttons = init.buttons;
    this.detail = init.detail;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.screenX = init.screenX;
    this.screenY = init.screenY;
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType;
    this.isPrimary = init.isPrimary;
    this.view = init.view;
    this.defaultPrevented = false;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function simulateStubElement({
  href = null,
  target = null,
  download = false,
  onMousedown = null,
  onClick = null,
  mousedownThrows = false,
  clickThrows = false,
} = {}) {
  const handlers = new Map();
  const el = {
    href,
    dispatched: [],
    clickCount: 0,
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = handlers.get(type) || [];
      const index = list.indexOf(fn);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent(event) {
      el.dispatched.push(event);
      for (const fn of handlers.get(event.type) || []) fn(event);
      return !event.defaultPrevented;
    },
    click() {
      el.clickCount += 1;
      const event = new MockEvent("click", { bubbles: true, cancelable: true });
      for (const fn of handlers.get("click") || []) fn(event);
      return !event.defaultPrevented;
    },
    getAttribute(name) {
      if (name === "href") return href;
      if (name === "target") return target;
      return null;
    },
    hasAttribute(name) {
      return name === "download" && download;
    },
    getBoundingClientRect() {
      return { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
    },
  };
  if (onMousedown) el.addEventListener("mousedown", onMousedown);
  if (onClick) el.addEventListener("click", onClick);
  if (mousedownThrows) {
    el.addEventListener("mousedown", () => {
      throw new Error("page mousedown boom");
    });
  }
  if (clickThrows) {
    el.addEventListener("click", () => {
      throw new Error("page click boom");
    });
  }
  return el;
}

function withSimulateEnvironment(fn) {
  const previousMouseEvent = globalThis.MouseEvent;
  const previousPointerEvent = globalThis.PointerEvent;
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousSetTimeout = globalThis.setTimeout;
  const assigns = [];
  globalThis.MouseEvent = MockEvent;
  globalThis.PointerEvent = MockEvent;
  globalThis.window = {
    screenX: 0,
    screenY: 0,
    location: { assign: (url) => assigns.push(url) },
  };
  globalThis.location = { href: "https://example.test/start" };
  globalThis.setTimeout = (run) => {
    run();
    return 0;
  };
  try {
    fn({ assigns });
  } finally {
    globalThis.MouseEvent = previousMouseEvent;
    globalThis.PointerEvent = previousPointerEvent;
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.setTimeout = previousSetTimeout;
  }
}

test("simulateClick dispatches a realistic hover, press and click sequence", () => {
  withSimulateEnvironment(() => {
    const el = simulateStubElement();
    Hints.simulateClick(el);
    assert.deepEqual(
      el.dispatched.map((e) => e.type),
      [
        "pointerover",
        "pointerenter",
        "mouseover",
        "mouseenter",
        "mousemove",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
      ],
    );
    assert.equal(el.clickCount, 1);
    const pointerdown = el.dispatched.find((e) => e.type === "pointerdown");
    assert.equal(pointerdown.buttons, 1);
    assert.equal(pointerdown.pointerType, "mouse");
    assert.equal(pointerdown.isPrimary, true);
    assert.equal(pointerdown.detail, 1);
    assert.equal(pointerdown.clientX, 60);
    assert.equal(pointerdown.clientY, 30);
    assert.equal(pointerdown.screenX, 60);
    assert.equal(pointerdown.screenY, 30);
    assert.equal(pointerdown.view, globalThis.window);
    assert.equal(
      el.dispatched.find((e) => e.type === "mousedown").buttons,
      1,
    );
    assert.equal(el.dispatched.find((e) => e.type === "mouseup").buttons, 0);
  });
});

test("simulateClick does not navigate when the page cancels mousedown", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({
      href: "https://example.test/link",
      onMousedown: (e) => e.preventDefault(),
    });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 0);
    assert.ok(el.dispatched.some((e) => e.type === "click"));
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick respects click cancellation and does not navigate", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({
      href: "https://example.test/link",
      onClick: (e) => e.preventDefault(),
    });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick does not fall back when the link navigated", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({
      href: "/target",
      onClick: () => {
        globalThis.location.href = "/target";
      },
    });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick falls back to location.assign for a same-tab link that did not navigate", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({ href: "/target" });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, ["/target"]);
  });
});

test("simulateClick skips the fallback for target=_blank links", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({ href: "/target", target: "_blank" });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick skips the fallback for download links", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({ href: "/target", download: true });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick skips the fallback for non-http links", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({ href: "mailto:test@example.com" });
    Hints.simulateClick(el);
    assert.equal(el.clickCount, 1);
    assert.deepEqual(assigns, []);
  });
});

test("simulateClick survives page handlers that throw", () => {
  withSimulateEnvironment(() => {
    const el = simulateStubElement({
      href: "/target",
      mousedownThrows: true,
      clickThrows: true,
    });
    assert.doesNotThrow(() => Hints.simulateClick(el));
    assert.equal(el.clickCount, 1);
  });
});

test("simulateClick survives handlers that cancel and then throw", () => {
  withSimulateEnvironment(({ assigns }) => {
    const el = simulateStubElement({
      href: "/target",
      onMousedown: (e) => {
        e.preventDefault();
        throw new Error("boom");
      },
    });
    assert.doesNotThrow(() => Hints.simulateClick(el));
    assert.equal(el.clickCount, 0);
    assert.ok(el.dispatched.some((e) => e.type === "click"));
    assert.deepEqual(assigns, []);
  });
});

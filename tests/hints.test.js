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

test("labelPlacement converts a viewport rect to document coordinates", () => {

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 100, top: 100, right: 300, bottom: 200 },
      0,
      300,
      1000,
      800,
    ),
    { left: 100, top: 400 },
  );

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 100, top: 0, right: 300, bottom: 20 },
      40,
      0,
      1000,
      800,
    ),
    { left: 140, top: 0 },
  );
});

test("labelPlacement clamps labels on screen at the fold edges", () => {

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 0, top: -50, right: 100, bottom: 10 },
      0,
      0,
      1000,
      800,
    ),
    { left: 0, top: 0 },
  );

  assert.deepEqual(
    Hints.labelPlacement(
      { left: 0, top: 790, right: 100, bottom: 900 },
      0,
      0,
      1000,
      800,
    ),
    { left: 0, top: 780 },
  );
});

test("labelPlacement returns null when the element is off-screen or has no box", () => {

  assert.equal(
    Hints.labelPlacement(
      { left: 100, top: -200, right: 600, bottom: -100 },
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

test("hintRect anchors the label to the bottom-most line of a wrapped anchor", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const anchor = {
    getClientRects: () => [
      { left: 8, top: 406, right: 300, bottom: 422 },
      { left: 8, top: 376, right: 250, bottom: 392 },
    ],
  };
  assert.deepEqual(Hints.hintRect(anchor, fallback), {
    left: 8,
    top: 406,
    right: 300,
    bottom: 422,
  });
});

test("hintRect keeps a single-line element at its own line", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const single = {
    getClientRects: () => [{ left: 8, top: 10, right: 90, bottom: 30 }],
  };
  assert.deepEqual(Hints.hintRect(single, fallback), {
    left: 8,
    top: 10,
    right: 90,
    bottom: 30,
  });
});

test("hintRect anchors tall elements to their bottom", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const tall = {
    getClientRects: () => [{ left: 8, top: 0, right: 300, bottom: 100 }],
  };
  assert.deepEqual(Hints.hintRect(tall, fallback), {
    left: 8,
    top: 80,
    right: 300,
    bottom: 100,
  });
});

test("hintRect keeps the scan rect when there are no client rects", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const none = { getClientRects: () => [] };
  assert.deepEqual(Hints.hintRect(none, fallback), fallback);
});

test("hintRect skips a client rect below the fold and anchors to the last visible line", () => {
  const original = globalThis.window;
  globalThis.window = { innerHeight: 600 };
  try {
    const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
    const wrapped = {
      getClientRects: () => [
        { left: 8, top: 440, right: 250, bottom: 456 },
        { left: 8, top: 609, right: 300, bottom: 625 },
      ],
    };
    assert.deepEqual(Hints.hintRect(wrapped, fallback), {
      left: 8,
      top: 440,
      right: 250,
      bottom: 456,
    });
  } finally {
    globalThis.window = original;
  }
});

test("hintRect falls back to the scan rect when every client rect is off-screen", () => {
  const original = globalThis.window;
  globalThis.window = { innerHeight: 600 };
  try {
    const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
    const below = {
      getClientRects: () => [
        { left: 8, top: 700, right: 300, bottom: 720 },
      ],
    };
    assert.deepEqual(Hints.hintRect(below, fallback), fallback);
  } finally {
    globalThis.window = original;
  }
});

test("hintRect clamps the label anchor above the fold for a line that dips below it", () => {
  const original = globalThis.window;
  globalThis.window = { innerHeight: 600 };
  try {
    const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
    const dipping = {
      getClientRects: () => [{ left: 8, top: 590, right: 300, bottom: 640 }],
    };
    assert.deepEqual(Hints.hintRect(dipping, fallback), {
      left: 8,
      top: 580,
      right: 300,
      bottom: 640,
    });
  } finally {
    globalThis.window = original;
  }
});

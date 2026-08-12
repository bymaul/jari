import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Hints } from "../content/hints.js";
import { settings } from "../content/settings.js";

// hints.js reads settings only through alphabet(); stub it so generateLabels
// can run without a browser. The other public surfaces need a DOM, so only
// the pure label generation is tested here. settings.set() would reject a
// short alphabet (normalizeHintChars requires at least 4 chars), so the
// getter is patched instead.
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
  // generateLabels uses the alphabet as-is — settings already normalize it
  // to uppercase upstream, so that is not the label generator's job.
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
  // 14 chars: 14^2 = 196 two-character labels, then three-character ones.
  withChars("SADFJKLEWCMPGH", () => {
    const first = Hints.generateLabels(196);
    assert.ok(first.every((label) => label.length === 2));
    const grown = Hints.generateLabels(200);
    assert.strictEqual(grown[196].length, 3);
    assert.strictEqual(grown[199].length, 3);
  });
  // 26 chars: 26^2 = 676 two-character labels.
  withChars("ABCDEFGHIJKLMNOPQRSTUVWXYZ", () => {
    const labels = Hints.generateLabels(700);
    assert.strictEqual(labels[0].length, 2);
    assert.strictEqual(labels[675].length, 2);
    assert.strictEqual(labels[676].length, 3);
  });
});

// visiblePortion reads the window at call time; swap in a fake for the
// duration, mirroring the document swap in shadow.test.js.
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
    // A result cut off by the bottom of the viewport keeps its on-screen part.
    assert.deepEqual(
      Hints.visiblePortion({ left: 0, top: 700, right: 300, bottom: 900 }),
      {
        left: 0,
        top: 700,
        right: 300,
        bottom: 800,
      },
    );
    // Left edge cut off.
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
  // The window scrolled 300px: the element at viewport (100, 100) sits at
  // document (100, 400), so its label must too.
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
  // Horizontal scroll offsets apply the same way.
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
  // Sliver at the top edge: label pinned to the top of the viewport.
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
  // Sliver at the bottom edge: label kept inside the viewport.
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
  // Above the viewport (Instagram: a post scrolled out of the feed
  // container while window.scrollY stayed put).
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
  // A detached element reads as zero-size.
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

// The scan only touches the ancestor chain (parentElement +
// getRootNode().host across shadow boundaries) and the injected predicates;
// every other DOM read lives in the callers, so a plain object stands in for
// a real element.
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
  // rects holds every viable element, nested matches included.
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
  // Everything past the cap is counted without an occlusion test.
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
  // Default: the file is nested under its folder row (a clickable card
  // wrapping its link is one click), so only the folder gets a hint.
  assert.deepEqual(Hints.scanElements([folder, file], opts).top, [folder]);
  // Tree rows: the folder expands, the file opens — both must be hinted, or
  // every file under an expanded tree folder would be unreachable.
  const tree = Hints.scanElements([folder, file], {
    ...opts,
    nested: Hints.treeItemNested,
  });
  assert.deepEqual(tree.top, [folder, file]);
  assert.strictEqual(tree.total, 2);
});

// setWheelBlocking touches window listeners only; a recording fake stands in
// for the real window, mirroring the withWindow/document swaps above.
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
      // Leave the module state clean so later tests start from "blocking off".
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
        // Several scroll events in one frame schedule a single re-anchor.
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

// A stand-in for a scroll container: rectOverlapsScrollport only reads the
// node's box and scroll metrics, so a plain object suffices.
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
  // Rects are viewport coordinates, like getBoundingClientRect returns; the
  // container's box is the visible area regardless of scrollTop. An element
  // below the box was scrolled out of the carousel even though it is still
  // inside the window viewport; one inside the box, even though the container
  // is scrolled 300px, is on screen.
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
  ); // below
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 0, top: -100, right: 100, bottom: -20 },
      container,
    ),
    false,
  ); // above
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 520, top: 10, right: 600, bottom: 50 },
      container,
    ),
    false,
  ); // right
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: -100, top: 10, right: -20, bottom: 50 },
      container,
    ),
    false,
  ); // left
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
  // A sliver over the edge still overlaps.
  assert.equal(
    Hints.rectOverlapsScrollport(
      { left: 450, top: 100, right: 550, bottom: 200 },
      container,
    ),
    true,
  );
});

// A fake element for queryClickables: matches by name (like shadow.test.js),
// plus the rect/style reads the pointer gate does.
function pointerEl(
  name,
  { cursor = "default", visibility = "visible", rect, shadowRoot } = {},
) {
  return {
    name,
    cursor,
    visibility,
    shadowRoot: shadowRoot || null,
    childElementCount: 0,
    matches: (sel) => sel === "*" || sel === name,
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

// A document/shadow root whose querySelectorAll filters children by name.
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

// queryClickables reads the window at call time: viewport for the rect gate,
// getComputedStyle for visibility/cursor.
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

test("queryClickables adds pointer-cursor elements the selector missed, in document order", () => {
  const link = pointerEl("a");
  const widget = pointerEl("div", { cursor: "pointer" });
  const plain = pointerEl("span", { cursor: "default" });
  withDocument(rootWith([link, widget, plain]), () => {
    withHintsWindow({}, () => {
      const found = Hints.queryClickables("a");
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
      const found = Hints.queryClickables("a");
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
      const found = Hints.queryClickables("a");
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
      const found = Hints.queryClickables("a");
      assert.strictEqual(found.length, 201); // 200 capped pointer + the link
      assert.strictEqual(found[200], link);
    });
  });
});

test("queryClickables can disable the pointer-cursor pass", () => {
  const widget = pointerEl("div", { cursor: "pointer" });
  withDocument(rootWith([widget]), () => {
    withHintsWindow({}, () => {
      const found = Hints.queryClickables("a", { pointerCursor: false });
      assert.strictEqual(found.length, 0);
    });
  });
});

test("hintRect picks the first fragment of a wrapped anchor and the middle of a clipped one", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const wrapped = {
    childElementCount: 0,
    getClientRects: () => [{ left: 1 }, { left: 2 }],
  };
  const clipped = {
    childElementCount: 0,
    getClientRects: () => [{ left: 1 }, { left: 2 }, { left: 3 }],
  };
  assert.deepEqual(Hints.hintRect(wrapped, fallback), { left: 1 });
  assert.deepEqual(Hints.hintRect(clipped, fallback), { left: 2 });
});

test("hintRect keeps the scan rect for single-fragment or child elements", () => {
  const fallback = { left: 0, top: 0, right: 100, bottom: 20 };
  const single = { childElementCount: 0, getClientRects: () => [{ left: 1 }] };
  const none = { childElementCount: 0, getClientRects: () => [] };
  const parent = {
    childElementCount: 2,
    getClientRects: () => [{ left: 1 }, { left: 2 }],
  };
  assert.deepEqual(Hints.hintRect(single, fallback), fallback);
  assert.deepEqual(Hints.hintRect(none, fallback), fallback);
  assert.deepEqual(Hints.hintRect(parent, fallback), fallback);
});

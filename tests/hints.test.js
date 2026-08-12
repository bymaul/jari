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
    assert.deepEqual(Hints.visiblePortion({ left: 100, top: 100, right: 300, bottom: 200 }), {
      left: 100,
      top: 100,
      right: 300,
      bottom: 200,
    });
  });
});

test("visiblePortion clamps rects cut off by the fold or edges", () => {
  withWindow(1000, 800, () => {
    // A result cut off by the bottom of the viewport keeps its on-screen part.
    assert.deepEqual(Hints.visiblePortion({ left: 0, top: 700, right: 300, bottom: 900 }), {
      left: 0,
      top: 700,
      right: 300,
      bottom: 800,
    });
    // Left edge cut off.
    assert.deepEqual(Hints.visiblePortion({ left: -50, top: 100, right: 200, bottom: 150 }), {
      left: 0,
      top: 100,
      right: 200,
      bottom: 150,
    });
  });
});

test("visiblePortion rejects rects entirely outside the viewport", () => {
  withWindow(1000, 800, () => {
    assert.equal(Hints.visiblePortion({ left: 0, top: 900, right: 100, bottom: 1000 }), null);
    assert.equal(Hints.visiblePortion({ left: 1100, top: 0, right: 1200, bottom: 100 }), null);
    assert.equal(Hints.visiblePortion({ left: 0, top: 0, right: 100, bottom: -50 }), null);
  });
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
  const tree = Hints.scanElements([folder, file], { ...opts, nested: Hints.treeItemNested });
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
      const i = listeners.findIndex((l) => l.type === type && l.handler === handler);
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
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
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

// A stand-in for a scroll container: rectOverlapsScrollport only reads the
// node's box and scroll metrics, so a plain object suffices.
function scrollContainer({ left = 0, top = 0, width = 500, height = 300, scrollLeft = 0, scrollTop = 0 } = {}) {
  return {
    scrollLeft,
    scrollTop,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height }),
  };
}

test("rectOverlapsScrollport rejects elements scrolled out of the container", () => {
  const container = scrollContainer({ top: 0, width: 500, height: 300, scrollTop: 300 });
  // Rects are viewport coordinates, like getBoundingClientRect returns; the
  // container's box is the visible area regardless of scrollTop. An element
  // below the box was scrolled out of the carousel even though it is still
  // inside the window viewport; one inside the box, even though the container
  // is scrolled 300px, is on screen.
  assert.equal(Hints.rectOverlapsScrollport({ left: 10, top: 350, right: 60, bottom: 380 }, container), false);
  assert.equal(Hints.rectOverlapsScrollport({ left: 10, top: 50, right: 60, bottom: 80 }, container), true);
});

test("rectOverlapsScrollport rejects elements on each side of the scrollport", () => {
  const container = scrollContainer({ width: 500, height: 300 });
  assert.equal(Hints.rectOverlapsScrollport({ left: 0, top: 320, right: 100, bottom: 400 }, container), false); // below
  assert.equal(Hints.rectOverlapsScrollport({ left: 0, top: -100, right: 100, bottom: -20 }, container), false); // above
  assert.equal(Hints.rectOverlapsScrollport({ left: 520, top: 10, right: 600, bottom: 50 }, container), false); // right
  assert.equal(Hints.rectOverlapsScrollport({ left: -100, top: 10, right: -20, bottom: 50 }, container), false); // left
});

test("rectOverlapsScrollport keeps anything overlapping the scrollport", () => {
  const container = scrollContainer({ width: 500, height: 300 });
  assert.equal(Hints.rectOverlapsScrollport({ left: 0, top: 0, right: 100, bottom: 100 }, container), true);
  assert.equal(Hints.rectOverlapsScrollport({ left: 100, top: 100, right: 300, bottom: 200 }, container), true);
  // A sliver over the edge still overlaps.
  assert.equal(Hints.rectOverlapsScrollport({ left: 450, top: 100, right: 550, bottom: 200 }, container), true);
});

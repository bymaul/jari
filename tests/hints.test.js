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

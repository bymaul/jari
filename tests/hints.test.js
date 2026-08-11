"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadContentScript } = require("./harness.js");

// hints.js reads settings only through alphabet(); stub it so generateLabels
// can run without a browser. The other public surfaces need a DOM, so only
// the pure label generation is tested here.
const Jari = loadContentScript("hints.js");

function withChars(chars, fn) {
  Jari.settings = { getHintChars: () => chars };
  fn();
}

test("generateLabels returns exactly the requested count of labels", () => {
  withChars("SADFJKLEWCMPGH", () => {
    for (const count of [1, 2, 50, 196, 197, 500, 10000]) {
      const labels = Jari.Hints.generateLabels(count);
      assert.strictEqual(labels.length, count);
    }
  });
});

test("generateLabels labels are unique", () => {
  withChars("SADFJKLEWCMPGH", () => {
    for (const count of [100, 500, 1000, 10000]) {
      const labels = Jari.Hints.generateLabels(count);
      assert.strictEqual(new Set(labels).size, count);
    }
  });
});

test("generateLabels builds labels only from the configured alphabet", () => {
  // generateLabels uses the alphabet as-is — settings already normalize it
  // to uppercase upstream, so that is not the label generator's job.
  withChars("XY", () => {
    const labels = Jari.Hints.generateLabels(5);
    assert.deepEqual(labels, ["XX", "XY", "YX", "YY", "XXX"]);
  });
  withChars("AB", () => {
    const labels = Jari.Hints.generateLabels(4);
    assert.deepEqual(labels, ["AA", "AB", "BA", "BB"]);
  });
});

test("generateLabels starts at two characters and grows past the alphabet square", () => {
  // 14 chars: 14^2 = 196 two-character labels, then three-character ones.
  withChars("SADFJKLEWCMPGH", () => {
    const first = Jari.Hints.generateLabels(196);
    assert.ok(first.every((label) => label.length === 2));
    const grown = Jari.Hints.generateLabels(200);
    assert.strictEqual(grown[196].length, 3);
    assert.strictEqual(grown[199].length, 3);
  });
  // 26 chars: 26^2 = 676 two-character labels.
  withChars("ABCDEFGHIJKLMNOPQRSTUVWXYZ", () => {
    const labels = Jari.Hints.generateLabels(700);
    assert.strictEqual(labels[0].length, 2);
    assert.strictEqual(labels[675].length, 2);
    assert.strictEqual(labels[676].length, 3);
  });
});

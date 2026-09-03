import { test, beforeEach } from "node:test";
import assert from "node:assert";

globalThis.window = {
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  innerHeight: 800,
  scrollX: 0,
  scrollY: 0,
};
globalThis.document = {
  addEventListener: () => {},
  fullscreenElement: null,
  activeElement: null,
  body: { appendChild: () => {} },
  documentElement: { style: {}, appendChild: () => {} },
  createElement: () => ({ appendChild: () => {}, remove: () => {}, setAttribute: () => {} }),
  querySelector: () => null,
  execCommand: () => {},
};
globalThis.location = { hostname: "test.example" };
globalThis.chrome = {
  storage: {
    sync: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
  runtime: {
    sendMessage: async () => {},
    onMessage: { addListener: () => {} },
  },
};

const { settings } = await import("../content/settings.js");
const { genLabels, normalizeCharset } = await import("../content/hints.js");
const { HINT_CHARSET_DEFAULT, keymapDefaults } = await import("../content/keymap.js");

function assertPrefixFree(labels) {
  assert.equal(new Set(labels).size, labels.length, "labels must be unique");
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      if (i !== j) {
        assert.ok(
          !labels[j].startsWith(labels[i]),
          `prefix conflict: ${labels[i]} is a prefix of ${labels[j]}`,
        );
      }
    }
  }
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
  });
});

test("genLabels returns single chars when count fits the charset", () => {
  assert.deepEqual(genLabels(3, "abc"), ["A", "B", "C"]);
  assert.deepEqual(genLabels(1, "ab"), ["A"]);
});

test("genLabels rejects empty counts and degenerate charsets", () => {
  assert.deepEqual(genLabels(0, "abc"), []);
  assert.deepEqual(genLabels(-1, "abc"), []);
  assert.deepEqual(genLabels(5, "a"), []);
});

test("genLabels is prefix-free across hint counts", () => {
  for (const count of [2, 5, 12, 13, 26, 50, 100, 200, 500]) {
    assertPrefixFree(genLabels(count, HINT_CHARSET_DEFAULT));
  }
});

test("genLabels is prefix-free for small charsets", () => {
  for (const count of [2, 3, 5, 10, 30]) {
    assertPrefixFree(genLabels(count, "ab"));
  }
});

test("normalizeCharset falls back to the shared default", () => {
  assert.equal(normalizeCharset(), HINT_CHARSET_DEFAULT);
});

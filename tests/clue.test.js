import "./setup.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  getDynamicPrefixes,
  getPrefixEntries,
  isPrefixKey,
  keymapDefaults,
  normalizeSettings,
  settingsDefaults,
} from "../content/keymap.js";

const { settings } = await import("../content/settings.js");
const { Clue, __resetClueState } = await import("../content/clue.js");
const { handleKeydown, __resetState } = await import("../content/content.js");
const { commands } = await import("../content/commands.js");

function makeElement(tag) {
  return {
    tagName: tag,
    className: "",
    children: [],
    _text: "",
    set textContent(value) {
      this._text = value;
      this.children.length = 0;
    },
    get textContent() {
      return this._text;
    },
    appendChild(child) {
      this.children.push(child);
    },
    remove() {
      this.isConnected = false;
    },
    isConnected: true,
  };
}

function makeDocument() {
  const created = [];
  const bodyChildren = [];
  return {
    created,
    bodyChildren,
    activeElement: null,
    fullscreenElement: null,
    body: {
      appendChild(el) {
        bodyChildren.push(el);
      },
    },
    documentElement: {
      appendChild(el) {
        bodyChildren.push(el);
      },
    },
    createElement: (tag) => {
      const el = makeElement(tag);
      created.push(el);
      return el;
    },
  };
}

async function withDocument(doc, fn) {
  const previous = globalThis.document;
  globalThis.document = doc;
  try {
    await fn();
  } finally {
    globalThis.document = previous;
  }
}

function key(partial = {}) {
  return {
    isTrusted: true,
    key: "j",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...partial,
  };
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
    clueEnabled: true,
    clueDelayMs: 0,
  });
});

afterEach(() => {
  __resetState();
  __resetClueState();
});

test("getPrefixEntries lists g continuations sorted by suffix", () => {
  const entries = getPrefixEntries(keymapDefaults, "g");
  const suffixes = entries.map((e) => e.suffix);
  assert.deepEqual([...suffixes].sort(), suffixes);
  assert.ok(entries.some((e) => e.full === "gu" && e.command === "goToParent"));
  assert.ok(entries.some((e) => e.full === "g$" && e.command === "goToLastTab"));
  assert.ok(!entries.some((e) => e.full === "g"));
});

test("getPrefixEntries skips modifier combos", () => {
  const entries = getPrefixEntries(
    { ...keymapDefaults, "ctrl+alt+v": "toggleSiteEnabled" },
    "c",
  );
  assert.deepEqual(entries, []);
});

test("isPrefixKey detects prefixes and rejects digits and modifiers", () => {
  assert.equal(isPrefixKey(keymapDefaults, "g"), true);
  assert.equal(isPrefixKey(keymapDefaults, ";"), true);
  assert.equal(isPrefixKey(keymapDefaults, "y"), true);
  assert.equal(isPrefixKey(keymapDefaults, "<"), true);
  assert.equal(isPrefixKey(keymapDefaults, "j"), false);
  assert.equal(isPrefixKey(keymapDefaults, "5"), false);
  assert.equal(isPrefixKey(keymapDefaults, "ctrl+g"), false);
});

test("getDynamicPrefixes derives prefixes from the keymap", () => {
  const prefixes = getDynamicPrefixes(keymapDefaults);
  for (const p of ["g", ";", "y", "<", ">"]) assert.ok(prefixes.has(p), p);
  assert.ok(!prefixes.has("j"));
  const custom = getDynamicPrefixes({ za: "scrollDown", zb: "scrollUp" });
  assert.ok(custom.has("z"));
  assert.ok(!custom.has("g"));
});

test("normalizeSettings defaults the clue to enabled with the default delay", () => {
  const s = normalizeSettings({});
  assert.equal(s.clueEnabled, true);
  assert.equal(s.clueDelayMs, settingsDefaults.clueDelayMs);
  const off = normalizeSettings({ clueEnabled: false, clueDelayMs: 0 });
  assert.equal(off.clueEnabled, false);
  assert.equal(off.clueDelayMs, 0);
  const bad = normalizeSettings({ clueDelayMs: -5 });
  assert.equal(bad.clueDelayMs, settingsDefaults.clueDelayMs);
});

test("clue shows immediately when delay is zero and hides on hide()", async () => {
  const doc = makeDocument();
  await withDocument(doc, async () => {
    Clue.schedule("g", "");
    assert.equal(Clue.isVisible(), true);
    const root = doc.bodyChildren.find((el) => el.className === "jari-clue");
    assert.ok(root);
    const title = root.children[0];
    assert.match(title.textContent, /g/);
    const list = root.children[1];
    assert.ok(list.children.length > 0);
    const firstKeys = list.children.map((row) => row.children[0].textContent);
    assert.deepEqual([...firstKeys].sort(), firstKeys);
    Clue.hide();
    assert.equal(Clue.isVisible(), false);
  });
});

test("clue stays hidden when disabled", async () => {
  settings.set({ keymap: { ...keymapDefaults }, clueEnabled: false, clueDelayMs: 0 });
  const doc = makeDocument();
  await withDocument(doc, async () => {
    Clue.schedule("g", "");
    assert.equal(Clue.isVisible(), false);
  });
});

test("clue shows after the configured delay", async () => {
  settings.set({ keymap: { ...keymapDefaults }, clueEnabled: true, clueDelayMs: 20 });
  const doc = makeDocument();
  await withDocument(doc, async () => {
    Clue.schedule("g", "");
    assert.equal(Clue.isVisible(), false);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(Clue.isVisible(), true);
    Clue.hide();
  });
});

test("pressing a prefix then completing hides the clue and runs the command", async () => {
  const doc = makeDocument();
  await withDocument(doc, async () => {
    const original = commands.goToParent;
    let calls = 0;
    commands.goToParent = { run: () => calls++ };
    try {
      handleKeydown(key({ key: "g" }));
      assert.equal(Clue.isVisible(), true);
      handleKeydown(key({ key: "u" }));
      assert.equal(calls, 1);
      assert.equal(Clue.isVisible(), false);
    } finally {
      commands.goToParent = original;
    }
  });
});

test("a custom z prefix triggers the clue dynamically", async () => {
  settings.set({
    keymap: { za: "scrollDown", zb: "scrollUp" },
    clueEnabled: true,
    clueDelayMs: 0,
  });
  const doc = makeDocument();
  await withDocument(doc, async () => {
    handleKeydown(key({ key: "z" }));
    assert.equal(Clue.isVisible(), true);
    const root = doc.bodyChildren.find((el) => el.className === "jari-clue");
    assert.ok(root);
  });
});

function clueRows(doc) {
  const root = doc.bodyChildren.find((el) => el.className === "jari-clue");
  return root.children[1].children;
}

test("refilter narrows the visible clue and backspace restores it", async () => {
  const doc = makeDocument();
  await withDocument(doc, async () => {
    Clue.schedule("g", "");
    const full = clueRows(doc).length;
    assert.ok(full > 1);
    assert.equal(Clue.hasFilter(), false);

    assert.equal(Clue.refilter("o"), true);
    assert.equal(Clue.hasFilter(), true);
    const narrowed = clueRows(doc).length;
    assert.ok(narrowed > 0 && narrowed < full);

    assert.equal(Clue.backspaceFilter(), true);
    assert.equal(Clue.hasFilter(), false);
    assert.equal(clueRows(doc).length, full);
  });
});

test("refilter returns false while the clue is hidden", async () => {
  const doc = makeDocument();
  await withDocument(doc, async () => {
    assert.equal(Clue.isVisible(), false);
    assert.equal(Clue.refilter("a"), false);
    assert.equal(Clue.backspaceFilter(), false);
  });
});

test("multi-char suffixes render as nested chains", async () => {
  settings.set({
    keymap: { gfk: "hintYank", gu: "goToParent" },
    clueEnabled: true,
    clueDelayMs: 0,
  });
  const doc = makeDocument();
  await withDocument(doc, async () => {
    Clue.schedule("g", "");
    const keys = clueRows(doc).map((row) => row.children[0].textContent);
    assert.ok(keys.some((k) => k.includes("▸")), keys.join(","));
  });
});

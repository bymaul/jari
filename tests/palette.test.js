import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import {
  Palette,
  buildCommandSource,
  filterCommands,
} from "../content/palette.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { keymapDefaults } from "../content/keymap.js";

test("command source covers the catalog with keys and unbound marks", () => {
  const items = buildCommandSource(keymapDefaults);
  assert.equal(items.length, Object.keys(COMMAND_CATALOG).length);
  const byName = new Map(items.map((item) => [item.name, item]));
  assert.equal(byName.get("scrollDown").detail, "j");
  assert.equal(byName.get("hintOpenCurrent").detail, "unbound");
  assert.equal(byName.get("showCommandPalette").detail, ":");
  assert.ok(byName.get("hintYank").title.includes("hintYank"));
});

test("empty query returns every command", () => {
  const items = buildCommandSource(keymapDefaults);
  assert.deepEqual(filterCommands(items, ""), items);
  assert.deepEqual(filterCommands(items, "   "), items);
});

test("fuzzy filter finds commands by label or name", () => {
  const items = buildCommandSource(keymapDefaults);
  const results = filterCommands(items, "reopen");
  assert.ok(results.length > 0);
  assert.equal(results[0].name, "restoreTab");
});

test("fuzzy filter finds commands by bound keys", () => {
  const items = buildCommandSource(keymapDefaults);
  const results = filterCommands(items, "gf");
  assert.ok(results.some((item) => item.name === "hintOpenBackground"));
});

test("substring filter matches keys and labels", () => {
  const items = buildCommandSource(keymapDefaults);
  const byKeys = filterCommands(items, "[[", false);
  assert.ok(byKeys.some((item) => item.name === "prevPage"));
  const byLabel = filterCommands(items, "incognito", false);
  assert.ok(byLabel.some((item) => item.name === "openOmnibarIncognito"));
  assert.deepEqual(filterCommands(items, "zzz-no-such-command", false), []);
});

function makeElement(tag) {
  const el = {
    tagName: tag,
    className: "",
    children: [],
    listeners: {},
    isConnected: true,
    style: {},
    attrs: {},
    value: "",
    _text: "",
    set textContent(value) {
      this._text = value;
      if (value === "") this.children.length = 0;
    },
    get textContent() {
      let out = this._text || "";
      for (const child of this.children || []) {
        try {
          out += child.textContent || "";
        } catch {}
      }
      return out;
    },
    classList: { toggle() {}, add() {} },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this.isConnected = false;
    },
    focus() {
      document.activeElement = this;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    scrollIntoView() {},
  };
  el.attachShadow = () => {
    el.shadowRoot = {
      children: [],
      activeElement: null,
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
    return el.shadowRoot;
  };
  el.shadowRoot = null;
  return el;
}

function makeDocument() {
  const created = [];
  return {
    created,
    activeElement: null,
    body: { appendChild() {} },
    createElement: (tag) => {
      const el = makeElement(tag);
      created.push(el);
      return el;
    },
    createDocumentFragment: () => {
      const frag = {
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      };
      return frag;
    },
    createTextNode: (text) => ({ text, nodeType: 3 }),
  };
}

async function withDocument(document, fn) {
  const previous = globalThis.document;
  globalThis.document = document;
  try {
    await fn();
  } finally {
    globalThis.document = previous;
  }
}

function keyEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...modifiers,
  };
}

test("Escape clears the filter first and closes on the second press", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    try {
      Palette.open({});
      const input = document.created.find((el) => el.tagName === "input");
      input.value = "scroll";
      input.dispatch("input", {});
      assert.equal(Palette.isActive(), true);
      Palette.onKeyDown(keyEvent("Escape"));
      assert.equal(Palette.isActive(), true);
      assert.equal(input.value, "");
      Palette.onKeyDown(keyEvent("Escape"));
      assert.equal(Palette.isActive(), false);
    } finally {
      Palette.close();
    }
  });
});

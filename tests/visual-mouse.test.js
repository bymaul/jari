import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { genLabels, normalizeCharset } from "../content/hint-layer.js";

globalThis.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1 };
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const { Visual, __resetVisualState } = await import("../content/visual.js");

const RECT = {
  top: 10,
  bottom: 30,
  left: 10,
  right: 110,
  width: 100,
  height: 20,
};

function makeTextNode(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null };
}

function makeEl(tag, text) {
  const textNode = text != null ? makeTextNode(text) : null;
  if (textNode) textNode.parentElement = null;
  const el = {
    nodeType: 1,
    tagName: tag,
    className: "",
    children: [],
    childNodes: textNode ? [textNode] : [],
    textContent: text != null ? text : "",
    dataset: {},
    style: {},
    listeners: {},
    isConnected: true,
    isContentEditable: false,
    parentNode: null,
    parentElement: null,
    offsetHeight: 20,
    offsetWidth: 100,
    childElementCount: 0,
    firstElementChild: null,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(...kids) {
      this.children.push(...kids);
      return kids[0];
    },
    prepend(child) {
      this.children.unshift(child);
      return child;
    },
    remove() {
      this.isConnected = false;
    },
    setAttribute() {},
    getAttribute() {
      return null;
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
    contains(other) {
      return other === this;
    },
    getRootNode() {
      return { elementFromPoint: () => el };
    },
    getBoundingClientRect() {
      return { ...RECT };
    },
    getClientRects() {
      return [{ ...RECT }];
    },
  };
  if (textNode) textNode.parentElement = el;
  return el;
}

function makeRange() {
  return {
    setStart() {},
    setEnd() {},
    collapse() {},
    selectNodeContents() {},
    surroundContents() {},
    cloneRange() {
      return this;
    },
    getBoundingClientRect() {
      return { ...RECT };
    },
    getClientRects() {
      return [];
    },
  };
}

function makeSelection() {
  return {
    rangeCount: 1,
    isCollapsed: true,
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    removeAllRangesCalls: 0,
    _range: makeRange(),
    removeAllRanges() {
      this.removeAllRangesCalls++;
      this.rangeCount = 0;
    },
    addRange(range) {
      this.rangeCount = 1;
      this._range = range;
    },
    getRangeAt() {
      return this._range;
    },
    modify() {
      this.isCollapsed = false;
    },
    extend() {},
    toString() {
      return "";
    },
  };
}

function installFakes() {
  const created = [];
  const walkerNodes = [];
  const sel = makeSelection();
  const body = makeEl("BODY");
  const root = makeEl("HTML");
  root.clientTop = 0;
  const win = {
    listeners: {},
    innerWidth: 1024,
    innerHeight: 768,
    pageXOffset: 0,
    pageYOffset: 0,
    scrollX: 0,
    scrollY: 0,
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
    getSelection: () => sel,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      cursor: "",
      getPropertyValue: () => "",
    }),
  };
  const doc = {
    created,
    activeElement: null,
    body,
    documentElement: root,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
    createElement: (tag) => {
      const el = makeEl(tag);
      created.push(el);
      return el;
    },
    createTextNode: (text) => makeTextNode(text),
    createRange: () => makeRange(),
    createTreeWalker: () => {
      let i = 0;
      return { nextNode: () => walkerNodes[i++] || null };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = doc;
  globalThis.window = win;
  return {
    created,
    walkerNodes,
    sel,
    window: win,
    document: doc,
    restore() {
      globalThis.document = prevDoc;
      globalThis.window = prevWin;
    },
  };
}

function keyEvent(key) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

function mouseEvent(target) {
  return { target, button: 0, composedPath: () => [target] };
}

// Enters visual mode on a single fake paragraph. Returns the paragraph and
// a getter for the current pill (hint activation swaps the pill element).
function enterVisualOnParagraph(fx) {
  const p = makeEl("P", "hello world foo bar");
  p._jariViewportRect = { ...RECT };
  fx.walkerNodes.length = 0;
  fx.walkerNodes.push(p);
  Visual.enter("visual");
  const label = genLabels(1, normalizeCharset())[0];
  fx.walkerNodes.length = 0;
  fx.walkerNodes.push(p.childNodes[0]);
  Visual.onKeyDown(keyEvent(label.toLowerCase()));
  assert.equal(Visual.isActive(), true);
  const pill = () => {
    const pills = fx.created.filter((el) => el.className === "jari-pill");
    assert.ok(pills.length > 0, "expected a visual pill");
    return pills[pills.length - 1];
  };
  return { p, pill };
}

test("click on page re-anchors: external collapse drops to caret mode", () => {
  const fx = installFakes();
  try {
    __resetVisualState();
    const { pill } = enterVisualOnParagraph(fx);
    assert.equal(pill().textContent, "visual");

    fx.sel.isCollapsed = false;
    fx.window.dispatch("mousedown", mouseEvent(makeEl("DIV")));
    assert.equal(Visual.isActive(), true);

    fx.sel.isCollapsed = true;
    fx.document.dispatch("selectionchange", {});
    assert.equal(pill().textContent, "caret");
    assert.equal(Visual.isActive(), true);
  } finally {
    __resetVisualState();
    fx.restore();
  }
});

test("click into an input closes visual mode but keeps the field caret", () => {
  const fx = installFakes();
  try {
    __resetVisualState();
    enterVisualOnParagraph(fx);
    fx.sel.removeAllRangesCalls = 0;

    fx.window.dispatch("mousedown", mouseEvent(makeEl("INPUT")));
    assert.equal(Visual.isActive(), false);
    assert.equal(fx.sel.removeAllRangesCalls, 0);
  } finally {
    __resetVisualState();
    fx.restore();
  }
});

test("click during hint targeting dismisses the hints", () => {
  const fx = installFakes();
  try {
    __resetVisualState();
    const p = makeEl("P", "hello world foo bar");
    p._jariViewportRect = { ...RECT };
    fx.walkerNodes.push(p);
    Visual.enter("visual");
    assert.equal(Visual.isActive(), true);

    fx.window.dispatch("mousedown", mouseEvent(makeEl("DIV")));
    assert.equal(Visual.isActive(), false);
  } finally {
    __resetVisualState();
    fx.restore();
  }
});

test("click on jari UI does not disturb visual mode", () => {
  const fx = installFakes();
  try {
    __resetVisualState();
    enterVisualOnParagraph(fx);

    const host = makeEl("DIV");
    host.className = "jari-prompt-host";
    fx.window.dispatch("mousedown", mouseEvent(host));
    assert.equal(Visual.isActive(), true);
  } finally {
    __resetVisualState();
    fx.restore();
  }
});

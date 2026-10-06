import "./setup.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const { Scroll } = await import("../content/scroll.js");

const VW = 800;
const VH = 600;

globalThis.Node = { ELEMENT_NODE: 1 };

const windowCalls = { focus: 0, blur: 0 };
globalThis.window.innerWidth = VW;
globalThis.window.innerHeight = VH;
globalThis.window.scrollX = 0;
globalThis.window.scrollY = 0;
globalThis.window.focus = () => {
  windowCalls.focus++;
};
globalThis.window.blur = () => {
  windowCalls.blur++;
};
globalThis.window.getComputedStyle = () => ({
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflowY: "auto",
  overflowX: "auto",
});

function makeArea() {
  return {
    tagName: "DIV",
    nodeType: 1,
    isConnected: true,
    parentElement: null,
    clientHeight: 200,
    clientWidth: 200,
    scrollHeight: 600,
    scrollWidth: 200,
    focusCalls: 0,
    blurCalls: 0,
    closest: () => null,
    hasAttribute: () => false,
    getRootNode: () => ({ host: null }),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 200,
      width: 200,
      height: 200,
    }),
    scrollIntoView: () => {},
    focus() {
      this.focusCalls++;
    },
    blur() {
      this.blurCalls++;
    },
    matches: (sel) => sel === "*",
  };
}

function makeFrame() {
  const el = makeArea();
  el.tagName = "IFRAME";
  el.matches = () => true;
  el.contentWindow = {
    focusCalls: 0,
    focus() {
      this.focusCalls++;
    },
  };
  return el;
}

// One shared fixture set: the scroll module caches element lookups per
// scan epoch, so fixtures must stay identical across tests.
const area = makeArea();
const frame = makeFrame();
globalThis.document.querySelectorAll = () => [area, frame];
globalThis.document.scrollingElement = { scrollHeight: 1200, clientHeight: 600 };
globalThis.document.createElement = () => ({
  style: {},
  appendChild: () => {},
  remove: () => {},
});
globalThis.document.body = { appendChild: () => {} };

function resetCalls() {
  area.focusCalls = 0;
  area.blurCalls = 0;
  frame.focusCalls = 0;
  frame.blurCalls = 0;
  frame.contentWindow.focusCalls = 0;
  windowCalls.focus = 0;
  windowCalls.blur = 0;
}

beforeEach(() => {
  globalThis.window.top = globalThis.window;
  globalThis.document.activeElement = null;
  resetCalls();
});

// The top-frame rotation is global -> area -> frame -> global.
function rotateTo(target) {
  for (let i = 0; i < 4; i++) {
    if (Scroll.getTarget() === target) return;
    Scroll.cycle();
  }
  assert.fail("could not rotate to the expected scroll target");
}

test("w cycles global -> area -> frame -> global", () => {
  rotateTo(globalThis.window);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), area);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle();
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("W cycles backward global -> frame -> area -> global", () => {
  rotateTo(globalThis.window);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), area);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("a repeat count skips stops in either direction", () => {
  rotateTo(area);
  Scroll.cycle(2);
  assert.equal(Scroll.getTarget(), globalThis.window);
  Scroll.cycle(-1);
  assert.equal(Scroll.getTarget(), frame);
  Scroll.cycle(-2);
  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("reset returns to the page after cycling onto an area", () => {
  rotateTo(area);
  assert.equal(Scroll.getTarget(), area);

  Scroll.reset();

  assert.equal(Scroll.getTarget(), globalThis.window);
});

test("reset releases frame focus and returns to the page", () => {
  rotateTo(frame);
  assert.equal(Scroll.getTarget(), frame);
  globalThis.document.activeElement = frame;
  resetCalls();

  Scroll.reset();

  assert.equal(Scroll.getTarget(), globalThis.window);
  assert.ok(frame.blurCalls > 0, "expected the frame to be blurred");
  assert.ok(windowCalls.focus > 0, "expected focus to return to the page");
});

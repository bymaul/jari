import "./setup.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert";
import { ui } from "../content/ui.js";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const savedCreateElement = globalThis.document.createElement;
const savedBody = globalThis.document.body;
const savedExecCommand = globalThis.document.execCommand;

function stubNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (!navigatorDescriptor) delete globalThis.navigator;
  else Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  globalThis.document.createElement = savedCreateElement;
  globalThis.document.body = savedBody;
  globalThis.document.execCommand = savedExecCommand;
});

function stubTextarea({ execResult, execThrows = false } = {}) {
  const ta = {
    style: {},
    value: "",
    select() {},
    focus() {},
    remove() {},
  };
  globalThis.document.createElement = () => ta;
  globalThis.document.body = { appendChild() {} };
  globalThis.document.execCommand = () => {
    if (execThrows) throw new Error("denied");
    return execResult;
  };
  return ta;
}

test("copyText resolves true through the async clipboard API", async () => {
  let written = null;
  stubNavigator({
    clipboard: {
      writeText: async (text) => {
        written = text;
      },
    },
  });
  assert.equal(await ui.copyText("hello"), true);
  assert.equal(written, "hello");
});

test("copyText falls back to execCommand and reports its result", async () => {
  stubNavigator({
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  stubTextarea({ execResult: true });
  assert.equal(await ui.copyText("hello"), true);
  stubTextarea({ execResult: false });
  assert.equal(await ui.copyText("hello"), false);
});

test("copyText resolves false when every path fails", async () => {
  stubNavigator({
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  stubTextarea({ execThrows: true });
  assert.equal(await ui.copyText("hello"), false);
});

test("dispatchClick uses pointer events, element coords, and focuses before click", () => {
  const hadMouseEvent = "MouseEvent" in globalThis;
  const savedMouseEvent = globalThis.MouseEvent;
  const pointerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "PointerEvent");
  class FakeMouse {
    constructor(type, init = {}) {
      this.type = type;
      this.isPointer = false;
      Object.assign(this, init);
    }
  }
  class FakePointer extends FakeMouse {
    constructor(type, init = {}) {
      super(type, init);
      this.isPointer = true;
    }
  }
  globalThis.MouseEvent = FakeMouse;
  Object.defineProperty(globalThis, "PointerEvent", {
    value: FakePointer,
    configurable: true,
    writable: true,
  });
  try {
    const seen = [];
    let focusedAt = -1;
    const el = {
      ownerDocument: null,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
      scrollIntoView() {},
      dispatchEvent: (e) => seen.push(e),
      focus() {
        focusedAt = seen.length;
      },
    };
    ui.dispatchClick(el);
    assert.deepEqual(
      seen.map((e) => e.type),
      ["mouseover", "pointerdown", "mousedown", "pointerup", "mouseup", "click"],
    );
    assert.deepEqual(
      seen.map((e) => e.isPointer),
      [false, true, false, true, false, false],
    );
    for (const e of seen) {
      assert.equal(e.clientX, 60);
      assert.equal(e.clientY, 40);
    }
    assert.deepEqual(
      seen.map((e) => e.buttons),
      [0, 1, 1, 0, 0, 0],
    );
    assert.equal(focusedAt, 3);
  } finally {
    if (hadMouseEvent) globalThis.MouseEvent = savedMouseEvent;
    else delete globalThis.MouseEvent;
    if (!pointerDescriptor) delete globalThis.PointerEvent;
    else Object.defineProperty(globalThis, "PointerEvent", pointerDescriptor);
  }
});

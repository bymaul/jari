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

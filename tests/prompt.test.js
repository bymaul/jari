import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Prompt } from "../content/prompt.js";

function makeElement(tag) {
  return {
    tagName: tag,
    className: "",
    children: [],
    listeners: {},
    isConnected: true,
    _text: "",
    set textContent(value) {
      this._text = value;

      if (value === "") this.children.length = 0;
    },
    get textContent() {
      return this._text;
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
    },
    remove() {
      this.isConnected = false;
    },
    focus() {
      document.activeElement = this;
    },
    scrollIntoView() {},
  };
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

async function withSendMessage(response, fn) {
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => callback(response);
  try {
    await fn();
  } finally {
    chrome.runtime.sendMessage = original;
  }
}

function keyEvent(key) {
  return {
    key,
    preventDefaultCalls: 0,
    stopPropagationCalls: 0,
    stopImmediatePropagationCalls: 0,
    preventDefault() {
      this.preventDefaultCalls++;
    },
    stopPropagation() {
      this.stopPropagationCalls++;
    },
    stopImmediatePropagation() {
      this.stopImmediatePropagationCalls++;
    },
  };
}

const TAB = { id: 1, title: "Example", url: "https://example.com", windowId: 1 };

async function openPrompt(document) {
  await withSendMessage([TAB], () => Prompt.open());
  return document.created.find((el) => el.tagName === "input");
}

test("keys typed into the prompt input stop at the input and never reach the page", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const input = await openPrompt(document);
    assert.strictEqual(document.activeElement, input);

    const printable = keyEvent("j");
    Prompt.onKeyDown(printable);
    assert.strictEqual(printable.preventDefaultCalls, 0);
    assert.strictEqual(printable.stopImmediatePropagationCalls, 0);

    input.dispatch("keydown", printable);
    assert.strictEqual(printable.stopPropagationCalls, 1);
    assert.strictEqual(printable.preventDefaultCalls, 0);

    Prompt.close();
  });
});

test("keys the prompt consumes (Escape) are still stopped at the dispatcher", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    await openPrompt(document);
    const escape = keyEvent("Escape");
    Prompt.onKeyDown(escape);
    assert.strictEqual(escape.preventDefaultCalls, 1);
    assert.strictEqual(escape.stopImmediatePropagationCalls, 1);
    assert.strictEqual(document.activeElement.tagName, "input");
    Prompt.close();
  });
});

test("close() returns focus to the element that had it before the prompt opened", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const before = document.createElement("div");
    before.isConnected = true;
    document.activeElement = before;
    const input = await openPrompt(document);
    assert.strictEqual(document.activeElement, input);
    Prompt.close();
    assert.strictEqual(document.activeElement, before);
  });
});

test("close() does not force focus back onto a disconnected element", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const gone = document.createElement("div");
    gone.isConnected = false;
    let focusCalls = 0;
    gone.focus = () => {
      focusCalls++;
    };
    document.activeElement = gone;
    const input = await openPrompt(document);
    assert.strictEqual(document.activeElement, input);
    Prompt.close();
    assert.strictEqual(focusCalls, 0);
  });
});

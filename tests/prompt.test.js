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

function keyEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
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
    ...modifiers,
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

test("Tab moves the selection forward and Shift+Tab moves it back", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    await withSendMessage(
      [TAB, { id: 2, title: "Two", url: "https://two.example", windowId: 1 }],
      () => Prompt.open(),
    );
    const lis = document.created.filter((el) => el.tagName === "li");
    assert.equal(lis.length, 2);
    const views = [0, 0];
    lis.forEach((li, i) => {
      li.scrollIntoView = () => {
        views[i]++;
      };
    });

    const tab = keyEvent("Tab");
    Prompt.onKeyDown(tab);
    assert.equal(tab.preventDefaultCalls, 1);
    assert.equal(tab.stopImmediatePropagationCalls, 1);
    assert.deepEqual(views, [0, 1]);

    const shiftTab = keyEvent("Tab", { shiftKey: true });
    Prompt.onKeyDown(shiftTab);
    assert.equal(shiftTab.preventDefaultCalls, 1);
    assert.deepEqual(views, [1, 1]);

    const shiftTabAgain = keyEvent("Tab", { shiftKey: true });
    Prompt.onKeyDown(shiftTabAgain);
    assert.equal(shiftTabAgain.preventDefaultCalls, 1);
    assert.deepEqual(views, [1, 2]);

    Prompt.close();
  });
});

test("Ctrl+Tab is left to the browser and does not move the selection", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    await withSendMessage([TAB], () => Prompt.open());
    const ctrlTab = keyEvent("Tab", { ctrlKey: true });
    Prompt.onKeyDown(ctrlTab);
    assert.equal(ctrlTab.preventDefaultCalls, 0);
    assert.equal(ctrlTab.stopImmediatePropagationCalls, 0);
    Prompt.close();
  });
});

async function openIncognitoPrompt(document, input) {
  const sent = [];
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => {
    sent.push(message);
    callback([]);
  };
  try {
    Prompt.openIncognito();
    const inputEl = document.created.find((el) => el.tagName === "input");
    inputEl.value = input;
    inputEl.dispatch("input", {});
    Prompt.onKeyDown(keyEvent("Enter"));
  } finally {
    chrome.runtime.sendMessage = original;
    Prompt.close();
  }
  return sent;
}

test("incognito omnibar submits a URL to the incognito handler", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const sent = await openIncognitoPrompt(document, "example.com");
    const open = sent.find((m) => m.action === "openIncognitoTab");
    assert.ok(open, "expected an incognito open");
    assert.equal(open.url, "example.com");
    assert.ok(
      !sent.some((m) => m.action === "createTab" || m.action === "navigate"),
      "expected no normal-tab navigation",
    );
  });
});

test("incognito omnibar submits a search with the incognito flag", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const sent = await openIncognitoPrompt(document, "some random query");
    assert.deepEqual(
      sent.find((m) => m.action === "search"),
      {
        action: "search",
        query: "some random query",
        newTab: true,
        incognito: true,
      },
    );
  });
});

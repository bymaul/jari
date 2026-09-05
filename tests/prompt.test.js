import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Prompt, isTabListAll, parseTabPrefix } from "../content/prompt.js";
import { settings } from "../content/settings.js";

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

function openOmnibarPrompt(document) {
  Prompt.openOmnibar();
  return document.created.find((el) => el.tagName === "input");
}

function lisOf(document) {
  return document.created.filter((el) => el.tagName === "li");
}

function renderedRows(document) {
  const ul = document.created.find((el) => el.tagName === "ul");
  return ul ? ul.children.length : 0;
}

test("keys typed into the prompt input stop at the input and never reach the page", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const input = openOmnibarPrompt(document);
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
    await openOmnibarPrompt(document);
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
    const input = openOmnibarPrompt(document);
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
    const input = openOmnibarPrompt(document);
    assert.strictEqual(document.activeElement, input);
    Prompt.close();
    assert.strictEqual(focusCalls, 0);
  });
});

test("Tab moves the selection forward and Shift+Tab moves it back", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    Prompt.chooseWindow({
      tabs: [TAB, { id: 2, title: "Two", url: "https://two.example", windowId: 1 }],
    });
    const lis = lisOf(document);
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
    Prompt.chooseWindow({ tabs: [TAB] });
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

test("parseTabPrefix detects the t tab-only prefix", () => {
  assert.equal(parseTabPrefix("t ytb"), "ytb");
  assert.equal(parseTabPrefix("t   lofi hip hop  "), "lofi hip hop");
  assert.equal(parseTabPrefix("T ytb"), "ytb");
  assert.equal(parseTabPrefix("t"), null);
  assert.equal(parseTabPrefix("t "), null);
  assert.equal(parseTabPrefix("yt cats"), null);
  assert.equal(parseTabPrefix("tab ytb"), null);
  assert.equal(parseTabPrefix(""), null);
});

const YT_TAB = {
  id: 7,
  title: "lofi hip hop radio - YouTube",
  url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
  source: "tab",
};
const YT_HISTORY = {
  title: "youth baseball tips",
  url: "https://example.com/ytb-guide",
  source: "history",
};
const YT_BOOKMARK = {
  title: "YTB Fan Club",
  url: "https://fan.example",
  source: "bookmark",
};

function mockSuggest(items, onMessage) {
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => {
    onMessage && onMessage(message);
    if (message.action === "suggest") callback(items);
    else callback([]);
  };
  return () => {
    chrome.runtime.sendMessage = original;
  };
}

const waitSuggest = () => new Promise((r) => setTimeout(r, 300));

test("isTabListAll detects the bare t prefix", () => {
  assert.equal(isTabListAll("t "), true);
  assert.equal(isTabListAll("t  "), true);
  assert.equal(isTabListAll("T "), true);
  assert.equal(isTabListAll(" t "), true);
  assert.equal(isTabListAll("t"), false);
  assert.equal(isTabListAll("t ytb"), false);
  assert.equal(isTabListAll(""), false);
  assert.equal(isTabListAll(" "), false);
});

test("omnibar bare t prefix immediately lists all tabs", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const tabs = [
      { id: 1, title: "One", url: "https://one.example", windowId: 1 },
      { id: 2, title: "Two", url: "https://two.example", windowId: 1 },
    ];
    const sent = [];
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, callback) => {
      sent.push(message);
      if (message.action === "listTabs") callback(tabs);
      else callback([]);
    };
    try {
      const input = openOmnibarPrompt(document);
      input.value = "t ";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 2);
      Prompt.onKeyDown(keyEvent("ArrowDown"));
      Prompt.onKeyDown(keyEvent("Enter"));
      assert.deepEqual(
        sent.find((m) => m.action === "activateTab"),
        { action: "activateTab", id: 2 },
      );
    } finally {
      chrome.runtime.sendMessage = original;
      Prompt.close();
    }
  });
});

test("typing t, waiting, then space still switches to the tab list", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const tabs = [
      { id: 1, title: "One", url: "https://one.example", windowId: 1 },
      { id: 2, title: "Two", url: "https://two.example", windowId: 1 },
    ];
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, callback) => {
      if (message.action === "listTabs") callback(tabs);
      else if (message.action === "suggest") callback([]);
      else callback([]);
    };
    try {
      const input = openOmnibarPrompt(document);
      input.value = "t";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 1);
      input.value = "t ";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 2);
    } finally {
      chrome.runtime.sendMessage = original;
      Prompt.close();
    }
  });
});

test("omnibar caps visible rows at the maxResults setting", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const items = [];
    for (let i = 0; i < 12; i++) {
      items.push({
        title: `test tab ${i}`,
        url: `https://tabs.example/${i}`,
        source: "tab",
        id: 100 + i,
      });
    }
    for (let i = 0; i < 12; i++) {
      items.push({
        title: `test history ${i}`,
        url: `https://history.example/${i}`,
        source: "history",
      });
    }
    for (let i = 0; i < 6; i++) {
      items.push({
        title: `test bookmark ${i}`,
        url: `https://bookmarks.example/${i}`,
        source: "bookmark",
      });
    }
    const restore = mockSuggest(items);
    settings.set({ maxResults: 10 });
    try {
      const input = openOmnibarPrompt(document);
      input.value = "test";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 10);
    } finally {
      settings.set({ maxResults: 50 });
      restore();
      Prompt.close();
    }
  });
});

test("omnibar without prefix shows tabs, history and bookmarks", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const restore = mockSuggest([YT_TAB, YT_HISTORY, YT_BOOKMARK]);
    try {
      const input = openOmnibarPrompt(document);
      input.value = "ytb";
      input.dispatch("input", {});
      await waitSuggest();
      // Search row plus one row per matching source.
      assert.equal(renderedRows(document), 4);
    } finally {
      restore();
      Prompt.close();
    }
  });
});

test("omnibar t prefix lists only tabs and Enter switches to the tab", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const sent = [];
    const restore = mockSuggest([YT_TAB, YT_HISTORY, YT_BOOKMARK], (m) =>
      sent.push(m),
    );
    try {
      const input = openOmnibarPrompt(document);
      input.value = "t ytb";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 1);
      Prompt.onKeyDown(keyEvent("Enter"));
      assert.deepEqual(
        sent.find((m) => m.action === "activateTab"),
        { action: "activateTab", id: 7 },
      );
    } finally {
      restore();
      Prompt.close();
    }
  });
});

test("omnibar t prefix with no match falls back to searching the stripped query", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const sent = [];
    const restore = mockSuggest([], (m) => sent.push(m));
    try {
      const input = openOmnibarPrompt(document);
      input.value = "t nothing-matches-this";
      input.dispatch("input", {});
      await waitSuggest();
      assert.equal(renderedRows(document), 0);
      Prompt.onKeyDown(keyEvent("Enter"));
      assert.deepEqual(
        sent.find((m) => m.action === "search"),
        {
          action: "search",
          query: "nothing-matches-this",
          newTab: true,
          incognito: false,
        },
      );
    } finally {
      restore();
      Prompt.close();
    }
  });
});

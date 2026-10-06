import "./setup.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert";
import { clampCount, handlers } from "../background/handlers.js";

test("clampCount bounds and normalizes the count", () => {
  assert.equal(clampCount(1), 1);
  assert.equal(clampCount(5), 5);
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount(-3), 1);
  assert.equal(clampCount(50), 20);
  assert.equal(clampCount(2.9), 2);
  assert.equal(clampCount(NaN), 1);
  assert.equal(clampCount(Infinity), 1);
});

const savedWindows = globalThis.chrome.windows;
const savedTabsCreate = globalThis.chrome.tabs.create;

afterEach(() => {
  if (savedWindows === undefined) delete globalThis.chrome.windows;
  else globalThis.chrome.windows = savedWindows;
  if (savedTabsCreate === undefined) delete globalThis.chrome.tabs.create;
  else globalThis.chrome.tabs.create = savedTabsCreate;
});

function stubChrome({ windows, onCreateTab, onCreateWindow, onUpdateWindow }) {
  globalThis.chrome.windows = {
    getAll: async () => windows,
    get: async () => ({ state: "normal" }),
    create: async (opts) => {
      onCreateWindow && onCreateWindow(opts);
      return { id: 30 };
    },
    update: async (...args) => {
      onUpdateWindow && onUpdateWindow(args);
    },
  };
  globalThis.chrome.tabs.create = async (opts) => {
    onCreateTab && onCreateTab(opts);
    return { id: 9 };
  };
}

test("openIncognitoTab reuses an existing incognito window", async () => {
  const created = [];
  const updated = [];
  stubChrome({
    windows: [
      { id: 1, incognito: false },
      { id: 2, incognito: true },
    ],
    onCreateTab: (opts) => created.push(opts),
    onUpdateWindow: (args) => updated.push(args),
  });
  const res = await handlers.openIncognitoTab({}, {});
  assert.deepEqual(res, { ok: true, id: 9 });
  assert.deepEqual(created, [{ windowId: 2, active: true }]);
  assert.deepEqual(updated, [
    [2, { focused: true }],
    [2, { state: "maximized" }],
  ]);
});

test("openIncognitoTab creates an incognito window when none exists", async () => {
  const createdTabs = [];
  const createdWindows = [];
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateTab: (opts) => createdTabs.push(opts),
    onCreateWindow: (opts) => createdWindows.push(opts),
  });
  const res = await handlers.openIncognitoTab({}, {});
  assert.deepEqual(res, { ok: true, id: 30 });
  assert.deepEqual(createdTabs, []);
  assert.deepEqual(createdWindows, [{ incognito: true, state: "maximized" }]);
});

test("search uses the configured default engine", async () => {
  const createdWindows = [];
  const savedGet = globalThis.chrome.storage.sync.get;
  globalThis.chrome.storage.sync.get = async () => ({
    settings: {
      searchEngines: [
        { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
        { keyword: "g", url: "https://www.google.com/search?q=%s" },
      ],
      defaultEngine: "ddg",
    },
  });
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateWindow: (opts) => createdWindows.push(opts),
  });
  try {
    const res = await handlers.search(
      {},
      { query: "hello world", newTab: true, incognito: true },
    );
    assert.deepEqual(res, { ok: true, id: 30 });
    assert.deepEqual(createdWindows, [
      {
        url: "https://duckduckgo.com/?q=hello%20world",
        incognito: true,
        state: "maximized",
      },
    ]);
  } finally {
    globalThis.chrome.storage.sync.get = savedGet;
  }
});

test("tab actions report failure without a sender tab", async () => {
  assert.deepEqual(await handlers.reloadTab({}, {}), { ok: false });
  assert.deepEqual(await handlers.goBack({}, {}), { ok: false });
  assert.deepEqual(await handlers.moveTabLeft({}, {}), { ok: false });
});

test("tab actions succeed with a sender tab", async () => {
  const calls = [];
  const savedTabs = globalThis.chrome.tabs;
  globalThis.chrome.tabs = {
    ...savedTabs,
    reload: async (id, opts) => {
      calls.push(["reload", id, opts]);
    },
    move: async (id, props) => {
      calls.push(["move", id, props]);
    },
    query: async () => [{ id: 4, index: 1 }],
    goBack: async (id) => {
      calls.push(["goBack", id]);
    },
  };
  try {
    assert.deepEqual(await handlers.reloadTab({ tab: { id: 7 } }, {}), { ok: true });
    assert.deepEqual(await handlers.goBack({ tab: { id: 7 } }, {}), { ok: true });
    assert.deepEqual(
      await handlers.moveTabLeft({ tab: { id: 7, index: 2 } }, {}),
      { ok: true },
    );
    assert.deepEqual(calls[0], ["reload", 7, { bypassCache: false }]);
  } finally {
    globalThis.chrome.tabs = savedTabs;
  }
});

test("goToFirstTab reports failure with no tabs", async () => {
  const savedTabs = globalThis.chrome.tabs;
  globalThis.chrome.tabs = { ...savedTabs, query: async () => [] };
  try {
    assert.deepEqual(await handlers.goToFirstTab({}, {}), { ok: false });
  } finally {
    globalThis.chrome.tabs = savedTabs;
  }
});

test("openExtensions opens the first creatable URL", async () => {
  const created = [];
  const savedCreate = globalThis.chrome.tabs.create;
  globalThis.chrome.tabs.create = async (opts) => {
    created.push(opts);
    return { id: 9 };
  };
  try {
    assert.deepEqual(await handlers.openExtensions({}, {}), { ok: true });
    assert.deepEqual(created, [{ url: "chrome://extensions" }]);
  } finally {
    if (savedCreate === undefined) delete globalThis.chrome.tabs.create;
    else globalThis.chrome.tabs.create = savedCreate;
  }
});

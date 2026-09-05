import "./setup.mjs";
import { test, afterEach } from "node:test";
import assert from "node:assert";
import { clampCount, handlers } from "../background/handlers.js";
import { suggestionSources } from "../shared/constants.js";

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

test("suggestion sources are the single shared source", () => {
  assert.deepEqual(suggestionSources, ["tab", "history", "bookmark"]);
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

test("openIncognitoTab rejects an invalid URL", async () => {
  let calls = 0;
  stubChrome({
    windows: [{ id: 2, incognito: true }],
    onCreateTab: () => calls++,
    onCreateWindow: () => calls++,
  });
  const res = await handlers.openIncognitoTab({}, { url: "http://" });
  assert.deepEqual(res, { ok: false });
  assert.equal(calls, 0);
});

test("search with incognito opens the search URL in an incognito window", async () => {
  const createdWindows = [];
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateWindow: (opts) => createdWindows.push(opts),
  });
  const res = await handlers.search(
    {},
    { query: "hello world", newTab: true, incognito: true },
  );
  assert.deepEqual(res, { ok: true, id: 30 });
  assert.deepEqual(createdWindows, [
    {
      url: "https://www.google.com/search?q=hello%20world",
      incognito: true,
      state: "maximized",
    },
  ]);
});

function stubSuggestChrome(maxResults) {
  const saved = {
    query: globalThis.chrome.tabs.query,
    history: globalThis.chrome.history,
    bookmarks: globalThis.chrome.bookmarks,
    storageGet: globalThis.chrome.storage.sync.get,
  };
  const settings = { suggestionSources: ["tab", "history", "bookmark"] };
  if (maxResults !== undefined) settings.maxResults = maxResults;
  globalThis.chrome.storage.sync.get = async () => ({ settings });
  globalThis.chrome.tabs.query = async () => [
    {
      id: 7,
      title: "lofi hip hop radio - YouTube",
      url: "https://www.youtube.com/watch?v=x",
      lastAccessed: 100,
    },
  ];
  globalThis.chrome.history = {
    // Chrome's own search is substring-only: nothing contains "ytb".
    search: async ({ text }) =>
      text
        ? []
        : [
            {
              title: "YouTube - Broadcast Yourself",
              url: "https://www.youtube.com/",
              visitCount: 50,
              lastVisitTime: 200,
              typedCount: 5,
            },
            { title: "Extra 1", url: "https://extra1.example", visitCount: 1 },
            { title: "Extra 2", url: "https://extra2.example", visitCount: 1 },
            { title: "Extra 3", url: "https://extra3.example", visitCount: 1 },
            { title: "Extra 4", url: "https://extra4.example", visitCount: 1 },
          ],
    getVisits: async () => [],
  };
  globalThis.chrome.bookmarks = {
    getTree: async () => [
      {
        id: "0",
        children: [
          {
            id: "1",
            title: "Music",
            children: [
              {
                id: "3",
                title: "YTB Fan Club",
                url: "https://fan.example",
                parentId: "1",
                dateAdded: 300,
              },
            ],
          },
        ],
      },
    ],
  };
  return () => {
    if (saved.query === undefined) delete globalThis.chrome.tabs.query;
    else globalThis.chrome.tabs.query = saved.query;
    if (saved.history === undefined) delete globalThis.chrome.history;
    else globalThis.chrome.history = saved.history;
    if (saved.bookmarks === undefined) delete globalThis.chrome.bookmarks;
    else globalThis.chrome.bookmarks = saved.bookmarks;
    globalThis.chrome.storage.sync.get = saved.storageGet;
  };
}

test("suggest keeps tab ids and pools recent history and all bookmarks for fuzzy matching", async () => {
  const restore = stubSuggestChrome();
  try {
    const res = await handlers.suggest({}, { query: "ytb" });
    const byUrl = new Map(res.map((item) => [item.url, item]));
    const tab = byUrl.get("https://www.youtube.com/watch?v=x");
    assert.ok(tab, "expected the open tab in results");
    assert.equal(tab.source, "tab");
    assert.equal(tab.id, 7);
    const history = byUrl.get("https://www.youtube.com/");
    assert.ok(history, "expected recent history despite no substring match");
    assert.equal(history.source, "history");
    const bookmark = byUrl.get("https://fan.example");
    assert.ok(bookmark, "expected the bookmark despite no substring match");
    assert.equal(bookmark.folderPath, "Music");
  } finally {
    restore();
  }
});

test("suggest caps results at the maxResults setting", async () => {
  const restore = stubSuggestChrome(5);
  try {
    const res = await handlers.suggest({}, { query: "ytb" });
    assert.equal(res.length, 5);
  } finally {
    restore();
  }
});
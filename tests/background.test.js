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

test("search without incognito uses the configured default engine, not chrome.search", async () => {
  const createdTabs = [];
  let searchCalls = 0;
  const savedGet = globalThis.chrome.storage.sync.get;
  const savedSearch = globalThis.chrome.search;
  globalThis.chrome.storage.sync.get = async () => ({
    settings: {
      searchEngines: [
        { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
        { keyword: "g", url: "https://www.google.com/search?q=%s" },
      ],
      defaultEngine: "ddg",
    },
  });
  globalThis.chrome.search = {
    query: async () => {
      searchCalls++;
      return {};
    },
  };
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateTab: (opts) => createdTabs.push(opts),
  });
  try {
    const res = await handlers.search(
      {},
      { query: "hello world", newTab: true, incognito: false },
    );
    assert.deepEqual(res, { ok: true });
    assert.equal(searchCalls, 0);
    assert.deepEqual(createdTabs, [
      { url: "https://duckduckgo.com/?q=hello%20world" },
    ]);
  } finally {
    globalThis.chrome.storage.sync.get = savedGet;
    if (savedSearch === undefined) delete globalThis.chrome.search;
    else globalThis.chrome.search = savedSearch;
  }
});

function stubSettingsStorage({ syncSettings, localSettings }) {
  const savedSync = globalThis.chrome.storage.sync.get;
  const savedLocal = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.sync.get = async () => ({ settings: syncSettings });
  globalThis.chrome.storage.local.get = async () => ({ settings: localSettings });
  return () => {
    globalThis.chrome.storage.sync.get = savedSync;
    globalThis.chrome.storage.local.get = savedLocal;
  };
}

const ddgEngines = [
  { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
  { keyword: "g", url: "https://www.google.com/search?q=%s" },
];

test("stored settings prefer newer local over stale sync", async () => {
  const createdTabs = [];
  const restoreSettings = stubSettingsStorage({
    syncSettings: { searchEngines: ddgEngines, defaultEngine: "g", updatedAt: 1000 },
    localSettings: { searchEngines: ddgEngines, defaultEngine: "ddg", updatedAt: 2000 },
  });
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateTab: (opts) => createdTabs.push(opts),
  });
  try {
    const res = await handlers.search(
      {},
      { query: "hello world", newTab: true, incognito: false },
    );
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(createdTabs, [
      { url: "https://duckduckgo.com/?q=hello%20world" },
    ]);
  } finally {
    restoreSettings();
  }
});

test("stored settings prefer newer sync when sync is fresher", async () => {
  const createdTabs = [];
  const restoreSettings = stubSettingsStorage({
    syncSettings: { searchEngines: ddgEngines, defaultEngine: "ddg", updatedAt: 3000 },
    localSettings: { searchEngines: ddgEngines, defaultEngine: "g", updatedAt: 2000 },
  });
  stubChrome({
    windows: [{ id: 1, incognito: false }],
    onCreateTab: (opts) => createdTabs.push(opts),
  });
  try {
    const res = await handlers.search(
      {},
      { query: "hello world", newTab: true, incognito: false },
    );
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(createdTabs, [
      { url: "https://duckduckgo.com/?q=hello%20world" },
    ]);
  } finally {
    restoreSettings();
  }
});

test("tab actions report failure without a sender tab", async () => {
  assert.deepEqual(await handlers.duplicateTab({}, {}), { ok: false });
  assert.deepEqual(await handlers.togglePin({}, {}), { ok: false });
  assert.deepEqual(await handlers.toggleMute({}, {}), { ok: false });
  assert.deepEqual(await handlers.reloadTab({}, {}), { ok: false });
  assert.deepEqual(await handlers.goBack({}, {}), { ok: false });
  assert.deepEqual(await handlers.moveTabLeft({}, {}), { ok: false });
});

test("tab actions succeed with a sender tab", async () => {
  const calls = [];
  const savedTabs = globalThis.chrome.tabs;
  globalThis.chrome.tabs = {
    ...savedTabs,
    duplicate: async (id) => {
      calls.push(["duplicate", id]);
    },
    update: async (id, props) => {
      calls.push(["update", id, props]);
    },
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
    assert.deepEqual(await handlers.duplicateTab({ tab: { id: 7 } }, {}), { ok: true });
    assert.deepEqual(
      await handlers.togglePin({ tab: { id: 7, pinned: false } }, {}),
      { ok: true },
    );
    assert.deepEqual(await handlers.reloadTab({ tab: { id: 7 } }, {}), { ok: true });
    assert.deepEqual(await handlers.goBack({ tab: { id: 7 } }, {}), { ok: true });
    assert.deepEqual(
      await handlers.moveTabLeft({ tab: { id: 7, index: 2 } }, {}),
      { ok: true },
    );
    assert.deepEqual(calls[0], ["duplicate", 7]);
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

test("restoreTab reports failure when sessions are unavailable", async () => {
  assert.deepEqual(await handlers.restoreTab({}, {}), { ok: false });
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

test("suggest reads settings from local storage when sync is empty", async () => {
  const saved = {
    query: globalThis.chrome.tabs.query,
    syncGet: globalThis.chrome.storage.sync.get,
    localGet: globalThis.chrome.storage.local.get,
    localSet: globalThis.chrome.storage.local.set,
  };
  globalThis.chrome.storage.sync.get = async () => ({});
  globalThis.chrome.storage.local.get = async () => ({
    settings: { maxResults: 7 },
  });
  globalThis.chrome.tabs.query = async () =>
    Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      windowId: 1,
      title: `Tab ${i}`,
      url: `https://example.com/${i}`,
      lastAccessed: i,
    }));
  try {
    const res = await handlers.suggest({}, { query: "" });
    assert.equal(res.length, 7);
  } finally {
    if (saved.query === undefined) delete globalThis.chrome.tabs.query;
    else globalThis.chrome.tabs.query = saved.query;
    globalThis.chrome.storage.sync.get = saved.syncGet;
    globalThis.chrome.storage.local.get = saved.localGet;
    globalThis.chrome.storage.local.set = saved.localSet;
  }
});

function stubBookmarks({ tree, found = [], created = [], removed = [] }) {
  const saved = globalThis.chrome.bookmarks;
  globalThis.chrome.bookmarks = {
    getTree: async () => tree,
    search: async () => found,
    create: async (entry) => {
      created.push(entry);
      return { id: "100", ...entry };
    },
    remove: async (id) => {
      removed.push(id);
    },
  };
  return () => {
    if (saved === undefined) delete globalThis.chrome.bookmarks;
    else globalThis.chrome.bookmarks = saved;
  };
}

const BAR_TREE = [
  {
    id: "0",
    title: "",
    children: [{ id: "1", title: "Bookmarks bar", children: [] }],
  },
];

test("toggleBookmark creates a bookmark on the bar", async () => {
  const created = [];
  const restore = stubBookmarks({ tree: BAR_TREE, created });
  try {
    const res = await handlers.toggleBookmark(
      {},
      { url: "https://example.com/", title: "Example" },
    );
    assert.deepEqual(res, { ok: true, bookmarked: true });
    assert.deepEqual(created, [
      { parentId: "1", title: "Example", url: "https://example.com/" },
    ]);
  } finally {
    restore();
  }
});

test("toggleBookmark removes every node already saved for the URL", async () => {
  const removed = [];
  const restore = stubBookmarks({
    tree: BAR_TREE,
    found: [
      { id: "7", url: "https://example.com/" },
      { id: "8", url: "https://example.com/" },
      { id: "9", url: "https://example.com/other" },
    ],
    removed,
  });
  try {
    const res = await handlers.toggleBookmark(
      {},
      { url: "https://example.com/", title: "Example" },
    );
    assert.deepEqual(res, { ok: true, bookmarked: false });
    assert.deepEqual(removed, ["7", "8"]);
  } finally {
    restore();
  }
});

test("toggleBookmark falls back to Other bookmarks without a bar", async () => {
  const created = [];
  const restore = stubBookmarks({
    tree: [
      {
        id: "0",
        title: "",
        children: [{ id: "2", title: "Other bookmarks", children: [] }],
      },
    ],
    created,
  });
  try {
    const res = await handlers.toggleBookmark(
      {},
      { url: "https://example.com/", title: "Example" },
    );
    assert.deepEqual(res, { ok: true, bookmarked: true });
    assert.equal(created[0].parentId, "2");
  } finally {
    restore();
  }
});

test("toggleBookmark understands the Firefox toolbar title", async () => {
  const created = [];
  const restore = stubBookmarks({
    tree: [
      {
        id: "root________",
        title: "",
        children: [
          { id: "toolbar_____", title: "Bookmarks Toolbar", children: [] },
        ],
      },
    ],
    created,
  });
  try {
    const res = await handlers.toggleBookmark(
      {},
      { url: "https://example.com/", title: "Example" },
    );
    assert.deepEqual(res, { ok: true, bookmarked: true });
    assert.equal(created[0].parentId, "toolbar_____");
  } finally {
    restore();
  }
});

test("toggleBookmark rejects unbookmarkable URLs and API failures", async () => {
  const created = [];
  const restore = stubBookmarks({ tree: BAR_TREE, created });
  try {
    assert.deepEqual(
      await handlers.toggleBookmark({}, { url: "chrome://extensions" }),
      { ok: false },
    );
    assert.deepEqual(created, []);
    globalThis.chrome.bookmarks.search = async () => {
      throw new Error("denied");
    };
    assert.deepEqual(
      await handlers.toggleBookmark({}, { url: "https://example.com/" }),
      { ok: false },
    );
  } finally {
    restore();
  }
});
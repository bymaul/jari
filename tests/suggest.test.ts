import "./setup.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import {
  clearBookmarkDataCache,
  clearSettingsCache,
  clearTabCache,
  suggest,
} from "../background/suggest.ts";

const chromeStubs = globalThis.chrome as unknown as Record<string, unknown>;
const tabsStubs = chromeStubs.tabs as Record<string, unknown>;

const tabListeners: Record<string, ((...args: unknown[]) => void)[]> = {};
for (const name of [
  "onCreated",
  "onUpdated",
  "onRemoved",
  "onMoved",
  "onActivated",
  "onAttached",
  "onDetached",
]) {
  tabListeners[name] = [];
  tabsStubs[name] = {
    addListener: (fn: (...args: unknown[]) => void) => {
      tabListeners[name].push(fn);
    },
  };
}

let tabQueryCalls = 0;
let tabRows: Record<string, unknown>[] = [];
tabsStubs.query = async () => {
  tabQueryCalls++;
  return tabRows.map((row) => ({ ...row }));
};

const storageListeners: ((...args: unknown[]) => void)[] = [];
(chromeStubs.storage as Record<string, unknown>).onChanged = {
  addListener: (fn: (...args: unknown[]) => void) => {
    storageListeners.push(fn);
  },
};

let storageGets = 0;
let storedDoc: unknown = {};
function stubStorage(doc: unknown): void {
  storedDoc = doc;
  const storage = chromeStubs.storage as Record<string, unknown>;
  for (const area of ["sync", "local"]) {
    (storage[area] as Record<string, unknown>).get = async () => {
      storageGets++;
      return { settings: structuredClone(storedDoc) };
    };
  }
}

let historyRows: Record<string, unknown>[] = [];
(chromeStubs as Record<string, unknown>).history = {
  search: async () => historyRows.map((row) => ({ ...row })),
};

const bmListeners: Record<string, () => void> = {};
function treeWith(url: string, title: string) {
  return [
    {
      id: "0",
      children: [
        {
          id: "1",
          title: "Bar",
          children: [{ id: "2", parentId: "1", title, url }],
        },
      ],
    },
  ];
}
let bmTree: unknown = [];
const bookmarksStubs = {
  getTree: async () => structuredClone(bmTree),
  search: async () => [],
  onCreated: {
    addListener(fn: () => void) {
      bmListeners.created = fn;
    },
  },
  onRemoved: {
    addListener(fn: () => void) {
      bmListeners.removed = fn;
    },
  },
  onChanged: {
    addListener(fn: () => void) {
      bmListeners.changed = fn;
    },
  },
  onMoved: {
    addListener(fn: () => void) {
      bmListeners.moved = fn;
    },
  },
};
(chromeStubs as Record<string, unknown>).bookmarks = bookmarksStubs;

beforeEach(() => {
  tabQueryCalls = 0;
  storageGets = 0;
  tabRows = [{ title: "Tab One", url: "https://tab.example/1", lastAccessed: 5 }];
  historyRows = [];
  bmTree = [];
  stubStorage({ suggestionSources: ["tab"], maxResults: 20 });
  clearTabCache();
  clearSettingsCache();
  clearBookmarkDataCache();
});

test("suggest queries tabs once across repeated calls", async () => {
  const first = await suggest({}, { query: "x" });
  const second = await suggest({}, { query: "xy" });
  assert.equal(tabQueryCalls, 1);
  assert.deepEqual(
    first.map((s) => s.title),
    ["Tab One"],
  );
  assert.deepEqual(
    second.map((s) => s.title),
    ["Tab One"],
  );
});

test("a tab event re-queries on the next suggest", async () => {
  await suggest({}, { query: "x" });
  assert.equal(tabQueryCalls, 1);
  tabRows = [{ title: "Tab Two", url: "https://tab.example/2", lastAccessed: 9 }];
  for (const fn of tabListeners.onCreated) fn();
  const res = await suggest({}, { query: "x" });
  assert.equal(tabQueryCalls, 2);
  assert.deepEqual(
    res.map((s) => s.title),
    ["Tab Two"],
  );
});

test("settings are read once until storage changes", async () => {
  await suggest({}, { query: "x" });
  await suggest({}, { query: "xy" });
  assert.equal(storageGets, 2);
  for (const fn of storageListeners) fn();
  await suggest({}, { query: "xyz" });
  assert.equal(storageGets, 4);
});

test("suggest merges tab and history rows", async () => {
  stubStorage({ suggestionSources: ["tab", "history"], maxResults: 20 });
  historyRows = [
    { title: "Hist", url: "https://hist.example/", visitCount: 3, lastVisitTime: 7 },
  ];
  const res = await suggest({}, { query: "x" });
  assert.deepEqual(
    res.map((s) => [s.title, s.source]),
    [
      ["Tab One", "tab"],
      ["Hist", "history"],
    ],
  );
});

test("bookmark suggestions refresh after a bookmark change", async () => {
  stubStorage({ suggestionSources: ["bookmark"], maxResults: 20 });
  bmTree = treeWith("https://alpha.example/", "Alpha");
  clearBookmarkDataCache();
  const first = await suggest({}, { query: "x" });
  assert.deepEqual(Object.keys(bmListeners).sort(), [
    "changed",
    "created",
    "moved",
    "removed",
  ]);
  assert.ok(first.some((item) => item.url === "https://alpha.example/"));
  // The tree changed but the cache stays warm until a bookmark event fires.
  bmTree = treeWith("https://beta.example/", "Beta");
  const stale = await suggest({}, { query: "x" });
  assert.ok(stale.some((item) => item.url === "https://alpha.example/"));
  assert.ok(!stale.some((item) => item.url === "https://beta.example/"));
  bmListeners.changed();
  const fresh = await suggest({}, { query: "x" });
  assert.ok(!fresh.some((item) => item.url === "https://alpha.example/"));
  assert.ok(fresh.some((item) => item.url === "https://beta.example/"));
});

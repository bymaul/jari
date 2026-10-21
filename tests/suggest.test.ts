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
let historyRecents: Record<string, unknown>[] = [];
(chromeStubs as Record<string, unknown>).history = {
  search: async (opts: { text?: string }) => {
    if (opts.text) {
      const q = String(opts.text).toLowerCase();
      return historyRows.filter((row) =>
        `${String(row.title || "")} ${String(row.url || "")}`.toLowerCase().includes(q),
      ).map((row) => ({ ...row }));
    }
    return historyRecents.map((row) => ({ ...row }));
  },
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
  historyRecents = [];
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

test("suggest keeps recent history in the pool for fuzzy ranking", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 20 });
  historyRows = [];
  historyRecents = [
    { title: "Facebook", url: "https://facebook.com/", visitCount: 8, lastVisitTime: 70 },
  ];
  const res = await suggest({}, { query: "facebok" });
  assert.ok(res.some((s) => s.url === "https://facebook.com/"));
});

test("suggest folds www, trailing slash and tracking params into one row", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 20 });
  historyRows = [
    {
      title: "Docs",
      url: "https://www.example.com/docs/?utm_source=news",
      visitCount: 2,
      lastVisitTime: 5,
    },
    {
      title: "Docs",
      url: "https://example.com/docs",
      visitCount: 3,
      lastVisitTime: 9,
    },
  ];
  const res = await suggest({}, { query: "docs" });
  const rows = res.filter((s) => s.url.includes("example.com/docs"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitCount, 5);
  assert.equal(rows[0].lastVisit, 9);
});

test("suggest keeps the open tab when history repeats the same page", async () => {
  stubStorage({ suggestionSources: ["tab", "history"], maxResults: 20 });
  tabRows = [
    { id: 7, title: "Tab One", url: "https://tab.example/", lastAccessed: 5 },
  ];
  historyRows = [
    {
      title: "Tab One",
      url: "https://tab.example/",
      visitCount: 4,
      lastVisitTime: 99,
    },
  ];
  const res = await suggest({}, { query: "x" });
  const tab = res.find((s) => s.source === "tab");
  assert.ok(tab);
  assert.equal(tab!.id, 7);
});

test("suggest folds google session tokens into one search row", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 20 });
  historyRows = [
    "APpeQnt7tnS99EhPcaDMw3ufFYHds2eqDOX3A1792574748164",
    "AQpeQnt7tnS99EhPcaDMw3ufFYHds2eqDOX3A1792574748164",
  ].map((token, i) => ({
    title: "prefix - Google Search",
    url: `https://www.google.com/search?q=prefix&aep=10&ntc=1&sxsrf=${token}&mstk=token${i}`,
    visitCount: 1,
    lastVisitTime: 100 - i,
  }));
  const res = await suggest({}, { query: "prefix" });
  const rows = res.filter((s) => s.url.includes("google.com/search"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitCount, 2);
});

test("suggest fuzzy-matches a recent page the literal search misses", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 20 });
  historyRows = []; // no literal match for "facebok"
  historyRecents = [
    { title: "Facebook", url: "https://www.facebook.com/", visitCount: 8, lastVisitTime: 70 },
  ];
  const res = await suggest({}, { query: "facebok" });
  assert.ok(res.some((s) => s.url === "https://www.facebook.com/"));
});


test("suggest returns the full pool without slicing to maxResults", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 5 });
  historyRows = [
    { title: "One", url: "https://one.example/", lastVisitTime: 1 },
    { title: "Two", url: "https://two.example/", lastVisitTime: 2 },
    { title: "Three", url: "https://three.example/", lastVisitTime: 3 },
  ];
  historyRecents = [
    { title: "Faces", url: "https://faces.example/", lastVisitTime: 4 },
  ];
  const res = await suggest({}, { query: "x" });
  assert.equal(
    res.some((s) => s.url === "https://faces.example/"),
    true,
  );
});

test("suggest collapses same-page history duplicates", async () => {
  stubStorage({ suggestionSources: ["history"], maxResults: 20 });
  historyRows = [1000, 2000].map((ts, i) => ({
    title: "prefix - Google Search",
    url: `https://www.google.com/search?q=prefix&sxsrf=token${i}`,
    visitCount: 1,
    lastVisitTime: ts,
  }));
  const res = await suggest({}, { query: "prefix" });
  const rows = res.filter((s) =>
    s.url.startsWith("https://www.google.com/search"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visitCount, 2);
  assert.equal(rows[0].lastVisit, 2000);
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

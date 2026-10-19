import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";

const listeners: Record<string, () => void> = {};
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

// Stub before importing so the module registers its invalidation listeners.
globalThis.chrome.tabs.query =
  (async () => []) as unknown as typeof globalThis.chrome.tabs.query;
globalThis.chrome.history = {
  search: async () => [],
} as unknown as typeof chrome.history;
globalThis.chrome.bookmarks = {
  getTree: async () => treeWith("https://alpha.example/", "Alpha"),
  search: async () => [],
  onCreated: {
    addListener(fn: () => void) {
      listeners.created = fn;
    },
  },
  onRemoved: {
    addListener(fn: () => void) {
      listeners.removed = fn;
    },
  },
  onChanged: {
    addListener(fn: () => void) {
      listeners.changed = fn;
    },
  },
  onMoved: {
    addListener(fn: () => void) {
      listeners.moved = fn;
    },
  },
} as unknown as typeof chrome.bookmarks;

const { suggest } = await import("../background/suggest.ts");

test("bookmark suggestions refresh after a bookmark change", async () => {
  assert.deepEqual(Object.keys(listeners).sort(), [
    "changed",
    "created",
    "moved",
    "removed",
  ]);
  const first = await suggest({}, { query: "x" });
  assert.ok(first.some((item) => item.url === "https://alpha.example/"));
  // The tree changed but the cache stays warm until a bookmark event fires.
  globalThis.chrome.bookmarks.getTree = (async () =>
    treeWith(
      "https://beta.example/",
      "Beta",
    )) as unknown as typeof globalThis.chrome.bookmarks.getTree;
  const stale = await suggest({}, { query: "x" });
  assert.ok(stale.some((item) => item.url === "https://alpha.example/"));
  assert.ok(!stale.some((item) => item.url === "https://beta.example/"));
  listeners.changed();
  const fresh = await suggest({}, { query: "x" });
  assert.ok(fresh.some((item) => item.url === "https://beta.example/"));
  assert.ok(!fresh.some((item) => item.url === "https://alpha.example/"));
});

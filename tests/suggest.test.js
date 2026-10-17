import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";

const listeners = {};
function treeWith(url, title) {
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
globalThis.chrome.tabs.query = async () => [];
globalThis.chrome.history = { search: async () => [] };
globalThis.chrome.bookmarks = {
  getTree: async () => treeWith("https://alpha.example/", "Alpha"),
  search: async () => [],
  onCreated: {
    addListener(fn) {
      listeners.created = fn;
    },
  },
  onRemoved: {
    addListener(fn) {
      listeners.removed = fn;
    },
  },
  onChanged: {
    addListener(fn) {
      listeners.changed = fn;
    },
  },
  onMoved: {
    addListener(fn) {
      listeners.moved = fn;
    },
  },
};

const { suggest } = await import("../background/suggest.js");

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
  globalThis.chrome.bookmarks.getTree = async () =>
    treeWith("https://beta.example/", "Beta");
  const stale = await suggest({}, { query: "x" });
  assert.ok(stale.some((item) => item.url === "https://alpha.example/"));
  assert.ok(!stale.some((item) => item.url === "https://beta.example/"));
  listeners.changed();
  const fresh = await suggest({}, { query: "x" });
  assert.ok(fresh.some((item) => item.url === "https://beta.example/"));
  assert.ok(!fresh.some((item) => item.url === "https://alpha.example/"));
});

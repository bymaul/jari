import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";

const { isSameSnapshot } = await import("../content/tab-manager.js");

function tab(over = {}) {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    title: "A",
    url: "https://a.example/",
    active: true,
    pinned: false,
    muted: false,
    audible: false,
    bookmarked: false,
    groupId: -1,
    lastAccessed: 111,
    ...over,
  };
}

function res(tabs, over = {}) {
  return { ok: true, tabs, groups: [], currentWindowId: 1, ...over };
}

const groups = new Map([[7, { title: "g", color: "blue" }]]);

function groupedRes(tabs, groupsList) {
  return res(tabs, { groups: groupsList });
}

test("identical snapshots compare equal regardless of order or recency", () => {
  const prev = [tab({ id: 1 }), tab({ id: 2, index: 1 })];
  const next = res([
    tab({ id: 2, index: 1, lastAccessed: 999 }),
    tab({ id: 1, lastAccessed: 222 }),
  ]);
  assert.equal(isSameSnapshot(prev, new Map(), 1, next), true);
});

test("tab field changes compare unequal", () => {
  const prev = [tab()];
  for (const over of [
    { title: "B" },
    { url: "https://b.example/" },
    { active: false },
    { pinned: true },
    { bookmarked: true },
  ]) {
    assert.equal(isSameSnapshot(prev, new Map(), 1, res([tab(over)])), false);
  }
});

test("added or removed tabs compare unequal", () => {
  assert.equal(
    isSameSnapshot([tab()], new Map(), 1, res([tab(), tab({ id: 2 })])),
    false,
  );
  assert.equal(isSameSnapshot([tab(), tab({ id: 2 })], new Map(), 1, res([tab()])), false);
});

test("group and window changes compare unequal", () => {
  const prev = [tab()];
  const base = groupedRes([tab()], [{ id: 7, title: "g", color: "blue" }]);
  assert.equal(isSameSnapshot(prev, groups, 1, base), true);
  assert.equal(
    isSameSnapshot(
      prev,
      groups,
      1,
      groupedRes([tab()], [{ id: 7, title: "renamed", color: "blue" }]),
    ),
    false,
  );
  assert.equal(isSameSnapshot(prev, groups, 1, { ...base, currentWindowId: 2 }), false);
});

test("missing tab lists compare unequal", () => {
  assert.equal(isSameSnapshot([tab()], new Map(), 1, { ok: true }), false);
  assert.equal(isSameSnapshot([tab()], new Map(), 1, null), false);
});

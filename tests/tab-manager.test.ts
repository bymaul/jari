import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import type { GroupSummary, ManagerTab } from "../shared/protocol.ts";

const { isSameSnapshot, prunedConfirm, confirmKey, stateTags } =
  await import("../content/tab-manager.ts");

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

function res(tabs: ManagerTab[], over: { groups?: GroupSummary[] } = {}) {
  return { ok: true, tabs, groups: [], currentWindowId: 1, ...over };
}

const groups = new Map([[7, { title: "g", color: "blue" }]]);

function groupedRes(tabs: ManagerTab[], groupsList: GroupSummary[]) {
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
  assert.equal(
    isSameSnapshot([tab(), tab({ id: 2 })], new Map(), 1, res([tab()])),
    false,
  );
});

test("group and window changes compare unequal", () => {
  const prev = [tab()];
  const base = groupedRes(
    [tab()],
    [{ id: 7, title: "g", color: "blue", collapsed: false }],
  );
  assert.equal(isSameSnapshot(prev, groups, 1, base), true);
  assert.equal(
    isSameSnapshot(
      prev,
      groups,
      1,
      groupedRes(
        [tab()],
        [{ id: 7, title: "renamed", color: "blue", collapsed: false }],
      ),
    ),
    false,
  );
  assert.equal(
    isSameSnapshot(prev, groups, 1, { ...base, currentWindowId: 2 }),
    false,
  );
});

test("missing tab lists compare unequal", () => {
  // isSameSnapshot's res type is the declared ManagerRes, but the runtime
  // contract is looser and these passes keep covering that branch.
  type IsSameRes = Parameters<typeof isSameSnapshot>[3];
  assert.equal(
    isSameSnapshot([tab()], new Map(), 1, { ok: true } as unknown as IsSameRes),
    false,
  );
  assert.equal(
    isSameSnapshot([tab()], new Map(), 1, null as unknown as IsSameRes),
    false,
  );
});

function confirmState(ids: number[]) {
  return { kind: "close", key: confirmKey(ids), ids, message: "confirm" };
}

test("stateTags tags the active tab of the current window as current", () => {
  const base = tab({ id: 1, windowId: 1, active: true });
  assert.deepEqual(stateTags(base, 1), ["current"]);
  assert.deepEqual(stateTags(base, 2), []);
  assert.deepEqual(
    stateTags(tab({ id: 2, windowId: 1, active: false, pinned: true }), 1),
    ["pin"],
  );
  assert.deepEqual(
    stateTags(tab({ id: 3, windowId: 1, active: true, pinned: true }), 1),
    ["current", "pin"],
  );
  assert.deepEqual(stateTags(tab({ active: false }), 1), []);
});

test("pruning leaves an untouched confirm alone", () => {
  const state = confirmState([1, 2]);
  assert.equal(prunedConfirm(state, [1, 2, 3]), state);
});

test("pruning recomputes the confirm key for surviving tabs", () => {
  const next = prunedConfirm(confirmState([1, 2, 3]), [1, 3]);
  assert.deepEqual(next?.ids, [1, 3]);
  assert.equal(next?.key, confirmKey([1, 3]));
  assert.match(next?.message || "", /close 2$/);
});

test("pruning drops the confirm when every target is gone", () => {
  assert.equal(prunedConfirm(confirmState([1, 2]), [3]), null);
  assert.equal(prunedConfirm(null, [1]), null);
});

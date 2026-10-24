import "./setup.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { HistoryNode } from "../background/history.ts";

const history = await import("../background/history.ts");
const { handlers } = await import("../background/handlers.ts");

const {
  applyCommit,
  emptyStore,
  linearizeTab,
  markGoto,
  pruneTab,
  serializeStore,
  deserializeStore,
  touchTitle,
  gotoPlan,
  ensureTab,
  flushSavesForTest,
} = history;

const chromeStubs = globalThis.chrome as unknown as Record<string, unknown>;
const savedTabs = chromeStubs.tabs;
const systemIdb = (globalThis as unknown as Record<string, unknown>).indexedDB;

beforeEach(() => {
  history.unloadStoreForTest();
  stubIdb();
});

afterEach(() => {
  history.unloadStoreForTest();
  chromeStubs.tabs = savedTabs;
  delete chromeStubs.webNavigation;
  (globalThis as unknown as Record<string, unknown>).indexedDB = systemIdb;
});

function senderTab(id: number) {
  return { tab: { id } } as unknown as chrome.runtime.MessageSender;
}

function commitEvent(url: string, over: Record<string, unknown> = {}) {
  return { tabId: 1, url, ...over };
}

function shape(rows: ReturnType<typeof linearizeTab>["rows"]) {
  return rows.map((row) => [row.title, row.depth, row.prefix, row.seq]);
}

test("first commit creates a root and points the tree at it", () => {
  const store = emptyStore();
  assert.equal(
    applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100),
    true,
  );
  const tree = store.tabs.get(1)!;
  assert.equal(store.seq, 1);
  assert.ok(tree.current !== null);
  const { rows } = linearizeTab(tree);
  assert.deepEqual(rows, [
    {
      id: rows[0].id,
      url: "https://a.example/a",
      title: "A",
      ts: 100,
      depth: 0,
      seq: 1,
      prefix: "",
    },
  ]);
});

test("repeated exact-URL commits refresh instead of branching", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100);
  applyCommit(store, commitEvent("https://a.example/a", { title: "A2" }), 200);
  const tree = store.tabs.get(1)!;
  assert.equal(tree.nodes.size, 1);
  const { rows } = linearizeTab(tree);
  assert.equal(rows[0].title, "A2");
  assert.equal(rows[0].ts, 200);
});

test("reloads refresh the current page without adding nodes", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isReload: true }),
    150,
  );
  assert.equal(store.tabs.get(1)!.nodes.size, 1);
  assert.equal(linearizeTab(store.tabs.get(1)!).rows[0].ts, 150);
});

test("hash and SPA moves are recorded as their own states", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://a.example/a#sec-2"), 200);
  applyCommit(store, commitEvent("https://a.example/a#sec-3"), 300);
  const { rows } = linearizeTab(store.tabs.get(1)!);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.url),
    [
      "https://a.example/a",
      "https://a.example/a#sec-2",
      "https://a.example/a#sec-3",
    ],
  );
});

test("an outbound visit from an older state branches instead of rewiring", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100);
  applyCommit(store, commitEvent("https://b.example/b", { title: "B" }), 200);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    300,
  );
  applyCommit(store, commitEvent("https://c.example/c", { title: "C" }), 400);
  const tree = store.tabs.get(1)!;
  assert.equal(tree.nodes.size, 3);
  const { rows, currentId } = linearizeTab(tree);
  assert.equal(currentId, rows[2].id);
  assert.deepEqual(shape(rows), [
    ["A", 0, "", 1],
    ["B", 1, "├─ ", 2],
    ["C", 1, "└─ ", 3],
  ]);
});

test("traversal back then forward moves the pointer over existing nodes", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    300,
  );
  applyCommit(
    store,
    commitEvent("https://b.example/b", { isHistoryTraversal: true }),
    400,
  );
  const tree = store.tabs.get(1)!;
  assert.equal(tree.nodes.size, 2);
  assert.equal(linearizeTab(tree).currentId, 2);
});

test("traversals without an adjacent match degrade into plain visits", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    200,
  );
  assert.equal(store.tabs.get(1)!.nodes.size, 1);
  assert.equal(linearizeTab(store.tabs.get(1)!).currentId, 1);
  applyCommit(
    store,
    commitEvent("https://uni.example/u", { isHistoryTraversal: true }),
    300,
  );
  assert.equal(store.tabs.get(1)!.nodes.size, 2);
});

test("linearization lays out glyphs for nested branches", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100);
  applyCommit(store, commitEvent("https://b.example/b", { title: "B" }), 200);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    300,
  );
  applyCommit(store, commitEvent("https://e.example/e", { title: "E" }), 400);
  applyCommit(
    store,
    commitEvent("https://b.example/b", { isHistoryTraversal: true }),
    500,
  );
  applyCommit(store, commitEvent("https://d.example/d", { title: "D" }), 600);
  const { rows, currentId } = linearizeTab(store.tabs.get(1)!);
  assert.deepEqual(shape(rows), [
    ["A", 0, "", 1],
    ["B", 1, "├─ ", 2],
    ["D", 2, "│  └─ ", 3],
    ["E", 1, "└─ ", 4],
  ]);
  assert.equal(currentId, rows[2].id);
});

test("markGoto plus commit points the tree without growing it", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  const tree = store.tabs.get(1)!;
  assert.equal(markGoto(store, 1, 1, 250), "https://a.example/a");
  assert.equal(tree.current, 2);
  assert.equal(store.pending.get(1)!.until > 250, true);
  applyCommit(store, commitEvent("https://a.example/a"), 300);
  assert.equal(tree.current, 1);
  assert.equal(tree.nodes.size, 2);
  assert.equal(store.pending.has(1), false);
});

test("goto markers survive redirect hops onto adjacent pages", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  markGoto(store, 1, 1, 250);
  applyCommit(store, commitEvent("https://b.example/b"), 300);
  const tree = store.tabs.get(1)!;
  assert.equal(tree.current, 2);
  assert.equal(tree.nodes.size, 2);
  assert.equal(store.pending.has(1), false);
});

test("stale goto markers decay into ordinary visits", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  markGoto(store, 1, 1, 100);
  applyCommit(store, commitEvent("https://a.example/a"), 100 + 5000 + 500);
  const tree = store.tabs.get(1)!;
  assert.equal(tree.nodes.size, 3);
  assert.equal(linearizeTab(tree).currentId !== tree.nodes.get(1)!.id, true);
  assert.equal(store.pending.has(1), false);
});

test("pruning keeps the pointer path and trims the oldest leaves", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b1.example/b"), 200);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    300,
  );
  applyCommit(store, commitEvent("https://b2.example/b"), 400);
  applyCommit(store, commitEvent("https://c.example/c"), 500);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    600,
  );
  applyCommit(store, commitEvent("https://b3.example/b"), 700);
  const tree = store.tabs.get(1)!;
  assert.equal(tree.current, 5);
  pruneTab(tree, 4);
  assert.equal(tree.nodes.size, 4);
  assert.equal(tree.nodes.has(2), false);
  assert.equal(tree.nodes.has(4), true);
  assert.equal(tree.current, 5);
  assert.deepEqual(
    linearizeTab(tree).rows.map((row) => row.url),
    [
      "https://a.example/a",
      "https://b2.example/b",
      "https://c.example/c",
      "https://b3.example/b",
    ],
  );
});

test("a pure current chain survives pruning", () => {
  const store = emptyStore();
  for (let i = 0; i < 5; i++) {
    applyCommit(store, commitEvent(`https://a.example/${i}`), i + 1);
  }
  const tree = store.tabs.get(1)!;
  pruneTab(tree, 2);
  assert.equal(tree.nodes.size, 5);
});

test("the spine tracks the native chain: pushes truncate, traversals re-anchor", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  applyCommit(store, commitEvent("https://c.example/c"), 300);
  const tree = store.tabs.get(1)!;
  assert.deepEqual(tree.spine, [1, 2, 3]);
  assert.equal(tree.spineAt, 2);

  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    400,
  );
  assert.equal(tree.spineAt, 0);
  assert.deepEqual(tree.spine, [1, 2, 3]);

  applyCommit(store, commitEvent("https://e.example/e"), 500);
  assert.deepEqual(tree.spine, [1, 4]);
  assert.equal(tree.spineAt, 1);

  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    600,
  );
  assert.equal(tree.spineAt, 0);

  assert.equal(tree.nodes.size, 4);
  assert.deepEqual(
    linearizeTab(tree).rows.map((row) => row.url),
    [
      "https://a.example/a",
      "https://b.example/b",
      "https://c.example/c",
      "https://e.example/e",
    ],
  );
});

test("pruning compacts the native spine and re-anchors it", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  applyCommit(store, commitEvent("https://c.example/c"), 300);
  const tree = store.tabs.get(1)!;
  applyCommit(
    store,
    commitEvent("https://b.example/b", { isHistoryTraversal: true }),
    400,
  );
  assert.equal(tree.spineAt, 1);
  pruneTab(tree, 2);
  assert.equal(tree.nodes.has(3), false);
  assert.deepEqual(tree.spine, [1, 2]);
  assert.equal(tree.spineAt, 1);
});

test("touchTitle backfills the matching node's title", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a"), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  assert.equal(touchTitle(store, 1, "https://a.example/a", "Alpha"), true);
  assert.equal(linearizeTab(store.tabs.get(1)!).rows[0].title, "Alpha");
  assert.equal(touchTitle(store, 1, "https://a.example/a", "Alpha"), false);
  assert.equal(touchTitle(store, 2, "https://a.example/a", "X"), false);
});

test("serialization round-trips trees and pending markers", () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100);
  applyCommit(store, commitEvent("https://b.example/b"), 200);
  applyCommit(
    store,
    commitEvent("https://a.example/a", { isHistoryTraversal: true }),
    300,
  );
  applyCommit(store, commitEvent("https://e.example/e"), 400);
  markGoto(store, 1, 2, 350);

  const restored = deserializeStore(serializeStore(store))!;
  assert.ok(restored);
  const tree = restored.tabs.get(1)!;
  const before = linearizeTab(store.tabs.get(1)!);
  const after = linearizeTab(tree);
  assert.deepEqual(after, before);
  assert.deepEqual(tree.spine, store.tabs.get(1)!.spine);
  assert.equal(tree.spineAt, store.tabs.get(1)!.spineAt);
  assert.equal(restored.pending.get(1)?.nodeId, 2);
  assert.equal(restored.pending.get(1)?.url, "https://b.example/b");
});

test("deserialization rejects foreign payload shapes", () => {
  assert.equal(deserializeStore(null), null);
  assert.equal(deserializeStore(undefined), null);
  assert.equal(deserializeStore({ v: 99 }), null);
  assert.equal(deserializeStore({ v: 2, seq: "x", tabs: [] }), null);
  assert.equal(
    deserializeStore({
      v: 2,
      seq: 2,
      tabs: [
        [
          1,
          {
            current: 3,
            nodes: [
              {
                id: 1,
                url: "https://a.example/",
                title: "",
                ts: 1,
                parent: null,
              },
              { id: 2, url: "https://b.example/", title: "", ts: 2, parent: 1 },
            ],
          },
        ],
      ],
    })!.tabs.get(1)!.current,
    null,
  );
  assert.equal(
    deserializeStore({
      v: 2,
      seq: 1,
      tabs: [
        [
          1,
          {
            current: 1,
            nodes: [
              {
                id: 1,
                url: "https://a.example/",
                title: "A",
                ts: 1,
                parent: null,
              },
            ],
          },
        ],
      ],
    })!.tabs.get(1)!.current,
    1,
  );
});

test("historyTreeList answers empty for unknown tabs and flatly fails without one", async () => {
  assert.deepEqual(await handlers.historyTreeList(senderTab(7)), {
    ok: true,
    rows: [],
    currentId: null,
  });
  assert.deepEqual(await handlers.historyTreeList({} as never), { ok: false });
});

test("historyTreeList serializes the tab's own tree", async () => {
  const store = emptyStore();
  applyCommit(store, commitEvent("https://a.example/a", { title: "A" }), 100);
  applyCommit(store, commitEvent("https://b.example/b", { title: "B" }), 200);
  stubIdb(serializeStore(store));
  const res = await handlers.historyTreeList(senderTab(1));
  assert.equal((res as { ok?: boolean }).ok, true);
  const rows = (
    res as unknown as { rows: Array<{ url: string; depth: number }> }
  ).rows;
  assert.deepEqual(
    rows.map((row) => row.url),
    ["https://a.example/a", "https://b.example/b"],
  );
  assert.equal(rows[0].depth, 0);
  assert.equal(rows[1].depth, 1);
});

function commitRequest(tabId: number, url: string, qualifiers: string[] = []) {
  return {
    frameId: 0,
    tabId,
    url,
    transitionType: "link",
    transitionQualifiers: qualifiers,
  };
}

function stubRecorderTabs(updates: unknown[]): void {
  chromeStubs.tabs = {
    ...(chromeStubs.tabs as object),
    update: async (...args: unknown[]) => {
      updates.push(args);
    },
  };
}

function stubRecorder(): (url: string, qualifiers?: string[]) => Promise<void> {
  const listeners: ((details: Record<string, unknown>) => void)[] = [];
  chromeStubs.webNavigation = {
    onCommitted: {
      addListener: (fn: (details: Record<string, unknown>) => void) => {
        listeners.push(fn);
      },
    },
  };
  history.initHistoryRecorder();
  return (url: string, qualifiers: string[] = []) => {
    listeners[0](commitRequest(1, url, qualifiers));
    return microtask();
  };
}

test("Enter on an in-chain node slides natively and keeps updates away", async () => {
  const updates: unknown[] = [];
  stubRecorderTabs(updates);
  const commit = stubRecorder();

  await commit("https://a.example/a");
  await commit("https://b.example/b");

  let res = await handlers.historyTreeGo(senderTab(1), { nodeId: 1 });
  assert.deepEqual(res, { ok: true, delta: -1 });
  assert.deepEqual(updates, []);

  await commit("https://a.example/a", ["forward_back"]);
  res = await handlers.historyTreeGo(senderTab(1), { nodeId: 2 });
  assert.deepEqual(res, { ok: true, delta: 1 });

  await commit("https://b.example/b", ["forward_back"]);
  const listed = await handlers.historyTreeList(senderTab(1));
  assert.equal((listed as { currentId?: number }).currentId, 2);
  await flushSavesForTest();
});

test("Enter loads off-chain nodes through tabs.update as before", async () => {
  const updates: unknown[] = [];
  const idb = stubIdb();
  stubRecorderTabs(updates);
  const commit = stubRecorder();

  await commit("https://a.example/a");
  await commit("https://b.example/b");
  await commit("https://c.example/c");
  await commit("https://a.example/a", ["forward_back"]);
  await commit("https://d.example/d");

  const res = await handlers.historyTreeGo(senderTab(1), { nodeId: 3 });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(updates, [[1, { url: "https://c.example/c" }]]);
  await commit("https://c.example/c");

  const listed = (await handlers.historyTreeList(senderTab(1))) as {
    currentId?: number;
  };
  assert.equal(listed.currentId, 3);

  await flushSavesForTest();
  const dump = idb.writes[idb.writes.length - 1] as {
    tabs: [number, { spine: number[]; spineAt: number }][];
  };
  const native = dump.tabs[0][1];
  assert.deepEqual(native.spine, [1, 4, 3]);
  assert.equal(native.spineAt, 2);
});

function microtask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("a stored snapshot rehydrates the tree from the indexed database", async () => {
  const fixture = emptyStore();
  applyCommit(fixture, commitEvent("https://a.example/a", { title: "A" }), 100);
  const idb = stubIdb(serializeStore(fixture));

  const listed = (await handlers.historyTreeList(senderTab(1))) as {
    rows: Array<{ url: string }>;
  };
  assert.deepEqual(
    listed.rows.map((row) => row.url),
    ["https://a.example/a"],
  );

  await flushSavesForTest();
  assert.ok(idb.writes.length >= 1);
  const dump = idb.writes[idb.writes.length - 1] as {
    tabs: [number, { nodes: Array<{ url: string }> }][];
  };
  assert.equal(dump.tabs[0][1].nodes[0].url, "https://a.example/a");
});

test("an unloadable database never overwrites persisted snapshots", async () => {
  const savedIdb = (globalThis as unknown as Record<string, unknown>).indexedDB;
  const probe: { opens: number } = { opens: 0 };
  try {
    (globalThis as unknown as Record<string, unknown>).indexedDB = {
      open: () => {
        probe.opens += 1;
        throw new Error("blocked");
      },
    };
    await flushSavesForTest();
    assert.equal(probe.opens, 1);

    await flushSavesForTest();
    assert.equal(probe.opens, 1);
  } finally {
    (globalThis as unknown as Record<string, unknown>).indexedDB = savedIdb;
  }
});

test("onStartup clears the indexed database", async () => {
  const starts: Array<() => void> = [];
  const savedRuntime = chromeStubs.runtime;
  const savedIdb = (globalThis as unknown as Record<string, unknown>).indexedDB;
  const idb = stubIdb();
  chromeStubs.runtime = {
    ...(chromeStubs.runtime as object),
    onStartup: {
      addListener: (fn: () => void) => {
        starts.push(fn);
      },
    },
  };

  try {
    history.initHistoryRecorder();
    assert.equal(starts.length, 1);
    void starts[0]();
    await microtask();
    await microtask();
    assert.ok(idb.clears >= 1);
  } finally {
    chromeStubs.runtime = savedRuntime;
    (globalThis as unknown as Record<string, unknown>).indexedDB = savedIdb;
  }
});

interface StubIdb {
  writes: unknown[];
  clears: number;
}

function stubIdb(initial: unknown = undefined): StubIdb {
  let data: unknown = initial;
  const record: StubIdb = { writes: [], clears: 0 };
  const makeRequest = (result: unknown, event?: unknown) => {
    const req = {
      result,
      onsuccess: null as null | ((ev: unknown) => void),
      onerror: null as null | ((ev: unknown) => void),
      onupgradeneeded: null as null | ((ev: unknown) => void),
    };
    queueMicrotask(() => {
      req.onupgradeneeded?.(event);
      req.onsuccess?.(event);
    });
    return req;
  };
  const storeObject = () => ({
    get: () => makeRequest(data),
    put: (value: unknown) => {
      record.writes.push(value);
      data = value;
      return makeRequest(undefined);
    },
    clear: () => {
      record.clears += 1;
      data = undefined;
      return makeRequest(undefined);
    },
  });
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    transaction: () => {
      const tx = {
        objectStore: storeObject,
        oncomplete: null as null | (() => void),
        onerror: null as null | ((ev: unknown) => void),
        onabort: null as null | ((ev: unknown) => void),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  (globalThis as unknown as Record<string, unknown>).indexedDB = {
    open: (name: string, version?: number) => {
      void name;
      void version;
      return makeRequest(database, { target: { result: database } });
    },
  };
  return record;
}

test("gotoPlan falls back to load when the native delta exceeds the window's history length", () => {
  const store = emptyStore();
  const at = (t: number) => (url: string) =>
    applyCommit(store, commitEvent(url), t);
  at(100)("https://a.example/a");
  at(101)("https://b.example/b");
  at(102)("https://c.example/c");

  const tree = store.tabs.get(1)!;
  // Back to the root: delta would be -2.
  assert.deepEqual(gotoPlan(store, 1, 1), {
    kind: "native",
    node: tree.nodes.get(1),
    delta: -2,
  });
  // delta out of reach for the reported window length -> must load instead.
  assert.deepEqual(gotoPlan(store, 1, 1, 2), {
    kind: "load",
    node: tree.nodes.get(1),
    url: "https://a.example/a",
  });
  // |delta| < length stays native.
  assert.deepEqual(gotoPlan(store, 1, 1, 3), {
    kind: "native",
    node: tree.nodes.get(1),
    delta: -2,
  });
  // Missing/invalid length keeps the previous behavior.
  assert.deepEqual(gotoPlan(store, 1, 1, 0), {
    kind: "native",
    node: tree.nodes.get(1),
    delta: -2,
  });
});

test("a mismatched traversal commit re-anchors to the nearest duplicate, not the oldest", () => {
  const store = emptyStore();
  const tree = ensureTab(store, 1);
  const node = (
    id: number,
    url: string,
    parent: number | null,
    children: number[],
  ): HistoryNode => ({
    id,
    url,
    title: "",
    ts: 0,
    parent,
    children,
  });
  // n4 is the nearest duplicate of the commit URL (1 hop), but the older n3
  // (2 hops) was inserted first — the old first-inserted pick was n3.
  tree.nodes.set(1, node(1, "https://a.example/a", null, [2, 4]));
  tree.nodes.set(2, node(2, "https://mid.example/mid", 1, [3]));
  tree.nodes.set(3, node(3, "https://dup.example/dup", 2, []));
  tree.nodes.set(4, node(4, "https://dup.example/dup", 1, []));
  tree.spine = [1, 2, 4];
  tree.spineAt = 1;
  tree.current = 2;

  // Enter on node 1 (native back), but the browser redirects and lands on the
  // duplicated URL instead of node 1's own URL.
  assert.ok(markGoto(store, 1, 1, 200));
  applyCommit(
    store,
    commitEvent("https://dup.example/dup", { isHistoryTraversal: true }),
    201,
  );
  assert.equal(tree.current, 4);
  // The spine got a plain push (node 4 appended), not a URL-based reanchor.
  assert.deepEqual(tree.spine, [1, 2, 4]);
  assert.equal(tree.spineAt, 2);

  // The next hop plan is computed from the pushed node, not a stale anchor.
  assert.deepEqual(gotoPlan(store, 1, 2), {
    kind: "native",
    node: tree.nodes.get(2),
    delta: -1,
  });
});

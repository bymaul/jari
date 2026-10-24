import "./setup.ts";
import { test, afterEach } from "node:test";
import assert from "node:assert";
import { clampCount, handlers } from "../background/handlers.ts";

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

// Whole-namespace swaps and deletes simulate unsupported browsers, so the
// chrome stub is written through a loose record while reads that need
// callability stay on the typed namespace.
const chromeStubs = globalThis.chrome as unknown as Record<string, unknown>;
function tabsStubs(): Record<string, unknown> {
  return chromeStubs.tabs as Record<string, unknown>;
}

const savedWindows = chromeStubs.windows;
const savedTabsCreate = tabsStubs().create;

afterEach(() => {
  if (savedWindows === undefined) delete chromeStubs.windows;
  else chromeStubs.windows = savedWindows;
  if (savedTabsCreate === undefined) delete tabsStubs().create;
  else tabsStubs().create = savedTabsCreate;
});

function stubChrome({
  windows,
  onCreateTab,
  onCreateWindow,
  onUpdateWindow,
}: {
  windows: unknown[];
  onCreateTab?: (opts: unknown) => void;
  onCreateWindow?: (opts: unknown) => void;
  onUpdateWindow?: (args: unknown) => void;
}): void {
  chromeStubs.windows = {
    getAll: async () => windows,
    get: async () => ({ state: "normal" }),
    create: async (opts: unknown) => {
      if (onCreateWindow) onCreateWindow(opts);
      return { id: 30 };
    },
    update: async (...args: unknown[]) => {
      if (onUpdateWindow) onUpdateWindow(args);
    },
  };
  tabsStubs().create = async (opts: unknown) => {
    if (onCreateTab) onCreateTab(opts);
    return { id: 9 };
  };
}

test("openIncognitoTab reuses an existing incognito window", async () => {
  const created: unknown[] = [];
  const updated: unknown[] = [];
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
  const createdTabs: unknown[] = [];
  const createdWindows: unknown[] = [];
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
  const createdWindows: unknown[] = [];
  const syncStubs = (chromeStubs.storage as Record<string, unknown>)
    .sync as Record<string, unknown>;
  const savedGet = syncStubs.get;
  syncStubs.get = async () => ({
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
    syncStubs.get = savedGet;
  }
});

test("tab actions report failure without a sender tab", async () => {
  assert.deepEqual(await handlers.reloadTab({}, {}), { ok: false });
  assert.deepEqual(await handlers.goBack({}), { ok: false });
  assert.deepEqual(await handlers.moveTabLeft({}), { ok: false });
});

test("tab actions succeed with a sender tab", async () => {
  const calls: unknown[] = [];
  const savedTabs = chromeStubs.tabs;
  chromeStubs.tabs = {
    ...(savedTabs as Record<string, unknown>),
    reload: async (id: unknown, opts: unknown) => {
      calls.push(["reload", id, opts]);
    },
    move: async (id: unknown, props: unknown) => {
      calls.push(["move", id, props]);
    },
    query: async () => [{ id: 4, index: 1 }],
    goBack: async (id: unknown) => {
      calls.push(["goBack", id]);
    },
  };
  try {
    assert.deepEqual(
      await handlers.reloadTab(
        { tab: { id: 7 } } as unknown as chrome.runtime.MessageSender,
        {},
      ),
      { ok: true },
    );
    assert.deepEqual(
      await handlers.goBack({
        tab: { id: 7 },
      } as unknown as chrome.runtime.MessageSender),
      { ok: true },
    );
    assert.deepEqual(
      await handlers.moveTabLeft({
        tab: { id: 7, index: 2 },
      } as unknown as chrome.runtime.MessageSender),
      { ok: true },
    );
    assert.deepEqual(calls[0], ["reload", 7, { bypassCache: false }]);
  } finally {
    chromeStubs.tabs = savedTabs;
  }
});

test("goToFirstTab reports failure with no tabs", async () => {
  const savedTabs = chromeStubs.tabs;
  chromeStubs.tabs = {
    ...(savedTabs as Record<string, unknown>),
    query: async () => [],
  };
  try {
    assert.deepEqual(await handlers.goToFirstTab(), { ok: false });
  } finally {
    chromeStubs.tabs = savedTabs;
  }
});

test("openExtensions opens the first creatable URL", async () => {
  const created: unknown[] = [];
  const savedCreate = tabsStubs().create;
  tabsStubs().create = async (opts: unknown) => {
    created.push(opts);
    return { id: 9 };
  };
  try {
    assert.deepEqual(await handlers.openExtensions(), { ok: true });
    assert.deepEqual(created, [{ url: "chrome://extensions" }]);
  } finally {
    if (savedCreate === undefined) delete tabsStubs().create;
    else tabsStubs().create = savedCreate;
  }
});

function stubWindowMove({
  allTabs,
  windows,
  onMove,
  onCreateWindow,
  onFocus,
  onGroup,
  groupList,
  onGroupUpdate,
  onRemove,
}: {
  allTabs: unknown[];
  windows: unknown[];
  onMove?: (ids: unknown, props: unknown) => void;
  onCreateWindow?: (opts: unknown) => void;
  onFocus?: (args: unknown) => void;
  onGroup?: (opts: unknown) => void;
  groupList?: unknown[];
  onGroupUpdate?: (args: unknown) => void;
  onRemove?: (ids: unknown) => void;
}): () => void {
  const savedTabs = chromeStubs.tabs;
  const savedWindows = chromeStubs.windows;
  const savedTabGroups = chromeStubs.tabGroups;
  chromeStubs.tabs = {
    ...(savedTabs as Record<string, unknown>),
    query: async () => allTabs,
    move: async (ids: unknown, props: unknown) => {
      if (onMove) onMove(ids, props);
    },
    update: async () => {},
    remove: async (ids: unknown) => {
      if (onRemove) onRemove(ids);
    },
    group: async (opts: unknown) => {
      if (onGroup) onGroup(opts);
      return 99;
    },
    ungroup: async () => {},
  };
  chromeStubs.windows = {
    getAll: async () => windows,
    get: async () => ({ state: "normal" }),
    create: async (opts: unknown) => {
      if (onCreateWindow) onCreateWindow(opts);
      return { id: 30 };
    },
    update: async (...args: unknown[]) => {
      if (onFocus) onFocus(args);
    },
  };
  chromeStubs.tabGroups = {
    query: async () => groupList || [],
    update: async (...args: unknown[]) => {
      if (onGroupUpdate) onGroupUpdate(args);
    },
  };
  return () => {
    chromeStubs.tabs = savedTabs;
    chromeStubs.windows = savedWindows;
    if (savedTabGroups === undefined) delete chromeStubs.tabGroups;
    else chromeStubs.tabGroups = savedTabGroups;
  };
}

test("moveManagerTabsToWindow splits when sources keep tabs", async () => {
  const created: unknown[] = [];
  const moved: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10 },
      { id: 3, windowId: 20 },
      { id: 4, windowId: 20 },
    ],
    windows: [],
    onMove: (ids, props) => moved.push([ids, props]),
    onCreateWindow: (opts) => created.push(opts),
  });
  try {
    const res = await handlers.moveManagerTabsToWindow({}, { ids: [1, 3] });
    assert.deepEqual(res, { ok: true, movedToNewWindow: true, moved: 2 });
    assert.deepEqual(created, [{ tabId: 1 }]);
    assert.deepEqual(moved, [[[3], { windowId: 30, index: -1 }]]);
  } finally {
    restore();
  }
});

test("moveManagerTabsToWindow merges into the lone survivor", async () => {
  const moved: unknown[] = [];
  const focused: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10 },
      { id: 3, windowId: 20 },
    ],
    windows: [
      { id: 10, tabs: [{ id: 1 }, { id: 2 }] },
      { id: 20, tabs: [{ id: 3, active: true, title: "Other" }] },
    ],
    onMove: (ids, props) => moved.push([ids, props]),
    onFocus: (args) => focused.push(args),
  });
  tabsStubs().query = async (opts?: { windowId?: number }) => {
    if (opts && opts.windowId === 20) return [{ id: 1 }, { id: 2 }, { id: 3 }];
    if (opts && opts.windowId !== undefined) return [];
    return [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10 },
      { id: 3, windowId: 20 },
    ];
  };
  try {
    const res = await handlers.moveManagerTabsToWindow({}, { ids: [1, 2] });
    assert.deepEqual(res, { ok: true, movedToWindow: true, moved: 2 });
    assert.deepEqual(moved, [[[1, 2], { windowId: 20, index: -1 }]]);
    assert.deepEqual(focused, [[20, { focused: true }]]);
  } finally {
    restore();
  }
});

test("moveManagerTabsToWindow offers a choice with several survivors", async () => {
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 20 },
      { id: 3, windowId: 30 },
    ],
    windows: [
      { id: 10, tabs: [{ id: 1 }] },
      { id: 20, tabs: [{ id: 2, active: true, title: "B" }] },
      { id: 30, tabs: [{ id: 3, active: true, title: "C" }] },
    ],
  });
  try {
    const res = (await handlers.moveManagerTabsToWindow(
      {},
      { ids: [1] },
    )) as unknown as {
      ok: boolean;
      needWindowChoice?: boolean;
      ownIds?: number[];
      tabs?: { length: number };
    };
    assert.equal(res.ok, true);
    assert.equal(res.needWindowChoice, true);
    assert.deepEqual(res.ownIds, [1]);
    assert.equal(res.tabs!.length, 2);
  } finally {
    restore();
  }
});

test("moveManagerTabsToWindow reports no other window", async () => {
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10 },
    ],
    windows: [{ id: 10, tabs: [{ id: 1 }, { id: 2 }] }],
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabsToWindow({}, { ids: [1, 2] }),
      {
        ok: true,
        needWindowChoice: false,
      },
    );
    assert.deepEqual(await handlers.moveManagerTabsToWindow({}, { ids: [] }), {
      ok: false,
    });
    assert.deepEqual(await handlers.moveManagerTabsToWindow({}, { ids: [9] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("moveManagerTabsIntoWindow moves into the chosen window", async () => {
  const moved: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [],
    windows: [],
    onMove: (ids, props) => moved.push([ids, props]),
  });
  tabsStubs().query = async (opts?: { windowId?: number }) => {
    if (opts && opts.windowId !== undefined) return [{ id: 5 }];
    return [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10 },
    ];
  };
  try {
    const res = await handlers.moveManagerTabsIntoWindow(
      {},
      { ids: [1, 2], targetWindowId: 20 },
    );
    assert.deepEqual(res, { ok: true, moved: 2 });
    assert.deepEqual(moved, [[[1, 2], { windowId: 20, index: -1 }]]);
    assert.deepEqual(
      await handlers.moveManagerTabsIntoWindow({}, { ids: [1] }),
      { ok: false },
    );
  } finally {
    restore();
  }
});

test("split regroups moved tabs with title and color", async () => {
  const grouped: unknown[] = [];
  const renamed: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10, groupId: 7 },
      { id: 2, windowId: 10, groupId: 7 },
      { id: 3, windowId: 10, groupId: -1 },
    ],
    windows: [],
    groupList: [{ id: 7, title: "Work", color: "blue" }],
    onGroup: (opts) => grouped.push(opts),
    onGroupUpdate: (args) => renamed.push(args),
  });
  try {
    const res = await handlers.moveManagerTabsToWindow({}, { ids: [1, 2] });
    assert.deepEqual(res, { ok: true, movedToNewWindow: true, moved: 2 });
    assert.deepEqual(grouped, [{ tabIds: [1, 2] }]);
    assert.deepEqual(renamed, [[99, { title: "Work", color: "blue" }]]);
  } finally {
    restore();
  }
});

test("merge regroups moved tabs in the target window", async () => {
  const grouped: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10, groupId: 7 },
      { id: 2, windowId: 20, groupId: -1 },
    ],
    windows: [
      { id: 10, tabs: [{ id: 1 }] },
      { id: 20, tabs: [{ id: 2, active: true, title: "Other" }] },
    ],
    groupList: [{ id: 7, title: "", color: "" }],
    onGroup: (opts) => grouped.push(opts),
  });
  tabsStubs().query = async (opts?: { windowId?: number }) => {
    if (opts && opts.windowId === 20) return [{ id: 2 }, { id: 1 }];
    if (opts && opts.windowId !== undefined) return [];
    return [
      { id: 1, windowId: 10, groupId: 7 },
      { id: 2, windowId: 20, groupId: -1 },
    ];
  };
  try {
    const res = await handlers.moveManagerTabsToWindow({}, { ids: [1] });
    assert.deepEqual(res, { ok: true, movedToWindow: true, moved: 1 });
    assert.deepEqual(grouped, [{ tabIds: [1] }]);
  } finally {
    restore();
  }
});

test("split still succeeds without group support", async () => {
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10, groupId: 7 },
      { id: 2, windowId: 10, groupId: 7 },
    ],
    windows: [],
  });
  delete tabsStubs().group;
  delete tabsStubs().ungroup;
  delete chromeStubs.tabGroups;
  try {
    assert.deepEqual(await handlers.moveManagerTabsToWindow({}, { ids: [1] }), {
      ok: true,
      movedToNewWindow: true,
      moved: 1,
    });
  } finally {
    restore();
  }
});

test("closeManagerTabs tolerates dead ids", async () => {
  const removed: unknown[] = [];
  const restore = stubWindowMove({
    allTabs: [{ id: 1, windowId: 10 }],
    windows: [],
    onRemove: (ids) => removed.push(ids),
  });
  try {
    const res = await handlers.closeManagerTabs({}, { ids: [1, 9] });
    assert.deepEqual(res, { ok: true, closed: 1 });
    assert.deepEqual(removed, [[1]]);
    assert.deepEqual(await handlers.closeManagerTabs({}, { ids: [9] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("group and ungroup tolerate dead ids", async () => {
  const restore = stubWindowMove({
    allTabs: [{ id: 1, windowId: 10, groupId: 7 }],
    windows: [],
  });
  try {
    assert.deepEqual(await handlers.groupManagerTabs({}, { ids: [1, 9] }), {
      ok: true,
      groupId: 99,
    });
    assert.deepEqual(await handlers.ungroupManagerTabs({}, { ids: [1, 9] }), {
      ok: true,
      ungrouped: 1,
    });
    assert.deepEqual(await handlers.groupManagerTabs({}, { ids: [9] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("moveManagerTabsIntoWindow reports a closed target", async () => {
  const restore = stubWindowMove({ allTabs: [], windows: [] });
  (chromeStubs.windows as Record<string, unknown>).get = async () => {
    throw new Error("gone");
  };
  try {
    assert.deepEqual(
      await handlers.moveManagerTabsIntoWindow(
        {},
        { ids: [1], targetWindowId: 20 },
      ),
      { ok: false, reason: "no-target" },
    );
  } finally {
    restore();
  }
});

test("window moves refuse incognito mixing", async () => {
  const restore = stubWindowMove({
    allTabs: [
      { id: 1, windowId: 10 },
      { id: 2, windowId: 20, incognito: true },
    ],
    windows: [
      { id: 10, tabs: [{ id: 1 }] },
      { id: 20, tabs: [{ id: 2 }] },
    ],
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabsToWindow({}, { ids: [1, 2] }),
      {
        ok: false,
        reason: "incognito",
      },
    );
    assert.deepEqual(
      await handlers.moveManagerTabsIntoWindow(
        {},
        { ids: [2], targetWindowId: 10 },
      ),
      { ok: false, reason: "incognito" },
    );
  } finally {
    restore();
  }
});

import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { handlers } from "../background/handlers.js";
import { bookmarkUrlKey } from "../background/bookmarks.js";

test("bookmarkUrlKey ignores trailing slashes and hashes", () => {
  assert.equal(bookmarkUrlKey("https://two.example/"), "https://two.example");
  assert.equal(bookmarkUrlKey("https://two.example"), "https://two.example");
  assert.equal(
    bookmarkUrlKey("https://two.example/page/#frag"),
    "https://two.example/page",
  );
  assert.equal(bookmarkUrlKey(""), "");
});

function stubTabs(impl) {
  const savedTabs = globalThis.chrome.tabs;
  const savedGroups = globalThis.chrome.tabGroups;
  globalThis.chrome.tabs = { ...(savedTabs || {}), ...impl };
  return () => {
    if (savedTabs === undefined) delete globalThis.chrome.tabs;
    else globalThis.chrome.tabs = savedTabs;
    if (savedGroups === undefined) delete globalThis.chrome.tabGroups;
    else globalThis.chrome.tabGroups = savedGroups;
  };
}

const MANAGER_TABS = [
  {
    id: 1,
    windowId: 1,
    index: 0,
    title: "One",
    url: "https://one.example/",
    active: true,
    pinned: false,
    mutedInfo: { muted: false },
    audible: false,
    groupId: -1,
    lastAccessed: 5,
  },
  {
    id: 2,
    windowId: 1,
    index: 1,
    title: "Two",
    url: "https://two.example/",
    active: false,
    pinned: true,
    mutedInfo: { muted: true },
    audible: true,
    groupId: 7,
    lastAccessed: 6,
  },
];

test("managerList maps tabs and groups", async () => {
  const restore = stubTabs({
    query: async () => MANAGER_TABS,
  });
  globalThis.chrome.tabGroups = {
    query: async () => [
      { id: 7, title: "Work", color: "blue", collapsed: false },
    ],
  };
  const savedBookmarks = globalThis.chrome.bookmarks;
  globalThis.chrome.bookmarks = {
    getTree: async () => [
      {
        id: "0",
        children: [
          {
            id: "1",
            title: "Bar",
            children: [
              {
                id: "3",
                title: "Two",
                url: "https://two.example",
                parentId: "1",
              },
            ],
          },
        ],
      },
    ],
  };
  try {
    const res = await handlers.managerList({}, {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.tabs, [
      {
        id: 1,
        windowId: 1,
        index: 0,
        title: "One",
        url: "https://one.example/",
        active: true,
        pinned: false,
        muted: false,
        audible: false,
        bookmarked: false,
        groupId: -1,
        lastAccessed: 5,
      },
      {
        id: 2,
        windowId: 1,
        index: 1,
        title: "Two",
        url: "https://two.example/",
        active: false,
        pinned: true,
        muted: true,
        audible: true,
        bookmarked: true,
        groupId: 7,
        lastAccessed: 6,
      },
    ]);
    assert.deepEqual(res.groups, [
      { id: 7, title: "Work", color: "blue", collapsed: false },
    ]);
  } finally {
    if (savedBookmarks === undefined) delete globalThis.chrome.bookmarks;
    else globalThis.chrome.bookmarks = savedBookmarks;
    restore();
  }
});

test("managerList reports the sender's window as current", async () => {
  const restore = stubTabs({ query: async () => MANAGER_TABS });
  try {
    const res = await handlers.managerList({ tab: { id: 1, windowId: 1 } }, {});
    assert.equal(res.currentWindowId, 1);
    const other = await handlers.managerList({ tab: { id: 2, windowId: 2 } }, {});
    assert.equal(other.currentWindowId, 2);
  } finally {
    restore();
  }
});

test("managerList falls back to the last focused window", async () => {
  const restore = stubTabs({ query: async () => MANAGER_TABS });
  const savedWindows = globalThis.chrome.windows;
  globalThis.chrome.windows = { getLastFocused: async () => ({ id: 9 }) };
  try {
    const res = await handlers.managerList({}, {});
    assert.equal(res.currentWindowId, 9);
  } finally {
    if (savedWindows === undefined) delete globalThis.chrome.windows;
    else globalThis.chrome.windows = savedWindows;
    restore();
  }
});

test("managerList reports no current window when it cannot tell", async () => {
  const restore = stubTabs({ query: async () => MANAGER_TABS });
  const savedWindows = globalThis.chrome.windows;
  globalThis.chrome.windows = {
    getLastFocused: async () => {
      throw new Error("denied");
    },
  };
  try {
    const res = await handlers.managerList({}, {});
    assert.equal(res.currentWindowId, null);
  } finally {
    if (savedWindows === undefined) delete globalThis.chrome.windows;
    else globalThis.chrome.windows = savedWindows;
    restore();
  }
});

test("managerList works without a groups API", async () => {
  const restore = stubTabs({ query: async () => MANAGER_TABS });
  delete globalThis.chrome.tabGroups;
  try {
    const res = await handlers.managerList({}, {});
    assert.equal(res.ok, true);
    assert.equal(res.tabs.length, 2);
    assert.deepEqual(res.groups, []);
  } finally {
    restore();
  }
});

test("closeManagerTabs removes exactly the valid ids", async () => {
  const removed = [];
  const restore = stubTabs({
    remove: async (ids) => {
      removed.push(ids);
    },
  });
  try {
    assert.deepEqual(
      await handlers.closeManagerTabs({}, { ids: [1, 2, 2, "x", null] }),
      { ok: true, closed: 2 },
    );
    assert.deepEqual(removed, [[1, 2]]);
    assert.deepEqual(await handlers.closeManagerTabs({}, { ids: [] }), {
      ok: false,
    });
    assert.deepEqual(await handlers.closeManagerTabs({}, {}), { ok: false });
  } finally {
    restore();
  }
});

test("setTabsPinned and setTabsMuted update every id", async () => {
  const updated = [];
  const restore = stubTabs({
    update: async (id, props) => {
      updated.push([id, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.setTabsPinned({}, { ids: [1, 2], pinned: true }),
      { ok: true, updated: 2, pinned: true },
    );
    assert.deepEqual(
      await handlers.setTabsMuted({}, { ids: [1], muted: false }),
      { ok: true, updated: 1, muted: false },
    );
    assert.deepEqual(updated, [
      [1, { pinned: true }],
      [2, { pinned: true }],
      [1, { muted: false }],
    ]);
    assert.deepEqual(await handlers.setTabsPinned({}, { ids: [] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("moveManagerTabs nudges a block without mixing pinned tabs", async () => {
  const moved = [];
  const restore = stubTabs({
    query: async () => [
      { id: 1, windowId: 1, index: 1, pinned: false },
      { id: 2, windowId: 1, index: 2, pinned: false },
      { id: 3, windowId: 1, index: 3, pinned: false },
      { id: 4, windowId: 1, index: 0, pinned: true },
    ],
    move: async (ids, props) => {
      moved.push([ids, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [1, 2], delta: 1 }),
      { ok: true, moved: 2 },
    );
    assert.deepEqual(moved, [
      [2, { index: 3 }],
      [1, { index: 2 }],
    ]);
    assert.deepEqual(await handlers.moveManagerTabs({}, { ids: [9], delta: 1 }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("moveManagerTabs offsets unpinned moves past pinned tabs", async () => {
  const moved = [];
  const restore = stubTabs({
    query: async () => [
      { id: 9, windowId: 1, index: 0, pinned: true },
      { id: 1, windowId: 1, index: 1, pinned: false },
      { id: 2, windowId: 1, index: 2, pinned: false },
      { id: 3, windowId: 1, index: 3, pinned: false },
    ],
    move: async (ids, props) => {
      moved.push([ids, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [1], delta: 1 }),
      { ok: true, moved: 1 },
    );
    assert.deepEqual(moved, [[1, { index: 2 }]]);
    moved.length = 0;
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [1], delta: -1 }),
      { ok: true, moved: 0 },
    );
    assert.deepEqual(moved, []);
  } finally {
    restore();
  }
});

test("moveManagerTabs nudges each marked tab one slot, even when scattered", async () => {
  const moved = [];
  const restore = stubTabs({
    query: async () => [
      { id: 1, windowId: 1, index: 0, pinned: false },
      { id: 2, windowId: 1, index: 1, pinned: false },
      { id: 3, windowId: 1, index: 2, pinned: false },
      { id: 4, windowId: 1, index: 3, pinned: false },
    ],
    move: async (ids, props) => {
      moved.push([ids, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [1, 3], delta: 1 }),
      { ok: true, moved: 2 },
    );
    assert.deepEqual(moved, [
      [3, { index: 3 }],
      [1, { index: 1 }],
    ]);
    moved.length = 0;
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [2, 4], delta: -1 }),
      { ok: true, moved: 2 },
    );
    assert.deepEqual(moved, [
      [2, { index: 0 }],
      [4, { index: 2 }],
    ]);
  } finally {
    restore();
  }
});

test("moveManagerTabs restores groups after moving marked tabs", async () => {
  const moved = [];
  const grouped = [];
  const restore = stubTabs({
    query: async () => [
      { id: 1, windowId: 1, index: 0, pinned: false, groupId: 7 },
      { id: 2, windowId: 1, index: 1, pinned: false, groupId: 7 },
      { id: 3, windowId: 1, index: 2, pinned: false, groupId: -1 },
    ],
    move: async (ids, props) => {
      moved.push([ids, props]);
    },
    group: async (opts) => {
      grouped.push(opts);
      return opts.groupId;
    },
    ungroup: async () => {},
  });
  try {
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [1, 2], delta: 1 }),
      { ok: true, moved: 2 },
    );
    assert.deepEqual(moved, [
      [2, { index: 2 }],
      [1, { index: 1 }],
    ]);
    assert.deepEqual(grouped, [{ tabIds: [1, 2], groupId: 7 }]);

    moved.length = 0;
    grouped.length = 0;
    assert.deepEqual(
      await handlers.moveManagerTabs({}, { ids: [3], delta: -1 }),
      { ok: true, moved: 1 },
    );
    assert.deepEqual(moved, [[3, { index: 1 }]]);
    assert.deepEqual(grouped, []);
  } finally {
    restore();
  }
});

test("groupManagerTabs creates and joins groups, or reports unsupported", async () => {
  const grouped = [];
  const restore = stubTabs({
    group: async (opts) => {
      grouped.push(opts);
      return 11;
    },
    ungroup: async () => {},
  });
  try {
    assert.deepEqual(await handlers.groupManagerTabs({}, { ids: [1, 2] }), {
      ok: true,
      groupId: 11,
    });
    assert.deepEqual(await handlers.groupManagerTabs({}, { ids: [1], groupId: 7 }), {
      ok: true,
      groupId: 11,
    });
    assert.deepEqual(grouped, [
      { tabIds: [1, 2] },
      { tabIds: [1], groupId: 7 },
    ]);
    assert.deepEqual(await handlers.ungroupManagerTabs({}, { ids: [1] }), {
      ok: true,
      ungrouped: 1,
    });
  } finally {
    restore();
  }
  const noGroups = stubTabs({ query: async () => [] });
  delete globalThis.chrome.tabGroups;
  delete globalThis.chrome.tabs.group;
  delete globalThis.chrome.tabs.ungroup;
  try {
    assert.deepEqual(await handlers.groupManagerTabs({}, { ids: [1] }), {
      ok: false,
      reason: "unsupported",
    });
    assert.deepEqual(await handlers.ungroupManagerTabs({}, { ids: [1] }), {
      ok: false,
      reason: "unsupported",
    });
    assert.deepEqual(await handlers.renameGroup({}, { groupId: 7, title: "x" }), {
      ok: false,
      reason: "unsupported",
    });
  } finally {
    noGroups();
  }
});

test("duplicateManagerTabs copies from the end so order is preserved", async () => {
  const calls = [];
  const activated = [];
  const restore = stubTabs({
    query: async (q) => (q && q.active ? [{ id: 42, windowId: 1 }] : []),
    duplicate: async (id) => {
      calls.push(id);
      return { id: id + 100, windowId: 1 };
    },
    update: async (id, props) => {
      activated.push([id, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.duplicateManagerTabs({}, { ids: [1, 2, 3] }),
      { ok: true, duplicated: 3, ids: [103, 102, 101] },
    );
    assert.deepEqual(calls, [3, 2, 1]);
    assert.deepEqual(activated, [[42, { active: true }]]);
    assert.deepEqual(
      await handlers.duplicateManagerTabs({}, { ids: [1, 1, "x"] }),
      { ok: true, duplicated: 1, ids: [101] },
    );
    assert.deepEqual(await handlers.duplicateManagerTabs({}, { ids: [] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("duplicateManagerTabs leaves the active tab alone when nothing moved", async () => {
  const activated = [];
  const restore = stubTabs({
    query: async (q) => (q && q.active ? [{ id: 5, windowId: 1 }] : []),
    duplicate: async (id) => ({ id, windowId: 1 }),
    update: async (id, props) => {
      activated.push([id, props]);
    },
  });
  try {
    assert.deepEqual(await handlers.duplicateManagerTabs({}, { ids: [5] }), {
      ok: true,
      duplicated: 1,
      ids: [5],
    });
    assert.deepEqual(activated, []);
  } finally {
    restore();
  }
});

test("editManagerTab normalizes the url and rejects unusable ones", async () => {
  const updated = [];
  const restore = stubTabs({
    update: async (id, props) => {
      updated.push([id, props]);
    },
  });
  try {
    assert.deepEqual(
      await handlers.editManagerTab({}, { id: 4, url: "example.com" }),
      { ok: true, url: "https://example.com" },
    );
    assert.deepEqual(updated, [[4, { url: "https://example.com" }]]);
    assert.deepEqual(await handlers.editManagerTab({}, { id: 4, url: "http://" }), {
      ok: false,
    });
    assert.deepEqual(await handlers.editManagerTab({}, { url: "example.com" }), {
      ok: false,
    });
    assert.equal(updated.length, 1);
  } finally {
    restore();
  }
});

test("renameGroup trims the title", async () => {
  const updated = [];
  const restore = stubTabs({});
  globalThis.chrome.tabGroups = {
    update: async (id, props) => {
      updated.push([id, props]);
    },
  };
  try {
    assert.deepEqual(
      await handlers.renameGroup({}, { groupId: 7, title: `  ${"x".repeat(200)}  ` }),
      { ok: true },
    );
    assert.equal(updated[0][0], 7);
    assert.equal(updated[0][1].title.length, 100);
    assert.deepEqual(await handlers.renameGroup({}, { title: "x" }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

test("bookmarkManagerTabs skips urls that are already saved", async () => {
  const created = [];
  const restore = stubBookmarks({ tree: BAR_TREE, created });
  globalThis.chrome.bookmarks.getTree = async () => [
    {
      id: "0",
      children: [
        {
          id: "1",
          title: "Bar",
          children: [{ id: "7", title: "A", url: "https://a.example" }],
        },
      ],
    },
  ];
  try {
    const res = await handlers.bookmarkManagerTabs(
      {},
      {
        tabs: [
          { url: "https://a.example/", title: "A" },
          { url: "https://b.example/", title: "B" },
        ],
      },
    );
    assert.deepEqual(res, { ok: true, saved: 1, skipped: 1 });
    assert.deepEqual(created, [
      { parentId: "1", title: "B", url: "https://b.example/" },
    ]);
  } finally {
    restore();
  }
});

test("unbookmarkManagerTabs removes every node matching the urls", async () => {
  const removed = [];
  const saved = globalThis.chrome.bookmarks;
  globalThis.chrome.bookmarks = {
    getTree: async () => [
      {
        id: "0",
        children: [
          {
            id: "1",
            title: "Bar",
            children: [
              { id: "7", title: "A", url: "https://a.example", parentId: "1" },
              { id: "8", title: "A dup", url: "https://a.example/", parentId: "1" },
              { id: "9", title: "B", url: "https://b.example/", parentId: "1" },
            ],
          },
        ],
      },
    ],
    remove: async (id) => {
      removed.push(id);
    },
  };
  try {
    assert.deepEqual(
      await handlers.unbookmarkManagerTabs(
        {},
        { tabs: [{ url: "https://a.example/#top", title: "A" }] },
      ),
      { ok: true, removed: 2, skipped: 0 },
    );
    assert.deepEqual(removed, ["8", "7"]);
    assert.deepEqual(
      await handlers.unbookmarkManagerTabs(
        {},
        { tabs: [{ url: "https://missing.example/", title: "Missing" }] },
      ),
      { ok: false, removed: 0, skipped: 1 },
    );
    assert.deepEqual(await handlers.unbookmarkManagerTabs({}, { tabs: [] }), {
      ok: false,
    });
  } finally {
    if (saved === undefined) delete globalThis.chrome.bookmarks;
    else globalThis.chrome.bookmarks = saved;
  }
});

function stubBookmarks({ tree, created = [] }) {
  const saved = globalThis.chrome.bookmarks;
  globalThis.chrome.bookmarks = {
    getTree: async () => tree,
    create: async (entry) => {
      created.push(entry);
      return { id: "100", ...entry };
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

test("bookmarkManagerTabs saves pages flat and skips the rest", async () => {
  const created = [];
  const restore = stubBookmarks({ tree: BAR_TREE, created });
  try {
    const res = await handlers.bookmarkManagerTabs(
      {},
      {
        tabs: [
          { url: "https://a.example/", title: "A" },
          { url: "https://a.example/", title: "A dupe" },
          { url: "chrome://extensions", title: "Blocked" },
        ],
      },
    );
    assert.deepEqual(res, { ok: true, saved: 1, skipped: 2 });
    assert.deepEqual(created, [
      { parentId: "1", title: "A", url: "https://a.example/" },
    ]);
    assert.deepEqual(await handlers.bookmarkManagerTabs({}, { tabs: [] }), {
      ok: false,
    });
  } finally {
    restore();
  }
});

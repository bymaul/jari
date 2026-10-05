import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import {
  TabManager,
  confirmKey,
  fieldState,
  pollState,
  decideSetState,
  filterManagerTabs,
  groupColorHex,
  needsCloseConfirm,
  sortManagerTabs,
  stateTags,
  targetsForAction,
} from "../content/tab-manager.js";

const TABS = [
  {
    id: 1,
    windowId: 1,
    index: 2,
    title: "GitHub - pull requests",
    url: "https://github.com/pulls",
    active: false,
    pinned: false,
    muted: false,
    audible: false,
    bookmarked: true,
    groupId: -1,
  },
  {
    id: 2,
    windowId: 1,
    index: 0,
    title: "Mail inbox",
    url: "https://mail.example/",
    active: true,
    pinned: true,
    muted: false,
    audible: true,
    groupId: 10,
  },
  {
    id: 3,
    windowId: 2,
    index: 0,
    title: "Docs",
    url: "https://docs.example/",
    active: false,
    pinned: false,
    muted: true,
    audible: false,
    groupId: -1,
  },
];

const GROUPS = [{ id: 10, title: "Work", color: "blue", collapsed: false }];

test("sortManagerTabs orders by window then index", () => {
  const sorted = sortManagerTabs(TABS);
  assert.deepEqual(
    sorted.map((tab) => tab.id),
    [2, 1, 3],
  );
  assert.equal(TABS[0].id, 1);
});

test("filterManagerTabs returns everything on an empty query", () => {
  const rows = sortManagerTabs(TABS);
  assert.deepEqual(filterManagerTabs(rows, ""), rows);
  assert.deepEqual(filterManagerTabs(rows, "   "), rows);
});

test("filterManagerTabs matches titles and urls", () => {
  const rows = sortManagerTabs(TABS);
  assert.deepEqual(
    filterManagerTabs(rows, "github").map((tab) => tab.id),
    [1],
  );
  assert.deepEqual(
    filterManagerTabs(rows, "docs.example").map((tab) => tab.id),
    [3],
  );
  assert.deepEqual(filterManagerTabs(rows, "no-such-tab-xyz"), []);
});

test("targetsForAction prefers marks in list order, else the focused tab", () => {
  const rows = sortManagerTabs(TABS);
  assert.deepEqual(
    targetsForAction(rows, new Set([3, 1]), 2).map((tab) => tab.id),
    [1, 3],
  );
  assert.deepEqual(
    targetsForAction(rows, new Set(), 1).map((tab) => tab.id),
    [1],
  );
  assert.deepEqual(targetsForAction(rows, new Set(), 999), []);
  assert.deepEqual(targetsForAction(rows, new Set([999]), 1), []);
});

test("needsCloseConfirm guards bulk closes only", () => {
  assert.equal(needsCloseConfirm([]), false);
  assert.equal(needsCloseConfirm([TABS[0]]), false);
  assert.equal(needsCloseConfirm([TABS[0], TABS[1]]), true);
});

test("decideSetState sets when anything is unset, clears when all are set", () => {
  assert.equal(decideSetState([TABS[0], TABS[1]], "pinned"), true);
  assert.equal(decideSetState([TABS[1]], "pinned"), false);
  assert.equal(decideSetState([TABS[2]], "muted"), false);
  assert.equal(decideSetState([TABS[0], TABS[2]], "muted"), true);
});

test("stateTags lists pin, mute/playing and bookmarked", () => {
  assert.deepEqual(stateTags(TABS[0]), ["bookmarked"]);
  assert.deepEqual(stateTags(TABS[1]), ["pin", "playing"]);
  assert.deepEqual(stateTags(TABS[2]), ["muted"]);
  assert.deepEqual(stateTags(null), []);
});

test("groupColorHex maps Chrome names to the muted palette", () => {
  assert.equal(groupColorHex("grey"), "#878787");
  assert.equal(groupColorHex("blue"), "#6e94b2");
  assert.equal(groupColorHex("red"), "#d8647e");
  assert.equal(groupColorHex("yellow"), "#fdbe7c");
  assert.equal(groupColorHex("green"), "#7fa563");
  assert.equal(groupColorHex("pink"), "#ed9daf");
  assert.equal(groupColorHex("purple"), "#97519c");
  assert.equal(groupColorHex("cyan"), "#aeaed1");
  assert.equal(groupColorHex("orange"), "#e0a363");
  assert.equal(groupColorHex("Blue"), "#6e94b2");
  assert.equal(groupColorHex("unknown"), "#888888");
  assert.equal(groupColorHex(null), "#888888");
});

test("manager highlights the window it was opened from, not tab index", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime((message) =>
      message.action === "managerList"
        ? { ok: true, tabs: TABS, groups: GROUPS, currentWindowId: 2 }
        : managerHandler(message),
    );
    try {
      await TabManager.open();
      const current = spansInRows(document, "jari-mgr-win")
        .filter((el) => el.classList.contains("jari-mgr-cur"))
        .map((el) => el.textContent);
      assert.deepEqual(current, ["W2"]);
      assert.ok(headerOf(document).textContent.includes("current W2"));
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("confirmKey is order-insensitive", () => {
  assert.equal(confirmKey([3, 1, 2]), confirmKey([1, 2, 3]));
  assert.notEqual(confirmKey([1, 2]), confirmKey([1, 3]));
});

function makeElement(tag) {
  const el = {
    tagName: tag,
    className: "",
    children: [],
    listeners: {},
    isConnected: true,
    style: {},
    attrs: {},
    value: "",
    _text: "",
    set textContent(value) {
      this._text = value;
      if (value === "") this.children.length = 0;
    },
    get textContent() {
      return this._text;
    },
    classList: {
      _set: new Set(),
      toggle(name, force) {
        if (force === undefined) {
          if (this._set.has(name)) this._set.delete(name);
          else this._set.add(name);
        } else if (force) this._set.add(name);
        else this._set.delete(name);
      },
      add(name) {
        this._set.add(name);
      },
      contains(name) {
        return this._set.has(name);
      },
    },
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    },
    appendChild(child) {
      this.children.push(child);
      child.parentEl = this;
      return child;
    },
    insertBefore(child, before) {
      const idx = this.children.indexOf(before);
      if (idx === -1) this.children.push(child);
      else this.children.splice(idx, 0, child);
      child.parentEl = this;
      return child;
    },
    remove() {
      this.isConnected = false;
      const parent = this.parentEl;
      if (parent) {
        parent.children = parent.children.filter((c) => c !== this);
        this.parentEl = null;
      }
    },
    focus() {
      document.activeElement = this;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    scrollIntoView() {},
  };
  el.attachShadow = () => {
    el.shadowRoot = {
      children: [],
      activeElement: null,
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
    return el.shadowRoot;
  };
  el.shadowRoot = null;
  return el;
}

function makeDocument() {
  const created = [];
  return {
    created,
    activeElement: null,
    hidden: false,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type];
      if (!list) return;
      this.listeners[type] = list.filter((entry) => entry !== fn);
    },
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement: (tag) => {
      const el = makeElement(tag);
      created.push(el);
      return el;
    },
    createTextNode: (text) => ({ text, nodeType: 3 }),
    createDocumentFragment: () => {
      const frag = {
        children: [],
        appendChild(child) {
          this.children.push(child);
          return child;
        },
      };
      return frag;
    },
  };
}

async function withDocument(document, fn) {
  const previous = globalThis.document;
  const previousCurrent = currentDocument;
  globalThis.document = document;
  currentDocument = document;
  try {
    await fn();
  } finally {
    globalThis.document = previous;
    currentDocument = previousCurrent;
  }
}

function keyEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...modifiers,
  };
}

function stubRuntime(handler) {
  const sent = [];
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => {
    sent.push(message);
    callback(handler(message, sent));
  };
  return {
    sent,
    restore() {
      chrome.runtime.sendMessage = original;
    },
  };
}

function managerHandler(message) {
  switch (message.action) {
    case "managerList":
      return { ok: true, tabs: TABS, groups: GROUPS, currentWindowId: 1 };
    case "closeManagerTabs":
      return { ok: true, closed: message.ids.length };
    case "setTabsPinned":
      return { ok: true, updated: message.ids.length, pinned: message.pinned };
    case "unbookmarkManagerTabs":
      return { ok: true, removed: 1, skipped: 0 };
    case "duplicateManagerTabs":
      return { ok: true, duplicated: message.ids.length, ids: [99] };
    case "editManagerTab":
      return { ok: true, url: message.url };
    default:
      return { ok: true };
  }
}

let currentDocument = null;

function fieldElOf(document) {
  const inputs = document.created.filter(
    (el) => el.tagName === "input" && el.className === "jari-prompt-input",
  );
  return inputs.length > 0 ? inputs[inputs.length - 1] : null;
}

function setOpenFieldValue(text) {
  const input = fieldElOf(currentDocument);
  assert.ok(input, "expected the url field to be open");
  input.value = text;
  return fieldState().text;
}

function rowsOf(document) {
  const ul = document.created.find((el) => el.tagName === "ul");
  return ul ? ul.children : [];
}

function spansOf(document, cls) {
  return document.created.filter(
    (el) => el.tagName === "span" && el.className === cls,
  );
}

function fieldTextOf(document) {
  const input = fieldElOf(document);
  return input ? input.value : null;
}

function collectSpans(el, cls, out) {
  for (const child of el.children || []) {
    if (child.tagName === "span" && child.className === cls) out.push(child);
    collectSpans(child, cls, out);
  }
}

function spansInRows(document, cls) {
  const out = [];
  for (const li of rowsOf(document)) collectSpans(li, cls, out);
  return out;
}

function footerText(document) {
  return footerLines(document).join("\n");
}

function footerLines(document) {
  const footer = footerOf(document);
  if (!footer) return [];
  return footer.children.map((child) => child.textContent);
}

function headerOf(document) {
  return document.created.find(
    (el) => el.tagName === "div" && el.className === "jari-prompt-header",
  );
}

function footerOf(document) {
  return document.created.find(
    (el) => el.tagName === "div" && el.className === "jari-prompt-footer",
  );
}

test("open renders every tab with the active tab selected", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      assert.equal(TabManager.isActive(), true);
      assert.equal(rowsOf(document).length, 3);
      assert.ok(headerOf(document).textContent.includes("current W1"));
      const wins = spansInRows(document, "jari-mgr-win").map(
        (el) => el.textContent,
      );
      assert.deepEqual(wins, ["W1", "W1", "W2"]);
      const current = spansInRows(document, "jari-mgr-win").filter((el) =>
        el.classList.contains("jari-mgr-cur"),
      );
      assert.deepEqual(
        current.map((el) => el.textContent),
        ["W1", "W1"],
      );
      const groups = spansInRows(document, "jari-mgr-group").map(
        (el) => el.textContent,
      );
      assert.deepEqual(groups, ["/Work"]);
      const tags = spansOf(document, "jari-mgr-tag").map(
        (el) => el.textContent,
      );
      assert.deepEqual(tags, ["[pin] [playing]", "[bookmarked]", "[muted]"]);
      TabManager.onKeyDown(keyEvent("Enter"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "activateTab"),
        { action: "activateTab", id: 2 },
      );
      assert.equal(TabManager.isActive(), false);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("Space marks rows with a tint and d asks twice for a bulk close", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("2 marked"));
      const markedRows = rowsOf(document).filter((li) =>
        li.classList.contains("marked"),
      );
      assert.equal(markedRows.length, 2);
      TabManager.onKeyDown(keyEvent("d"));
      assert.ok(
        footerText(document).includes("Press d again"),
        "expected a confirm prompt",
      );
      assert.ok(
        !runtime.sent.some((m) => m.action === "closeManagerTabs"),
        "expected no close before confirm",
      );
      TabManager.onKeyDown(keyEvent("d"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "closeManagerTabs"),
        { action: "closeManagerTabs", ids: [2, 1] },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("a single close needs no confirm and p toggles the pin", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("d"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "closeManagerTabs"),
        { action: "closeManagerTabs", ids: [2] },
      );
      TabManager.onKeyDown(keyEvent("p"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "setTabsPinned"),
        { action: "setTabsPinned", ids: [2], pinned: false },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("J and K reorder, H no longer moves anything", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("J"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "moveManagerTabs"),
        { action: "moveManagerTabs", ids: [2], delta: 1 },
      );
      TabManager.onKeyDown(keyEvent("K"));
      assert.deepEqual(
        runtime.sent.filter((m) => m.action === "moveManagerTabs").pop(),
        { action: "moveManagerTabs", ids: [2], delta: -1 },
      );
      const moves = runtime.sent.filter((m) => m.action === "moveManagerTabs").length;
      TabManager.onKeyDown(keyEvent("H"));
      TabManager.onKeyDown(keyEvent("L"));
      assert.equal(
        runtime.sent.filter((m) => m.action === "moveManagerTabs").length,
        moves,
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("closing keeps the cursor where the tab used to be", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("k"));
      TabManager.onKeyDown(keyEvent("k"));
      assert.deepEqual(fieldState(), null);
      const beforeClose = rowsOf(document).findIndex((li) =>
        li.classList.contains("selected"),
      );
      assert.equal(beforeClose, 1);
      const shrunk = stubRuntime(() => ({
        ok: true,
        tabs: TABS.filter((tab) => tab.id !== 3),
        groups: GROUPS,
        currentWindowId: 1,
      }));
      try {
        document.hidden = false;
        for (const fn of document.listeners.visibilitychange || []) fn();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        shrunk.restore();
      }
      const rows = rowsOf(document);
      assert.equal(rows.length, 2);
      const index = rows.findIndex((li) => li.classList.contains("selected"));
      assert.equal(index, 1, "expected the cursor to stay at the last row");
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("b adds missing bookmarks and removes them once all are saved", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("b"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "bookmarkManagerTabs"),
        {
          action: "bookmarkManagerTabs",
          tabs: [
            { url: "https://mail.example/", title: "Mail inbox" },
            { url: "https://github.com/pulls", title: "GitHub - pull requests" },
          ],
        },
      );

      const allSaved = stubRuntime(() => ({
        ok: true,
        tabs: TABS.map((tab) => ({ ...tab, bookmarked: true })),
        groups: GROUPS,
        currentWindowId: 1,
      }));
      try {
        document.hidden = false;
        for (const fn of document.listeners.visibilitychange || []) fn();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        allSaved.restore();
      }
      assert.ok(
        headerOf(document).textContent.includes("0 marked"),
        "expected marks to be consumed after bookmarking",
      );
      TabManager.onKeyDown(keyEvent("k"));
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("b"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "unbookmarkManagerTabs"),
        {
          action: "unbookmarkManagerTabs",
          tabs: [
            { url: "https://mail.example/", title: "Mail inbox" },
            { url: "https://github.com/pulls", title: "GitHub - pull requests" },
          ],
        },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("bulk actions clear the marks they acted on", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("2 marked"));
      TabManager.onKeyDown(keyEvent("p"));
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(headerOf(document).textContent.includes("0 marked"));
      assert.equal(
        rowsOf(document).filter((li) => li.classList.contains("marked")).length,
        0,
        "expected no rows left marked",
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("Space toggles the mark under the cursor without moving", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("1 marked"));
      assert.equal(rowsOf(document)[0].classList.contains("selected"), true);
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("0 marked"));
      assert.equal(
        rowsOf(document)[0].classList.contains("selected"),
        true,
        "expected the cursor to stay put when unmarking",
      );
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("1 marked"));
      assert.equal(rowsOf(document)[1].classList.contains("selected"), true);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("v anchors a range that paints and shrinks as you move", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("v"));
      assert.ok(headerOf(document).textContent.includes("(visual)"));
      assert.ok(headerOf(document).textContent.includes("1 marked"));
      assert.equal(
        rowsOf(document)[0].classList.contains("selected"),
        true,
        "expected v to anchor in place",
      );
      TabManager.onKeyDown(keyEvent("j"));
      assert.ok(headerOf(document).textContent.includes("2 marked"));
      assert.ok(headerOf(document).textContent.includes("(visual)"));
      TabManager.onKeyDown(keyEvent("j"));
      assert.ok(headerOf(document).textContent.includes("3 marked"));
      TabManager.onKeyDown(keyEvent("k"));
      assert.ok(headerOf(document).textContent.includes("2 marked"));
      TabManager.onKeyDown(keyEvent("v"));
      assert.ok(!headerOf(document).textContent.includes("(visual)"));
      assert.ok(headerOf(document).textContent.includes("2 marked"));
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("Escape clears marks before closing the manager", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      assert.ok(headerOf(document).textContent.includes("1 marked"));
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.ok(
        headerOf(document).textContent.includes("0 marked"),
        "expected the first Escape to clear the mark",
      );
      assert.equal(TabManager.isActive(), true);
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.equal(TabManager.isActive(), false);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("Escape drops the visual anchor before clearing the filter", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("/"));
      const input = fieldElOf(document);
      input.value = "docs";
      input.dispatch("input", {});
      TabManager.onKeyDown(keyEvent("Enter"));
      TabManager.onKeyDown(keyEvent("v"));
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.ok(!headerOf(document).textContent.includes("(visual)"));
      assert.ok(headerOf(document).textContent.includes("/docs"));
      assert.equal(TabManager.isActive(), true);
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.ok(!headerOf(document).textContent.includes("/docs"));
      assert.equal(TabManager.isActive(), true);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("? toggles between the minimal and full footer hints", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      const minimal = footerText(document);
      assert.ok(minimal.includes("? more"));
      assert.ok(!minimal.includes("y duplicate"));
      TabManager.onKeyDown(keyEvent("?"));
      const full = footerText(document);
      assert.ok(full.includes("? less"));
      assert.ok(full.includes("y duplicate"));
      assert.ok(full.includes("J/K reorder"));
      assert.equal(footerLines(document).length, 2);
      TabManager.onKeyDown(keyEvent("?"));
      assert.equal(footerText(document), minimal);
      TabManager.onKeyDown(keyEvent("/"));
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.ok(
        footerText(document).includes("? more"),
        "expected the minimal hints to stay collapsed",
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("t reveals an in-panel url field that keeps the manager open", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      assert.equal(fieldState(), null);
      const before = document.createElement("input");
      before.isConnected = true;
      document.activeElement = before;
      TabManager.onKeyDown(keyEvent("t"));
      assert.deepEqual(fieldState(), { kind: "open", text: "" });
      assert.equal(TabManager.isActive(), true);
      const input = fieldElOf(document);
      assert.ok(input, "expected a native input row");
      assert.equal(input.placeholder, "Open URL or search...");
      assert.equal(input.attrs.maxlength, "500");
      assert.equal(document.activeElement, input);
      assert.ok(footerText(document).includes("in the background"));
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.equal(fieldState(), null);
      assert.equal(TabManager.isActive(), true);
      assert.equal(document.activeElement, before, "expected page focus back");
      assert.ok(
        !runtime.sent.some(
          (m) =>
            m.action === "openInBackgroundTab" || m.action === "search",
        ),
        "expected nothing opened on cancel",
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("t field leaves ordinary keys to the input and only claims Enter/Esc", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      const pageInput = document.createElement("input");
      pageInput.isConnected = true;
      document.activeElement = pageInput;
      TabManager.onKeyDown(keyEvent("t"));
      const input = fieldElOf(document);
      assert.equal(document.activeElement, input);
      input.value = "abc def";
      assert.equal(TabManager.onKeyDown(keyEvent("j")), false);
      assert.equal(TabManager.onKeyDown(keyEvent("Backspace")), false);
      assert.equal(TabManager.onKeyDown(keyEvent("ArrowLeft")), false);
      assert.equal(fieldState().text, "abc def");
      const composing = keyEvent("Enter");
      composing.isComposing = true;
      assert.equal(TabManager.onKeyDown(composing), false);
      assert.equal(fieldState().kind, "open");
      assert.ok(
        !runtime.sent.some(
          (m) =>
            m.action === "openInBackgroundTab" || m.action === "search",
        ),
        "expected typing to send nothing",
      );
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.equal(document.activeElement, pageInput);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("t field submits a url in the background without closing", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("t"));
      setOpenFieldValue("example.com");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "openInBackgroundTab"),
        { action: "openInBackgroundTab", url: "https://example.com" },
      );
      assert.ok(!runtime.sent.some((m) => m.action === "search"));
      assert.equal(TabManager.isActive(), true);
      assert.equal(fieldState(), null);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("t field searches plain terms and honors engine keywords", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("t"));
      setOpenFieldValue("some random query");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "search"),
        {
          action: "search",
          query: "some random query",
          newTab: true,
          incognito: false,
          background: true,
        },
      );

      TabManager.onKeyDown(keyEvent("t"));
      setOpenFieldValue("yt lofi");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.filter((m) => m.action === "openInBackgroundTab").pop(),
        {
          action: "openInBackgroundTab",
          url: "https://www.youtube.com/results?search_query=lofi",
        },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("t field ignores an empty submit", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("t"));
      setOpenFieldValue("   ");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(
        !runtime.sent.some(
          (m) =>
            m.action === "openInBackgroundTab" || m.action === "search",
        ),
        "expected nothing opened for a blank field",
      );
      assert.equal(TabManager.isActive(), true);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("y duplicates marked tabs and keeps the manager open", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("a"));
      TabManager.onKeyDown(keyEvent("y"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "duplicateManagerTabs"),
        { action: "duplicateManagerTabs", ids: [2, 1, 3] },
      );
      assert.equal(TabManager.isActive(), true);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("e edits the focused tab url through the shared text field", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("e"));
      assert.deepEqual(fieldState(), {
        kind: "url",
        text: "https://mail.example/",
      });
      assert.equal(
        fieldTextOf(document),
        "https://mail.example/",
        "expected the url in the field row",
      );
      assert.ok(headerOf(document).textContent.includes("(editing url)"));
      setOpenFieldValue("https://mail.example//changed");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "editManagerTab"),
        {
          action: "editManagerTab",
          id: 2,
          url: "https://mail.example//changed",
        },
      );
      assert.equal(TabManager.isActive(), true);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("e cancels on Escape without touching the tab", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("e"));
      setOpenFieldValue("https://mail.example/x");
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.ok(!runtime.sent.some((m) => m.action === "editManagerTab"));
      assert.equal(TabManager.isActive(), true);
      assert.equal(fieldState(), null);
      assert.ok(footerText(document).includes("? more"));
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("r renames the group in the plain input field", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("r"));
      assert.deepEqual(fieldState(), { kind: "group", text: "Work" });
      assert.equal(fieldTextOf(document), "Work");
      assert.equal(fieldElOf(document).placeholder, "Group name");
      assert.ok(headerOf(document).textContent.includes("(renaming group)"));
      setOpenFieldValue("Work!");
      TabManager.onKeyDown(keyEvent("Enter"));
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "renameGroup"),
        { action: "renameGroup", groupId: 10, title: "Work!" },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("B no longer has a binding of its own", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("B"));
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(
        !runtime.sent.some(
          (m) => m.action === "bookmarkManagerTabs" || m.action === "unbookmarkManagerTabs",
        ),
        "expected B to be unbound now that b toggles",
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("/ filters through the input, Enter keeps it, Escape clears", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent("/"));
      const input = fieldElOf(document);
      assert.ok(input, "expected the filter input");
      assert.equal(input.placeholder, "Filter tabs");
      assert.deepEqual(fieldState(), { kind: "filter", text: "" });
      assert.ok(headerOf(document).textContent.includes("(filtering)"));
      input.value = "docs";
      input.dispatch("input", {});
      assert.equal(rowsOf(document).length, 1);
      TabManager.onKeyDown(keyEvent("Enter"));
      assert.equal(fieldState(), null);
      assert.equal(rowsOf(document).length, 1, "Enter keeps the filter");
      assert.ok(headerOf(document).textContent.includes("/docs"));
      TabManager.onKeyDown(keyEvent("/"));
      assert.deepEqual(fieldState(), { kind: "filter", text: "docs" });
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.equal(rowsOf(document).length, 3);
      assert.equal(fieldState(), null);
      assert.equal(TabManager.isActive(), true);
      TabManager.onKeyDown(keyEvent("Escape"));
      assert.equal(TabManager.isActive(), false);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("a poll drops marked tabs that vanished and repairs the close confirm", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(() => ({ ok: true, tabs: TABS, groups: GROUPS }));
    try {
      await TabManager.open();
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("j"));
      TabManager.onKeyDown(keyEvent(" "));
      TabManager.onKeyDown(keyEvent("d"));
      assert.ok(footerText(document).includes("Press d again"));
      const shrunk = TABS.filter((tab) => tab.id !== 1);
      const late = stubRuntime(() => ({
        ok: true,
        tabs: shrunk,
        groups: GROUPS,
        currentWindowId: 1,
      }));
      try {
        document.hidden = false;
        for (const fn of document.listeners.visibilitychange || []) fn();
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        late.restore();
      }
      assert.equal(headerOf(document).textContent.includes("1 marked"), true);
      assert.ok(footerText(document).includes("press d again to close 1"));
      TabManager.onKeyDown(keyEvent("d"));
      assert.deepEqual(
        runtime.sent.find((m) => m.action === "closeManagerTabs"),
        { action: "closeManagerTabs", ids: [2] },
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("pollState reports polling only while open", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      assert.deepEqual(pollState(), {
        active: false,
        polling: false,
        refreshing: false,
      });
      await TabManager.open();
      assert.deepEqual(pollState(), {
        active: true,
        polling: true,
        refreshing: false,
      });
      TabManager.close();
      assert.deepEqual(pollState(), {
        active: false,
        polling: false,
        refreshing: false,
      });
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("visibilitychange refreshes when the tab comes back", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      const before = runtime.sent.filter(
        (m) => m.action === "managerList",
      ).length;
      document.hidden = true;
      for (const fn of document.listeners.visibilitychange || []) fn();
      document.hidden = false;
      for (const fn of document.listeners.visibilitychange || []) fn();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(
        runtime.sent.filter((m) => m.action === "managerList").length,
        before + 1,
      );
      TabManager.close();
      assert.equal((document.listeners.visibilitychange || []).length, 0);
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

test("manager floats centered with a backdrop and header on top", async () => {
  const document = makeDocument();
  await withDocument(document, async () => {
    const runtime = stubRuntime(managerHandler);
    try {
      await TabManager.open();
      const backdrop = document.created.find(
        (el) =>
          el.tagName === "div" && el.className === "jari-manager-backdrop",
      );
      assert.ok(backdrop, "expected a dismiss backdrop");
      const panel = document.created.find(
        (el) =>
          el.tagName === "div" && el.className === "jari-overlay jari-prompt",
      );
      assert.deepEqual(
        panel.children.map((child) => child.className),
        ["jari-prompt-header", "jari-prompt-list", "jari-prompt-footer"],
      );
    } finally {
      runtime.restore();
      TabManager.close();
    }
  });
});

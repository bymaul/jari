import "./setup.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert";

const { settings } = await import("../content/settings.js");
const { genLabels, normalizeCharset, __testHelpers } = await import("../content/hints.js");
const { HINT_CHARSET_DEFAULT, keymapDefaults } = await import("../content/keymap.js");
const { ui } = await import("../content/ui.js");

const {
  isExplicitlyRequested,
  filterAncestors,
  prioritizeForViewport,
  translateRect,
  getHintRect,
  collectIframeElements,
  getHref,
  isOpenableLink,
  isOwnMutation,
} = __testHelpers;

function assertPrefixFree(labels) {
  assert.equal(new Set(labels).size, labels.length, "labels must be unique");
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      if (i !== j) {
        assert.ok(
          !labels[j].startsWith(labels[i]),
          `prefix conflict: ${labels[i]} is a prefix of ${labels[j]}`,
        );
      }
    }
  }
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
    clickableSelector: "",
  });
});

test("genLabels returns single chars when count fits the charset", () => {
  assert.deepEqual(genLabels(3, "abc"), ["A", "B", "C"]);
  assert.deepEqual(genLabels(1, "ab"), ["A"]);
});

test("genLabels rejects empty counts and degenerate charsets", () => {
  assert.deepEqual(genLabels(0, "abc"), []);
  assert.deepEqual(genLabels(-1, "abc"), []);
  assert.deepEqual(genLabels(5, "a"), []);
});

test("genLabels is prefix-free across hint counts", () => {
  for (const count of [2, 5, 12, 13, 26, 50, 100, 200, 500]) {
    assertPrefixFree(genLabels(count, HINT_CHARSET_DEFAULT));
  }
});

test("genLabels is prefix-free for small charsets", () => {
  for (const count of [2, 3, 5, 10, 30]) {
    assertPrefixFree(genLabels(count, "ab"));
  }
});

test("normalizeCharset falls back to the shared default", () => {
  assert.equal(normalizeCharset(), HINT_CHARSET_DEFAULT);
});

test("isExplicitlyRequested honors the custom clickable selector", () => {
  assert.equal(isExplicitlyRequested({ matches: () => true }), false);
  settings.set({ clickableSelector: "div.card" });
  assert.equal(isExplicitlyRequested({ matches: (s) => s === "div.card" }), true);
  assert.equal(isExplicitlyRequested({ matches: () => false }), false);
  settings.set({ clickableSelector: "[" });
  assert.equal(
    isExplicitlyRequested({
      matches: () => {
        throw new Error("invalid selector");
      },
    }),
    false,
  );
  settings.set({ clickableSelector: "" });
});

function fakeNode(tagName) {
  let kids = [];
  return {
    tagName,
    href: undefined,
    shadowRoot: null,
    matches: () => false,
    setKids(k) {
      kids = k;
    },
    contains(other) {
      return other !== this && kids.includes(other);
    },
  };
}

test("filterAncestors keeps explicitly requested descendants", () => {
  const parent = fakeNode("DIV");
  const child = fakeNode("SPAN");
  parent.setKids([child]);
  assert.equal(filterAncestors([parent, child]).length, 1);
  settings.set({ clickableSelector: "span" });
  child.matches = (s) => s === "span";
  assert.equal(filterAncestors([parent, child]).length, 2);
  settings.set({ clickableSelector: "" });
});

function withViewport(w, h, fn) {
  const hadW = "innerWidth" in globalThis.window;
  const hadH = "innerHeight" in globalThis.window;
  const savedW = globalThis.window.innerWidth;
  const savedH = globalThis.window.innerHeight;
  globalThis.window.innerWidth = w;
  globalThis.window.innerHeight = h;
  try {
    fn();
  } finally {
    if (hadW) globalThis.window.innerWidth = savedW;
    else delete globalThis.window.innerWidth;
    if (hadH) globalThis.window.innerHeight = savedH;
    else delete globalThis.window.innerHeight;
  }
}

function fakeHintEl(rect) {
  return {
    childElementCount: 2,
    getBoundingClientRect: () => rect,
  };
}

test("prioritizeForViewport ranks visible center first", () => {
  withViewport(800, 600, () => {
    const center = fakeHintEl({ left: 390, top: 290, right: 410, bottom: 310, width: 20, height: 20 });
    const edge = fakeHintEl({ left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 });
    const off = fakeHintEl({ left: 900, top: 100, right: 950, bottom: 150, width: 50, height: 50 });
    assert.deepEqual(prioritizeForViewport([off, edge, center]), [center, edge, off]);
  });
});

test("translateRect shifts rects and getHintRect prefers stored rects", () => {
  assert.deepEqual(
    translateRect({ left: 1, top: 2, right: 3, bottom: 4, width: 2, height: 2 }, 10, 20),
    { left: 11, top: 22, right: 13, bottom: 24, width: 2, height: 2 },
  );
  const el = {
    _jariViewportRect: { left: 1 },
    childElementCount: 2,
    getBoundingClientRect: () => ({ left: 9 }),
  };
  assert.equal(getHintRect(el).left, 1);
  delete el._jariViewportRect;
  assert.equal(getHintRect(el).left, 9);
});

test("collectIframeElements finds same-origin frame links", () => {
  const savedQS = globalThis.document.querySelectorAll;
  const savedGCS = globalThis.window.getComputedStyle;
  withViewport(800, 600, () => {
    globalThis.window.getComputedStyle = () => ({
      opacity: "1",
      cursor: "default",
      visibility: "visible",
      display: "block",
    });
    const innerRect = { left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 };
    const innerLink = {
      nodeType: 1,
      tagName: "A",
      isConnected: true,
      disabled: false,
      readOnly: false,
      ownerDocument: null,
      matches: (s) => s === "[href]",
      getAttribute: (n) => (n === "href" ? "/a" : null),
      getBoundingClientRect: () => innerRect,
      closest: () => null,
      contains: (o) => o === innerLink,
      getRootNode: () => ({ host: null }),
    };
    const innerDoc = {
      body: { querySelectorAll: () => [innerLink] },
      URL: "https://inner.example/page",
      querySelectorAll: () => [innerLink],
      elementFromPoint: () => innerLink,
    };
    innerLink.ownerDocument = innerDoc;
    const frame = {
      nodeType: 1,
      tagName: "IFRAME",
      matches: () => true,
      shadowRoot: null,
      closest: () => null,
      contentDocument: innerDoc,
      clientLeft: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({
        left: 50, top: 100, right: 450, bottom: 500, width: 400, height: 400,
      }),
    };
    globalThis.document.querySelectorAll = () => [frame];
    try {
      const found = collectIframeElements("open");
      assert.equal(found.length, 1);
      assert.equal(found[0], innerLink);
      assert.deepEqual(getHintRect(innerLink), {
        left: 60, top: 120, right: 160, bottom: 140, width: 100, height: 20,
      });
    } finally {
      if (savedQS === undefined) delete globalThis.document.querySelectorAll;
      else globalThis.document.querySelectorAll = savedQS;
      if (savedGCS === undefined) delete globalThis.window.getComputedStyle;
      else globalThis.window.getComputedStyle = savedGCS;
    }
  });
});

test("dispatchHover emits hover events without focusing or scrolling", () => {
  const hadMouseEvent = "MouseEvent" in globalThis;
  const savedMouseEvent = globalThis.MouseEvent;
  globalThis.MouseEvent = class {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  try {
    const seen = [];
    const el = {
      dispatchEvent: (e) => seen.push(e.type),
      focus: () => seen.push("focus"),
    };
    ui.dispatchHover(el);
    assert.deepEqual(seen, ["pointerover", "mouseover", "mouseenter", "pointerenter"]);
  } finally {
    if (hadMouseEvent) globalThis.MouseEvent = savedMouseEvent;
    else delete globalThis.MouseEvent;
  }
});

function fakeAnchor(rawHref, resolvedHref, extra = {}) {
  return {
    getAttribute: (name) => (name === "href" ? rawHref : null),
    href: resolvedHref,
    ...extra,
  };
}

test("getHref drops fragment-only and empty links", () => {
  assert.equal(getHref(fakeAnchor("#", "https://current.example/page#")), null);
  assert.equal(getHref(fakeAnchor("", "https://current.example/page")), null);
  assert.equal(getHref(fakeAnchor("   ", "https://current.example/page")), null);
});

test("getHref keeps resolved URLs and honors the iframe base", () => {
  assert.equal(
    getHref(fakeAnchor("/docs/a", "https://current.example/docs/a")),
    "https://current.example/docs/a",
  );
  const svgLike = {
    getAttribute: (name) => (name === "href" ? "/sub/inner" : null),
    href: {},
    _jariBase: "https://inner.example/base/",
  };
  assert.equal(getHref(svgLike), "https://inner.example/sub/inner");
  const noBase = {
    getAttribute: (name) => (name === "href" ? "/sub/inner" : null),
    href: {},
  };
  assert.equal(getHref(noBase), "https://current.example/sub/inner");
});

test("isOpenableLink rejects fragment-only links", () => {
  assert.equal(
    isOpenableLink(fakeAnchor("#", "https://current.example/page#")),
    false,
  );
  assert.equal(
    isOpenableLink(fakeAnchor("/docs/a", "https://current.example/docs/a")),
    true,
  );
});

function fakeMutNode(classes) {
  return { nodeType: 1, classList: classes, closest: () => null };
}

test("isOwnMutation ignores our own UI churn but keeps page mutations", () => {
  const body = fakeMutNode([]);
  assert.equal(
    isOwnMutation({ target: body, addedNodes: [fakeMutNode(["jari-flash"])], removedNodes: [] }),
    true,
  );
  assert.equal(
    isOwnMutation({ target: fakeMutNode(["jari-hints-host"]), addedNodes: [], removedNodes: [] }),
    true,
  );
  assert.equal(
    isOwnMutation({ target: fakeMutNode(["jari-hint"]), addedNodes: [], removedNodes: [] }),
    true,
  );
  assert.equal(
    isOwnMutation({ target: body, addedNodes: [fakeMutNode(["ad-slot"])], removedNodes: [] }),
    false,
  );
  assert.equal(
    isOwnMutation({ target: fakeMutNode(["content"]), addedNodes: [], removedNodes: [] }),
    false,
  );
  assert.equal(
    isOwnMutation({
      target: body,
      addedNodes: [fakeMutNode(["ad-slot"])],
      removedNodes: [fakeMutNode(["jari-flash"])],
    }),
    false,
  );
});

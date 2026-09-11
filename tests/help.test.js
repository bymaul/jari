import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Help } from "../content/help.js";

function makeTextNode(text) {
  return {
    nodeType: 3,
    nodeValue: text,
    parent: null,
    isConnected: true,
    get textContent() {
      return this.nodeValue;
    },
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter((c) => c !== this);
      }
    },
  };
}

function makeEl(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    listeners: {},
    parent: null,
    style: {},
    dataset: {},
    attrs: {},
    hidden: false,
    value: "",
    _text: "",
    _className: "",
    _jariOrig: undefined,
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 200,
    scrollCalls: 0,
    tabIndex: 0,
    get className() {
      return this._className;
    },
    set className(v) {
      this._className = v;
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = v;
      this.children.length = 0;
    },
    classList: {
      contains(cls) {
        return el._className.split(/\s+/).includes(cls);
      },
      add(...classes) {
        const current = el._className.split(/\s+/).filter(Boolean);
        for (const cls of classes) {
          if (cls && !current.includes(cls)) current.push(cls);
        }
        el._className = current.join(" ");
      },
    },
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    appendChild(child) {
      el.children.push(child);
      child.parent = el;
      return child;
    },
    remove() {
      if (el.parent) {
        el.parent.children = el.parent.children.filter((c) => c !== el);
      }
    },
    focus() {
      doc.activeElement = el;
    },
    blur() {
      if (doc.activeElement === el) doc.activeElement = null;
    },
    scrollTo() {},
    scrollBy() {},
    scrollIntoView() {
      el.scrollCalls++;
    },
    querySelectorAll(sel) {
      const out = [];
      const visit = (node) => {
        if (!node.children) return;
        for (const child of node.children) {
          if (matchesSel(child, sel)) out.push(child);
          visit(child);
        }
      };
      visit(el);
      return out;
    },
  };
  return el;
}

function matchesSel(el, sel) {
  if (!el || !el.tagName) return false;
  const hasClass = (cls) =>
    el.classList ? el.classList.contains(cls) : false;
  if (sel === "tbody") return el.tagName === "TBODY";
  if (sel === "tr") return el.tagName === "TR";
  if (sel === "span") return el.tagName === "SPAN";
  if (sel === ".jari-help-column") return hasClass("jari-help-column");
  if (sel === ".jari-find-hit") return hasClass("jari-find-hit");
  if (sel === ".jari-find-current") return hasClass("jari-find-current");
  return false;
}

function makeDocument() {
  const doc = {
    created: [],
    activeElement: null,
    body: null,
    createElement(tag) {
      const el = makeEl(tag, doc);
      doc.created.push(el);
      return el;
    },
    createTextNode(text) {
      return makeTextNode(text);
    },
  };
  doc.body = makeEl("body", doc);
  return doc;
}

async function withDocument(fn) {
  const previous = globalThis.document;
  const doc = makeDocument();
  globalThis.document = doc;
  try {
    await fn(doc);
  } finally {
    try {
      Help.close();
    } catch {}
    globalThis.document = previous;
  }
}

function overlayOf(doc) {
  return doc.body.children[doc.body.children.length - 1];
}

function footerText(doc) {
  const footer = doc.created.find((el) =>
    el.className.split(/\s+/).includes("jari-help-footer"),
  );
  return footer.children[0].textContent;
}

function entryRows(doc) {
  const rows = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (child.tagName === "TR" && !child.classList.contains("jari-help-cat-header")) {
        rows.push(child);
      }
      visit(child);
    }
  };
  visit(doc.body);
  return rows;
}

function helpList(doc) {
  return doc.created.find((el) =>
    el.className.split(/\s+/).includes("jari-help-list"),
  );
}

function highlightSpans(doc) {
  return doc.body.querySelectorAll(".jari-find-hit");
}

function currentSpans(doc) {
  return doc.body.querySelectorAll(".jari-find-current");
}

function keyEvent(key, target, extra = {}) {
  return {
    key,
    target,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...extra,
  };
}

function typeHelp(doc, text) {
  const overlay = overlayOf(doc);
  for (const ch of text) Help.onKeyDown(keyEvent(ch, overlay));
}

test("help opens with no search box and the default footer", async () => {
  await withDocument((doc) => {
    Help.open();
    assert.ok(Help.isActive());

    assert.equal(
      doc.created.filter((el) => el.tagName === "INPUT").length,
      0,
      "expected no search input",
    );
    assert.ok(entryRows(doc).length > 0, "expected help rows");
    assert.equal(footerText(doc), "j/k scroll | / search | esc close");
  });
});

test("unbound commands are listed as unbound", async () => {
  await withDocument((doc) => {
    Help.open();
    const unbound = entryRows(doc).filter(
      (tr) => tr.children[0].textContent === "unbound",
    );
    assert.ok(unbound.length > 0, "expected unbound rows");
    assert.ok(
      unbound.some((tr) => tr.children[1].textContent === "Duplicate tab"),
      "expected Duplicate tab to be unbound by default",
    );
  });
});

test("typing after / highlights matches with find classes", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "tab");

    const hits = highlightSpans(doc);
    const current = currentSpans(doc);
    assert.ok(hits.length > 0, "expected highlighted matches");
    assert.equal(current.length, 1, "expected exactly one current match");
    assert.match(footerText(doc), /\/tab 1\/\d+/);

    const row = current[0].parent.parent;
    assert.ok(row.scrollCalls > 0, "expected the current match to scroll into view");
  });
});

test("Enter keeps highlights and n/N cycle the current match", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "tab");
    Help.onKeyDown(keyEvent("Enter", overlay));

    const first = currentSpans(doc)[0];
    assert.ok(highlightSpans(doc).length > 1, "expected several matches for 'tab'");

    Help.onKeyDown(keyEvent("n", overlay));
    const second = currentSpans(doc)[0];
    assert.notEqual(second, first);
    assert.match(footerText(doc), /2\/\d+/);

    Help.onKeyDown(keyEvent("N", overlay));
    assert.equal(currentSpans(doc)[0], first);
    assert.match(footerText(doc), /1\/\d+/);
  });
});

test("Backspace edits the query", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "ta");
    assert.match(footerText(doc), /\/ta /);

    Help.onKeyDown(keyEvent("Backspace", overlay));
    assert.match(footerText(doc), /\/t /);
  });
});

test("a query with no matches reports it in the footer", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "zzz-no-such-binding");

    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(currentSpans(doc).length, 0);
    assert.match(footerText(doc), /No match/);
  });
});

test("Esc clears highlights, Esc again closes", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "tab");
    Help.onKeyDown(keyEvent("Enter", overlay));
    assert.ok(highlightSpans(doc).length > 0);

    Help.onKeyDown(keyEvent("Escape", overlay));
    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(currentSpans(doc).length, 0);
    assert.equal(footerText(doc), "j/k scroll | / search | esc close");
    assert.ok(Help.isActive());

    Help.onKeyDown(keyEvent("Escape", overlay));
    assert.equal(Help.isActive(), false);
  });
});

test("Esc while searching discards the query", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    Help.onKeyDown(keyEvent("/", overlay));
    typeHelp(doc, "tab");
    Help.onKeyDown(keyEvent("Escape", overlay));

    assert.equal(highlightSpans(doc).length, 0);
    assert.ok(Help.isActive());
  });
});

test("gg scrolls to the top", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);
    const list = helpList(doc);
    const scrolled = [];
    list.scrollTo = (...args) => scrolled.push(args);

    Help.onKeyDown(keyEvent("g", overlay));
    assert.deepEqual(scrolled, []);
    Help.onKeyDown(keyEvent("g", overlay));
    assert.deepEqual(scrolled, [[0, 0]]);
  });
});

test("modified keys and bare modifiers reach the page", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);

    assert.equal(Help.onKeyDown(keyEvent("t", overlay, { ctrlKey: true })), false);
    assert.equal(Help.onKeyDown(keyEvent("Control", overlay)), false);
    assert.equal(Help.onKeyDown(keyEvent("r", overlay, { ctrlKey: true })), false);
    assert.ok(Help.isActive());
  });
});

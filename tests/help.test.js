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
      remove(...classes) {
        el._className = el._className
          .split(/\s+/)
          .filter((cls) => cls && !classes.includes(cls))
          .join(" ");
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
    insertBefore(child, ref) {
      const idx = ref ? el.children.indexOf(ref) : -1;
      if (idx < 0) el.children.push(child);
      else el.children.splice(idx, 0, child);
      child.parent = el;
      return child;
    },
    remove() {
      if (el.parent) {
        el.parent.children = el.parent.children.filter((c) => c !== el);
        el.parent = null;
      }
    },
    select() {
      el.selected = true;
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

function helpOverlay(doc) {
  return livePartOf(doc, "jari-help");
}

function livePartOf(doc, cls) {
  let found;
  const visit = (node) => {
    for (const child of node.children || []) {
      const name = child.className;
      if (typeof name === "string" && name.split(/\s+/).includes(cls)) found = child;
      visit(child);
    }
  };
  visit(doc.body);
  return found;
}



function footerText(doc) {
  return livePartOf(doc, "jari-help-status").textContent;
}

function statusText(doc) {
  return footerText(doc).split(" | ")[0];
}

function filterInput(doc) {
  return livePartOf(doc, "jari-prompt-input");
}

function openFilter(doc) {
  Help.onKeyDown(keyEvent("/", overlayOf(doc)));
  return filterInput(doc);
}

function typeFilter(doc, text) {
  const input = filterInput(doc);
  input.value = text;
  for (const fn of input.listeners.input || []) fn({ target: input });
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

test("help opens with no filter and the nav hints", async () => {
  await withDocument((doc) => {
    Help.open();
    assert.ok(Help.isActive());

    assert.equal(
      doc.created.filter((el) => el.tagName === "INPUT").length,
      0,
      "expected no filter input until /",
    );
    assert.equal(doc.activeElement, helpOverlay(doc), "expected the list focused");
    assert.ok(entryRows(doc).length > 0, "expected help rows");
    assert.equal(footerText(doc), "j/k scroll | / filter | n/N jump | esc close");
  });
});

test("/ opens the filter and Esc closes it again", async () => {
  await withDocument((doc) => {
    Help.open();
    Help.onKeyDown(keyEvent("/", overlayOf(doc)));

    const input = filterInput(doc);
    assert.ok(input, "expected a filter input after /");
    assert.equal(doc.activeElement, input, "expected the filter focused");
    assert.equal(footerText(doc), "Enter done | Esc cancel");

    Help.onKeyDown(keyEvent("Escape", input));
    assert.equal(filterInput(doc), undefined, "expected the input removed");
    assert.equal(doc.activeElement, helpOverlay(doc), "expected focus back on the list");
    assert.equal(footerText(doc), "j/k scroll | / filter | n/N jump | esc close");
  });
});

test("the filter input sits inline in the footer bar", async () => {
  await withDocument((doc) => {
    Help.open();
    openFilter(doc);

    const input = filterInput(doc);
    assert.ok(input, "expected a filter input after /");
    assert.equal(
      input.parent,
      livePartOf(doc, "jari-prompt-footer"),
      "expected the input inside the footer",
    );
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
      unbound.some((tr) => tr.children[1].textContent === "Open link in this tab"),
      "expected Open link in this tab to be unbound by default",
    );
  });
});

test("typing in the filter highlights matches with find classes", async () => {
  await withDocument((doc) => {
    Help.open();
    openFilter(doc);
    typeFilter(doc, "tab");

    const hits = highlightSpans(doc);
    const current = currentSpans(doc);
    assert.ok(hits.length > 0, "expected highlighted matches");
    assert.equal(current.length, 1, "expected exactly one current match");
    assert.match(statusText(doc), /^1\/\d+$/);

    const row = current[0].parent.parent;
    assert.ok(row.scrollCalls > 0, "expected the current match to scroll into view");
  });
});

test("Enter keeps the query and n/N cycle matches", async () => {
  await withDocument((doc) => {
    Help.open();
    const input = openFilter(doc);
    typeFilter(doc, "tab");
    Help.onKeyDown(keyEvent("Enter", input));

    assert.equal(filterInput(doc), undefined, "expected the input removed");
    assert.equal(doc.activeElement, helpOverlay(doc));
    assert.match(footerText(doc), /^\d+\/\d+ \| j\/k scroll/);
    const first = currentSpans(doc)[0];
    assert.ok(highlightSpans(doc).length > 1, "expected several matches for 'tab'");

    Help.onKeyDown(keyEvent("n", overlayOf(doc)));
    const second = currentSpans(doc)[0];
    assert.notEqual(second, first);
    assert.match(statusText(doc), /^2\/\d+$/);

    Help.onKeyDown(keyEvent("N", overlayOf(doc)));
    assert.equal(currentSpans(doc)[0], first);
    assert.match(statusText(doc), /^1\/\d+$/);
  });
});

test("ArrowDown cycles matches while typing", async () => {
  await withDocument((doc) => {
    Help.open();
    const input = openFilter(doc);
    typeFilter(doc, "tab");
    const first = currentSpans(doc)[0];

    for (const fn of input.listeners.keydown) {
      fn({ key: "ArrowDown", target: input, preventDefault() {}, stopPropagation() {} });
    }
    assert.notEqual(currentSpans(doc)[0], first);
    assert.match(statusText(doc), /^2\/\d+$/);
  });
});

test("the filter field edits its own value and re-highlights", async () => {
  await withDocument((doc) => {
    Help.open();
    openFilter(doc);
    typeFilter(doc, "tab");
    assert.match(statusText(doc), /^1\/\d+$/);

    typeFilter(doc, "ta");
    assert.equal(filterInput(doc).value, "ta");
    assert.match(statusText(doc), /^1\/\d+$/);

    typeFilter(doc, "");
    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(currentSpans(doc).length, 0);
    assert.equal(footerText(doc), "Enter done | Esc cancel");
  });
});

test("a query with no matches reports it in the footer", async () => {
  await withDocument((doc) => {
    Help.open();
    openFilter(doc);
    typeFilter(doc, "zzz-no-such-binding");

    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(currentSpans(doc).length, 0);
    assert.equal(statusText(doc), "no match for zzz-no-such-binding");
  });
});

test("Esc in the filter clears the query and closes it", async () => {
  await withDocument((doc) => {
    Help.open();
    const input = openFilter(doc);
    typeFilter(doc, "tab");
    Help.onKeyDown(keyEvent("Escape", input));

    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(footerText(doc), "j/k scroll | / filter | n/N jump | esc close");
    assert.equal(filterInput(doc), undefined);
    assert.equal(doc.activeElement, helpOverlay(doc));
    assert.ok(Help.isActive());
  });
});

test("/ reopens the filter with the previous query selected", async () => {
  await withDocument((doc) => {
    Help.open();
    const first = openFilter(doc);
    typeFilter(doc, "tab");
    Help.onKeyDown(keyEvent("Enter", first));

    const second = openFilter(doc);
    assert.ok(second, "expected the filter back");
    assert.equal(second.value, "tab", "expected the query preserved");
    assert.equal(doc.activeElement, second);
    assert.ok(highlightSpans(doc).length > 0, "expected highlights preserved");
  });
});

test("Esc clears highlights, Esc again closes", async () => {
  await withDocument((doc) => {
    Help.open();
    const overlay = overlayOf(doc);
    openFilter(doc);
    typeFilter(doc, "tab");
    Help.onKeyDown(keyEvent("Enter", filterInput(doc)));
    assert.ok(highlightSpans(doc).length > 0);

    Help.onKeyDown(keyEvent("Escape", overlay));
    assert.equal(highlightSpans(doc).length, 0);
    assert.equal(currentSpans(doc).length, 0);
    assert.ok(Help.isActive());

    Help.onKeyDown(keyEvent("Escape", overlay));
    assert.equal(Help.isActive(), false);
  });
});

test("typing keys reach the filter instead of scrolling", async () => {
  await withDocument((doc) => {
    Help.open();
    const input = openFilter(doc);
    const list = helpList(doc);
    const scrolled = [];
    list.scrollTo = (...args) => scrolled.push(args);

    for (const key of ["j", "k", "n", "N", "g", "G"]) {
      assert.equal(Help.onKeyDown(keyEvent(key, input)), false, key);
    }
    assert.deepEqual(scrolled, []);
    assert.equal(highlightSpans(doc).length, 0);
  });
});

test("gg scrolls to the top", async () => {
  await withDocument((doc) => {
    Help.open();
    const list = helpList(doc);
    const scrolled = [];
    list.scrollTo = (...args) => scrolled.push(args);

    Help.onKeyDown(keyEvent("g", overlayOf(doc)));
    assert.deepEqual(scrolled, []);
    Help.onKeyDown(keyEvent("g", overlayOf(doc)));
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

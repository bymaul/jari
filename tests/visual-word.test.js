import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { isWordChar, findNextWordEnd } from "../content/visual/word.js";

test("visual/word direct import: isWordChar", () => {
  assert.equal(isWordChar("a"), true);
  assert.equal(isWordChar("é"), true);
  assert.equal(isWordChar("中"), true);
  assert.equal(isWordChar("-"), false);
});

function fakeTextNode(value, tag = "DIV") {
  return { nodeValue: value, parentElement: { tagName: tag } };
}

function stubWordWalker(nodes) {
  const NF = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 3 };
  globalThis.NodeFilter = NF;
  globalThis.document.createTreeWalker = (root, what, filter) => {
    const list = nodes.filter((n) => {
      if (!filter || typeof filter.acceptNode !== "function") return true;
      try {
        return filter.acceptNode(n) === NF.FILTER_ACCEPT;
      } catch {
        return true;
      }
    });
    let i = 0;
    return { nextNode: () => (i < list.length ? list[i++] : null) };
  };
  return (focusNode, focusOffset) => {
    globalThis.window.getSelection = () => ({ focusNode, focusOffset });
  };
}

function restoreWordStubs(saved) {
  if (saved.walker === undefined) delete globalThis.document.createTreeWalker;
  else globalThis.document.createTreeWalker = saved.walker;
  if (saved.nf === undefined) delete globalThis.NodeFilter;
  else globalThis.NodeFilter = saved.nf;
  if (saved.getSelection === undefined) delete globalThis.window.getSelection;
  else globalThis.window.getSelection = saved.getSelection;
}

test("visual/word direct import: findNextWordEnd", () => {
  const saved = {
    walker: globalThis.document.createTreeWalker,
    nf: globalThis.NodeFilter,
    getSelection: globalThis.window.getSelection,
  };
  const hello = fakeTextNode("hello");
  const rest = fakeTextNode(" you");
  const setFocus = stubWordWalker([hello, rest]);
  try {
    setFocus(hello, 0);
    assert.deepEqual(findNextWordEnd(1), { node: hello, offset: 4 });
  } finally {
    restoreWordStubs(saved);
  }
});

import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import { isWordChar, findNextWordEnd } from "../content/visual/word.ts";

type FakeTextNode = { nodeValue: string; parentElement: { tagName: string } };
type FakeFilter = { acceptNode(n: unknown): number };
type FakeDocWithWalker = {
  createTreeWalker?: (
    root: unknown,
    what: number,
    filter: FakeFilter,
  ) => { nextNode(): FakeTextNode | null };
};

function fakeTextNode(value: string, tag = "DIV"): FakeTextNode {
  return { nodeValue: value, parentElement: { tagName: tag } };
}

function stubWordWalker(nodes: FakeTextNode[]) {
  const NF = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 3 };
  (globalThis as unknown as { NodeFilter: unknown }).NodeFilter = NF;
  const doc = globalThis.document as unknown as FakeDocWithWalker;
  doc.createTreeWalker = (root, what, filter) => {
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
  return (focusNode: FakeTextNode, focusOffset: number) => {
    (globalThis.window as unknown as { getSelection: unknown }).getSelection =
      () => ({ focusNode, focusOffset });
  };
}

function restoreWordStubs(saved: {
  walker: unknown;
  nf: unknown;
  getSelection: unknown;
}): void {
  const doc = globalThis.document as unknown as FakeDocWithWalker;
  if (saved.walker === undefined) delete doc.createTreeWalker;
  else
    doc.createTreeWalker =
      saved.walker as FakeDocWithWalker["createTreeWalker"];
  const globalNodeFilter = globalThis as unknown as { NodeFilter?: unknown };
  if (saved.nf === undefined) delete globalNodeFilter.NodeFilter;
  else globalNodeFilter.NodeFilter = saved.nf;
  const fakeWindow = globalThis.window as unknown as {
    getSelection?: unknown;
  };
  if (saved.getSelection === undefined) delete fakeWindow.getSelection;
  else fakeWindow.getSelection = saved.getSelection;
}

test("visual/word direct import: isWordChar", () => {
  assert.equal(isWordChar("a"), true);
  assert.equal(isWordChar("é"), true);
  assert.equal(isWordChar("中"), true);
  assert.equal(isWordChar("-"), false);
});

test("visual/word direct import: findNextWordEnd", () => {
  const doc = globalThis.document as unknown as FakeDocWithWalker;
  const saved = {
    walker: doc.createTreeWalker,
    nf: (globalThis as unknown as { NodeFilter: unknown }).NodeFilter,
    getSelection: (globalThis.window as unknown as { getSelection: unknown })
      .getSelection,
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

import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import {
  filterTextTargets,
  firstNonBlankPosition,
} from "../content/visual/collect.ts";

type FakeEl = {
  tagName: string;
  parent: FakeEl | null;
  children: FakeEl[];
  contains(candidate: unknown): boolean;
};

function fakeEl(tagName: string, parent: FakeEl | null = null): FakeEl {
  const el: FakeEl = {
    tagName,
    parent,
    children: [],
    contains(candidate: unknown): boolean {
      let cur = candidate as FakeEl | null;
      while (cur) {
        if (cur === el) return true;
        cur = cur.parent;
      }
      return false;
    },
  };
  if (parent) parent.children.push(el);
  return el;
}

function asElements(els: FakeEl[]): Element[] {
  return els as unknown as Element[];
}

test("filterTextTargets keeps a paragraph over an inline link", () => {
  const p = fakeEl("P");
  const a = fakeEl("A", p);
  const out = filterTextTargets(
    asElements([p, a]),
    (el) => (el as unknown as FakeEl).tagName === "P",
  );
  assert.deepEqual(out, asElements([p]));
});

test("filterTextTargets keeps the innermost block", () => {
  const li = fakeEl("LI");
  const p = fakeEl("P", li);
  const out = filterTextTargets(
    asElements([li, p]),
    () => true,
  );
  assert.deepEqual(out, asElements([p]));
});

test("filterTextTargets keeps standalone inline text", () => {
  const span = fakeEl("SPAN");
  const out = filterTextTargets(asElements([span]), () => false);
  assert.deepEqual(out, asElements([span]));
});

test("filterTextTargets drops every inline descendant of a block", () => {
  const p = fakeEl("P");
  const a = fakeEl("A", p);
  const em = fakeEl("EM", p);
  const out = filterTextTargets(
    asElements([p, a, em]),
    (el) => (el as unknown as FakeEl).tagName === "P",
  );
  assert.deepEqual(out, asElements([p]));
});

test("filterTextTargets keeps sibling blocks", () => {
  const p1 = fakeEl("P");
  const p2 = fakeEl("P");
  const out = filterTextTargets(
    asElements([p1, p2]),
    () => true,
  );
  assert.deepEqual(out, asElements([p1, p2]));
});

type FakeTextNode = { nodeValue: string };
type WalkerFilter = { acceptNode(node: FakeTextNode): number };

function stubWalker(nodes: FakeTextNode[]): () => void {
  const doc = globalThis.document as unknown as Record<string, unknown>;
  const saved = doc.createTreeWalker;
  doc.createTreeWalker = (
    _root: unknown,
    _what: number,
    filter: WalkerFilter,
  ) => {
    const accepted = nodes.filter((n) => filter.acceptNode(n) === 1);
    let i = 0;
    return {
      nextNode: () => (i < accepted.length ? accepted[i++] : null),
    };
  };
  return () => {
    if (saved === undefined) delete doc.createTreeWalker;
    else doc.createTreeWalker = saved;
  };
}

test("firstNonBlankPosition skips blank nodes and leading whitespace", () => {
  const blank = { nodeValue: "\n  " };
  const text = { nodeValue: "\n  Hello" };
  const restore = stubWalker([blank, text]);
  try {
    assert.deepEqual(firstNonBlankPosition({} as Element), {
      node: text,
      offset: 3,
    });
  } finally {
    restore();
  }
});

test("firstNonBlankPosition returns null when every node is blank", () => {
  const restore = stubWalker([{ nodeValue: "  " }, { nodeValue: "\n" }]);
  try {
    assert.equal(firstNonBlankPosition({} as Element), null);
  } finally {
    restore();
  }
});

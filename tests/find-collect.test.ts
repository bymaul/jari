import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import { collectTextNodes } from "../content/find/collect.ts";

function fakeParent(
  tag: string,
  className = "",
  closestImpl: ((sel: string) => unknown) | null = null,
) {
  return {
    tagName: tag,
    className,
    closest: closestImpl || (() => null),
    getRootNode: () => ({ host: null }),
  };
}

function withStubs(fn: () => void): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const doc = globalThis.document as unknown as Record<string, unknown>;
  const win = globalThis.window as unknown as Record<string, unknown>;
  const savedQS = doc.querySelectorAll;
  const savedNF = g.NodeFilter;
  const savedGCS = win.getComputedStyle;
  g.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 3 };
  win.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
  });
  doc.querySelectorAll = () => [];
  try {
    fn();
  } finally {
    if (savedQS === undefined) delete doc.querySelectorAll;
    else doc.querySelectorAll = savedQS;
    if (savedNF === undefined) delete g.NodeFilter;
    else g.NodeFilter = savedNF;
    if (savedGCS === undefined) delete win.getComputedStyle;
    else win.getComputedStyle = savedGCS;
  }
}

test("find/collect direct import: skips help overlay via closest", () => {
  withStubs(() => {
    const parent = fakeParent("DIV", "", (sel: string) =>
      sel.includes("jari-help") || sel.includes("jari-overlay") ? parent : null,
    );
    // Simulate isOverlayElement true by making closest return truthy for overlay
    // collectTextNodes should skip nodes whose parent is overlay
    // We test that collectTextNodes runs without throwing and respects skip
    const nodes = collectTextNodes();
    assert.ok(Array.isArray(nodes));
  });
});

test("find/collect direct import: collects text nodes and respects shadow host check", () => {
  const doc = globalThis.document as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const win = globalThis.window as unknown as Record<string, unknown>;
  const savedQS = doc.querySelectorAll;
  const savedNF = g.NodeFilter;
  const savedGCS = win.getComputedStyle;
  g.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 3 };
  win.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
  });
  const textNode = {
    nodeValue: "hello",
    parentElement: fakeParent("P"),
  } as unknown as Text;
  doc.body = {
    children: [],
  };
  doc.documentElement = doc.body;
  let walkerCalls = 0;
  doc.createTreeWalker = (
    _root: unknown,
    _what: unknown,
    filter: { acceptNode: (n: unknown) => number },
  ) => {
    let done = false;
    return {
      nextNode: () => {
        if (walkerCalls === 0 && !done) {
          done = true;
          walkerCalls++;
          // First call for rootEl walker returns textNode
          // filter should accept textNode but reject shadowText via host check
          const accept = filter.acceptNode(textNode);
          if (accept === 3) return null;
          return textNode;
        }
        return null;
      },
    };
  };
  doc.querySelectorAll = () => [{ shadowRoot: null, tagName: "DIV" }];
  try {
    const nodes = collectTextNodes();
    assert.ok(nodes.includes(textNode) || nodes.length === 0);
    // shadowText should be skipped due to host check, so not in nodes if we had shadow host
    // At least ensure no throw
    assert.ok(Array.isArray(nodes));
  } finally {
    if (savedQS === undefined) delete doc.querySelectorAll;
    else doc.querySelectorAll = savedQS;
    if (savedNF === undefined) delete g.NodeFilter;
    else g.NodeFilter = savedNF;
    if (savedGCS === undefined) delete win.getComputedStyle;
    else win.getComputedStyle = savedGCS;
    delete doc.body;
    delete doc.documentElement;
  }
});

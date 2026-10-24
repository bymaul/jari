/* global NodeFilter */

/** Loose caret/rect shape: callers pass DOMRects, client-rect lists, or
 *  synthetic geometry; only the measured fields are read at runtime. */
export type CaretRect = {
  left?: number;
  top?: number;
  right?: number;
  height?: number;
  width?: number;
};

export function isUsableCaretRect(
  rect: CaretRect | null | undefined,
): rect is CaretRect {
  return (
    !!rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    typeof rect.height === "number" &&
    rect.height > 0
  );
}

export function firstUsableRect(
  list?: CaretRect[] | DOMRectList | null,
): CaretRect | null {
  if (!list || typeof list.length !== "number") return null;
  for (const r of list) {
    if (isUsableCaretRect(r)) return r;
  }
  return null;
}

export function lineHeightForElement(el: Element | null): number {
  try {
    if (
      el &&
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
    ) {
      const cs = window.getComputedStyle(el);
      const lh = parseFloat(cs && cs.lineHeight);
      if (Number.isFinite(lh) && lh > 0 && lh < 200) return lh;
      const fs = parseFloat(cs && cs.fontSize);
      if (Number.isFinite(fs) && fs > 0 && fs < 200)
        return Math.round(fs * 1.2);
    }
  } catch {}
  return 16;
}

export function resolveCaretGeometry({
  collapsed,
  clientRects,
  before,
  after,
  parentRect,
  fallbackHeight,
}: {
  collapsed?: CaretRect | null;
  clientRects?: DOMRectList | CaretRect[] | null;
  before?: CaretRect | null;
  after?: CaretRect | null;
  parentRect?: CaretRect | null;
  fallbackHeight?: number;
}): CaretRect | null {
  if (isUsableCaretRect(collapsed)) {
    return {
      left: collapsed.left,
      top: collapsed.top,
      height: collapsed.height,
      width: collapsed.width || 0,
    };
  }
  const listRect = firstUsableRect(clientRects);
  if (listRect) {
    return {
      left: listRect.left,
      top: listRect.top,
      height: listRect.height,
      width: listRect.width || 0,
    };
  }
  if (isUsableCaretRect(before)) {
    const left = Number.isFinite(before.right) ? before.right : before.left;
    return { left, top: before.top, height: before.height, width: 0 };
  }
  if (isUsableCaretRect(after)) {
    const left = Number.isFinite(after.left) ? after.left : after.right;
    return { left, top: after.top, height: after.height, width: 0 };
  }
  if (
    parentRect &&
    Number.isFinite(parentRect.left) &&
    Number.isFinite(parentRect.top)
  ) {
    const height =
      Number.isFinite(fallbackHeight) && (fallbackHeight as number) > 0
        ? fallbackHeight
        : 16;
    return {
      left: parentRect.left,
      top: parentRect.top,
      height,
      width: parentRect.width || 0,
    };
  }
  return null;
}

export function readSingleCharRect(
  node: Node,
  start: number,
  end: number,
): CaretRect | null {
  try {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    const hit = firstUsableRect(r.getClientRects());
    if (hit) return hit;
    const bounds = r.getBoundingClientRect();
    if (isUsableCaretRect(bounds)) return bounds;
  } catch {}
  return null;
}

export function readNeighborCharRects(
  focusNode: Node | null | undefined,
  focusOffset: number,
): { before: CaretRect | null; after: CaretRect | null } {
  let before: CaretRect | null = null;
  let after: CaretRect | null = null;
  try {
    if (
      !focusNode ||
      typeof Node === "undefined" ||
      focusNode.nodeType !== Node.TEXT_NODE
    ) {
      return { before, after };
    }
    const len = focusNode.nodeValue ? focusNode.nodeValue.length : 0;
    const off = Math.max(0, Math.min(focusOffset | 0, len));
    for (let i = off - 1, steps = 0; i >= 0 && steps < 32; i--, steps++) {
      before = readSingleCharRect(focusNode, i, i + 1);
      if (before) break;
    }
    for (let i = off, steps = 0; i < len && steps < 32; i++, steps++) {
      after = readSingleCharRect(focusNode, i, i + 1);
      if (after) break;
    }
    if (!before || !after) {
      const edge = readAdjacentTextCharRect(focusNode, !before, !after);
      if (!before) before = edge.before;
      if (!after) after = edge.after;
    }
  } catch {}
  return { before, after };
}

export function readAdjacentTextCharRect(
  focusNode: Node,
  wantBefore: boolean,
  wantAfter: boolean,
): { before: CaretRect | null; after: CaretRect | null } {
  const out: { before: CaretRect | null; after: CaretRect | null } = {
    before: null,
    after: null,
  };
  try {
    if (
      typeof Node === "undefined" ||
      typeof NodeFilter === "undefined" ||
      !document.body
    ) {
      return out;
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    walker.currentNode = focusNode;
    if (wantBefore) {
      const prev = walker.previousNode();
      if (prev && prev.nodeValue) {
        for (
          let i = prev.nodeValue.length - 1, steps = 0;
          i >= 0 && steps < 32;
          i--, steps++
        ) {
          out.before = readSingleCharRect(prev, i, i + 1);
          if (out.before) break;
        }
      }
    }
    if (wantAfter) {
      walker.currentNode = focusNode;
      const next = walker.nextNode();
      if (next && next.nodeValue) {
        for (
          let i = 0, steps = 0;
          i < next.nodeValue.length && steps < 32;
          i++, steps++
        ) {
          out.after = readSingleCharRect(next, i, i + 1);
          if (out.after) break;
        }
      }
    }
  } catch {}
  return out;
}

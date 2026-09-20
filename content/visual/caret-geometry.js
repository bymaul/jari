/* global NodeFilter */

export function isUsableCaretRect(rect) {
  return (
    !!rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    typeof rect.height === "number" &&
    rect.height > 0
  );
}

export function firstUsableRect(list) {
  if (!list || typeof list.length !== "number") return null;
  for (const r of list) {
    if (isUsableCaretRect(r)) return r;
  }
  return null;
}

export function lineHeightForElement(el) {
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
}) {
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
      Number.isFinite(fallbackHeight) && fallbackHeight > 0
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

export function readSingleCharRect(node, start, end) {
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

export function readNeighborCharRects(focusNode, focusOffset) {
  let before = null;
  let after = null;
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

export function readAdjacentTextCharRect(focusNode, wantBefore, wantAfter) {
  const out = { before: null, after: null };
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
        for (let i = 0, steps = 0; i < next.nodeValue.length && steps < 32; i++, steps++) {
          out.after = readSingleCharRect(next, i, i + 1);
          if (out.after) break;
        }
      }
    }
  } catch {}
  return out;
}

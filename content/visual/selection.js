/* global CSS, Highlight, NodeFilter, Range */

import {
  detectHighlightSupport,
  clearHighlightNames,
  unwrapSpans,
} from "../highlight.js";

let visualFallbackSpans = [];

export function clearVisualHighlight() {
  clearHighlightNames("jari-visual");
  unwrapSpans(visualFallbackSpans);
}

export function applyVisualHighlight({ active, mode, getSelection }) {
  clearVisualHighlight();
  if (!active || mode === "caret") return;
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  try {
    const range = sel.getRangeAt(0).cloneRange();
    try {
      if (detectHighlightSupport()) {
        CSS.highlights.set("jari-visual", new Highlight(range));
        return;
      }
    } catch {}
    try {
      const span = document.createElement("span");
      span.className = "jari-visual-highlight";
      range.surroundContents(span);
      visualFallbackSpans.push(span);
    } catch {
      try {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let n = walker.nextNode();
        while (n) {
          try {
            if (!range.intersectsNode || !range.intersectsNode(n)) {
              n = walker.nextNode();
              continue;
            }
            const nodeRange = document.createRange();
            nodeRange.selectNodeContents(n);
            if (
              range.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0 ||
              range.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0
            ) {
              n = walker.nextNode();
              continue;
            }
            const startNode =
              range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
                ? n
                : range.startContainer;
            const startOffset =
              range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
                ? 0
                : range.startOffset;
            const endNode =
              range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
                ? n
                : range.endContainer;
            const endOffset =
              range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
                ? n.nodeValue.length
                : range.endOffset;
            if (startNode !== n || endNode !== n) {
              n = walker.nextNode();
              continue;
            }
            const r = document.createRange();
            r.setStart(
              n,
              Math.max(0, Math.min(startOffset, n.nodeValue.length)),
            );
            r.setEnd(n, Math.max(0, Math.min(endOffset, n.nodeValue.length)));
            if (r.collapsed) {
              n = walker.nextNode();
              continue;
            }
            const s = document.createElement("span");
            s.className = "jari-visual-highlight";
            r.surroundContents(s);
            visualFallbackSpans.push(s);
          } catch {}
          n = walker.nextNode();
        }
      } catch {}
    }
  } catch {}
}

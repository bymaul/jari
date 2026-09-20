import { overlaySelectors } from "../keymap.js";
import {
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  filterAncestors,
} from "../hints-elements.js";

export function collectVisualTextElements() {
  let elements = getVisibleElements((e, v) => {
    try {
      if (e.closest && e.closest(overlaySelectors)) return;
      if (
        e.closest &&
        e.closest(
          ".jari-visual-caret-host, .jari-visual-caret, .jari-hints-host, .jari-hint",
        )
      )
        return;
      if (
        e.closest &&
        e.closest(
          "script, style, noscript, template, head, meta, link, svg, canvas, video, audio, iframe",
        )
      )
        return;
    } catch {}
    const raw = e.textContent;
    if (!raw) return;
    const text = raw.trim();
    if (!text || text.length < 3 || text.length > 500) return;
    const tag = e.tagName;
    if (
      tag === "HTML" ||
      tag === "BODY" ||
      tag === "MAIN" ||
      tag === "ARTICLE" ||
      tag === "SECTION"
    ) {
      if (text.length > 200) return;
    }
    let hasDirectText = false;
    for (const n of e.childNodes) {
      if (
        n.nodeType === Node.TEXT_NODE &&
        n.nodeValue &&
        n.nodeValue.trim().length >= 2
      ) {
        hasDirectText = true;
        break;
      }
    }
    const isLeaf = e.children.length === 0;
    let isBlock = false;
    try {
      const style = window.getComputedStyle(e);
      isBlock =
        style.display === "block" ||
        style.display === "flex" ||
        style.display === "grid" ||
        style.display === "list-item" ||
        style.display === "table-cell";
      if (style.visibility === "hidden" || style.opacity === "0") return;
    } catch {}
    if (!isLeaf && !hasDirectText && !isBlock) return;
    if (!hasDirectText && text.length < 8 && !isLeaf) return;
    v.push(e);
  });
  elements = filterInvisibleElements(elements);
  elements = elements.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width >= 16 && r.height >= 8 && r.width * r.height >= 80;
  });
  elements = filterOverlapElements(elements);
  elements = filterAncestors(elements);
  const scored = elements
    .map((el) => {
      const text = el.textContent.trim();
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      let score = 0;
      if (text.length >= 10 && text.length <= 140) score += 12;
      else if (text.length > 200) score -= 8;
      if (text.split(/\s+/).length >= 2) score += 4;
      if (area > 0 && area < 40000) score += 6;
      else if (area >= 100000) score -= 6;
      try {
        if (
          el.closest &&
          el.closest(
            "p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, dt, dd",
          )
        )
          score += 5;
      } catch {}
      const hasDirect = Array.from(el.childNodes).some(
        (n) =>
          n.nodeType === Node.TEXT_NODE &&
          n.nodeValue &&
          n.nodeValue.trim().length >= 3,
      );
      if (hasDirect) score += 4;
      return { el, score, area };
    })
    .sort((a, b) => b.score - a.score || a.area - b.area);
  const seen = new Set();
  const out = [];
  for (const { el } of scored) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
    if (out.length >= 350) break;
  }
  if (out.length > 250) {
    return out.filter((e) => e.textContent.trim().length >= 10).slice(0, 250);
  }
  return out;
}

import { overlaySelectors } from "../keymap.ts";
import {
  getVisibleElements,
  filterInvisibleElements,
  filterOccludedElements,
} from "../hints-elements.ts";

const SHOW_TEXT = 4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 3;

const MAX_TARGETS = 400;

const BLOCK_DISPLAYS = new Set([
  "block",
  "flex",
  "grid",
  "list-item",
  "table-cell",
  "flow-root",
]);

export function isBlockDisplay(display: string): boolean {
  return BLOCK_DISPLAYS.has(display);
}

export function filterTextTargets(
  elements: Element[],
  isBlock: (el: Element) => boolean,
): Element[] {
  const kept: Element[] = [];
  for (const e of elements) {
    const eBlock = isBlock(e);
    let skip = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (k.contains(e)) {
        if (eBlock) kept[i] = e;
        skip = true;
        break;
      }
      if (e.contains(k)) {
        if (eBlock && !isBlock(k)) {
          kept.splice(i, 1);
          i--;
          continue;
        }
        skip = true;
        break;
      }
    }
    if (!skip) kept.push(e);
  }
  return kept;
}

export function firstNonBlankPosition(
  el: Element,
): { node: Text; offset: number } | null {
  try {
    const walker = document.createTreeWalker(el, SHOW_TEXT, {
      acceptNode(node) {
        const value = node.nodeValue;
        if (!value || !/\S/.test(value)) return FILTER_REJECT;
        return FILTER_ACCEPT;
      },
    });
    const node = walker.nextNode() as Text | null;
    if (node) {
      const match = /\S/.exec(node.nodeValue || "");
      if (match) return { node, offset: match.index };
    }
  } catch {}
  return null;
}

export function collectVisualTextElements(): Element[] {
  const blockMap = new WeakMap<Element, boolean>();
  let elements = getVisibleElements((e, v, style) => {
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
    const text = e.textContent?.trim();
    if (!text) return;
    if (e.tagName === "HTML" || e.tagName === "BODY") return;
    let hasDirectText = false;
    for (const n of e.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim()) {
        hasDirectText = true;
        break;
      }
    }
    const isLeaf = e.children.length === 0;
    let isBlock = false;
    try {
      isBlock = isBlockDisplay(style.display);
      if (style.visibility === "hidden" || style.opacity === "0") return;
    } catch {}
    if (!isLeaf && !hasDirectText && !isBlock) return;
    if (!hasDirectText && text.length < 8 && !isLeaf) return;
    blockMap.set(e, isBlock);
    v.push(e);
  });
  elements = filterInvisibleElements(elements);
  elements = elements.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width >= 8 && r.height >= 6 && r.width * r.height >= 40;
  });
  elements = filterTextTargets(elements, (el) => blockMap.get(el) === true);
  elements = filterOccludedElements(elements);

  const ordered = elements
    .map((el, index) => ({ el, index, rect: el.getBoundingClientRect() }))
    .sort(
      (a, b) =>
        a.rect.top - b.rect.top ||
        a.rect.left - b.rect.left ||
        a.index - b.index,
    );
  return ordered.slice(0, MAX_TARGETS).map((entry) => entry.el);
}

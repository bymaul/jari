/* global NodeFilter */

import { isWordChar, findNextWordEnd } from "./word.js";
import { collectVisualTextElements } from "./collect.js";
import { getRealRect } from "../hints-elements.js";

function getSelection() {
  return window.getSelection();
}

export function charAtFocus() {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return null;
  const node = sel.focusNode;
  const off = sel.focusOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    if (off < node.nodeValue.length) return node.nodeValue[off];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    walker.currentNode = node;
    const nxt = walker.nextNode();
    if (nxt && nxt.nodeValue.length > 0) return nxt.nodeValue[0];
    return null;
  }
  return null;
}

export function charBeforeFocus() {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return null;
  const node = sel.focusNode;
  const off = sel.focusOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    if (off > 0) return node.nodeValue[off - 1];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    walker.currentNode = node;
    const prev = walker.previousNode();
    if (prev && prev.nodeValue.length > 0)
      return prev.nodeValue[prev.nodeValue.length - 1];
    return null;
  }
  return null;
}

export function getBlockAncestor(node) {
  let el = node && node.parentElement ? node.parentElement : null;
  while (el) {
    try {
      const display = window.getComputedStyle(el).display;
      if (
        display === "block" ||
        display === "flex" ||
        display === "grid" ||
        display === "list-item" ||
        el.tagName === "P" ||
        el.tagName === "DIV" ||
        el.tagName === "LI" ||
        el.tagName === "H1" ||
        el.tagName === "H2" ||
        el.tagName === "H3"
      )
        return el;
    } catch {}
    el = el.parentElement;
  }
  return node && node.parentElement ? node.parentElement : document.body;
}

export function fallbackMoveChar(dir) {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    let node = sel.focusNode;
    let offset = sel.focusOffset;
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.childNodes[offset]) {
        node = node.childNodes[offset];
        offset = 0;
        if (node.nodeType !== Node.TEXT_NODE) return;
      } else {
        return;
      }
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.nodeValue;
    let newOffset = offset + dir;
    let newNode = node;
    if (newOffset < 0) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      walker.currentNode = node;
      const prev = walker.previousNode();
      if (prev) {
        newNode = prev;
        newOffset = (prev.nodeValue || "").length;
      } else {
        return;
      }
    } else if (newOffset > text.length) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      walker.currentNode = node;
      const next = walker.nextNode();
      if (next) {
        newNode = next;
        newOffset = 0;
      } else {
        return;
      }
    }
    const anchorNode = sel.anchorNode;
    const anchorOffset = sel.anchorOffset;
    if (!anchorNode) return;
    if (typeof sel.extend === "function") {
      try {
        sel.extend(newNode, newOffset);
        return;
      } catch {}
    }
    const r = document.createRange();
    try {
      r.setStart(anchorNode, anchorOffset);
      r.setEnd(newNode, newOffset);
    } catch {
      try {
        r.setStart(newNode, newOffset);
        r.setEnd(anchorNode, anchorOffset);
      } catch {
        return;
      }
    }
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
}

export function fallbackMoveCaret(dir) {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    let node = sel.focusNode;
    let offset = sel.focusOffset;
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.childNodes[offset]) {
        node = node.childNodes[offset];
        offset = 0;
        if (node.nodeType !== Node.TEXT_NODE) return;
      } else {
        return;
      }
    }
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.nodeValue;
    let newOffset = offset + dir;
    let newNode = node;
    if (newOffset < 0) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      walker.currentNode = node;
      const prev = walker.previousNode();
      if (prev) {
        newNode = prev;
        newOffset = (prev.nodeValue || "").length;
      } else {
        return;
      }
    } else if (newOffset > text.length) {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      walker.currentNode = node;
      const next = walker.nextNode();
      if (next) {
        newNode = next;
        newOffset = 0;
      } else {
        return;
      }
    }
    const r = document.createRange();
    r.setStart(newNode, newOffset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
}

export function fallbackMoveWord(dir) {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const maxSteps = 800;
  const startIsWord = isWordChar(charAtFocus());
  let inInitialWord = startIsWord && dir > 0;
  for (let i = 0; i < maxSteps; i++) {
    const before = charBeforeFocus();
    const at = charAtFocus();
    if (dir > 0) {
      if (i > 0 && isWordChar(at) && !isWordChar(before)) {
        if (!inInitialWord || i > 1) return true;
      }
      if (inInitialWord && !isWordChar(at)) inInitialWord = false;
    } else {
      if (isWordChar(at) && !isWordChar(before)) {
        if (i > 0) return true;
        if (at !== null && before === null) return true;
      }
    }
    const prevNode = sel.focusNode;
    const prevOff = sel.focusOffset;
    fallbackMoveCaret(dir);
    if (sel.focusNode === prevNode && sel.focusOffset === prevOff) return false;
  }
  return false;
}

export function fallbackExtendWord(dir) {
  const maxSteps = 800;
  const startIsWord = isWordChar(charAtFocus());
  let inInitialWord = startIsWord && dir > 0;
  for (let i = 0; i < maxSteps; i++) {
    const before = charBeforeFocus();
    const at = charAtFocus();
    if (dir > 0) {
      if (i > 0 && isWordChar(at) && !isWordChar(before)) {
        if (!inInitialWord || i > 1) return true;
      }
      if (inInitialWord && !isWordChar(at)) inInitialWord = false;
    } else {
      if (isWordChar(at) && !isWordChar(before)) {
        if (i > 0) return true;
      }
    }
    const prevNode = getSelection().focusNode;
    const prevOff = getSelection().focusOffset;
    fallbackMoveChar(dir);
    const s = getSelection();
    if (s.focusNode === prevNode && s.focusOffset === prevOff) return false;
  }
  return false;
}

function setPosition(node, offset, isCaret) {
  const sel = getSelection();
  if (!sel) return;
  offset = Math.max(
    0,
    Math.min(offset, node.nodeValue ? node.nodeValue.length : 0),
  );
  if (isCaret) {
    try {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {}
    return;
  }
  const anchorNode = sel.anchorNode;
  const anchorOffset = sel.anchorOffset;
  if (!anchorNode) return;
  if (typeof sel.extend === "function") {
    try {
      sel.extend(node, offset);
      return;
    } catch {}
  }
  const r = document.createRange();
  try {
    r.setStart(anchorNode, anchorOffset);
    r.setEnd(node, offset);
  } catch {
    r.setStart(node, offset);
    r.setEnd(anchorNode, anchorOffset);
  }
  sel.removeAllRanges();
  sel.addRange(r);
}

export function fallbackLineBoundary(dir, forCaret) {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return false;
  const block = getBlockAncestor(sel.focusNode);
  if (!block) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let first = null;
  let last = null;
  let node;
  while ((node = walker.nextNode())) {
    if (!first) first = node;
    last = node;
  }
  if (!first || !last) return false;
  let targetNode;
  let targetOffset;
  if (dir < 0) {
    targetNode = first;
    targetOffset = 0;
    if (!forCaret) {
      const txt = targetNode.nodeValue;
      let off = 0;
      while (off < txt.length && /\s/.test(txt[off])) off++;
      targetOffset = off;
    }
  } else {
    targetNode = last;
    targetOffset = last.nodeValue.length;
  }
  setPosition(targetNode, targetOffset, forCaret);
  return true;
}

export function fallbackFirstNonBlank(forCaret) {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return false;
  const block = getBlockAncestor(sel.focusNode);
  if (!block) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const txt = node.nodeValue;
    for (let i = 0; i < txt.length; i++) {
      if (!/\s/.test(txt[i])) {
        setPosition(node, i, forCaret);
        return true;
      }
    }
  }
  return fallbackLineBoundary(-1, forCaret);
}

export function fallbackDocBoundary(dir, isCaret) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let first = null;
  let last = null;
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    if (!first) first = n;
    last = n;
  }
  if (!first || !last) return false;
  if (dir < 0) setPosition(first, 0, isCaret);
  else setPosition(last, last.nodeValue.length, isCaret);
  return true;
}

export function fallbackMoveWordEnd(count, isCaret) {
  const pos = findNextWordEnd(count);
  if (!pos) return false;
  setPosition(pos.node, pos.offset, isCaret);
  return true;
}

export function fallbackExtendWordEnd(count, isCaret) {
  const pos = findNextWordEnd(count);
  if (!pos) return false;
  setPosition(pos.node, pos.offset + 1, isCaret);
  return true;
}

export function fallbackMoveLine(dir, forCaret) {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect) return false;
    const x = rect.left + 2;
    const lineH = Math.max(12, rect.height) || 16;
    const y = dir < 0 ? rect.top - lineH * 0.6 : rect.bottom + lineH * 0.6;
    let newRange = null;
    if (document.caretRangeFromPoint) {
      newRange = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        newRange = document.createRange();
        newRange.setStart(pos.offsetNode, pos.offset);
        newRange.collapse(true);
      }
    }
    const origNode = sel.focusNode;
    const origOff = sel.focusOffset;
    if (
      newRange &&
      !(
        newRange.startContainer === origNode && newRange.startOffset === origOff
      )
    ) {
      if (forCaret) {
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      } else {
        const anchorNode = sel.anchorNode;
        const anchorOffset = sel.anchorOffset;
        if (anchorNode && typeof sel.extend === "function") {
          try {
            sel.extend(newRange.startContainer, newRange.startOffset);
            return true;
          } catch {}
        }
        const r = document.createRange();
        try {
          r.setStart(anchorNode, anchorOffset);
          r.setEnd(newRange.startContainer, newRange.startOffset);
        } catch {
          r.setStart(newRange.startContainer, newRange.startOffset);
          r.setEnd(anchorNode, anchorOffset);
        }
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return true;
    }
  } catch {}
  try {
    const curRect = getSelection().getRangeAt(0).getBoundingClientRect();
    const candidates = collectVisualTextElements();
    let best = null;
    let bestDist = Infinity;
    for (const el of candidates) {
      const r = getRealRect(el);
      if (!r || r.width < 5 || r.height < 5) continue;
      if (dir < 0) {
        if (r.bottom >= curRect.top - 2) continue;
        const vDist = curRect.top - r.bottom;
        const hDist = Math.abs(
          r.left + r.width / 2 - (curRect.left + curRect.width / 2),
        );
        const dist = vDist * 1.2 + hDist * 0.3;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      } else {
        if (r.top <= curRect.bottom + 2) continue;
        const vDist = r.top - curRect.bottom;
        const hDist = Math.abs(
          r.left + r.width / 2 - (curRect.left + curRect.width / 2),
        );
        const dist = vDist * 1.2 + hDist * 0.3;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
    }
    if (best) {
      const walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim())
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let first = walker.nextNode();
      if (!first) return false;
      const targetNode =
        dir < 0
          ? (() => {
              let last = first;
              let n2;
              while ((n2 = walker.nextNode())) last = n2;
              return last;
            })()
          : first;
      const targetOffset = dir < 0 ? targetNode.nodeValue.length : 0;
      setPosition(targetNode, targetOffset, forCaret);
      return true;
    }
  } catch {}
  return false;
}

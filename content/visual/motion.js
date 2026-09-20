/* global NodeFilter */

import { isWordChar } from "./word.js";

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

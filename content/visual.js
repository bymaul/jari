/* eslint-disable */
import { register } from "./overlays.js";
import { ui } from "./ui.js";
import { settings } from "./settings.js";
import {
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  getRealRect,
} from "./hints-elements.js";
import { overlaySelectors } from "./keymap.js";

let active = false;
let mode = "visual"; // "visual" | "line"
let pillEl = null;
let pendingCount = "";
let pendingG = false;
let pendingF = null;

let caretEl = null;
let caretHost = null;

let hintActive = false;
let hintElements = [];
let hintLabels = [];
let hintPrefix = "";
let hintHost = null;
let hintHolder = null;
let hintMap = new Map();
let pendingVisualMode = "visual";

function isActive() {
  return active || hintActive;
}
function showPill() {
  if (pillEl) return;
  try {
    pillEl = document.createElement("div");
    pillEl.className = "jari-pill";
    pillEl.textContent = mode === "line" ? "visual line" : "visual";
    ui.statusContainer().appendChild(pillEl);
  } catch {}
}

function hidePill() {
  if (!pillEl) return;
  try {
    pillEl.remove();
  } catch {}
  pillEl = null;
}

function getSelection() {
  return window.getSelection();
}

function hasModify() {
  const sel = getSelection();
  return sel && typeof sel.modify === "function";
}

function showBlockCaret() {
  if (caretEl) return;
  try {
    caretHost = document.createElement("div");
    caretHost.className = "jari-visual-caret-host";
    caretHost.style.position = "fixed";
    caretHost.style.left = "0";
    caretHost.style.top = "0";
    caretHost.style.width = "0";
    caretHost.style.height = "0";
    caretHost.style.pointerEvents = "none";
    caretHost.style.zIndex = "2147483646";
    try {
      caretHost.attachShadow({ mode: "open" });
    } catch {
      caretHost.shadowRoot = caretHost;
    }
    const shadow = caretHost.shadowRoot;
    const style = document.createElement("style");
    style.textContent = `
      .jari-visual-caret {
        position: absolute;
        width: 8px;
        height: 1.2em;
        background: #e0a363;
        opacity: 0.85;
        border: 1px solid #c38a22;
        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        animation: jari-caret-blink 1s steps(1) infinite;
        pointer-events: none;
      }
      @keyframes jari-caret-blink {
        0%, 50% { opacity: 0.85; }
        51%, 100% { opacity: 0; }
      }
    `;
    shadow.appendChild(style);
    caretEl = document.createElement("div");
    caretEl.className = "jari-visual-caret";
    shadow.appendChild(caretEl);
    (document.documentElement || document.body).appendChild(caretHost);
  } catch {}
}

function hideBlockCaret() {
  if (caretHost) {
    try {
      caretHost.remove();
    } catch {}
    caretHost = null;
    caretEl = null;
  } else if (caretEl) {
    try {
      caretEl.remove();
    } catch {}
    caretEl = null;
  }
}

function updateBlockCaret() {
  if (!active || !caretEl || !caretHost) return;
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const range = sel.getRangeAt(0);
    let rect = null;
    try {
      // Use focus position for caret
      const focusNode = sel.focusNode;
      const focusOffset = sel.focusOffset;
      if (focusNode) {
        const r = document.createRange();
        r.setStart(focusNode, focusOffset);
        r.collapse(true);
        rect = r.getBoundingClientRect();
        // If rect is empty (e.g., at line end), try focusNode parent
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          rect = range.getBoundingClientRect();
        }
      } else {
        rect = range.getBoundingClientRect();
      }
    } catch {
      rect = range.getBoundingClientRect();
    }
    if (!rect) return;
    // If rect is zero, hide
    if (rect.width === 0 && rect.height === 0) {
      const el = sel.focusNode && sel.focusNode.parentElement ? sel.focusNode.parentElement : null;
      if (el) rect = el.getBoundingClientRect();
    }
    const hostShadow = caretHost.shadowRoot || caretHost;
    // caretHost is fixed at 0,0, so caret position is viewport coords
    caretEl.style.left = `${rect.left}px`;
    caretEl.style.top = `${rect.top}px`;
    caretEl.style.height = `${Math.max(12, rect.height)}px`;
    // Adjust for line mode: block across line?
    if (mode === "line") {
      caretEl.style.width = `${Math.max(20, rect.width)}px`;
      caretEl.style.opacity = "0.35";
    } else {
      caretEl.style.width = `7px`;
      caretEl.style.opacity = "0.85";
    }
  } catch {}
}

function ensureVisible() {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
      const node = sel.focusNode;
      if (node && node.parentElement) {
        node.parentElement.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return;
    }
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (rect.top < 0 || rect.bottom > vh || rect.left < 0 || rect.right > vw) {
      const el = sel.focusNode && sel.focusNode.parentElement ? sel.focusNode.parentElement : null;
      if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      else window.scrollBy(0, rect.top - vh / 2);
    }
  } catch {}
  updateBlockCaret();
}

function normalizeCharset() {
  const s = settings.getHintChars();
  if (!s) return "asdfgqwertzxcvb";
  return s.toLowerCase();
}

function hasPrefixConflict(labels) {
  for (let i = 0; i < labels.length; i++) {
    for (let j = 0; j < labels.length; j++) {
      if (i !== j && labels[j].startsWith(labels[i])) return true;
    }
  }
  return false;
}

function buildUniformLabels(count, chars) {
  let length = 1;
  while (Math.pow(chars.length, length) < count) length++;
  const out = [];
  for (let k = 0; k < count; k++) {
    let n = k;
    let s = "";
    for (let p = 0; p < length; p++) {
      s = chars[n % chars.length] + s;
      n = Math.floor(n / chars.length);
    }
    out.push(s);
  }
  return out;
}

function genLabels(count, charset) {
  const chars = (charset || normalizeCharset()).toUpperCase().split("");
  if (count <= 0 || chars.length < 2) return [];
  if (count <= chars.length) return chars.slice(0, count);
  const labels = chars.slice();
  let head = 0;
  while (labels.length - head < count) {
    if (head >= labels.length) break;
    const p = labels[head++];
    for (const c of chars) {
      labels.push(p + c);
      if (labels.length - head >= count) break;
      if (labels.length > 10000) break;
    }
    if (labels.length > 10000) break;
  }
  const out = labels.slice(head, head + count);
  return hasPrefixConflict(out) ? buildUniformLabels(count, chars) : out;
}

function getZIndex(node) {
  let z = 0;
  try {
    do {
      const v = parseInt(window.getComputedStyle(node).getPropertyValue("z-index"));
      if (!isNaN(v) && v >= 0) z += v;
      node = node.parentNode;
    } while (node && node !== document.body && node !== document && node.nodeType !== 11);
  } catch {}
  return z;
}

function placeHintsHost(host) {
  try {
    const topLayer = document.querySelector("dialog[open]");
    if (topLayer) {
      const r = topLayer.getBoundingClientRect();
      const style = window.getComputedStyle(topLayer);
      if (r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden") {
        topLayer.appendChild(host);
        return;
      }
    }
  } catch {}
  (document.documentElement || document.body).appendChild(host);
}

function coordinate(holderEl) {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.textContent = "A";
  holderEl.prepend(probe);
  const br = probe.getBoundingClientRect();
  const ret = {
    top: br.top + window.pageYOffset - document.documentElement.clientTop,
    left: br.left + window.pageXOffset - document.documentElement.clientLeft,
  };
  try { probe.remove(); } catch {}
  return ret;
}

function collectVisualTextElements() {
  let elements = getVisibleElements((e, v) => {
    try {
      if (e.closest && e.closest(overlaySelectors)) return;
      if (e.closest && e.closest(".jari-visual-caret-host, .jari-visual-caret")) return;
    } catch {}
    const text = e.textContent ? e.textContent.trim() : "";
    if (!text) return;
    if (text.length < 1) return;
    // Only consider elements that have direct text or are block-like
    // Filter to avoid huge container like body that contains all text
    // Prefer leaf elements with text
    if (e.children.length === 0) {
      v.push(e);
    } else {
      // If element has direct text node children, include
      let hasDirectText = false;
      for (const n of e.childNodes) {
        if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim().length > 2) {
          hasDirectText = true;
          break;
        }
      }
      if (hasDirectText) v.push(e);
    }
  });
  elements = filterInvisibleElements(elements);
  elements = filterOverlapElements(elements);
  // Dedupe and limit
  const seen = new Set();
  const out = [];
  for (const el of elements) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
    if (out.length >= 400) break;
  }
  // If still too many, filter to larger text blocks
  if (out.length > 200) {
    return out.filter(e => (e.textContent.trim().length > 10)).slice(0, 300);
  }
  return out;
}

function updateHintText(hintEl, label, typed) {
  hintEl.textContent = "";
  if (!typed) {
    hintEl.textContent = label;
    return;
  }
  if (label.startsWith(typed)) {
    const pre = document.createElement("span");
    pre.className = "jari-hint-matched";
    pre.textContent = typed;
    const rest = document.createElement("span");
    rest.textContent = label.slice(typed.length);
    hintEl.append(pre, rest);
    hintEl.classList.remove("jari-hint-hidden");
  } else {
    hintEl.textContent = label;
  }
}

function renderHints() {
  if (hintHost) {
    try { hintHost.remove(); } catch {}
    hintHost = null;
    hintHolder = null;
  }
  hintHost = document.createElement("div");
  hintHost.className = "jari-hints-host";
  hintHost.style.position = "fixed";
  hintHost.style.left = "0";
  hintHost.style.top = "0";
  hintHost.style.width = "0";
  hintHost.style.height = "0";
  hintHost.style.overflow = "visible";
  hintHost.style.pointerEvents = "none";
  hintHost.style.zIndex = "2147483647";
  try {
    hintHost.attachShadow({ mode: "open" });
  } catch {
    hintHost.shadowRoot = hintHost;
  }
  const shadow = hintHost.shadowRoot;
  const style = document.createElement("style");
  style.textContent = `
    .jari-hints { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .jari-hint { position: absolute; display: inline-block; box-sizing: border-box; font-family: monospace; font-size: 10px; font-weight: bold; line-height: 1; letter-spacing: 0.02em; padding: 1px 3px; border: 1px solid #c38a22; border-radius: 3px; background: linear-gradient(#fff785, #ffc542); color: #1a1a1a; text-transform: uppercase; white-space: nowrap; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,0.35); text-align: left; }
    .jari-hint-matched { color: #6a6a6a; opacity: 0.45; }
    .jari-hint-hidden { opacity: 0; display: none; }
  `;
  shadow.appendChild(style);
  hintHolder = document.createElement("section");
  hintHolder.className = "jari-hints";
  hintHolder.style.display = "block";
  hintHolder.style.opacity = "1";
  shadow.appendChild(hintHolder);
  placeHintsHost(hintHost);

  const charset = normalizeCharset();
  const labels = genLabels(hintElements.length, charset);
  hintLabels = labels;
  hintMap.clear();

  const bof = (() => {
    try { return coordinate(hintHolder); } catch { return { top: 0, left: 0 }; }
  })();

  let lastTop = -1;
  let lastLeft = -1;
  const hintEls = hintElements.map((elm, i) => {
    const r = getRealRect(elm);
    const z = getZIndex(elm);
    const left = window.pageXOffset + r.left - bof.left;
    const link = document.createElement("div");
    link.className = "jari-hint";
    link.textContent = labels[i];
    link.dataset.label = labels[i];
    let lTop = Math.max(r.top + window.pageYOffset - bof.top, 0);
    if (lTop === lastTop && Math.abs(left - lastLeft) < 20) {
      link.style.left = `${left + 20 - Math.abs(left - lastLeft)}px`;
    } else if (left === lastLeft && Math.abs(lTop - lastTop) < 20) {
      lTop += 20 - Math.abs(lTop - lastTop);
      link.style.left = `${left}px`;
    } else {
      link.style.left = `${left}px`;
    }
    link.style.top = `${lTop}px`;
    link.style.zIndex = String(z + 9999);
    link.label = labels[i];
    link.targetEl = elm;
    updateHintText(link, labels[i], "");
    lastTop = lTop;
    lastLeft = parseInt(link.style.left, 10);
    hintMap.set(labels[i], { el: elm, hintEl: link });
    return link;
  });

  hintEls.forEach(link => hintHolder.appendChild(link));
  refreshHints();
}

function refreshHints() {
  if (!hintActive) return;
  for (const [label, obj] of hintMap.entries()) {
    const hintEl = obj.hintEl;
    if (!hintPrefix) {
      hintEl.style.opacity = "1";
      hintEl.style.display = "";
      hintEl.classList.remove("jari-hint-hidden");
      updateHintText(hintEl, label, "");
    } else if (label === hintPrefix) {
      hintEl.style.opacity = "1";
    } else if (label.startsWith(hintPrefix)) {
      hintEl.style.opacity = "1";
      hintEl.style.display = "";
      updateHintText(hintEl, label, hintPrefix);
    } else {
      hintEl.style.opacity = "0";
      hintEl.style.display = "none";
    }
  }
}

function showVisualHints(requestedMode) {
  pendingVisualMode = requestedMode || "visual";
  const elements = collectVisualTextElements();
  if (elements.length === 0) {
    ui.toast("No text to select");
    return;
  }
  hintElements = elements.length > 300 ? elements.slice(0, 300) : elements;
  hintPrefix = "";
  hintActive = true;
  renderHints();
  // pill for hinting
  if (!pillEl) {
    try {
      pillEl = document.createElement("div");
      pillEl.className = "jari-pill";
      pillEl.textContent = "visual hint";
      ui.statusContainer().appendChild(pillEl);
    } catch {}
  } else {
    pillEl.textContent = "visual hint";
  }
  ui.toast(`Hints: ${hintElements.length} text targets`);
}

function closeHints() {
  if (!hintActive) return;
  hintActive = false;
  hintPrefix = "";
  hintElements = [];
  hintLabels = [];
  hintMap.clear();
  if (hintHost) {
    try { hintHost.remove(); } catch {}
    hintHost = null;
    hintHolder = null;
  }
  // restore pill if visual active, else hide
  if (!active && pillEl) {
    try { pillEl.remove(); } catch {}
    pillEl = null;
  } else if (active && pillEl) {
    pillEl.textContent = mode === "line" ? "visual line" : "visual";
  }
}

function activateHintByLabel(label) {
  const entry = hintMap.get(label);
  if (!entry) return false;
  const el = entry.el;
  closeHints();
  // Now enter visual at this element
  enterAtElement(el, pendingVisualMode);
  return true;
}

function enterAtElement(el, newMode) {
  if (active) close(false);
  mode = newMode || "visual";
  let range = null;
  try {
    // Find first text node in element
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const first = walker.nextNode();
    if (first) {
      range = document.createRange();
      range.setStart(first, 0);
      range.collapse(true);
      // For line mode, we want to select the whole element's line, but start collapsed then extend
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
    }
  } catch {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
  }
  const sel = window.getSelection();
  if (!sel) return;
  try {
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  // For visual, extend by one char to show selection
  if (mode !== "line" && sel.isCollapsed) {
    if (hasModify()) {
      try { sel.modify("extend", "forward", "character"); } catch {}
    }
  }
  if (mode === "line") {
    // Expand to line: select whole element's text as line
    try {
      // Try to expand to line boundaries
      if (hasModify()) {
        sel.modify("extend", "forward", "lineboundary");
        // For line mode, we want full line, so also extend backward to start
        // But selection is at start, extending forward to line end gives one line
        // That's okay for single line element
      } else {
        // fallback: select element contents
        const r2 = document.createRange();
        r2.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r2);
      }
    } catch {
      const r2 = document.createRange();
      r2.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r2);
    }
  }
  active = true;
  showPill();
  showBlockCaret();
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  ui.toast(mode === "line" ? "Visual line" : "Visual");
  ensureVisible();
  updateBlockCaret();
}

function extendSelection(direction, granularity) {
  const sel = getSelection();
  if (!sel) return false;
  if (hasModify()) {
    try {
      sel.modify("extend", direction, granularity);
      return true;
    } catch {}
  }
  return false;
}

function doMoveChar(dir) {
  const ok = extendSelection(dir < 0 ? "left" : "right", "character");
  if (!ok) fallbackMoveChar(dir);
  ensureVisible();
  updateBlockCaret();
}

function fallbackMoveChar(dir) {
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
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      walker.currentNode = node;
      const prev = walker.previousNode();
      if (prev) {
        newNode = prev;
        newOffset = prev.nodeValue.length - 1;
        if (newOffset < 0) newOffset = 0;
      } else {
        return;
      }
    } else if (newOffset > text.length) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
      } catch { return; }
    }
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {}
}

function doMoveLine(dir) {
  const ok = extendSelection(dir < 0 ? "backward" : "forward", "line");
  if (!ok) ui.toast("No line move");
  ensureVisible();
  updateBlockCaret();
}

function doMoveWord(dir) {
  const ok = extendSelection(dir < 0 ? "backward" : "forward", "word");
  if (!ok) ui.toast("No word move");
  ensureVisible();
  updateBlockCaret();
}

function doMoveWordEnd(dir) {
  const ok = extendSelection("forward", "word");
  if (ok) {
    extendSelection("backward", "character");
  }
  ensureVisible();
  updateBlockCaret();
}

function doLineBoundary(dir) {
  const gran = "lineboundary";
  const ok = extendSelection(dir < 0 ? "backward" : "forward", gran);
  if (!ok) ui.toast("No line boundary");
  ensureVisible();
  updateBlockCaret();
}

function doDocBoundary(dir) {
  const gran = "documentboundary";
  extendSelection(dir < 0 ? "backward" : "forward", gran);
  ensureVisible();
  updateBlockCaret();
}

function doFirstNonBlank() {
  doLineBoundary(-1);
}

function swapAnchorFocus() {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchorNode = sel.anchorNode;
  const anchorOffset = sel.anchorOffset;
  const focusNode = sel.focusNode;
  const focusOffset = sel.focusOffset;
  if (!anchorNode || !focusNode) return;
  try {
    const r = document.createRange();
    r.setStart(focusNode, focusOffset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    if (typeof sel.extend === "function") {
      sel.extend(anchorNode, anchorOffset);
    } else {
      const r2 = document.createRange();
      r2.setStart(anchorNode, anchorOffset);
      r2.setEnd(focusNode, focusOffset);
      sel.removeAllRanges();
      sel.addRange(r2);
    }
    ensureVisible();
    updateBlockCaret();
  } catch {}
}

function yankSelection() {
  const sel = getSelection();
  if (!sel) return;
  const text = sel.toString();
  if (!text) {
    ui.toast("No selection");
    return;
  }
  ui.copyText(text).then(() => ui.toast(`Yanked ${text.length} chars`)).catch(() => ui.toast("Yank failed"));
}

function handleFChar(ch) {
  const sel = getSelection();
  if (!sel) return;
  const focusNode = sel.focusNode;
  const focusOffset = sel.focusOffset;
  if (!focusNode) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let startFound = false;
  let node = walker.nextNode();
  while (node) {
    if (node === focusNode) {
      startFound = true;
      const text = node.nodeValue;
      let idx = -1;
      if (pendingF && pendingF.dir === "forward") {
        idx = text.indexOf(ch, focusOffset + 1);
      } else if (pendingF && pendingF.dir === "backward") {
        idx = text.lastIndexOf(ch, focusOffset - 1);
      }
      if (idx !== -1) {
        let finalOffset = idx;
        if (pendingF && pendingF.till) {
          finalOffset = pendingF.dir === "forward" ? idx : idx + 1;
        } else {
          finalOffset = pendingF.dir === "forward" ? idx + 1 : idx;
        }
        moveToPosition(node, finalOffset);
        ui.toast(`${pendingF.till ? "t" : "f"}${ch}`);
        pendingF = null;
        return;
      }
    } else if (startFound) {
      const text = node.nodeValue;
      let idx = -1;
      if (pendingF && pendingF.dir === "forward") idx = text.indexOf(ch);
      else idx = text.lastIndexOf(ch);
      if (idx !== -1) {
        let finalOffset = idx;
        if (pendingF.dir === "forward" && !pendingF.till) finalOffset = idx + 1;
        if (pendingF.dir === "backward" && pendingF.till) finalOffset = idx + 1;
        moveToPosition(node, finalOffset);
        ui.toast(`${pendingF.till ? "t" : "f"}${ch}`);
        pendingF = null;
        return;
      }
    }
    node = walker.nextNode();
  }
  ui.toast(`Not found: ${ch}`);
  pendingF = null;
}

function moveToPosition(node, offset) {
  const sel = getSelection();
  if (!sel) return;
  offset = Math.max(0, Math.min(offset, node.nodeValue ? node.nodeValue.length : 0));
  const anchorNode = sel.anchorNode;
  const anchorOffset = sel.anchorOffset;
  if (!anchorNode) return;
  if (typeof sel.extend === "function") {
    try {
      sel.extend(node, offset);
      ensureVisible();
      updateBlockCaret();
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
  ensureVisible();
  updateBlockCaret();
}

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function getRepeatCount() {
  const n = parseInt(pendingCount || "1", 10);
  const c = Number.isNaN(n) ? 1 : Math.max(1, n);
  pendingCount = "";
  return c;
}

function collapseToFocus() {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const focusNode = sel.focusNode;
    const focusOffset = sel.focusOffset;
    if (focusNode) {
      const r = document.createRange();
      r.setStart(focusNode, focusOffset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  } catch {}
}

function enter(newMode) {
  // Show hints for text selection instead of immediate visual
  if (hintActive) closeHints();
  if (active) close(false);
  pendingVisualMode = newMode || "visual";
  showVisualHints(pendingVisualMode);
}

function close(keepSelection = false) {
  if (hintActive) closeHints();
  if (!active) return;
  active = false;
  hidePill();
  hideBlockCaret();
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  if (!keepSelection) {
    const sel = getSelection();
    if (sel) {
      try { sel.removeAllRanges(); } catch {}
    }
  }
  // TODO: enter caret mode on Esc visual mode (show collapsed block caret at focus instead of clearing)
}

function onKeyDown(event) {
  if (hintActive) {
    const key = event.key;
    if (key === "Escape") {
      consume(event);
      if (hintPrefix) {
        hintPrefix = "";
        refreshHints();
      } else {
        closeHints();
      }
      return true;
    }
    if (key === "Backspace") {
      consume(event);
      if (hintPrefix) {
        hintPrefix = hintPrefix.slice(0, -1);
        refreshHints();
      } else {
        closeHints();
      }
      return true;
    }
    if (key === "Enter") {
      consume(event);
      const visible = Array.from(hintMap.entries()).filter(([label]) => label.startsWith(hintPrefix));
      if (visible.length === 1) {
        activateHintByLabel(visible[0][0]);
      }
      return true;
    }
    if (key.length === 1) {
      const charset = normalizeCharset();
      const lower = key.toLowerCase();
      if (charset.includes(lower)) {
        consume(event);
        const next = hintPrefix + lower.toUpperCase();
        const exact = hintMap.get(next);
        hintPrefix = next;
        refreshHints();
        if (exact) {
          activateHintByLabel(next);
        }
        return true;
      }
    }
    consume(event);
    return true;
  }

  if (!active) return false;

  if (pendingF) {
    const ch = event.key;
    if (ch.length === 1) {
      consume(event);
      handleFChar(ch);
      return true;
    }
    if (ch === "Escape") {
      consume(event);
      pendingF = null;
      ui.toast("Cancelled");
      return true;
    }
    consume(event);
    return true;
  }

  const key = event.key;

  if (key === "Escape") {
    consume(event);
    close(false);
    ui.toast("Exited visual");
    return true;
  }

  if (/^[0-9]$/.test(key)) {
    if (key === "0" && pendingCount === "") {
    } else {
      consume(event);
      if (pendingCount.length < 9) pendingCount += key;
      if (pillEl) pillEl.textContent = (mode === "line" ? "visual line" : "visual") + " " + pendingCount;
      return true;
    }
  }

  if (key === "f" || key === "F" || key === "t" || key === "T") {
    const isUpper = key === "F" || key === "T";
    const till = key === "t" || key === "T";
    const dir = isUpper ? "backward" : "forward";
    pendingF = { dir, till };
    consume(event);
    ui.toast(`/${till ? "t" : "f"}-char…`);
    return true;
  }
  if (key === ";" || key === ",") {
    consume(event);
    ui.toast("No f/t yet");
    return true;
  }

  if (key === "g") {
    if (pendingG) {
      consume(event);
      getRepeatCount();
      doDocBoundary(-1);
      pendingG = false;
      if (pillEl) pillEl.textContent = mode === "line" ? "visual line" : "visual";
      return true;
    } else {
      consume(event);
      pendingG = true;
      if (pillEl) pillEl.textContent = (mode === "line" ? "visual line" : "visual") + " g";
      setTimeout(() => { pendingG = false; if (pillEl && pillEl.textContent.endsWith(" g")) pillEl.textContent = mode === "line" ? "visual line" : "visual"; }, 1500);
      return true;
    }
  }
  if (pendingG) {
    pendingG = false;
    if (pillEl) pillEl.textContent = mode === "line" ? "visual line" : "visual";
  }

  let repeat = 1;
  if (pendingCount) {
    repeat = getRepeatCount();
  }

  switch (key) {
    case "h":
    case "ArrowLeft":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveChar(-1);
      break;
    case "l":
    case "ArrowRight":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveChar(1);
      break;
    case "j":
    case "ArrowDown":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveLine(1);
      break;
    case "k":
    case "ArrowUp":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveLine(-1);
      break;
    case "w":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveWord(1);
      break;
    case "b":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveWord(-1);
      break;
    case "e":
      consume(event);
      for (let i = 0; i < repeat; i++) doMoveWordEnd(1);
      break;
    case "0":
      consume(event);
      doLineBoundary(-1);
      break;
    case "^":
      consume(event);
      doFirstNonBlank();
      break;
    case "$":
      consume(event);
      for (let i = 0; i < repeat; i++) doLineBoundary(1);
      break;
    case "G":
      consume(event);
      doDocBoundary(1);
      break;
    case "g":
      consume(event);
      ui.toast("Use gg");
      break;
    case "o":
      consume(event);
      swapAnchorFocus();
      break;
    case "y":
      consume(event);
      yankSelection();
      close(false);
      break;
    case "v":
      consume(event);
      if (mode === "visual") {
        close(false);
        ui.toast("Exited visual");
      } else {
        close(false);
        enter("visual");
      }
      break;
    case "V":
      consume(event);
      if (mode === "line") {
        close(false);
        ui.toast("Exited visual line");
      } else {
        close(false);
        enter("line");
      }
      break;
    case "d":
    case "x":
      consume(event);
      yankSelection();
      try { document.execCommand("delete"); } catch {}
      close(false);
      break;
    case "Y":
      consume(event);
      yankSelection();
      close(false);
      break;
    default:
      if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        consume(event);
        ui.toast(`No visual: ${key}`);
      } else {
        consume(event);
      }
      break;
  }
  pendingCount = "";
  return true;
}

export const Visual = {
  enter,
  close,
  isActive,
  onKeyDown,
  showBlockCaret,
  hideBlockCaret,
  updateBlockCaret,
};

register("visual", { close: ( ) => { closeHints(); close(false); }, onKeyDown, isActive });

export function __resetVisualState() {
  closeHints();
  close(false);
  pendingCount = "";
  pendingG = false;
  pendingF = null;
}

export function setVisualSelection(range, visualMode) {
  const sel = getSelection();
  if (!sel || !range) return;
  try {
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  if (!active) {
    mode = visualMode || "visual";
    active = true;
    showPill();
    showBlockCaret();
    pendingCount = "";
    pendingG = false;
    pendingF = null;
  }
  ensureVisible();
  updateBlockCaret();
}

export function clearVisualSelection() {
  hideBlockCaret();
  const sel = getSelection();
  if (sel) {
    try { sel.removeAllRanges(); } catch {}
  }
}

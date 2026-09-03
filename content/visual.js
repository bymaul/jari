/* eslint-disable */
import { register } from "./overlays.js";
import { ui } from "./ui.js";
import {
  normalizeCharset,
  genLabels,
  updateHintText,
  createHintsHost,
  layoutHints,
} from "./hint-layer.js";
import {
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  filterAncestors,
  getRealRect,
  getLinkAncestor,
} from "./hints-elements.js";
import { overlaySelectors } from "./keymap.js";

let active = false;
let mode = "visual"; // "visual" | "line" | "caret"
let pillEl = null;
let pendingCount = "";
let pendingG = false;
let pendingF = null;
let lastF = null;
let pendingY = false;
let caretRaf = null;

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

let findOpenHandler = null;
let findNavHandler = null;

let visualUseHighlights = false;
let visualFallbackSpans = [];

function isActive() {
  return active || hintActive;
}
function setFindOpen(handler) {
  findOpenHandler = handler;
}
function setFindNav(handler) {
  findNavHandler = handler;
}
function pillText(m) {
  if (m === "caret") return "caret";
  if (m === "line") return "visual line";
  return "visual";
}
function showPill() {
  if (pillEl) return;
  try {
    pillEl = document.createElement("div");
    pillEl.className = "jari-pill";
    pillEl.textContent = pillText(mode);
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
        will-change: transform;
        backface-visibility: hidden;
        transform: translate3d(0,0,0);
      }
      @keyframes jari-caret-blink {
        0%, 50% { opacity: 0.85; }
        51%, 100% { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .jari-visual-caret { animation: none !important; opacity: 0.9 !important; }
      }
      @media (forced-colors: active) {
        .jari-visual-caret { background: CanvasText !important; border-color: Canvas !important; forced-color-adjust: none; }
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

function updateBlockCaretImmediate() {
  if (!active || !caretEl || !caretHost) return;
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const range = sel.getRangeAt(0);
    let rect = null;
    try {
      const focusNode = sel.focusNode;
      const focusOffset = sel.focusOffset;
      if (focusNode) {
        const r = document.createRange();
        r.setStart(focusNode, focusOffset);
        r.collapse(true);
        rect = r.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          const cr = range.getClientRects();
          if (cr && cr.length) rect = cr[0];
          else rect = range.getBoundingClientRect();
        }
      } else {
        rect = range.getBoundingClientRect();
      }
    } catch {
      try {
        rect = range.getBoundingClientRect();
      } catch {
        rect = null;
      }
    }
    if (!rect) return;
    if (rect.width === 0 && rect.height === 0) {
      const el =
        sel.focusNode && sel.focusNode.parentElement
          ? sel.focusNode.parentElement
          : null;
      if (el) {
        const cr = el.getClientRects();
        if (cr && cr.length) rect = cr[0];
        else rect = el.getBoundingClientRect();
      }
    }
    if (!rect) return;
    caretEl.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    caretEl.style.height = `${Math.max(12, rect.height)}px`;
    if (mode === "line") {
      caretEl.style.width = `${Math.max(20, rect.width)}px`;
      caretEl.style.opacity = "0.35";
    } else {
      caretEl.style.width = `7px`;
      caretEl.style.opacity = "0.85";
    }
    try {
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        caretEl.style.animation = "none";
      }
    } catch {}
  } catch {}
}
function updateBlockCaret() {
  if (caretRaf) return;
  caretRaf = requestAnimationFrame(() => {
    caretRaf = null;
    updateBlockCaretImmediate();
  });
}

function ensureVisible() {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (
      !rect ||
      (rect.top === 0 &&
        rect.left === 0 &&
        rect.width === 0 &&
        rect.height === 0)
    ) {
      const node = sel.focusNode;
      if (node && node.parentElement) {
        node.parentElement.scrollIntoView({
          block: "nearest",
          inline: "nearest",
        });
      }
      return;
    }
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    if (rect.top < 0 || rect.bottom > vh || rect.left < 0 || rect.right > vw) {
      const el =
        sel.focusNode && sel.focusNode.parentElement
          ? sel.focusNode.parentElement
          : null;
      if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
      else window.scrollBy(0, rect.top - vh / 2);
    }
  } catch {}
  updateBlockCaret();
  applyVisualHighlight();
}

function attachCaretListeners() {
  try {
    window.addEventListener("scroll", updateBlockCaret, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", updateBlockCaret, { passive: true });
    document.addEventListener("scroll", updateBlockCaret, {
      passive: true,
      capture: true,
    });
  } catch {
    try {
      window.addEventListener("scroll", updateBlockCaret, true);
      window.addEventListener("resize", updateBlockCaret);
      document.addEventListener("scroll", updateBlockCaret, true);
    } catch {}
  }
  enableSelectOverride();
}
function detachCaretListeners() {
  try {
    window.removeEventListener("scroll", updateBlockCaret, { capture: true });
    window.removeEventListener("resize", updateBlockCaret);
    document.removeEventListener("scroll", updateBlockCaret, { capture: true });
  } catch {
    try {
      window.removeEventListener("scroll", updateBlockCaret, true);
      window.removeEventListener("resize", updateBlockCaret);
      document.removeEventListener("scroll", updateBlockCaret, true);
    } catch {}
  }
  if (caretRaf) {
    try {
      cancelAnimationFrame(caretRaf);
    } catch {}
    caretRaf = null;
  }
  if (!active && !hintActive) disableSelectOverride();
}
let selectOverrideEl = null;
function enableSelectOverride() {
  if (selectOverrideEl) return;
  try {
    selectOverrideEl = document.createElement("style");
    selectOverrideEl.id = "jari-select-override";
    selectOverrideEl.textContent = `*{-webkit-user-select:text !important;user-select:text !important;} [class*="select-none"]{-webkit-user-select:text !important;user-select:text !important;} .jari-visual-caret-host,*{ -webkit-user-drag: none !important; }`;
    (document.head || document.documentElement).appendChild(selectOverrideEl);
  } catch {}
}
function disableSelectOverride() {
  if (!selectOverrideEl) return;
  try {
    selectOverrideEl.remove();
  } catch {}
  selectOverrideEl = null;
}

function clearVisualHighlight() {
  try {
    if (CSS.highlights) CSS.highlights.delete("jari-visual");
  } catch {}
  for (const span of visualFallbackSpans) {
    try {
      const parent = span.parentNode;
      if (!parent) continue;
      const text = span.textContent;
      const tn = document.createTextNode(text);
      parent.replaceChild(tn, span);
      parent.normalize();
    } catch {}
  }
  visualFallbackSpans = [];
}
function applyVisualHighlight() {
  clearVisualHighlight();
  if (!active || mode === "caret") return;
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  try {
    const range = sel.getRangeAt(0).cloneRange();
    try {
      if (
        typeof CSS !== "undefined" &&
        CSS.highlights &&
        typeof Highlight !== "undefined"
      ) {
        CSS.highlights.set("jari-visual", new Highlight(range));
        visualUseHighlights = true;
        return;
      }
    } catch {
      visualUseHighlights = false;
    }
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

function collectVisualTextElements() {
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

function renderHints() {
  if (hintHost) {
    try {
      hintHost.remove();
    } catch {}
    hintHost = null;
    hintHolder = null;
  }
  const created = createHintsHost("cyan");
  hintHost = created.host;
  hintHolder = created.holder;

  const charset = normalizeCharset();
  const labels = genLabels(hintElements.length, charset);
  hintLabels = labels;
  hintMap.clear();

  const hintEls = layoutHints(hintHolder, hintElements, labels);
  for (const link of hintEls) {
    hintMap.set(link.label, { el: link.link, hintEl: link });
  }
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
  enableSelectOverride();
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
    try {
      hintHost.remove();
    } catch {}
    hintHost = null;
    hintHolder = null;
  }
  if (!active && !hintActive) disableSelectOverride();
  // restore pill if visual active, else hide
  if (!active && pillEl) {
    try {
      pillEl.remove();
    } catch {}
    pillEl = null;
  } else if (active && pillEl) {
    pillEl.textContent = pillText(mode);
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
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
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
      try {
        sel.modify("extend", "forward", "character");
      } catch {}
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
  attachCaretListeners();
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  pendingY = false;
  ensureVisible();
  updateBlockCaret();
  applyVisualHighlight();
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

function moveCaret(direction, granularity) {
  const sel = getSelection();
  if (!sel) return false;
  if (hasModify()) {
    try {
      sel.modify("move", direction, granularity);
      return true;
    } catch {}
  }
  return false;
}

function isCaret() {
  return mode === "caret";
}

function isWordChar(ch) {
  return ch && /[A-Za-z0-9_]/.test(ch);
}
function charAtFocus() {
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
function charBeforeFocus() {
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
function getBlockAncestor(node) {
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

function doMoveChar(dir) {
  if (isCaret()) {
    const ok = moveCaret(dir < 0 ? "left" : "right", "character");
    if (!ok) fallbackMoveCaret(dir);
    ensureVisible();
    updateBlockCaret();
    return;
  }
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
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
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

function fallbackMoveCaret(dir) {
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
        newOffset = prev.nodeValue.length - 1;
        if (newOffset < 0) newOffset = 0;
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
function fallbackMoveWord(dir) {
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
function fallbackExtendWord(dir) {
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
    const sel = getSelection();
    if (sel.focusNode === prevNode && sel.focusOffset === prevOff) return false;
  }
  return false;
}
function fallbackLineBoundary(dir, forCaret) {
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
  let first = null,
    last = null,
    node;
  while ((node = walker.nextNode())) {
    if (!first) first = node;
    last = node;
  }
  if (!first || !last) return false;
  let targetNode, targetOffset;
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
  moveToPosition(targetNode, targetOffset);
  return true;
}
function fallbackFirstNonBlank(forCaret) {
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
        moveToPosition(node, i);
        return true;
      }
    }
  }
  return fallbackLineBoundary(-1, forCaret);
}
function findNextWordEnd(count) {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return null;
  const startNode = sel.focusNode;
  const startOffset = sel.focusOffset;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let nodes = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n);
    n = walker.nextNode();
  }
  let startIdx = nodes.indexOf(startNode);
  if (startIdx === -1) return null;
  let found = 0;
  for (let i = startIdx; i < nodes.length; i++) {
    const node = nodes[i];
    const txt = node.nodeValue;
    let from = 0;
    if (i === startIdx) from = startOffset;
    let pos = from;
    let inWord = false;
    while (pos < txt.length) {
      if (!inWord) {
        while (pos < txt.length && !isWordChar(txt[pos])) pos++;
        if (pos >= txt.length) break;
        inWord = true;
      } else {
        while (pos < txt.length && isWordChar(txt[pos])) pos++;
        if (pos >= txt.length) break;
        inWord = false;
        const wordEnd = pos - 1;
        if (i === startIdx && wordEnd <= from) continue;
        found++;
        if (found === count) {
          return { node, offset: wordEnd };
        }
      }
    }
  }
  return null;
}
function fallbackMoveWordEnd(count) {
  const pos = findNextWordEnd(count);
  if (!pos) return false;
  moveToPosition(pos.node, pos.offset);
  return true;
}
function fallbackExtendWordEnd(count) {
  const pos = findNextWordEnd(count);
  if (!pos) return false;
  moveToPosition(pos.node, pos.offset + 1);
  return true;
}
function fallbackDocBoundary(dir, forCaret) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let first = null,
    last = null,
    n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    if (!first) first = n;
    last = n;
  }
  if (!first || !last) return false;
  if (dir < 0) moveToPosition(first, 0);
  else moveToPosition(last, last.nodeValue.length);
  return true;
}
function fallbackMoveLine(dir, forCaret) {
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
      moveToPosition(targetNode, targetOffset);
      return true;
    }
  } catch {}
  return false;
}

function doMoveLine(dir) {
  if (isCaret()) {
    let ok = moveCaret(dir < 0 ? "backward" : "forward", "line");
    if (!ok) ok = fallbackMoveLine(dir, true);
    if (!ok) ui.toast("No line move");
    ensureVisible();
    updateBlockCaret();
    return;
  }
  let ok = extendSelection(dir < 0 ? "backward" : "forward", "line");
  if (!ok) ok = fallbackMoveLine(dir, false);
  if (!ok) ui.toast("No line move");
  ensureVisible();
  updateBlockCaret();
}

function doMoveWord(dir) {
  if (isCaret()) {
    let ok = moveCaret(dir < 0 ? "backward" : "forward", "word");
    if (!ok) ok = fallbackMoveWord(dir);
    if (!ok) ui.toast("No word move");
    ensureVisible();
    updateBlockCaret();
    return;
  }
  let ok = extendSelection(dir < 0 ? "backward" : "forward", "word");
  if (!ok) ok = fallbackExtendWord(dir);
  if (!ok) ui.toast("No word move");
  ensureVisible();
  updateBlockCaret();
}

function doMoveWordEnd(dir) {
  if (isCaret()) {
    if (!fallbackMoveWordEnd(1)) {
      let ok = moveCaret("forward", "word");
      if (ok) {
        if (!moveCaret("backward", "character")) fallbackMoveCaret(-1);
      } else {
        ui.toast("No word move");
      }
    }
    ensureVisible();
    updateBlockCaret();
    return;
  }
  if (!fallbackExtendWordEnd(1)) {
    let ok = extendSelection("forward", "word");
    if (ok) {
      if (!extendSelection("backward", "character")) fallbackMoveChar(-1);
    } else {
      ui.toast("No word move");
    }
  }
  ensureVisible();
  updateBlockCaret();
}

function doLineBoundary(dir) {
  const gran = "lineboundary";
  if (isCaret()) {
    let ok = moveCaret(dir < 0 ? "backward" : "forward", gran);
    if (!ok) ok = fallbackLineBoundary(dir, true);
    if (!ok) ui.toast("No line boundary");
    ensureVisible();
    updateBlockCaret();
    return;
  }
  let ok = extendSelection(dir < 0 ? "backward" : "forward", gran);
  if (!ok) ok = fallbackLineBoundary(dir, false);
  if (!ok) ui.toast("No line boundary");
  ensureVisible();
  updateBlockCaret();
}

function doDocBoundary(dir) {
  const gran = "documentboundary";
  if (isCaret()) {
    let ok = moveCaret(dir < 0 ? "backward" : "forward", gran);
    if (!ok) fallbackDocBoundary(dir, true);
    ensureVisible();
    updateBlockCaret();
    return;
  }
  let ok = extendSelection(dir < 0 ? "backward" : "forward", gran);
  if (!ok) fallbackDocBoundary(dir, false);
  ensureVisible();
  updateBlockCaret();
}
function doGoToLine(n) {
  const line = Math.max(1, Math.floor(n) || 1);
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        try {
          const style = window.getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden")
            return NodeFilter.FILTER_REJECT;
        } catch {}
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let idx = 0;
  let target = null;
  let node = walker.nextNode();
  while (node) {
    idx++;
    if (idx === line) {
      target = node;
      break;
    }
    node = walker.nextNode();
  }
  if (!target) {
    doDocBoundary(line === 1 ? -1 : 1);
    return;
  }
  moveToPosition(target, 0);
  ensureVisible();
  updateBlockCaret();
}

function doFirstNonBlank() {
  const forCaret = isCaret();
  if (!fallbackFirstNonBlank(forCaret)) {
    doLineBoundary(-1);
    const sel = getSelection();
    if (sel && sel.focusNode && sel.focusNode.nodeType === Node.TEXT_NODE) {
      const node = sel.focusNode;
      const off = sel.focusOffset;
      const txt = node.nodeValue;
      let newOff = off;
      while (newOff < txt.length && /\s/.test(txt[newOff])) newOff++;
      if (newOff !== off) moveToPosition(node, newOff);
    }
  } else {
    ensureVisible();
    updateBlockCaret();
  }
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
  ui.copyText(text)
    .then(() => ui.toast(`Yanked ${text.length} chars`))
    .catch(() => ui.toast("Yank failed"));
}

function yankLineFromCaret() {
  const sel = getSelection();
  if (!sel || !sel.focusNode) {
    ui.toast("No line");
    return;
  }
  const savedNode = sel.focusNode;
  const savedOffset = sel.focusOffset;
  let lineText = "";
  try {
    const moved = moveCaret("backward", "lineboundary");
    if (!moved) {
      fallbackMoveCaret(-1);
    }
    const atStartNode = sel.focusNode;
    const atStartOffset = sel.focusOffset;
    const wasCollapsed = sel.isCollapsed;
    if (wasCollapsed) {
      const ok = extendSelection("forward", "lineboundary");
      if (!ok) {
        const cur =
          sel.focusNode && sel.focusNode.parentElement
            ? sel.focusNode.parentElement
            : null;
        if (cur) lineText = cur.textContent || "";
        else lineText = sel.toString();
      } else {
        lineText = sel.toString();
        if (!lineText) {
          const cur =
            atStartNode && atStartNode.parentElement
              ? atStartNode.parentElement
              : null;
          lineText = cur ? cur.textContent || "" : "";
        }
      }
    } else {
      lineText = sel.toString();
    }
    if (lineText) lineText = lineText.trim();
  } catch {}
  try {
    const r = document.createRange();
    r.setStart(savedNode, savedOffset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    updateBlockCaret();
    ensureVisible();
  } catch {}
  if (!lineText) {
    ui.toast("No line");
    return;
  }
  ui.copyText(lineText)
    .then(() => ui.toast(`Yanked line ${lineText.length} chars`))
    .catch(() => ui.toast("Yank failed"));
}

function getCaretLinkElement() {
  const sel = getSelection();
  if (!sel || !sel.focusNode) return null;
  const el = sel.focusNode.parentElement || sel.focusNode.parentNode || null;
  return getLinkAncestor(el);
}

function activateCaretLink() {
  const link = getCaretLinkElement();
  if (!link) {
    ui.toast("No link at caret");
    return false;
  }
  try {
    ui.dispatchClick(link);
  } catch {}
  return true;
}

function handleFChar(ch) {
  const sel = getSelection();
  if (!sel) return;
  const focusNode = sel.focusNode;
  const focusOffset = sel.focusOffset;
  if (!focusNode || !pendingF) return;
  const dir = pendingF.dir;
  const till = pendingF.till;
  const count = pendingF.count || 1;
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let nodes = [];
  let n = walker.nextNode();
  while (n) {
    nodes.push(n);
    n = walker.nextNode();
  }
  let startIdx = nodes.indexOf(focusNode);
  if (startIdx === -1) {
    ui.toast(`Not found: ${ch}`);
    pendingF = null;
    return;
  }
  let found = 0;
  let targetNode = null;
  let targetOffset = -1;
  if (dir === "forward") {
    for (let i = startIdx; i < nodes.length; i++) {
      const node = nodes[i];
      const text = node.nodeValue;
      let from = 0;
      if (i === startIdx) from = focusOffset + 1;
      let idx = text.indexOf(ch, from);
      while (idx !== -1) {
        found++;
        if (found === count) {
          targetNode = node;
          targetOffset = till ? idx : idx + 1;
          break;
        }
        idx = text.indexOf(ch, idx + 1);
      }
      if (targetNode) break;
    }
  } else {
    for (let i = startIdx; i >= 0; i--) {
      const node = nodes[i];
      const text = node.nodeValue;
      let idx;
      if (i === startIdx) idx = text.lastIndexOf(ch, focusOffset - 1);
      else idx = text.lastIndexOf(ch);
      while (idx !== -1) {
        found++;
        if (found === count) {
          targetNode = node;
          targetOffset = till ? idx + 1 : idx;
          break;
        }
        idx = text.lastIndexOf(ch, idx - 1);
      }
      if (targetNode) break;
    }
  }
  if (targetNode) {
    moveToPosition(targetNode, targetOffset);
    lastF = { ch, dir, till, count };
    ui.toast(`${till ? "t" : "f"}${ch}`);
  } else {
    ui.toast(`Not found: ${ch}`);
  }
  pendingF = null;
}

function moveToPosition(node, offset) {
  const sel = getSelection();
  if (!sel) return;
  offset = Math.max(
    0,
    Math.min(offset, node.nodeValue ? node.nodeValue.length : 0),
  );
  if (isCaret()) {
    try {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {}
    ensureVisible();
    updateBlockCaret();
    return;
  }
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

function enterCaretAtFocus() {
  if (!active) return;
  collapseToFocus();
  mode = "caret";
  if (pillEl) pillEl.textContent = pillText(mode);
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  pendingY = false;
  showBlockCaret();
  attachCaretListeners();
  clearVisualHighlight();
  ensureVisible();
  updateBlockCaret();
}

function enter(newMode) {
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
  clearVisualHighlight();
  detachCaretListeners();
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  pendingY = false;
  if (!keepSelection) {
    const sel = getSelection();
    if (sel) {
      try {
        sel.removeAllRanges();
      } catch {}
    }
  }
}

function onKeyDown(event) {
  if (hintActive) {
    const key = event.key;
    if (key === "Escape") {
      ui.consume(event);
      if (hintPrefix) {
        hintPrefix = "";
        refreshHints();
      } else {
        closeHints();
      }
      return true;
    }
    if (key === "Backspace") {
      ui.consume(event);
      if (hintPrefix) {
        hintPrefix = hintPrefix.slice(0, -1);
        refreshHints();
      } else {
        closeHints();
      }
      return true;
    }
    if (key === "Enter") {
      ui.consume(event);
      const visible = Array.from(hintMap.entries()).filter(([label]) =>
        label.startsWith(hintPrefix),
      );
      if (visible.length === 1) {
        activateHintByLabel(visible[0][0]);
      }
      return true;
    }
    if (key.length === 1) {
      const charset = normalizeCharset();
      const lower = key.toLowerCase();
      if (charset.includes(lower)) {
        ui.consume(event);
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
    ui.consume(event);
    return true;
  }

  if (!active) return false;

  if (pendingF) {
    const ch = event.key;
    if (ch.length === 1) {
      ui.consume(event);
      handleFChar(ch);
      return true;
    }
    if (ch === "Escape") {
      ui.consume(event);
      pendingF = null;
      ui.toast("Cancelled");
      return true;
    }
    ui.consume(event);
    return true;
  }

  const key = event.key;

  if (key === "Escape") {
    ui.consume(event);
    if (isCaret()) {
      close(false);
    } else {
      enterCaretAtFocus();
      if (!active) {
        close(false);
      }
    }
    return true;
  }

  if (/^[0-9]$/.test(key)) {
    if (key === "0" && pendingCount === "") {
    } else {
      ui.consume(event);
      if (pendingCount.length < 9) pendingCount += key;
      if (pillEl) pillEl.textContent = pillText(mode) + " " + pendingCount;
      return true;
    }
  }

  if (key === "f" || key === "F" || key === "t" || key === "T") {
    const isUpper = key === "F" || key === "T";
    const till = key === "t" || key === "T";
    const dir = isUpper ? "backward" : "forward";
    const count = pendingCount ? parseInt(pendingCount, 10) || 1 : 1;
    pendingCount = "";
    if (pillEl) pillEl.textContent = pillText(mode);
    pendingF = { dir, till, count };
    ui.consume(event);
    ui.toast(`/${till ? "t" : "f"}-char…`);
    return true;
  }
  if (key === ";" || key === ",") {
    ui.consume(event);
    if (!lastF) {
      ui.toast("No f/t yet");
      return true;
    }
    const isReverse = key === ",";
    let dir = lastF.dir;
    if (isReverse) dir = dir === "forward" ? "backward" : "forward";
    const count = pendingCount ? parseInt(pendingCount, 10) || 1 : 1;
    pendingCount = "";
    if (pillEl) pillEl.textContent = pillText(mode);
    pendingF = { dir, till: lastF.till, count };
    handleFChar(lastF.ch);
    return true;
  }

  if (key === "g") {
    if (pendingG) {
      ui.consume(event);
      const n = getRepeatCount();
      if (n > 1) doGoToLine(n);
      else doDocBoundary(-1);
      pendingG = false;
      if (pillEl) pillEl.textContent = pillText(mode);
      return true;
    } else {
      ui.consume(event);
      pendingG = true;
      if (pillEl) pillEl.textContent = pillText(mode) + " g";
      setTimeout(() => {
        pendingG = false;
        if (pillEl && pillEl.textContent.endsWith(" g"))
          pillEl.textContent = pillText(mode);
      }, 1500);
      return true;
    }
  }
  if (pendingG) {
    pendingG = false;
    if (pillEl) pillEl.textContent = pillText(mode);
  }

  let repeat = 1;
  if (pendingCount) {
    repeat = getRepeatCount();
  }

  if (isCaret()) {
    if (pendingY) {
      pendingY = false;
      if (pillEl && pillEl.textContent.endsWith(" y"))
        pillEl.textContent = pillText(mode);
      if (key === "y") {
        ui.consume(event);
        for (let i = 0; i < repeat; i++) yankLineFromCaret();
        pendingCount = "";
        return true;
      }
    }
    if (key === "y") {
      ui.consume(event);
      pendingY = true;
      if (pillEl) pillEl.textContent = pillText(mode) + " y";
      setTimeout(() => {
        if (pendingY) {
          pendingY = false;
          if (pillEl && pillEl.textContent.endsWith(" y"))
            pillEl.textContent = pillText(mode);
        }
      }, 1500);
      return true;
    }
    if (key === "Y") {
      ui.consume(event);
      for (let i = 0; i < repeat; i++) yankLineFromCaret();
      pendingCount = "";
      return true;
    }
    if (key === "/") {
      ui.consume(event);
      close(false);
      if (findOpenHandler) findOpenHandler();
      pendingCount = "";
      return true;
    }
    if (key === "v" || key === "V") {
      ui.consume(event);
      const sel = getSelection();
      if (key === "v") {
        mode = "visual";
        if (pillEl) pillEl.textContent = pillText(mode);
        if (sel && sel.isCollapsed && hasModify()) {
          try {
            sel.modify("extend", "forward", "character");
          } catch {}
        }
        ensureVisible();
        updateBlockCaret();
      } else {
        mode = "line";
        if (pillEl) pillEl.textContent = pillText(mode);
        if (sel && sel.isCollapsed) {
          try {
            sel.modify("extend", "forward", "lineboundary");
            sel.modify("extend", "backward", "lineboundary");
          } catch {}
          if (sel && sel.isCollapsed) {
            try {
              sel.modify("extend", "forward", "line");
            } catch {}
          }
        }
        ensureVisible();
        updateBlockCaret();
      }
      pendingCount = "";
      return true;
    }
    if (key === "Enter") {
      ui.consume(event);
      if (!activateCaretLink()) {
        ui.toast("No link at caret");
      } else {
        close(false);
      }
      pendingCount = "";
      return true;
    }
  }

  switch (key) {
    case "h":
    case "ArrowLeft":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveChar(-1);
      break;
    case "l":
    case "ArrowRight":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveChar(1);
      break;
    case "j":
    case "ArrowDown":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveLine(1);
      break;
    case "k":
    case "ArrowUp":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveLine(-1);
      break;
    case "w":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveWord(1);
      break;
    case "b":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveWord(-1);
      break;
    case "e":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doMoveWordEnd(1);
      break;
    case "0":
      ui.consume(event);
      doLineBoundary(-1);
      break;
    case "^":
      ui.consume(event);
      doFirstNonBlank();
      break;
    case "$":
      ui.consume(event);
      for (let i = 0; i < repeat; i++) doLineBoundary(1);
      break;
    case "G":
      ui.consume(event);
      if (repeat > 1) doGoToLine(repeat);
      else doDocBoundary(1);
      break;
    case "o":
      ui.consume(event);
      swapAnchorFocus();
      break;
    case "y":
      ui.consume(event);
      yankSelection();
      try {
        collapseToFocus();
      } catch {}
      mode = "caret";
      if (pillEl) pillEl.textContent = pillText(mode);
      pendingCount = "";
      pendingG = false;
      pendingF = null;
      pendingY = false;
      showBlockCaret();
      attachCaretListeners();
      ensureVisible();
      updateBlockCaret();
      break;
    case "v":
      ui.consume(event);
      if (mode === "visual") {
        enterCaretAtFocus();
      } else if (mode === "line") {
        enterCaretAtFocus();
      } else {
        close(false);
        enter("visual");
      }
      break;
    case "V":
      ui.consume(event);
      if (mode === "line" || mode === "visual") {
        enterCaretAtFocus();
      } else {
        close(false);
        enter("line");
      }
      break;
    case "Y":
      ui.consume(event);
      yankSelection();
      try {
        collapseToFocus();
      } catch {}
      mode = "caret";
      if (pillEl) pillEl.textContent = pillText(mode);
      pendingCount = "";
      pendingG = false;
      pendingF = null;
      pendingY = false;
      showBlockCaret();
      attachCaretListeners();
      ensureVisible();
      updateBlockCaret();
      break;
    case "n":
    case "N":
      if (isCaret()) {
        ui.consume(event);
        if (findNavHandler) {
          const reverse = key === "N";
          findNavHandler(repeat, reverse);
        } else {
          ui.toast("No search");
        }
        break;
      }
      // fall through for visual mode: show disabled
      if (
        key.length === 1 &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        ui.consume(event);
        ui.toast(`${isCaret() ? "No caret" : "No visual"}: ${key}`);
      } else {
        ui.consume(event);
      }
      break;
    default:
      if (isCaret()) {
        ui.consume(event);
      } else if (
        key.length === 1 &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        ui.consume(event);
        ui.toast(`No visual: ${key}`);
      } else {
        ui.consume(event);
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
  setFindOpen,
  setFindNav,
  enterCaretAtFocus,
  onKeyDown,
  showBlockCaret,
  hideBlockCaret,
  updateBlockCaret,
};

register("visual", {
  close: () => {
    closeHints();
    close(false);
  },
  onKeyDown,
  isActive,
});

export function __resetVisualState() {
  closeHints();
  close(false);
  pendingCount = "";
  pendingG = false;
  pendingF = null;
  pendingY = false;
  clearVisualHighlight();
}

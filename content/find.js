/* global CSS, Highlight, NodeFilter */
import { register, touch } from "./overlays.js";
import { ui, createShadowHost } from "./ui.js";
import {
  canonicalKey,
  deepActiveElement,
  keysForCommand,
  overlaySelectors,
} from "./keymap.js";
import { settings } from "./settings.js";
import { isElementDrawn, getLinkAncestor } from "./hints-elements.js";
import {
  detectHighlightSupport,
  clearHighlightNames,
} from "./highlight.js";
import { Visual } from "./visual.js";

const MAX_MATCHES = 1500;

let active = false;
let host = null;
let overlay = null;
let inputEl = null;
let statusEl = null;
let restoreFocus = null;

let matches = [];
let currentIdx = 0;
let lastQuery = "";
let pendingQuery = "";
let committedQuery = "";
let committedIdx = 0;
let committedHidden = false;
let committedRegex = false;
let committedWholeWord = false;
let committedCase = false;

let findRegex = false;
let findWholeWord = false;
let findCase = false;
let toggleButtons = {};

const FIND_HISTORY_KEY = "findHistory";
const MAX_FIND_HISTORY = 20;
let findHistory = [];
let historyIdx = -1;
let historyDraft = "";

let useHighlights = false;
let highlightsHidden = false;
let inputDebounce = null;
let findObserver = null;
let findObserverTimer = null;

function hasHighlights() {
  return matches.length > 0 && !highlightsHidden;
}

function isActive() {
  return active;
}

function hasUpperCase(s) {
  return /\p{Lu}/u.test(s);
}

function isOverlayElement(el) {
  try {
    return el.closest && el.closest(overlaySelectors);
  } catch {
    return false;
  }
}

function shouldSkipNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "IFRAME" || tag === "CANVAS" || tag === "SVG") return true;
  if (isOverlayElement(parent)) return true;
  if (parent.closest) {
    try {
      if (parent.closest(".jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host, .jari-visual-highlight, .jari-hints-host")) return true;
      if (parent.closest('[aria-hidden="true"]')) return true;
      if (parent.closest('[hidden]')) return true;
    } catch {}
  }
  try {
    if (!isElementDrawn(parent)) return true;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
    if (parseFloat(style.opacity) < 0.05) return true;
  } catch {}
  return false;
}
function matchesChanged(a, b) {
  if (a.length !== b.length) return true;
  return a.some((r, i) => {
    const o = b[i];
    return (
      !o ||
      r.startContainer !== o.startContainer ||
      r.startOffset !== o.startOffset ||
      r.endOffset !== o.endOffset
    );
  });
}
function scheduleFindRebuild() {
  clearTimeout(findObserverTimer);
  findObserverTimer = setTimeout(() => {
    try {
      if (active && pendingQuery) {
        const q = pendingQuery.trim();
        if (!q) return;
        const rebuilt = buildMatches(q);
        if (matchesChanged(rebuilt, matches)) {
          matches = rebuilt;
          currentIdx = Math.min(currentIdx, Math.max(0, matches.length - 1));
          applyHighlights();
          updateStatus();
          if (matches.length > 0) scrollToCurrent();
        }
        return;
      }
      if (!active && hasHighlights() && (lastQuery || "").trim()) {
        const rebuilt = buildMatches(lastQuery.trim());
        if (matchesChanged(rebuilt, matches)) {
          matches = rebuilt;
          currentIdx = Math.min(currentIdx, Math.max(0, matches.length - 1));
          applyHighlights();
        }
      }
    } catch {}
  }, 150);
}
function startFindObserver() {
  stopFindObserver();
  try {
    findObserver = new MutationObserver(scheduleFindRebuild);
    findObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden"] });
  } catch {}
}
function stopFindObserver() {
  clearTimeout(findObserverTimer);
  findObserverTimer = null;
  if (findObserver) {
    try { findObserver.disconnect(); } catch {}
    findObserver = null;
  }
}

function syncObserver() {
  if (active || hasHighlights()) {
    if (!findObserver) startFindObserver();
  } else {
    stopFindObserver();
  }
}

function collectTextNodes() {
  const out = [];
  const rootEl = document.body || document.documentElement;
  if (!rootEl) return out;
  try {
    const walker = document.createTreeWalker(
      rootEl,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node = walker.nextNode();
    while (node) {
      out.push(node);
      if (out.length > 5000) break;
      node = walker.nextNode();
    }
  } catch {}
  try {
    const visit = (root) => {
      let els;
      try {
        els = root.querySelectorAll("*");
      } catch { return; }
      for (const el of els) {
        if (el.shadowRoot) {
          try {
            const sw = document.createTreeWalker(
              el.shadowRoot,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(n) {
                  if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                  if (shouldSkipNode(n)) return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                },
              },
            );
            let sn = sw.nextNode();
            while (sn) {
              out.push(sn);
              if (out.length > 5000) return;
              sn = sw.nextNode();
            }
            visit(el.shadowRoot);
          } catch {}
        }
        if (el.tagName === "IFRAME") {
          try {
            const doc = el.contentDocument;
            if (doc && doc.body) {
              const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                acceptNode(n) {
                  if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                  const p = n.parentElement;
                  if (!p) return NodeFilter.FILTER_REJECT;
                  const tag = p.tagName;
                  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                },
              });
              let nn = w.nextNode();
              while (nn) {
                out.push(nn);
                if (out.length > 5000) return;
                nn = w.nextNode();
              }
            }
          } catch {}
        }
      }
    };
    visit(document);
  } catch {}
  return out;
}

export function buildMatcher(query, { regex = false, wholeWord = false, caseSensitive = false } = {}) {
  if (!query) return null;
  const flags = (caseSensitive ? "g" : "gi") + "mu";
  const bounds = (src) => `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try {
    if (regex) return new RegExp(wholeWord ? bounds(query) : query, flags);
    const src = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(wholeWord ? bounds(src) : src, flags);
  } catch {
    return null;
  }
}

function buildMatches(query) {
  if (!query) return [];
  const caseSensitive = findCase || (!findRegex && hasUpperCase(query));
  const matcher = buildMatcher(query, {
    regex: findRegex,
    wholeWord: findWholeWord,
    caseSensitive,
  });
  if (!matcher) return [];
  const nodes = collectTextNodes();
  const out = [];
  for (const node of nodes) {
    matcher.lastIndex = 0;
    let m;
    while ((m = matcher.exec(node.nodeValue)) !== null) {
      if (m[0].length === 0) {
        matcher.lastIndex++;
        continue;
      }
      try {
        const rangeDoc =
          (node.ownerDocument &&
            typeof node.ownerDocument.createRange === "function" &&
            node.ownerDocument) ||
          document;
        const range = rangeDoc.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        out.push(range);
      } catch {}
      if (out.length >= MAX_MATCHES) break;
    }
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

function clearHighlightApi() {
  clearHighlightNames("jari-find", "jari-find-current");
}

function clearHighlights() {
  matches = [];
  currentIdx = 0;
  highlightsHidden = false;
  clearHighlightApi();
  updateStatus();
}

function hideHighlights() {
  highlightsHidden = true;
  clearHighlightApi();
}

function getCurrentLinkElement() {
  if (matches.length === 0) return null;
  const r = matches[currentIdx];
  if (!r || !r.startContainer) return null;
  return getLinkAncestor(r.startContainer.parentElement);
}

function activateCurrentLink() {
  const link = getCurrentLinkElement();
  if (!link) return false;
  try {
    ui.dispatchClick(link);
  } catch {}
  return true;
}

function applyHighlights() {
  clearHighlightApi();
  if (matches.length === 0) return;
  if (highlightsHidden) return;
  const valid = matches.filter(r => {
    try {
      return r.startContainer && r.startContainer.isConnected !== false && r.endContainer && r.endContainer.isConnected !== false;
    } catch { return false; }
  });
  if (valid.length !== matches.length) {
    matches = valid;
    if (currentIdx >= matches.length) currentIdx = Math.max(0, matches.length - 1);
    if (matches.length === 0) { updateStatus(); return; }
  }
  const cur = matches[currentIdx];
  if (!useHighlights) return;
  try {
    const others = valid.filter((_, i) => i !== currentIdx);
    if (others.length > 0) {
      CSS.highlights.set("jari-find", new Highlight(...others));
    } else {
      try { CSS.highlights.delete("jari-find"); } catch {}
    }
    if (cur) {
      CSS.highlights.set("jari-find-current", new Highlight(cur));
    } else {
      try { CSS.highlights.delete("jari-find-current"); } catch {}
    }
  } catch {
    useHighlights = false;
  }
}

function scrollToCurrent() {
  if (matches.length === 0) return;
  const r = matches[currentIdx];
  if (!r) return;
  try {
    if (r.startContainer && r.startContainer.isConnected === false) return;
    const el = r.startContainer && r.startContainer.parentElement ? r.startContainer.parentElement : null;
    if (!el || !el.isConnected) return;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
    } catch {}
    let rect = null;
    try { rect = r.getBoundingClientRect ? r.getBoundingClientRect() : el.getBoundingClientRect(); } catch {}
    if (rect && rectIntersectsViewport(rect)) return;
    const fixed = findFixedAncestor(el);
    if (fixed) {
      scrollFixedMatchIntoView(el, fixed, rect);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    try { rect = r.getBoundingClientRect ? r.getBoundingClientRect() : el.getBoundingClientRect(); } catch {}
    if (rect) {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top < 0 || rect.bottom > vh) {
        try { window.scrollBy(0, rect.top - vh / 2); } catch {}
      }
    }
  } catch {}
}

function rectIntersectsViewport(rect) {
  if (!rect) return false;
  try {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  } catch {
    return false;
  }
}

function findFixedAncestor(el) {
  try {
    let node = el;
    while (node && node.nodeType === 1) {
      if (window.getComputedStyle(node).position === "fixed") return node;
      const root = node.getRootNode ? node.getRootNode() : null;
      node = (root && root.host) || node.parentElement;
    }
  } catch {}
  return null;
}

function isScrollableBox(node) {
  try {
    if (
      node.scrollHeight <= node.clientHeight + 1 &&
      node.scrollWidth <= node.clientWidth + 1
    )
      return false;
    const style = window.getComputedStyle(node);
    return (
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      style.overflowY === "overlay" ||
      style.overflowX === "auto" ||
      style.overflowX === "scroll" ||
      style.overflowX === "overlay"
    );
  } catch {
    return false;
  }
}

function nearestScrollableAncestor(el, stopAfter) {
  try {
    let node = el && el.parentElement ? el.parentElement : null;
    while (node && node.nodeType === 1) {
      if (isScrollableBox(node)) return node;
      if (node === stopAfter) return null;
      node = node.parentElement;
    }
  } catch {}
  return null;
}

function scrollFixedMatchIntoView(el, fixed, rect) {
  try {
    if (!rect) {
      try {
        rect = el.getBoundingClientRect();
      } catch {
        return;
      }
    }
    if (rectIntersectsViewport(rect)) return;
    const box = nearestScrollableAncestor(el, fixed);
    if (!box) return;
    const crect = box.getBoundingClientRect();
    if (crect.top > rect.top) box.scrollTop -= crect.top - rect.top;
    else if (rect.bottom > crect.bottom) box.scrollTop += rect.bottom - crect.bottom;
    if (crect.left > rect.left) box.scrollLeft -= crect.left - rect.left;
    else if (rect.right > crect.right) box.scrollLeft += rect.right - crect.right;
  } catch {}
}

function executeQuery(q) {
  highlightsHidden = false;
  pendingQuery = q;
  const query = (q || "").trim();
  clearTimeout(inputDebounce);
  if (!query) {
    matches = [];
    currentIdx = 0;
    clearHighlightApi();
    updateStatus();
    return;
  }
  inputDebounce = setTimeout(() => {
    runQuery(query);
  }, 80);
}

function runQuery(query) {
  highlightsHidden = false;
  try {
    matches = buildMatches(query);
    currentIdx = 0;
    applyHighlights();
    if (matches.length > 0) scrollToCurrent();
    updateStatus();
  } catch {}
}

function findFlagLabel(name) {
  return name === "regex" ? ".*" : name === "wholeWord" ? "\\b" : "Aa";
}

function refreshToggles() {
  for (const [name, btn] of Object.entries(toggleButtons)) {
    try {
      const on =
        name === "regex" ? findRegex : name === "wholeWord" ? findWholeWord : findCase;
      btn.classList.toggle("jari-find-toggle-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    } catch {}
  }
}

function toggleFindFlag(name) {
  if (name === "regex") findRegex = !findRegex;
  else if (name === "wholeWord") findWholeWord = !findWholeWord;
  else findCase = !findCase;
  refreshToggles();
  const q = (inputEl && inputEl.value.trim()) || pendingQuery || lastQuery;
  if (q) {
    clearTimeout(inputDebounce);
    runQuery(q);
  } else {
    updateStatus();
  }
}

async function loadFindHistory() {
  try {
    const stored = await chrome.storage.local.get(FIND_HISTORY_KEY);
    const list = stored && stored[FIND_HISTORY_KEY];
    if (Array.isArray(list)) {
      findHistory = list.filter((s) => typeof s === "string" && s).slice(0, MAX_FIND_HISTORY);
    }
  } catch {}
}

async function pushFindHistory(q) {
  const query = (q || "").trim();
  if (!query) return;
  findHistory = [query, ...findHistory.filter((s) => s !== query)].slice(
    0,
    MAX_FIND_HISTORY,
  );
  historyIdx = -1;
  try {
    await chrome.storage.local.set({ [FIND_HISTORY_KEY]: findHistory });
  } catch {}
}

function stepHistory(delta) {
  if (!inputEl || findHistory.length === 0) return;
  if (historyIdx === -1 && delta < 0) return;
  if (historyIdx === -1 && delta > 0) historyDraft = inputEl.value;
  historyIdx = Math.min(
    findHistory.length - 1,
    Math.max(-1, historyIdx + delta),
  );
  inputEl.value = historyIdx === -1 ? historyDraft : findHistory[historyIdx];
  executeQuery(inputEl.value);
}

function activeFlagSuffix() {
  const flags = [];
  if (findRegex) flags.push(".*");
  if (findWholeWord) flags.push("\\b");
  if (findCase) flags.push("Aa");
  return flags.length > 0 ? ` · ${flags.join(" ")}` : "";
}

function updateStatus() {
  if (!statusEl) return;
  if (!pendingQuery && matches.length === 0 && !lastQuery) {
    statusEl.textContent = "";
    statusEl.classList.remove("jari-find-no-match");
    return;
  }
  const q = pendingQuery || lastQuery;
  if (!q) {
    statusEl.textContent = "";
    return;
  }
  if (matches.length === 0) {
    if (
      findRegex &&
      !buildMatcher(q, { regex: true, wholeWord: findWholeWord, caseSensitive: findCase })
    ) {
      statusEl.textContent = "Invalid pattern";
    } else {
      statusEl.textContent = `No match for "${q}"${activeFlagSuffix()}`;
    }
    statusEl.classList.add("jari-find-no-match");
  } else {
    statusEl.textContent = `${currentIdx + 1}/${matches.length}${activeFlagSuffix()}`;
    statusEl.classList.remove("jari-find-no-match");
  }
}

function findCss() {
  return `
    :host { all: initial !important; }
    .jari-overlay {
      all: initial;
      display: block;
      position: fixed !important;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483646 !important;
      box-sizing: border-box;
      background: var(--jari-cmplt-bg, #f5f5f7) !important;
      color: var(--jari-cmplt-fg, #333738) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      max-height: 75vh;
      overflow: hidden;
      text-align: left !important;
      pointer-events: auto;
    }
    .jari-find {
      background: #1c1c24 !important;
      color: #cdcdcd !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      outline: none !important;
      border-top: 1px solid #333738;
    }
    .jari-find-bar {
      display: flex;
      align-items: center;
      gap: 0.5ex;
      padding: 0.25ex 0.5ex;
      margin: 0;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      text-align: left !important;
    }
    .jari-find-label {
      color: #e0a363;
      font-weight: bold !important;
      flex: 0 0 auto;
    }
    .jari-find-input {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      box-sizing: border-box;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      color: #cdcdcd;
      background: #1c1c24;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      text-align: left !important;
      padding: 0;
      margin: 0;
    }
    .jari-find-input:focus,
    .jari-find-input:focus-visible,
    .jari-find-input:active {
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
    }
    .jari-find-toggle {
      flex: 0 0 auto;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: 1 !important;
      color: #878787;
      background: transparent;
      border: 1px solid #333738;
      border-radius: 2px;
      padding: 0 0.5ex;
      margin: 0;
      cursor: pointer;
    }
    .jari-find-toggle-on {
      color: #e0a363;
      border-color: #c38a22;
    }
    .jari-find-status {
      flex: 0 0 auto;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      color: #878787;
      white-space: nowrap;
    }
    .jari-find-status.jari-find-no-match {
      color: #e06c75;
    }
  `;
}

function renderBar() {
  const created = createShadowHost("jari-find-host", findCss());
  host = created.host;
  const shadow = created.shadow;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-find";
  const bar = document.createElement("div");
  bar.className = "jari-find-bar";
  const label = document.createElement("span");
  label.className = "jari-find-label";
  label.textContent = "/";
  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "jari-find-input";
  inputEl.setAttribute("autocomplete", "off");
  inputEl.setAttribute("spellcheck", "false");
  statusEl = document.createElement("span");
  statusEl.className = "jari-find-status";
  bar.appendChild(label);
  bar.appendChild(inputEl);
  toggleButtons = {};
  for (const [name, command, label] of [
    ["regex", "toggleFindRegex", "Regular expression"],
    ["wholeWord", "toggleFindWholeWord", "Whole word"],
    ["findCase", "toggleFindCase", "Match case"],
  ]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jari-find-toggle";
    btn.textContent = findFlagLabel(name);
    const bound = keysForCommand(settings.getKeymap(), command);
    btn.title = bound.length > 0 ? `${label} (${bound.join(", ")})` : label;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", () => {
      toggleFindFlag(name);
      try {
        inputEl.focus();
      } catch {}
    });
    toggleButtons[name] = btn;
    bar.appendChild(btn);
  }
  bar.appendChild(statusEl);
  overlay.appendChild(bar);
  shadow.appendChild(overlay);

  restoreFocus = document.activeElement;
  historyIdx = -1;
  historyDraft = "";

  inputEl.addEventListener("input", () => {
    historyIdx = -1;
    executeQuery(inputEl.value);
  });

  inputEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      stepHistory(e.key === "ArrowUp" ? 1 : -1);
    }
  });

  inputEl.focus();
  updateStatus();
}

function open() {
  if (active) return;
  touch("find");
  useHighlights = detectHighlightSupport();
  committedQuery = lastQuery;
  committedIdx = currentIdx;
  committedHidden = highlightsHidden;
  active = true;
  startFindObserver();
  pendingQuery = "";
  loadFindHistory();
  renderBar();
}

function closeBar() {
  if (!active) return;
  clearTimeout(inputDebounce);
  inputDebounce = null;
  const wasInput = inputEl;
  const wasHost = host;
  active = false;
  pendingQuery = "";
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  inputEl = null;
  statusEl = null;
  let focused;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  if (restoreFocus && restoreFocus.isConnected && focused !== restoreFocus) {
    try {
      restoreFocus.focus();
    } catch {}
  } else if (wasInput && (focused === wasInput || focused === wasHost)) {
    try {
      wasInput.blur();
    } catch {}
    let refocused;
    try {
      refocused = deepActiveElement();
    } catch {
      refocused = document.activeElement;
    }
    if (refocused === wasInput) {
      try {
        const body = document.body || null;
        if (body && typeof body.focus === "function") body.focus();
      } catch {}
    }
  }
  restoreFocus = null;
  syncObserver();
}

function closeAndClear() {
  clearHighlights();
  closeBar();
  lastQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
}

function closeDiscardPending() {
  closeBar();
  const q = (committedQuery || "").trim();
  if (!q) {
    clearHighlights();
    lastQuery = "";
    committedQuery = "";
    committedIdx = 0;
    committedHidden = false;
    syncObserver();
    return;
  }
  lastQuery = committedQuery;
  pendingQuery = "";
  const keepRegex = findRegex;
  const keepWholeWord = findWholeWord;
  const keepCase = findCase;
  findRegex = committedRegex;
  findWholeWord = committedWholeWord;
  findCase = committedCase;
  try {
    matches = buildMatches(q);
    currentIdx = Math.min(committedIdx, Math.max(0, matches.length - 1));
  } catch {
    matches = [];
    currentIdx = 0;
  } finally {
    findRegex = keepRegex;
    findWholeWord = keepWholeWord;
    findCase = keepCase;
  }
  highlightsHidden = committedHidden;
  useHighlights = detectHighlightSupport();
  applyHighlights();
  updateStatus();
  syncObserver();
}

function commitQuery(q) {
  clearTimeout(inputDebounce);
  inputDebounce = null;
  const query = (q || "").trim();
  if (!query) {
    closeDiscardPending();
    return;
  }
  try {
    matches = buildMatches(query);
    currentIdx = 0;
  } catch {
    matches = [];
    currentIdx = 0;
  }
  lastQuery = query;
  committedQuery = query;
  committedIdx = 0;
  committedHidden = false;
  committedRegex = findRegex;
  committedWholeWord = findWholeWord;
  committedCase = findCase;
  pendingQuery = "";
  highlightsHidden = false;
  useHighlights = detectHighlightSupport();
  pushFindHistory(query);
  closeBar();
  applyHighlights();
  if (matches.length > 0) scrollToCurrent();
  updateStatus();
  syncObserver();
}

function next(count = 1, reverse = false) {
  const c = Math.max(1, Math.floor(count) || 1);
  if (highlightsHidden && matches.length > 0) {
    highlightsHidden = false;
    useHighlights = detectHighlightSupport();
    syncObserver();
  }
  if (matches.length > 0) {
    try {
      const stale = matches.some(r => !r.startContainer || r.startContainer.isConnected === false);
      if (stale) {
        const q = (lastQuery || pendingQuery || "").trim();
        if (q) {
          const rebuilt = buildMatches(q);
          if (rebuilt.length === 0) {
            clearHighlights();
            updateStatus();
            ui.toast(`No match for "${q}"`);
            return;
          }
          matches = rebuilt;
          if (currentIdx >= matches.length) currentIdx = 0;
          useHighlights = detectHighlightSupport();
          applyHighlights();
          updateStatus();
        } else {
          clearHighlights();
          updateStatus();
        }
      }
    } catch {}
  }
  if (matches.length === 0) {
    const q = (pendingQuery && pendingQuery.trim()) || lastQuery;
    if (!q) {
      ui.toast("No search");
      return;
    }
    pendingQuery = q;
    lastQuery = q;
    pushFindHistory(q);
    matches = buildMatches(q);
    currentIdx = 0;
    if (matches.length === 0) {
      ui.toast(`No match for "${q}"`);
      clearHighlightApi();
      updateStatus();
      return;
    }
    useHighlights = detectHighlightSupport();
    applyHighlights();
    updateStatus();
    if (c > 1) {
      const delta = reverse ? -c : c;
      const len = matches.length;
      currentIdx = (((currentIdx + (delta > 0 ? delta - 1 : delta)) % len) + len) % len;
      applyHighlights();
      updateStatus();
    }
    scrollToCurrent();
    ui.toast(`${currentIdx + 1}/${matches.length}`);
    return;
  }
  const len = matches.length;
  const delta = reverse ? -c : c;
  currentIdx = (((currentIdx + delta) % len) + len) % len;
  applyHighlights();
  scrollToCurrent();
  updateStatus();
  ui.toast(`${currentIdx + 1}/${len}`);
}

const FIND_TOGGLE_COMMANDS = {
  toggleFindRegex: "regex",
  toggleFindWholeWord: "wholeWord",
  toggleFindCase: "findCase",
};

export function findToggleCommandFor(keymap, combo) {
  try {
    const cmd = keymap ? keymap[combo] : null;
    if (cmd && Object.prototype.hasOwnProperty.call(FIND_TOGGLE_COMMANDS, cmd)) {
      return cmd;
    }
  } catch {}
  return null;
}

function enableFindFlag(name) {
  if (name === "regex") findRegex = true;
  else if (name === "wholeWord") findWholeWord = true;
  else findCase = true;
}

function toggleOrOpen(name) {
  if (isActive()) {
    toggleFindFlag(name);
    try {
      if (inputEl) inputEl.focus();
    } catch {}
    return;
  }
  open();
  if (!inputEl) return;
  enableFindFlag(name);
  refreshToggles();
  updateStatus();
}

function onKeyDown(event) {
  if (!active) return false;
  const combo = canonicalKey(event);
  const toggleCmd = findToggleCommandFor(settings.getKeymap(), combo);
  let focused;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  if (toggleCmd && (combo.includes("+") || focused !== inputEl)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleFindFlag(FIND_TOGGLE_COMMANDS[toggleCmd]);
    try {
      if (inputEl) inputEl.focus();
    } catch {}
    return true;
  }
  const inInput = focused === inputEl;
  if (inInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDiscardPending();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      commitQuery(inputEl.value);
      return true;
    }
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDiscardPending();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeBar();
    return true;
  }
  return false;
}

function handleGlobalEsc(event) {
  if (hasHighlights()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    hideHighlights();
    syncObserver();
    return true;
  }
  return false;
}

function handleGlobalEnter(event) {
  if (!hasHighlights()) return false;
  const link = getCurrentLinkElement();
  if (!link) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  activateCurrentLink();
  clearHighlights();
  lastQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
  return true;
}

export const Find = {
  open,
  close: closeBar,
  clearHighlights,
  next,
  toggleOrOpen,
  isActive,
  hasHighlights,
  handleGlobalEsc,
  handleGlobalEnter,
  onKeyDown,
};

register("find", { close: closeAndClear, onKeyDown, isActive });

try {
  Visual.setFindOpen(() => open());
  if (typeof Visual.setFindNav === "function") Visual.setFindNav((count, reverse) => next(count, reverse));
} catch {}

export const __testHelpers = {
  buildMatches,
  buildMatcher,
  findToggleCommandFor,
  hasUpperCase,
  matchesChanged,
  syncObserver,
  rectIntersectsViewport,
  findFixedAncestor,
  nearestScrollableAncestor,
  scrollFixedMatchIntoView,
  executeQuery,
  runQuery,
  commitQuery,
  closeDiscardPending,
};

export function __setFindTestState({ matches: seed = [], query = "", index = 0, pending = "", committed = null, committedIndex = null, hidden = false } = {}) {
  matches = seed;
  currentIdx = index;
  lastQuery = query;
  pendingQuery = pending;
  highlightsHidden = hidden;
  committedQuery = committed === null ? query : committed;
  committedIdx = committedIndex === null ? index : committedIndex;
  committedHidden = hidden;
}

export function __getFindTestState() {
  return {
    matchCount: matches.length,
    currentIdx,
    lastQuery,
    pendingQuery,
    committedQuery,
    highlightsHidden,
  };
}

export function __resetFindState() {
  try { stopFindObserver(); } catch {}
  closeAndClear();
  highlightsHidden = false;
  lastQuery = "";
  pendingQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
  committedRegex = false;
  committedWholeWord = false;
  committedCase = false;
  useHighlights = false;
  findRegex = false;
  findWholeWord = false;
  findCase = false;
  findHistory = [];
  historyIdx = -1;
  historyDraft = "";
}


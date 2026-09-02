/* global CSS, Highlight, NodeFilter */
import { register } from "./overlays.js";
import { ui } from "./ui.js";
import { overlaySelectors } from "./keymap.js";
import { isOpenableLink } from "./hints-elements.js";

const MAX_MATCHES = 1500;

let active = false;
let overlay = null;
let inputEl = null;
let statusEl = null;
let restoreFocus = null;

let matches = [];
let currentIdx = 0;
let lastQuery = "";
let pendingQuery = "";

let useHighlights = false;
let fallbackSpans = [];

function hasHighlights() {
  return matches.length > 0;
}

function isActive() {
  return active;
}

function detectHighlightSupport() {
  try {
    return (
      typeof CSS !== "undefined" &&
      CSS.highlights &&
      typeof Highlight !== "undefined"
    );
  } catch {
    return false;
  }
}

function hasUpperCase(s) {
  return /[A-Z]/.test(s);
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
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return true;
  if (isOverlayElement(parent)) return true;
  if (parent.closest && parent.closest(".jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host")) return true;
  try {
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") return true;
  } catch {}
  return false;
}

function collectTextNodes() {
  const out = [];
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
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
    node = walker.nextNode();
  }

  try {
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          const sw = document.createTreeWalker(
            el.shadowRoot,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(n) {
                if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = n.parentElement;
                if (p && p.closest && p.closest(overlaySelectors)) return NodeFilter.FILTER_REJECT;
                if (p && p.closest && p.closest(".jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host")) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
              },
            },
          );
          let sn = sw.nextNode();
          while (sn) {
            out.push(sn);
            sn = sw.nextNode();
          }
          visit(el.shadowRoot);
        }
      }
    };
    visit(document);
  } catch {}

  return out;
}

function buildMatches(query) {
  if (!query) return [];
  const caseSensitive = hasUpperCase(query);
  const needle = caseSensitive ? query : query.toLowerCase();
  const nodes = collectTextNodes();
  const out = [];
  for (const node of nodes) {
    const text = node.nodeValue;
    const hay = caseSensitive ? text : text.toLowerCase();
    let pos = 0;
    while (true) {
      const idx = hay.indexOf(needle, pos);
      if (idx === -1) break;
      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + query.length);
        out.push(range);
      } catch {}
      pos = idx + query.length;
      if (out.length >= MAX_MATCHES) break;
    }
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

function clearHighlightApi() {
  try {
    if (CSS.highlights) {
      CSS.highlights.delete("jari-find");
      CSS.highlights.delete("jari-find-current");
    }
  } catch {}
}

function clearFallback() {
  for (const span of fallbackSpans) {
    try {
      const parent = span.parentNode;
      if (!parent) continue;
      const text = span.textContent;
      const tn = document.createTextNode(text);
      parent.replaceChild(tn, span);
      parent.normalize();
    } catch {}
  }
  fallbackSpans = [];
}

function clearHighlights() {
  matches = [];
  currentIdx = 0;
  clearHighlightApi();
  clearFallback();
  updateStatus();
}

function getCurrentLinkElement() {
  if (matches.length === 0) return null;
  const r = matches[currentIdx];
  if (!r || !r.startContainer) return null;
  let el = r.startContainer.parentElement;
  if (!el) return null;
  if (el.closest) {
    const a = el.closest("a");
    if (a && isOpenableLink(a)) return a;
    const hrefEl = el.closest("[href]");
    if (hrefEl && isOpenableLink(hrefEl)) return hrefEl;
  }
  while (el) {
    if (el.tagName === "A" && isOpenableLink(el)) return el;
    if (el.getAttribute && el.getAttribute("href") && isOpenableLink(el)) return el;
    const parent = el.parentElement;
    if (parent) {
      el = parent;
    } else {
      const root = el.getRootNode && el.getRootNode();
      if (root && root.host) el = root.host;
      else break;
    }
  }
  return null;
}

function dispatchClick(el) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
    } catch {}
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {}
  }
}

function activateCurrentLink() {
  const link = getCurrentLinkElement();
  if (!link) return false;
  try {
    dispatchClick(link);
  } catch {}
  return true;
}

function applyHighlights() {
  clearHighlightApi();
  clearFallback();
  if (matches.length === 0) return;
  const cur = matches[currentIdx];
  if (useHighlights) {
    try {
      const others = matches.filter((_, i) => i !== currentIdx);
      if (others.length > 0) {
        CSS.highlights.set("jari-find", new Highlight(...others));
      } else {
        CSS.highlights.delete("jari-find");
      }
      if (cur) {
        CSS.highlights.set("jari-find-current", new Highlight(cur));
      }
      return;
    } catch {
      useHighlights = false;
    }
  }
  const byNode = new Map();
  for (let i = 0; i < matches.length; i++) {
    const r = matches[i];
    const node = r.startContainer;
    if (!byNode.has(node)) byNode.set(node, []);
    byNode.get(node).push({ range: r, idx: i });
  }
  for (const list of byNode.values()) {
    list.sort((a, b) => b.range.startOffset - a.range.startOffset);
    for (const { range, idx } of list) {
      try {
        const span = document.createElement("span");
        span.className = idx === currentIdx ? "jari-find-current" : "jari-find-hit";
        range.surroundContents(span);
        fallbackSpans.push(span);
      } catch {}
    }
  }
}

function scrollToCurrent() {
  if (matches.length === 0) return;
  const r = matches[currentIdx];
  if (!r) return;
  try {
    const el = r.startContainer.parentElement;
    if (el) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const rect = r.getBoundingClientRect ? r.getBoundingClientRect() : el.getBoundingClientRect();
      if (rect) {
        const vh = window.innerHeight;
        if (rect.top < 0 || rect.bottom > vh) {
          try {
            window.scrollBy(0, rect.top - vh / 2);
          } catch {}
        }
      }
    }
  } catch {}
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
    statusEl.textContent = `No match for "${q}"`;
    statusEl.classList.add("jari-find-no-match");
  } else {
    statusEl.textContent = `${currentIdx + 1}/${matches.length}`;
    statusEl.classList.remove("jari-find-no-match");
  }
}

function renderBar() {
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
  bar.appendChild(statusEl);
  overlay.appendChild(bar);
  (document.body || document.documentElement).appendChild(overlay);

  restoreFocus = document.activeElement;

  inputEl.addEventListener("input", () => {
    pendingQuery = inputEl.value;
    const q = pendingQuery.trim();
    if (!q) {
      matches = [];
      currentIdx = 0;
      clearHighlightApi();
      clearFallback();
      updateStatus();
      return;
    }
    matches = buildMatches(q);
    currentIdx = 0;
    if (matches.length > 0) {
      lastQuery = q;
    }
    applyHighlights();
    if (matches.length > 0) scrollToCurrent();
    updateStatus();
  });

  inputEl.addEventListener("keydown", (e) => e.stopPropagation());

  inputEl.focus();
  updateStatus();
}

function open() {
  if (active) return;
  useHighlights = detectHighlightSupport();
  active = true;
  pendingQuery = "";
  renderBar();
}

function closeBar() {
  if (!active) return;
  const wasInput = inputEl;
  active = false;
  pendingQuery = "";
  if (overlay) {
    try {
      overlay.remove();
    } catch {}
    overlay = null;
  }
  inputEl = null;
  statusEl = null;
  if (restoreFocus && restoreFocus.isConnected && document.activeElement !== restoreFocus) {
    try {
      restoreFocus.focus();
    } catch {}
  } else if (wasInput && document.activeElement === wasInput) {
    try {
      wasInput.blur();
    } catch {}
    if (document.activeElement === wasInput) {
      document.activeElement = document.body || null;
    }
  }
  restoreFocus = null;
}

function closeAndClear() {
  clearHighlights();
  closeBar();
  lastQuery = "";
}

function next(count = 1, reverse = false) {
  const c = Math.max(1, Math.floor(count) || 1);
  if (matches.length === 0) {
    const q = (pendingQuery && pendingQuery.trim()) || lastQuery;
    if (!q) {
      ui.toast("No search");
      return;
    }
    pendingQuery = q;
    lastQuery = q;
    matches = buildMatches(q);
    currentIdx = 0;
    if (matches.length === 0) {
      ui.toast(`No match for "${q}"`);
      clearHighlightApi();
      clearFallback();
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
  const wrapped = (delta === 1 && currentIdx === 0) || (delta === -1 && currentIdx === len - 1);
  if (wrapped) {
    ui.toast(`Wrapped — ${currentIdx + 1}/${len}`);
  } else {
    ui.toast(`${currentIdx + 1}/${len}`);
  }
}

function prev(count = 1) {
  next(count, true);
}

function onKeyDown(event) {
  if (!active) return false;
  const inInput = document.activeElement === inputEl;
  if (inInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeAndClear();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const q = inputEl.value.trim();
      if (!q) {
        closeAndClear();
      } else {
        lastQuery = q;
        closeBar();
        // TODO: enter visual mode on find highlight (select current match with block caret)
      }
      return true;
    }
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeAndClear();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeBar();
    // TODO: enter visual mode on find highlight (select current match with block caret)
    return true;
  }
  return false;
}

function hasHighlightsPublic() {
  return matches.length > 0;
}

function handleGlobalEsc(event) {
  if (hasHighlights()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearHighlights();
    lastQuery = "";
    ui.toast("Cleared");
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
  return true;
}

export const Find = {
  open,
  close: closeBar,
  clearHighlights,
  next,
  prev,
  isActive,
  hasHighlights: hasHighlightsPublic,
  handleGlobalEsc,
  handleGlobalEnter,
  onKeyDown,
};

register("find", { close: closeAndClear, onKeyDown, isActive });

export const __testHelpers = {
  buildMatches,
  hasUpperCase,
};

export function __resetFindState() {
  closeAndClear();
  lastQuery = "";
  pendingQuery = "";
  useHighlights = false;
}


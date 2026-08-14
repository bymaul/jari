import { suggestionSources } from "../shared/constants.js";

export const Events = {
  listeners: {},
  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
  },
  emit(event, ...args) {
    for (const fn of this.listeners[event] || []) fn(...args);
  },
};

export const keymapDefaults = {

  j: "scrollDown",
  k: "scrollUp",
  h: "scrollLeft",
  l: "scrollRight",
  G: "scrollBottom",
  w: "showScrollArea",
  "+": "zoomIn",
  "-": "zoomOut",

  t: "omnibar",
  x: "closeTab",
  X: "restoreTab",
  H: "previousTab",
  L: "nextTab",
  "<<": "moveTabLeft",
  ">>": "moveTabRight",

  gw: "splitOrMergeTab",

  S: "historyBack",
  D: "historyForward",

  f: "linkHints",
  F: "linkHintsNewTab",
  gf: "linkHintsBackground",
  i: "focusInput",

  r: "reloadTab",
  R: "hardReload",

  Y: "copyTitleUrl",
  gp: "pasteOpen",
  gP: "pasteOpenBackground",

  I: "toggleIgnore",
  p: "passthrough",
  "ctrl+alt+v": "toggleDisabled",

  "?": "showHelp",

  gt: "tabSearch",
  gg: "scrollTop",
  gu: "goUp",
  gU: "goToRoot",
  ge: "editUrl",
  gs: "cycleScrollArea",
  gS: "resetScrollArea",
  g0: "firstTab",
  g$: "lastTab",
  ";e": "openOptions",
  yf: "linkHintsYank",
  yy: "copyUrl",
};

export const prefixes = {
  g: {},
  ";": {},
  y: {},
  "<": {},
  ">": {},
};

export const categories = [
  { id: "scrolling", label: "Scrolling" },
  { id: "view", label: "View & zoom" },
  { id: "tabs", label: "Tabs" },
  { id: "tabActions", label: "Tab actions" },
  { id: "history", label: "History" },
  { id: "hints", label: "Hints" },
  { id: "page", label: "Page" },
  { id: "clipboard", label: "Clipboard" },
  { id: "modes", label: "Modes" },
  { id: "help", label: "Help" },
];

export const settingsDefaults = {
  scrollStep: 120,
  smoothScroll: false,

  fuzzyMatching: true,
  timeoutMs: 1500,

  passthroughMs: 1500,

  hintChars: "sadfjklewcmpgh",

  hintPosition: "top-left",

  suggestionSources: suggestionSources.slice(),

  copyFormat: "plain",
};

export const prefixKeys = new Set(Object.keys(prefixes));

export const modifierKeys = new Set([
  "Control",
  "Alt",
  "Shift",
  "Meta",
  "OS",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "AltGraph",
]);

export function canonicalKey(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.metaKey) parts.push("meta");
  parts.push(event.key);
  return parts.join("+");
}

export function parseRepeatCount(raw) {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 1 : Math.max(1, n);
}

export const overlaySelectors =
  ".jari-overlay, .jari-hint, .jari-scroll-highlight";

export function deepActiveElement() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

export function queryAll(selector, onShadowRoot) {
  const out = [];
  const visit = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) {
        if (onShadowRoot) onShadowRoot(el.shadowRoot);
        visit(el.shadowRoot);
      }
    }
  };
  visit(document);
  return out;
}

export function containsElement(container, target) {
  let node = target;
  while (node) {
    if (node === container) return true;
    node = node.parentElement || node.getRootNode().host;
  }
  return false;
}

export { urlSchemes as allowedUrlSchemes } from "../shared/constants.js";

export { suggestionSources } from "../shared/constants.js";

export function normalizeSettings(data) {
  const d = data || {};
  const storedKeymap = {};
  for (const [key, command] of Object.entries(d.keymap || {})) {
    storedKeymap[key] = command;
  }
  const keymap = d.keymap != null ? storedKeymap : { ...keymapDefaults };
  for (const key of prefixKeys) delete keymap[key];
  return {
    keymap,
    disabledSites: Array.isArray(d.disabledSites) ? d.disabledSites : [],
    scrollStep: Number.isFinite(d.scrollStep)
      ? d.scrollStep
      : settingsDefaults.scrollStep,
    smoothScroll:
      typeof d.smoothScroll === "boolean"
        ? d.smoothScroll
        : settingsDefaults.smoothScroll,
    fuzzyMatching:
      typeof d.fuzzyMatching === "boolean"
        ? d.fuzzyMatching
        : settingsDefaults.fuzzyMatching,
    timeoutMs:
      Number.isFinite(d.timeoutMs) && d.timeoutMs > 0
        ? d.timeoutMs
        : settingsDefaults.timeoutMs,
    passthroughMs:
      Number.isFinite(d.passthroughMs) && d.passthroughMs > 0
        ? d.passthroughMs
        : settingsDefaults.passthroughMs,
    hintChars: normalizeHintChars(d.hintChars),
    hintPosition: HINT_POSITIONS.includes(d.hintPosition)
      ? d.hintPosition
      : settingsDefaults.hintPosition,
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    copyFormat:
      d.copyFormat === "markdown" ? "markdown" : settingsDefaults.copyFormat,
  };
}

const HINT_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

function normalizeHintChars(raw) {
  if (typeof raw !== "string") return settingsDefaults.hintChars.toUpperCase();
  const chars = [...new Set(raw.toUpperCase())]
    .filter((c) => /[A-Z0-9]/.test(c))
    .join("");
  return chars.length >= 4 ? chars : settingsDefaults.hintChars.toUpperCase();
}

export const Url = {
  parentUrlOf(href) {
    try {
      const url = new URL(href);
      let path = url.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      const idx = path.lastIndexOf("/");
      path = idx > 0 ? path.slice(0, idx) : "/";
      url.pathname = path;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  },

  rootUrlOf(href) {
    try {
      const url = new URL(href);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  },

  isSamePath(a, b) {
    try {
      return new URL(a).pathname === new URL(b).pathname;
    } catch {
      return a === b;
    }
  },

  looksLikeUrl(text) {
    const s = text.trim();
    if (!s || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("//")) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#].*)?$/i.test(s);
  },

  suggestionTerm(query) {
    const idx = query.search(/\s/);
    if (idx === -1) return query;
    return Url.looksLikeUrl(query.slice(0, idx))
      ? query.slice(idx).trim()
      : query;
  },
};

function queryTerms(query) {
  return String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchTerm(term, t, text) {
  let score = 0;
  let consecutive = 0;
  let last = -1;
  const indices = [];
  for (const ch of term) {
    const i = t.indexOf(ch, last + 1);
    if (i === -1) return null;
    indices.push(i);
    if (i === last + 1) {
      consecutive += 1;
      score += 14 + consecutive;
    } else {
      consecutive = 0;
      score += 2;
      score -= (i - last) * 3;
    }
    if (i === 0 || !/[\w]/.test(t[i - 1]))
      score += 12;
    else if (text[i] !== text[i].toLowerCase()) score += 8;
    last = i;
  }
  return { score, indices };
}

function matchTerms(query, text) {
  const terms = queryTerms(query);
  const t = String(text).toLowerCase();
  return { terms, results: terms.map((term) => matchTerm(term, t, text)) };
}

export function fuzzyMatch(query, text) {
  const { terms, results } = matchTerms(query, text);
  if (terms.length === 0 || results.some((r) => !r)) return null;
  const indices = [];
  let total = 0;
  results.forEach((r) => {
    total += r.score;
    indices.push(...r.indices);
  });
  indices.sort((a, b) => a - b);
  return { score: total, indices };
}

export function fuzzyIndices(query, text) {
  const { results } = matchTerms(query, text);
  const indices = [];
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

export function substringMatch(query, text) {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const t = String(text).toLowerCase();
  return terms.every((term) => t.includes(term));
}

export function balanceCategories(byCategory, columnCount = 3) {
  const columns = Array.from({ length: columnCount }, () => []);
  const columnRows = columns.map(() => 0);
  for (const cat of categories || []) {
    const rows = byCategory.get(cat.id);
    if (!rows) continue;
    let best = 0;
    for (let i = 1; i < columnCount; i++) {
      if (columnRows[i] < columnRows[best]) best = i;
    }
    columns[best].push(cat);
    columnRows[best] += 1 + rows.length;
  }
  return columns;
}

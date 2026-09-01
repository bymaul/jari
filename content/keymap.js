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

  gw: "splitMerge",

  f: "hintClick",
  F: "hintOpen",
  gf: "hintOpenBackground",
  i: "hintInput",

  S: "historyBack",
  D: "historyForward",

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
  ";x": "openExtensions",

  yy: "copyUrl",
  yf: "hintYank",
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
  { id: "page", label: "Page" },
  { id: "clipboard", label: "Clipboard" },
  { id: "hints", label: "Hints" },
  { id: "modes", label: "Modes" },
  { id: "help", label: "Help" },
];

export const HINT_CHARSET_DEFAULT = "sadjklewcmpgh";

export const settingsDefaults = {
  scrollStep: 120,
  smoothScroll: false,

  fuzzyMatching: true,
  timeoutMs: 1500,

  passthroughMs: 1500,

  suggestionSources: suggestionSources.slice(),

  copyFormat: "plain",

  hintChars: HINT_CHARSET_DEFAULT,
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
  ".jari-overlay, .jari-scroll-highlight, .jari-hint, .jari-hints";

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

export function normalizeHintChars(raw) {
  if (typeof raw !== "string") return settingsDefaults.hintChars;
  const chars = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deduped = [...new Set(chars)].join("");
  if (deduped.length < 2) return settingsDefaults.hintChars;
  return deduped;
}

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
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    copyFormat:
      d.copyFormat === "markdown" ? "markdown" : settingsDefaults.copyFormat,
    hintChars: normalizeHintChars(d.hintChars),
  };
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

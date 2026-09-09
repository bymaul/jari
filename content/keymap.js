import {
  clampMaxResults,
  maxResultsDefault,
  suggestionSources,
} from "../shared/constants.js";
import { normalizeSitePattern } from "../shared/url.js";

export const SETTINGS_SCHEMA_VERSION = 4;

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
  G: "scrollToBottom",
  w: "cycleScrollFrame",
  "+": "zoomIn",
  "=": "zoomIn",
  "-": "zoomOut",

  t: "openOmnibar",
  T: "openOmnibarIncognito",
  x: "closeTab",
  X: "restoreTab",
  J: "previousTab",
  K: "nextTab",
  "<<": "moveTabLeft",
  ">>": "moveTabRight",

  W: "moveTabToWindow",

  f: "hintClick",
  F: "hintOpen",
  gf: "hintOpenBackground",
  i: "hintInput",

  H: "goBack",
  L: "goForward",

  r: "reloadTab",
  R: "forceReload",

  Y: "copyTitleAndUrl",
  gp: "openClipboard",
  gP: "openClipboardBackground",

  I: "toggleIgnore",
  p: "passthroughKeys",
  "ctrl+alt+v": "toggleSiteEnabled",

  "?": "showHelp",
  "/": "findText",
  n: "findNext",
  N: "findPrev",
  "alt+r": "toggleFindRegex",
  "alt+w": "toggleFindWholeWord",
  "alt+c": "toggleFindCase",
  v: "enterVisual",
  V: "enterVisualLine",

  gg: "scrollToTop",
  gu: "goToParent",
  gU: "goToRoot",
  ge: "editUrl",
  g0: "goToFirstTab",
  g$: "goToLastTab",
  ";e": "openSettings",
  ";x": "openExtensions",
  ";w": "resetScrollTarget",

  yy: "copyUrl",
  yfa: "hintYank",
  yft: "hintYankText",
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
  { id: "zoom", label: "Zoom" },
  { id: "tabs", label: "Tabs" },
  { id: "history", label: "History" },
  { id: "page", label: "Page" },
  { id: "hints", label: "Hints" },
  { id: "find", label: "Find" },
  { id: "visual", label: "Visual" },
  { id: "modes", label: "Modes" },
  { id: "help", label: "Help" },
];

export const HINT_CHARSET_DEFAULT = "sadjklewcmpgh";

export const HINT_THEMES = ["yellow", "cyan", "dark"];
export const HINT_THEME_DEFAULT = "yellow";
export const HINT_FONT_SIZE_DEFAULT = 10;
export const HINT_FONT_SIZE_MIN = 8;
export const HINT_FONT_SIZE_MAX = 20;

export const settingsDefaults = {
  scrollStep: 120,
  smoothScroll: false,

  fuzzyMatching: true,
  timeoutMs: 0,

  passthroughMs: 1500,

  clueEnabled: true,
  clueDelayMs: 300,

  suggestionSources: suggestionSources.slice(),

  maxResults: maxResultsDefault,

  copyFormat: "plain",

  hintChars: HINT_CHARSET_DEFAULT,

  clickableSelector: "",

  hintTheme: HINT_THEME_DEFAULT,
  hintFontSize: HINT_FONT_SIZE_DEFAULT,
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

export const clearingKeys = new Set(["Backspace", "Delete"]);

export function isReservedCombo(combo) {
  return /^[0-9]$/.test(combo);
}

export function displayCombo(combo) {
  if (typeof combo !== "string" || combo === "") return combo;
  if (combo === " ") return "<Space>";
  return combo.replaceAll(" ", " <Space>");
}

export function findBindingConflict(keymap, combo, commandName) {
  const existing = keymap[combo];
  if (existing && existing !== commandName) return existing;
  return null;
}

export function isBindablePrefixStarter(combo) {
  if (!combo || typeof combo !== "string") return false;
  if (combo.includes("+")) return false;
  if (combo.length !== 1) return false;
  if (/^[0-9]$/.test(combo)) return false;
  return true;
}

export function findOverlapConflicts(keymap, combo) {
  const out = [];
  if (!combo || typeof combo !== "string") return out;
  if (combo.includes("+")) return out;
  for (const [key, command] of Object.entries(keymap || {})) {
    if (key === combo) continue;
    if (key.includes("+")) continue;
    if (key.length > combo.length && key.startsWith(combo)) {
      out.push({ key, command, kind: "shadows" });
    } else if (combo.length > key.length && combo.startsWith(key)) {
      out.push({ key, command, kind: "shadowed-by" });
    }
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function keysForCommand(keymap, commandName) {
  return Object.entries(keymap)
    .filter(([, cmd]) => cmd === commandName)
    .map(([key]) => key);
}

export function isPrefixKey(keymap, key) {
  if (!key || typeof key !== "string") return false;
  if (key.includes("+")) return false;
  if (/^[0-9]$/.test(key)) return false;
  for (const combo of Object.keys(keymap || {})) {
    if (combo.includes("+")) continue;
    if (combo.length > key.length && combo.startsWith(key)) return true;
  }
  return false;
}

export function getDynamicPrefixes(keymap) {
  const out = new Set();
  for (const combo of Object.keys(keymap || {})) {
    if (combo.includes("+")) continue;
    if (combo.length < 2) continue;
    if (/^[0-9]$/.test(combo[0])) continue;
    const prefix = combo[0];
    if (keymap[prefix]) continue;
    out.add(prefix);
  }
  return out;
}

export function getPrefixEntries(keymap, prefix) {
  const entries = [];
  if (!prefix || typeof prefix !== "string") return entries;
  if (prefix.includes("+")) return entries;
  for (const [combo, command] of Object.entries(keymap || {})) {
    if (combo.includes("+")) continue;
    if (!combo.startsWith(prefix)) continue;
    if (combo === prefix) continue;
    const suffix = combo.slice(prefix.length);
    if (!suffix) continue;
    entries.push({ suffix, full: combo, command });
  }
  entries.sort((a, b) =>
    a.suffix < b.suffix ? -1 : a.suffix > b.suffix ? 1 : 0,
  );
  return entries;
}

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
  ".jari-overlay, .jari-scroll-highlight, .jari-hint, .jari-hints, .jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host, .jari-clue";

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

export function normalizeClickableSelector(raw) {
  if (typeof raw !== "string") return settingsDefaults.clickableSelector;
  return raw.trim().slice(0, 500);
}

export function normalizeHintTheme(raw) {
  return HINT_THEMES.includes(raw) ? raw : HINT_THEME_DEFAULT;
}

export function normalizeHintFontSize(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return settingsDefaults.hintFontSize;
  return Math.min(HINT_FONT_SIZE_MAX, Math.max(HINT_FONT_SIZE_MIN, n));
}

export function normalizeHintChars(raw) {
  if (typeof raw !== "string") return settingsDefaults.hintChars;
  const chars = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deduped = [...new Set(chars)].join("");
  if (deduped.length < 2) return settingsDefaults.hintChars;
  return deduped;
}

export function migrateSettings(data) {
  const d = { ...(data || {}) };
  let version =
    Number.isInteger(d.schemaVersion) && d.schemaVersion > 0
      ? d.schemaVersion
      : 0;
  // v0 (pre-versioned): the stored keymap is authoritative, everything else
  // falls back to defaults in normalizeSettings. Add per-version fixups here
  // as the schema evolves.
  if (version < 1) version = 1;
  // v1 -> v2: new clickableSelector field, empty by default.
  if (version < 2) {
    if (d.clickableSelector === undefined) d.clickableSelector = "";
    version = 2;
  }
  // v2 -> v3: new hintTheme/hintFontSize fields with defaults.
  if (version < 3) {
    if (d.hintTheme === undefined) d.hintTheme = HINT_THEME_DEFAULT;
    if (d.hintFontSize === undefined) d.hintFontSize = HINT_FONT_SIZE_DEFAULT;
    version = 3;
  }
  // v3 -> v4: backfill bindings for commands added since the stored
  // keymap was written. Only combos that are still free are added and
  // only for commands the user has bound nowhere, so custom rebinds
  // are never clobbered and intentional unbinds of existing commands
  // are not resurrected.
  if (version < 4) {
    d.keymap = backfillNewBindings(d.keymap);
    version = 4;
  }
  d.schemaVersion = version;
  return d;
}

export function backfillNewBindings(keymap) {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap;
  }
  const used = new Set(Object.values(keymap));
  const out = { ...keymap };
  for (const [combo, command] of Object.entries(keymapDefaults)) {
    if (!(combo in out) && !used.has(command)) {
      out[combo] = command;
      used.add(command);
    }
  }
  return out;
}

export function normalizeSettings(data) {
  const d = migrateSettings(data);
  const storedKeymap = {};
  for (const [key, command] of Object.entries(d.keymap || {})) {
    storedKeymap[key] = command;
  }
  const keymap = d.keymap != null ? storedKeymap : { ...keymapDefaults };
  const disabledSites = Array.isArray(d.disabledSites)
    ? [...new Set(d.disabledSites.map(normalizeSitePattern).filter(Boolean))]
    : [];
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    keymap,
    disabledSites,
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
      Number.isFinite(d.timeoutMs) && d.timeoutMs >= 0
        ? d.timeoutMs
        : settingsDefaults.timeoutMs,
    passthroughMs:
      Number.isFinite(d.passthroughMs) && d.passthroughMs >= 0
        ? d.passthroughMs
        : settingsDefaults.passthroughMs,
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    maxResults:
      d.maxResults === undefined
        ? settingsDefaults.maxResults
        : clampMaxResults(d.maxResults),
    copyFormat:
      d.copyFormat === "markdown" ? "markdown" : settingsDefaults.copyFormat,
    hintChars: normalizeHintChars(d.hintChars),
    clickableSelector: normalizeClickableSelector(d.clickableSelector),
    hintTheme: normalizeHintTheme(d.hintTheme),
    hintFontSize: normalizeHintFontSize(d.hintFontSize),
    clueEnabled:
      typeof d.clueEnabled === "boolean"
        ? d.clueEnabled
        : settingsDefaults.clueEnabled,
    clueDelayMs:
      Number.isFinite(d.clueDelayMs) && d.clueDelayMs >= 0
        ? Math.min(5000, d.clueDelayMs)
        : settingsDefaults.clueDelayMs,
  };
}

export const browserTrappedCombos = new Set([
  "ctrl+t",
  "ctrl+w",
  "ctrl+n",
  "ctrl+Tab",
  "ctrl+shift+Tab",
  "ctrl+l",
  "alt+ArrowLeft",
  "alt+ArrowRight",
  "F5",
  "F11",
  "ctrl+shift+i",
  "ctrl+shift+j",
  "ctrl+shift+c",
]);

export function isBrowserTrapped(combo) {
  return browserTrappedCombos.has(combo);
}

export function balanceCategories(byCategory, columnCount = 3) {
  const columns = Array.from({ length: columnCount }, () => []);
  const columnRows = columns.map(() => 0);
  const ordered = [...(categories || [])].sort((a, b) => {
    const rowsA = byCategory.get(a.id);
    const rowsB = byCategory.get(b.id);
    const weightA = rowsA ? 1 + rowsA.length : -1;
    const weightB = rowsB ? 1 + rowsB.length : -1;
    return weightB - weightA;
  });
  for (const cat of ordered) {
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

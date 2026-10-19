import {
  clampMaxResults,
  maxResultsDefault,
  suggestionSources,
} from "../shared/constants.ts";
import {
  DEFAULT_SEARCH_ENGINE,
  normalizeDefaultEngine,
  normalizeSearchEngines,
  searchEngineDefaults,
  type SearchEngine,
} from "../shared/search-engines.ts";
import {
  normalizePageNavTexts,
  pageNavTextDefaults,
  type PageNavTexts,
} from "../shared/page-nav-texts.ts";
import { normalizeSitePattern } from "../shared/url.ts";
import { COMMAND_CATALOG } from "./catalog.ts";

export const SETTINGS_SCHEMA_VERSION = 12;

// Normalized settings shape — the single schema island. RawSettings is the
// doc-typed input contract for migrate/normalize; every field access there
// sits behind its original runtime guard.
export interface Settings {
  schemaVersion: number;
  keymap: Record<string, string>;
  disabledSites: string[];
  scrollStep: number;
  smoothScroll: boolean;
  fuzzyMatching: boolean;
  timeoutMs: number;
  passthroughMs: number;
  suggestionSources: string[];
  maxResults: number;
  searchEngines: SearchEngine[];
  defaultEngine: string;
  pageNavTexts: PageNavTexts;
  copyFormat: "plain" | "markdown";
  hintChars: string;
  clickableSelector: string;
  hintTheme: HintTheme;
  hintFontSize: number;
  clueEnabled: boolean;
  clueDelayMs: number;
}

export interface RawSettings {
  schemaVersion: number;
  keymap: unknown;
  disabledSites: string[];
  scrollStep: number;
  smoothScroll: boolean;
  fuzzyMatching: boolean;
  timeoutMs: number;
  passthroughMs: number;
  suggestionSources: string[];
  maxResults: number;
  searchEngines: unknown;
  defaultEngine: string;
  pageNavTexts: unknown;
  copyFormat: "plain" | "markdown";
  hintChars: string;
  clickableSelector: string;
  hintTheme: string;
  hintFontSize: number;
  clueEnabled: boolean;
  clueDelayMs: number;
}

type EventListener = (...args: unknown[]) => void;

export const Events = {
  listeners: {} as Record<string, EventListener[]>,
  on(event: string, fn: EventListener) {
    (this.listeners[event] ||= []).push(fn);
  },
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners[event] || []) fn(...args);
  },
};

export const keymapDefaults: Record<string, string> = {
  j: "scrollDown",
  k: "scrollUp",
  h: "scrollLeft",
  l: "scrollRight",
  G: "scrollToBottom",
  w: "cycleScrollFrame",
  d: "scrollHalfPageDown",
  u: "scrollHalfPageUp",
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
  v: "enterVisual",
  V: "enterVisualLine",

  gg: "scrollToTop",
  gu: "goToParent",
  gU: "goToRoot",
  ge: "editUrl",
  g0: "goToFirstTab",
  g$: "goToLastTab",
  gt: "openTabManager",
  ";e": "openSettings",
  ";x": "openExtensions",
  ";w": "resetScrollTarget",

  yy: "copyUrl",
  yf: "hintYank",
  yF: "hintYankText",

  gss: "screenshotFullPage",
  gsp: "screenshotPage",
  gsr: "screenshotRegion",

  "[[": "prevPage",
  "]]": "nextPage",
  ":": "showCommandPalette",
};

export const prefixes = {
  g: {},
  ";": {},
  y: {},
  "[": {},
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

export const HINT_CHARSET_DEFAULT = "saevrtwyincmp";

export const HINT_THEMES = ["yellow", "cyan", "dark"];
export type HintTheme = "yellow" | "cyan" | "dark";
export const HINT_THEME_DEFAULT: HintTheme = "yellow";
export const HINT_FONT_SIZE_DEFAULT = 10;
export const HINT_FONT_SIZE_MIN = 8;
export const HINT_FONT_SIZE_MAX = 20;

export const settingsDefaults: Omit<
  Settings,
  "schemaVersion" | "keymap" | "disabledSites"
> = {
  scrollStep: 120,
  smoothScroll: false,

  fuzzyMatching: true,
  timeoutMs: 0,

  passthroughMs: 1500,

  clueEnabled: true,
  clueDelayMs: 300,

  suggestionSources: suggestionSources.slice(),

  maxResults: maxResultsDefault,

  searchEngines: searchEngineDefaults(),
  defaultEngine: DEFAULT_SEARCH_ENGINE,
  pageNavTexts: pageNavTextDefaults(),

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

export function isReservedCombo(combo: string): boolean {
  return /^[0-9]$/.test(combo);
}

export function displayCombo(combo: string): string;
export function displayCombo(combo: string | null): string | null;
export function displayCombo(combo: string | null): string | null {
  if (typeof combo !== "string" || combo === "") return combo;
  if (combo === " ") return "<Space>";
  return combo.replaceAll(" ", " <Space>");
}

export function findBindingConflict(
  keymap: Record<string, string>,
  combo: string,
  commandName: string,
): string | null {
  const existing = keymap[combo];
  if (existing && existing !== commandName) return existing;
  return null;
}

export function isBindablePrefixStarter(combo: unknown): boolean {
  if (!combo || typeof combo !== "string") return false;
  if (combo.includes("+")) return false;
  if (combo.length !== 1) return false;
  if (/^[0-9]$/.test(combo)) return false;
  return true;
}

export function findOverlapConflicts(
  keymap: Record<string, string>,
  combo: string,
): { key: string; command: string; kind: "shadows" | "shadowed-by" }[] {
  const out: { key: string; command: string; kind: "shadows" | "shadowed-by" }[] =
    [];
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

export function keysForCommand(
  keymap: Record<string, string>,
  commandName: string,
): string[] {
  return Object.entries(keymap)
    .filter(([, cmd]) => cmd === commandName)
    .map(([key]) => key);
}

export function isPrefixKey(keymap: Record<string, string>, key: string) {
  if (!key || typeof key !== "string") return false;
  if (key.includes("+")) return false;
  if (/^[0-9]$/.test(key)) return false;
  for (const combo of Object.keys(keymap || {})) {
    if (combo.includes("+")) continue;
    if (combo.length > key.length && combo.startsWith(key)) return true;
  }
  return false;
}

export function getDynamicPrefixes(
  keymap: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
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

export function getPrefixEntries(
  keymap: Record<string, string>,
  prefix: string | null,
): { suffix: string; full: string; command: string }[] {
  const entries: { suffix: string; full: string; command: string }[] = [];
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

interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export function canonicalKey(event: KeyEventLike): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.metaKey) parts.push("meta");
  parts.push(event.key);
  return parts.join("+");
}

export function parseRepeatCount(raw: string | undefined): number {
  const n = parseInt(raw as string, 10);
  return Number.isNaN(n) ? 1 : Math.max(1, n);
}

export const overlaySelectors =
  ".jari-overlay, .jari-scroll-highlight, .jari-hint, .jari-hints, .jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host, .jari-clue, .jari-prompt-host, .jari-find-host, .jari-help-host, .jari-tab-manager-host";

export function deepActiveElement(): Element | null {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

export function queryAll(
  selector: string,
  onShadowRoot?: (root: ShadowRoot) => void,
): Element[] {
  const out: Element[] = [];
  const visit = (root: Document | ShadowRoot | Element): void => {
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

export function normalizeClickableSelector(raw: unknown): string {
  if (typeof raw !== "string") return settingsDefaults.clickableSelector;
  const selector = raw.trim().slice(0, 500);
  if (!selector) return "";
  try {
    if (typeof document !== "undefined" && document.querySelector) {
      document.querySelector(selector);
    }
  } catch {
    return "";
  }
  return selector;
}

export function normalizeHintTheme(raw: unknown): HintTheme {
  return HINT_THEMES.includes(raw as string) ? (raw as HintTheme) : HINT_THEME_DEFAULT;
}

export function normalizeHintFontSize(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return settingsDefaults.hintFontSize;
  return Math.min(HINT_FONT_SIZE_MAX, Math.max(HINT_FONT_SIZE_MIN, n));
}

export function normalizeHintChars(raw: unknown): string {
  if (typeof raw !== "string") return settingsDefaults.hintChars;
  const chars = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const deduped = [...new Set(chars)].join("");
  if (deduped.length < 2) return settingsDefaults.hintChars;
  return deduped;
}

export function migrateSettings(data: unknown): RawSettings {
  const d = { ...((data || {}) as object) } as RawSettings;
  let version = 0;
  if (Number.isInteger(d.schemaVersion) && d.schemaVersion > 0) {
    version = Math.min(d.schemaVersion, SETTINGS_SCHEMA_VERSION);
  }
  if (
    d.keymap !== undefined &&
    (typeof d.keymap !== "object" || Array.isArray(d.keymap))
  ) {
    d.keymap = undefined;
  }
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
  // are never clobbered. Note this cannot tell a newly added command
  // apart from one the user intentionally unbound, so unbinding a
  // default before an upgrade may see it return.
  if (version < 4) {
    d.keymap = backfillNewBindings(d.keymap);
    version = 4;
  }
  // v4 -> v5: customizable search engines seeded from the previous
  // hardcoded list, with the default engine for bare queries.
  if (version < 5) {
    if (d.searchEngines === undefined) d.searchEngines = searchEngineDefaults();
    const engines = normalizeSearchEngines(d.searchEngines);
    d.searchEngines = engines;
    d.defaultEngine = normalizeDefaultEngine(d.defaultEngine, engines);
    version = 5;
  }
  // v5 -> v6: link yank binds shorten from yfa/yft to yf/yF. Only
  // default-shaped entries move, and only onto free combos, so custom
  // rebinds are never clobbered and intentional unbinds stay unbound.
  if (version < 6) {
    d.keymap = migrateYankBindings(d.keymap);
    version = 6;
  }
  // v6 -> v7: find toggles (regex/whole-word/case) were removed and
  // half-page binds land on d/u. Stored bindings for the deleted
  // commands are pruned, then d/u fill where free and their command is
  // bound nowhere, so custom rebinds are never clobbered.
  if (version < 7) {
    d.keymap = migrateRemovedFindToggles(d.keymap);
    version = 7;
  }
  // v7 -> v8: page navigation binds land on [[/]] and the custom
  // next/previous texts are seeded. Combos fill only where free and
  // only for commands bound nowhere, so custom rebinds are never
  // clobbered. Like the v4 backfill, an intentionally unbound command
  // may gain the new bind.
  if (version < 8) {
    if (d.pageNavTexts === undefined) d.pageNavTexts = pageNavTextDefaults();
    d.pageNavTexts = normalizePageNavTexts(d.pageNavTexts);
    d.keymap = migratePageNavBindings(d.keymap);
    version = 8;
  }
  // v8 -> v9: scroll-area cycle gains [w (backward) and ]w (forward),
  // screenshots gain gss/gsp/gsr. Combos fill only where free, so
  // custom rebinds are never clobbered. A stored w bind is kept and
  // ]w lands next to it as an alias.
  if (version < 9) {
    d.keymap = migrateV9Bindings(d.keymap);
    version = 9;
  }
  // v9 -> v10: tab manager gains gt. The combo fills only where free, so
  // custom rebinds are never clobbered.
  if (version < 10) {
    d.keymap = migrateV10Bindings(d.keymap);
    version = 10;
  }
  // v10 -> v11: the default hint charset drops hjkl (those keys scroll in
  // hints mode now) plus d/g collisions. A stored charset equal to the
  // old default moves over; custom charsets are never clobbered.
  if (version < 11) {
    d.hintChars = migrateHintCharset(d.hintChars) as string;
    version = 11;
  }
  // v11 -> v12: backward scroll-area cycle is gone and forward cycle
  // moves to w (bare), replacing ]w. The w combo fills only where free,
  // so custom rebinds are never clobbered; ]w binds to the same command
  // are pruned (custom ]w rebinds stay). Stale [w binds drop out on normalize.
  if (version < 12) {
    d.keymap = migrateV12Bindings(d.keymap);
    version = 12;
  }
  d.schemaVersion = version;
  return d;
}

export function backfillNewBindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const used = new Set(Object.values(keymap));
  const out = { ...keymap } as Record<string, string>;
  for (const [combo, command] of Object.entries(keymapDefaults)) {
    if (used.has(command)) continue;
    if (combo in out) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
  }
  return out;
}

const YANK_BINDING_SWAPS: [string, string, string][] = [
  ["yfa", "yf", "hintYank"],
  ["yft", "yF", "hintYankText"],
];

export function migrateYankBindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out = { ...keymap } as Record<string, string>;
  for (const [oldCombo, newCombo, command] of YANK_BINDING_SWAPS) {
    if (out[oldCombo] === command && !(newCombo in out)) {
      delete out[oldCombo];
      out[newCombo] = command;
    }
  }
  return out;
}

const REMOVED_FIND_COMMANDS = new Set([
  "toggleFindRegex",
  "toggleFindWholeWord",
  "toggleFindCase",
]);

const HALF_PAGE_FILLS: [string, string][] = [
  ["d", "scrollHalfPageDown"],
  ["u", "scrollHalfPageUp"],
];

export function migrateRemovedFindToggles(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out: Record<string, string> = {};
  for (const [combo, command] of Object.entries(keymap as Record<string, string>)) {
    if (REMOVED_FIND_COMMANDS.has(command)) continue;
    out[combo] = command;
  }
  const used = new Set(Object.values(out));
  for (const [combo, command] of HALF_PAGE_FILLS) {
    if (combo in out || used.has(command)) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
    used.add(command);
  }
  return out;
}

const V8_DEFAULT_FILLS: [string, string][] = [
  ["[[", "prevPage"],
  ["]]", "nextPage"],
  [":", "showCommandPalette"],
];

export function migratePageNavBindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out = { ...keymap } as Record<string, string>;
  const used = new Set(Object.values(out));
  for (const [combo, command] of V8_DEFAULT_FILLS) {
    if (combo in out || used.has(command)) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
    used.add(command);
  }
  return out;
}

const V9_DEFAULT_FILLS: [string, string][] = [
  ["gss", "screenshotFullPage"],
  ["gsp", "screenshotPage"],
  ["gsr", "screenshotRegion"],
];

export function migrateV9Bindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out = { ...keymap } as Record<string, string>;
  for (const [combo, command] of V9_DEFAULT_FILLS) {
    if (combo in out) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
  }
  return out;
}

const V10_DEFAULT_FILLS: [string, string][] = [["gt", "openTabManager"]];

export function migrateV10Bindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out = { ...keymap } as Record<string, string>;
  for (const [combo, command] of V10_DEFAULT_FILLS) {
    if (combo in out) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
  }
  return out;
}

const V12_DEFAULT_FILLS: [string, string][] = [["w", "cycleScrollFrame"]];

export function migrateV12Bindings(keymap: unknown): Record<string, string> {
  if (!keymap || typeof keymap !== "object" || Array.isArray(keymap)) {
    return keymap as Record<string, string>;
  }
  const out = { ...keymap } as Record<string, string>;
  if (out["]w"] === "cycleScrollFrame") delete out["]w"];
  for (const [combo, command] of V12_DEFAULT_FILLS) {
    if (combo in out) continue;
    if (findOverlapConflicts(out, combo).length > 0) continue;
    out[combo] = command;
  }
  return out;
}

const PREVIOUS_HINT_CHARSET_DEFAULT = "sadjklewcmpgh";

export function migrateHintCharset(hintChars: unknown): unknown {
  if (hintChars === PREVIOUS_HINT_CHARSET_DEFAULT) return HINT_CHARSET_DEFAULT;
  return hintChars;
}

export function normalizeSettings(data: unknown): Settings {
  const d = migrateSettings(data);
  const storedKeymap: Record<string, string> = {};
  for (const [key, command] of Object.entries(
    (d.keymap || {}) as Record<string, string>,
  )) {
    if (typeof key !== "string" || key.length === 0) continue;
    if (!Object.hasOwn(COMMAND_CATALOG, command)) continue;
    storedKeymap[key] = command;
  }
  const keymap = d.keymap != null ? storedKeymap : { ...keymapDefaults };
  const disabledSites = Array.isArray(d.disabledSites)
    ? [...new Set(d.disabledSites.map(normalizeSitePattern).filter(Boolean))]
    : [];
  const searchEngines = Array.isArray(d.searchEngines)
    ? normalizeSearchEngines(d.searchEngines)
    : settingsDefaults.searchEngines.map((e) => ({ ...e }));
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    keymap,
    disabledSites,
    scrollStep:
      Number.isFinite(d.scrollStep) && d.scrollStep >= 1 && d.scrollStep <= 500
        ? Math.floor(d.scrollStep)
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
        ? Math.min(10000, d.timeoutMs)
        : settingsDefaults.timeoutMs,
    passthroughMs:
      Number.isFinite(d.passthroughMs) && d.passthroughMs >= 0
        ? Math.min(30000, d.passthroughMs)
        : settingsDefaults.passthroughMs,
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    maxResults:
      d.maxResults === undefined
        ? settingsDefaults.maxResults
        : clampMaxResults(d.maxResults),
    searchEngines,
    defaultEngine: normalizeDefaultEngine(d.defaultEngine, searchEngines),
    pageNavTexts: normalizePageNavTexts(d.pageNavTexts),
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

export function isBrowserTrapped(combo: string): boolean {
  return browserTrappedCombos.has(combo);
}

export function balanceCategories(
  byCategory: Map<string, unknown[]>,
  columnCount = 3,
): { id: string; label: string }[][] {
  const columns: { id: string; label: string }[][] = Array.from(
    { length: columnCount },
    () => [],
  );
  const columnRows: number[] = columns.map(() => 0);
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

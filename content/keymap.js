// Jari: default key bindings, prefix keys, non-key defaults, a tiny event
// bus and the shared helpers used by both the content scripts and the options
// page.
//
// Keys use the exact `event.key` value, optionally prefixed with modifier
// names ("ctrl+", "alt+", "meta+"). Shift is NOT part of the string — a
// capital letter is its own key ("G", "X"), so H/h and L/l are distinct.
//
// Multi-key prefixes ("go", "gu") are composed from a prefix key ("g") via
// the prefixes table. The dispatcher in content.js resolves a prefix before
// consulting the single-key keymap. No fixed sequences ship by default —
// every pair is user-bound from the options page.

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
  // Scrolling
  j: "scrollDown",
  k: "scrollUp",
  h: "scrollLeft",
  l: "scrollRight",
  G: "scrollBottom",
  w: "showScrollArea",
  "+": "zoomIn",
  "-": "zoomOut",

  // Tabs
  t: "omnibar",
  x: "closeTab",
  X: "restoreTab",
  H: "previousTab",
  L: "nextTab",
  "<<": "moveTabLeft",
  ">>": "moveTabRight",

  // Window: split this tab into its own window; again, merge back.
  gw: "splitOrMergeTab",

  // History
  S: "historyBack",
  D: "historyForward",

  // Hints
  f: "linkHints",
  F: "linkHintsNewTab",
  gf: "linkHintsBackground",
  i: "focusInput",

  // Page navigation
  r: "reloadTab",
  R: "hardReload",

  // Clipboard
  Y: "copyTitleUrl",
  gp: "pasteOpen",
  gP: "pasteOpenBackground",

  // Site-level control
  I: "toggleIgnore",
  p: "passthrough",
  "ctrl+alt+v": "toggleDisabled",

  // Help
  "?": "showHelp",

  // Two-key sequences, composed via the prefix keys (g, ;, y) below.
  // Stored like any other binding: rebindable, overridable, and visible in
  // the options table and help overlay.
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

// Prefix keys: the first key of a two-key binding ("go" = "g" then "o").
// The pairs themselves are plain keymap entries (see keymapDefaults). Add
// more prefix keys here without touching the dispatcher.
export const prefixes = {
  g: {},
  ";": {},
  y: {},
  "<": {},
  ">": {},
};

// Command categories, shared by the help overlay and the options page.
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

// Non-key defaults. Overridable from the options page.
export const settingsDefaults = {
  scrollStep: 120,
  smoothScroll: false,
  // Rank prompt lists by fuzzy subsequence score instead of plain substring.
  fuzzyMatching: true,
  timeoutMs: 1500,
  // "o" passthrough duration: how long keys reach the page before Jari
  // takes over again (Escape exits sooner).
  passthroughMs: 1500,
  // Characters used to build link-hint labels ("f"/"F"/"yf"). The default
  // is a home-row set to reduce finger travel; any run of unique characters
  // works.
  hintChars: "sadfjklewcmpgh",
  // Which sources feed the omnibar suggestions. Empty means suggestions are
  // off and only the typed query row is shown.
  suggestionSources: suggestionSources.slice(),
  // Copy format for the title+URL command: plain ("Title\nURL") or markdown
  // ("[Title](URL)").
  copyFormat: "plain",
};

// Prefix keys ("g", ";", "y", ...) must never double as single-key bindings —
// the dispatcher resolves a prefix before the single-key keymap, so a lone
// "g" binding would be shadowed and conflict with the prefix group. Stripped
// from stored keymaps and rejected by the options-page recorder.
export const prefixKeys = new Set(Object.keys(prefixes));

// --- Shared helpers ------------------------------------------------------
// Loaded by the content scripts and the options page; both must agree on
// these so bindings and settings behave identically in each context.

// Bare modifier keys never complete a composition or a keybinding by
// themselves. "OS" is the Windows/Super key, "Fn" and "AltGraph" laptop
// extras.
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

// Canonical key string: modifiers in ctrl/alt/meta order, then the key.
// "Shift" is deliberately absent — a capital letter is its own key.
export function canonicalKey(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.metaKey) parts.push("meta");
  parts.push(event.key);
  return parts.join("+");
}

// A repeat count is at least 1: a bare "0" prefix is a typo, not a command to
// do nothing, and the same rule must hold for every command — "0j" scrolling
// nothing while "0x" closes a tab (background's clampCount) is inconsistent.
// Garbage and empty input count as no count.
export function parseRepeatCount(raw) {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? 1 : Math.max(1, n);
}

// Elements Jari's own overlays create. Content features must not touch
// them: hints must not label them.
export const overlaySelectors =
  ".jari-overlay, .jari-hint, .jari-scroll-highlight";

// --- Shadow DOM helpers --------------------------------------------------
// Open shadow roots are reachable by content scripts; closed roots are not
// (platform design). These let hints and scroll areas see inside open
// roots. keymap.js is the natural home: the options page loads it too and
// both content features agree on the traversal.

// The element that actually has focus, crossing open shadow boundaries.
// document.activeElement stops at a shadow host — when the user types in a
// shadow-tree input (Gmail, Notion, Docs), the host is reported as active
// and Jari would hijack the keys meant for that field.
export function deepActiveElement() {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  return el;
}

// Every element matching `selector` in the document and inside open shadow
// roots. Matching is delegated to the native querySelectorAll per root, so a
// heavy page is not walked element-by-element. Traversal descends into the
// shadow root of every element, matched or not — a generic <div> host can
// wrap a whole shadow component whose clickables would otherwise be missed
// (Notion, Docs, Gmail widgets). Tree order is preserved: the flat tree puts
// shadow content after its host, so ancestors still precede descendants.
// onShadowRoot is called with every traversed open root so callers can
// observe them. Returns a fresh array.
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

// True when `target` is `container` or lives inside it, crossing shadow
// boundaries on the way up (a host contains its shadow content for the
// purposes of containment checks). Used by the hint occlusion test.
export function containsElement(container, target) {
  let node = target;
  while (node) {
    if (node === container) return true;
    node = node.parentElement || node.getRootNode().host;
  }
  return false;
}

// URL schemes safe to open/navigate to, defined in shared/constants.js (the
// background service worker keeps its own copy via the shared module).
export { urlSchemes as allowedUrlSchemes } from "../shared/constants.js";
// Known omnibar suggestion sources; the validation list in normalizeSettings
// and the background's suggestion handler both read this.
export { suggestionSources } from "../shared/constants.js";

// Sanitize a raw storage blob into a complete settings object with defaults
// filled in and invalid values dropped. Shared by the content-script
// settings layer and the options page so both interpret stored values the
// same way.
export function normalizeSettings(data) {
  const d = data || {};
  const storedKeymap = {};
  for (const [key, command] of Object.entries(d.keymap || {})) {
    storedKeymap[key] = command;
  }
  const keymap = { ...keymapDefaults, ...storedKeymap };
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
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    copyFormat:
      d.copyFormat === "markdown" ? "markdown" : settingsDefaults.copyFormat,
  };
}

// Hint characters: uppercase, deduplicated, must stay long enough to label a
// reasonable page. Anything unusable falls back to the default set.
function normalizeHintChars(raw) {
  if (typeof raw !== "string") return settingsDefaults.hintChars.toUpperCase();
  const chars = [...new Set(raw.toUpperCase())]
    .filter((c) => /[A-Z0-9]/.test(c))
    .join("");
  return chars.length >= 4 ? chars : settingsDefaults.hintChars.toUpperCase();
}

// URL helpers shared by the page-navigation commands ("gu"/"gU") and the
// omnibar's URL-vs-search guess.
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

  // A bare query that is a URL — scheme, protocol-relative, localhost, or a
  // dotted hostname (with an optional path/port). Everything else is search
  // terms. The background's normalizeUrl turns bare hosts into https.
  looksLikeUrl(text) {
    const s = text.trim();
    if (!s || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("//")) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#].*)?$/i.test(s);
  },

  // The term suggestions are matched against. When the query is a URL token
  // followed by words (an edited omnibar URL like "https://youtube.com/ pria"),
  // the URL is the anchor and the trailing words are the real filter term.
  // Returns the trailing words, or the whole query when it has no leading URL.
  suggestionTerm(query) {
    const idx = query.search(/\s/);
    if (idx === -1) return query;
    return Url.looksLikeUrl(query.slice(0, idx))
      ? query.slice(idx).trim()
      : query;
  },
};

// Whitespace-delimited terms of a query, lowercased and trimmed. An empty
// query yields no terms.
function queryTerms(query) {
  return String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Greedy subsequence walk of one term against text; returns { score, indices }
// or null when the term is absent. Scoring rewards consecutive runs, word
// starts and camel-case boundaries, and penalizes skipped characters.
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
      score += 14 + consecutive; // a run scores higher the longer it is
    } else {
      consecutive = 0;
      score += 2;
      score -= (i - last) * 3; // gap penalty for skipped characters
    }
    if (i === 0 || !/[\w]/.test(t[i - 1]))
      score += 12; // word start
    else if (text[i] !== text[i].toLowerCase()) score += 8; // camel-case boundary
    last = i;
  }
  return { score, indices };
}

// Shared per-term results for a query against text; results[i] is null when
// terms[i] is absent from text.
function matchTerms(query, text) {
  const terms = queryTerms(query);
  const t = String(text).toLowerCase();
  return { terms, results: terms.map((term) => matchTerm(term, t, text)) };
}

// Fuzzy subsequence matcher for the prompt lists. Every query term must
// appear in text in order; the returned score ranks results so consecutive
// runs, word starts, camel-case boundaries and early positions win. Returns
// null on no match.
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

// Match indices for highlighting a single field (title or url) of an already
// ranked row. Unlike fuzzyMatch, terms that don't match this field are
// skipped, so a multi-term query can highlight "pria" in the title and
// "youtube" in the URL even though neither field contains both.
export function fuzzyIndices(query, text) {
  const { results } = matchTerms(query, text);
  const indices = [];
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

// Substring filter for fuzzy-off mode: every query term must be contained in
// text (case-insensitive), mirroring fuzzyMatch's all-terms-required rule.
export function substringMatch(query, text) {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const t = String(text).toLowerCase();
  return terms.every((term) => t.includes(term));
}

// Greedy column balance for the help overlay and the options keymap grid:
// assign each category to the currently shortest column so the columns end
// up roughly equal (a category header counts one row + one row per command).
// byCategory: Map of category id -> array of entries; returns columns as
// arrays of category objects from categories.
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

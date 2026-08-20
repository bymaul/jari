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

  suggestionSources: suggestionSources.slice(),

  copyFormat: "plain",

  clickableSelector: "",
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
  ".jari-overlay, .jari-scroll-highlight";

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
    suggestionSources: Array.isArray(d.suggestionSources)
      ? d.suggestionSources.filter((s) => suggestionSources.includes(s))
      : settingsDefaults.suggestionSources.slice(),
    copyFormat:
      d.copyFormat === "markdown" ? "markdown" : settingsDefaults.copyFormat,
    clickableSelector:
      typeof d.clickableSelector === "string"
        ? d.clickableSelector
        : settingsDefaults.clickableSelector,
  };
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

// Bounded scoring weights for one term's alignment. Scores are only compared
// between candidates for the same query, so the absolute scale is less
// important than the ordering they produce:
//   - a consecutive run beats the same chars scattered,
//   - an uppercase (camel/title-case) boundary beats a separator boundary,
//   - a match at the start of the text beats one buried later,
//   - nothing is unbounded, so a single term can never dominate the list.
const SCORE_BASE = 2; // every matched char
const SCORE_RUN = 12; // per char that continues a consecutive run
const SCORE_BOUNDARY = 8; // first char, or after a non-word char
const SCORE_CAMEL = 14; // starts an uppercase char (camelCase, title word)
const SCORE_GAP = -3; // per filler char between two matched chars
const SCORE_LEADING = -1; // per unmatched char before the match

// Best-start greedy alignment: try each occurrence of the first char as the
// start, greedily match forward, score that alignment, keep the best one.
// This finds the tightest, best-bonused alignment that a single left-to-right
// pass would miss (e.g. "ob" in "o x ob" matches [4,5], not [0,5]).
const MAX_ALIGNMENT_STARTS = 64;

function isBoundaryAt(t, i) {
  return i === 0 || !/[\w]/.test(t[i - 1]);
}

function scoreAlignment(indices, t, text) {
  let score = 0;
  let prev = -1;
  for (const i of indices) {
    score += SCORE_BASE;
    if (prev !== -1) {
      const gap = i - prev - 1;
      score += gap === 0 ? SCORE_RUN : SCORE_GAP * gap;
    }
    if (isBoundaryAt(t, i)) score += SCORE_BOUNDARY;
    else if (text[i] !== text[i].toLowerCase()) score += SCORE_CAMEL;
    prev = i;
  }
  score += SCORE_LEADING * indices[0];
  return score;
}

function bestAlignment(term, t, text) {
  const n = t.length;
  const q = term.length;
  if (q === 0 || q > n) return null;
  let best = null;
  if (q === 1) {
    for (let i = 0; i < n; i++) {
      if (t[i] !== term) continue;
      const score = scoreAlignment([i], t, text);
      if (!best || score > best.score) best = { score, indices: [i] };
    }
    return best;
  }
  let starts = 0;
  for (let s = 0; s < n && starts < MAX_ALIGNMENT_STARTS; s++) {
    if (t[s] !== term[0]) continue;
    starts++;
    const indices = [s];
    let pos = s + 1;
    let ok = true;
    for (let j = 1; j < q; j++) {
      const i = t.indexOf(term[j], pos);
      if (i === -1) {
        ok = false;
        break;
      }
      indices.push(i);
      pos = i + 1;
    }
    if (!ok) continue;
    const score = scoreAlignment(indices, t, text);
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

function matchTerms(query, text) {
  const terms = queryTerms(query);
  const t = String(text).toLowerCase();
  return { terms, results: terms.map((term) => bestAlignment(term, t, text)) };
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

const SOURCE_RANK = { tab: 0, history: 1, bookmark: 2 };

// Rank a list of { title, url, source } items against a query. Fuzzy scoring
// sorts by score, then by how tight the match window is, then by text length,
// then by source (tabs before history before bookmarks). With fuzzy matching
// off it falls back to substring filtering that keeps the original order.
export function rankMatches(query, list, fuzzy = true) {
  const q = String(query).trim();
  if (!fuzzy) {
    return list.filter((item) => substringMatch(q, item.title + " " + (item.url || "")));
  }
  return list
    .map((item) => {
      const hay = item.title + " " + (item.url || "");
      const match = fuzzyMatch(q, hay);
      if (!match) return null;
      const first = match.indices[0];
      const last = match.indices[match.indices.length - 1];
      return { item, match, span: last - first + 1, hayLength: hay.length };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      if (a.span !== b.span) return a.span - b.span;
      if (a.hayLength !== b.hayLength) return a.hayLength - b.hayLength;
      return (SOURCE_RANK[a.item.source] ?? 3) - (SOURCE_RANK[b.item.source] ?? 3);
    });
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

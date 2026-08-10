// Jari: default key bindings, prefix keys, non-key defaults, a tiny event
// bus and the shared helpers used by both the content scripts and the options
// page (which loads this file first via script tags).
//
// Keys use the exact `event.key` value, optionally prefixed with modifier
// names ("ctrl+", "alt+", "meta+"). Shift is NOT part of the string — a
// capital letter is its own key ("G", "X"), so H/h and L/l are distinct.
//
// Multi-key prefixes ("go", "gu") are composed from a prefix key ("g") via
// Jari.prefixes. The dispatcher in content.js resolves a prefix before
// consulting the single-key keymap. No fixed sequences ship by default —
// every pair is user-bound from the options page.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  Jari.Events = Jari.Events || {
    listeners: {},
    on(event, fn) {
      (this.listeners[event] ||= []).push(fn);
    },
    emit(event, ...args) {
      for (const fn of this.listeners[event] || []) fn(...args);
    },
  };

  Jari.keymapDefaults = {
    // Scrolling
    j: 'scrollDown',
    k: 'scrollUp',
    h: 'scrollLeft',
    l: 'scrollRight',
    G: 'scrollBottom',
    w: 'showScrollArea',
    '+': 'zoomIn',
    '-': 'zoomOut',

    // Tabs
    t: 'omnibar',
    x: 'closeTab',
    X: 'restoreTab',
    H: 'previousTab',
    L: 'nextTab',
    '<<': 'moveTabLeft',
    '>>': 'moveTabRight',

    // Window: split this tab into its own window; again, merge back.
    W: 'splitOrMergeTab',

    // History
    S: 'historyBack',
    D: 'historyForward',

    // Hints
    f: 'linkHints',
    F: 'linkHintsNewTab',
    i: 'focusInput',

    // Page navigation
    r: 'reloadTab',
    R: 'hardReload',

    // Clipboard
    Y: 'copyTitleUrl',
    p: 'pasteOpen',
    P: 'pasteOpenBackground',

    // Site-level control
    I: 'toggleIgnore',
    o: 'passthrough',
    'ctrl+alt+v': 'toggleDisabled',

    // Help
    '?': 'showHelp',

    // Two-key sequences, composed via the prefix keys (g, ;, y) below.
    // Stored like any other binding: rebindable, overridable, and visible in
    // the options table and help overlay.
    gt: 'tabSearch',
    gg: 'scrollTop',
    gu: 'goUp',
    gU: 'goToRoot',
    ge: 'editUrl',
    gs: 'cycleScrollArea',
    gS: 'resetScrollArea',
    g0: 'firstTab',
    g$: 'lastTab',
    ';e': 'openOptions',
    yf: 'linkHintsYank',
    yy: 'copyUrl',
  };

  // Prefix keys: the first key of a two-key binding ("go" = "g" then "o").
  // The pairs themselves are plain keymap entries (see keymapDefaults). Add
  // more prefix keys here without touching the dispatcher.
  Jari.prefixes = {
    g: {},
    ';': {},
    y: {},
    '<': {},
    '>': {},
  };

  // Command categories, shared by the help overlay and the options page.
  Jari.categories = [
    { id: 'scrolling', label: 'Scrolling' },
    { id: 'view', label: 'View & zoom' },
    { id: 'tabs', label: 'Tabs' },
    { id: 'tabActions', label: 'Tab actions' },
    { id: 'history', label: 'History' },
    { id: 'hints', label: 'Hints' },
    { id: 'page', label: 'Page' },
    { id: 'clipboard', label: 'Clipboard' },
    { id: 'modes', label: 'Modes' },
    { id: 'help', label: 'Help' },
  ];

  // Non-key defaults. Overridable from the options page.
  Jari.settingsDefaults = {
    scrollStep: 200,
    smoothScroll: false,
    // Rank prompt lists by fuzzy subsequence score instead of plain substring.
    fuzzyMatching: true,
    timeoutMs: 2000,
    // "o" passthrough duration: how long keys reach the page before Jari
    // takes over again (Escape exits sooner).
    passthroughMs: 3000,
  };

  // Bindings removed from the defaults after a keybind overhaul. Stripped from
  // any stored keymap so old saved configs stop showing them.
  Jari.unboundKeys = [];

  // Prefix keys ("g", ";", "y") must never double as single-key bindings —
  // the dispatcher resolves a prefix before the single-key keymap, so a lone
  // "g" binding would be shadowed and conflict with the prefix group. Stripped
  // from stored keymaps like unboundKeys, and rejected by the options-page
  // recorder.
  Jari.prefixKeys = new Set(Object.keys(Jari.prefixes || {}));

  // --- Shared helpers ------------------------------------------------------
  // Loaded by the content scripts and the options page; both must agree on
  // these so bindings and settings behave identically in each context.

  // Bare modifier keys never complete a composition or a keybinding by
  // themselves. "OS" is the Windows/Super key, "Fn" and "AltGraph" laptop
  // extras.
  Jari.modifierKeys = new Set([
    'Control',
    'Alt',
    'Shift',
    'Meta',
    'OS',
    'CapsLock',
    'NumLock',
    'ScrollLock',
    'Fn',
    'AltGraph',
  ]);

  // Canonical key string: modifiers in ctrl/alt/meta order, then the key.
  // "Shift" is deliberately absent — a capital letter is its own key.
  Jari.canonicalKey = function canonicalKey(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('ctrl');
    if (event.altKey) parts.push('alt');
    if (event.metaKey) parts.push('meta');
    parts.push(event.key);
    return parts.join('+');
  };

  // Elements Jari's own overlays create. Content features must not touch
  // them: hints must not label them.
  Jari.overlaySelectors = '.jari-overlay, .jari-hint, .jari-scroll-highlight';

  // Command renames, old id -> new id. Stored keymaps may reference the old
  // names; normalizeSettings remaps them so existing bindings keep working.
  Jari.renamedCommands = {
    scrollHalfDown: 'scrollHalfPageDown',
    scrollHalfUp: 'scrollHalfPageUp',
    goParentUrl: 'goUp',
    goUrlRoot: 'goToRoot',
    pasteOpenTab: 'pasteOpen',
    pasteOpenTabBackground: 'pasteOpenBackground',
  };

  // Sanitize a raw storage blob into a complete settings object with defaults
  // filled in and invalid values dropped. Shared by the content-script
  // settings layer and the options page so both interpret stored values the
  // same way.
  Jari.normalizeSettings = function normalizeSettings(data) {
    const d = data || {};
    const storedKeymap = {};
    for (const [key, command] of Object.entries(d.keymap || {})) {
      storedKeymap[key] = Jari.renamedCommands[command] || command;
    }
    const keymap = { ...Jari.keymapDefaults, ...storedKeymap };
    for (const key of Jari.unboundKeys) delete keymap[key];
    for (const key of Jari.prefixKeys) delete keymap[key];
    return {
      keymap,
      disabledSites: Array.isArray(d.disabledSites) ? d.disabledSites : [],
      scrollStep: Number.isFinite(d.scrollStep) ? d.scrollStep : Jari.settingsDefaults.scrollStep,
      smoothScroll:
        typeof d.smoothScroll === 'boolean' ? d.smoothScroll : Jari.settingsDefaults.smoothScroll,
      fuzzyMatching:
        typeof d.fuzzyMatching === 'boolean' ? d.fuzzyMatching : Jari.settingsDefaults.fuzzyMatching,
      timeoutMs:
        Number.isFinite(d.timeoutMs) && d.timeoutMs > 0
          ? d.timeoutMs
          : Jari.settingsDefaults.timeoutMs,
      passthroughMs:
        Number.isFinite(d.passthroughMs) && d.passthroughMs > 0
          ? d.passthroughMs
          : Jari.settingsDefaults.passthroughMs,
    };
  };

  // URL helpers shared by the page-navigation commands ("gu"/"gU") and the
  // omnibar's URL-vs-search guess.
  Jari.Url = {
    parentUrlOf(href) {
      try {
        const url = new URL(href);
        let path = url.pathname;
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        const idx = path.lastIndexOf('/');
        path = idx > 0 ? path.slice(0, idx) : '/';
        url.pathname = path;
        url.search = '';
        url.hash = '';
        return url.href;
      } catch {
        return href;
      }
    },

    rootUrlOf(href) {
      try {
        const url = new URL(href);
        url.pathname = '/';
        url.search = '';
        url.hash = '';
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
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('//')) return true;
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
      return Jari.Url.looksLikeUrl(query.slice(0, idx)) ? query.slice(idx).trim() : query;
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
      if (i === 0 || !/[\w]/.test(t[i - 1])) score += 12; // word start
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
  Jari.fuzzyMatch = function fuzzyMatch(query, text) {
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
  };

  // Match indices for highlighting a single field (title or url) of an already
  // ranked row. Unlike fuzzyMatch, terms that don't match this field are
  // skipped, so a multi-term query can highlight "pria" in the title and
  // "youtube" in the URL even though neither field contains both.
  Jari.fuzzyIndices = function fuzzyIndices(query, text) {
    const { results } = matchTerms(query, text);
    const indices = [];
    for (const r of results) if (r) indices.push(...r.indices);
    return indices.sort((a, b) => a - b);
  };

  // Substring filter for fuzzy-off mode: every query term must be contained in
  // text (case-insensitive), mirroring fuzzyMatch's all-terms-required rule.
  Jari.substringMatch = function substringMatch(query, text) {
    const terms = queryTerms(query);
    if (terms.length === 0) return false;
    const t = String(text).toLowerCase();
    return terms.every((term) => t.includes(term));
  };

  // Greedy column balance for the help overlay and the options keymap grid:
  // assign each category to the currently shortest column so the columns end
  // up roughly equal (a category header counts one row + one row per command).
  // byCategory: Map of category id -> array of entries; returns columns as
  // arrays of category objects from Jari.categories.
  Jari.balanceCategories = function balanceCategories(byCategory, columnCount = 3) {
    const columns = Array.from({ length: columnCount }, () => []);
    const columnRows = columns.map(() => 0);
    for (const cat of Jari.categories || []) {
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
  };
})();

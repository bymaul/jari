// Jari: default key bindings, fixed prefixes, non-key defaults, a tiny event
// bus and the shared helpers used by both the content scripts and the options
// page (which loads this file first via script tags).
//
// Keys use the exact `event.key` value, optionally prefixed with modifier
// names ("ctrl+", "alt+", "meta+"). Shift is NOT part of the string — a
// capital letter is its own key ("G", "X"), so H/h and L/l are distinct.
//
// Multi-key prefixes ("gg", "gt") are composed from a prefix key ("g") via
// Jari.prefixes. The dispatcher in content.js resolves a prefix before
// consulting the single-key keymap.
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
    '+': 'zoomIn',
    '=': 'zoomIn',
    '-': 'zoomOut',

    // Tabs
    t: 'newTab',
    x: 'closeTab',
    X: 'restoreTab',
    H: 'previousTab',
    L: 'nextTab',

    // Window: split this tab into its own window; again, merge back.
    W: 'splitOrMergeTab',

    // History
    J: 'historyBack',
    K: 'historyForward',

    // Hints
    f: 'linkHints',
    F: 'linkHintsNewTab',
    i: 'focusInput',

    // Page navigation
    r: 'reloadTab',
    R: 'hardReload',

    // Clipboard
    Y: 'copyTitleUrl',
    p: 'pasteOpenTab',
    P: 'pasteOpenTabBackground',

    // Site-level control
    I: 'toggleIgnore',
    o: 'passthrough',
    'ctrl+alt+v': 'toggleDisabled',

    // Help
    '?': 'showHelp',
  };

  // Fixed multi-key prefixes. Add more prefixes here without touching the
  // dispatcher.
  Jari.prefixes = {
    g: {
      g: 'scrollTop',
      u: 'goParentUrl',
      U: 'goUrlRoot',
      0: 'firstTab',
      $: 'lastTab',
      t: 'tabSearch',
    },
    ';': { s: 'openOptions' },
    y: { f: 'linkHintsYank', y: 'copyUrl' },
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
    timeoutMs: 2000,
    // "o" passthrough duration: how long keys reach the page before Jari
    // takes over again (Escape exits sooner).
    passthroughMs: 1500,
    accentColor: '#e8b589',
  };

  // Bindings removed from the defaults after a keybind overhaul. Stripped from
  // any stored keymap so old saved configs stop showing them. ":" was the
  // removed command line, "S" the removed scroll-focus highlight.
  Jari.unboundKeys = [
    'ctrl+alt+d',
    'ctrl+alt+m',
    'ctrl+alt+p',
    'ctrl+b',
    'ctrl+d',
    'ctrl+f',
    'ctrl+u',
    ':',
    'S',
  ];

  // Prefix keys ("gg", ";s", "yy", ...) double as single-key bindings: the
  // dispatcher resolves a prefix first, and a bound prefix key runs as a
  // plain command when the next key does not complete the two-key sequence.
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

  Jari.isColor = function isColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  };

  // Elements Jari's own overlays create. Content features must not touch
  // them: hints must not label them.
  Jari.overlaySelectors = '.jari-overlay, .jari-hint';

  // Flatten the fixed prefixes ("gg", "gt", ";s", ...) into a
  // commandName -> combined-key lookup, e.g. { scrollTop: 'gg', ... }.
  Jari.flattenPrefixes = function flattenPrefixes() {
    const flat = {};
    for (const [prefix, subs] of Object.entries(Jari.prefixes || {})) {
      for (const [suffix, commandName] of Object.entries(subs)) {
        flat[commandName] = prefix + suffix;
      }
    }
    return flat;
  };

  // Sanitize a raw storage blob into a complete settings object with defaults
  // filled in and invalid values dropped. Shared by the content-script
  // settings layer and the options page so both interpret stored values the
  // same way.
  Jari.normalizeSettings = function normalizeSettings(data) {
    const d = data || {};
    const keymap = { ...Jari.keymapDefaults, ...(d.keymap || {}) };
    for (const key of Jari.unboundKeys) delete keymap[key];
    return {
      keymap,
      disabledSites: Array.isArray(d.disabledSites) ? d.disabledSites : [],
      scrollStep: Number.isFinite(d.scrollStep)
        ? d.scrollStep
        : Jari.settingsDefaults.scrollStep,
      smoothScroll: typeof d.smoothScroll === 'boolean'
        ? d.smoothScroll
        : Jari.settingsDefaults.smoothScroll,
      timeoutMs: Number.isFinite(d.timeoutMs) && d.timeoutMs > 0
        ? d.timeoutMs
        : Jari.settingsDefaults.timeoutMs,
      passthroughMs: Number.isFinite(d.passthroughMs) && d.passthroughMs > 0
        ? d.passthroughMs
        : Jari.settingsDefaults.passthroughMs,
      accentColor: Jari.isColor(d.accentColor)
        ? d.accentColor
        : Jari.settingsDefaults.accentColor,
    };
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

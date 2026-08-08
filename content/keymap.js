// Jari: default key bindings, fixed prefixes, non-key defaults and a tiny
// event bus.
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

    // Find in page
    '/': 'find',
    n: 'findNext',
    N: 'findPrev',

    // Page navigation
    r: 'reloadTab',
    R: 'hardReload',

    // Clipboard
    Y: 'copyTitleUrl',
    p: 'pasteOpenTab',
    P: 'pasteOpenTabBackground',

    // Site-level control
    I: 'toggleIgnore',
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
    { id: 'find', label: 'Find in page' },
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
})();

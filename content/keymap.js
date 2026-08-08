// Jari: default key bindings, fixed chords, non-key defaults and a tiny
// event bus.
//
// Keys use the exact `event.key` value, optionally prefixed with modifier
// names ("ctrl+", "alt+", "meta+"). Shift is NOT part of the string — a
// capital letter is its own key ("G", "X"), so H/h and L/l are distinct.
//
// Multi-key chords ("gg", "gt") are composed from a prefix key ("g") via
// Jari.chords. The dispatcher in content.js resolves a chord before
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
    j: "scrollDown",
    k: "scrollUp",
    h: "scrollLeft",
    l: "scrollRight",
    G: "scrollBottom",
    "+": "zoomIn",
    "=": "zoomIn",
    "-": "zoomOut",

    // Tabs
    t: "newTab",
    x: "closeTab",
    X: "restoreTab",
    J: "nextTab",
    K: "previousTab",

    // History
    A: "historyBack",
    F: "historyForward",

    // Hints
    f: "linkHints",
    i: "focusInput",

    // Find in page
    "/": "find",
    n: "findNext",
    N: "findPrev",

    // Page navigation
    r: "reloadTab",
    R: "hardReload",

    // Clipboard
    Y: "copyTitleUrl",

    // Site-level control
    I: "toggleIgnore",
    "ctrl+alt+v": "toggleDisabled",

    // Help
    "?": "showHelp",
  };

  // Fixed multi-key chords. Add more prefixes here without touching the
  // dispatcher.
  Jari.chords = {
    g: { g: "scrollTop", 0: "firstTab", $: "lastTab", t: "tabSearch" },
    ";": { s: "openOptions" },
  };

  // Non-key defaults. Overridable from the options page.
  Jari.settingsDefaults = {
    scrollStep: 200,
    smoothScroll: false,
  };

  // Bindings removed from the defaults after a keybind overhaul. Stripped from
  // any stored keymap so old saved configs stop showing them. ":" was the
  // removed command line, "S" the removed scroll-focus highlight.
  Jari.unboundKeys = [
    "ctrl+alt+d",
    "ctrl+alt+m",
    "ctrl+alt+p",
    "ctrl+b",
    "ctrl+d",
    "ctrl+f",
    "ctrl+u",
    ":",
    "S",
  ];
})();

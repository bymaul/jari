// Jari: settings layer over chrome.storage.sync.
// Holds the user keymap, the list of per-site disabled hosts, and the
// behavior options (scroll step, smooth scrolling, timeouts).
// Emits "settingsChanged" when storage changes so live tabs react instantly.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const STORAGE_KEY = "settings";

  const state = {
    keymap: { ...Jari.keymapDefaults },
    disabledSites: [],
    scrollStep: Jari.settingsDefaults.scrollStep,
    smoothScroll: Jari.settingsDefaults.smoothScroll,
    fuzzyMatching: Jari.settingsDefaults.fuzzyMatching,
    timeoutMs: Jari.settingsDefaults.timeoutMs,
    passthroughMs: Jari.settingsDefaults.passthroughMs,
  };

  function merge(data) {
    const s = Jari.normalizeSettings(data);
    state.keymap = s.keymap;
    state.disabledSites = s.disabledSites;
    state.scrollStep = s.scrollStep;
    state.smoothScroll = s.smoothScroll;
    state.fuzzyMatching = s.fuzzyMatching;
    state.timeoutMs = s.timeoutMs;
    state.passthroughMs = s.passthroughMs;
  }

  async function load() {
    try {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      merge(stored[STORAGE_KEY] || {});
    } catch {
      merge({});
    }
  }

  function persist() {
    return chrome.storage.sync.set({
      [STORAGE_KEY]: {
        keymap: state.keymap,
        disabledSites: state.disabledSites,
        scrollStep: state.scrollStep,
        smoothScroll: state.smoothScroll,
        fuzzyMatching: state.fuzzyMatching,
        timeoutMs: state.timeoutMs,
        passthroughMs: state.passthroughMs,
      },
    });
  }

  // Mutate the in-memory state without touching storage. The options page
  // edits this way and only writes on Save; the content script persists
  // immediately via update().
  function set(patch) {
    merge(Jari.normalizeSettings({ ...state, ...patch }));
  }

  // Mutate and persist. Awaitable so callers can report write failures.
  async function update(patch) {
    set(patch);
    await persist();
  }

  function getKeymap() {
    return state.keymap;
  }

  function isDisabled() {
    return state.disabledSites.includes(location.hostname);
  }

  function getDisabledSites() {
    return state.disabledSites.slice();
  }

  function getScrollStep() {
    return state.scrollStep;
  }

  function isSmoothScroll() {
    return state.smoothScroll;
  }

  function isFuzzyMatching() {
    return state.fuzzyMatching;
  }

  function getTimeoutMs() {
    return state.timeoutMs;
  }

  function getPassthroughMs() {
    return state.passthroughMs;
  }

  function toggleDisabled() {
    const host = location.hostname;
    const idx = state.disabledSites.indexOf(host);
    if (idx >= 0) state.disabledSites.splice(idx, 1);
    else state.disabledSites.push(host);
    persist().catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[STORAGE_KEY]) return;
    merge(changes[STORAGE_KEY].newValue || {});
    Jari.Events.emit("settingsChanged");
  });

  Jari.settings = {
    load,
    update,
    getKeymap,
    isDisabled,
    getDisabledSites,
    getScrollStep,
    isSmoothScroll,
    isFuzzyMatching,
    getTimeoutMs,
    getPassthroughMs,
    toggleDisabled,
  };
})();

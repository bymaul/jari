// Jari: settings layer over chrome.storage.sync.
// Holds the user keymap, the list of per-site disabled hosts, and the
// behavior options (scroll step, smooth scrolling).
// Emits "settingsChanged" when storage changes so live tabs react instantly.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const STORAGE_KEY = "settings";

  const state = {
    keymap: { ...Jari.keymapDefaults },
    disabledSites: [],
    scrollStep: Jari.settingsDefaults.scrollStep,
    smoothScroll: Jari.settingsDefaults.smoothScroll,
    timeoutMs: Jari.settingsDefaults.timeoutMs,
    accentColor: Jari.settingsDefaults.accentColor,
  };

  function merge(data) {
    const s = Jari.normalizeSettings(data);
    state.keymap = s.keymap;
    state.disabledSites = s.disabledSites;
    state.scrollStep = s.scrollStep;
    state.smoothScroll = s.smoothScroll;
    state.timeoutMs = s.timeoutMs;
    state.accentColor = s.accentColor;
    applyAccent();
  }

  // Live theme: pages pick the accent up from this CSS variable.
  function applyAccent() {
    document.documentElement.style.setProperty("--jari-accent", state.accentColor);
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
    chrome.storage.sync
      .set({
        [STORAGE_KEY]: {
          keymap: state.keymap,
          disabledSites: state.disabledSites,
          scrollStep: state.scrollStep,
          smoothScroll: state.smoothScroll,
          timeoutMs: state.timeoutMs,
          accentColor: state.accentColor,
        },
      })
      .catch(() => {});
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

  function getTimeoutMs() {
    return state.timeoutMs;
  }

  function getAccentColor() {
    return state.accentColor;
  }

  function toggleDisabled() {
    const host = location.hostname;
    const idx = state.disabledSites.indexOf(host);
    if (idx >= 0) state.disabledSites.splice(idx, 1);
    else state.disabledSites.push(host);
    persist();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[STORAGE_KEY]) return;
    merge(changes[STORAGE_KEY].newValue || {});
    Jari.Events.emit("settingsChanged");
  });

  Jari.settings = {
    load,
    getKeymap,
    isDisabled,
    getDisabledSites,
    getScrollStep,
    isSmoothScroll,
    getTimeoutMs,
    getAccentColor,
    toggleDisabled,
  };
})();

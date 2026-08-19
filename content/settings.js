import {
  Events,
  keymapDefaults,
  normalizeSettings,
  settingsDefaults,
} from "./keymap.js";

const STORAGE_KEY = "settings";

const state = {
  keymap: { ...keymapDefaults },
  disabledSites: [],
  scrollStep: settingsDefaults.scrollStep,
  smoothScroll: settingsDefaults.smoothScroll,
  fuzzyMatching: settingsDefaults.fuzzyMatching,
  timeoutMs: settingsDefaults.timeoutMs,
  passthroughMs: settingsDefaults.passthroughMs,
  hintChars: settingsDefaults.hintChars,
  hintPosition: settingsDefaults.hintPosition,
  suggestionSources: settingsDefaults.suggestionSources.slice(),
  copyFormat: settingsDefaults.copyFormat,
  clickableSelector: settingsDefaults.clickableSelector,
};

function merge(data) {
  const s = normalizeSettings(data);
  state.keymap = s.keymap;
  state.disabledSites = s.disabledSites;
  state.scrollStep = s.scrollStep;
  state.smoothScroll = s.smoothScroll;
  state.fuzzyMatching = s.fuzzyMatching;
  state.timeoutMs = s.timeoutMs;
  state.passthroughMs = s.passthroughMs;
  state.hintChars = s.hintChars;
  state.hintPosition = s.hintPosition;
  state.suggestionSources = s.suggestionSources;
  state.copyFormat = s.copyFormat;
  state.clickableSelector = s.clickableSelector;
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
      hintChars: state.hintChars,
      hintPosition: state.hintPosition,
      suggestionSources: state.suggestionSources,
      copyFormat: state.copyFormat,
      clickableSelector: state.clickableSelector,
    },
  });
}

function set(patch) {
  merge(normalizeSettings({ ...state, ...patch }));
}

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

function getHintChars() {
  return state.hintChars;
}

function getHintPosition() {
  return state.hintPosition;
}

function getSuggestionSources() {
  return state.suggestionSources;
}

function getCopyFormat() {
  return state.copyFormat;
}

function getClickableSelector() {
  return state.clickableSelector;
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
  Events.emit("settingsChanged");
});

export const settings = {
  load,
  set,
  update,
  getKeymap,
  isDisabled,
  getDisabledSites,
  getScrollStep,
  isSmoothScroll,
  isFuzzyMatching,
  getTimeoutMs,
  getPassthroughMs,
  getHintChars,
  getHintPosition,
  getSuggestionSources,
  getCopyFormat,
  getClickableSelector,
  toggleDisabled,
};

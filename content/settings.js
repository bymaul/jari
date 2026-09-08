import {
  Events,
  SETTINGS_SCHEMA_VERSION,
  keymapDefaults,
  normalizeSettings,
  settingsDefaults,
} from "./keymap.js";
import { matchesSitePattern, pageSiteKey } from "../shared/url.js";

const STORAGE_KEY = "settings";

let persistedLocal = false;

const state = {
  keymap: { ...keymapDefaults },
  disabledSites: [],
  scrollStep: settingsDefaults.scrollStep,
  smoothScroll: settingsDefaults.smoothScroll,
  fuzzyMatching: settingsDefaults.fuzzyMatching,
  timeoutMs: settingsDefaults.timeoutMs,
  passthroughMs: settingsDefaults.passthroughMs,
  suggestionSources: settingsDefaults.suggestionSources.slice(),
  maxResults: settingsDefaults.maxResults,
  copyFormat: settingsDefaults.copyFormat,
  hintChars: settingsDefaults.hintChars,
  clueEnabled: settingsDefaults.clueEnabled,
  clueDelayMs: settingsDefaults.clueDelayMs,
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
  state.suggestionSources = s.suggestionSources;
  state.maxResults = s.maxResults;
  state.copyFormat = s.copyFormat;
  state.hintChars = s.hintChars;
  state.clueEnabled = s.clueEnabled;
  state.clueDelayMs = s.clueDelayMs;
}

async function load() {
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) {
      merge(stored[STORAGE_KEY]);
      persistedLocal = false;
      return;
    }
  } catch {}
  try {
    const local = await chrome.storage.local.get(STORAGE_KEY);
    if (local && local[STORAGE_KEY]) {
      merge(local[STORAGE_KEY]);
      persistedLocal = true;
      return;
    }
  } catch {}
  merge({});
  persistedLocal = false;
}

function snapshot() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    keymap: { ...state.keymap },
    disabledSites: state.disabledSites.slice(),
    scrollStep: state.scrollStep,
    smoothScroll: state.smoothScroll,
    fuzzyMatching: state.fuzzyMatching,
    timeoutMs: state.timeoutMs,
    passthroughMs: state.passthroughMs,
    suggestionSources: state.suggestionSources.slice(),
    maxResults: state.maxResults,
    copyFormat: state.copyFormat,
    hintChars: state.hintChars,
    clueEnabled: state.clueEnabled,
    clueDelayMs: state.clueDelayMs,
  };
}

function isQuotaError(err) {
  return /quota/i.test(String((err && err.message) || err || ""));
}

async function persist() {
  const data = { [STORAGE_KEY]: snapshot() };
  try {
    await chrome.storage.sync.set(data);
    persistedLocal = false;
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    await chrome.storage.local.set(data);
    persistedLocal = true;
  }
}

function isPersistedLocally() {
  return persistedLocal;
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
  const host = location.hostname || "";
  const protocol = location.protocol || "";
  return state.disabledSites.some((pattern) =>
    matchesSitePattern(host, pattern, protocol),
  );
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

function getSuggestionSources() {
  return state.suggestionSources;
}

function getMaxResults() {
  return state.maxResults;
}

function getCopyFormat() {
  return state.copyFormat;
}

function getHintChars() {
  return state.hintChars;
}

function isClueEnabled() {
  return state.clueEnabled;
}

function getClueDelayMs() {
  return state.clueDelayMs;
}

function toggleSiteEnabled() {
  const key = pageSiteKey(location.hostname || "", location.protocol || "");
  const idx = state.disabledSites.indexOf(key);
  if (idx >= 0) state.disabledSites.splice(idx, 1);
  else state.disabledSites.push(key);
  persist().catch(() => {});
}

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area !== "sync" && area !== "local") || !changes[STORAGE_KEY]) return;
  merge(changes[STORAGE_KEY].newValue || {});
  persistedLocal = area === "local";
  Events.emit("settingsChanged");
});

export const settings = {
  load,
  set,
  update,
  snapshot,
  isPersistedLocally,
  getKeymap,
  isDisabled,
  getDisabledSites,
  getScrollStep,
  isSmoothScroll,
  isFuzzyMatching,
  getTimeoutMs,
  getPassthroughMs,
  getSuggestionSources,
  getMaxResults,
  getCopyFormat,
  getHintChars,
  isClueEnabled,
  getClueDelayMs,
  toggleSiteEnabled,
};

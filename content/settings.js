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
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  updatedAt: 0,
  keymap: { ...keymapDefaults },
  disabledSites: [],
  scrollStep: settingsDefaults.scrollStep,
  smoothScroll: settingsDefaults.smoothScroll,
  fuzzyMatching: settingsDefaults.fuzzyMatching,
  timeoutMs: settingsDefaults.timeoutMs,
  passthroughMs: settingsDefaults.passthroughMs,
  suggestionSources: settingsDefaults.suggestionSources.slice(),
  maxResults: settingsDefaults.maxResults,
  searchEngines: settingsDefaults.searchEngines.map((e) => ({ ...e })),
  defaultEngine: settingsDefaults.defaultEngine,
  copyFormat: settingsDefaults.copyFormat,
  hintChars: settingsDefaults.hintChars,
  clickableSelector: settingsDefaults.clickableSelector,
  hintTheme: settingsDefaults.hintTheme,
  hintFontSize: settingsDefaults.hintFontSize,
  clueEnabled: settingsDefaults.clueEnabled,
  clueDelayMs: settingsDefaults.clueDelayMs,
};

function merge(data) {
  const s = normalizeSettings(data);
  state.schemaVersion = s.schemaVersion;
  state.keymap = s.keymap;
  state.disabledSites = s.disabledSites;
  state.scrollStep = s.scrollStep;
  state.smoothScroll = s.smoothScroll;
  state.fuzzyMatching = s.fuzzyMatching;
  state.timeoutMs = s.timeoutMs;
  state.passthroughMs = s.passthroughMs;
  state.suggestionSources = s.suggestionSources;
  state.maxResults = s.maxResults;
  state.searchEngines = s.searchEngines.map((e) => ({ ...e }));
  state.defaultEngine = s.defaultEngine;
  state.copyFormat = s.copyFormat;
  state.hintChars = s.hintChars;
  state.clickableSelector = s.clickableSelector;
  state.hintTheme = s.hintTheme;
  state.hintFontSize = s.hintFontSize;
  state.clueEnabled = s.clueEnabled;
  state.clueDelayMs = s.clueDelayMs;
  state.updatedAt =
    data && Number.isFinite(data.updatedAt) ? data.updatedAt : state.updatedAt;
}

function storedAt(data) {
  return data && Number.isFinite(data.updatedAt) ? data.updatedAt : 0;
}

function pickNewest(synced, local) {
  if (synced && local) {
    return storedAt(local) > storedAt(synced)
      ? { area: "local", data: local }
      : { area: "sync", data: synced };
  }
  if (local) return { area: "local", data: local };
  if (synced) return { area: "sync", data: synced };
  return { area: "none", data: null };
}

async function load() {
  let synced = null;
  let local = null;
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) synced = stored[STORAGE_KEY];
  } catch {}
  try {
    const resident = await chrome.storage.local.get(STORAGE_KEY);
    if (resident && resident[STORAGE_KEY]) local = resident[STORAGE_KEY];
  } catch {}
  const winner = pickNewest(synced, local);
  if (winner.data) {
    merge(winner.data);
    persistedLocal = winner.area === "local";
  } else {
    merge({});
    persistedLocal = false;
  }
}

function snapshot() {
  return {
    schemaVersion: state.schemaVersion,
    updatedAt: state.updatedAt,
    keymap: { ...state.keymap },
    disabledSites: state.disabledSites.slice(),
    scrollStep: state.scrollStep,
    smoothScroll: state.smoothScroll,
    fuzzyMatching: state.fuzzyMatching,
    timeoutMs: state.timeoutMs,
    passthroughMs: state.passthroughMs,
    suggestionSources: state.suggestionSources.slice(),
    maxResults: state.maxResults,
    searchEngines: state.searchEngines.map((e) => ({ ...e })),
    defaultEngine: state.defaultEngine,
    copyFormat: state.copyFormat,
    hintChars: state.hintChars,
    clickableSelector: state.clickableSelector,
    hintTheme: state.hintTheme,
    hintFontSize: state.hintFontSize,
    clueEnabled: state.clueEnabled,
    clueDelayMs: state.clueDelayMs,
  };
}

function isQuotaError(err) {
  return /quota/i.test(String((err && err.message) || err || ""));
}

async function persist() {
  state.updatedAt = Date.now();
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

function getSearchEngines() {
  return state.searchEngines.map((e) => ({ ...e }));
}

function getDefaultEngine() {
  return state.defaultEngine;
}

function getCopyFormat() {
  return state.copyFormat;
}

function getHintChars() {
  return state.hintChars;
}

function getClickableSelector() {
  return state.clickableSelector;
}

function getHintTheme() {
  return state.hintTheme;
}

function getHintFontSize() {
  return state.hintFontSize;
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
  const incoming = changes[STORAGE_KEY].newValue;
  if (!incoming || storedAt(incoming) < state.updatedAt) return;
  merge(incoming);
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
  getSearchEngines,
  getDefaultEngine,
  getCopyFormat,
  getHintChars,
  getClickableSelector,
  getHintTheme,
  getHintFontSize,
  isClueEnabled,
  getClueDelayMs,
  toggleSiteEnabled,
};

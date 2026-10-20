import {
  Events,
  SETTINGS_SCHEMA_VERSION,
  keymapDefaults,
  normalizeSettings,
  type HintTheme,
  type Settings,
  settingsDefaults,
} from "./keymap.ts";
import type { PageNavTexts } from "../shared/page-nav-texts.ts";
import type { SearchEngine } from "../shared/search-engines.ts";
import { matchesSitePattern, pageSiteKey } from "../shared/url.ts";
import { toggleSiteInList } from "../popup/site.ts";

const STORAGE_KEY = "settings";

type SettingsState = Settings & { updatedAt: number };

let persistedLocal = false;

const state: SettingsState = {
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
  pageNavTexts: {
    next: settingsDefaults.pageNavTexts.next.slice(),
    prev: settingsDefaults.pageNavTexts.prev.slice(),
  },
  copyFormat: settingsDefaults.copyFormat,
  hintChars: settingsDefaults.hintChars,
  clickableSelector: settingsDefaults.clickableSelector,
  hintTheme: settingsDefaults.hintTheme,
  hintFontSize: settingsDefaults.hintFontSize,
  clueEnabled: settingsDefaults.clueEnabled,
  clueDelayMs: settingsDefaults.clueDelayMs,
};

function merge(data: unknown) {
  Object.assign(state, normalizeSettings(data));
  const at = (data as { updatedAt?: unknown } | null)?.updatedAt;
  if (typeof at === "number" && Number.isFinite(at)) state.updatedAt = at;
}

function storedAt(data: { updatedAt?: unknown } | null): number {
  const at = data?.updatedAt;
  return typeof at === "number" && Number.isFinite(at) ? at : 0;
}

function pickNewest(
  synced: unknown,
  local: unknown,
): { area: "sync" | "local" | "none"; data: unknown } {
  if (synced && local) {
    return storedAt(local as { updatedAt?: number } | null) >
      storedAt(synced as { updatedAt?: number } | null)
      ? { area: "local", data: local }
      : { area: "sync", data: synced };
  }
  if (local) return { area: "local", data: local };
  if (synced) return { area: "sync", data: synced };
  return { area: "none", data: null };
}

async function readOne(area: "sync" | "local"): Promise<unknown | null> {
  try {
    const stored = await chrome.storage[area].get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) return stored[STORAGE_KEY];
  } catch {}
  return null;
}

async function load() {
  const [synced, local] = await Promise.all([readOne("sync"), readOne("local")]);
  const winner = pickNewest(synced, local);
  if (winner.data) {
    merge(winner.data);
    persistedLocal = winner.area === "local";
  } else {
    merge({});
    persistedLocal = false;
  }
}

function snapshot(): SettingsState {
  return {
    ...state,
    keymap: { ...state.keymap },
    disabledSites: state.disabledSites.slice(),
    suggestionSources: state.suggestionSources.slice(),
    searchEngines: state.searchEngines.map((e) => ({ ...e })),
    pageNavTexts: {
      next: state.pageNavTexts.next.slice(),
      prev: state.pageNavTexts.prev.slice(),
    },
  };
}

function isQuotaError(err: unknown) {
  return /quota/i.test(String((err as { message?: unknown })?.message || err || ""));
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

function set(patch: Partial<Settings>) {
  merge(normalizeSettings({ ...state, ...patch }));
}

async function update(patch: Partial<Settings>) {
  const prev = snapshot();
  set(patch);
  try {
    await persist();
  } catch (err) {
    merge(prev);
    throw err;
  }
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

function getDisabledSites(): string[] {
  return state.disabledSites.slice();
}

function getScrollStep(): number {
  return state.scrollStep;
}

function isSmoothScroll(): boolean {
  return state.smoothScroll;
}

function isFuzzyMatching(): boolean {
  return state.fuzzyMatching;
}

function getTimeoutMs(): number {
  return state.timeoutMs;
}

function getPassthroughMs(): number {
  return state.passthroughMs;
}

function getSuggestionSources(): string[] {
  return state.suggestionSources;
}

function getMaxResults(): number {
  return state.maxResults;
}

function getSearchEngines(): SearchEngine[] {
  return state.searchEngines.map((e) => ({ ...e }));
}

function getDefaultEngine(): string {
  return state.defaultEngine;
}

function getPageNavTexts(): PageNavTexts {
  return {
    next: state.pageNavTexts.next.slice(),
    prev: state.pageNavTexts.prev.slice(),
  };
}

function getCopyFormat(): "plain" | "markdown" {
  return state.copyFormat;
}

function getHintChars(): string {
  return state.hintChars;
}

function getClickableSelector(): string {
  return state.clickableSelector;
}

function getHintTheme(): HintTheme {
  return state.hintTheme;
}

function getHintFontSize(): number {
  return state.hintFontSize;
}

function isClueEnabled(): boolean {
  return state.clueEnabled;
}

function getClueDelayMs(): number {
  return state.clueDelayMs;
}

function toggleSiteEnabled() {
  const key = pageSiteKey(location.hostname || "", location.protocol || "");
  const prev = state.disabledSites.slice();
  state.disabledSites = toggleSiteInList(state.disabledSites, key);
  persist().catch(() => {
    state.disabledSites = prev;
  });
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
  getPageNavTexts,
  getCopyFormat,
  getHintChars,
  getClickableSelector,
  getHintTheme,
  getHintFontSize,
  isClueEnabled,
  getClueDelayMs,
  toggleSiteEnabled,
};

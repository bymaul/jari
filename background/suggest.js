import { clampMaxResults, suggestionSources } from "../shared/constants.js";
import {
  buildEngineUrl,
  normalizeDefaultEngine,
  normalizeSearchEngines,
} from "../shared/search-engines.js";
import { getStoredSettings } from "./utils.js";
import { openInIncognito } from "./windows.js";

async function getSuggestSettings() {
  const settings = await getStoredSettings();
  const sources = settings && settings.suggestionSources;
  return {
    sources: Array.isArray(sources)
      ? sources.filter((s) => suggestionSources.includes(s))
      : suggestionSources.slice(),
    maxResults:
      settings && settings.maxResults !== undefined
        ? clampMaxResults(settings.maxResults)
        : clampMaxResults(),
  };
}

async function getDefaultSearchUrl(text) {
  const settings = await getStoredSettings();
  const engines = normalizeSearchEngines(settings && settings.searchEngines);
  const keyword = normalizeDefaultEngine(
    settings && settings.defaultEngine,
    engines,
  );
  return (
    buildEngineUrl(engines, keyword, text) ||
    "https://www.google.com/search?q=" + encodeURIComponent(text)
  );
}

export async function suggest(_, { query = "" } = {}) {
  const q = query.trim().toLowerCase();
  const qRaw = query.trim();
  const map = new Map();
  function push(title, url, source, extra = {}) {
    if (!url) return;
    const existing = map.get(url);
    if (existing) {
      existing.visitCount = (existing.visitCount || 0) + (extra.visitCount || 0);
      existing.typedCount = (existing.typedCount || 0) + (extra.typedCount || 0);
      existing.typedVisits = (existing.typedVisits || 0) + (extra.typedVisits || 0);
      existing.lastVisit = Math.max(existing.lastVisit || 0, extra.lastVisit || 0);
      existing.lastAccessed = Math.max(existing.lastAccessed || 0, extra.lastAccessed || 0);
      if (!existing.title || existing.title === existing.url) existing.title = title || url;
      return;
    }
    map.set(url, { title: title || url, url, source, ...extra });
  }
  const { sources, maxResults } = await getSuggestSettings();
  let bookmarkFolderMap = null;
  async function getBookmarkFolderMap() {
    if (bookmarkFolderMap) return bookmarkFolderMap;
    try {
      const tree = await chrome.bookmarks.getTree();
      const m = new Map();
      function walk(nodes, path) {
        for (const node of nodes) {
          if (node.children) {
            const np = [...path, node.title].filter(Boolean);
            if (node.id) m.set(node.id, np);
            walk(node.children, np);
          } else if (node.id) {
            m.set(node.id, path);
          }
        }
      }
      walk(tree, []);
      bookmarkFolderMap = m;
    } catch { bookmarkFolderMap = new Map(); }
    return bookmarkFolderMap;
  }
  if (sources.includes("tab")) {
    try {
      const tabs = await chrome.tabs.query({});
      tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      for (const tab of tabs) push(tab.title || "", tab.url || "", "tab", { id: tab.id, lastAccessed: tab.lastAccessed || 0, audible: !!tab.audible });
    } catch (err) {
      console.debug("[jari] Tab search failed:", err);
    }
  }
  if (!q) {
    if (sources.includes("history")) {
      try {
        const recents = await chrome.history.search({ text: "", maxResults: 24, startTime: Date.now() - 90 * 86400000 });
        recents.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
        for (const item of recents.slice(0, 12)) push(item.title, item.url, "history", { visitCount: item.visitCount || 0, lastVisit: item.lastVisitTime || 0, typedCount: item.typedCount || 0 });
      } catch (err) {
        console.debug("[jari] Recent history failed:", err);
      }
    }
    if (sources.includes("bookmark")) {
      try {
        const folderMap = await getBookmarkFolderMap();
        const bms = await chrome.bookmarks.search("");
        const withPath = bms.filter(bm => bm.url).map(bm => ({ bm, path: folderMap.get(bm.parentId) || [] }));
        withPath.sort((a,b) => (b.bm.dateAdded||0)-(a.bm.dateAdded||0));
        for (const {bm, path} of withPath.slice(0, 8)) push(bm.title, bm.url, "bookmark", { dateAdded: bm.dateAdded || 0, folderPath: path.join(" / ") });
      } catch (err) {
        console.debug("[jari] Bookmark recents failed:", err);
      }
    }
  } else {
    if (sources.includes("history")) {
      try {
        const results = await chrome.history.search({ text: qRaw, maxResults: 30, startTime: Date.now() - 90 * 86400000 });
        const top = results.slice(0, 15);
        const visitGroups = await Promise.allSettled(top.map(item => chrome.history.getVisits ? chrome.history.getVisits({ url: item.url }).catch(() => []) : Promise.resolve([])));
        for (let i = 0; i < top.length; i++) {
          const item = top[i];
          const visits = visitGroups[i].status === "fulfilled" ? visitGroups[i].value : [];
          const typedVisits = visits.filter(v => v.transition === "typed").length;
          push(item.title, item.url, "history", { visitCount: item.visitCount || 0, lastVisit: item.lastVisitTime || 0, typedCount: item.typedCount || 0, typedVisits });
        }
        for (const item of results.slice(15)) push(item.title, item.url, "history", { visitCount: item.visitCount || 0, lastVisit: item.lastVisitTime || 0, typedCount: item.typedCount || 0 });
      } catch (err) {
        console.debug("[jari] History search failed:", err);
      }
      try {
        const recent = await chrome.history.search({ text: "", maxResults: 100, startTime: Date.now() - 90 * 86400000 });
        for (const item of recent) push(item.title, item.url, "history", { visitCount: item.visitCount || 0, lastVisit: item.lastVisitTime || 0, typedCount: item.typedCount || 0 });
      } catch (err) {
        console.debug("[jari] Recent history pool failed:", err);
      }
    }
    if (sources.includes("bookmark")) {
      try {
        const folderMap = await getBookmarkFolderMap();
        const tree = await chrome.bookmarks.getTree();
        const stack = [...(tree || [])];
        while (stack.length) {
          const node = stack.pop();
          if (node.url) {
            const path = folderMap.get(node.parentId) || [];
            push(node.title, node.url, "bookmark", { dateAdded: node.dateAdded || 0, folderPath: path.join(" / ") });
          }
          if (node.children) stack.push(...node.children);
        }
      } catch (err) {
        console.debug("[jari] Bookmark search failed:", err);
      }
    }
  }
  const items = Array.from(map.values());
  return items.slice(0, maxResults);
}

export async function search(
  sender,
  { query = "", newTab = true, incognito = false, background = false } = {},
) {
  const text = query.trim();
  if (!text) return { ok: false };
  const url = await getDefaultSearchUrl(text);
  if (incognito) {
    return openInIncognito(url);
  }
  if (newTab) {
    await chrome.tabs.create(background ? { url, active: false } : { url });
  } else if (sender.tab && sender.tab.id) {
    await chrome.tabs.update(sender.tab.id, { url });
  }
  return { ok: true };
}

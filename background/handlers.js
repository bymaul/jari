import { suggestionSources } from "../shared/constants.js";
import { normalizeUrl } from "../shared/url.js";

export function clampCount(count, max = 20) {
  const n = Math.floor(count);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

async function getSuggestionSources() {
  try {
    const stored = await chrome.storage.sync.get("settings");
    const sources = stored.settings && stored.settings.suggestionSources;
    if (Array.isArray(sources)) {
      return sources.filter((s) => suggestionSources.includes(s));
    }
  } catch (err) {
    console.debug("[jari] Failed to get suggestion sources:", err);
  }
  return suggestionSources.slice();
}

export const handlers = {
  createTab: async (_, { url } = {}) => {
    const target = url === undefined ? undefined : normalizeUrl(url);
    if (url !== undefined && !target) return { ok: false };
    const tab = await chrome.tabs.create(target ? { url: target } : {});
    return tab ? { ok: true, id: tab.id } : { ok: false };
  },

  navigate: async (sender, { url } = {}) => {
    const target = normalizeUrl(url);
    if (!target || !sender.tab || !sender.tab.id) return { ok: false };
    await chrome.tabs.update(sender.tab.id, { url: target });
    return { ok: true };
  },

  closeTab: async (sender, { count = 1 } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id) return { ok: false };

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const index = tabs.findIndex((t) => t.id === tab.id);
    if (index === -1) return { ok: false };
    const ids = tabs.slice(index, index + clampCount(count)).map((t) => t.id);
    await chrome.tabs.remove(ids);
    return { ok: true, closed: ids.length };
  },

  restoreTab: async (_, { count = 1 } = {}) => {
    let sessions;
    try {
      sessions = await chrome.sessions.getRecentlyClosed();
    } catch (err) {
      console.debug("[jari] Failed to get recently closed sessions:", err);
      return { ok: true };
    }
    const tabs = (sessions || []).filter((s) => s.tab && s.tab.sessionId);
    for (let i = 0; i < Math.min(clampCount(count), tabs.length); i++) {
      try {
        await chrome.sessions.restore(tabs[i].tab.sessionId);
      } catch {
        break;
      }
    }
    return { ok: true };
  },

  previousTab: async (sender, { count = 1 } = {}) => {
    return switchTab(sender.tab, -clampCount(count));
  },
  nextTab: async (sender, { count = 1 } = {}) => {
    return switchTab(sender.tab, clampCount(count));
  },

  moveTabToWindow: async (sender) => {
    const tab = sender.tab;
    if (!tab || !tab.id) return { ok: false };
    const myTabs = await chrome.tabs.query({ windowId: tab.windowId });
    if (myTabs.length > 1) {
      await chrome.windows.create({ tabId: tab.id });
      return { ok: true, movedToNewWindow: true };
    }
    const windows = await chrome.windows.getAll({ populate: true });
    const others = windows
      .filter((win) => win.id !== tab.windowId)
      .map((win) => {
        const wtab =
          win.tabs && win.tabs.length
            ? win.tabs.find((t) => t.active) || win.tabs[0]
            : null;
        return {
          windowId: win.id,
          title: wtab && wtab.title ? wtab.title : "Window",
          url: `${win.tabs ? win.tabs.length : 0} tabs`,
        };
      });
    if (others.length === 0) return { ok: true, needWindowChoice: false };
    if (others.length === 1) {
      await moveTabIntoWindowAndFocus(tab.id, others[0].windowId, "moveTabToWindow auto-merge");
      return { ok: true, movedToWindow: true };
    }
    return {
      ok: true,
      needWindowChoice: true,
      ownTabId: tab.id,
      ownWindowId: tab.windowId,
      tabs: others,
    };
  },

  moveTabIntoWindow: async (sender, { targetWindowId } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id || !targetWindowId) return { ok: false };
    await moveTabIntoWindowAndFocus(tab.id, targetWindowId, "moveTabIntoWindow");
    return { ok: true };
  },

  moveTabLeft: async (sender) => moveTab(sender, -1),

  goToFirstTab: async () => activateTabByIndex(0),

  goToLastTab: async () => activateTabByIndex(-1),

  moveTabRight: async (sender) => moveTab(sender, 1),

  duplicateTab: async (sender) => {
    if (sender.tab && sender.tab.id) {
      await chrome.tabs.duplicate(sender.tab.id);
    }
    return { ok: true };
  },

  togglePin: async (sender) => {
    const tab = sender.tab;
    if (tab && tab.id) {
      await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    }
    return { ok: true };
  },

  toggleMute: async (sender) => {
    const tab = sender.tab;
    if (tab && tab.id) {
      const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
      await chrome.tabs.update(tab.id, { muted: !muted });
    }
    return { ok: true };
  },

  reloadTab: async (sender, { bypassCache = false } = {}) => {
    if (sender.tab && sender.tab.id) {
      await chrome.tabs.reload(sender.tab.id, { bypassCache });
    }
    return { ok: true };
  },

  goBack: async (sender) => goHistory(sender.tab, -1),
  goForward: async (sender) => goHistory(sender.tab, 1),

  listTabs: async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: !!tab.active,
      lastAccessed: tab.lastAccessed || 0,
      audible: !!tab.audible,
    }));
  },

  suggest: async (_, { query = "" } = {}) => {
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
    const sources = await getSuggestionSources();
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
        for (const tab of tabs) push(tab.title || "", tab.url || "", "tab", { lastAccessed: tab.lastAccessed || 0, audible: !!tab.audible });
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
      }
      if (sources.includes("bookmark")) {
        try {
          const folderMap = await getBookmarkFolderMap();
          const bms = await chrome.bookmarks.search(qRaw);
          for (const bm of bms) if (bm.url) {
            const path = folderMap.get(bm.parentId) || [];
            push(bm.title, bm.url, "bookmark", { dateAdded: bm.dateAdded || 0, folderPath: path.join(" / ") });
          }
        } catch (err) {
          console.debug("[jari] Bookmark search failed:", err);
        }
      }
    }
    const items = Array.from(map.values());
    return items.slice(0, 50);
  },

  search: async (sender, { query = "", newTab = true } = {}) => {
    const text = query.trim();
    if (!text) return { ok: false };
    if (typeof chrome.search?.query === "function") {
      await chrome.search.query({
        text,
        disposition: newTab ? "NEW_TAB" : "CURRENT_TAB",
      });
      return { ok: true };
    }
    const url = "https://www.google.com/search?q=" + encodeURIComponent(text);
    if (newTab) {
      await chrome.tabs.create({ url });
    } else if (sender.tab && sender.tab.id) {
      await chrome.tabs.update(sender.tab.id, { url });
    }
    return { ok: true };
  },

  activateTab: async (_, { id } = {}) => {
    if (!id) return { ok: false };
    let windowId = null;
    try {
      const tab = await chrome.tabs.get(id);
      windowId = tab && tab.windowId;
    } catch {

    }

    try {
      await chrome.tabs.update(id, { active: true });
    } catch (err) {
      return { ok: false, error: String(err) };
    }
    if (windowId) {
      await focusWindow(windowId, "activateTab");
    }
    return { ok: true };
  },

  zoomBy: async (sender, { delta = 0 } = {}) => {
    const tab = sender.tab;
    if (
      !tab ||
      !tab.id ||
      typeof chrome.tabs.getZoom !== "function" ||
      typeof chrome.tabs.setZoom !== "function"
    ) {

      return { ok: false };
    }
    const current = await chrome.tabs.getZoom(tab.id);
    const next = Math.min(5, Math.max(0.25, current + delta));
    await chrome.tabs.setZoom(tab.id, next);
    return { ok: true, zoom: next };
  },

  openInBackgroundTab: async (_, { url } = {}) => openTab(url, false),

  openInForegroundTab: async (_, { url } = {}) => openTab(url, true),

  openSettings: async () => {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },

  openExtensions: async () => {
    const urls = ["chrome://extensions", "about:addons", "edge://extensions"];
    for (const url of urls) {
      try {
        await chrome.tabs.create({ url });
        return { ok: true };
      } catch {}
    }
    return { ok: false };
  },
};

async function goHistory(tab, delta) {
  if (!tab || !tab.id) return { ok: false };
  const method = delta < 0 ? "goBack" : "goForward";
  if (typeof chrome.tabs[method] === "function") {
    try {
      await chrome.tabs[method](tab.id);
    } catch {
      return { ok: true };
    }
  }
  return { ok: true };
}

async function switchTab(current, delta) {
  if (!current || !current.id) return { ok: false };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length < 2) return { ok: false };
  const index = tabs.findIndex((tab) => tab.id === current.id);
  if (index === -1) return { ok: false };
  const nextIndex =
    (((index + delta) % tabs.length) + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[nextIndex].id, { active: true });
  return { ok: true };
}

async function openTab(url, active) {
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  await chrome.tabs.create({ url: target, active });
  return { ok: true };
}

async function moveTab(sender, delta) {
  const tab = sender.tab;
  if (tab && tab.id) {
    await chrome.tabs.move(tab.id, { index: Math.max(0, tab.index + delta) });
  }
  return { ok: true };
}

async function activateTabByIndex(index) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = tabs[index < 0 ? tabs.length + index : index];
  if (tab) await chrome.tabs.update(tab.id, { active: true });
  return { ok: true };
}

async function moveTabIntoWindowAndFocus(tabId, targetWindowId, context) {
  await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const last = tabs[tabs.length - 1];
  if (last) {
    await focusWindow(targetWindowId, context);
    await chrome.tabs.update(last.id, { active: true });
  }
}

async function focusWindow(windowId, context = "focusWindow") {
  try {
    const win = await chrome.windows.get(windowId);
    if (win && win.state === "minimized") {
      await chrome.windows.update(windowId, { focused: true, state: "normal" });
    } else {
      await chrome.windows.update(windowId, { focused: true });
    }
  } catch (err) {
    console.error(`[jari] ${context} window focus failed`, err);
  }
}

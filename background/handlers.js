import {
  blockedUrlSchemes,
  suggestionSources,
  urlSchemes,
} from "../shared/constants.js";

export function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (url.startsWith("//")) return "https:" + url;
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return "https://" + url;
  const scheme = m[1].toLowerCase();
  if (urlSchemes.has(scheme)) return url;
  if (blockedUrlSchemes.has(scheme)) return null;

  const rest = url.slice(m[0].length);
  if (/^(\d+)(\/.*)?$/.test(rest)) return "https://" + url;
  return null;
}

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

  splitTab: async (sender) => {
    if (sender.tab && sender.tab.id) {
      await chrome.windows.create({ tabId: sender.tab.id });
    }
    return { ok: true };
  },

  splitOrMerge: async (sender) => {
    const tab = sender.tab;
    if (!tab || !tab.id) return { ok: false };
    const myTabs = await chrome.tabs.query({ windowId: tab.windowId });
    if (myTabs.length > 1) {
      await chrome.windows.create({ tabId: tab.id });
      return { ok: true, split: true };
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
    if (others.length === 0) return { ok: true, needMerge: false };
    return {
      ok: true,
      needMerge: true,
      ownTabId: tab.id,
      ownWindowId: tab.windowId,
      tabs: others,
    };
  },

  mergeTab: async (sender, { targetWindowId } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id || !targetWindowId) return { ok: false };
    await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
    const tabs = await chrome.tabs.query({ windowId: targetWindowId });
    const last = tabs[tabs.length - 1];
    if (last) {

      try {
        await focusWindow(targetWindowId);
      } catch (err) {
        console.error("[jari] mergeTab window focus failed", err);
      }
      await chrome.tabs.update(last.id, { active: true });
    }
    return { ok: true };
  },

  moveTabLeft: async (sender) => {
    const tab = sender.tab;
    if (tab && tab.id) {
      await chrome.tabs.move(tab.id, { index: Math.max(0, tab.index - 1) });
    }
    return { ok: true };
  },

  firstTab: async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
    return { ok: true };
  },

  lastTab: async () => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length)
      await chrome.tabs.update(tabs[tabs.length - 1].id, { active: true });
    return { ok: true };
  },

  moveTabRight: async (sender) => {
    const tab = sender.tab;
    if (tab && tab.id) {
      await chrome.tabs.move(tab.id, { index: tab.index + 1 });
    }
    return { ok: true };
  },

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

  historyBack: async (sender) => goHistory(sender.tab, -1),
  historyForward: async (sender) => goHistory(sender.tab, 1),

  listTabs: async () => {

    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: !!tab.active,
    }));
  },

  suggest: async (_, { query = "" } = {}) => {
    const q = query.trim().toLowerCase();
    const items = [];
    const seen = new Set();
    function push(title, url, source) {
      if (!url || seen.has(url)) return;
      seen.add(url);
      items.push({ title: title || url, url, source });
    }
    const sources = await getSuggestionSources();
    if (sources.includes("tab")) {
      try {
        const tabs = await chrome.tabs.query({});

        for (const tab of tabs) push(tab.title || "", tab.url || "", "tab");
      } catch (err) {
        console.debug("[jari] Tab search failed:", err);
      }
    }
    if (q) {
      if (sources.includes("history")) {
        try {
          const results = await chrome.history.search({
            text: q,
            maxResults: 12,
            startTime: 0,
          });
          for (const item of results) push(item.title, item.url, "history");
        } catch (err) {
          console.debug("[jari] History search failed:", err);
        }
      }
      if (sources.includes("bookmark")) {
        try {
          const bms = await chrome.bookmarks.search(q);
          for (const bm of bms) if (bm.url) push(bm.title, bm.url, "bookmark");
        } catch (err) {
          console.debug("[jari] Bookmark search failed:", err);
        }
      }
    }
    return items.slice(0, 40);
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

    if (id) {
      try {
        await chrome.tabs.update(id, { active: true });
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
    if (windowId) {
      try {
        await focusWindow(windowId);
      } catch (err) {
        console.error("[jari] activateTab window focus failed", err);
      }
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

  openInBackgroundTab: async (_, { url } = {}) => {
    const target = normalizeUrl(url);
    if (!target) return { ok: false };
    await chrome.tabs.create({ url: target, active: false });
    return { ok: true };
  },

  openOptions: async () => {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
};

async function goHistory(tab, delta) {
  if (!tab || !tab.id) return { ok: false };
  const method = delta < 0 ? "goBack" : "goForward";
  if (typeof chrome.tabs[method] === "function") {
    try {
      await chrome.tabs[method](tab.id);
    } catch {

    }
    return { ok: true };
  }
  try {
    await chrome.tabs.executeScript(tab.id, { code: `history.go(${delta})` });
  } catch {

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

async function focusWindow(windowId) {
  const win = await chrome.windows.get(windowId);
  if (win && win.state === "minimized") {
    await chrome.windows.update(windowId, { focused: true, state: "normal" });
  } else {
    await chrome.windows.update(windowId, { focused: true });
  }
}

const hintFrames = new Map();
const hintModes = new Map();
const lastRescan = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  hintFrames.delete(tabId);
  hintModes.delete(tabId);
  lastRescan.delete(tabId);
});

export async function coordinateHints(message, sender) {
  const fromExtensionPage =
    sender.url && sender.url.startsWith("chrome-extension://");
  if (!sender.tab || fromExtensionPage) {
    return { needsRelay: false, drawLocally: true };
  }
  return coordinateHintsForTab(sender.tab.id, message.mode, sender.frameId);
}

async function coordinateHintsForTab(tabId, mode, senderFrameId) {
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return { needsRelay: false };
  }

  let currentIndex = 0;
  let total = 0;
  const counts = new Map();

  for (const frame of frames) {
    try {
      const count = await chrome.tabs.sendMessage(
        tabId,
        { type: "COUNT_HINTS", mode },
        { frameId: frame.frameId },
      );
      if (count > 0) {
        counts.set(frame.frameId, count);
        total += count;
      }
    } catch {

    }
  }

  if (total === 0) {
    for (const frame of frames) {
      try {
        chrome.tabs.sendMessage(
          tabId,
          frame.frameId === 0
            ? { type: "HINTS_RESET", toast: "No matches" }
            : { type: "HINTS_RESET" },
          { frameId: frame.frameId },
        );
      } catch {

      }
    }
    hintFrames.delete(tabId);
    hintModes.delete(tabId);
    return { needsRelay: false };
  }

  if (mode === "focus" && total === 1) {
    const frameId = [...counts.entries()].find(([, count]) => count === 1)?.[0];
    for (const frame of frames) {
      if (frame.frameId === frameId) continue;
      try {
        chrome.tabs.sendMessage(
          tabId,
          { type: "HINTS_RESET" },
          { frameId: frame.frameId },
        );
      } catch {

      }
    }
    if (frameId !== undefined) {
      try {
        chrome.tabs.sendMessage(
          tabId,
          { type: "HINTS_FOCUS_SINGLE" },
          { frameId },
        );
      } catch {

      }
    }
    hintFrames.delete(tabId);
    hintModes.delete(tabId);
    return { needsRelay: false };
  }

  for (const frame of frames) {
    const count = counts.get(frame.frameId);
    if (!count) continue;
    try {
      chrome.tabs.sendMessage(
        tabId,
        {
          type: "DRAW_HINTS",
          startIndex: currentIndex,
          total,
          needsRelay: counts.size > 1 || !counts.has(frame.frameId),
        },
        { frameId: frame.frameId },
      );
      currentIndex += count;
    } catch {

    }
  }

  hintFrames.set(tabId, new Set(counts.keys()));
  hintModes.set(tabId, mode);

  return {
    needsRelay: counts.size > 1 || !counts.has(senderFrameId),
  };
}

// A content script saw the page change while its hints are open (late-rendered
// content). Re-run the whole coordination so new clickables get hints in every
// frame and the global label indices stay consistent. Debounced so the many
// mutations of one update (and observers firing in several frames at once)
// collapse into a single re-coordination.
export async function handleRescan(message, sender) {
  if (!sender.tab) return;
  const tabId = sender.tab.id;
  const mode = hintModes.get(tabId);
  if (!mode) return;
  const now = Date.now();
  const last = lastRescan.get(tabId) || 0;
  if (now - last < 400) return;
  lastRescan.set(tabId, now);
  await coordinateHintsForTab(tabId, mode, sender.frameId);
}

async function getHintFrameIds(tabId) {
  const open = hintFrames.get(tabId);
  if (open && open.size) return [...open];
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    return [];
  }
  return (frames || []).map((f) => f.frameId);
}

export async function relayHintKey(message, sender) {
  const frameIds = await getHintFrameIds(sender.tab.id);
  let anyClosed = Boolean(message.closed);
  let totalRemaining = message.remaining || 0;

  for (const frameId of frameIds) {
    if (frameId === sender.frameId) continue;
    try {
      const res = await chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "HINTS_KEY", key: message.key },
        { frameId },
      );
      if (res) {
        if (res.closed) anyClosed = true;
        totalRemaining += res.remaining || 0;
      }
    } catch {

    }
  }

  if (anyClosed || totalRemaining === 0) {
    await closeAllHints(sender.tab.id);
  }
}

async function closeAllHints(tabId) {
  const open = hintFrames.get(tabId);
  if (open) hintFrames.delete(tabId);
  hintModes.delete(tabId);

  let frameIds;
  if (open && open.size) {
    frameIds = [...open];
  } else {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      frameIds = (frames || []).map((f) => f.frameId);
    } catch {
      return;
    }
  }

  for (const frameId of frameIds) {
    try {
      chrome.tabs.sendMessage(tabId, { type: "HINTS_CLOSE" }, { frameId });
    } catch {

    }
  }
}

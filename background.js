// Jari background service worker / event page.
// Dispatches messages from content scripts to the browser APIs.
// Handlers: (sender, payload) => result | Promise<result>

// URL safety: only plain web-ish destinations may be navigated to or opened
// in tabs. Everything else (javascript:, data:, chrome:, ...) is rejected,
// and bare hostnames are assumed to be https.
const ALLOWED_URL_SCHEMES = new Set(["http", "https", "file", "about"]);
const BLOCKED_URL_SCHEMES = new Set([
  "javascript",
  "data",
  "vbscript",
  "chrome",
  "chrome-extension",
  "edge",
  "moz-extension",
  "view-source",
]);

function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (url.startsWith("//")) return "https:" + url;
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return "https://" + url;
  const scheme = m[1].toLowerCase();
  if (ALLOWED_URL_SCHEMES.has(scheme)) return url;
  if (BLOCKED_URL_SCHEMES.has(scheme)) return null;
  // Unknown scheme is probably a hostname (e.g. "localhost:8080").
  return "https://" + url;
}

function clampCount(count, max = 20) {
  const n = Math.floor(count);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

const handlers = {
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

  createWindow: async (_, { url } = {}) => {
    const target = url === undefined ? undefined : normalizeUrl(url);
    if (url !== undefined && !target) return { ok: false };
    await chrome.windows.create(target ? { url: target } : {});
    return { ok: true };
  },

  setZoom: async (sender, { level = 1 } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id || typeof chrome.tabs.setZoom !== "function") {
      // Firefox does not implement tabs.setZoom.
      return { ok: false };
    }
    await chrome.tabs.setZoom(tab.id, Math.min(5, Math.max(0.25, level)));
    return { ok: true, zoom: level };
  },

  closeTab: async (sender, { count = 1 } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id) return { ok: false };
    const ids = [tab.id];
    let prev = tab;
    // Walk count-1 tabs to the right, one after the previous. prev.index + i
    // would skip tabs (i grows while prev already advances).
    for (let i = 1; i < clampCount(count); i++) {
      const next = await getTabAt(prev.index + 1);
      if (!next) break;
      ids.push(next.id);
      prev = next;
    }
    await chrome.tabs.remove(ids);
    return { ok: true, closed: ids.length };
  },

  restoreTab: async (_, { count = 1 } = {}) => {
    // Only reopen tabs, never whole windows: chrome.sessions.restore() with no
    // sessionId can bring back a closed window. getRecentlyClosed lists both
    // kinds; the tab sessions carry a tab.sessionId to restore individually.
    let sessions;
    try {
      sessions = await chrome.sessions.getRecentlyClosed();
    } catch {
      return { ok: true };
    }
    const tabs = (sessions || []).filter((s) => s.tab && s.tab.sessionId);
    for (let i = 0; i < Math.min(clampCount(count), tabs.length); i++) {
      try {
        await chrome.sessions.restore(tabs[i].tab.sessionId);
      } catch {
        break; // nothing left to restore
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

  // Split the active tab into its own window. In a single-tab window, return
  // the OTHER windows (with their active tab's title) so the page can offer
  // to merge back into one of them.
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
        const wtab = win.tabs && win.tabs.length
          ? win.tabs.find((t) => t.active) || win.tabs[0]
          : null;
        return {
          windowId: win.id,
          title: wtab && wtab.title ? wtab.title : "Window",
          url: `${win.tabs ? win.tabs.length : 0} tabs`,
        };
      });
    if (others.length === 0) return { ok: true, needMerge: false };
    return { ok: true, needMerge: true, ownTabId: tab.id, ownWindowId: tab.windowId, tabs: others };
  },

  // Move the sender's tab to the end of another window's strip and focus it
  // there; the emptied window closes itself. The moved tab is appended at the
  // end, so activating the window's last tab focuses the merged tab — the
  // sender's tab object can go stale once its old window closes, so the last
  // tab is re-queried fresh instead of trusting its id.
  mergeTab: async (sender, { targetWindowId } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id || !targetWindowId) return { ok: false };
    await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
    const tabs = await chrome.tabs.query({ windowId: targetWindowId });
    const last = tabs[tabs.length - 1];
      if (last) {
        // Focus the target window (restoring it if minimized), then activate
        // the merged tab. The moved tab is appended at the end, so the
        // window's last tab is the merged one — re-queried fresh, since the
        // sender's tab object can go stale once its old window closes.
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
    if (tabs.length) await chrome.tabs.update(tabs[tabs.length - 1].id, { active: true });
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
    // Search every window, not just the current one.
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: !!tab.active,
    }));
  },

  // Autocomplete for the "t" omnibar: matching history, bookmarks and open
  // tabs, deduped by URL (history wins). Each source is best-effort — a
  // missing permission just skips it.
  suggest: async (_, { query = "" } = {}) => {
    const q = query.trim().toLowerCase();
    const items = [];
    const seen = new Set();
    function push(title, url, source) {
      if (!url || seen.has(url)) return;
      seen.add(url);
      items.push({ title: title || url, url, source });
    }
    if (q) {
      try {
        const results = await chrome.history.search({ text: q, maxResults: 12, startTime: 0 });
        for (const item of results) push(item.title, item.url, "history");
      } catch {}
      try {
        const bms = await chrome.bookmarks.search(q);
        for (const bm of bms) if (bm.url) push(bm.title, bm.url, "bookmark");
      } catch {}
    }
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        const title = tab.title || "";
        const url = tab.url || "";
        if (!q || title.toLowerCase().includes(q) || url.toLowerCase().includes(q)) {
          push(title, url, "tab");
        }
      }
    } catch {}
    return items.slice(0, 15);
  },

  // Search with the browser's default engine, in a new foreground tab by
  // default ("ge" edits the current page, so it searches in the current tab).
  // chrome.search.query is cross-browser (Chrome + Firefox 111+); fall back
  // to a plain search URL if the API is unavailable.
  search: async (sender, { query = "", newTab = true } = {}) => {
    const text = query.trim();
    if (!text) return { ok: false };
    if (typeof chrome.search?.query === "function") {
      await chrome.search.query({ text, disposition: newTab ? "NEW_TAB" : "CURRENT_TAB" });
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
      // Tab closed since the list was drawn; the update below will fail too.
    }
    // Activate the tab first, then bring its window forward. tabs.update
    // alone does not focus the window, and a minimized window must be
    // restored too. Each step is independent so one failure cannot block the
    // other.
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
      // Firefox does not implement tabs.setZoom.
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

async function getTabAt(index) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.find((tab) => tab.index === index) || null;
}

// Navigate the tab's history. Chrome no-ops when there is nothing to go to,
// but Firefox rejects — treat "no history" as success so K in a fresh tab
// does not log errors. Engines without tabs.goBack/goForward fall back to
// running history.go() inside the page.
async function goHistory(tab, delta) {
  if (!tab || !tab.id) return { ok: false };
  const method = delta < 0 ? "goBack" : "goForward";
  if (typeof chrome.tabs[method] === "function") {
    try {
      await chrome.tabs[method](tab.id);
    } catch {
      // No history entry in that direction.
    }
    return { ok: true };
  }
  try {
    await chrome.tabs.executeScript(tab.id, { code: `history.go(${delta})` });
  } catch {
    // Injection blocked (no host permission) — nothing more we can do.
  }
  return { ok: true };
}

async function switchTab(current, delta) {
  if (!current || !current.id) return { ok: false };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length < 2) return { ok: false };
  const index = tabs.findIndex((tab) => tab.id === current.id);
  if (index === -1) return { ok: false };
  const nextIndex = (((index + delta) % tabs.length) + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[nextIndex].id, { active: true });
  return { ok: true };
}

// Bring a window forward without wrecking its size. Passing state: "normal"
// unconditionally un-maximizes maximized windows and exits fullscreen, so
// only request it when the window is actually minimized.
async function focusWindow(windowId) {
  const win = await chrome.windows.get(windowId);
  if (win && win.state === "minimized") {
    await chrome.windows.update(windowId, { focused: true, state: "normal" });
  } else {
    await chrome.windows.update(windowId, { focused: true });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message && message.action];
  if (!handler) return;

  const result = handler(sender, message || {});
  if (result && typeof result.then === "function") {
    result.then(
      (value) => sendResponse(value || { ok: true }),
      (err) => {
        console.error(`[jari] ${message.action} failed`, err);
        sendResponse({ ok: false, error: String(err) });
      },
    );
    return true; // keep the message channel open for the async response
  }
  sendResponse(result || { ok: true });
});

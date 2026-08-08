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
    for (let i = 1; i < clampCount(count); i++) {
      const next = await getTabAt(prev.index + i);
      if (!next) break;
      ids.push(next.id);
      prev = next;
    }
    await chrome.tabs.remove(ids);
    return { ok: true, closed: ids.length };
  },

  restoreTab: async () => {
    await chrome.sessions.restore();
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

  // Move the sender's tab to the end of another window's strip; the emptied
  // window closes itself. Optionally activate a specific tab in the target.
  mergeTab: async (sender, { targetWindowId, targetTabId } = {}) => {
    const tab = sender.tab;
    if (!tab || !tab.id || !targetWindowId) return { ok: false };
    await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
    if (targetTabId) await chrome.tabs.update(targetTabId, { active: true });
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
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || "",
      url: tab.url || "",
      active: !!tab.active,
    }));
  },

  activateTab: async (_, { id } = {}) => {
    if (id) {
      await chrome.tabs.update(id, { active: true });
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

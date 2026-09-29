import { normalizeUrl } from "../shared/url.js";
import { clampCount } from "./utils.js";
import { focusWindow, moveTabIntoWindowAndFocus, openInIncognito } from "./windows.js";

export async function createTab(_, { url } = {}) {
  const target = url === undefined ? undefined : normalizeUrl(url);
  if (url !== undefined && !target) return { ok: false };
  const tab = await chrome.tabs.create(target ? { url: target } : {});
  return tab ? { ok: true, id: tab.id } : { ok: false };
}

export async function openIncognitoTab(_, { url } = {}) {
  const target = url === undefined ? undefined : normalizeUrl(url);
  if (url !== undefined && !target) return { ok: false };
  return openInIncognito(target);
}

export async function navigate(sender, { url } = {}) {
  const target = normalizeUrl(url);
  if (!target || !sender.tab || !sender.tab.id) return { ok: false };
  await chrome.tabs.update(sender.tab.id, { url: target });
  return { ok: true };
}

export async function closeTab(sender, { count = 1 } = {}) {
  const tab = sender.tab;
  if (!tab || !tab.id) return { ok: false };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const index = tabs.findIndex((t) => t.id === tab.id);
  if (index === -1) return { ok: false };
  const ids = tabs.slice(index, index + clampCount(count)).map((t) => t.id);
  await chrome.tabs.remove(ids);
  return { ok: true, closed: ids.length };
}

export async function restoreTab(_, { count = 1 } = {}) {
  let sessions;
  try {
    sessions = await chrome.sessions.getRecentlyClosed();
  } catch (err) {
    console.debug("[jari] Failed to get recently closed sessions:", err);
    return { ok: false };
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
}

export async function previousTab(sender, { count = 1 } = {}) {
  return switchTab(sender.tab, -clampCount(count));
}

export async function nextTab(sender, { count = 1 } = {}) {
  return switchTab(sender.tab, clampCount(count));
}

export async function moveTabToWindow(sender) {
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
}

export async function moveTabIntoWindow(sender, { targetWindowId } = {}) {
  const tab = sender.tab;
  if (!tab || !tab.id || !targetWindowId) return { ok: false };
  await moveTabIntoWindowAndFocus(tab.id, targetWindowId, "moveTabIntoWindow");
  return { ok: true };
}

export async function moveTabLeft(sender) {
  return moveTab(sender, -1);
}

export async function moveTabRight(sender) {
  return moveTab(sender, 1);
}

export async function goToFirstTab() {
  return activateTabByIndex(0);
}

export async function goToLastTab() {
  return activateTabByIndex(-1);
}

export async function duplicateTab(sender) {
  if (sender.tab && sender.tab.id) {
    await chrome.tabs.duplicate(sender.tab.id);
    return { ok: true };
  }
  return { ok: false };
}

export async function togglePin(sender) {
  const tab = sender.tab;
  if (tab && tab.id) {
    await chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    return { ok: true };
  }
  return { ok: false };
}

export async function toggleMute(sender) {
  const tab = sender.tab;
  if (tab && tab.id) {
    const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
    await chrome.tabs.update(tab.id, { muted: !muted });
    return { ok: true };
  }
  return { ok: false };
}

export async function reloadTab(sender, { bypassCache = false } = {}) {
  if (sender.tab && sender.tab.id) {
    await chrome.tabs.reload(sender.tab.id, { bypassCache });
    return { ok: true };
  }
  return { ok: false };
}

export async function goBack(sender) {
  return goHistory(sender.tab, -1);
}

export async function goForward(sender) {
  return goHistory(sender.tab, 1);
}

export async function listTabs() {
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
}

async function goHistory(tab, delta) {
  if (!tab || !tab.id) return { ok: false };
  const method = delta < 0 ? "goBack" : "goForward";
  if (typeof chrome.tabs[method] === "function") {
    try {
      await chrome.tabs[method](tab.id);
    } catch {
      return { ok: false };
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

async function moveTab(sender, delta) {
  const tab = sender.tab;
  if (tab && tab.id) {
    await chrome.tabs.move(tab.id, { index: Math.max(0, tab.index + delta) });
    return { ok: true };
  }
  return { ok: false };
}

async function activateTabByIndex(index) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = tabs[index < 0 ? tabs.length + index : index];
  if (!tab) return { ok: false };
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: true };
}

export async function activateTab(_, { id } = {}) {
  if (!id) return { ok: false };
  let windowId = null;
  try {
    const tab = await chrome.tabs.get(id);
    windowId = tab && tab.windowId;
  } catch {}
  try {
    await chrome.tabs.update(id, { active: true });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  if (windowId) {
    await focusWindow(windowId, "activateTab");
  }
  return { ok: true };
}

export async function zoomBy(sender, { delta = 0 } = {}) {
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
}

export async function openTab(url, active) {
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  await chrome.tabs.create({ url: target, active });
  return { ok: true };
}

export async function openInBackgroundTab(_, { url } = {}) {
  return openTab(url, false);
}

export async function openInForegroundTab(_, { url } = {}) {
  return openTab(url, true);
}

export async function captureScreenshot(sender) {
  const windowId = sender && sender.tab && sender.tab.windowId;
  if (!Number.isInteger(windowId)) return { ok: false };
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      return { ok: false };
    }
    return { ok: true, dataUrl };
  } catch {
    return { ok: false };
  }
}

export async function openSettings() {
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

function extensionsPageUrl() {
  let ua;
  try {
    ua = navigator.userAgent || "";
  } catch {
    return "chrome://extensions";
  }
  if (/firefox/i.test(ua)) return null;
  if (/edg/i.test(ua)) return "edge://extensions";
  return "chrome://extensions";
}

export async function openExtensions() {
  const url = extensionsPageUrl();
  if (!url) return { ok: false, reason: "blocked" };
  try {
    await chrome.tabs.create({ url });
    return { ok: true };
  } catch (err) {
    console.debug(`[jari] openExtensions ${url} failed:`, err);
    return { ok: false, reason: "blocked" };
  }
}

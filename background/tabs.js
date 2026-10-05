import { normalizeUrl } from "../shared/url.js";
import { clampCount } from "./utils.js";
import { bookmarkedUrlKeys, bookmarkUrlKey } from "./bookmarks.js";
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

function sanitizeIds(ids, max = 100) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (!Number.isInteger(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

function hasApi(path) {
  try {
    let owner = chrome;
    for (const name of path) {
      if (!owner || typeof owner[name] === "undefined") return false;
      owner = owner[name];
    }
    return typeof owner === "function";
  } catch {
    return false;
  }
}

function groupsSupported() {
  return hasApi(["tabs", "group"]) && hasApi(["tabs", "ungroup"]);
}

export async function managerList(sender) {
  let raw;
  try {
    raw = (await chrome.tabs.query({})) || [];
  } catch {
    return { ok: false };
  }
  let bookmarkedUrls = new Set();
  if (chrome.bookmarks && typeof chrome.bookmarks.getTree === "function") {
    bookmarkedUrls = await bookmarkedUrlKeys();
  }
  const tabs = raw.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    index: typeof tab.index === "number" ? tab.index : 0,
    title: tab.title || "",
    url: tab.url || "",
    active: !!tab.active,
    pinned: !!tab.pinned,
    muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
    audible: !!tab.audible,
    bookmarked: bookmarkedUrls.has(bookmarkUrlKey(tab.url || "")),
    groupId: typeof tab.groupId === "number" ? tab.groupId : -1,
    lastAccessed: tab.lastAccessed || 0,
  }));
  let groups = [];
  try {
    if (chrome.tabGroups && typeof chrome.tabGroups.query === "function") {
      const found = (await chrome.tabGroups.query({})) || [];
      groups = found.map((group) => ({
        id: group.id,
        title: group.title || "",
        color: group.color || "",
        collapsed: !!group.collapsed,
      }));
    }
  } catch {}
  return { ok: true, tabs, groups, currentWindowId: await currentWindowId(sender) };
}

async function currentWindowId(sender) {
  if (sender && sender.tab && Number.isInteger(sender.tab.windowId)) {
    return sender.tab.windowId;
  }
  try {
    if (chrome.windows && typeof chrome.windows.getLastFocused === "function") {
      const win = await chrome.windows.getLastFocused();
      if (win && Number.isInteger(win.id)) return win.id;
    }
  } catch {}
  return null;
}

export async function closeManagerTabs(_, { ids } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  try {
    await chrome.tabs.remove(targets);
  } catch {
    return { ok: false };
  }
  return { ok: true, closed: targets.length };
}

export async function setTabsPinned(_, { ids, pinned } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  const next = !!pinned;
  const results = await Promise.allSettled(
    targets.map((id) => chrome.tabs.update(id, { pinned: next })),
  );
  const updated = results.filter((r) => r.status === "fulfilled").length;
  return updated > 0 ? { ok: true, updated, pinned: next } : { ok: false };
}

export async function setTabsMuted(_, { ids, muted } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  const next = !!muted;
  const results = await Promise.allSettled(
    targets.map((id) => chrome.tabs.update(id, { muted: next })),
  );
  const updated = results.filter((r) => r.status === "fulfilled").length;
  return updated > 0 ? { ok: true, updated, muted: next } : { ok: false };
}

export async function moveManagerTabs(_, { ids, delta = 0 } = {}) {
  const targets = sanitizeIds(ids);
  const step = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  if (targets.length === 0 || step === 0) return { ok: false };
  let all;
  try {
    all = (await chrome.tabs.query({})) || [];
  } catch {
    return { ok: false };
  }
  const byId = new Map(all.map((tab) => [tab.id, tab]));
  const perWindow = new Map();
  for (const id of targets) {
    const tab = byId.get(id);
    if (!tab) continue;
    const pinned = !!tab.pinned;
    const key = `${tab.windowId}:${pinned ? "pinned" : "open"}`;
    if (!perWindow.has(key)) {
      perWindow.set(key, { windowId: tab.windowId, pinned, ids: [] });
    }
    perWindow.get(key).ids.push(id);
  }
  if (perWindow.size === 0) return { ok: false };
  let moved = 0;
  for (const { windowId, pinned, ids: group } of perWindow.values()) {
    const siblings = all
      .filter((tab) => tab.windowId === windowId && !!tab.pinned === pinned)
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.id);
    if (siblings.length < 2) continue;
    const positions = group
      .map((id) => siblings.indexOf(id))
      .sort((a, b) => a - b);
    if (positions.some((pos) => pos < 0)) continue;
    const target = Math.min(
      siblings.length - group.length,
      Math.max(0, positions[0] + step),
    );
    try {
      await chrome.tabs.move(group, { index: target });
      moved += group.length;
    } catch {}
  }
  return moved > 0 ? { ok: true, moved } : { ok: false };
}

export async function duplicateManagerTabs(_, { ids } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  const activeBefore = new Map();
  try {
    for (const tab of (await chrome.tabs.query({ active: true })) || []) {
      if (tab && Number.isInteger(tab.windowId)) activeBefore.set(tab.windowId, tab.id);
    }
  } catch {}
  const created = [];
  for (const id of [...targets].reverse()) {
    try {
      const tab = await chrome.tabs.duplicate(id);
      if (tab && Number.isInteger(tab.id)) created.push(tab);
    } catch {}
  }
  for (const windowId of new Set(created.map((tab) => tab.windowId))) {
    const previous = activeBefore.get(windowId);
    if (previous === undefined) continue;
    if (created.some((tab) => tab.windowId === windowId && tab.id === previous)) {
      continue;
    }
    try {
      await chrome.tabs.update(previous, { active: true });
    } catch {}
  }
  return created.length > 0
    ? { ok: true, duplicated: created.length, ids: created.map((tab) => tab.id) }
    : { ok: false };
}

export async function editManagerTab(_, { id, url } = {}) {
  if (!Number.isInteger(id)) return { ok: false };
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  try {
    await chrome.tabs.update(id, { url: target });
    return { ok: true, url: target };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function groupManagerTabs(_, { ids, groupId } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  if (!groupsSupported()) return { ok: false, reason: "unsupported" };
  try {
    const options =
      Number.isInteger(groupId) && groupId >= 0
        ? { tabIds: targets, groupId }
        : { tabIds: targets };
    const createdId = await chrome.tabs.group(options);
    return { ok: true, groupId: createdId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function ungroupManagerTabs(_, { ids } = {}) {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  if (!groupsSupported()) return { ok: false, reason: "unsupported" };
  try {
    await chrome.tabs.ungroup(targets);
    return { ok: true, ungrouped: targets.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function renameGroup(_, { groupId, title } = {}) {
  if (!Number.isInteger(groupId)) return { ok: false };
  if (!hasApi(["tabGroups", "update"])) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    await chrome.tabGroups.update(groupId, {
      title: String(title ?? "").slice(0, 100),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
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

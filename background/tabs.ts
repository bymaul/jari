import { normalizeUrl } from "../shared/url.ts";
import { clampCount } from "./utils.ts";
import { bookmarkedUrlKeys, bookmarkUrlKey } from "./bookmarks.ts";
import { focusWindow, moveTabIntoWindowAndFocus, openInIncognito } from "./windows.ts";
import type {
  GroupSummary,
  ManagerTab,
  MessagePayload,
  MessageResponse,
  TabSummary,
  WindowSummary,
} from "../shared/protocol.ts";

type Sender = chrome.runtime.MessageSender;
/** @types/chrome models multi-id tab APIs as non-empty tuples; the real
 *  browser accepts plain arrays, so id lists pass through this cast. */
const asTabIds = (ids: number[]): [number, ...number[]] =>
  ids as unknown as [number, ...number[]];

function resolveTarget(
  url: unknown,
): { ok: true; target: string | undefined } | { ok: false } {
  if (url === undefined) return { ok: true, target: undefined };
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  return { ok: true, target };
}

export async function createTab(
  _: Sender,
  { url }: MessagePayload<"createTab"> = {},
): Promise<MessageResponse<"createTab">> {
  const resolved = resolveTarget(url);
  if (!resolved.ok) return resolved;
  const tab = await chrome.tabs.create(
    resolved.target ? { url: resolved.target } : {},
  );
  return tab ? { ok: true, id: tab.id } : { ok: false };
}

export async function openIncognitoTab(
  _: Sender,
  { url }: MessagePayload<"openIncognitoTab"> = {},
): Promise<MessageResponse<"openIncognitoTab">> {
  const resolved = resolveTarget(url);
  if (!resolved.ok) return resolved;
  return openInIncognito(resolved.target);
}

export async function navigate(
  sender: Sender,
  { url }: MessagePayload<"navigate"> = {},
): Promise<MessageResponse<"navigate">> {
  const target = normalizeUrl(url);
  if (!target || !sender.tab || !sender.tab.id) return { ok: false };
  await chrome.tabs.update(sender.tab.id, { url: target });
  return { ok: true };
}

export async function closeTab(
  sender: Sender,
  { count = 1 }: MessagePayload<"closeTab"> = {},
): Promise<MessageResponse<"closeTab">> {
  const tab = sender.tab;
  if (!tab || !tab.id) return { ok: false };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const index = tabs.findIndex((t) => t.id === tab.id);
  if (index === -1) return { ok: false };
  const ids = tabs.slice(index, index + clampCount(count)).map((t) => t.id!);
  await chrome.tabs.remove(ids);
  return { ok: true, closed: ids.length };
}

export async function restoreTab(
  _: Sender,
  { count = 1 }: MessagePayload<"restoreTab"> = {},
): Promise<MessageResponse<"restoreTab">> {
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
      await chrome.sessions.restore(tabs[i].tab!.sessionId);
    } catch {
      break;
    }
  }
  return { ok: true };
}

export async function previousTab(
  sender: Sender,
  { count = 1 }: MessagePayload<"previousTab"> = {},
): Promise<MessageResponse<"previousTab">> {
  return switchTab(sender.tab, -clampCount(count));
}

export async function nextTab(
  sender: Sender,
  { count = 1 }: MessagePayload<"nextTab"> = {},
): Promise<MessageResponse<"nextTab">> {
  return switchTab(sender.tab, clampCount(count));
}

function summarizeWindow(win: chrome.windows.Window): WindowSummary {
  const wtab =
    win.tabs && win.tabs.length
      ? win.tabs.find((t) => t.active) || win.tabs[0]
      : null;
  return {
    windowId: win.id,
    title: wtab && wtab.title ? wtab.title : "Window",
    url: `${win.tabs ? win.tabs.length : 0} tabs`,
  };
}

export async function moveTabToWindow(
  sender: Sender,
): Promise<MessageResponse<"moveTabToWindow">> {
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
    .map(summarizeWindow);
  if (others.length === 0) return { ok: true, needWindowChoice: false };
  if (others.length === 1) {
    await moveTabIntoWindowAndFocus(
      tab.id as number,
      others[0].windowId as number,
      "moveTabToWindow auto-merge",
    );
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

export async function moveTabIntoWindow(
  sender: Sender,
  { targetWindowId }: MessagePayload<"moveTabIntoWindow"> = {},
): Promise<MessageResponse<"moveTabIntoWindow">> {
  const tab = sender.tab;
  if (!tab || !tab.id || !targetWindowId) return { ok: false };
  await moveTabIntoWindowAndFocus(tab.id, targetWindowId, "moveTabIntoWindow");
  return { ok: true };
}

async function groupingsForIds(
  allTabs: chrome.tabs.Tab[] | null | undefined,
  ids: number[],
): Promise<{ tabIds: number[]; title: string; color: string }[]> {
  if (!groupsSupported()) return [];
  const byId = new Map((allTabs || []).map((tab) => [tab.id, tab]));
  const perGroup = new Map<number, number[]>();
  for (const id of ids) {
    const tab = byId.get(id);
    if (!tab || !Number.isInteger(tab.groupId) || (tab.groupId as number) < 0)
      continue;
    if (!perGroup.has(tab.groupId!)) perGroup.set(tab.groupId!, []);
    perGroup.get(tab.groupId!)!.push(id);
  }
  if (perGroup.size === 0) return [];
  let meta = new Map<number, { title: string; color: string }>();
  try {
    if (chrome.tabGroups && typeof chrome.tabGroups.query === "function") {
      const found = (await chrome.tabGroups.query({})) || [];
      meta = new Map(
        found.map((group) => [
          group.id,
          { title: group.title || "", color: group.color || "" },
        ]),
      );
    }
  } catch {}
  return [...perGroup].map(([groupId, tabIds]) => ({
    tabIds,
    ...(meta.get(groupId) || { title: "", color: "" }),
  }));
}

async function restoreGroupings(
  groupings: { tabIds: number[]; title: string; color: string }[],
): Promise<void> {
  if (!groupsSupported() || groupings.length === 0) return;
  const canRename = hasApi(["tabGroups", "update"]);
  for (const { tabIds, title, color } of groupings) {
    let newId: number;
    try {
      newId = (await chrome.tabs.group({
        tabIds: asTabIds(tabIds),
      })) as unknown as number;
    } catch {
      continue;
    }
    if (!canRename || !Number.isInteger(newId)) continue;
    const patch: chrome.tabGroups.UpdateProperties = {};
    if (title) patch.title = title;
    if (color) patch.color = color as chrome.tabGroups.Color;
    if (Object.keys(patch).length === 0) continue;
    try {
      await chrome.tabGroups.update(newId, patch);
    } catch {}
  }
}

export async function moveManagerTabsToWindow(
  _: Sender,
  { ids }: MessagePayload<"moveManagerTabsToWindow"> = {},
): Promise<MessageResponse<"moveManagerTabsToWindow">> {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  let all;
  try {
    all = (await chrome.tabs.query({})) || [];
  } catch {
    return { ok: false };
  }
  const byId = new Map(all.map((tab) => [tab.id, tab]));
  const live = targets.filter((id) => byId.has(id));
  if (live.length === 0) return { ok: false };
  const kinds = new Set(live.map((id) => !!byId.get(id)!.incognito));
  if (kinds.size > 1) return { ok: false, reason: "incognito" };
  const totalByWindow = new Map();
  const selectedByWindow = new Map();
  for (const tab of all) {
    totalByWindow.set(tab.windowId, (totalByWindow.get(tab.windowId) || 0) + 1);
  }
  for (const id of live) {
    const tab = byId.get(id);
    selectedByWindow.set(tab!.windowId, (selectedByWindow.get(tab!.windowId) || 0) + 1);
  }
  const emptied = new Set();
  for (const [windowId, count] of selectedByWindow) {
    if (count >= (totalByWindow.get(windowId) || 0)) emptied.add(windowId);
  }
  if (emptied.size === 0) {
    const groupings = await groupingsForIds(all, live);
    try {
      const win = await chrome.windows.create({ tabId: live[0] });
      if (!win || !Number.isInteger(win.id)) return { ok: false };
      if (live.length > 1) {
        await chrome.tabs.move(live.slice(1), { windowId: win.id, index: -1 });
      }
      await restoreGroupings(groupings);
      return { ok: true, movedToNewWindow: true, moved: live.length };
    } catch {
      return { ok: false };
    }
  }
  let windows;
  try {
    windows = (await chrome.windows.getAll({ populate: true })) || [];
  } catch {
    return { ok: false };
  }
  const survivors = (windows || []).filter(
    (win) => win && Number.isInteger(win.id) && !emptied.has(win.id),
  );
  const others = survivors.map(summarizeWindow);
  if (others.length === 0) return { ok: true, needWindowChoice: false };
  if (others.length === 1) {
    if (!!survivors[0].incognito !== [...kinds][0]) {
      return { ok: false, reason: "incognito" };
    }
    const groupings = await groupingsForIds(all, live);
    try {
      await moveTabIntoWindowAndFocus(
        asTabIds(live),
        others[0].windowId as number,
        "moveManagerTabsToWindow auto-merge",
      );
      await restoreGroupings(groupings);
    } catch {
      return { ok: false };
    }
    return { ok: true, movedToWindow: true, moved: live.length };
  }
  return { ok: true, needWindowChoice: true, ownIds: live, tabs: others };
}

export async function moveManagerTabsIntoWindow(
  _: Sender,
  { ids, targetWindowId }: MessagePayload<"moveManagerTabsIntoWindow"> = {},
): Promise<MessageResponse<"moveManagerTabsIntoWindow">> {
  const targets = sanitizeIds(ids);
  if (targets.length === 0 || !Number.isInteger(targetWindowId))
    return { ok: false };
  let target;
  try {
    target = await chrome.windows.get(targetWindowId as number);
  } catch {
    target = null;
  }
  if (!target) return { ok: false, reason: "no-target" };
  let all;
  try {
    all = (await chrome.tabs.query({})) || [];
  } catch {
    all = null;
  }
  const byId = all ? new Map(all.map((tab) => [tab.id, tab])) : null;
  const live = byId ? targets.filter((id) => byId.has(id)) : targets;
  if (live.length === 0) return { ok: false };
  if (byId) {
    const kinds = new Set(live.map((id) => !!byId.get(id)!.incognito));
    if (kinds.size > 1 || kinds.has(!target!.incognito)) {
      return { ok: false, reason: "incognito" };
    }
  }
  const groupings = await groupingsForIds(all || [], live);
  try {
    await moveTabIntoWindowAndFocus(
      asTabIds(live),
      targetWindowId as number,
      "moveManagerTabsIntoWindow",
    );
    await restoreGroupings(groupings);
  } catch {
    return { ok: false };
  }
  return { ok: true, moved: live.length };
}

export async function moveTabLeft(sender: Sender): Promise<MessageResponse<"moveTabLeft">> {
  return moveTab(sender, -1);
}

export async function moveTabRight(sender: Sender): Promise<MessageResponse<"moveTabRight">> {
  return moveTab(sender, 1);
}

export async function goToFirstTab(): Promise<MessageResponse<"goToFirstTab">> {
  return activateTabByIndex(0);
}

export async function goToLastTab(): Promise<MessageResponse<"goToLastTab">> {
  return activateTabByIndex(-1);
}

export async function reloadTab(
  sender: Sender,
  { bypassCache = false }: MessagePayload<"reloadTab"> = {},
): Promise<MessageResponse<"reloadTab">> {
  if (sender.tab && sender.tab.id) {
    await chrome.tabs.reload(sender.tab.id, { bypassCache });
    return { ok: true };
  }
  return { ok: false };
}

export async function goBack(sender: Sender): Promise<MessageResponse<"goBack">> {
  return goHistory(sender.tab, -1);
}

export async function goForward(sender: Sender): Promise<MessageResponse<"goForward">> {
  return goHistory(sender.tab, 1);
}

export async function listTabs(): Promise<TabSummary[] | { ok: false }> {
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

function sanitizeIds(ids: unknown, max = 100): number[] {
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

async function liveIds(ids: unknown): Promise<number[]> {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return [];
  let all;
  try {
    all = (await chrome.tabs.query({})) || [];
  } catch {
    return [];
  }
  const alive = new Set(all.map((tab) => tab.id));
  return targets.filter((id) => alive.has(id));
}

function hasApi(path: string[]): boolean {
  try {
    let owner: unknown = chrome;
    for (const name of path) {
      if (
        !owner ||
        typeof (owner as Record<string, unknown>)[name] === "undefined"
      ) {
        return false;
      }
      owner = (owner as Record<string, unknown>)[name];
    }
    return typeof owner === "function";
  } catch {
    return false;
  }
}

function groupsSupported() {
  return hasApi(["tabs", "group"]) && hasApi(["tabs", "ungroup"]);
}

export async function managerList(
  sender: Sender,
): Promise<MessageResponse<"managerList">> {
  let raw;
  try {
    raw = (await chrome.tabs.query({})) || [];
  } catch {
    return { ok: false };
  }
  let bookmarkedUrls = new Set<string>();
  if (chrome.bookmarks && typeof chrome.bookmarks.getTree === "function") {
    bookmarkedUrls = await bookmarkedUrlKeys();
  }
  const tabs: ManagerTab[] = raw.map((tab) => ({
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
  let groups: GroupSummary[] = [];
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

async function currentWindowId(
  sender: Sender,
): Promise<number | null> {
  if (sender && sender.tab && Number.isInteger(sender.tab.windowId)) {
    return sender.tab.windowId as number;
  }
  try {
    if (chrome.windows && typeof chrome.windows.getLastFocused === "function") {
      const win = await chrome.windows.getLastFocused();
      if (win && Number.isInteger(win.id)) return win.id as number;
    }
  } catch {}
  return null;
}

export async function closeManagerTabs(
  _: Sender,
  { ids }: MessagePayload<"closeManagerTabs"> = {},
): Promise<MessageResponse<"closeManagerTabs">> {
  const targets = await liveIds(ids);
  if (targets.length === 0) return { ok: false };
  try {
    await chrome.tabs.remove(targets);
  } catch {
    return { ok: false };
  }
  return { ok: true, closed: targets.length };
}

async function updateTabFlag<K extends "pinned" | "muted">(
  ids: unknown,
  prop: K,
  value: unknown,
): Promise<
  ({ ok: true; updated: number } & { [key in K]: boolean }) | { ok: false }
> {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  const next = !!value;
  const results = await Promise.allSettled(
    targets.map((id) => chrome.tabs.update(id, { [prop]: next })),
  );
  const updated = results.filter((r) => r.status === "fulfilled").length;
  return updated > 0 ? { ok: true, updated, [prop]: next } : { ok: false };
}

export async function setTabsPinned(
  _: Sender,
  { ids, pinned }: MessagePayload<"setTabsPinned"> = {},
): Promise<MessageResponse<"setTabsPinned">> {
  return updateTabFlag(ids, "pinned", pinned);
}

export async function setTabsMuted(
  _: Sender,
  { ids, muted }: MessagePayload<"setTabsMuted"> = {},
): Promise<MessageResponse<"setTabsMuted">> {
  return updateTabFlag(ids, "muted", muted);
}

export async function moveManagerTabs(
  _: Sender,
  { ids, delta = 0 }: MessagePayload<"moveManagerTabs"> = {},
): Promise<MessageResponse<"moveManagerTabs">> {
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
  const perWindow = new Map<
    string,
    { windowId: number | undefined; pinned: boolean; ids: number[] }
  >();
  const regroup = new Map<number, number[]>();
  for (const id of targets) {
    const tab = byId.get(id);
    if (!tab) continue;
    const pinned = !!tab.pinned;
    const key = `${tab.windowId}:${pinned ? "pinned" : "open"}`;
    if (!perWindow.has(key)) {
      perWindow.set(key, { windowId: tab.windowId, pinned, ids: [] });
    }
    perWindow.get(key)!.ids.push(id);
    if (Number.isInteger(tab.groupId) && (tab.groupId as number) >= 0) {
      if (!regroup.has(tab.groupId!)) regroup.set(tab.groupId!, []);
      regroup.get(tab.groupId!)!.push(id);
    }
  }
  if (perWindow.size === 0) return { ok: false };
  const dir = step > 0 ? 1 : -1;
  const pinnedCount = new Map<number | undefined, number>();
  for (const tab of all) {
    if (!tab.pinned) continue;
    pinnedCount.set(tab.windowId, (pinnedCount.get(tab.windowId) || 0) + 1);
  }
  let viable = false;
  let moved = 0;
  for (const { windowId, pinned, ids: group } of perWindow.values()) {
    const order = all
      .filter((tab) => tab.windowId === windowId && !!tab.pinned === pinned)
      .sort((a, b) => a.index - b.index)
      .map((tab) => tab.id);
    if (order.length < 2) continue;
    viable = true;
    const base = pinned ? 0 : pinnedCount.get(windowId) || 0;
    for (let n = 0; n < Math.abs(step); n++) {
      const pos = new Map(order.map((id, i) => [id, i]));
      const sequenced = group
        .filter((id) => pos.has(id))
        .sort((a, b) =>
          dir > 0
            ? pos.get(b)! - pos.get(a)!
            : pos.get(a)! - pos.get(b)!,
        );
      for (const id of sequenced) {
        const from = order.indexOf(id);
        if (from < 0) continue;
        const target = Math.min(order.length - 1, Math.max(0, from + dir));
        order.splice(from, 1);
        order.splice(target, 0, id);
        if (target === from) continue;
        try {
          await chrome.tabs.move(id, { index: base + target });
          moved++;
        } catch {}
      }
    }
  }
  if (moved > 0 && groupsSupported()) {
    for (const [groupId, ids] of regroup) {
      try {
        await chrome.tabs.group({ tabIds: asTabIds(ids), groupId });
      } catch {}
    }
  }
  return viable ? { ok: true, moved } : { ok: false };
}

export async function duplicateManagerTabs(
  _: Sender,
  { ids }: MessagePayload<"duplicateManagerTabs"> = {},
): Promise<MessageResponse<"duplicateManagerTabs">> {
  const targets = sanitizeIds(ids);
  if (targets.length === 0) return { ok: false };
  const activeBefore = new Map<number | undefined, number | undefined>();
  try {
    for (const tab of (await chrome.tabs.query({ active: true })) || []) {
      if (tab && Number.isInteger(tab.windowId)) activeBefore.set(tab.windowId, tab.id);
    }
  } catch {}
  const created: chrome.tabs.Tab[] = [];
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
    ? {
        ok: true,
        duplicated: created.length,
        ids: created.map((tab) => tab.id as number),
      }
    : { ok: false };
}

export async function editManagerTab(
  _: Sender,
  { id, url }: MessagePayload<"editManagerTab"> = {},
): Promise<MessageResponse<"editManagerTab">> {
  if (!Number.isInteger(id)) return { ok: false };
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  try {
    await chrome.tabs.update(id as number, { url: target });
    return { ok: true, url: target };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function groupManagerTabs(
  _: Sender,
  { ids, groupId }: MessagePayload<"groupManagerTabs"> = {},
): Promise<MessageResponse<"groupManagerTabs">> {
  const targets = await liveIds(ids);
  if (targets.length === 0) return { ok: false };
  if (!groupsSupported()) return { ok: false, reason: "unsupported" };
  try {
    const options =
      Number.isInteger(groupId) && (groupId as number) >= 0
        ? { tabIds: asTabIds(targets), groupId: groupId as number }
        : { tabIds: asTabIds(targets) };
    const createdId = (await chrome.tabs.group(options)) as unknown as number;
    return { ok: true, groupId: createdId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function ungroupManagerTabs(
  _: Sender,
  { ids }: MessagePayload<"ungroupManagerTabs"> = {},
): Promise<MessageResponse<"ungroupManagerTabs">> {
  const targets = await liveIds(ids);
  if (targets.length === 0) return { ok: false };
  if (!groupsSupported()) return { ok: false, reason: "unsupported" };
  try {
    await chrome.tabs.ungroup(asTabIds(targets));
    return { ok: true, ungrouped: targets.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function renameGroup(
  _: Sender,
  { groupId, title }: MessagePayload<"renameGroup"> = {},
): Promise<MessageResponse<"renameGroup">> {
  if (!Number.isInteger(groupId)) return { ok: false };
  if (!hasApi(["tabGroups", "update"])) {
    return { ok: false, reason: "unsupported" };
  }
  try {
    await chrome.tabGroups.update(groupId as number, {
      title: String(title ?? "").slice(0, 100),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function goHistory(
  tab: chrome.tabs.Tab | undefined,
  delta: number,
): Promise<{ ok: true } | { ok: false }> {
  if (!tab || !tab.id) return { ok: false };
  const legacy = chrome.tabs as unknown as Record<
    "goBack" | "goForward",
    ((tabId: number) => Promise<void>) | undefined
  >;
  const method = delta < 0 ? "goBack" : "goForward";
  if (typeof legacy[method] === "function") {
    try {
      await legacy[method](tab.id);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true };
}

async function switchTab(
  current: chrome.tabs.Tab | undefined,
  delta: number,
): Promise<{ ok: true } | { ok: false }> {
  if (!current || !current.id) return { ok: false };
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (tabs.length < 2) return { ok: false };
  const index = tabs.findIndex((tab) => tab.id === current.id);
  if (index === -1) return { ok: false };
  const nextIndex =
    (((index + delta) % tabs.length) + tabs.length) % tabs.length;
  await chrome.tabs.update(tabs[nextIndex].id!, { active: true });
  return { ok: true };
}

async function moveTab(
  sender: Sender,
  delta: number,
): Promise<{ ok: true } | { ok: false }> {
  const tab = sender.tab;
  if (tab && tab.id) {
    await chrome.tabs.move(tab.id, { index: Math.max(0, tab.index + delta) });
    return { ok: true };
  }
  return { ok: false };
}

async function activateTabByIndex(
  index: number,
): Promise<{ ok: true } | { ok: false }> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tab = tabs[index < 0 ? tabs.length + index : index];
  if (!tab) return { ok: false };
  await chrome.tabs.update(tab.id!, { active: true });
  return { ok: true };
}

export async function activateTab(
  _: Sender,
  { id }: MessagePayload<"activateTab"> = {},
): Promise<MessageResponse<"activateTab">> {
  if (!id) return { ok: false };
  let windowId: number | null | undefined = null;
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

export async function zoomBy(
  sender: Sender,
  { delta = 0 }: MessagePayload<"zoomBy"> = {},
): Promise<MessageResponse<"zoomBy">> {
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

export async function openTab(
  url: unknown,
  active: boolean,
): Promise<{ ok: true } | { ok: false }> {
  const target = normalizeUrl(url);
  if (!target) return { ok: false };
  await chrome.tabs.create({ url: target, active });
  return { ok: true };
}

export async function openInBackgroundTab(
  _: Sender,
  { url }: MessagePayload<"openInBackgroundTab"> = {},
): Promise<MessageResponse<"openInBackgroundTab">> {
  return openTab(url, false);
}

export async function openInForegroundTab(
  _: Sender,
  { url }: MessagePayload<"openInForegroundTab"> = {},
): Promise<MessageResponse<"openInForegroundTab">> {
  return openTab(url, true);
}

export async function captureScreenshot(
  sender: Sender,
): Promise<MessageResponse<"captureScreenshot">> {
  const windowId = sender && sender.tab && sender.tab.windowId;
  if (!Number.isInteger(windowId)) return { ok: false };
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId as number, {
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

export async function openSettings(): Promise<MessageResponse<"openSettings">> {
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

function extensionsPageUrl(): string | null {
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

export async function openExtensions(): Promise<MessageResponse<"openExtensions">> {
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

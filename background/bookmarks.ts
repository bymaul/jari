import type {
  MessagePayload,
  MessageResponse,
} from "../shared/protocol.ts";

export async function findBookmarkBarId(): Promise<string> {
  let roots;
  try {
    roots = (await chrome.bookmarks.getTree()) || [];
  } catch {
    return "1";
  }
  const folders: chrome.bookmarks.BookmarkTreeNode[] = [];
  for (const root of roots) {
    for (const child of (root && root.children) || []) {
      if (child && child.children && child.id) folders.push(child);
    }
  }
  const byTitle = (re: RegExp) =>
    folders.find((f) => re.test(String(f.title || "")));
  const bar = byTitle(/bookmarks?\s?(bar|toolbar)/i);
  if (bar) return bar.id;
  const other = byTitle(/other/i);
  if (other) return other.id;
  if (folders.length > 0) return folders[0].id;
  return "1";
}

export function bookmarkUrlKey(url: unknown): string {
  return String(url || "")
    .split("#", 1)[0]
    .replace(/\/+$/, "");
}

const BOOKMARKABLE_URL = /^(https?|file):\/\//i;
const MAX_BOOKMARK_TABS = 100;

async function walkBookmarkNodes(
  visit: (node: chrome.bookmarks.BookmarkTreeNode) => void,
): Promise<boolean> {
  let tree;
  try {
    tree = (await chrome.bookmarks.getTree()) || [];
  } catch {
    return false;
  }
  const stack: chrome.bookmarks.BookmarkTreeNode[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    if (node.children) stack.push(...node.children);
  }
  return true;
}

let urlKeysCache: Set<string> | null = null;

export function clearBookmarkedUrlKeysCache(): void {
  urlKeysCache = null;
}

try {
  const bookmarks = chrome.bookmarks;
  if (bookmarks) {
    for (const event of [
      bookmarks.onCreated,
      bookmarks.onRemoved,
      bookmarks.onChanged,
      bookmarks.onMoved,
    ]) {
      if (event && typeof event.addListener === "function") {
        event.addListener(clearBookmarkedUrlKeysCache);
      }
    }
  }
} catch {}

export async function bookmarkedUrlKeys(): Promise<Set<string>> {
  if (urlKeysCache) return urlKeysCache;
  const keys = new Set<string>();
  await walkBookmarkNodes((node) => {
    if (node.url) keys.add(bookmarkUrlKey(node.url));
  });
  urlKeysCache = keys;
  return keys;
}

type ManagerTabPayload = MessagePayload<"bookmarkManagerTabs">;

export async function bookmarkManagerTabs(
  _: unknown,
  { tabs = [] }: { tabs?: ManagerTabPayload["tabs"] } = {},
): Promise<MessageResponse<"bookmarkManagerTabs">> {
  if (!Array.isArray(tabs) || tabs.length === 0) return { ok: false };
  const selected = tabs.slice(0, MAX_BOOKMARK_TABS);
  const already = await bookmarkedUrlKeys();
  const parentId = await findBookmarkBarId();
  const seen = new Set<string>();
  let saved = 0;
  let skipped = 0;
  for (const tab of selected) {
    const url = String((tab && tab.url) || "");
    const key = bookmarkUrlKey(url);
    if (!BOOKMARKABLE_URL.test(url) || seen.has(key) || already.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    try {
      await chrome.bookmarks.create({
        parentId,
        title: String((tab && tab.title) || url).slice(0, 500),
        url,
      });
      saved++;
    } catch {
      skipped++;
    }
  }
  return saved > 0
    ? { ok: true, saved, skipped }
    : { ok: false, saved, skipped };
}

type UnbookmarkTabPayload = MessagePayload<"unbookmarkManagerTabs">;

export async function unbookmarkManagerTabs(
  _: unknown,
  { tabs = [] }: { tabs?: UnbookmarkTabPayload["tabs"] } = {},
): Promise<MessageResponse<"unbookmarkManagerTabs">> {
  if (!Array.isArray(tabs) || tabs.length === 0) return { ok: false };
  const selected = tabs.slice(0, MAX_BOOKMARK_TABS);
  const wanted = new Set<string>();
  for (const tab of selected) {
    const url = String((tab && tab.url) || "");
    if (BOOKMARKABLE_URL.test(url)) wanted.add(bookmarkUrlKey(url));
  }
  if (wanted.size === 0) {
    return { ok: false, removed: 0, skipped: tabs.length };
  }
  const ids: string[] = [];
  const matched = new Set<string>();
  const ok = await walkBookmarkNodes((node) => {
    if (!node.url || !node.id) return;
    const key = bookmarkUrlKey(node.url);
    if (!wanted.has(key)) return;
    matched.add(key);
    ids.push(node.id);
  });
  if (!ok) return { ok: false };
  let removed = 0;
  for (const id of ids) {
    try {
      await chrome.bookmarks.remove(id);
      removed++;
    } catch {}
  }
  let skipped = 0;
  for (const tab of selected) {
    if (!matched.has(bookmarkUrlKey(String((tab && tab.url) || "")))) skipped++;
  }
  return removed > 0
    ? { ok: true, removed, skipped }
    : { ok: false, removed, skipped };
}

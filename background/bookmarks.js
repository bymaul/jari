export async function findBookmarkBarId() {
  let roots;
  try {
    roots = (await chrome.bookmarks.getTree()) || [];
  } catch {
    return "1";
  }
  const folders = [];
  for (const root of roots) {
    for (const child of (root && root.children) || []) {
      if (child && child.children && child.id) folders.push(child);
    }
  }
  const byTitle = (re) => folders.find((f) => re.test(String(f.title || "")));
  const bar = byTitle(/bookmarks?\s?(bar|toolbar)/i);
  if (bar) return bar.id;
  const other = byTitle(/other/i);
  if (other) return other.id;
  if (folders.length > 0) return folders[0].id;
  return "1";
}

export async function toggleBookmark(_, { url = "", title = "" } = {}) {
  const target = String(url || "");
  if (!/^(https?|file):\/\//i.test(target)) return { ok: false };
  let found;
  try {
    found = await chrome.bookmarks.search(target);
  } catch {
    return { ok: false };
  }
  const existing = (found || []).filter(
    (node) => node && node.url === target,
  );
  if (existing.length > 0) {
    try {
      await Promise.all(
        existing.map((node) => chrome.bookmarks.remove(node.id)),
      );
    } catch {
      return { ok: false };
    }
    return { ok: true, bookmarked: false };
  }
  const parentId = await findBookmarkBarId();
  try {
    await chrome.bookmarks.create({
      parentId,
      title: String(title || target),
      url: target,
    });
  } catch {
    return { ok: false };
  }
  return { ok: true, bookmarked: true };
}

export function bookmarkUrlKey(url) {
  return String(url || "")
    .split("#", 1)[0]
    .replace(/\/+$/, "");
}

const BOOKMARKABLE_URL = /^(https?|file):\/\//i;
const MAX_BOOKMARK_TABS = 100;

async function walkBookmarkNodes(visit) {
  let tree;
  try {
    tree = (await chrome.bookmarks.getTree()) || [];
  } catch {
    return false;
  }
  const stack = [...tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    if (node.children) stack.push(...node.children);
  }
  return true;
}

export async function bookmarkedUrlKeys() {
  const keys = new Set();
  await walkBookmarkNodes((node) => {
    if (node.url) keys.add(bookmarkUrlKey(node.url));
  });
  return keys;
}

export async function bookmarkManagerTabs(_, { tabs = [] } = {}) {
  if (!Array.isArray(tabs) || tabs.length === 0) return { ok: false };
  const selected = tabs.slice(0, MAX_BOOKMARK_TABS);
  const already = await bookmarkedUrlKeys();
  const parentId = await findBookmarkBarId();
  const seen = new Set();
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
  return saved > 0 ? { ok: true, saved, skipped } : { ok: false, saved, skipped };
}

export async function unbookmarkManagerTabs(_, { tabs = [] } = {}) {
  if (!Array.isArray(tabs) || tabs.length === 0) return { ok: false };
  const selected = tabs.slice(0, MAX_BOOKMARK_TABS);
  const wanted = new Set();
  for (const tab of selected) {
    const url = String((tab && tab.url) || "");
    if (BOOKMARKABLE_URL.test(url)) wanted.add(bookmarkUrlKey(url));
  }
  if (wanted.size === 0) {
    return { ok: false, removed: 0, skipped: tabs.length };
  }
  const ids = [];
  const matched = new Set();
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

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

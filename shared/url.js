export const urlSchemes = new Set(["http", "https", "file", "about", "chrome"]);

export const blockedUrlSchemes = new Set([
  "javascript",
  "data",
  "vbscript",
  "chrome-extension",
  "edge",
  "moz-extension",
  "view-source",
]);

export function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(url) || /^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(url))
    return "http://" + url;
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

export const Url = {
  parentUrlOf(href) {
    try {
      const url = new URL(href);
      let path = url.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      const idx = path.lastIndexOf("/");
      path = idx > 0 ? path.slice(0, idx) : "/";
      url.pathname = path;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  },

  rootUrlOf(href) {
    try {
      const url = new URL(href);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  },

  isSamePath(a, b) {
    try {
      return new URL(a).pathname === new URL(b).pathname;
    } catch {
      return a === b;
    }
  },

  looksLikeUrl(text) {
    const s = text.trim();
    if (!s || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("//")) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#].*)?$/i.test(s);
  },

  suggestionTerm(query) {
    const idx = query.search(/\s/);
    if (idx === -1) return query;
    return Url.looksLikeUrl(query.slice(0, idx))
      ? query.slice(idx).trim()
      : query;
  },
};

export function normalizeHost(raw) {
  let host = raw.trim().toLowerCase();
  if (!host) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }
  host = host.split(/[/?#:]/)[0].replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(
    host,
  )
    ? host
    : "";
}
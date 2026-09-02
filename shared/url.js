export const urlSchemes = new Set([
  "http",
  "https",
  "file",
  "about",
  "chrome",
  "helium",
]);

export const blockedUrlSchemes = new Set([
  "javascript",
  "data",
  "vbscript",
  "chrome-extension",
  "edge",
  "moz-extension",
  "view-source",
]);

const fileExtensionDenylist = new Set([
  "js","ts","jsx","tsx","mjs","cjs","json","css","scss","less","html","htm","md","markdown","txt","csv","xml","yaml","yml","toml","ini","conf","config","sh","bash","zsh","fish","py","rb","php","java","c","cpp","h","hpp","cs","go","rs","swift","kt","kts","dart","vue","svelte","astro","lua","pl","pm","r","sql","db","sqlite","log","lock","env","gitignore","dockerignore","gradle","makefile","cmake",
]);

function isValidHostname(host) {
  if (!host) return false;
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    return lower.split(".").every(o => {
      const n = parseInt(o, 10);
      return n >= 0 && n <= 255 && String(n) === o;
    });
  }
  const labels = lower.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[a-z]{2,63}$/.test(tld)) return false;
  if (/^\d+$/.test(tld)) return false;
  return true;
}

export function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (
    /^localhost(:\d+)?(\/.*)?$/i.test(url) ||
    /^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(url) ||
    /^0\.0\.0\.0(:\d+)?(\/.*)?$/i.test(url)
  )
    return "http://" + url;
  if (url.startsWith("//")) {
    try {
      const u = new URL("https:" + url);
      if (!isValidHostname(u.hostname)) return null;
      return "https:" + url;
    } catch { return null; }
  }
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) {
    const hostPart = url.split(/[:/?#]/)[0];
    if (!isValidHostname(hostPart)) return null;
    try {
      const u = new URL("https://" + url);
      if (!isValidHostname(u.hostname)) return null;
    } catch { return null; }
    return "https://" + url;
  }
  const scheme = m[1].toLowerCase();
  if (urlSchemes.has(scheme)) {
    if (scheme === "http" || scheme === "https") {
      try {
        const u = new URL(url);
        if (u.hostname && !isValidHostname(u.hostname)) return null;
      } catch { return null; }
    }
    return url;
  }
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
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        const scheme = u.protocol.slice(0, -1).toLowerCase();
        if (blockedUrlSchemes.has(scheme)) return false;
        if (urlSchemes.has(scheme)) return true;
        const host = u.hostname;
        if (!host) return false;
        if (host === "localhost" || /^127\.0\.0\.1$/.test(host) || /^0\.0\.0\.0$/.test(host)) return true;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isValidHostname(host);
        return isValidHostname(host);
      } catch { return false; }
    }
    if (s.startsWith("//")) {
      try {
        const u = new URL("https:" + s);
        return isValidHostname(u.hostname);
      } catch { return false; }
    }
    if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
    if (/^127\.0\.0\.1(:\d+)?(\/.*)?$/i.test(s)) return true;
    const hostPart = s.split(/[:/?#]/)[0];
    if (!isValidHostname(hostPart)) return false;
    const tld = hostPart.toLowerCase().split(".").pop();
    if (!s.includes("/") && !s.includes(":") && !s.includes("?") && !s.includes("#") && fileExtensionDenylist.has(tld)) return false;
    try {
      const u = new URL("https://" + s);
      return isValidHostname(u.hostname);
    } catch { return false; }
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

import {
  matchesSitePattern,
  pageSiteKey,
} from "../shared/url.js";

export const SHOW_HELP_ACTION = "jari-show-help";

export function parseTabSite(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) {
    return { toggleable: false, host: "", protocol: "", label: "", key: "" };
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { toggleable: false, host: "", protocol: "", label: "", key: "" };
  }
  const protocol = parsed.protocol || "";
  if (protocol === "file:") {
    return {
      toggleable: true,
      host: "",
      protocol,
      label: "file://",
      key: "file://",
    };
  }
  if (protocol !== "http:" && protocol !== "https:") {
    return { toggleable: false, host: "", protocol, label: "", key: "" };
  }
  const host = parsed.hostname || "";
  if (!host) {
    return { toggleable: false, host: "", protocol, label: "", key: "" };
  }
  return {
    toggleable: true,
    host,
    protocol,
    label: host,
    key: pageSiteKey(host, protocol),
  };
}

export function isSiteDisabled(disabledSites, host, protocol) {
  const list = Array.isArray(disabledSites) ? disabledSites : [];
  return list.some((pattern) =>
    matchesSitePattern(host, pattern, protocol),
  );
}

export function toggleSiteInList(disabledSites, key) {
  const list = Array.isArray(disabledSites) ? disabledSites.slice() : [];
  const idx = list.indexOf(key);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(key);
  return list;
}

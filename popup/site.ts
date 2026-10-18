import {
  matchesSitePattern,
  pageSiteKey,
} from "../shared/url.ts";

export const SHOW_HELP_ACTION = "jari-show-help";

interface TabSite {
  toggleable: boolean;
  host: string;
  protocol: string;
  label: string;
  key: string;
}

function notToggleable(protocol: string): TabSite {
  return { toggleable: false, host: "", protocol, label: "", key: "" };
}

export function parseTabSite(rawUrl: unknown): TabSite {
  if (typeof rawUrl !== "string" || !rawUrl) {
    return notToggleable("");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return notToggleable("");
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
    return notToggleable(protocol);
  }
  const host = parsed.hostname || "";
  if (!host) {
    return notToggleable(protocol);
  }
  return {
    toggleable: true,
    host,
    protocol,
    label: host,
    key: pageSiteKey(host, protocol),
  };
}

export function isSiteDisabled(
  disabledSites: unknown,
  host: unknown,
  protocol: unknown,
): boolean {
  const list: unknown[] = Array.isArray(disabledSites) ? disabledSites : [];
  return list.some((pattern) => matchesSitePattern(host, pattern, protocol));
}

export function toggleSiteInList(disabledSites: unknown, key: string): string[] {
  const list: string[] = Array.isArray(disabledSites) ? disabledSites.slice() : [];
  const idx = list.indexOf(key);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(key);
  return list;
}

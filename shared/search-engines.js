export const SEARCH_ENGINE_DEFAULTS = [
  { keyword: "g", url: "https://www.google.com/search?q=%s" },
  { keyword: "yt", url: "https://www.youtube.com/results?search_query=%s" },
  { keyword: "gh", url: "https://github.com/search?q=%s" },
  {
    keyword: "wiki",
    url: "https://en.wikipedia.org/wiki/Special:Search?search=%s",
  },
  { keyword: "r", url: "https://www.reddit.com/search/?q=%s" },
];

export const DEFAULT_SEARCH_ENGINE = "g";

export const MAX_SEARCH_ENGINES = 20;
export const SEARCH_KEYWORD_RE = /^[a-z0-9_]{1,16}$/;
export const SEARCH_ENGINE_URL_MAX = 500;
export const RESERVED_ENGINE_KEYWORDS = ["t"];

export function searchEngineDefaults() {
  return SEARCH_ENGINE_DEFAULTS.map((e) => ({ ...e }));
}

export function validateSearchEngine(entry) {
  if (!entry || typeof entry !== "object")
    return "Engine must have a keyword and URL.";
  const keyword = String(entry.keyword || "").toLowerCase();
  if (!SEARCH_KEYWORD_RE.test(keyword)) {
    return "Keyword must be 1-16 letters, digits, or underscores.";
  }
  if (RESERVED_ENGINE_KEYWORDS.includes(keyword)) {
    return `Keyword "${keyword}" is reserved for tab search.`;
  }
  const url = String(entry.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return "URL must start with http:// or https://.";
  }
  if (url.length > SEARCH_ENGINE_URL_MAX) {
    return `URL must be ${SEARCH_ENGINE_URL_MAX} characters or fewer.`;
  }
  if (!url.includes("%s")) {
    return "URL must contain %s where the query goes.";
  }
  return null;
}

export function normalizeSearchEngines(raw) {
  if (!Array.isArray(raw)) return searchEngineDefaults();
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (out.length >= MAX_SEARCH_ENGINES) break;
    if (validateSearchEngine(entry)) continue;
    const keyword = String(entry.keyword).toLowerCase();
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push({ keyword, url: String(entry.url).trim() });
  }
  return out.length > 0 ? out : searchEngineDefaults();
}

export function normalizeDefaultEngine(raw, engines) {
  const list =
    Array.isArray(engines) && engines.length > 0
      ? engines
      : searchEngineDefaults();
  const keyword = String(raw || "").toLowerCase();
  if (list.some((e) => e && e.keyword === keyword)) return keyword;
  return list[0].keyword;
}

export function parseEngineKeyword(query, engines) {
  const m = String(query || "")
    .trim()
    .match(/^(\w+)\s+(.*\S)/);
  if (!m) return null;
  const url = buildEngineUrl(engines, m[1], m[2]);
  if (!url) return null;
  return { keyword: m[1].toLowerCase(), rest: m[2], url };
}

export function buildEngineUrl(engines, keyword, query) {
  const kw = String(keyword || "").toLowerCase();
  const engine = (engines || []).find((e) => e && e.keyword === kw);
  if (!engine) return null;
  return String(engine.url).replaceAll("%s", encodeURIComponent(query));
}

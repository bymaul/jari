export interface PageNavTexts {
  next: string[];
  prev: string[];
}

export const PAGE_NAV_TEXT_DEFAULTS: PageNavTexts = {
  next: ["Next", "Next page", "More results", "›", "»"],
  prev: ["Previous", "Prev", "Previous page", "‹", "«"],
};

export const MAX_PAGE_NAV_TEXTS = 20;
export const PAGE_NAV_TEXT_MAX = 100;

export function pageNavTextDefaults(): PageNavTexts {
  return {
    next: PAGE_NAV_TEXT_DEFAULTS.next.slice(),
    prev: PAGE_NAV_TEXT_DEFAULTS.prev.slice(),
  };
}

export function normalizePageNavTextList(
  raw: unknown,
  fallback: string[],
): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (out.length >= MAX_PAGE_NAV_TEXTS) break;
    const text = String(entry || "").trim();
    if (!text || text.length > PAGE_NAV_TEXT_MAX) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.length > 0 ? out : fallback.slice();
}

export function normalizePageNavTexts(raw: unknown): PageNavTexts {
  const defaults = pageNavTextDefaults();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const doc = raw as { next?: unknown; prev?: unknown };
  return {
    next: normalizePageNavTextList(doc.next, defaults.next),
    prev: normalizePageNavTextList(doc.prev, defaults.prev),
  };
}

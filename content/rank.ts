const SCORE_BASE = 2;
const SCORE_RUN = 12;
const SCORE_BOUNDARY = 8;
const SCORE_CAMEL = 14;
const SCORE_GAP = -3;
const SCORE_LEADING = -1;

export interface RankItem {
  title?: string;
  url?: string;
  source?: string;
  lastVisit?: number;
  lastAccessed?: number;
  lastVisitTime?: number;
  dateAdded?: number;
  visitCount?: number;
  typedCount?: number;
  typedVisits?: number;
  folderPath?: string;
}

export interface RankMatch {
  item: RankItem;
  match: { score: number; indices: number[]; baseScore: number };
  span: number;
  hayLength: number;
  totalScore: number;
  tier: number;
  matchScore: number;
  boostScore: number;
}

function normalizeWithMap(s: unknown): { norm: string; map: number[] } {
  const src = String(s).toLowerCase();
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < src.length; i++) {
    let chunk = src[i];
    try {
      chunk = chunk.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    } catch {
      chunk = src[i];
    }
    for (let k = 0; k < chunk.length; k++) {
      norm += chunk[k];
      map.push(i);
    }
  }
  return { norm, map };
}

function normalizeForMatch(s: unknown): string {
  try {
    return normalizeWithMap(s).norm;
  } catch {
    return String(s).toLowerCase();
  }
}
export function parseQuery(query: unknown) {
  const normalized = normalizeForMatch(query);
  const phrases: string[] = [];
  const exclude: string[] = [];
  const withoutExcludedPhrases = normalized.replace(/-"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) exclude.push(t);
    return " ";
  });
  const withoutPhrases = withoutExcludedPhrases.replace(
    /"([^"]+)"/g,
    (_, p) => {
      const t = p.trim();
      if (t) phrases.push(t);
      return " ";
    },
  );
  const rawTerms = withoutPhrases
    .replace(/"/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const include: string[] = [];
  for (const t of rawTerms) {
    if (t.startsWith("-") && t.length > 1) exclude.push(t.slice(1));
    else include.push(t);
  }
  return { include, exclude, phrases };
}

function isBoundaryAt(t: string, i: number): boolean {
  if (i === 0) return true;
  const prev = t[i - 1];
  try {
    if (/[\p{L}\p{N}_]/u.test(prev)) return false;
    return true;
  } catch {
    return !/[\w]/.test(prev);
  }
}
function extractHost(url: unknown): string {
  if (!url) return "";
  try {
    const u = new URL(url as string);
    return u.hostname || "";
  } catch {
    const m = String(url).match(/^(?:https?:\/\/)?([^/]+)/i);
    if (!m) return "";
    return m[1].split("@").pop()!.split(":")[0];
  }
}

function charBonus(t: string, text: string, map: number[], i: number): number {
  let s = SCORE_BASE;
  if (isBoundaryAt(t, i)) s += SCORE_BOUNDARY;
  else {
    const ch = text[map[i]];
    if (ch && ch !== ch.toLowerCase()) s += SCORE_CAMEL;
  }
  return s;
}

function bestAlignment(
  term: string,
  t: string,
  text: string,
  map: number[],
): { score: number; indices: number[]; start: number } | null {
  const n = t.length;
  const q = term.length;
  if (q === 0 || q > n) return null;
  const toOriginal = (indices: number[]) => indices.map((i) => map[i]);
  const bonus: number[] = new Array(n);
  for (let i = 0; i < n; i++) bonus[i] = charBonus(t, text, map, i);
  let dpPrev: number[] = new Array(n).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < n; i++) {
    if (t[i] === term[0]) dpPrev[i] = bonus[i] + SCORE_LEADING * i;
  }
  if (q === 1) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (t[i] !== term[0]) continue;
      if (best === -1 || dpPrev[i] > dpPrev[best]) best = i;
    }
    if (best === -1) return null;
    return { score: dpPrev[best], indices: toOriginal([best]), start: best };
  }
  const backs: number[][] = new Array(q).fill(null);
  for (let j = 1; j < q; j++) {
    const dpCurr: number[] = new Array(n).fill(Number.NEGATIVE_INFINITY);
    const bp: number[] = new Array(n).fill(-1);
    let bestVal = Number.NEGATIVE_INFINITY;
    let bestIdx = -1;
    for (let i = 0; i < n; i++) {
      const pAdd = i - 2;
      if (pAdd >= 0 && dpPrev[pAdd] !== Number.NEGATIVE_INFINITY) {
        const val = dpPrev[pAdd] - SCORE_GAP * pAdd;
        if (val > bestVal) {
          bestVal = val;
          bestIdx = pAdd;
        }
      }
      if (t[i] !== term[j]) continue;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestP = -1;
      if (i > 0 && dpPrev[i - 1] !== Number.NEGATIVE_INFINITY) {
        bestScore = dpPrev[i - 1] + SCORE_RUN + bonus[i];
        bestP = i - 1;
      }
      if (bestIdx !== -1) {
        const cand = bonus[i] + SCORE_GAP * i - SCORE_GAP + bestVal;
        if (cand > bestScore) {
          bestScore = cand;
          bestP = bestIdx;
        }
      }
      dpCurr[i] = bestScore;
      bp[i] = bestP;
    }
    backs[j] = bp;
    dpPrev = dpCurr;
  }
  let end = -1;
  for (let i = 0; i < n; i++) {
    if (t[i] !== term[q - 1]) continue;
    if (end === -1 || dpPrev[i] > dpPrev[end]) end = i;
  }
  if (end === -1 || dpPrev[end] === Number.NEGATIVE_INFINITY) return null;
  const indices: number[] = new Array(q);
  let cur = end;
  for (let j = q - 1; j >= 1; j--) {
    indices[j] = cur;
    cur = backs[j][cur];
  }
  indices[0] = cur;
  return {
    score: dpPrev[end],
    indices: toOriginal(indices),
    start: indices[0],
  };
}

interface ParsedQuery {
  include: string[];
  exclude: string[];
  phrases: string[];
}

function preamble(parsed: ParsedQuery, text: string) {
  const { norm: t, map } = normalizeWithMap(text);
  if (parsed.exclude.some((ex) => t.includes(ex))) return null;
  return { t, map };
}

function termImpossible(term: string, tChars: Set<string>): boolean {
  for (let i = 0; i < term.length; i++) {
    if (!tChars.has(term[i])) return true;
  }
  return false;
}

function alignTerms(
  include: string[],
  t: string,
  text: string,
  map: number[],
): ({ score: number; indices: number[]; start: number } | null)[] {
  const multi = include.some((term) => term.length > 1);
  const tChars = multi ? new Set(t) : null;
  return include.map((term) =>
    tChars && term.length > 1 && termImpossible(term, tChars)
      ? null
      : bestAlignment(term, t, text, map),
  );
}

function collectPhraseIndices(
  phrases: string[],
  t: string,
  indices: number[],
  map: number[],
): boolean {
  for (const ph of phrases) {
    if (!t.includes(ph)) return false;
    let idx = t.indexOf(ph);
    while (idx !== -1) {
      for (let i = idx; i < idx + ph.length; i++) indices.push(map[i]);
      idx = t.indexOf(ph, idx + 1);
    }
  }
  return true;
}

function matchNormalized(
  parsed: ParsedQuery,
  t: string,
  map: number[],
  text: string,
): { score: number; indices: number[]; leading: number } | null {
  const { include, phrases } = parsed;
  if (include.length === 0 && phrases.length === 0) return null;
  for (const ph of phrases) if (!t.includes(ph)) return null;
  const results = alignTerms(include, t, text, map);
  if (results.some((r) => !r)) return null;
  let total = 0;
  let leading = 0;
  for (const ph of phrases) total += 10 + ph.length * 2;
  const indices: number[] = [];
  collectPhraseIndices(phrases, t, indices, map);
  results.forEach((r) => {
    total += r!.score;
    leading += r!.start;
    indices.push(...r!.indices);
  });
  indices.sort((a, b) => a - b);
  return { score: total, indices, leading };
}

export function fuzzyMatch(query: unknown, text: string) {
  const parsed = parseQuery(query);
  const pre = preamble(parsed, text);
  if (!pre) return null;
  if (parsed.include.length === 0 && parsed.phrases.length === 0) {
    return parsed.exclude.length > 0 ? { score: 0, indices: [] } : null;
  }
  return matchNormalized(parsed, pre.t, pre.map, text);
}

export function fuzzyIndices(query: unknown, text: string): number[] {
  const parsed = parseQuery(query);
  const pre = preamble(parsed, text);
  if (!pre) return [];
  const { t, map } = pre;
  const indices: number[] = [];
  if (!collectPhraseIndices(parsed.phrases, t, indices, map)) return [];
  const results = alignTerms(parsed.include, t, text, map);
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

export function substringMatch(query: unknown, text: string): boolean {
  const parsed = parseQuery(query);
  const pre = preamble(parsed, text);
  if (!pre) return false;
  return substringMatchNormalized(parsed, pre.t);
}

function substringMatchNormalized(parsed: ParsedQuery, t: string): boolean {
  const { include, exclude, phrases } = parsed;
  if (include.length === 0 && phrases.length === 0) return exclude.length > 0;
  if (phrases.some((ph) => !t.includes(ph))) return false;
  return include.every((term) => t.includes(term));
}

export function substringIndices(query: unknown, text: string): number[] {
  const parsed = parseQuery(query);
  const pre = preamble(parsed, text);
  if (!pre) return [];
  const { t, map } = pre;
  if (parsed.include.length === 0 && parsed.phrases.length === 0) return [];
  if (parsed.phrases.some((ph) => !t.includes(ph))) return [];
  const indices: number[] = [];
  collectPhraseIndices(parsed.phrases, t, indices, map);
  for (const term of parsed.include) {
    let idx = t.indexOf(term);
    while (idx !== -1) {
      for (let i = idx; i < idx + term.length; i++) indices.push(map[i]);
      idx = t.indexOf(term, idx + 1);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}
function recencyScore(item: RankItem): number {
  const ts =
    item.lastVisit ||
    item.lastAccessed ||
    item.lastVisitTime ||
    item.dateAdded ||
    0;
  if (!ts) return 0;
  const days = (Date.now() - ts) / 86400000;
  if (days < 0 || !Number.isFinite(days)) return 0;
  const base = Math.max(0, 7 * Math.exp(-days / 14));
  const typedBonus = item.typedVisits ? 2 : item.typedCount ? 1 : 0;
  return base + typedBonus;
}

function frequencyScore(item: RankItem): number {
  const visit = item.visitCount || 0;
  const typed = item.typedCount || item.typedVisits || 0;
  const c = visit + typed * 1.5;
  if (!c) return 0;
  return Math.log2(1 + c) * 1.2 + (typed ? 1 : 0);
}

const SOURCE_RANK = {
  tab: 0,
  history: 1,
  bookmark: 2,
} as Record<string, number>;

const QUERY_FIELD_SCORE = 12;

function urlParts(url: string): {
  host: string;
  path: string;
  query: string;
} {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      path: parsed.pathname,
      query: parsed.search.replace(/^\?/, ""),
    };
  } catch {
    const qMark = url.indexOf("?");
    const head = qMark === -1 ? url : url.slice(0, qMark);
    return {
      host: extractHost(head),
      path: head,
      query: qMark === -1 ? "" : url.slice(qMark + 1),
    };
  }
}

export function rankMatches(
  query: unknown,
  list: RankItem[],
  fuzzy: false,
): RankItem[];
export function rankMatches(
  query: unknown,
  list: RankItem[],
  fuzzy?: boolean,
): RankMatch[];
export function rankMatches(
  query: unknown,
  list: RankItem[],
  fuzzy = true,
): RankMatch[] | RankItem[] {
  const q = String(query).trim();
  if (!q) return [...list];
  if (!fuzzy) {
    return list.filter((item) =>
      substringMatch(q, (item.title || "") + " " + (item.url || "")),
    );
  }
  const parsed = parseQuery(q);
  const multiTerm = parsed.include.length > 1 || parsed.phrases.length > 0;
  const ranked = list
    .map((item) => {
      const title = item.title || "";
      const url = item.url || "";
      const { host, path, query: queryString } = urlParts(url);
      const urlFieldText = host + path;
      const hay =
        title && urlFieldText
          ? title + " " + urlFieldText
          : title || urlFieldText;
      const titleNorm = normalizeWithMap(title);
      const hostNorm = normalizeWithMap(host);
      const urlNorm = normalizeWithMap(urlFieldText);
      const queryNorm = normalizeWithMap(queryString);
      if (
        parsed.exclude.some(
          (ex) =>
            titleNorm.norm.includes(ex) ||
            hostNorm.norm.includes(ex) ||
            urlNorm.norm.includes(ex) ||
            queryNorm.norm.includes(ex),
        )
      ) {
        return null;
      }
      const titleSub = substringMatchNormalized(parsed, titleNorm.norm);
      const hostSub = substringMatchNormalized(parsed, hostNorm.norm);
      const urlSub = substringMatchNormalized(parsed, urlNorm.norm);
      const urlFieldSub = hostSub || urlSub;
      const querySub = substringMatchNormalized(parsed, queryNorm.norm);
      let match: { score: number; indices: number[]; leading: number } | null;
      let tier = 0;
      if (parsed.include.length === 0 && parsed.phrases.length === 0) {
        match = { score: 0, indices: [], leading: 0 };
      } else if (titleSub) {
        match = matchNormalized(parsed, titleNorm.norm, titleNorm.map, title);
        tier = 3;
      } else if (urlFieldSub) {
        match = matchNormalized(
          parsed,
          hostSub ? hostNorm.norm : urlNorm.norm,
          hostSub ? hostNorm.map : urlNorm.map,
          hostSub ? host : urlFieldText,
        );
        tier = 2;
      } else if (multiTerm) {
        const hayNorm = normalizeWithMap(hay);
        match = matchNormalized(parsed, hayNorm.norm, hayNorm.map, hay);
        tier = match ? 1 : 0;
        if (!match && querySub) {
          match = { score: QUERY_FIELD_SCORE, indices: [], leading: 0 };
        }
      } else {
        match =
          matchNormalized(parsed, titleNorm.norm, titleNorm.map, title) ??
          matchNormalized(parsed, hostNorm.norm, hostNorm.map, host) ??
          matchNormalized(parsed, urlNorm.norm, urlNorm.map, urlFieldText);
        tier = match ? 1 : 0;
        if (!match && querySub) {
          match = { score: QUERY_FIELD_SCORE, indices: [], leading: 0 };
        }
      }
      if (!match) return null;
      const first = match.indices.length > 0 ? match.indices[0] : 0;
      const last =
        match.indices.length > 0 ? match.indices[match.indices.length - 1] : 0;
      const baseScore = match.score + match.leading;
      if (baseScore < 0 && tier !== 3) return null;
      const tBoost = titleSub ? 8 : 0;
      const hBoost = hostSub ? 6 : 0;
      const matchScore = baseScore + tBoost + hBoost;
      const boostScore = recencyScore(item) + frequencyScore(item);
      const totalScore = matchScore + boostScore;
      return {
        item,
        match: { score: totalScore, indices: match.indices, baseScore },
        span: match.indices.length > 0 ? last - first + 1 : 0,
        hayLength: hay.length,
        totalScore,
        tier,
        matchScore,
        boostScore,
      };
    })
    .filter((r: RankMatch | null): r is RankMatch => r !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return b.tier - a.tier;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.boostScore !== a.boostScore) return b.boostScore - a.boostScore;
      if (a.span !== b.span) return a.span - b.span;
      if (a.hayLength !== b.hayLength) return a.hayLength - b.hayLength;
      return (
        (SOURCE_RANK[a.item.source as string] ?? 3) -
        (SOURCE_RANK[b.item.source as string] ?? 3)
      );
    });
  return ranked;
}

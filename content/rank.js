const SCORE_BASE = 2;
const SCORE_RUN = 12;
const SCORE_BOUNDARY = 8;
const SCORE_CAMEL = 14;
const SCORE_GAP = -3;
const SCORE_LEADING = -1;

function normalizeWithMap(s) {
  const src = String(s).toLowerCase();
  let norm = "";
  const map = [];
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

function normalizeForMatch(s) {
  try {
    return normalizeWithMap(s).norm;
  } catch {
    return String(s).toLowerCase();
  }
}
export function parseQuery(query) {
  const normalized = normalizeForMatch(query);
  const phrases = [];
  const exclude = [];
  const withoutExcludedPhrases = normalized.replace(/-"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) exclude.push(t);
    return " ";
  });
  const withoutPhrases = withoutExcludedPhrases.replace(/"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) phrases.push(t);
    return " ";
  });
  const rawTerms = withoutPhrases.replace(/"/g, " ").trim().split(/\s+/).filter(Boolean);
  const include = [];
  for (const t of rawTerms) {
    if (t.startsWith("-") && t.length > 1) exclude.push(t.slice(1));
    else include.push(t);
  }
  return { include, exclude, phrases };
}

function isBoundaryAt(t, i) {
  if (i === 0) return true;
  const prev = t[i - 1];
  try {
    if (/[\p{L}\p{N}_]/u.test(prev)) return false;
    return true;
  } catch {
    return !/[\w]/.test(prev);
  }
}
function extractHost(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.hostname || "";
  } catch {
    const m = String(url).match(/^(?:https?:\/\/)?([^/]+)/i);
    if (!m) return "";
    return m[1].split("@").pop().split(":")[0];
  }
}

function charBonus(t, text, map, i) {
  let s = SCORE_BASE;
  if (isBoundaryAt(t, i)) s += SCORE_BOUNDARY;
  else {
    const ch = text[map[i]];
    if (ch && ch !== ch.toLowerCase()) s += SCORE_CAMEL;
  }
  return s;
}

function bestAlignment(term, t, text, map) {
  const n = t.length;
  const q = term.length;
  if (q === 0 || q > n) return null;
  const toOriginal = (indices) => indices.map((i) => map[i]);
  const bonus = new Array(n);
  for (let i = 0; i < n; i++) bonus[i] = charBonus(t, text, map, i);
  let dpPrev = new Array(n).fill(Number.NEGATIVE_INFINITY);
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
    return { score: dpPrev[best], indices: toOriginal([best]) };
  }
  const backs = new Array(q).fill(null);
  for (let j = 1; j < q; j++) {
    const dpCurr = new Array(n).fill(Number.NEGATIVE_INFINITY);
    const bp = new Array(n).fill(-1);
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
  const indices = new Array(q);
  let cur = end;
  for (let j = q - 1; j >= 1; j--) {
    indices[j] = cur;
    cur = backs[j][cur];
  }
  indices[0] = cur;
  return { score: dpPrev[end], indices: toOriginal(indices) };
}

function matchPreamble(query, text) {
  const { include, exclude, phrases } = parseQuery(query);
  const { norm: t, map } = normalizeWithMap(text);
  if (exclude.some((ex) => t.includes(ex))) return null;
  return { include, exclude, phrases, t, map };
}

function collectPhraseIndices(phrases, t, indices, map) {
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

export function fuzzyMatch(query, text) {
  const pre = matchPreamble(query, text);
  if (!pre) return null;
  const { include, exclude, phrases, t, map } = pre;
  if (include.length === 0 && phrases.length === 0) {
    return exclude.length > 0 ? { score: 0, indices: [] } : null;
  }
  for (const ph of phrases) if (!t.includes(ph)) return null;
  const results = include.map((term) => bestAlignment(term, t, text, map));
  if (results.some((r) => !r)) return null;
  let total = 0;
  for (const ph of phrases) total += 10 + ph.length * 2;
  const indices = [];
  collectPhraseIndices(phrases, t, indices, map);
  results.forEach((r) => {
    total += r.score;
    indices.push(...r.indices);
  });
  indices.sort((a, b) => a - b);
  return { score: total, indices };
}

export function fuzzyIndices(query, text) {
  const pre = matchPreamble(query, text);
  if (!pre) return [];
  const { include, phrases, t, map } = pre;
  const indices = [];
  if (!collectPhraseIndices(phrases, t, indices, map)) return [];
  const results = include.map((term) => bestAlignment(term, t, text, map));
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

export function substringMatch(query, text) {
  const pre = matchPreamble(query, text);
  if (!pre) return false;
  const { include, exclude, phrases, t } = pre;
  if (include.length === 0 && phrases.length === 0) return exclude.length > 0;
  if (phrases.some((ph) => !t.includes(ph))) return false;
  return include.every((term) => t.includes(term));
}
export function substringIndices(query, text) {
  const pre = matchPreamble(query, text);
  if (!pre) return [];
  const { include, phrases, t, map } = pre;
  if (include.length === 0 && phrases.length === 0) return [];
  if (phrases.some((ph) => !t.includes(ph))) return [];
  const indices = [];
  collectPhraseIndices(phrases, t, indices, map);
  for (const term of include) {
    let idx = t.indexOf(term);
    while (idx !== -1) {
      for (let i = idx; i < idx + term.length; i++) indices.push(map[i]);
      idx = t.indexOf(term, idx + 1);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}
function substringFieldBonus(queryTerms, field, base) {
  if (!field || queryTerms.length === 0) return 0;
  const f = normalizeForMatch(field);
  return queryTerms.every((t) => f.includes(t)) ? base : 0;
}
function recencyScore(item) {
  const ts = item.lastVisit || item.lastAccessed || item.lastVisitTime || item.dateAdded || 0;
  if (!ts) return 0;
  const days = (Date.now() - ts) / 86400000;
  if (days < 0 || !Number.isFinite(days)) return 0;
  const base = Math.max(0, 7 * Math.exp(-days / 14));
  const typedBonus = item.typedVisits ? 2 : (item.typedCount ? 1 : 0);
  return base + typedBonus;
}
function frequencyScore(item) {
  const visit = item.visitCount || 0;
  const typed = item.typedCount || item.typedVisits || 0;
  const c = visit + typed * 1.5;
  if (!c) return 0;
  return Math.log2(1 + c) * 1.2 + (typed ? 1 : 0);
}
const SOURCE_RANK = { tab: 0, history: 1, bookmark: 2 };

export function rankMatches(query, list, fuzzy = true) {
  const q = String(query).trim();
  if (!q) return [...list];
  if (!fuzzy) {
    return list.filter((item) =>
      substringMatch(q, (item.title || "") + " " + (item.url || "")),
    );
  }
  const parsed = parseQuery(q);
  const queryTerms = [...parsed.include, ...parsed.phrases];
  return list
    .map((item) => {
      const hay = (item.title || "") + " " + (item.url || "");
      const match = fuzzyMatch(q, hay);
      if (!match) return null;
      const first = match.indices.length > 0 ? match.indices[0] : 0;
      const last = match.indices.length > 0 ? match.indices[match.indices.length - 1] : 0;
      const baseScore = match.score;
      const tBoost = substringFieldBonus(queryTerms, item.title, 8);
      const hBoost = substringFieldBonus(queryTerms, extractHost(item.url || ""), 6);
      const rScore = recencyScore(item);
      const fScore = frequencyScore(item);
      const totalScore = baseScore + tBoost + hBoost + rScore + fScore;
      return { item, match: { ...match, score: totalScore, baseScore }, span: match.indices.length > 0 ? last - first + 1 : 0, hayLength: hay.length, totalScore };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.match.baseScore !== a.match.baseScore) return b.match.baseScore - a.match.baseScore;
      if (a.span !== b.span) return a.span - b.span;
      if (a.hayLength !== b.hayLength) return a.hayLength - b.hayLength;
      return (
        (SOURCE_RANK[a.item.source] ?? 3) - (SOURCE_RANK[b.item.source] ?? 3)
      );
    });
}

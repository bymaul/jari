const SCORE_BASE = 2;
const SCORE_RUN = 12;
const SCORE_BOUNDARY = 8;
const SCORE_CAMEL = 14;
const SCORE_GAP = -3;
const SCORE_LEADING = -1;

const MAX_ALIGNMENT_STARTS = 64;

function normalizeForMatch(s) {
  try {
    return String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return String(s).toLowerCase();
  }
}
// eslint-disable-next-line no-unused-vars
function queryTerms(query) {
  return normalizeForMatch(query).trim().split(/\s+/).filter(Boolean);
}
export function parseQuery(query) {
  const normalized = normalizeForMatch(query);
  const phrases = [];
  const withoutPhrases = normalized.replace(/"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) phrases.push(t);
    return " ";
  });
  const rawTerms = withoutPhrases.trim().split(/\s+/).filter(Boolean);
  const include = [];
  const exclude = [];
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
    return m ? m[1].split(":")[0] : "";
  }
}

function scoreAlignment(indices, t, text) {
  let score = 0;
  let prev = -1;
  for (const i of indices) {
    score += SCORE_BASE;
    if (prev !== -1) {
      const gap = i - prev - 1;
      score += gap === 0 ? SCORE_RUN : SCORE_GAP * gap;
    }
    if (isBoundaryAt(t, i)) score += SCORE_BOUNDARY;
    else if (text[i] !== text[i].toLowerCase()) score += SCORE_CAMEL;
    prev = i;
  }
  score += SCORE_LEADING * indices[0];
  return score;
}

function bestAlignment(term, t, text) {
  const n = t.length;
  const q = term.length;
  if (q === 0 || q > n) return null;
  let best = null;
  if (q === 1) {
    for (let i = 0; i < n; i++) {
      if (t[i] !== term) continue;
      const score = scoreAlignment([i], t, text);
      if (!best || score > best.score) best = { score, indices: [i] };
    }
    return best;
  }
  let starts = 0;
  for (let s = 0; s < n && starts < MAX_ALIGNMENT_STARTS; s++) {
    if (t[s] !== term[0]) continue;
    starts++;
    const indices = [s];
    let pos = s + 1;
    let ok = true;
    for (let j = 1; j < q; j++) {
      const i = t.indexOf(term[j], pos);
      if (i === -1) {
        ok = false;
        break;
      }
      indices.push(i);
      pos = i + 1;
    }
    if (!ok) continue;
    const score = scoreAlignment(indices, t, text);
    if (!best || score > best.score) best = { score, indices };
  }
  return best;
}

export function fuzzyMatch(query, text) {
  const { include, exclude, phrases } = parseQuery(query);
  if (include.length === 0 && phrases.length === 0) return null;
  const t = normalizeForMatch(text);
  for (const ex of exclude) if (t.includes(ex)) return null;
  for (const ph of phrases) if (!t.includes(ph)) return null;
  const results = include.map((term) => bestAlignment(term, t, text));
  if (results.some((r) => !r)) return null;
  let total = 0;
  const indices = [];
  for (const ph of phrases) {
    const idx = t.indexOf(ph);
    if (idx !== -1) {
      for (let i = idx; i < idx + ph.length; i++) indices.push(i);
      total += 10 + ph.length * 2;
    }
  }
  results.forEach((r) => {
    total += r.score;
    indices.push(...r.indices);
  });
  indices.sort((a, b) => a - b);
  return { score: total, indices };
}

export function fuzzyIndices(query, text) {
  const { include, exclude, phrases } = parseQuery(query);
  const t = normalizeForMatch(text);
  for (const ex of exclude) if (t.includes(ex)) return [];
  const indices = [];
  for (const ph of phrases) {
    if (!t.includes(ph)) return [];
    let idx = t.indexOf(ph);
    while (idx !== -1) {
      for (let i = idx; i < idx + ph.length; i++) indices.push(i);
      idx = t.indexOf(ph, idx + 1);
    }
  }
  const results = include.map((term) => bestAlignment(term, t, text));
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

export function substringMatch(query, text) {
  const { include, exclude, phrases } = parseQuery(query);
  if (include.length === 0 && phrases.length === 0) return false;
  const t = normalizeForMatch(text);
  if (exclude.some((ex) => t.includes(ex))) return false;
  if (phrases.some((ph) => !t.includes(ph))) return false;
  return include.every((term) => t.includes(term));
}
function titleBoost(query, item) {
  if (!item.title) return 0;
  const m = fuzzyMatch(query, item.title);
  return m ? 8 + m.score * 0.15 : 0;
}
function hostBoost(query, item) {
  const host = extractHost(item.url || "");
  if (!host) return 0;
  const m = fuzzyMatch(query, host);
  return m ? 6 + m.score * 0.1 : 0;
}
function recencyScore(item) {
  const ts = item.lastVisit || item.lastAccessed || item.lastVisitTime || 0;
  if (!ts) return 0;
  const days = (Date.now() - ts) / 86400000;
  if (days < 0 || !Number.isFinite(days)) return 0;
  return Math.max(0, 7 * Math.exp(-days / 14));
}
function frequencyScore(item) {
  const c = item.visitCount || item.typedCount || 0;
  if (!c) return 0;
  return Math.log2(1 + c) * 1.2;
}

const SOURCE_RANK = { tab: 0, history: 1, bookmark: 2 };

export function rankMatches(query, list, fuzzy = true) {
  const q = String(query).trim();
  if (!q) return fuzzy ? [] : [...list];
  if (!fuzzy) {
    return list.filter((item) =>
      substringMatch(q, item.title + " " + (item.url || "")),
    );
  }
  return list
    .map((item) => {
      const hay = item.title + " " + (item.url || "");
      const match = fuzzyMatch(q, hay);
      if (!match) return null;
      const first = match.indices[0];
      const last = match.indices[match.indices.length - 1];
      const baseScore = match.score;
      const tBoost = titleBoost(q, item);
      const hBoost = hostBoost(q, item);
      const rScore = recencyScore(item);
      const fScore = frequencyScore(item);
      const totalScore = baseScore + tBoost + hBoost + rScore + fScore;
      return { item, match: { ...match, score: totalScore, baseScore }, span: last - first + 1, hayLength: hay.length, totalScore };
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

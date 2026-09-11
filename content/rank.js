const SCORE_BASE = 2;
const SCORE_RUN = 12;
const SCORE_BOUNDARY = 8;
const SCORE_CAMEL = 14;
const SCORE_GAP = -3;
const SCORE_LEADING = -1;

const MAX_ALIGNMENT_STARTS = 64;

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

function scoreAlignment(indices, t, text, map) {
  let score = 0;
  let prev = -1;
  for (const i of indices) {
    score += SCORE_BASE;
    if (prev !== -1) {
      const gap = i - prev - 1;
      score += gap === 0 ? SCORE_RUN : SCORE_GAP * gap;
    }
    if (isBoundaryAt(t, i)) score += SCORE_BOUNDARY;
    else {
      const ch = text[map[i]];
      if (ch && ch !== ch.toLowerCase()) score += SCORE_CAMEL;
    }
    prev = i;
  }
  score += SCORE_LEADING * indices[0];
  return score;
}

function bestAlignment(term, t, text, map) {
  const n = t.length;
  const q = term.length;
  if (q === 0 || q > n) return null;
  const toOriginal = (indices) => indices.map((i) => map[i]);
  let best = null;
  if (q === 1) {
    for (let i = 0; i < n; i++) {
      if (t[i] !== term) continue;
      const score = scoreAlignment([i], t, text, map);
      if (!best || score > best.score) best = { score, indices: [i] };
    }
    if (best) best.indices = toOriginal(best.indices);
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
    const score = scoreAlignment(indices, t, text, map);
    if (!best || score > best.score) best = { score, indices };
  }
  if (best) best.indices = toOriginal(best.indices);
  return best;
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
  const indices = [];
  for (const ph of phrases) {
    const idx = t.indexOf(ph);
    if (idx !== -1) {
      for (let i = idx; i < idx + ph.length; i++) indices.push(map[i]);
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
function fieldBoost(query, field, base, weight) {
  if (!field) return 0;
  const m = fuzzyMatch(query, field);
  return m ? base + m.score * weight : 0;
}
function titleBoost(query, item) {
  return fieldBoost(query, item.title, 8, 0.15);
}
function hostBoost(query, item) {
  return fieldBoost(query, extractHost(item.url || ""), 6, 0.1);
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
  return list
    .map((item) => {
      const hay = (item.title || "") + " " + (item.url || "");
      const match = fuzzyMatch(q, hay);
      if (!match) return null;
      const first = match.indices.length > 0 ? match.indices[0] : 0;
      const last = match.indices.length > 0 ? match.indices[match.indices.length - 1] : 0;
      const baseScore = match.score;
      const tBoost = titleBoost(q, item);
      const hBoost = hostBoost(q, item);
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

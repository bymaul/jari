// Bounded scoring weights for one term's alignment. Scores are only compared
// between candidates for the same query, so the absolute scale is less
// important than the ordering they produce:
//   - a consecutive run beats the same chars scattered,
//   - an uppercase (camel/title-case) boundary beats a separator boundary,
//   - a match at the start of the text beats one buried later,
//   - nothing is unbounded, so a single term can never dominate the list.
const SCORE_BASE = 2; // every matched char
const SCORE_RUN = 12; // per char that continues a consecutive run
const SCORE_BOUNDARY = 8; // first char, or after a non-word char
const SCORE_CAMEL = 14; // starts an uppercase char (camelCase, title word)
const SCORE_GAP = -3; // per filler char between two matched chars
const SCORE_LEADING = -1; // per unmatched char before the match

// Best-start greedy alignment: try each occurrence of the first char as the
// start, greedily match forward, score that alignment, keep the best one.
// This finds the tightest, best-bonused alignment that a single left-to-right
// pass would miss (e.g. "ob" in "o x ob" matches [4,5], not [0,5]).
const MAX_ALIGNMENT_STARTS = 64;

function queryTerms(query) {
  return String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function isBoundaryAt(t, i) {
  return i === 0 || !/[\w]/.test(t[i - 1]);
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

function matchTerms(query, text) {
  const terms = queryTerms(query);
  const t = String(text).toLowerCase();
  return { terms, results: terms.map((term) => bestAlignment(term, t, text)) };
}

export function fuzzyMatch(query, text) {
  const { terms, results } = matchTerms(query, text);
  if (terms.length === 0 || results.some((r) => !r)) return null;
  const indices = [];
  let total = 0;
  results.forEach((r) => {
    total += r.score;
    indices.push(...r.indices);
  });
  indices.sort((a, b) => a - b);
  return { score: total, indices };
}

export function fuzzyIndices(query, text) {
  const { results } = matchTerms(query, text);
  const indices = [];
  for (const r of results) if (r) indices.push(...r.indices);
  return indices.sort((a, b) => a - b);
}

export function substringMatch(query, text) {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const t = String(text).toLowerCase();
  return terms.every((term) => t.includes(term));
}

const SOURCE_RANK = { tab: 0, history: 1, bookmark: 2 };

// Rank a list of { title, url, source } items against a query. Fuzzy scoring
// sorts by score, then by how tight the match window is, then by text length,
// then by source (tabs before history before bookmarks). With fuzzy matching
// off it falls back to substring filtering that keeps the original order.
export function rankMatches(query, list, fuzzy = true) {
  const q = String(query).trim();
  if (!fuzzy) {
    return list.filter((item) => substringMatch(q, item.title + " " + (item.url || "")));
  }
  return list
    .map((item) => {
      const hay = item.title + " " + (item.url || "");
      const match = fuzzyMatch(q, hay);
      if (!match) return null;
      const first = match.indices[0];
      const last = match.indices[match.indices.length - 1];
      return { item, match, span: last - first + 1, hayLength: hay.length };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      if (a.span !== b.span) return a.span - b.span;
      if (a.hayLength !== b.hayLength) return a.hayLength - b.hayLength;
      return (SOURCE_RANK[a.item.source] ?? 3) - (SOURCE_RANK[b.item.source] ?? 3);
    });
}
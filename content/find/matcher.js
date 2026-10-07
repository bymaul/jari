export function hasUpperCase(s) {
  return /\p{Lu}/u.test(s);
}

export function buildMatcher(query, { caseSensitive = false } = {}) {
  if (!query) return null;
  const flags = (caseSensitive ? "g" : "gi") + "mu";
  const src = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, flags);
}

export function hasUpperCase(s) {
  return /\p{Lu}/u.test(s);
}

export function buildMatcher(query, { regex = false, wholeWord = false, caseSensitive = false } = {}) {
  if (!query) return null;
  const flags = (caseSensitive ? "g" : "gi") + "mu";
  const bounds = (src) => `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  try {
    if (regex) return new RegExp(wholeWord ? bounds(query) : query, flags);
    const src = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(wholeWord ? bounds(src) : src, flags);
  } catch {
    return null;
  }
}

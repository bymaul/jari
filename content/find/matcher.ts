export function hasUpperCase(s: string): boolean {
  return /\p{Lu}/u.test(s);
}

export function buildMatcher(
  query: string,
  { caseSensitive = false }: { caseSensitive?: boolean } = {},
): RegExp | null {
  if (!query) return null;
  const flags = (caseSensitive ? "g" : "gi") + "mu";
  const src = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, flags);
}

export const suggestionSources = ["tab", "history", "bookmark"];

export const maxResultsDefault = 50;
export const maxResultsMin = 5;
export const maxResultsMax = 100;

export function clampMaxResults(n) {
  const v = Math.floor(n);
  if (!Number.isFinite(v)) return maxResultsDefault;
  return Math.min(maxResultsMax, Math.max(maxResultsMin, v));
}

export const MIN_SCROLL_AREA_SIZE = 16;
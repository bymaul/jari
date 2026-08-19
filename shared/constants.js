export const urlSchemes = new Set(["http", "https", "file", "about", "chrome"]);

export const blockedUrlSchemes = new Set([
  "javascript",
  "data",
  "vbscript",
  "chrome-extension",
  "edge",
  "moz-extension",
  "view-source",
]);

export const suggestionSources = ["tab", "history", "bookmark"];

export const MIN_SCROLL_AREA_SIZE = 16;
export const MIN_VISIBLE_HINT_SIZE = 4;
export const OCCLUSION_SAMPLE_THRESHOLD = 8;

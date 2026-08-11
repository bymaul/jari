// Jari: constants shared across execution contexts.
// The content scripts, the options page and the background service worker all
// need these values, and each runs in its own world — the background cannot
// load the content bundle and the content scripts cannot import the
// background. This module is the single source of truth: build.js compiles a
// copy into each bundle (content/options/background), so a change here lands
// everywhere on rebuild. Pure data — no imports.
//
// Values mirrored from the former background.js constants and
// content/keymap.js exports; the "keep in sync" comments those files carried
// are now obsolete.

// URL schemes safe to open/navigate to. hints.js decides whether an <a> href
// may open in a background tab; the background rejects anything outside this
// list. Bare hostnames are assumed to be https by the background.
export const urlSchemes = new Set(["http", "https", "file", "about"]);

// Schemes that must never be navigated to or opened in tabs, even when the
// user typed them (javascript:, data:, chrome:, ...).
export const blockedUrlSchemes = new Set([
  "javascript",
  "data",
  "vbscript",
  "chrome",
  "chrome-extension",
  "edge",
  "moz-extension",
  "view-source",
]);

// Known omnibar suggestion sources, used to validate the stored setting.
export const suggestionSources = ["tab", "history", "bookmark"];

# Changelog

All notable changes to Jari are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned for the extension manifest (`manifest.base.json`).

## [Unreleased]

### Added

- Hover, yank-text and open-in-this-tab hint actions (unbound by default).
- Same-origin iframe links get their own hints; crowded pages keep
  on-screen hints first when the 800-hint cap applies.
- Customizable hint theme (yellow/cyan/dark) and label size, plus an
  extra clickable selector for site-specific elements.
- Find in-bar regex/whole-word/case toggles (rebindable
  `toggleFind*` commands, `Alt+R/W/C` by default) and query
  history (`Up`/`Down`).
- `;w` to reset the scroll area, `*.example.com` disabled-site wildcards,
  searchable help and cheatsheet filter, which-key clue narrowing.
- White focus borders on the options page.
- Stored keymaps gain bindings for newly added commands (existing
  custom binds are never clobbered).
- The hint status pill shows the pending prefix.

### Fixed

- Find no longer scrolls the page when the match sits in fixed content.
- Help lists unbound commands; option reset covers all settings.

## [0.3.0] - 2026-09-05

First public release.

### Added

- Keyboard-driven scrolling (`j`/`k`/`h`/`l`, `gg`/`G`), scroll-area cycling
  across frames (`w`), and zoom (`+`/`-`).
- Link hints: open (`f`), new tab (`F`), background tab (`gf`), focus input
  (`i`), copy link URL (`yf`).
- Omnibox (`t`): open URLs, fuzzy search across open tabs, history, and
  bookmarks, with ranked recents.
- Tab management: incognito open (`T`), close/reopen (`x`/`X`), prev/next
  (`J`/`K`), first/last (`g0`/`g$`), move (`<<`/`>>`), move to window (`W`),
  pin/mute/duplicate (unbound by default).
- History back/forward (`H`/`L`), reload (`r`/`R`), parent/root navigation
  (`gu`/`gU`), edit URL (`ge`), clipboard open (`gp`/`gP`), copy URL/title
  (`yy`/`Y`).
- Find in page (`/` with smart case, `n`/`N`) and visual caret mode
  (`v`/`V` with word/line motions and yank).
- Fully rebindable multi-binding keymap with free prefixes, autosaving
  settings page (`;e`), cheatsheet (`?`), ignore/passthrough and per-site
  disable.
- Firefox support: dedicated add-on ID and no-data-collection declaration
  (`browser_specific_settings.gecko`), background scripts variant.

### Privacy

- No analytics, no network requests, no data leaving the device.
  See [PRIVACY.md](PRIVACY.md).

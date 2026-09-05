# Changelog

All notable changes to Jari are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned for the extension manifest (`manifest.base.json`).

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

### Privacy

- No analytics, no network requests, no data leaving the device.
  See [PRIVACY.md](PRIVACY.md).

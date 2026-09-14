# Changelog

All notable changes to Jari are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned for the extension manifest (`manifest.base.json`).

## [Unreleased]

### Changed

- Link yank bindings shorten from `yfa`/`yft` to `yf` (copy link URL)
  and `yF` (copy link text). Stored keymaps migrate forward (schema
  v6): untouched `yfa`/`yft` entries move to the new combos, custom
  rebinds are never clobbered.
- Find toggles move from `alt+r`/`w`/`c` to `alt+1`/`2`/`3` (regex,
  whole word, case), and half-page scrolling gains `d`/`u` defaults.
  Stored keymaps migrate forward (schema v7): default-shaped toggle
  entries are pruned and the new combos fill where free; custom
  rebinds are never clobbered. The freed `alt+r`/`w`/`c` stay unbound.

### Removed

- Hover-element hint action (`hintHover` and its hover mode); stored
  bindings to it are pruned.

## [0.4.2]

### Fixed

- Scroll areas: late panels, SPA content, and feed growth rescan via
  document-mutation observation; class-driven overflow flips invalidate
  without style-attribute churn.
- Scroll highlight: stop count (`1/3`) via toast, hardened target
  handling (missing body, detached rects, zero-size viewports), no
  double highlight when resetting from a frame.
- Scroll cache: synchronous stale marking with throttled rescans so
  sustained DOM churn still rescans periodically.
- Visual mode: hint `Enter` again activates the single remaining match.

## [0.4.1] - 2026-09-12

### Fixed

- Find: `Esc` discards only the uncommitted query and keeps history for
  `n`/`N`; matches inside same-origin iframes, unicode queries, and the
  committed-query observer.
- Omnibox: unknown bare TLDs fall back to search instead of opening
  invalid URLs; ports, schemes, and localhost no longer hit dead-ends;
  incognito tabs stay isolated, with unified search routing and a
  hardened activate path.
- Hints: fragment links, click fidelity, iframe base URLs, delayed DOM
  observation, and modifier handling.
- Visual mode: word motions, multiline yank, linewise `Y`, and scroll
  targets.
- Omnibox ranking: NFKD index mapping, exclusion-only queries, and
  unicode words.
- Core: keymap validation plus hardened clue/help/dispatch focus paths.
- Settings: newest-wins quota fallback with truthful copy feedback;
  options failures report honestly with rollback and search-engine
  guards.
- Prompt, find, and help overlays render inside Shadow DOM so page
  styles and scripts cannot break or snoop on them.
- Dropped the `search` permission: incognito search (`T`) no longer
  needs it.

## [0.4.0] - 2026-09-09

### Added

- Customizable search engines: the Search settings hold an editable
  keyword engine list (seeded with `g`, `yt`, `gh`, `wiki`, `chat`) plus
  a default engine for bare queries, including incognito search.
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
- Multi-key bindings: key sequences of any length (`gfp`…) with nested
  which-key clues; the options recorder saves chains on `Enter`.
- The hint status pill shows the pending prefix.

### Changed

- Find `Esc` hides highlights instead of clearing them; `n`/`N` resumes
  the kept search.
- Link yank bindings split into `yfa` (copy link URL) and `yft`
  (copy link text); `=` also zooms in.

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

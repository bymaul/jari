# Changelog

All notable changes to Jari are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioned for the extension manifest (`manifest.base.json`).

## [Unreleased]

### Added

- Tab manager (`gt`): keyboard-driven floating panel listing every tab
  across windows with `[pin]`/`[muted]`/`[playing]`/`[bookmarked]` state tags
  and muted group colors. `Space` multi-marks,
  `Enter` switches, `d` closes (two-press confirm for more than one),
  `p`/`m` pin/mute, `e` edits the focused tab's URL, `y` duplicates
  marked tabs, `g` groups, `G` adds to the focused tab's group,
  `u` ungroups, `r` renames the group, `b` toggles bookmarks for the
  marked tabs, `t` opens a new tab, `J`/`K` reorder, `/` filters. The `t`, `r`,
  and `e` modes all share one in-panel text field. Bookmark matching
  ignores trailing slashes and hashes. Grouping needs the
  `tabGroups` permission (Chrome build only); elsewhere it reports
  honestly instead of failing silently. The list re-fetches every 2s while
  open (and on tab focus), so tabs opened, closed, pinned, muted, or
  grouped elsewhere show up live. Inside the manager, `t` reveals an in-panel URL/search field:
  Enter opens the URL, engine keyword, or search in a **background**
  tab so the current page keeps focus, the manager stays open, and the
  new tab shows up in the list (the search handler takes a `background`
  flag so URLs and searches behave the same). The `t`, `r`, `e`, and
  `/` modes share one in-panel `<input>` styled like the omnibar, which
  restores page focus when it closes. Duplicating keeps the current tab
  active. `b` toggles: it bookmarks the targets that are missing and
  removes them once every target is already saved. Closing a tab keeps
  the cursor where the tab used to be. The footer keeps a
  one-line hint by default; `?` toggles the full two-line reference.
  Marking: `Space` toggles the row under the cursor, `v` anchors a
  range that paints and shrinks as you move, `a` marks all visible.
  Bulk actions consume the marks they acted on, and `Esc` unwinds one
  layer at a time: confirm, visual anchor, filter, marks, then close.
  Stored keymaps migrate forward
  (schema v10): `gt` fills where free.

### Changed

- Release assets use standardized names
  (`jari-firefox-<version>-signed.xpi` for the AMO-signed build,
  `jari-firefox-<version>-unsigned.xpi` for the local build) and
  releases are titled `Jari vX.Y.Z`. The workflow checks AMO for the
  version before building and fails fast if it is taken, since AMO
  never reuses version strings, not even deleted ones.

## [0.6.4] - 2026-10-05

### Changed

- Scroll-area cycle goes both ways on bracket binds: `]w` forward, `[w`
  back; both take repeat counts (`3]w` skips two stops). Bare `w` is
  unbound again.
- Screenshots gain default binds: `gss` full page (scroll and stitch),
  `gsp` visible page, `gsr` region. Fresh installs get them; stored
  keymaps stay untouched, bind them in settings if wanted.
- Selection and overlay highlights share the accent theme; edit-URL
  (`ge`) selects the full URL on open.

### Added

- The scroll target follows newly opened dialogs: when a `<dialog>`,
  `role=dialog`, or `aria-modal` panel with its own scroll area appears
  while the target is the page, `j`/`k` apply to it immediately.

### Fixed

- `;x` opens only the native extensions page: Edge uses
  `edge://extensions`, Firefox reports blocked without opening a dead
  tab.
- Visual mode re-syncs on mouse clicks (collapsed selection drops back
  to caret mode, clicks in editable fields exit) and uses the native
  selection highlight instead of a custom overlay.

## [0.6.2] - 2026-09-29

### Added

- Release automation: tagging `vX.Y.Z` builds dist artifacts, signs the
  Firefox build unlisted via AMO, and attaches the signed xpi plus the
  Chrome zip/crx to the GitHub Release (`.github/workflows/release.yml`).
  Firefox dist is now packaged with `web-ext` (linted, `.xpi`); Chrome
  packs `.crx` (CRX3) when `CRX_PRIVATE_KEY` is set.

### Fixed

- `;x` on Firefox reports honestly instead of failing silently: Firefox
  blocks extensions from opening `about:addons`, so Jari now toasts the
  `Ctrl+Shift+A` (`Cmd+Shift+A` on macOS) shortcut.

## [0.6.1] - 2026-09-28

### Changed

- Passthrough mode expires after inactivity instead of a fixed duration.

### Fixed

- Screenshot captures time out instead of hanging (background reply,
  image load, paint, blob), canvases are capped before allocation with
  an honest too-large toast, full-page captures abort when the page
  will not scroll, and overlapping captures are rejected.
- An invalid prefix completion (e.g. `g x`) is swallowed instead of
  reinterpreting the second key as a fresh binding.

## [0.6.0] - 2026-09-27

### Added

- Screenshot page (`screenshotPage`, unbound by default): captures the
  visible viewport as PNG via `chrome.tabs.captureVisibleTab` and
  downloads it as `jari-<host>-YYYYMMDD-HHmmss.png`. Jari overlays (hints,
  prompt, help, pills, toasts) are hidden for the capture and restored
  after. Needs the `activeTab` permission; restricted pages
  (`chrome://`, `about:`, etc.) report honestly instead of failing
  silently.
- Screenshot region (`screenshotRegion`, unbound by default): keyboard
  cursor (`hjkl`/arrows at 16px, `Shift` for 1px, counts, `0`/`$`/`gg`/`G`
  edge jumps, `M` center) marks two corners with `Enter` (a start dot and
  outline stay visible even at zero area), then captures and crops to
  the rectangle (`Escape` cancels, `Backspace` clears the start mark).
- Screenshot full page (`screenshotFullPage`, unbound by default):
  scrolls the page capturing viewport slices and stitches them into one
  PNG (fixed/sticky elements hidden so they don't repeat, scroll and
  overlays restored after, capped at 8 slices / 8000px with an honest
  partial toast). Each slice waits for fonts and in-viewport images
  instead of a fixed delay.

### Changed

- Which-key clue popup no longer filters entries by typed text; it
  always lists every binding under the pending prefix.

### Fixed

- Omnibox ranking scores every alignment with an optimal dynamic
  program (replacing the greedy first-64-starts search) and uses
  unified indices for multi-word phrase matches.
- Find highlights are visible inside the help popup, find skips help
  overlay text when collecting matches, and help search supports
  `Ctrl+Backspace` to delete the last word.

## [0.5.0] - 2026-09-14

### Added

- Page navigation: `[[` jumps to the previous page and `]]` to the
  next page by activating the first matching link or button
  (`rel="next"`/`rel="prev"` always match, otherwise the customizable
  next/previous link texts in settings). Stored keymaps migrate
  forward (schema v8): the new combos fill where free and their
  commands are bound nowhere, so custom rebinds are never clobbered.
- Bookmark toggle (`toggleBookmark`, unbound by default): bookmarks the
  current page on the bookmarks bar (Other bookmarks as fallback) or
  removes it, with honest feedback for unbookmarkable pages.
- Command palette (`:`): fuzzy-find and run any command by name,
  including unbound ones. Stored keymaps migrate forward (schema v8):
  the `:` combo fills where free and its command is bound nowhere.

### Fixed

- Scroll cycling only answers `w` requests from direct child frames;
  same-origin frames without scrollable content are no longer stops.
- Keymap migrations fill every missing alias, never strand a command
  whose new combo is taken, skip fills that would overlap custom
  bindings, drop corrupt keymaps to defaults, and clamp unknown
  schema versions instead of replaying or downgrading.
- Keystrokes typed into the prompt, palette, or help no longer leak
  to page shortcuts (e.g. `/` focusing search on results pages).

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
  keyword engine list (seeded with `g`, `yt`, `gh`, `wiki`, `r`) plus
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

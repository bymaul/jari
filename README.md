<div align="center">
<img src="icons/jari.png"
     title="Helium" alt="Helium logo" width="120" />
 <h1>Jari</h1>
</div>

**Jari** _/ja·ri/_ <ins>noun</ins> 1. The web at your control. 2. A tool to keep your hands firmly on the home row. 2. Simple keyboard-driven navigation for modern browsers.

## Features

Keyboard-driven browsing with everything on the home row: scrolling with repeat
counts, tab and history management, a fuzzy-search omnibar, incremental find
(`/`/`n`/`N`) with highlight, and Vim-like visual/caret text navigation with
block caret and hints — every key rebindable from the options page.

## Default keybindings

### Scrolling

| Key  | Command                   |
| ---- | ------------------------- |
| `j`  | Scroll down               |
| `k`  | Scroll up                 |
| `h`  | Scroll left               |
| `l`  | Scroll right              |
| `gg` | Scroll to top             |
| `G`  | Scroll to bottom          |
| `w`  | Show scroll area          |
| `gs` | Cycle nested scroll areas |
| `gS` | Reset to page scroll      |

### View & zoom

| Key | Command  |
| --- | -------- |
| `+` | Zoom in  |
| `-` | Zoom out |

### Tabs

| Key  | Command                              |
| ---- | ------------------------------------ |
| `t`  | Open URL or search (omnibar)         |
| `gt` | Tab search                           |
| `x`  | Close tab                            |
| `X`  | Reopen closed tab                    |
| `H`  | Previous tab                         |
| `L`  | Next tab                             |
| `g0` | Jump to first tab                    |
| `g$` | Jump to last tab                     |
| `<<` | Move tab left                        |
| `>>` | Move tab right                       |
| `gw` | Split / merge tab/window             |
| `gp` | Open clipboard URL in current tab    |
| `gP` | Open clipboard URL in background tab |

### History

| Key | Command               |
| --- | --------------------- |
| `S` | Go back in history    |
| `D` | Go forward in history |

### Page

| Key  | Command               |
| ---- | --------------------- |
| `r`  | Reload                |
| `R`  | Reload (bypass cache) |
| `gu` | Go to parent path     |
| `gU` | Go to site root       |
| `ge` | Edit current URL      |

### Find

| Key      | Command        |
| -------- | -------------- |
| `/`      | Find forward   |
| `n`      | Next match     |
| `N`      | Previous match |

Incremental search as you type (smart case: lowercase = case-insensitive, uppercase = case-sensitive). Highlights all matches, current match in solid orange. `Esc` clears highlight, `Enter` on a highlighted link follows it. Debounced, shadow-DOM and iframe aware.

### Visual & Caret

| Key         | Command          |
| ----------- | ---------------- |
| `v`         | Visual mode      |
| `V`         | Visual line mode |

`v`/`V` shows cyan hints for text blocks – type hint label to jump to that element and enter visual selection with block caret. Visual uses Jari blue highlight (`::highlight(jari-visual)`). Caret is the Vim-like `NORMAL` cursor (pill `caret`).

Motions (with repeat count, `3w` etc):

| Key              | Motion |
| ---------------- | ------ |
| `h`/`l`/`ArrowLeft`/`ArrowRight` | char left/right |
| `j`/`k`/`ArrowDown`/`ArrowUp` | line down/up (grid-aware fallback via `caretRangeFromPoint`) |
| `w`/`b`/`e`      | word start forward/back, word end |
| `0`/`^`/`$`      | line start, first non-blank, line end |
| `G`/`gg`         | document end/start (`5G` → 5th block) |
| `f`/`F`/`t`/`T` + char | find char forward/back (with `3f` count), `;`/`,` repeat/reverse |
| `o`              | swap anchor/focus |

Operators:

| Key | Action |
| --- | ------ |
| `y` | yank selection → caret (visual), `yy`/`Y` yank line in caret |
| `d`/`x` | yank + delete → caret |
| `o` | swap |
| `v`/`V` | toggle visual ↔ caret, `Esc` visual→caret, caret→page |

Works on `select-none` sites (e.g. `maulana.dev` bento) via temporary `user-select:text` override and robust multi-node highlight fallback.

### Clipboard

| Key  | Command          |
| ---- | ---------------- |
| `yy` | Copy URL         |
| `Y`  | Copy title + URL |

### Modes

| Key          | Command                           |
| ------------ | --------------------------------- |
| `I`          | Ignore mode (until pressed again) |
| `p`          | Passthrough keys (timed)          |
| `ctrl+alt+v` | Enable/disable on this site       |

### Help

| Key  | Command          |
| ---- | ---------------- |
| `?`  | Show keybindings |
| `;e` | Open settings    |

### Commands without default bindings

These commands exist but ship unbound — bind one from the options page:

| Command                                   | Label                      |
| ----------------------------------------- | -------------------------- |
| `scrollPageDown` / `scrollPageUp`         | Scroll page down / up      |
| `scrollHalfPageDown` / `scrollHalfPageUp` | Scroll half page down / up |
| `newTab`                                  | New tab                    |
| `duplicateTab`                            | Duplicate tab              |
| `togglePin`                               | Pin/unpin tab              |
| `toggleMute`                              | Mute/unmute tab            |

## Install

1. Load the extension unpacked:
   - Chrome/Edge: `chrome://extensions` → enable _Developer mode_ → _Load unpacked_ → select this folder.
   - Firefox: `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_.
2. Build the target manifest first (see below) — the checked-in `manifest.json` targets Chrome.

## Build

The ES-module content scripts, options page and background service worker are
bundled with esbuild into `content/bundle.js`, `options/options.bundle.js` and
`background.js` (IIFE, no exports — content scripts can't use runtime ESM
imports, and the background must stay a single classic file), and the target's
manifest is copied to `manifest.json`:

```sh
npm run build:chrome   # or: npm run build:firefox
```

Rebuild after editing anything under `content/`, `options/`, `background/` or
`shared/`, and load the folder again.

## Development

```sh
npm install
npm run lint
npm test
```

## Layout

- `content/` — content scripts (bundled) and `content.css`
- `options/` — options page
- `background/` — background service worker source (`handlers.js` +
  `main.js`), bundled into `background.js`
- `shared/` — constants shared by every bundle (compiled into each one)
- `background.js`, `content/bundle.js`, `options/options.bundle.js` — generated bundles
- `build.js` — bundles content/options/background and generates `manifest.json`

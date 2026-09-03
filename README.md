<div align="center">
<img src="icons/jari.png"
     title="Jari" alt="Jari logo" width="120" />
 <h1>Jari</h1>
</div>

**Jari** _/ja·ri/_ <ins>noun</ins> 1. The web at your control. 2. A tool to keep your hands firmly on the home row. 3. Simple keyboard-driven navigation for modern browsers.

## Features

Keyboard-driven browsing with everything on the home row: scrolling with repeat
counts, tab and history management, a fuzzy-search omnibar, incremental find
(`/`/`n`/`N`) with highlight, and Vim-like visual/caret text navigation with
block caret and hints - every key rebindable from the options page.

## Key Bindings

### Scrolling

- `j` / `k` - scroll down / up
- `h` / `l` - scroll left / right
- `gg` - scroll to top
- `G` - scroll to bottom
- `w` - cycle scroll area / frame (focuses frames, so `j`/`k` and `f` then work inside)

### View & Zoom

- `+` - zoom in
- `-` - zoom out

### Tabs

- `t` - open URL or search (omnibar)
- `gt` - tab search
- `x` - close tab
- `X` - reopen closed tab
- `H` / `L` - previous / next tab
- `g0` - jump to first tab
- `g$` - jump to last tab
- `<<` / `>>` - move tab left / right
- `gw` - split / merge tab/window
- `gp` - open clipboard URL in current tab
- `gP` - open clipboard URL in background tab

### History

- `S` - go back in history
- `D` - go forward in history

### Page

- `r` - reload
- `R` - reload (bypass cache)
- `gu` - go to parent path
- `gU` - go to site root
- `ge` - edit current URL

### Find

- `/` - find forward
- `n` - next match
- `N` - previous match

Incremental search as you type (smart case: lowercase = case-insensitive, uppercase = case-sensitive). Highlights all matches, current match in solid orange. `Esc` clears highlight, `Enter` on a highlighted link follows it. Debounced, shadow-DOM and iframe aware.

### Visual & Caret

- `v` - visual mode
- `V` - visual line mode

`v`/`V` shows cyan hints for text blocks - type hint label to jump to that element and enter visual selection with block caret. Visual uses Jari blue highlight (`::highlight(jari-visual)`). Caret is the Vim-like `NORMAL` cursor (pill `caret`).

**Motions** (with repeat count, `3w` etc):

- `h`/`l`/`ArrowLeft`/`ArrowRight` - char left/right
- `j`/`k`/`ArrowDown`/`ArrowUp` - line down/up (grid-aware fallback)
- `w`/`b`/`e` - word start forward/back, word end
- `0`/`^`/`$` - line start, first non-blank, line end
- `G`/`gg` - document end/start
- `f`/`F`/`t`/`T` + char - find char forward/back
- `o` - swap anchor/focus

**Operators**:

- `y` - yank selection → caret (visual); repeat from caret (caret mode)
- `o` - swap anchor/focus
- `v`/`V` - toggle visual ↔ caret

In caret mode the operators are limited: `y`/`yy` yank the current line and `o` swaps anchor/focus in both modes.

### Clipboard

- `yy` - copy URL
- `Y` - copy title + URL

### Modes

- `I` - ignore mode
- `p` - passthrough keys
- `ctrl+alt+v` - enable/disable on this site

### Help

- `?` - show keybindings
- `;e` - open settings

**Commands without default bindings** - bind one from the options page:

- scrollPageDown / scrollPageUp
- scrollHalfPageDown / scrollHalfPageUp
- newTab
- duplicateTab
- togglePin
- toggleMute

## Install

1. Load the extension unpacked:
   - Chrome/Edge: `chrome://extensions` → enable _Developer mode_ → _Load unpacked_ → select this folder.
   - Firefox: `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_.
2. Build the target manifest first (see below) - the checked-in `manifest.json` targets Chrome.

## Build

The ES-module content scripts, options page and background service worker are
bundled with esbuild into `content/bundle.js`, `options/options.bundle.js` and
`background.js` (IIFE, no exports - content scripts can't use runtime ESM
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

- `content/` - content scripts (bundled) and `content.css`
- `options/` - options page
- `background/` - background service worker source (`handlers.js` +
  `main.js`), bundled into `background.js`
- `shared/` - constants shared by every bundle (compiled into each one)
- `background.js`, `content/bundle.js`, `options/options.bundle.js` - generated bundles
- `build.js` - bundles content/options/background and generates `manifest.json`

**Jari** _/ja·ri/_ <ins>noun</ins> 1. The web at your control. 2. A tool to keep your hands firmly on the home row. 2. Simple keyboard-driven navigation for modern browsers.

## Features

- **Scroll** with `j/k/h/l/G` and repeat counts (`5j`, `gg`). Smooth scrolling is optional.
- **Scroll-area targeting**: `gs` cycles nested scroll containers, `gS` resets to the page, `w` flashes the active area.
- **Tabs**: `x`/`X` close and restore, `H`/`L` switch, `g0`/`g$` jump to first/last, `W` splits a tab into its own window (again to merge back).
- **History**: `S`/`D` go back/forward.
- **Tab search** (`gt`) and **omnibar** (`t`): filter open tabs, or open a URL / search with suggestions from history, bookmarks, and open tabs. `ge` edits the current page URL in place.
- **Link hints**: `f` labels clickable elements, `F` opens in a new tab, `yf` yanks the URL. `i` focuses the nearest text field.
- **Clipboard**: `yy` copies the page URL, `Y` copies the title + URL, `p`/`P` open what's on the clipboard in a tab.
- **Modes**: `I` ignores Jari until pressed again, `o` passes keys through for a few seconds.
- **Per-site disabling**: a toggle (`ctrl+alt+v`) and a list in the options page.
- **Help overlay**: `?` shows every binding; `;e` opens the options page.

All bindings are rebindable (including multi-key `g`/`;`/`y` prefixes) from the options page.

## Install

1. Load the extension unpacked:
   - Chrome/Edge: `chrome://extensions` → enable _Developer mode_ → _Load unpacked_ → select this folder.
   - Firefox: `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_.
2. Build the target manifest first (see below) — the checked-in `manifest.json` targets Chrome.

## Build

The content scripts are concatenated into `content/bundle.js` and the target's
manifest is copied to `manifest.json`:

```sh
npm run build:chrome   # or: npm run build:firefox
```

Rebuild after editing anything under `content/`, and load the folder again.

## Development

```sh
npm install
npm run lint
```

## Layout

- `content/` — content scripts (bundled) and `content.css`
- `options/` — options page
- `background.js` — service worker
- `build.js` — bundles content scripts and generates `manifest.json`

<div align="center">
<img src="icons/jari.png"
     title="Jari" alt="Jari logo" width="120" />
  <h1>Jari</h1>
</div>

**Jari** _/ja·ri/_ - simple keyboard-driven navigation for modern browsers.
Scroll, manage tabs and history, follow links, find in page, and select text
without leaving the home row.

## Keys

Most commands take a repeat count (`3j`, `2x`). `0-9` are reserved for it.

- Scroll: `j`/`k`/`h`/`l`, `gg`/`G` top/bottom, `w` cycle scroll area
- Zoom: `+`/`-`
- Tabs: `t` URL/search (`t ` lists all open tabs, `t ` + query searches them), `T` incognito, `x`/`X` close/reopen,
  `J`/`K` prev/next, `g0`/`g$` first/last, `<<`/`>>` move, `W` move to window,
  `gp`/`gP` open clipboard here/background
- History: `H`/`L` back/forward
- Page: `r`/`R` reload/hard reload, `gu`/`gU` parent/root, `ge` edit URL,
  `yy` copy URL, `Y` copy title + URL
- Hints: `f` click, `F` new tab, `gf` background tab, `i` focus input,
  `yf` copy link URL
- Find: `/` find, `n`/`N` next/prev (smart case, `Esc` clears, `Enter` follows)
- Visual: `v`/`V` visual/line mode (`h`/`j`/`k`/`l`, `w`/`b`/`e`, `0`/`^`/`$`,
  `G`/`gg`, `f`/`F`/`t`/`T` + char, `o` swap; `y` yank)
- Modes: `I` ignore, `p` passthrough, `ctrl+alt+v` disable on site
- Help: `?` cheatsheet, `;e` settings, `;x` extensions page

Unbound by default (bind them in settings): scrollPageDown/Up,
scrollHalfPageDown/Up, newTab, duplicateTab, togglePin, toggleMute.

## Settings

Open with `;e`. Everything above is rebindable: each command holds several
bindings, and any key can start a two-key prefix (`Enter` keeps it single).
Overlapping bindings are allowed but flagged - the single key fires first.

## Install

Chrome/Edge: `chrome://extensions` → Developer mode → Load unpacked.
Firefox: `about:debugging` → Load Temporary Add-on.
Build the target manifest first (below) - the checked-in one targets Chrome.

## Build & dev

```sh
npm install
npm run lint          # eslint, must be clean
npm test              # node --test
npm run build:chrome  # or: npm run build:firefox
```

Source lives in `content/`, `options/`, `background/`, `shared/` and is
bundled by esbuild into `content/bundle.js`, `options/options.bundle.js`,
`background.js` - rebuild after touching source and commit both together.

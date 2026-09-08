<div align="center">
<img src="icons/jari.png"
     title="Jari" alt="Jari logo" width="120" />
  <h1>Jari</h1>
</div>

**Jari** _/ja·ri/_ - keyboard-driven browsing for modern browsers.
Scroll, tabs, history, link hints, find in page, and text selection
without leaving the home row.

Chrome, Edge, and Firefox (Manifest V3). No data collection -
see [PRIVACY.md](PRIVACY.md).

## Keys

Commands take a repeat count (`3j`, `2x`); `0-9` are reserved for it.
Bindings chain into sequences of any length.

- Scroll `j`/`k`/`h`/`l`, top/bottom `gg`/`G`, scroll areas `w`/`;w`
- Zoom `+`/`-`
- Tabs `t` URL/search, `T` incognito, `x`/`X` close/reopen, `J`/`K` prev/next,
  `g0`/`g$` first/last, `<<`/`>>` move, `W` to window, `gp`/`gP` from clipboard
- History `H`/`L`, reload `r`/`R`, `gu`/`gU` parent/root, `ge` edit URL,
  `yy`/`Y` copy URL / title + URL
- Hints `f` click, `F` new tab, `gf` background, `i` input, `yf` yank link
- Find `/`, next/prev `n`/`N` (smartcase; toggles `Alt+R/W/C`, history `Up`/`Down`)
- Visual `v`/`V` (`h`/`j`/`k`/`l` `w`/`b`/`e` `0`/`^`/`$` `G`/`gg` `f`/`F`/`t`/`T` `o` `y`)
- Modes `I` ignore, `p` passthrough, `ctrl+alt+v` per-site disable
- Help `?` cheatsheet, `;e` settings, `;x` extensions page

`t ` alone lists open tabs; `t ` + text searches them.

Unbound by default (bind in settings): scrollPageDown/Up, scrollHalfPageDown/Up,
newTab, duplicateTab, togglePin, toggleMute, hintHover, hintYankText, hintOpenCurrent.

## Settings (`;e`)

Everything is rebindable with several bindings per command. Hints offers
themes, label size, and an extra clickable selector; disabled sites accept
`*.example.com` wildcards.

## Install

Download the latest `jari-chrome-<version>.zip` or `jari-firefox-<version>.zip`
from [Releases](https://github.com/bymaul/jari/releases) and unzip it, then:

- Chrome/Edge: `chrome://extensions` → Developer mode → Load unpacked →
  select the unzipped folder.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  select the `manifest.json` inside the unzipped folder. (Temporary add-ons
  are removed when Firefox restarts; signed store builds are planned.)

Or build from source (below) and load this folder the same way. The checked-in
`manifest.json` targets Chrome - run `npm run build:firefox` first for Firefox.

## Permissions - why each one

| Permission | Used for |
| --- | --- |
| `tabs`, `sessions` | Switch, close, reopen, move, duplicate tabs |
| `history`, `bookmarks` | Omnibox (`t`) suggestions from your history and bookmarks |
| `search` | Open a search in a maximized incognito window (`T`) |
| `storage` | Persist your settings via the browser's synced storage |
| `clipboardRead` | Open a URL from your clipboard (`gp`/`gP`) |
| `clipboardWrite` | Copy URL / title (`yy`, `Y`, `yf`) - Firefox only; Chrome uses the page clipboard API |
| `<all_urls>` content script | Link hints, scrolling, find, and visual mode on the pages you visit |

Jari makes no network requests of its own and sends nothing anywhere.
Details in [PRIVACY.md](PRIVACY.md).

## Build & dev

```sh
npm install
npm run lint          # eslint, must be clean
npm test              # node --test
npm run build:chrome  # or: npm run build:firefox
npm run dist          # release zips for both targets under dist/
```

Source lives in `content/`, `options/`, `background/`, `shared/` and is
bundled by esbuild into `content/bundle.js`, `options/options.bundle.js`,
`background.js` - rebuild after touching source and commit both together.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Support & contributing

- Bug reports and feature requests:
  [GitHub Issues](https://github.com/bymaul/jari/issues). Include browser +
  version, Jari version, page URL (if public), and keys pressed.
- Security issues: open a private
  [security advisory](https://github.com/bymaul/jari/security/advisories/new)
  instead of a public issue.
- Pull requests welcome. Keep changes small, run `npm run lint` and
  `npm test`, and rebuild the bundles before committing.

## License

[MIT](LICENSE)

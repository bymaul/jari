**Jari** _/ja·ri/_ <ins>noun</ins> 1. The web at your control. 2. A tool to keep your hands firmly on the home row. 2. Simple keyboard-driven navigation for modern browsers.

## Features

Keyboard-driven browsing with everything on the home row: scrolling with repeat
counts, tab and history management, link hints, a fuzzy-search omnibar, and
ignore/passthrough modes — every key rebindable from the options page.

## Default keybindings

### Scrolling
| Key | Command |
| --- | --- |
| `j` | Scroll down |
| `k` | Scroll up |
| `h` | Scroll left |
| `l` | Scroll right |
| `gg` | Scroll to top |
| `G` | Scroll to bottom |
| `w` | Show scroll area |
| `gs` | Cycle nested scroll areas |
| `gS` | Reset to page scroll |

### View & zoom
| Key | Command |
| --- | --- |
| `+` | Zoom in |
| `-` | Zoom out |

### Tabs
| Key | Command |
| --- | --- |
| `t` | Open URL or search (omnibar) |
| `gt` | Tab search |
| `x` | Close tab |
| `X` | Reopen closed tab |
| `H` | Previous tab |
| `L` | Next tab |
| `g0` | Jump to first tab |
| `g$` | Jump to last tab |
| `<<` | Move tab left |
| `>>` | Move tab right |
| `gw` | Split tab / merge window |
| `gp` | Open clipboard URL in current tab |
| `gP` | Open clipboard URL in background tab |

### History
| Key | Command |
| --- | --- |
| `S` | Go back in history |
| `D` | Go forward in history |

### Hints
| Key | Command |
| --- | --- |
| `f` | Link hints (click) |
| `F` | Link hints (new tab) |
| `yf` | Copy link URL |
| `i` | Focus nearest input |

### Page
| Key | Command |
| --- | --- |
| `r` | Reload |
| `R` | Reload (bypass cache) |
| `gu` | Go to parent path |
| `gU` | Go to site root |
| `ge` | Edit current URL |

### Clipboard
| Key | Command |
| --- | --- |
| `yy` | Copy URL |
| `Y` | Copy title + URL |

### Modes
| Key | Command |
| --- | --- |
| `I` | Ignore mode (until pressed again) |
| `o` | Passthrough keys (timed) |
| `ctrl+alt+v` | Enable/disable on this site |

### Help
| Key | Command |
| --- | --- |
| `?` | Show keybindings |
| `;e` | Open settings |

## Install

1. Load the extension unpacked:
   - Chrome/Edge: `chrome://extensions` → enable _Developer mode_ → _Load unpacked_ → select this folder.
   - Firefox: `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_.
2. Build the target manifest first (see below) — the checked-in `manifest.json` targets Chrome.

## Build

The ES-module content scripts and options page are bundled with esbuild into
`content/bundle.js` and `options/options.bundle.js` (IIFE, no exports), and the
target's manifest is copied to `manifest.json`:

```sh
npm run build:chrome   # or: npm run build:firefox
```

Rebuild after editing anything under `content/`, and load the folder again.

## Development

```sh
npm install
npm run lint
npm test
```

## Layout

- `content/` — content scripts (bundled) and `content.css`
- `options/` — options page
- `background.js` — service worker
- `build.js` — bundles content scripts and generates `manifest.json`

**Jari** _/ja·ri/_ <ins>noun</ins> 1. The web at your control. 2. A tool to keep your hands firmly on the home row. 2. Simple keyboard-driven navigation for modern browsers.

## Features

- **Scroll** with `j`/`k`/`h`/`l` and repeat counts (`5j`, `gg`). Smooth scrolling is optional.
- **Scroll-area targeting**: `gs` cycles nested scroll containers, `gS` resets to the page, `w` flashes the active area.
- **Tabs**: `x`/`X` close and restore, `H`/`L` switch, `<<`/`>>` move left/right, `g0`/`g$` jump to first/last, `W` splits a tab into its own window (again to merge back).
- **History**: `S`/`D` go back/forward.
- **Tab search** (`gt`) and **omnibar** (`t`): filter open tabs, or open a URL / search with suggestions from history, bookmarks, and open tabs. `ge` edits the current page URL in place.
- **Link hints**: `f` labels clickable elements, `F` opens in a new tab, `yf` yanks the URL. `i` focuses the nearest text field.
- **Clipboard**: `yy` copies the URL, `Y` copies title + URL, `gp`/`gP` open what's on the clipboard in a tab.
- **Modes**: `I` ignores Jari until pressed again, `o` passes keys through for a few seconds.
- **Per-site disabling**: `ctrl+alt+v` toggles the current site; the options page manages the full list.
- **Help overlay**: `?` shows every binding; `;e` opens the options page.

All bindings are rebindable from the options page, including the multi-key `g`/`;`/`y`/`<`/`>` prefixes. Repeat counts (`3x`, `5j`) work on repeatable commands.

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
| `W` | Split tab / merge window |
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
npm test
```

## Layout

- `content/` — content scripts (bundled) and `content.css`
- `options/` — options page
- `background.js` — service worker
- `build.js` — bundles content scripts and generates `manifest.json`

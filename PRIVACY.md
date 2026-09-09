# Privacy Policy for Jari

Jari is a simple keyboard-driven navigation extension. It does not collect,
transmit, sell, or share any personal data. Everything it reads stays on your
device.

## Data the extension accesses, and why

All access happens locally in response to your own key presses. Nothing is
sent to the developer or any third party.

| Access | Why | Where the data goes |
| --- | --- | --- |
| Page content (`<all_urls>`, all frames) | Render link hints, scroll, find-in-page, visual mode | Nowhere - processed in the page and discarded |
| Tabs, recently closed sessions | Switch, close, reopen, move tabs (`J`/`K`, `x`/`X`, `<<`) | Nowhere |
| Browsing history | Omnibox (`t`) suggestions from pages you visited | Nowhere |
| Bookmarks | Omnibox (`t`) suggestions from your bookmarks | Nowhere |
| Clipboard read | Open a URL from your clipboard (`gp`/`gP`) | Opened as a tab, otherwise discarded |
| Clipboard write | Copy URL / title (`yy`, `Y`, `yf`) | Your clipboard only |
| Settings (`storage.sync`) | Persist your keybindings and options | Your browser's synced storage, never to us |
| Find history (`storage.local`) | Recall past `/` queries with `Up`/`Down` | This device only, never synced or sent anywhere |

## Network use

Jari makes no network requests of its own. The only network activity it can
trigger is navigation or search you explicitly request (opening a URL,
`chrome.search.query` for the `T` command), which goes to the site or search
engine you chose - same as typing in the address bar.

## Contact

Questions: https://github.com/bymaul/jari/issues

# Jari E2E harness

Headless-browser end-to-end tests. They drive a real Chromium via CDP and the
loaded extension, so they cover the wiring that the unit suites stub out:
background coordination, the options page, and hint drawing/canceling.

## Requirements

- A Chromium-family binary (Chrome or a fork such as Helium). Chrome's built-in
  uBlock-like extras in some forks can block chrome-extension:// pages, so the
  browser must be a clean profile without such filters interfering. Set
  `BROWSER_BIN` if your binary is not on PATH as `google-chrome`.
- Network access for `webpage-smoke.js` (`https://example.com`).
- The extension must be built first: `npm run build:chrome`.

## Running

Each scenario needs a fresh profile (first argument) and the built extension
directory (second argument). `launch.sh` starts a headless instance and exits;
the scenarios connect to its debugging port.

```sh
npm run build:chrome

PROFILE=/tmp/jari-e2e-profile
rm -rf "$PROFILE"
BROWSER_BIN=/opt/helium-browser-bin/helium ./tests/e2e/launch.sh "$PROFILE" "$(pwd)"
# wait for the debugging port to come up, then:
node tests/e2e/options-hints.js "$PROFILE" "$(pwd)"
node tests/e2e/webpage-smoke.js "$PROFILE" "$(pwd)"
```

The extension id is read from the profile's `Default/Preferences`
(`extensions.settings`), so no id is hardcoded. Override the debugging port
with `DEBUG_PORT`.

## Scenarios

- `options-hints.js` - regression for options-page hint drawing. The options
  page runs in a real tab, so the background once answered `COORDINATE_HINTS`
  without `drawLocally` and nothing drew. Asserts the response carries
  `drawLocally: true`, hints render, activating a hint lands focus, and Escape
  clears them.
- `webpage-smoke.js` - content-script coordination on a real page: hints draw
  and Escape cancels.

## Notes

- Keypresses are dispatched with `Input.dispatchKeyEvent`. Non-printable keys
  must be sent whole ("Escape"), never iterated character by character.
- Content scripts do not run on `data:` or `chrome-extension://` URLs injected
  by the manifest; the options page runs them because it loads
  `content/bundle.js` with a `<script>` tag.
- A profile reused across runs can carry stale extension state; start each run
  with a fresh profile. Reloading the extension in place via
  `chrome.runtime.reload()` can trip browser-level URL blocking, so the tests
  relaunch the browser instead.

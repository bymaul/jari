# Known issues

Open reports and platform limitations, collected from the site-testing passes.
Each entry records the site, the step, what happened vs. expected, and its
current status.

## Resolved

## Hint activation on framed pages left the other frames' hints on screen

**Step:** Press `f` on a page with multiple frames (e.g. a logged-in Google SERP
with account/menu frames), then type the full label for a hint in the main
frame.

**Expected:** activating the hint closes hint mode everywhere - the main frame
and every other frame that drew hints.

**Actual:** (pre-fix) the activated frame's hints cleared, but the hints drawn
in the other frames stayed on screen. The background coordinates hints across
frames (`coordinateHints` counts hints in every frame and relays keys via
`HINTS_KEY`), so the other frames were never told to close.

**Root cause:** in the content script, `onKeyDown` gated the closing
`HINTS_KEY` message on the `needsRelay` flag _after_ calling `handleHintKey`.
Activating a hint calls `cancel()`, which resets `needsRelay` to `false`, so
the message announcing `closed: true` was dropped. The background therefore
never sent `HINTS_CLOSE` to the remaining frames. A partial keypress relayed
fine; only the final, closing keypress was lost.

**Status:** resolved. `onKeyDown` now snapshots `needsRelay` before
`handleHintKey`, so the closing key is always relayed and the background closes
every frame that took part. Regression coverage: the
"onKeyDown still relays the closing key when activation cancels the relay
session" test in `tests/hints.test.js` (drives the real `COUNT_HINTS` /
`DRAW_HINTS` message path), the existing `coordinateHints`/`relayHintKey` tests
in `tests/background.test.js`, and the multi-frame E2E harness
(`frames.html` fixture + `sw-instr.mjs`): after activating the avatar hint the
background sends `HINTS_CLOSE` to both frames and all hints clear.

**Step:** Press `f` on a page where clicking a target opens a menu instead of
navigating (e.g. Google's profile picture on SERPs).

**Expected:** activating the hint mirrors a real click - the menu opens and the
page stays put.

**Actual:** (pre-fix) `activateClick` fired a bare pointer/mouse press and a
synthetic click, then force-navigated with `window.location.assign(href)` after
300ms whenever the URL had not changed (the b110d53 SERP guarantee). Pages that
intercept the click - Google's avatar opens its menu on mousedown - still got
force-navigated to the link.

**Status:** resolved in cfc5b3d. `simulateClick` now dispatches a realistic interaction: a
hover sequence (`pointerover`/`pointerenter`/`mouseover`/`mouseenter`/
`mousemove`), a full press (`pointerId`, `pointerType: mouse`, `isPrimary`,
`buttons`/`detail`/`view`, screen coordinates), and then `el.click()` so the
browser only applies default link navigation when the page does not cancel it.
If the page cancels mousedown, a plain click is dispatched so handlers still
run without navigating. The `location.assign` fallback survives only as a
safety net for same-tab http(s) links that neither navigated nor canceled the
click (`target=_blank` and `download` links are excluded). Hover events also
arm hover-dependent UI, so buttons that only respond after a mouseover work
without the user hovering first; hover simulation runs on activation only, and
elements hidden via `opacity:0`/`visibility:hidden` are still not scanned, so a
hover-revealed target must live inside a hintable container. Regression
coverage: `simulateClick` tests in `tests/hints.test.js` and the fixture
harness (`clicktest.mjs`): an intercepted menu link does not navigate, plain
links still navigate, and arm-on-hover / hover-reveal targets activate without
a real hover. Verify Google's avatar menu on a logged-in profile (the headless
browser is logged out and bot-walled).

Follow-up: simulated clicks also survive page handlers that throw. `dispatchSafe`
guards every dispatched hover/press event, `el.click()` is wrapped, and hint
activation is wrapped so a throwing page handler cannot leave the page in a
half-clicked state. Regression coverage: the "simulateClick survives page
handlers that throw" and "simulateClick survives handlers that cancel and then
throw" tests in `tests/hints.test.js`.

## Rebinding or unbinding a default key left the old binding active

**Step:** On the options page, rebind the passthrough key from `p` to `z` and
save; then press `p` on a page.

**Expected:** `p` no longer triggers passthrough - the binding is replaced.

**Actual:** (pre-fix) `p` still entered passthrough alongside `z`. The stored
keymap had only `z`, but `normalizeSettings` merged the stored map over
`keymapDefaults`, so any default binding removed by a rebind was resurrected
from the defaults. Unbinding a default key was impossible for the same reason.

**Status:** resolved in 980edb3. The stored keymap is now authoritative once
present (`d.keymap != null ? storedKeymap : keymapDefaults`); defaults are
only used on first run (no stored keymap). Regression coverage:
`normalizeSettings` tests in `tests/keymap.test.js`
("normalizeSettings fills defaults only when no keymap is stored",
"rebinding away a default key removes the default binding"). Verified
end-to-end with the rebind harness (`rebind.mjs`): rebind `p`→`z` makes `z`
enter passthrough and `p` do nothing; reverting restores the original
behavior.

## Options page — hints, `f`/`F`/`i` did nothing

**Step:** Open Jari's settings page and press `f` / `F` / `i`.

**Expected:** hints appear over the settings page and activate, or the single
input is focused.

**Actual:** the key is consumed but nothing is drawn or focused.

**Status:** resolved. Hint drawing moved from per-frame local drawing to
background coordination in b110d53, and the background's `coordinateHints`
reads `sender.tab.id`. Because the options page opens in a real tab
(`open_in_tab: true`), its messages carry a defined `sender.tab`, so the
handler did not take the extension-page branch and instead treated the page
like a web content script: it called `chrome.webNavigation.getAllFrames` for
the extension tab, which returns `[]`, hit the `total === 0` path, and
answered `{ needsRelay: false }` without `drawLocally`. The content script's
`start()` therefore skipped local drawing entirely.

`coordinateHints` now also returns `{ needsRelay: false, drawLocally: true }`
when the sender URL is `chrome-extension://`, regardless of `sender.tab`, so
Jari's own pages always draw hints locally (the SW can never reach an
extension page with `chrome.tabs.sendMessage` anyway). Verified end-to-end in
the headless repro (`options-instr2.mjs`): pressing `f` on the settings page
now draws hints, hint activation focuses the target, and Escape clears them.

## Instagram feed — no hints after scrolling

**Step:** On the desktop feed, scroll down a few posts, then press `f`.

**Expected:** hints on the visible posts (username/hashtag links, action
buttons, comment links).

**Actual:** (pre-fix) at the top of the feed hints appear normally, but once
the page is scrolled the scan finds nothing — zero hints even though the
viewport is full of links.

**Status:** resolved in 106eed0. Notes for future debugging:

- Instagram scrolls the **window**, not an internal container, and sets
  `overflow-y: scroll` on `<html>`. The occlusion scan walks ancestors
  looking for clip boxes; the root element's `getBoundingClientRect()` is
  viewport-sized but lives in document coordinates, so once the page scrolls
  the box sits entirely above the viewport and the scrollport-overlap test
  rejected every on-screen element.
- Other sites did not show this because `overflow-y` defaults to `visible`
  on `<html>`, and the walk skips ancestors with visible overflow. The bug
  was specifically an explicit non-visible overflow on the root.
- Two defenses now cover it: the walk skips `document.documentElement` and
  `document.body` entirely (they are the viewport, not clip boxes), and
  `rectOverlapsScrollport` treats any box that misses the viewport as
  overlapping (an off-screen box cannot clip on-screen content). Real clip
  boxes — carousels (Instagram's stories bar), feed columns — are descendants
  and are still checked.
- Regression coverage: `isOccluded` and `scanElements` tests in
  `tests/hints.test.js` ("ignores the scrolled root element",
  "keeps on-screen links on a window-scrolled page").

## Google search results — hint occlusion and label placement

**Step:** Press `f` on Google SERPs, then scroll so a result's title sits
half under the sticky search bar or cut by the fold.

**Expected:** every visible result title gets a hint, and the hint label sits
on the visible part of the result, fully inside the viewport.

**Actual:** (pre-fix) results whose center was covered by the sticky bar or
clipped by the fold got no hint at all, because the visibility and occlusion
tests required the full rect center to be on-screen and uncovered.

**Status:** resolved in 73c297b. Notes for future debugging:

- Google's result-row wrapper span is the topmost element above its own
  anchor (the anchor is `pointer-events:none`), so `isOccluded` now accepts a
  hit that _wraps_ the candidate as not occluding — real occluders (sticky
  bars, modals, carousels) are siblings of what they cover, never ancestors.
- The occlusion hit test samples up to five points across the visible
  portion, center first; one uncovered point is enough, because hint
  activation clicks the element directly (`el.click()`).
- Labels are placed on the visible portion and clamped into the viewport.
  Residual: a sliver on the right viewport edge (≥8px wide) can still put its
  label slightly off-screen to the right — `left` is not clamped.

## Gmail — link hints over the compose window

**Step:** Compose an email, press `f`, then click a hint on the compose window.

**Expected:** hints appear over the compose window and activate the target.

**Actual:** hints only work when focus is inside the compose frame; from the
main page they do not appear over the frame, and when they do appear they
render **behind** the frame (the frame paints on top of the hint boxes).

**Status:** resolved. Notes from the first pass: Gmail's compose window renders in
its own frame. Content scripts only see the frame that has focus, so hints
reach compose when focus is inside it. If hints appear there but not from the
main page, that is a frame-traversal limitation (hints don't cross frames).
The z-order problem (hints behind the frame) is separate and also resolved.

## Notion — `i` editor focus

**Step:** Press `i` (focus input) on a page with a text block.

**Expected:** the text block is focused and the caret is placed so typing works
immediately.

**Actual:** no focus lands in the block. `f` does detect the editor inputs as
hint targets; activating one also fails to focus the editor.

**Status:** open. Caret placement when focus _does_ land is fixed
(`placeCaretAtEnd` in `focusAndPlaceCaret`): focusing a prefilled
`<input>`/`<textarea>` moves the caret to the end, and focusing a
`contenteditable` (light-DOM or inside a shadow root) collapses the selection
at the end. Verified end-to-end in the headless harness (input, textarea,
contenteditable, and a shadow-hosted contenteditable; typing after focus
appends at the end). The remaining Notion problem: programmatic focus now
lands, but only on the page title's editable, not on body text blocks - so
`i` puts the caret in the title instead of the paragraph you are reading.
Notion only renders editable blocks (`contenteditable="true"`) when signed
in; publicly shared pages are read-only (`contenteditable="false"`), so
headless validation against Notion requires a logged-in profile.

# Known issues

Open reports and platform limitations, collected from the site-testing passes.
Each entry records the site, the step, what happened vs. expected, and its
current status.

## Backlog

Hint improvements (agreed 2026-08). All five scoped from Vimium /
Surfingkeys / Tridactyl reference research; multi-select collect-mode was
considered and dropped.

1. **Yank variants** (`yf`): `yankLink` honors the existing `copyFormat`
   setting (`plain` → URL, `markdown` → `[title](url)`); new `linkHintsYankText`
   command (copies link text) assignable via the keymap editor.
2. **Largest-child placement** (Tridactyl `changeHintablesToLargestChild`):
   after scan/dedupe, descend to the largest child inside the target's subtree
   and use its rect + element for label placement and activation (events
   bubble to the wrapper), so labels on big cards sit on the real clickable.
3. **De-overlap label nudging** (Surfingkeys/Tridactyl `deOverlap`): pure
   `resolveOverlap` pushes colliding labels apart (down/right/up/left),
   clamped to the viewport; runs after the initial draw and after scroll
   reposition (`repositionHints`). Existing near-identical-rect dedupe stays.
4. **Lazy rescan**: while hints are open, a `MutationObserver` on
   `document.documentElement` (subtree/childList/attributes), skipping the
   hints-host, status-stack and measuring-host subtrees, debounced 200ms,
   re-coordinates through the background (active mode stored per tab,
   `RESCAN_HINTS` → re-run `coordinateHints` → fresh global `startIndex` per
   frame), preserving `typed` where it still matches.
5. **Cross-frame verification**: coordination already existed (global labels,
   key relay, `i` auto-focus). An E2E with a same-origin iframe fixture now
   verifies hints draw in both frames with globally unique labels, picking
   inside the iframe activates, and `Escape` closes all frames.

**Status:** all landed. Unit coverage in `tests/hints.test.js`
(`yankTextFor`, `changeHintablesToLargestChild`, `resolveOverlap`); E2E in
`tests/e2e/` (`largest-child.js`, `dense-hints.js`, `lazy-rescan.js`,
`frames.js`).

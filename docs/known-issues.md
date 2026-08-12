# Known issues

Open reports and platform limitations, collected from the site-testing passes.
Each entry records the site, the step, what happened vs. expected, and its
current status.

## Resolved

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
  hit that *wraps* the candidate as not occluding — real occluders (sticky
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

**Status:** open. Notes from the first pass: Gmail's compose window renders in
its own frame. Content scripts only see the frame that has focus, so hints
reach compose when focus is inside it. If hints appear there but not from the
main page, that is a frame-traversal limitation (hints don't cross frames).
The z-order problem (hints behind the frame) is separate and also unresolved.

## Notion — `i` editor focus

**Step:** Press `i` (focus input) on a page with a text block.

**Expected:** the text block is focused and the caret is placed so typing
works immediately.

**Actual:** no focus lands in the block. `f` does detect the editor inputs as
hint targets; activating one also fails to focus the editor.

**Status:** open. Likely related to Notion's shadow-tree editor internals
resisting programmatic focus; the pointer-sequence fallback in `focusAndPlaceCaret`
does not cover it.

## Google Docs — `Esc` in hint mode

**Step:** Press `f`, then `Esc` while a hint label is highlighted.

**Expected:** hints close; the focused element (e.g. a toolbar item) blurs and
any selection highlight clears.

**Actual:** hints close but focus stays on the activated element.

**Status:** open (low priority). Feature request, not a regression: `Esc`
already closes hint mode; blurring the activated element is the desired
addition.

# Known issues

Open reports and platform limitations, collected from the site-testing passes.
Each entry records the site, the step, what happened vs. expected, and its
current status.

## Open

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

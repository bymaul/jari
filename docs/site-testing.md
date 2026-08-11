# Site testing checklist

Acceptance pass for the Shadow DOM work. Every item lists a concrete action
and the expected result; mark `[x]` as you go.

**Setup:** load the unpacked extension from the repo root
(`chrome://extensions` → Load unpacked). When the manifest changes (e.g.
`all_frames` was added), **remove and re-add the extension** — a plain reload
does not always pick up manifest edits. Reload each page after changes.

Common setup: default keybindings, home-row hint set. When a step says
"rebind", use the options page.

## First pass (Shadow DOM)

- [x] **Test Gmail**
  - [x] Click into the Compose "To" field and the message body; type freely — Jari must not run any command while typing.
  - [x] Press `Esc` inside the body — the field blurs and no Jari command fires.
  - [x] Press `f` — hints appear on visible email/button links (including inside shadow-based widgets); a hint click opens the mail.
  - [x] Type a partial query in the search box, then press `j`/`k` — the page scrolls, nothing is typed.
  - [x] `o` (passthrough) — type `j`/`k` and they reach the page unchanged until the timeout; `Esc` exits early.
  - [x] `t` opens the omnibar and tab suggestions work.
  - [x] `gt` tab search works while Gmail is open.

- [x] **Test Notion**
  - [x] Click into a page's editor (a block); type freely — no Jari commands fire while typing.
  - [x] `Esc` in the editor leaves the field without running a Jari command.
  - [x] Press `f` — hints appear on visible links/buttons across the sidebar and content (Notion renders a lot in shadow trees).
  - [x] `gs` / `gS` — scroll areas inside shadow containers are discoverable and cycle correctly; `w` highlights the active one.
  - [x] `j`/`k` scrolls the page (or the resolved scroll area) normally.
  - [x] `o` passthrough works in the editor (type without Jari interference), `Esc` exits early.

- [x] **Test Google Docs**
  - [x] Open a doc and type in the document body — Jari must not intercept a single key.
  - [x] Use arrow keys / `Esc` inside the document — no Jari command runs.
  - [x] `j`/`k` outside the body (page focused) scrolls the document page.
  - [x] Press `f` — hints appear on visible links/buttons (comments, toolbar).
  - [x] `o` passthrough in the document — keys reach the doc; `Esc` exits early (note: Docs uses `Esc` itself; verify the doc doesn't get a stray command).
  - [x] Rebind the passthrough key to `z` on the options page; confirm `z` and not `o` triggers it here.

- [x] **Test YouTube**
  - [x] On a video page, press `f` — hints appear on visible links (suggestions, comments, description); a hint opens the target in a background tab.
  - [x] `yf` copies a link URL; `Y` copies title + URL in the configured format.
  - [x] `gs`/`gS` — nested scroll areas (comment pane, description) cycle correctly.
  - [x] `j`/`k` scroll the page; press `k` while paused — note YouTube's own `j`/`k` seek shortcuts must NOT fire when Jari consumes the key (page keys are intercepted).
  - [x] `t` omnibar suggests YouTube tabs/history and opens results.
  - [x] Fullscreen a video with `o`/`I` active — pills hide; leaving fullscreen restores them.
  - [x] `H`/`L`, `x`, `X` tab commands work from the video page.

## Re-test after fixes

Fixes shipped in response to the first-pass reports: `all_frames` for Gmail's
compose iframe, pointer/mouse activation on hint clicks and editor focus,
link-only yank/newtab hints, hidden-scroll-area filtering, and a
viewport-coverage-based scroll target picker. Re-run these items.

- [x] **Gmail — compose window hints**
  - [x] Extension was **removed and re-added** (not just reloaded) so `all_frames` is active.
  - [x] Open Compose, press `f` with focus on the page — hints appear over the compose window.
  - [x] Click **into** the compose window (focus moves into its frame), then press `f` — hints appear inside compose and work.

  > Notes: Gmail's compose window renders in its own frame. Content scripts
  > only see the frame that has focus, so hints reach compose when focus is
  > inside it. If hints appear there but not from the main page, that is a
  > frame-traversal limitation (hints don't cross frames), not a bug.

  Report: still not working. even on frame focus. but working if i expand the frame. also it show hint behind the frame. i dont think that's good.

- [x] **Notion — editor focus**
  - [x] Press `i` on a page with a text block — the block is focused and the caret is placed so typing works immediately.
  - [x] Press `f` on the same page — the editor inputs are detected alongside other clickables.

  Report: still no focus.

- [x] **Google Docs — hint activation**
  - [x] Press `f` — hints on comments/toolbar; activating one actually performs the action (opens a comment, toggles a toolbar item).

  Report: its working but it would be nice if i press `Esc` it will out of focus and clear highlight.

- [x] **YouTube — hint scope and scroll areas**
  - [x] `yf` — hints appear **only** on links (no button/div labels); activating one copies its URL.
  - [x] `f` on a video page — activating a non-link hint (button) still clicks it.
  - [x] `gs` — the cycle never lands on a hidden/invisible pane; each stop is a visible scroll container.

- [x] **Instagram — scroll target**
  - [x] Open a profile page (fixed app shell), press `j`/`k` — the **page/content column** scrolls, not the `<div role="menu">` sidebar.
  - [x] `gs` — the initial stop is the main content scroller, not a menu/suggestion panel.
  - [x] `w` highlights the main scroller on first press.

## Notes for reported failures

Report each failure as: site → step → what happened vs. expected. If a
binding visibly fails (key press does nothing / triggers the wrong command),
check the keymap on the options page first — a mismatch there is not a
content-script bug.

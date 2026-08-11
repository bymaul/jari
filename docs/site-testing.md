# Site testing checklist

Acceptance pass for the Shadow DOM work. Every item lists a concrete action
and the expected result; mark `[x]` as you go.

**Setup:** load the unpacked extension from the repo root
(`chrome://extensions` → Load unpacked, or Firefox `about:debugging`). When the
manifest changes (e.g. `all_frames` was added), **remove and re-add the
extension** — a plain reload does not always pick up manifest edits. Reload
each page after changes.

Common setup: default keybindings, home-row hint set. When a step says
"rebind", use the options page.

See `docs/known-issues.md` for outstanding reports and their current status.

## First pass (Shadow DOM)

- [ ] **Test Gmail**
  - [ ] Click into the Compose "To" field and the message body; type freely — Jari must not run any command while typing.
  - [ ] Press `Esc` inside the body — the field blurs and no Jari command fires.
  - [ ] Press `f` — hints appear on visible email/button links (including inside shadow-based widgets); a hint click opens the mail.
  - [ ] Type a partial query in the search box, then press `j`/`k` — the page scrolls, nothing is typed.
  - [ ] `o` (passthrough) — type `j`/`k` and they reach the page unchanged until the timeout; `Esc` exits early.
  - [ ] `t` opens the omnibar and tab suggestions work.
  - [ ] `gt` tab search works while Gmail is open.

- [ ] **Test Notion**
  - [ ] Click into a page's editor (a block); type freely — no Jari commands fire while typing.
  - [ ] `Esc` in the editor leaves the field without running a Jari command.
  - [ ] Press `f` — hints appear on visible links/buttons across the sidebar and content (Notion renders a lot in shadow trees).
  - [ ] `gs` / `gS` — scroll areas inside shadow containers are discoverable and cycle correctly; `w` highlights the active one.
  - [ ] `j`/`k` scrolls the page (or the resolved scroll area) normally.
  - [ ] `o` passthrough works in the editor (type without Jari interference), `Esc` exits early.

- [ ] **Test Google Docs**
  - [ ] Open a doc and type in the document body — Jari must not intercept a single key.
  - [ ] Use arrow keys / `Esc` inside the document — no Jari command runs.
  - [ ] `j`/`k` outside the body (page focused) scrolls the document page.
  - [ ] Press `f` — hints appear on visible links/buttons (comments, toolbar).
  - [ ] `o` passthrough in the document — keys reach the doc; `Esc` exits early (note: Docs uses `Esc` itself; verify the doc doesn't get a stray command).
  - [ ] Rebind the passthrough key to `z` on the options page; confirm `z` and not `o` triggers it here.

- [ ] **Test YouTube**
  - [ ] On a video page, press `f` — hints appear on visible links (suggestions, comments, description); a hint opens the target in a background tab.
  - [ ] `yf` copies a link URL; `Y` copies title + URL in the configured format.
  - [ ] `gf` opens a link in a background tab and keeps the hints up; picking another label opens a second tab; the used label disappears and cannot be picked twice.
  - [ ] `gs`/`gS` — nested scroll areas (comment pane, description) cycle correctly.
  - [ ] `j`/`k` scroll the page; press `k` while paused — note YouTube's own `j`/`k` seek shortcuts must NOT fire when Jari consumes the key (page keys are intercepted).
  - [ ] `t` omnibar suggests YouTube tabs/history and opens results.
  - [ ] Fullscreen a video with `o`/`I` active — pills hide; leaving fullscreen restores them.
  - [ ] `H`/`L`, `x`, `X` tab commands work from the video page.

## Notes for failures

Report each failure as: site → step → what happened vs. expected. If a
binding visibly fails (key press does nothing / triggers the wrong command),
check the keymap on the options page first — a mismatch there is not a
content-script bug.

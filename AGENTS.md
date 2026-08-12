# Jari development notes

Machine- and repo-specific rules for working in this repository. Read before
editing or running anything that touches the environment.

## The user's browser is sacred

- A real Chromium runs on this machine using `~/.config/chromium`, with the
  jari extension loaded and logged-in sessions (Instagram, etc.).
- **Never** point a test browser at `~/.config/chromium` directly and never
  kill it. For headless testing, copy the profile first and launch against
  the copy:
  `cp -r ~/.config/chromium/Default /tmp/opencode/<name>/Default` (+ `Local State`)
  then `--user-data-dir=/tmp/opencode/<name> --load-extension=/home/maul/extension/jari`.
- **Never** kill processes by broad pattern or name. `pgrep -x chromium` and
  `pkill -f <pattern>` match the user's real browser AND the agent's own
  shell (the pattern appears in the shell's command line, so it kills
  itself). Kill only the headless instance: track its PID at launch, or
  `pgrep -f "remote-debugging-port=<port>"` while excluding the shell PID,
  and confirm the target is not the live browser before `kill`.

## Line endings and tooling quirks

- `.gitattributes` enforces `eol=lf`. If a file picks up CRLF (grep/read
  start misreporting line numbers or content), normalize it first:
  `sed -i 's/\r$//' <file>`.
- Long multi-line output (git diffs, large file reads) can be garbled in
  this environment. When in doubt, write output to a file
  (`git diff ... > /tmp/x`, or generate the diff in python and read the
  file) rather than trusting piped stdout. Verify sizes with `wc -c`.

## Build, test, lint

- Tests: `npm test` (node --test). Lint: `npm run lint`.
- `npm run build:chrome` (or `build:firefox`) regenerates `content/bundle.js`
  and `options/options.bundle.js` from the ES module sources. Commit the
  regenerated bundles together with the source changes.
- After changes, the user reloads the extension in `chrome://extensions`.
  Manifest edits require remove + re-add, not just reload.

## Extension design notes

- `content/hints.js` is the link-hint engine. The occlusion scan
  (`isOccluded`) walks ancestors for clip boxes (carousels, feed columns).
  The root element (`<html>`) and `<body>` are the viewport, not clip boxes,
  and must stay skipped — re-adding them makes hints vanish after scrolling
  on any page that scrolls the window (Instagram). Regression tests in
  `tests/hints.test.js` guard this; keep them green.

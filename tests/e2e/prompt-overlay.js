import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/prompt-overlay.js <profile-dir> <extension-dir>");
  process.exit(2);
}

// The prompt overlay must stay left-aligned and free of focus/active borders
// even on pages whose CSS centers text and styles focused inputs. See
// fixtures/prompt-hostile.html for the page styles.
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(readFileSync(join(here, "fixtures", "prompt-hostile.html")));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/prompt-hostile.html`;

await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();
await cdp.send("Page.navigate", { url });
await wait(2500);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "g");
await key(cdp, "t");
await wait(1200);

const state = await evalValue(cdp, `(() => {
  const host = document.querySelector('.jari-prompt-host');
  const root = (host && host.shadowRoot) || document;
  const sel = (s) => root.querySelector(s);
  const cs = (el) => getComputedStyle(el);
  const overlay = sel('.jari-prompt');
  const input = sel('.jari-prompt input');
  const li = sel('.jari-prompt-list li');
  if (input) input.focus();
  return {
    open: !!overlay && !!input,
    overlayAlign: overlay && cs(overlay).textAlign,
    headerAlign: sel('.jari-prompt-header') && cs(sel('.jari-prompt-header')).textAlign,
    rowAlign: li && cs(li).textAlign,
    rowMargin: li && cs(li).marginBottom,
    inputAlign: input && cs(input).textAlign,
    inputBorder: input && cs(input).borderStyle + ' ' + cs(input).borderWidth,
    inputOutline: input && cs(input).outlineStyle + ' ' + cs(input).outlineWidth,
    inputShadow: input && cs(input).boxShadow,
    inputBg: input && cs(input).backgroundColor,
    inputWidth: input && cs(input).width,
    overlayWidth: overlay && cs(overlay).width,
  };
})()`);

console.log("prompt state:", JSON.stringify(state));

assert(state.open, "prompt did not open");
assert(state.overlayAlign === "left", `overlay must not inherit the page's center alignment (got ${state.overlayAlign})`);
assert(state.headerAlign === "left", `prompt header must be left-aligned (got ${state.headerAlign})`);
assert(state.rowAlign === "left", `completion rows must be left-aligned (got ${state.rowAlign})`);
assert(state.inputAlign === "left", `prompt input must be left-aligned (got ${state.inputAlign})`);
assert(state.inputBorder.split(" ")[0] === "none", `focused prompt input must not show the page's border (got ${state.inputBorder})`);
assert(state.inputOutline.split(" ")[0] === "none", `focused prompt input must not show the page's outline (got ${state.inputOutline})`);
assert(state.inputShadow === "none", `focused prompt input must not show the page's box-shadow (got ${state.inputShadow})`);
assert(state.rowMargin === "0px", `prompt rows must not inherit the page's li margin (got ${state.rowMargin})`);
assert(state.inputBg === "rgb(28, 28, 36)", `prompt input must keep its dark background, not the page's white input (got ${state.inputBg})`);
if (state.inputWidth && state.overlayWidth) {
  const iw = parseFloat(state.inputWidth);
  const ow = parseFloat(state.overlayWidth);
  assert(iw >= ow * 0.9, `prompt input must be full-width, not the page's 210px box (got input ${state.inputWidth} vs overlay ${state.overlayWidth})`);
}

console.log(process.exitCode ? "prompt-overlay: FAIL" : "prompt-overlay: PASS");
cdp.close();
server.close();
process.exit(process.exitCode || 0);

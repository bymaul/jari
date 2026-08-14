import { wait, key, findExtensionId, connectPage, evalValue, assert } from "./harness.js";

const [profileDir, extensionDir] = process.argv.slice(2);
if (!profileDir || !extensionDir) {
  console.error("usage: node tests/e2e/options-hints.js <profile-dir> <extension-dir>");
  process.exit(2);
}

// Regression: `f` on the options page (an extension page in a tab) must draw
// hints locally, activating a hint must land focus, and Escape must cancel.
const extId = await findExtensionId(profileDir, extensionDir);
const { cdp } = await connectPage();

const injected = `
(() => {
  window.__e2e = { sends: [] };
  const origSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = async (msg) => {
    if (msg && msg.type === "COORDINATE_HINTS") {
      const res = await origSend(msg);
      window.__e2e.sends.push({ mode: msg.mode, res });
      return res;
    }
    return origSend(msg);
  };
})();
`;
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: injected });
await cdp.send("Page.navigate", { url: `chrome-extension://${extId}/options/options.html` });
await wait(3000);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(1200);

const send = (await evalValue(cdp, `window.__e2e.sends[window.__e2e.sends.length - 1]`)) || {};
assert(
  send.res && send.res.drawLocally === true,
  `options page COORDINATE_HINTS did not answer drawLocally (got ${JSON.stringify(send)})`,
);

const hintCount = await evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);
assert(hintCount > 0, `options page drew no hints (count=${hintCount})`);

const firstLabel = await evalValue(
  cdp,
  `document.querySelector('.jari-hint') && document.querySelector('.jari-hint').textContent.trim()`,
);
if (firstLabel && typeof firstLabel === "string") {
  for (const char of firstLabel.toLowerCase()) {
    await key(cdp, char);
    await wait(300);
  }
}
const activeTag = await evalValue(
  cdp,
  `document.activeElement && document.activeElement.tagName + '#' + document.activeElement.id`,
);
assert(
  /INPUT|TEXTAREA|DIV|SPAN/.test(String(activeTag)),
  `hint activation did not land focus (active=${JSON.stringify(activeTag)})`,
);

await evalValue(cdp, `document.body.focus()`);
await key(cdp, "f");
await wait(800);
await key(cdp, "Escape");
await wait(400);
const afterEscape = await evalValue(cdp, `document.querySelectorAll('.jari-hint').length`);
assert(afterEscape === 0, `Escape did not clear hints (count=${afterEscape})`);

console.log(process.exitCode ? "options-hints: FAIL" : "options-hints: PASS");
cdp.close();
process.exit(process.exitCode || 0);

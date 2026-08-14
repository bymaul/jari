import { readFile } from "node:fs/promises";
import { createPage, CDP } from "./cdp.js";

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dispatch a single trusted keypress via CDP. The key name for non-printable
// keys (e.g. "Escape") must be passed whole - iterating over its characters
// would type "escape" instead of pressing the Escape key.
export async function key(cdp, ch) {
  const printable = /^[a-zA-Z0-9]$/.test(ch);
  const code = printable ? "Key" + ch.toUpperCase() : ch;
  const vk = ch === "Escape" ? 27 : printable ? ch.toUpperCase().charCodeAt(0) : 0;
  const down = { type: "keyDown", key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 };
  if (printable) down.text = ch;
  await cdp.send("Input.dispatchKeyEvent", down);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 });
}

// The unpacked extension id is registered in the profile's Preferences file
// under extensions.settings as a map of id -> { path }. Match the loaded
// extension by its directory so the tests never hardcode an id.
export async function findExtensionId(profileDir, extensionDir) {
  const prefs = JSON.parse(
    await readFile(`${profileDir}/Default/Preferences`, "utf8"),
  );
  const settings = prefs.extensions && prefs.extensions.settings;
  if (!settings) throw new Error("no extensions.settings in Preferences");
  for (const [id, data] of Object.entries(settings)) {
    if (data.path === extensionDir) return id;
  }
  throw new Error(`extension ${extensionDir} not found in ${profileDir}/Default/Preferences`);
}

export async function connectPage() {
  const target = await createPage();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return { cdp };
}

export async function evalValue(cdp, expression) {
  const res = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      (res.exceptionDetails.exception && res.exceptionDetails.exception.description) ||
        res.exceptionDetails.text,
    );
  }
  return res.result.value;
}

export function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

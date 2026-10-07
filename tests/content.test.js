import "./setup.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

const { settings } = await import("../content/settings.js");
const { commands } = await import("../content/commands.js");
const { keymapDefaults } = await import("../content/keymap.js");
const { handleKeydown, __resetState } = await import("../content/content.js");
const { Overlays, register, touch } = await import("../content/overlays.js");

let shieldActive = false;
const shieldKeys = [];
register("test-shield", {
  isActive: () => shieldActive,
  onKeyDown: (event) => {
    shieldKeys.push(event.key);
  },
  close: () => {
    shieldActive = false;
  },
});

function key(partial = {}) {
  return {
    isTrusted: true,
    key: "j",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      this.claimed = true;
    },
    stopImmediatePropagation() {
      this.claimed = true;
    },
    stopPropagation() {
      this.shielded = true;
    },
    ...partial,
  };
}

function assertClaimed(ev) {
  assert.ok(ev.claimed, "expected the key to be claimed");
}
function assertUnclaimed(ev) {
  assert.ok(!ev.claimed, "expected the key to reach the page");
}

const originals = {};
const spiedCalls = {};
function spyOn(commandName) {
  if (!(commandName in originals)) originals[commandName] = commands[commandName];
  spiedCalls[commandName] = [];
  const original = originals[commandName] || {};
  commands[commandName] = {
    ...original,
    run: (c) => spiedCalls[commandName].push(c),
  };
}
function restoreSpies() {
  for (const [name, original] of Object.entries(originals)) commands[name] = original;
  for (const name of Object.keys(spiedCalls)) delete spiedCalls[name];
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
    timeoutMs: 2000,
    passthroughMs: 1000,
  });
});

afterEach(() => {
  __resetState();
  document.activeElement = null;
  shieldActive = false;
  shieldKeys.length = 0;
  Overlays.closeAll();
  restoreSpies();
});

test("synthetic events are ignored", () => {
  spyOn("scrollDown");
  const ev = key({ isTrusted: false });
  handleKeydown(ev);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(ev);
});

test("a single-key command runs once and claims the key", () => {
  spyOn("scrollDown");
  const ev = key({ key: "j" });
  handleKeydown(ev);
  assert.equal(spiedCalls.scrollDown.length, 1);
  assert.equal(spiedCalls.scrollDown[0].count, 1);
  assert.equal(spiedCalls.scrollDown[0].event, ev);
  assertClaimed(ev);
});

test("a count prefix repeats a command", () => {
  spyOn("scrollDown");
  handleKeydown(key({ key: "2" }));
  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
  assert.equal(spiedCalls.scrollDown[0].count, 2);
});

test("a two-key prefix composes a binding", () => {
  spyOn("goToParent");
  handleKeydown(key({ key: "g" }));
  handleKeydown(key({ key: "u" }));
  assert.equal(spiedCalls.goToParent.length, 1);
  assert.equal(spiedCalls.goToParent[0].count, 1);
});

test("Escape with a pending count cancels the composition", () => {
  spyOn("scrollDown");
  const esc = key({ key: "Escape" });
  handleKeydown(key({ key: "5" }));
  handleKeydown(esc);
  assertClaimed(esc);
  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown[0].count, 1);
});

test("ignore mode passes every key through except its toggle and Escape", () => {
  spyOn("scrollDown");
  const on = key({ key: "I" });
  handleKeydown(on);
  assertClaimed(on);

  const pass = key({ key: "j" });
  handleKeydown(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const off = key({ key: "I" });
  handleKeydown(off);
  assertClaimed(off);

  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
});

test("passthrough lets every key through until Escape", () => {
  spyOn("scrollDown");
  const on = key({ key: "p" });
  handleKeydown(on);
  assertClaimed(on);

  const pass = key({ key: "j" });
  handleKeydown(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const esc = key({ key: "Escape" });
  handleKeydown(esc);
  assertClaimed(esc);

  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
});

test("disabled sites pass every key through except the toggle", () => {
  settings.set({ disabledSites: ["test.example"] });
  spyOn("scrollDown");
  spyOn("toggleSiteEnabled");

  const pass = key({ key: "j" });
  handleKeydown(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const toggle = key({ key: "v", ctrlKey: true, altKey: true });
  handleKeydown(toggle);
  assert.equal(spiedCalls.toggleSiteEnabled.length, 1);
  assertClaimed(toggle);
});

test("keys typed into a form field reach the page, Escape blurs", () => {
  spyOn("scrollDown");
  const calls = [];
  document.activeElement = {
    tagName: "INPUT",
    isContentEditable: false,
    getAttribute: () => null,
    blur: () => calls.push("blur"),
  };

  const pass = key({ key: "j" });
  handleKeydown(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const esc = key({ key: "Escape" });
  handleKeydown(esc);
  assertClaimed(esc);
  assert.deepEqual(calls, ["blur"]);
});

test("keys typed into overlay UI are shielded from the page", () => {
  shieldActive = true;
  touch("test-shield");
  const ev = key({
    key: "/",
    target: { className: "page-node" },
    composedPath: () => [{ className: "jari-prompt-host" }],
  });
  handleKeydown(ev);
  assert.deepEqual(shieldKeys, ["/"]);
  assert.ok(ev.shielded, "expected stopPropagation for Jari UI targets");
});

test("popup help message opens the cheatsheet in the top frame", async () => {
  const { SHOW_HELP_ACTION } = await import("../popup/site.js");
  spyOn("showHelp");
  globalThis.window.top = globalThis.window;
  try {
    const listeners = globalThis.chrome.runtime.onMessage._listeners;
    assert.ok(listeners.length > 0);
    for (const fn of listeners) fn({ action: SHOW_HELP_ACTION });
    assert.equal(spiedCalls.showHelp.length, 1);
  } finally {
    delete globalThis.window.top;
  }
});

test("popup help message is ignored in subframes and for other actions", async () => {
  const { SHOW_HELP_ACTION } = await import("../popup/site.js");
  spyOn("showHelp");
  const listeners = globalThis.chrome.runtime.onMessage._listeners;
  globalThis.window.top = {};
  try {
    for (const fn of listeners) fn({ action: SHOW_HELP_ACTION });
  } finally {
    delete globalThis.window.top;
  }
  for (const fn of listeners) fn({ action: "something-else" });
  for (const fn of listeners) fn(null);
  assert.equal(spiedCalls.showHelp.length, 0);
});

import "./setup.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

const { settings } = await import("../content/settings.js");
const { commands } = await import("../content/commands.js");
const { keymapDefaults } = await import("../content/keymap.js");
const { ui } = await import("../content/ui.js");
const { handleKeydown, __resetState } = await import("../content/content.js");

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
  commands[commandName] = { run: (c) => spiedCalls[commandName].push(c) };
}
function restoreSpies() {
  for (const [name, original] of Object.entries(originals)) commands[name] = original;
  for (const name of Object.keys(spiedCalls)) delete spiedCalls[name];
}

const uiSpies = {};
function spyUi(method) {
  uiSpies[method] = ui[method];
  const calls = [];
  ui[method] = (...args) => calls.push(args);
  return calls;
}
function restoreUi() {
  for (const [method, original] of Object.entries(uiSpies)) ui[method] = original;
  for (const method of Object.keys(uiSpies)) delete uiSpies[method];
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
  restoreSpies();
  restoreUi();
});

test("synthetic events are ignored", () => {
  spyOn("scrollDown");
  const ev = key({ isTrusted: false });
  handleKeydown(ev);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(ev);
});

test("bare modifier keys pass through", () => {
  spyOn("scrollDown");
  const ev = key({ key: "Shift" });
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

test("a bare zero count clamps to one repeat", () => {
  spyOn("scrollDown");
  handleKeydown(key({ key: "0" }));
  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
  assert.equal(spiedCalls.scrollDown[0].count, 1);
});

test("a two-key prefix composes a binding", () => {
  spyOn("goToParent");
  handleKeydown(key({ key: "g" }));
  handleKeydown(key({ key: "u" }));
  assert.equal(spiedCalls.goToParent.length, 1);
  assert.equal(spiedCalls.goToParent[0].count, 1);
});

test("a modifier press does not cancel a pending prefix", () => {
  spyOn("goToParent");
  handleKeydown(key({ key: "g" }));
  handleKeydown(key({ key: "Shift" }));
  handleKeydown(key({ key: "u" }));
  assert.equal(spiedCalls.goToParent.length, 1);
});

test("an unbound prefix completion is a dead key", () => {
  spyOn("scrollDown");
  const ev = key({ key: "q" });
  handleKeydown(key({ key: "g" }));
  handleKeydown(ev);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertClaimed(ev);
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

test("Escape with nothing pending reaches the page", () => {
  spyOn("scrollDown");
  const esc = key({ key: "Escape" });
  handleKeydown(esc);
  assertUnclaimed(esc);
  assert.equal(spiedCalls.scrollDown.length, 0);
});

test("the showcmd readout echoes counts and prefixes", () => {
  const showcmdCalls = spyUi("showcmd");
  const flashCalls = spyUi("flash");
  spyOn("goToParent");
  handleKeydown(key({ key: "2" }));
  assert.deepEqual(showcmdCalls, [["2"]]);
  handleKeydown(key({ key: "g" }));
  assert.deepEqual(showcmdCalls, [["2"], ["2g"]]);
  handleKeydown(key({ key: "u" }));
  assert.deepEqual(flashCalls, [["2gu"]]);
  assert.equal(spiedCalls.goToParent[0].count, 2);
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

test("ignore mode exits on Escape", () => {
  spyOn("scrollDown");
  handleKeydown(key({ key: "I" }));
  handleKeydown(key({ key: "Escape" }));
  handleKeydown(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
});

test("ignore mode respects a rebound toggle key", () => {
  settings.set({ keymap: { ...keymapDefaults, I: "scrollDown", z: "toggleIgnore" } });
  spyOn("scrollDown");

  handleKeydown(key({ key: "z" }));
  handleKeydown(key({ key: "I" }));
  const pass = key({ key: "j" });
  handleKeydown(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  handleKeydown(key({ key: "z" }));
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

test("passthrough exits when the timeout expires", async () => {
  settings.set({ passthroughMs: 30 });
  spyOn("scrollDown");
  handleKeydown(key({ key: "p" }));
  await new Promise((r) => setTimeout(r, 50));
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

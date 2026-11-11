import "./setup.ts";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { CommandContext } from "../content/commands.ts";

const { settings } = await import("../content/settings.ts");
const { commands } = await import("../content/commands.ts");
const { keymapDefaults } = await import("../content/keymap.ts");
const { handleKeydown, shieldOverlayKey, __resetState } =
  await import("../content/content.ts");
const { Prompt } = await import("../content/prompt.ts");
const { Overlays, register, touch } = await import("../content/overlays.ts");

let shieldActive = false;
const shieldKeys: string[] = [];
register("test-shield", {
  isActive: () => shieldActive,
  onKeyDown: (event) => {
    shieldKeys.push(event.key);
  },
  close: () => {
    shieldActive = false;
  },
});

let keyupActive = false;
let keyupHandled = true;
const keyupSeen: string[] = [];
register("test-keyup", {
  isActive: () => keyupActive,
  onKeyDown: () => false,
  onKeyUp: (event) => {
    keyupSeen.push(event.key);
    return keyupHandled;
  },
  close: () => {
    keyupActive = false;
  },
});

interface FakeKey {
  isTrusted: boolean;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  type?: string;
  target?: unknown;
  composedPath?: () => unknown[];
  claimed?: boolean;
  shielded?: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
  stopPropagation(): void;
}

function key(partial: Partial<FakeKey> = {}): FakeKey {
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

function press(ev: FakeKey): void {
  handleKeydown(ev as unknown as KeyboardEvent);
}

function shield(ev: FakeKey): void {
  shieldOverlayKey(ev as unknown as KeyboardEvent);
}

function assertClaimed(ev: FakeKey) {
  assert.ok(ev.claimed, "expected the key to be claimed");
}
function assertUnclaimed(ev: FakeKey) {
  assert.ok(!ev.claimed, "expected the key to reach the page");
}

const originals: Record<string, (typeof commands)[string]> = {};
const spiedCalls: Record<string, CommandContext[]> = {};
function spyOn(commandName: string) {
  if (!(commandName in originals))
    originals[commandName] = commands[commandName];
  spiedCalls[commandName] = [];
  const original = originals[commandName];
  commands[commandName] = {
    ...original,
    run: (c) => spiedCalls[commandName].push(c),
  };
}
function restoreSpies() {
  for (const [name, original] of Object.entries(originals))
    commands[name] = original;
  for (const name of Object.keys(spiedCalls)) delete spiedCalls[name];
}

beforeEach(() => {
  settings.set({
    keymap: { ...keymapDefaults },
    disabledSites: [],
    timeoutMs: 2000,
    passthroughMs: 1000,
    passthroughMode: "reset",
  });
});

afterEach(() => {
  __resetState();
  (globalThis.document as unknown as Record<string, unknown>).activeElement =
    null;
  shieldActive = false;
  shieldKeys.length = 0;
  Overlays.closeAll();
  restoreSpies();
});

test("synthetic events are ignored", () => {
  spyOn("scrollDown");
  const ev = key({ isTrusted: false });
  press(ev);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(ev);
});

test("a single-key command runs once and claims the key", () => {
  spyOn("scrollDown");
  const ev = key({ key: "j" });
  press(ev);
  assert.equal(spiedCalls.scrollDown.length, 1);
  assert.equal(spiedCalls.scrollDown[0].count, 1);
  assert.equal(spiedCalls.scrollDown[0].event, ev);
  assertClaimed(ev);
});

test("a count prefix repeats a command", () => {
  spyOn("scrollDown");
  press(key({ key: "2" }));
  press(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
  assert.equal(spiedCalls.scrollDown[0].count, 2);
});

test("a two-key prefix composes a binding", () => {
  spyOn("goToParent");
  press(key({ key: "g" }));
  press(key({ key: "u" }));
  assert.equal(spiedCalls.goToParent.length, 1);
  assert.equal(spiedCalls.goToParent[0].count, 1);
});

test("Escape with a pending count cancels the composition", () => {
  spyOn("scrollDown");
  const esc = key({ key: "Escape" });
  press(key({ key: "5" }));
  press(esc);
  assertClaimed(esc);
  press(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown[0].count, 1);
});

test("ignore mode passes every key through except its toggle and Escape", () => {
  spyOn("scrollDown");
  const on = key({ key: "I" });
  press(on);
  assertClaimed(on);

  const pass = key({ key: "j" });
  press(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const off = key({ key: "I" });
  press(off);
  assertClaimed(off);

  press(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
});

test("passthrough lets every key through until Escape", () => {
  spyOn("scrollDown");
  const on = key({ key: "p" });
  press(on);
  assertClaimed(on);

  const pass = key({ key: "j" });
  press(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const esc = key({ key: "Escape" });
  press(esc);
  assertClaimed(esc);

  press(key({ key: "j" }));
  assert.equal(spiedCalls.scrollDown.length, 1);
});

test("single-key passthrough mode passes one non-modifier key then exits", () => {
  settings.set({ passthroughMode: "single" });
  spyOn("scrollDown");

  const on = key({ key: "p" });
  press(on);
  assertClaimed(on);

  const mod = key({ key: "Control" });
  press(mod);
  assertUnclaimed(mod);

  const pass = key({ key: "j" });
  press(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const next = key({ key: "j" });
  press(next);
  assert.equal(spiedCalls.scrollDown.length, 1);
  assertClaimed(next);
});

test("fixed passthrough mode does not reset timer on keypress", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  settings.set({ passthroughMode: "fixed", passthroughMs: 1000 });
  spyOn("scrollDown");

  press(key({ key: "p" }));
  t.mock.timers.tick(600);

  const pass = key({ key: "j" });
  press(pass);
  assertUnclaimed(pass);

  t.mock.timers.tick(500);

  const afterExpiry = key({ key: "j" });
  press(afterExpiry);
  assert.equal(spiedCalls.scrollDown.length, 1);
  assertClaimed(afterExpiry);
});

test("reset passthrough mode resets timer on keypress", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  settings.set({ passthroughMode: "reset", passthroughMs: 1000 });
  spyOn("scrollDown");

  press(key({ key: "p" }));
  t.mock.timers.tick(600);

  const pass = key({ key: "j" });
  press(pass);
  assertUnclaimed(pass);

  t.mock.timers.tick(600);

  const pass2 = key({ key: "j" });
  press(pass2);
  assertUnclaimed(pass2);
  assert.equal(spiedCalls.scrollDown.length, 0);

  t.mock.timers.tick(1100);

  const afterExpiry = key({ key: "j" });
  press(afterExpiry);
  assert.equal(spiedCalls.scrollDown.length, 1);
  assertClaimed(afterExpiry);
});

test("disabled sites pass every key through except the toggle", () => {
  settings.set({ disabledSites: ["test.example"] });
  spyOn("scrollDown");
  spyOn("toggleSiteEnabled");

  const pass = key({ key: "j" });
  press(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const toggle = key({ key: "v", ctrlKey: true, altKey: true });
  press(toggle);
  assert.equal(spiedCalls.toggleSiteEnabled.length, 1);
  assertClaimed(toggle);
});

test("keys typed into a form field reach the page, Escape blurs", () => {
  spyOn("scrollDown");
  const calls: string[] = [];
  (globalThis.document as unknown as Record<string, unknown>).activeElement = {
    tagName: "INPUT",
    isContentEditable: false,
    getAttribute: () => null,
    blur: () => calls.push("blur"),
  };

  const pass = key({ key: "j" });
  press(pass);
  assert.equal(spiedCalls.scrollDown.length, 0);
  assertUnclaimed(pass);

  const esc = key({ key: "Escape" });
  press(esc);
  assertClaimed(esc);
  assert.deepEqual(calls, ["blur"]);
});

test("printable keys typed into the omnibar stay in the input and never reach page shortcuts", () => {
  spyOn("scrollDown");

  let capturedInput: unknown = null;
  const realCreateElement = globalThis.document.createElement.bind(
    globalThis.document,
  );
  const origCreateFragment =
    globalThis.document.createDocumentFragment;
  try {
    (globalThis.document as unknown as Record<string, unknown>).createElement =
      (tag: string) => {
        const el: Record<string, unknown> = {
          appendChild: () => {},
          remove: () => {},
          setAttribute: () => {},
          addEventListener: () => {},
          focus: () => {},
          blur: () => {},
          tagName: tag.toUpperCase(),
          type: "",
          value: "",
          className: "",
          classList: {
            add: () => {},
            remove: () => {},
            toggle: () => {},
            contains: () => false,
          },
          style: {},
          children: [],
          parentElement: null,
          ownerDocument: globalThis.document,
          textContent: "",
          insertBefore: () => null,
          shadowRoot: null,
        };
        if (tag === "input") capturedInput = el;
        return el;
      };
    (globalThis.document as unknown as Record<string, unknown>).createDocumentFragment =
      () => ({ appendChild: () => {}, children: [] });

    Prompt.openOmnibar();
    assert.equal(Prompt.isActive(), true);

    const input = capturedInput as HTMLInputElement;
    (globalThis.document as unknown as Record<string, unknown>).activeElement =
      input;

    const calls: string[] = [];
    const ev = {
      isTrusted: true,
      key: "a",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      target: input,
      composedPath: () => [],
      preventDefault() {
        calls.push("preventDefault");
      },
      stopImmediatePropagation() {
        calls.push("stopImmediatePropagation");
      },
      stopPropagation() {
        calls.push("stopPropagation");
      },
    };
    press(ev as unknown as KeyboardEvent);

    assert.equal(
      spiedCalls.scrollDown.length,
      0,
      "page shortcut must not run while typing in the omnibar",
    );
    assert.ok(
      calls.includes("stopPropagation"),
      "expected the key to be stopped from reaching the page",
    );
    assert.ok(
      calls.includes("stopImmediatePropagation"),
      "expected the key to be claimed by the omnibar",
    );
    assert.ok(
      !calls.includes("preventDefault"),
      "expected text insertion to not be blocked",
    );
  } finally {
    (globalThis.document as unknown as Record<string, unknown>).createElement =
      realCreateElement;
    if (origCreateFragment) {
      (globalThis.document as unknown as Record<string, unknown>).createDocumentFragment =
        origCreateFragment;
    } else {
      delete (globalThis.document as unknown as Record<string, unknown>)
        .createDocumentFragment;
    }
    (globalThis.document as unknown as Record<string, unknown>).activeElement =
      null;
    Prompt.close();
    __resetState();
  }
});

test("keys typed into overlay UI are shielded from the page", () => {
  shieldActive = true;
  touch("test-shield");
  const ev = key({
    key: "/",
    target: { className: "page-node" },
    composedPath: () => [{ className: "jari-prompt-host" }],
  });
  press(ev);
  assert.deepEqual(shieldKeys, ["/"]);
  assert.ok(ev.shielded, "expected stopPropagation for Jari UI targets");
});

test("shieldOverlayKey offers keyup to the overlay before shielding", () => {
  keyupActive = true;
  keyupHandled = true;
  keyupSeen.length = 0;
  touch("test-keyup");
  try {
    const ev = key({ key: " ", type: "keyup" });
    shield(ev);
    assert.deepEqual(keyupSeen, [" "]);
    assertUnclaimed(ev);
  } finally {
    keyupActive = false;
  }
});

test("shieldOverlayKey shields keyup the overlay ignores", () => {
  keyupActive = true;
  keyupHandled = false;
  keyupSeen.length = 0;
  touch("test-keyup");
  try {
    const ev = key({ key: " ", type: "keyup" });
    shield(ev);
    assert.deepEqual(keyupSeen, [" "]);
    assertClaimed(ev);
  } finally {
    keyupActive = false;
  }
});

test("shieldOverlayKey shields keyup for overlays without onKeyUp", () => {
  shieldActive = true;
  touch("test-shield");
  const ev = key({ key: " ", type: "keyup" });
  shield(ev);
  assertClaimed(ev);
});

test("popup help message opens the cheatsheet in the top frame", async () => {
  const { SHOW_HELP_ACTION } = await import("../popup/site.ts");
  spyOn("showHelp");
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.top = globalThis.window;
  try {
    const listeners = globalThis.chrome.runtime.onMessage as unknown as {
      _listeners: ((msg: unknown) => void)[];
    };
    assert.ok(listeners._listeners.length > 0);
    for (const fn of listeners._listeners) fn({ action: SHOW_HELP_ACTION });
    assert.equal(spiedCalls.showHelp.length, 1);
  } finally {
    delete win.top;
  }
});

test("popup help message is ignored in subframes and for other actions", async () => {
  const { SHOW_HELP_ACTION } = await import("../popup/site.ts");
  spyOn("showHelp");
  const listeners = globalThis.chrome.runtime.onMessage as unknown as {
    _listeners: ((msg: unknown) => void)[];
  };
  const win = globalThis.window as unknown as Record<string, unknown>;
  win.top = {};
  try {
    for (const fn of listeners._listeners) fn({ action: SHOW_HELP_ACTION });
  } finally {
    delete win.top;
  }
  for (const fn of listeners._listeners) fn({ action: "something-else" });
  for (const fn of listeners._listeners) fn(null);
  assert.equal(spiedCalls.showHelp.length, 0);
});

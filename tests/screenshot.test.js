import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { captureScreenshot } from "../background/tabs.js";
import { handlers } from "../background/handlers.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { keymapDefaults } from "../content/keymap.js";

const { commands, screenshotFilename } = await import("../content/commands.js");
const { ui } = await import("../content/ui.js");

test("screenshotPage is a page command, unbound by default", () => {
  assert.equal(COMMAND_CATALOG.screenshotPage.category, "page");
  assert.ok(COMMAND_CATALOG.screenshotPage.label.length > 0);
  assert.ok(commands.screenshotPage, "expected the command to be registered");
  assert.equal(typeof commands.screenshotPage.run, "function");
  const bound = Object.values(keymapDefaults).includes("screenshotPage");
  assert.equal(bound, false);
});

test("screenshotFilename formats a local timestamp", () => {
  assert.equal(
    screenshotFilename(new Date(2026, 0, 2, 3, 4, 5)),
    "jari-20260102-030405.png",
  );
  assert.match(screenshotFilename(new Date(2026, 11, 31, 23, 59, 59)), /^jari-\d{8}-\d{6}\.png$/);
});

test("captureScreenshot returns the data URL", async () => {
  const saved = globalThis.chrome.tabs.captureVisibleTab;
  globalThis.chrome.tabs.captureVisibleTab = async (windowId, opts) => {
    assert.equal(windowId, 7);
    assert.deepEqual(opts, { format: "png" });
    return "data:image/png;base64,xxx";
  };
  try {
    const res = await captureScreenshot({ tab: { windowId: 7 } });
    assert.deepEqual(res, { ok: true, dataUrl: "data:image/png;base64,xxx" });
  } finally {
    if (saved === undefined) delete globalThis.chrome.tabs.captureVisibleTab;
    else globalThis.chrome.tabs.captureVisibleTab = saved;
  }
});

test("captureScreenshot fails without a tab and on API errors", async () => {
  assert.deepEqual(await captureScreenshot({}), { ok: false });
  const saved = globalThis.chrome.tabs.captureVisibleTab;
  globalThis.chrome.tabs.captureVisibleTab = async () => {
    throw new Error("denied");
  };
  try {
    assert.deepEqual(await captureScreenshot({ tab: { windowId: 7 } }), { ok: false });
  } finally {
    if (saved === undefined) delete globalThis.chrome.tabs.captureVisibleTab;
    else globalThis.chrome.tabs.captureVisibleTab = saved;
  }
  globalThis.chrome.tabs.captureVisibleTab = async () => "";
  try {
    assert.deepEqual(await captureScreenshot({ tab: { windowId: 7 } }), { ok: false });
  } finally {
    if (saved === undefined) delete globalThis.chrome.tabs.captureVisibleTab;
    else globalThis.chrome.tabs.captureVisibleTab = saved;
  }
});

test("handlers exposes captureScreenshot", async () => {
  assert.equal(handlers.captureScreenshot, captureScreenshot);
});

function stubDownload({ response }) {
  const savedSend = globalThis.chrome.runtime.sendMessage;
  const savedCreate = globalThis.document.createElement;
  const savedToast = ui.toast;
  const sent = [];
  const toasts = [];
  let clicked = 0;
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    cb(response);
  };
  ui.toast = (msg) => toasts.push(msg);
  globalThis.document.createElement = (tag) => {
    if (tag !== "a") return savedCreate(tag);
    return {
      href: "",
      download: "",
      click() {
        clicked++;
        assert.match(this.href, /^data:image\/png/);
        assert.match(this.download, /^jari-\d{8}-\d{6}\.png$/);
      },
      remove() {},
    };
  };
  return {
    sent,
    toasts,
    clicked: () => clicked,
    restore() {
      globalThis.chrome.runtime.sendMessage = savedSend;
      globalThis.document.createElement = savedCreate;
      ui.toast = savedToast;
    },
  };
}

test("screenshotPage downloads on success", async () => {
  const stub = stubDownload({ response: { ok: true, dataUrl: "data:image/png;base64,xxx" } });
  try {
    await commands.screenshotPage.run({});
    assert.deepEqual(stub.sent, [{ action: "captureScreenshot" }]);
    assert.equal(stub.clicked(), 1);
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    stub.restore();
  }
});

test("screenshotPage reports background failures", async () => {
  const stub = stubDownload({ response: { ok: false } });
  try {
    await commands.screenshotPage.run({});
    assert.equal(stub.clicked(), 0);
    assert.deepEqual(stub.toasts, ["Screenshot failed"]);
  } finally {
    stub.restore();
  }
});

test("screenshotPage refuses restricted pages without calling the background", async () => {
  const stub = stubDownload({ response: { ok: true, dataUrl: "data:image/png;base64,xxx" } });
  globalThis.location.protocol = "chrome:";
  try {
    await commands.screenshotPage.run({});
    assert.deepEqual(stub.sent, []);
    assert.equal(stub.clicked(), 0);
    assert.deepEqual(stub.toasts, ["Cannot screenshot this page"]);
  } finally {
    delete globalThis.location.protocol;
    stub.restore();
  }
});

test("hideOverlaysForCapture hides Jari UI and restores it", async () => {
  const savedQS = globalThis.document.querySelectorAll;
  const els = [
    { style: { display: "" }, isConnected: true },
    { style: { display: "block" }, isConnected: true },
    { style: { display: "" }, isConnected: false },
  ];
  globalThis.document.querySelectorAll = (sel) =>
    sel === ".jari-status-stack" ? els : [];
  try {
    const restore = ui.hideOverlaysForCapture();
    for (const el of els) assert.equal(el.style.display, "none");
    restore();
    assert.equal(els[0].style.display, "");
    assert.equal(els[1].style.display, "block");
    assert.equal(els[2].style.display, "none");
  } finally {
    globalThis.document.querySelectorAll = savedQS;
  }
});

test("screenshotPage hides overlays around the capture", async () => {
  const stub = stubDownload({ response: { ok: true, dataUrl: "data:image/png;base64,xxx" } });
  const savedQS = globalThis.document.querySelectorAll;
  const savedHide = ui.hideOverlaysForCapture;
  let hiddenDuringCapture = null;
  const els = [{ style: { display: "" }, isConnected: true }];
  globalThis.document.querySelectorAll = (sel) =>
    sel === ".jari-status-stack" ? els : [];
  const realHide = ui.hideOverlaysForCapture;
  ui.hideOverlaysForCapture = () => {
    const restore = realHide();
    return () => {
      hiddenDuringCapture = els[0].style.display;
      restore();
    };
  };
  try {
    await commands.screenshotPage.run({});
    assert.equal(hiddenDuringCapture, "none");
    assert.equal(els[0].style.display, "");
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    globalThis.document.querySelectorAll = savedQS;
    ui.hideOverlaysForCapture = savedHide;
    stub.restore();
  }
});

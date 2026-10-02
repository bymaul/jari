import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { captureScreenshot } from "../background/tabs.js";
import { handlers } from "../background/handlers.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { keymapDefaults } from "../content/keymap.js";

const { commands } = await import("../content/commands.js");
const {
  screenshotFilename,
  sanitizeHostForFilename,
  pageScreenshotFilename,
  normalizeRect,
  scaleRect,
  cropDataUrl,
  computeSlices,
  waitForMediaReady,
  waitForPaint,
  downloadUrl,
  isScreenshotable,
  isScreenshotDataUrl,
} = await import("../content/screenshot.js");
const { sendMessageWithTimeout } = await import("../content/ui.js");
const { Shot, __shotTest } = await import("../content/shot.js");
const { captureFullPage, hideFixedElements } = await import("../content/scrollshot.js");
const { ui } = await import("../content/ui.js");

test("screenshotPage is a page command, bound to gsp by default", () => {
  assert.equal(COMMAND_CATALOG.screenshotPage.category, "page");
  assert.ok(COMMAND_CATALOG.screenshotPage.label.length > 0);
  assert.ok(commands.screenshotPage, "expected the command to be registered");
  assert.equal(typeof commands.screenshotPage.run, "function");
  assert.equal(keymapDefaults.gsp, "screenshotPage");
});

test("screenshotFilename formats a local timestamp", () => {
  assert.equal(
    screenshotFilename(new Date(2026, 0, 2, 3, 4, 5)),
    "jari-20260102-030405.png",
  );
  assert.match(screenshotFilename(new Date(2026, 11, 31, 23, 59, 59)), /^jari-\d{8}-\d{6}\.png$/);
});

test("screenshotFilename includes a sanitized host", () => {
  assert.equal(
    screenshotFilename(new Date(2026, 0, 2, 3, 4, 5), "Example.COM"),
    "jari-example-com-20260102-030405.png",
  );
  assert.equal(
    screenshotFilename(new Date(2026, 0, 2, 3, 4, 5), "sub_domain.example-site.co.id!"),
    "jari-sub-domain-example-site-co-id-20260102-030405.png",
  );
  assert.equal(
    screenshotFilename(new Date(2026, 0, 2, 3, 4, 5), "***"),
    "jari-20260102-030405.png",
  );
  assert.equal(pageScreenshotFilename(new Date(2026, 0, 2, 3, 4, 5)), "jari-test-example-20260102-030405.png");
});

test("sanitizeHostForFilename lowercases, dashes and truncates", () => {
  assert.equal(sanitizeHostForFilename("Example.COM"), "example-com");
  assert.equal(sanitizeHostForFilename("a__b!!c"), "a-b-c");
  assert.equal(sanitizeHostForFilename(""), "");
  assert.equal(sanitizeHostForFilename(null), "");
  assert.equal(sanitizeHostForFilename("a".repeat(100)).length, 40);
});

test("waitForMediaReady resolves when nothing is pending", async () => {
  const savedImages = globalThis.document.images;
  const savedFonts = globalThis.document.fonts;
  const savedInnerHeight = globalThis.window.innerHeight;
  globalThis.document.images = [{ complete: true }];
  globalThis.document.fonts = { ready: Promise.resolve() };
  globalThis.window.innerHeight = 600;
  try {
    await waitForMediaReady({ timeoutMs: 50 });
  } finally {
    if (savedImages === undefined) delete globalThis.document.images;
    else globalThis.document.images = savedImages;
    if (savedFonts === undefined) delete globalThis.document.fonts;
    else globalThis.document.fonts = savedFonts;
    if (savedInnerHeight === undefined) delete globalThis.window.innerHeight;
    else globalThis.window.innerHeight = savedInnerHeight;
  }
});

test("waitForMediaReady waits for in-viewport images up to the timeout", async () => {
  const savedImages = globalThis.document.images;
  const savedFonts = globalThis.document.fonts;
  const savedInnerHeight = globalThis.window.innerHeight;
  const pending = { complete: false, getBoundingClientRect: () => ({ top: 10, bottom: 20 }) };
  const offscreen = { complete: false, getBoundingClientRect: () => ({ top: 900, bottom: 910 }) };
  globalThis.document.images = [pending, offscreen];
  globalThis.document.fonts = undefined;
  globalThis.window.innerHeight = 600;
  const start = Date.now();
  try {
    await waitForMediaReady({ timeoutMs: 250 });
    assert.ok(Date.now() - start >= 200, "expected to wait out the timeout");
    pending.complete = true;
    await waitForMediaReady({ timeoutMs: 250 });
  } finally {
    if (savedImages === undefined) delete globalThis.document.images;
    else globalThis.document.images = savedImages;
    if (savedFonts === undefined) delete globalThis.document.fonts;
    else globalThis.document.fonts = savedFonts;
    if (savedInnerHeight === undefined) delete globalThis.window.innerHeight;
    else globalThis.window.innerHeight = savedInnerHeight;
  }
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
  const hrefs = [];
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
        hrefs.push(this.href);
        assert.match(this.download, /^jari-test-example-\d{8}-\d{6}\.png$/);
      },
      remove() {},
    };
  };
  return {
    sent,
    toasts,
    hrefs,
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
    assert.match(stub.hrefs[0], /^data:image\/png/);
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

test("screenshotRegion is a page command, bound to gsr by default", () => {
  assert.equal(COMMAND_CATALOG.screenshotRegion.category, "page");
  assert.ok(commands.screenshotRegion, "expected the command to be registered");
  assert.equal(typeof commands.screenshotRegion.run, "function");
  assert.equal(keymapDefaults.gsr, "screenshotRegion");
});

test("normalizeRect orders corners and clamps to the viewport", () => {
  assert.deepEqual(normalizeRect({ x: 10, y: 20 }, { x: 30, y: 40 }, 800, 600), {
    left: 10,
    top: 20,
    width: 20,
    height: 20,
  });
  assert.deepEqual(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 20 }, 800, 600), {
    left: 10,
    top: 20,
    width: 20,
    height: 20,
  });
  assert.deepEqual(normalizeRect({ x: -50, y: -50 }, { x: 900, y: 700 }, 800, 600), {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  });
  assert.deepEqual(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 }, 800, 600), {
    left: 10,
    top: 10,
    width: 0,
    height: 0,
  });
});

test("scaleRect scales by devicePixelRatio with sane fallbacks", () => {
  assert.deepEqual(scaleRect({ left: 10, top: 20, width: 30, height: 40 }, 2), {
    x: 20,
    y: 40,
    w: 60,
    h: 80,
  });
  assert.deepEqual(scaleRect({ left: 10, top: 20, width: 30, height: 40 }, 0), {
    x: 10,
    y: 20,
    w: 30,
    h: 40,
  });
});

test("cropDataUrl draws the scaled region to canvas", async () => {
  const savedImage = globalThis.Image;
  const savedCreate = globalThis.document.createElement;
  const drawn = [];
  globalThis.Image = class {
    set src(v) {
      this._src = v;
      if (this.onload) this.onload();
    }
  };
  globalThis.document.createElement = (tag) => {
    if (tag !== "canvas") return savedCreate(tag);
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args) => drawn.push(args),
      }),
      toBlob: (cb) => cb({ cropped: true }),
    };
  };
  try {
    const blob = await cropDataUrl("data:image/png;base64,xxx", {
      left: 10,
      top: 20,
      width: 30,
      height: 40,
    });
    assert.deepEqual(blob, { cropped: true });
    assert.equal(drawn.length, 1);
    assert.deepEqual(drawn[0].slice(1), [10, 20, 30, 40, 0, 0, 30, 40]);
  } finally {
    if (savedImage === undefined) delete globalThis.Image;
    else globalThis.Image = savedImage;
    globalThis.document.createElement = savedCreate;
  }
});

test("cropDataUrl resolves null when canvas is unavailable", async () => {
  const savedImage = globalThis.Image;
  const savedCreate = globalThis.document.createElement;
  globalThis.Image = class {
    set src(v) {
      if (this.onload) this.onload();
    }
  };
  globalThis.document.createElement = () => ({
    getContext: () => null,
  });
  try {
    assert.equal(
      await cropDataUrl("data:image/png;base64,xxx", {
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      }),
      null,
    );
  } finally {
    if (savedImage === undefined) delete globalThis.Image;
    else globalThis.Image = savedImage;
    globalThis.document.createElement = savedCreate;
  }
});

function shotKey(key, extra = {}) {
  return {
    key,
    shiftKey: false,
    preventDefault() {},
    stopImmediatePropagation() {},
    ...extra,
  };
}

function stubShotDom() {
  const saved = {
    create: globalThis.document.createElement,
    toast: ui.toast,
    send: globalThis.chrome.runtime.sendMessage,
    image: globalThis.Image,
    createObjectURL: globalThis.URL.createObjectURL,
    revokeObjectURL: globalThis.URL.revokeObjectURL,
    innerWidth: globalThis.window.innerWidth,
    innerHeight: globalThis.window.innerHeight,
  };
  const toasts = [];
  const sent = [];
  const downloads = [];
  const created = [];
  globalThis.window.innerWidth = 800;
  globalThis.window.innerHeight = 600;
  globalThis.document.createElement = (tag) => {
    if (tag === "a") {
      return {
        href: "",
        download: "",
        click() {
          downloads.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
    }
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {},
        }),
        toBlob: (cb) => cb({ cropped: true }),
      };
    }
    const el = {
      className: "",
      textContent: "",
      style: {},
      appendChild() {},
      remove() {},
      setAttribute() {},
    };
    created.push(el);
    return el;
  };
  ui.toast = (msg) => toasts.push(msg);
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    cb({ ok: true, dataUrl: "data:image/png;base64,xxx" });
  };
  globalThis.Image = class {
    set src(v) {
      if (this.onload) this.onload();
    }
  };
  globalThis.URL.createObjectURL = () => "blob:shot";
  globalThis.URL.revokeObjectURL = () => {};
  return {
    toasts,
    sent,
    downloads,
    created,
    restore() {
      globalThis.document.createElement = saved.create;
      ui.toast = saved.toast;
      globalThis.chrome.runtime.sendMessage = saved.send;
      if (saved.image === undefined) delete globalThis.Image;
      else globalThis.Image = saved.image;
      if (saved.createObjectURL === undefined) delete globalThis.URL.createObjectURL;
      else globalThis.URL.createObjectURL = saved.createObjectURL;
      if (saved.revokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
      else globalThis.URL.revokeObjectURL = saved.revokeObjectURL;
      if (saved.innerWidth === undefined) delete globalThis.window.innerWidth;
      else globalThis.window.innerWidth = saved.innerWidth;
      if (saved.innerHeight === undefined) delete globalThis.window.innerHeight;
      else globalThis.window.innerHeight = saved.innerHeight;
      try {
        Shot.close();
      } catch {}
    },
  };
}

test("shot marks two corners with hjkl and downloads the crop", async () => {
  const stub = stubShotDom();
  try {
    Shot.open();
    assert.equal(Shot.isActive(), true);
    Shot.onKeyDown(shotKey("l"));
    Shot.onKeyDown(shotKey("Enter"));
    Shot.onKeyDown(shotKey("l"));
    Shot.onKeyDown(shotKey("j"));
    Shot.onKeyDown(shotKey("Enter"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(Shot.isActive(), false);
    assert.deepEqual(stub.sent, [{ action: "captureScreenshot" }]);
    assert.equal(stub.downloads.length, 1);
    assert.equal(stub.downloads[0].href, "blob:shot");
    assert.match(stub.downloads[0].download, /^jari-test-example-\d{8}-\d{6}\.png$/);
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    stub.restore();
  }
});

test("shot Escape cancels and empty regions are rejected", async () => {
  const stub = stubShotDom();
  try {
    Shot.open();
    Shot.onKeyDown(shotKey("Escape"));
    assert.equal(Shot.isActive(), false);
    assert.deepEqual(stub.sent, []);

    Shot.open();
    Shot.onKeyDown(shotKey("Enter"));
    Shot.onKeyDown(shotKey("Enter"));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(Shot.isActive(), false);
    assert.deepEqual(stub.sent, []);
    assert.deepEqual(stub.toasts, ["Empty region"]);
  } finally {
    stub.restore();
  }
});

test("shot moves 8px by default and 1px with shift", async () => {
  const stub = stubShotDom();
  try {
    Shot.open();
    assert.deepEqual(__shotTest.state().cursor, { x: 400, y: 300 });
    Shot.onKeyDown(shotKey("l"));
    assert.deepEqual(__shotTest.state().cursor, { x: 416, y: 300 });
    Shot.onKeyDown(shotKey("L"));
    assert.deepEqual(__shotTest.state().cursor, { x: 417, y: 300 });
    Shot.onKeyDown(shotKey("ArrowRight", { shiftKey: true }));
    assert.deepEqual(__shotTest.state().cursor, { x: 418, y: 300 });
    Shot.onKeyDown(shotKey("ArrowDown"));
    assert.deepEqual(__shotTest.state().cursor, { x: 418, y: 316 });
    Shot.onKeyDown(shotKey("1"));
    Shot.onKeyDown(shotKey("0"));
    Shot.onKeyDown(shotKey("j"));
    assert.deepEqual(__shotTest.state().cursor, { x: 418, y: 476 });
  } finally {
    stub.restore();
  }
});

test("shot jumps to edges and center", async () => {
  const stub = stubShotDom();
  try {
    Shot.open();
    Shot.onKeyDown(shotKey("0"));
    assert.deepEqual(__shotTest.state().cursor, { x: 0, y: 300 });
    Shot.onKeyDown(shotKey("$"));
    assert.deepEqual(__shotTest.state().cursor, { x: 799, y: 300 });
    Shot.onKeyDown(shotKey("g"));
    Shot.onKeyDown(shotKey("g"));
    assert.deepEqual(__shotTest.state().cursor, { x: 799, y: 0 });
    Shot.onKeyDown(shotKey("G"));
    assert.deepEqual(__shotTest.state().cursor, { x: 799, y: 599 });
    Shot.onKeyDown(shotKey("M"));
    assert.deepEqual(__shotTest.state().cursor, { x: 400, y: 300 });
  } finally {
    stub.restore();
  }
});

test("shot shows the start mark immediately on Enter", async () => {
  const stub = stubShotDom();
  try {
    Shot.open();
    Shot.onKeyDown(shotKey("l"));
    Shot.onKeyDown(shotKey("Enter"));
    const marks = stub.created.filter((el) => el.className === "jari-shot-mark");
    assert.equal(marks.length, 1);
    assert.notEqual(marks[0].style.display, "none");
    assert.deepEqual(__shotTest.state().start, { x: 416, y: 300 });
    const rects = stub.created.filter((el) => el.className === "jari-shot-rect");
    assert.equal(rects.length, 1);
    assert.equal(rects[0].style.display, "");
    assert.equal(rects[0].style.width, "2px");
    assert.equal(rects[0].style.height, "2px");
    Shot.onKeyDown(shotKey("Backspace"));
    assert.equal(__shotTest.state().start, null);
    assert.equal(marks[0].style.display, "none");
  } finally {
    stub.restore();
  }
});

test("shot captures only after two paint frames", async () => {
  const stub = stubShotDom();
  const savedRaf = globalThis.requestAnimationFrame;
  const queue = [];
  globalThis.requestAnimationFrame = (cb) => {
    queue.push(cb);
    return queue.length;
  };
  try {
    Shot.open();
    Shot.onKeyDown(shotKey("l"));
    Shot.onKeyDown(shotKey("Enter"));
    Shot.onKeyDown(shotKey("l"));
    Shot.onKeyDown(shotKey("j"));
    Shot.onKeyDown(shotKey("Enter"));
    assert.deepEqual(stub.sent, []);
    queue.shift()();
    assert.deepEqual(stub.sent, []);
    queue.shift()();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(stub.sent, [{ action: "captureScreenshot" }]);
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    if (savedRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = savedRaf;
    stub.restore();
  }
});

test("screenshotFullPage is a page command, bound to gss by default", () => {
  assert.equal(COMMAND_CATALOG.screenshotFullPage.category, "page");
  assert.ok(commands.screenshotFullPage, "expected the command to be registered");
  assert.equal(typeof commands.screenshotFullPage.run, "function");
  assert.equal(keymapDefaults.gss, "screenshotFullPage");
});

test("computeSlices pages short content in one slice", () => {
  assert.deepEqual(computeSlices(400, 600), { slices: [0], truncated: false });
  assert.deepEqual(computeSlices(600, 600), { slices: [0], truncated: false });
});

test("computeSlices pages tall content and flags truncation", () => {
  assert.deepEqual(computeSlices(1600, 600), {
    slices: [0, 600, 1200],
    truncated: false,
  });
  const tall = computeSlices(20000, 600);
  assert.equal(tall.slices.length, 8);
  assert.deepEqual(tall.slices[0], 0);
  assert.equal(tall.truncated, true);
  assert.deepEqual(computeSlices(0, 600), { slices: [0], truncated: false });
});

test("hideFixedElements hides fixed/sticky incl. shadow DOM and iframes", () => {
  const savedQS = globalThis.document.querySelectorAll;
  const view = (el) => ({ position: el._pos });
  const ownerDocument = { defaultView: { getComputedStyle: view } };
  const fakeEl = (pos, connected = true) => ({
    matches: () => true,
    style: { visibility: "" },
    isConnected: connected,
    _pos: pos,
    ownerDocument,
  });
  const lightFixed = fakeEl("fixed");
  const lightStatic = fakeEl("static");
  const shadowFixed = fakeEl("sticky");
  const shadowHost = { ...fakeEl("static"), shadowRoot: null };
  shadowHost.shadowRoot = { querySelectorAll: () => [shadowFixed] };
  const frameFixed = fakeEl("fixed");
  const frameEl = { contentDocument: { querySelectorAll: () => [frameFixed] } };
  const goneFixed = fakeEl("fixed", false);
  globalThis.document.querySelectorAll = (sel) => {
    if (sel === "*") return [lightFixed, lightStatic, shadowHost, goneFixed];
    if (String(sel).includes("iframe")) return [frameEl];
    return [];
  };
  try {
    const restore = hideFixedElements();
    assert.equal(lightFixed.style.visibility, "hidden");
    assert.equal(lightStatic.style.visibility, "");
    assert.equal(shadowFixed.style.visibility, "hidden");
    assert.equal(frameFixed.style.visibility, "hidden");
    assert.equal(goneFixed.style.visibility, "hidden");
    restore();
    assert.equal(lightFixed.style.visibility, "");
    assert.equal(shadowFixed.style.visibility, "");
    assert.equal(frameFixed.style.visibility, "");
    assert.equal(goneFixed.style.visibility, "hidden");
  } finally {
    globalThis.document.querySelectorAll = savedQS;
  }
});

function stubScrollshot({ scrollHeight, response } = {}) {
  const saved = {
    create: globalThis.document.createElement,
    toast: ui.toast,
    send: globalThis.chrome.runtime.sendMessage,
    image: globalThis.Image,
    createObjectURL: globalThis.URL.createObjectURL,
    revokeObjectURL: globalThis.URL.revokeObjectURL,
    innerWidth: globalThis.window.innerWidth,
    innerHeight: globalThis.window.innerHeight,
    scrollX: globalThis.window.scrollX,
    scrollY: globalThis.window.scrollY,
    scrollTo: globalThis.window.scrollTo,
    scrollingElement: globalThis.document.scrollingElement,
    querySelectorAll: globalThis.document.querySelectorAll,
  };
  const toasts = [];
  const sent = [];
  const downloads = [];
  const drawn = [];
  const scrolled = [];
  let canvasSize = null;
  globalThis.window.innerWidth = 800;
  globalThis.window.innerHeight = 600;
  globalThis.window.scrollX = 0;
  globalThis.window.scrollY = 0;
  globalThis.window.scrollTo = (x, y) => {
    scrolled.push([x, y]);
    globalThis.window.scrollY = y;
  };
  globalThis.document.scrollingElement = { scrollHeight };
  globalThis.document.querySelectorAll = () => [];
  globalThis.document.createElement = (tag) => {
    if (tag === "a") {
      return {
        href: "",
        download: "",
        click() {
          downloads.push({ href: this.href, download: this.download });
        },
        remove() {},
      };
    }
    if (tag === "canvas") {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: (...args) => drawn.push(args),
        }),
        toBlob(cb) {
          canvasSize = { width: canvas.width, height: canvas.height };
          cb({ stitched: true });
        },
      };
      return canvas;
    }
    return {
      className: "",
      textContent: "",
      style: {},
      appendChild() {},
      remove() {},
      setAttribute() {},
    };
  };
  ui.toast = (msg) => toasts.push(msg);
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    sent.push(msg);
    cb(response);
  };
  globalThis.Image = class {
    set src(v) {
      if (this.onload) this.onload();
    }
  };
  globalThis.URL.createObjectURL = () => "blob:full";
  globalThis.URL.revokeObjectURL = () => {};
  return {
    toasts,
    sent,
    downloads,
    drawn,
    scrolled,
    canvasSize: () => canvasSize,
    restore() {
      globalThis.document.createElement = saved.create;
      ui.toast = saved.toast;
      globalThis.chrome.runtime.sendMessage = saved.send;
      if (saved.image === undefined) delete globalThis.Image;
      else globalThis.Image = saved.image;
      if (saved.createObjectURL === undefined) delete globalThis.URL.createObjectURL;
      else globalThis.URL.createObjectURL = saved.createObjectURL;
      if (saved.revokeObjectURL === undefined) delete globalThis.URL.revokeObjectURL;
      else globalThis.URL.revokeObjectURL = saved.revokeObjectURL;
      if (saved.innerWidth === undefined) delete globalThis.window.innerWidth;
      else globalThis.window.innerWidth = saved.innerWidth;
      if (saved.innerHeight === undefined) delete globalThis.window.innerHeight;
      else globalThis.window.innerHeight = saved.innerHeight;
      globalThis.window.scrollX = saved.scrollX;
      globalThis.window.scrollY = saved.scrollY;
      if (saved.scrollTo === undefined) delete globalThis.window.scrollTo;
      else globalThis.window.scrollTo = saved.scrollTo;
      if (saved.scrollingElement === undefined) delete globalThis.document.scrollingElement;
      else globalThis.document.scrollingElement = saved.scrollingElement;
      globalThis.document.querySelectorAll = saved.querySelectorAll;
    },
  };
}

test("captureFullPage stitches viewport slices and restores scroll", async () => {
  const stub = stubScrollshot({
    scrollHeight: 1600,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  try {
    await captureFullPage({ settleMs: 5 });
    assert.equal(stub.sent.length, 3);
    assert.deepEqual(stub.sent[0], { action: "captureScreenshot" });
    assert.equal(stub.drawn.length, 3);
    assert.deepEqual(
      stub.drawn.map((args) => args[2]),
      [0, 600, 1200],
    );
    assert.deepEqual(stub.canvasSize(), { width: 800, height: 1600 });
    assert.deepEqual(stub.scrolled[0], [0, 0]);
    assert.deepEqual(stub.scrolled.slice(-1), [[0, 0]]);
    assert.equal(stub.downloads.length, 1);
    assert.equal(stub.downloads[0].href, "blob:full");
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    stub.restore();
  }
});

test("captureFullPage truncates very tall pages", async () => {
  const stub = stubScrollshot({
    scrollHeight: 20000,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  try {
    await captureFullPage({ settleMs: 5 });
    assert.equal(stub.sent.length, 8);
    assert.deepEqual(stub.toasts, ["Saved partial screenshot"]);
  } finally {
    stub.restore();
  }
});

test("captureFullPage reports capture failures and restores scroll", async () => {
  const stub = stubScrollshot({
    scrollHeight: 1600,
    response: { ok: false },
  });
  try {
    await captureFullPage({ settleMs: 5 });
    assert.equal(stub.sent.length, 1);
    assert.deepEqual(stub.toasts, ["Screenshot failed"]);
    assert.deepEqual(stub.scrolled.slice(-1), [[0, 0]]);
    assert.equal(stub.downloads.length, 0);
  } finally {
    stub.restore();
  }
});

test("captureFullPage refuses restricted pages", async () => {
  const stub = stubScrollshot({
    scrollHeight: 1600,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  globalThis.location.protocol = "chrome:";
  try {
    await captureFullPage({ settleMs: 5 });
    assert.deepEqual(stub.sent, []);
    assert.deepEqual(stub.toasts, ["Cannot screenshot this page"]);
  } finally {
    delete globalThis.location.protocol;
    stub.restore();
  }
});

test("captureFullPage hides headers that stick mid-capture", async () => {
  const stub = stubScrollshot({
    scrollHeight: 1200,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  const header = {
    matches: () => true,
    style: { visibility: "" },
    isConnected: true,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          position: globalThis.window.scrollY > 0 ? "fixed" : "static",
        }),
      },
    },
  };
  const seenAtCapture = [];
  globalThis.document.querySelectorAll = (sel) => (sel === "*" ? [header] : []);
  const innerSend = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    seenAtCapture.push(header.style.visibility);
    innerSend(msg, cb);
  };
  try {
    await captureFullPage({ settleMs: 5 });
    assert.deepEqual(seenAtCapture, ["", "hidden"]);
    assert.equal(header.style.visibility, "");
    assert.deepEqual(stub.toasts, ["Saved screenshot"]);
  } finally {
    stub.restore();
  }
});

test("isScreenshotable fails closed when the protocol is unreadable", () => {
  const saved = globalThis.location;
  globalThis.location = {
    get protocol() {
      throw new Error("denied");
    },
  };
  try {
    assert.equal(isScreenshotable(), false);
  } finally {
    globalThis.location = saved;
  }
});

test("isScreenshotDataUrl accepts only PNG data URLs", () => {
  assert.equal(isScreenshotDataUrl("data:image/png;base64,xxx"), true);
  assert.equal(isScreenshotDataUrl("data:image/jpeg;base64,xxx"), false);
  assert.equal(isScreenshotDataUrl("http://example.com/x.png"), false);
  assert.equal(isScreenshotDataUrl(""), false);
  assert.equal(isScreenshotDataUrl(null), false);
});

test("screenshotFilename falls back on invalid dates", () => {
  assert.match(screenshotFilename(new Date(NaN)), /^jari-\d{8}-\d{6}\.png$/);
  assert.match(screenshotFilename("tomorrow"), /^jari-\d{8}-\d{6}\.png$/);
});

test("downloadUrl rejects non-download URLs and bad filenames", () => {
  const savedCreate = globalThis.document.createElement;
  let created = 0;
  globalThis.document.createElement = () => {
    created++;
    return { click() {}, remove() {} };
  };
  try {
    assert.equal(downloadUrl("http://example.com/x.png"), false);
    assert.equal(downloadUrl(null), false);
    assert.equal(created, 0);
  } finally {
    globalThis.document.createElement = savedCreate;
  }
});

test("waitForPaint resolves when rAF never fires", async () => {
  const savedRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => {};
  try {
    await waitForPaint({ timeoutMs: 30 });
  } finally {
    if (savedRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = savedRaf;
  }
});

test("computeSlices clamps non-finite inputs", () => {
  assert.deepEqual(computeSlices(NaN, 600), { slices: [0], truncated: false });
  assert.deepEqual(computeSlices(1600, 600, Infinity), {
    slices: [0, 600, 1200],
    truncated: false,
  });
  const zeroStep = computeSlices(1600, 0);
  assert.equal(zeroStep.slices.length, 8);
  assert.equal(zeroStep.truncated, false);
  const tall = computeSlices(20000, Infinity);
  assert.equal(tall.slices.length, 8);
  assert.equal(tall.truncated, true);
});

test("normalizeRect returns a zero rect for invalid inputs", () => {
  const zero = { left: 0, top: 0, width: 0, height: 0 };
  assert.deepEqual(normalizeRect(null, { x: 1, y: 1 }, 800, 600), zero);
  assert.deepEqual(
    normalizeRect({ x: NaN, y: 0 }, { x: 1, y: 1 }, 800, 600),
    zero,
  );
  assert.deepEqual(
    normalizeRect({ x: 0, y: 0 }, { x: 1, y: 1 }, NaN, 600),
    zero,
  );
});

test("scaleRect falls back on invalid rects and ratios", () => {
  assert.deepEqual(scaleRect(null, 2), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(
    scaleRect({ left: 10, top: 20, width: 30, height: 40 }, -1),
    { x: 10, y: 20, w: 30, h: 40 },
  );
});

test("cropDataUrl rejects bad data URLs and oversized rects", async () => {
  const rect = { left: 0, top: 0, width: 10, height: 10 };
  assert.equal(await cropDataUrl("http://example.com/x.png", rect), null);
  assert.equal(await cropDataUrl(null, rect), null);
  assert.equal(
    await cropDataUrl("data:image/png;base64,xxx", {
      left: 0,
      top: 0,
      width: 0,
      height: 10,
    }),
    null,
  );
  assert.equal(
    await cropDataUrl("data:image/png;base64,xxx", {
      left: 0,
      top: 0,
      width: 9000,
      height: 10,
    }),
    null,
  );
});

test("cropDataUrl times out when the image never loads", async () => {
  const savedImage = globalThis.Image;
  globalThis.Image = class {
    set src(v) {
      this._src = v;
    }
  };
  try {
    assert.equal(
      await cropDataUrl(
        "data:image/png;base64,xxx",
        { left: 0, top: 0, width: 10, height: 10 },
        { timeoutMs: 30 },
      ),
      null,
    );
  } finally {
    if (savedImage === undefined) delete globalThis.Image;
    else globalThis.Image = savedImage;
  }
});

test("sendMessageWithTimeout resolves null when the background hangs", async () => {
  const savedSend = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = () => {};
  try {
    assert.equal(await sendMessageWithTimeout("captureScreenshot", {}, 30), null);
  } finally {
    globalThis.chrome.runtime.sendMessage = savedSend;
  }
});

test("captureScreenshot rejects non-integer window IDs", async () => {
  const saved = globalThis.chrome.tabs.captureVisibleTab;
  let called = 0;
  globalThis.chrome.tabs.captureVisibleTab = async () => {
    called++;
    return "data:image/png;base64,xxx";
  };
  try {
    assert.deepEqual(await captureScreenshot({ tab: { windowId: "7" } }), {
      ok: false,
    });
    assert.deepEqual(await captureScreenshot({ tab: { windowId: 1.5 } }), {
      ok: false,
    });
    assert.equal(called, 0);
  } finally {
    if (saved === undefined) delete globalThis.chrome.tabs.captureVisibleTab;
    else globalThis.chrome.tabs.captureVisibleTab = saved;
  }
});

test("captureScreenshot rejects non-data-URL captures", async () => {
  const saved = globalThis.chrome.tabs.captureVisibleTab;
  globalThis.chrome.tabs.captureVisibleTab = async () => "http://example.com/x.png";
  try {
    assert.deepEqual(await captureScreenshot({ tab: { windowId: 7 } }), {
      ok: false,
    });
  } finally {
    if (saved === undefined) delete globalThis.chrome.tabs.captureVisibleTab;
    else globalThis.chrome.tabs.captureVisibleTab = saved;
  }
});

test("screenshotPage runs sequential captures after a success", async () => {
  const stub = stubDownload({
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  try {
    await commands.screenshotPage.run({});
    await commands.screenshotPage.run({});
    assert.equal(stub.clicked(), 2);
    assert.deepEqual(stub.toasts, ["Saved screenshot", "Saved screenshot"]);
  } finally {
    stub.restore();
  }
});

test("screenshotPage rejects a second overlapping capture", async () => {
  const savedSend = globalThis.chrome.runtime.sendMessage;
  const savedCreate = globalThis.document.createElement;
  const savedToast = ui.toast;
  const toasts = [];
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    gate.then(() => cb({ ok: true, dataUrl: "data:image/png;base64,xxx" }));
  };
  globalThis.document.createElement = (tag) => {
    if (tag !== "a") return savedCreate(tag);
    return { href: "", download: "", click() {}, remove() {} };
  };
  ui.toast = (msg) => toasts.push(msg);
  try {
    const first = commands.screenshotPage.run({});
    await new Promise((r) => setTimeout(r, 10));
    await commands.screenshotPage.run({});
    assert.deepEqual(toasts, ["Already capturing"]);
    release();
    await first;
    assert.deepEqual(toasts, ["Already capturing", "Saved screenshot"]);
  } finally {
    globalThis.chrome.runtime.sendMessage = savedSend;
    globalThis.document.createElement = savedCreate;
    ui.toast = savedToast;
  }
});

test("captureFullPage refuses pages that exceed the canvas budget", async () => {
  const stub = stubScrollshot({
    scrollHeight: 600,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  const savedWidth = globalThis.window.innerWidth;
  globalThis.window.innerWidth = 9000;
  try {
    await captureFullPage({ settleMs: 5 });
    assert.deepEqual(stub.sent, []);
    assert.deepEqual(stub.toasts, ["Screenshot too large"]);
    assert.equal(stub.downloads.length, 0);
  } finally {
    globalThis.window.innerWidth = savedWidth;
    stub.restore();
  }
});

test("captureFullPage aborts when the page will not scroll", async () => {
  const stub = stubScrollshot({
    scrollHeight: 1600,
    response: { ok: true, dataUrl: "data:image/png;base64,xxx" },
  });
  globalThis.window.scrollTo = (x, y) => {
    stub.scrolled.push([x, y]);
  };
  try {
    await captureFullPage({ settleMs: 5 });
    assert.deepEqual(stub.toasts, ["Screenshot failed"]);
    assert.deepEqual(stub.scrolled.slice(-1), [[0, 0]]);
    assert.equal(stub.downloads.length, 0);
  } finally {
    stub.restore();
  }
});

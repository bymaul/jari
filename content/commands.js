import { Url } from "../shared/url.js";
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";
import { Scroll, scrollHeightOf, clientHeightOf, scrollPosOf, isFrame, frameWindow, frameViewportHeight, focusTarget } from "./scroll.js";
import { Prompt } from "./prompt.js";
import { Help } from "./help.js";
import { Hints } from "./hints.js";
import { Find } from "./find.js";
import { Visual } from "./visual.js";
import { COMMAND_CATALOG } from "./catalog.js";

const PAGE_RATIO = 0.9;
const HALF_RATIO = 0.5;

let ignoreToggle = () => {};
let passthroughEnter = () => {};
export function setModeActions({ ignore, passthrough } = {}) {
  if (ignore) ignoreToggle = ignore;
  if (passthrough) passthroughEnter = passthrough;
}

function getScrollElement() {
  return Scroll.getTarget();
}

let smoothState = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function smoothScrollBy(el, x, y) {
  if (smoothState === null || smoothState.el !== el) {
    smoothState = { el, x: 0, y: 0, rafId: null };
  }
  smoothState.x += x;
  smoothState.y += y;
  if (smoothState.rafId === null) {
    smoothState.rafId = requestAnimationFrame(smoothScrollStep);
  }
}

function smoothScrollStep() {
  if (!smoothState) return;
  smoothState.rafId = null;
  const { el } = smoothState;
  const pendingX = smoothState.x;
  const pendingY = smoothState.y;
  if (pendingX === 0 && pendingY === 0) {
    smoothState = null;
    return;
  }
  if (Math.abs(pendingX) < 1 && Math.abs(pendingY) < 1) {
    el.scrollBy({ left: pendingX, top: pendingY, behavior: "instant" });
    smoothState = null;
    return;
  }

  const CAP = 80;
  const moveX =
    pendingX !== 0
      ? Math.sign(pendingX) * Math.max(1, Math.min(CAP, Math.round(Math.abs(pendingX) * 0.4)))
      : 0;
  const moveY =
    pendingY !== 0
      ? Math.sign(pendingY) * Math.max(1, Math.min(CAP, Math.round(Math.abs(pendingY) * 0.4)))
      : 0;

  const before = scrollPosOf(el);
  el.scrollBy({ left: moveX, top: moveY, behavior: "instant" });
  const after = scrollPosOf(el);
  const dx = after.x - before.x;
  const dy = after.y - before.y;

  if (dx !== 0) smoothState.x -= dx;
  else smoothState.x = 0;
  if (dy !== 0) smoothState.y -= dy;
  else smoothState.y = 0;

  smoothState.rafId = requestAnimationFrame(smoothScrollStep);
}

function shouldSmooth() {
  return settings.isSmoothScroll() && !prefersReducedMotion();
}

function scrollFrame(frame, apply) {
  const w = frameWindow(frame);
  if (w) {
    try {
      apply(w);
      return true;
    } catch {}
  }
  focusTarget(frame);
  try {
    apply(frame);
  } catch {}
  return false;
}

function scrollFrameBy(frame, x, y) {
  return scrollFrame(frame, (t) =>
    t.scrollBy({ left: x, top: y, behavior: "instant" }),
  );
}

function scrollFrameTo(frame, top) {
  return scrollFrame(frame, (t) => t.scrollTo({ top, behavior: "instant" }));
}

function scrollBy({ x = 0, y = 0, count = 1 }) {
  const el = getScrollElement();
  if (isFrame(el)) {
    scrollFrameBy(el, x * count, y * count);
    return;
  }
  if (shouldSmooth()) {
    smoothScrollBy(el, x * count, y * count);
  } else {
    el.scrollBy({ left: x * count, top: y * count, behavior: "instant" });
  }
}

async function copyToClipboard(text, message) {
  await ui.copyText(text);
  ui.toast(message);
}

function copyTitleAndUrlText() {
  return settings.getCopyFormat() === "markdown"
    ? `[${document.title}](${location.href})`
    : `${document.title}\n${location.href}`;
}

function readClipboardText() {
  let text = "";
  try {
    ui.withHiddenTextarea((ta) => {
      if (document.execCommand("paste")) text = ta.value.trim();
    });
  } catch {}
  if (text) return Promise.resolve(text);
  try {
    return navigator.clipboard.readText().then((t) => t.trim()).catch(() => "");
  } catch {
    return Promise.resolve("");
  }
}

function scrollPageBy(ratio, direction) {
  return (c) => {
    const el = getScrollElement();
    const h = isFrame(el) ? frameViewportHeight(el) : clientHeightOf(el);
    scrollBy({ y: direction * h * ratio, count: c.count });
  };
}

async function openClipboardWith(action) {
  const text = await readClipboardText();
  if (!text) return ui.toast("Clipboard empty");
  const res = await sendMessage(action, { url: text });
  if (res && !res.ok) ui.toast("Not a URL");
}

function goTo(urlFn) {
  const target = urlFn(location.href);
  if (Url.isSamePath(target, location.href)) return ui.toast("Already at root");
  sendMessage("navigate", { url: target });
}

export const commands = {

  scrollDown: { ...COMMAND_CATALOG.scrollDown, run: (c) => scrollBy({ y: settings.getScrollStep(), count: c.count }) },
  scrollUp: { ...COMMAND_CATALOG.scrollUp, run: (c) => scrollBy({ y: -settings.getScrollStep(), count: c.count }) },
  scrollLeft: { ...COMMAND_CATALOG.scrollLeft, run: (c) => scrollBy({ x: -settings.getScrollStep(), count: c.count }) },
  scrollRight: { ...COMMAND_CATALOG.scrollRight, run: (c) => scrollBy({ x: settings.getScrollStep(), count: c.count }) },
  scrollToTop: {
    ...COMMAND_CATALOG.scrollToTop,
    run: () => {
      const el = getScrollElement();
      if (isFrame(el)) {
        scrollFrameTo(el, 0);
        return;
      }
      if (shouldSmooth()) smoothScrollBy(el, 0, -scrollPosOf(el).y);
      else el.scrollTo({ top: 0, behavior: "instant" });
    },
  },
  scrollToBottom: {
    ...COMMAND_CATALOG.scrollToBottom,
    run: () => {
      const el = getScrollElement();
      if (isFrame(el)) {
        const w = frameWindow(el);
        let target;
        try {
          if (w) {
            const doc = w.document.scrollingElement || w.document.documentElement;
            target = Math.max(0, doc.scrollHeight - w.innerHeight);
          } else {
            target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
          }
        } catch {
          target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
        }
        scrollFrameTo(el, target);
        return;
      }
      const target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
      if (shouldSmooth()) smoothScrollBy(el, 0, target - scrollPosOf(el).y);
      else el.scrollTo({ top: target, behavior: "instant" });
    },
  },
  scrollPageDown: { ...COMMAND_CATALOG.scrollPageDown, run: scrollPageBy(PAGE_RATIO, 1) },
  scrollPageUp: { ...COMMAND_CATALOG.scrollPageUp, run: scrollPageBy(PAGE_RATIO, -1) },
  scrollHalfPageDown: { ...COMMAND_CATALOG.scrollHalfPageDown, run: scrollPageBy(HALF_RATIO, 1) },
  scrollHalfPageUp: { ...COMMAND_CATALOG.scrollHalfPageUp, run: scrollPageBy(HALF_RATIO, -1) },
  cycleScrollFrame: { ...COMMAND_CATALOG.cycleScrollFrame, run: () => Scroll.cycle() },
  resetScrollTarget: { ...COMMAND_CATALOG.resetScrollTarget, run: () => Scroll.reset() },
  zoomIn: { ...COMMAND_CATALOG.zoomIn, run: () => sendMessage("zoomBy", { delta: 0.1 }) },
  zoomOut: { ...COMMAND_CATALOG.zoomOut, run: () => sendMessage("zoomBy", { delta: -0.1 }) },

  newTab: { ...COMMAND_CATALOG.newTab, run: () => sendMessage("createTab") },
  newIncognitoTab: { ...COMMAND_CATALOG.newIncognitoTab, run: () => sendMessage("openIncognitoTab") },
  closeTab: { ...COMMAND_CATALOG.closeTab, run: (c) => sendMessage("closeTab", { count: c.count }) },
  restoreTab: { ...COMMAND_CATALOG.restoreTab, run: (c) => sendMessage("restoreTab", { count: c.count }) },
  openClipboard: { ...COMMAND_CATALOG.openClipboard, run: () => openClipboardWith("navigate") },
  openClipboardBackground: {
    ...COMMAND_CATALOG.openClipboardBackground,
    run: () => openClipboardWith("openInBackgroundTab"),
  },
  previousTab: { ...COMMAND_CATALOG.previousTab, run: (c) => sendMessage("previousTab", { count: c.count }) },
  nextTab: { ...COMMAND_CATALOG.nextTab, run: (c) => sendMessage("nextTab", { count: c.count }) },
  goToFirstTab: { ...COMMAND_CATALOG.goToFirstTab, run: () => sendMessage("goToFirstTab") },
  goToLastTab: { ...COMMAND_CATALOG.goToLastTab, run: () => sendMessage("goToLastTab") },
  moveTabToWindow: {
    ...COMMAND_CATALOG.moveTabToWindow,
    run: async () => {
      const res = await sendMessage("moveTabToWindow");
      if (!res || !res.ok) {
        ui.toast("No window available");
        return;
      }
      if (res.movedToWindow) ui.toast("Moved to window");
      else if (res.movedToNewWindow) ui.toast("Moved to new window");
      else if (res.needWindowChoice) Prompt.chooseWindow(res);
      else if (res.needWindowChoice === false) ui.toast("No other window");
      else ui.toast("No window available");
    },
  },
  moveTabLeft: { ...COMMAND_CATALOG.moveTabLeft, run: () => sendMessage("moveTabLeft") },
  moveTabRight: { ...COMMAND_CATALOG.moveTabRight, run: () => sendMessage("moveTabRight") },
  duplicateTab: { ...COMMAND_CATALOG.duplicateTab, run: () => sendMessage("duplicateTab") },
  togglePin: { ...COMMAND_CATALOG.togglePin, run: () => sendMessage("togglePin") },
  toggleMute: { ...COMMAND_CATALOG.toggleMute, run: () => sendMessage("toggleMute") },
  openOmnibar: { ...COMMAND_CATALOG.openOmnibar, run: () => Prompt.openOmnibar() },
  openOmnibarIncognito: { ...COMMAND_CATALOG.openOmnibarIncognito, run: () => Prompt.openIncognito() },
  reloadTab: { ...COMMAND_CATALOG.reloadTab, run: () => sendMessage("reloadTab", { bypassCache: false }) },
  forceReload: { ...COMMAND_CATALOG.forceReload, run: () => sendMessage("reloadTab", { bypassCache: true }) },
  goToParent: { ...COMMAND_CATALOG.goToParent, run: () => goTo(Url.parentUrlOf) },
  goToRoot: { ...COMMAND_CATALOG.goToRoot, run: () => goTo(Url.rootUrlOf) },
  editUrl: {
    ...COMMAND_CATALOG.editUrl,
    run: () => Prompt.openEditUrl(),
  },

  goBack: { ...COMMAND_CATALOG.goBack, run: () => sendMessage("goBack") },
  goForward: { ...COMMAND_CATALOG.goForward, run: () => sendMessage("goForward") },

  copyUrl: { ...COMMAND_CATALOG.copyUrl, run: () => copyToClipboard(location.href, "Copied") },
  copyTitleAndUrl: { ...COMMAND_CATALOG.copyTitleAndUrl, run: () => copyToClipboard(copyTitleAndUrlText(), "Copied") },

  toggleIgnore: { ...COMMAND_CATALOG.toggleIgnore, run: () => ignoreToggle() },
  passthroughKeys: { ...COMMAND_CATALOG.passthroughKeys, run: () => passthroughEnter() },
  toggleSiteEnabled: { ...COMMAND_CATALOG.toggleSiteEnabled, run: () => settings.toggleSiteEnabled() },

  hintClick: { ...COMMAND_CATALOG.hintClick, run: () => Hints.open("click") },
  hintOpen: { ...COMMAND_CATALOG.hintOpen, run: () => Hints.open("open") },
  hintOpenBackground: { ...COMMAND_CATALOG.hintOpenBackground, run: () => Hints.open("openBackground") },
  hintInput: { ...COMMAND_CATALOG.hintInput, run: () => Hints.open("input") },
  hintYank: { ...COMMAND_CATALOG.hintYank, run: () => Hints.open("yank") },

  findText: { ...COMMAND_CATALOG.findText, run: () => Find.open() },
  findNext: { ...COMMAND_CATALOG.findNext, run: (c) => Find.next(c.count, false) },
  findPrev: { ...COMMAND_CATALOG.findPrev, run: (c) => Find.next(c.count, true) },

  enterVisual: { ...COMMAND_CATALOG.enterVisual, run: () => Visual.enter("visual") },
  enterVisualLine: { ...COMMAND_CATALOG.enterVisualLine, run: () => Visual.enter("line") },

  showHelp: { ...COMMAND_CATALOG.showHelp, run: () => Help.open() },
  openSettings: { ...COMMAND_CATALOG.openSettings, run: () => sendMessage("openSettings") },
  openExtensions: { ...COMMAND_CATALOG.openExtensions, run: () => sendMessage("openExtensions") },
};

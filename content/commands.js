import { Url } from "../shared/url.js";
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";
import { Scroll } from "./scroll.js";
import { Prompt } from "./prompt.js";
import { Help } from "./help.js";
import { Hints } from "./hints.js";
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

function scrollHeightOf(el) {
  return el === window
    ? (document.scrollingElement || document.documentElement || document.body).scrollHeight
    : el.scrollHeight;
}

function clientHeightOf(el) {
  return el === window ? window.innerHeight : el.clientHeight;
}

let smoothState = null;

function scrollPosOf(el) {
  return el === window
    ? { x: window.scrollX, y: window.scrollY }
    : { x: el.scrollLeft, y: el.scrollTop };
}

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

function scrollBy({ x = 0, y = 0, count = 1 }) {
  const el = getScrollElement();
  if (settings.isSmoothScroll() && !prefersReducedMotion()) {
    smoothScrollBy(el, x * count, y * count);
  } else {
    el.scrollBy({ left: x * count, top: y * count, behavior: "instant" });
  }
}

async function copyToClipboard(text, message) {
  await ui.copyText(text);
  ui.toast(message);
}

function copyTitleUrlText() {
  return settings.getCopyFormat() === "markdown"
    ? `[${document.title}](${location.href})`
    : `${document.title}\n${location.href}`;
}

function pasteClipboard() {
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

export const commands = {

  scrollDown: { ...COMMAND_CATALOG.scrollDown, run: (c) => scrollBy({ y: settings.getScrollStep(), count: c.count }) },
  scrollUp: { ...COMMAND_CATALOG.scrollUp, run: (c) => scrollBy({ y: -settings.getScrollStep(), count: c.count }) },
  scrollLeft: { ...COMMAND_CATALOG.scrollLeft, run: (c) => scrollBy({ x: -settings.getScrollStep(), count: c.count }) },
  scrollRight: { ...COMMAND_CATALOG.scrollRight, run: (c) => scrollBy({ x: settings.getScrollStep(), count: c.count }) },
  scrollTop: {
    ...COMMAND_CATALOG.scrollTop,
    run: () => {
      const el = getScrollElement();
      if (settings.isSmoothScroll() && !prefersReducedMotion()) smoothScrollBy(el, 0, -scrollPosOf(el).y);
      else el.scrollTo({ top: 0, behavior: "instant" });
    },
  },
  scrollBottom: {
    ...COMMAND_CATALOG.scrollBottom,
    run: () => {
      const el = getScrollElement();
      const target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
      if (settings.isSmoothScroll() && !prefersReducedMotion()) smoothScrollBy(el, 0, target - scrollPosOf(el).y);
      else el.scrollTo({ top: target, behavior: "instant" });
    },
  },
  scrollPageDown: {
    ...COMMAND_CATALOG.scrollPageDown,
    run: (c) => scrollBy({ y: clientHeightOf(getScrollElement()) * PAGE_RATIO, count: c.count }),
  },
  scrollPageUp: {
    ...COMMAND_CATALOG.scrollPageUp,
    run: (c) => scrollBy({ y: -clientHeightOf(getScrollElement()) * PAGE_RATIO, count: c.count }),
  },
  scrollHalfPageDown: {
    ...COMMAND_CATALOG.scrollHalfPageDown,
    run: (c) => scrollBy({ y: clientHeightOf(getScrollElement()) * HALF_RATIO, count: c.count }),
  },
  scrollHalfPageUp: {
    ...COMMAND_CATALOG.scrollHalfPageUp,
    run: (c) => scrollBy({ y: -clientHeightOf(getScrollElement()) * HALF_RATIO, count: c.count }),
  },
  cycleScrollArea: { ...COMMAND_CATALOG.cycleScrollArea, run: () => Scroll.cycle() },
  resetScrollArea: { ...COMMAND_CATALOG.resetScrollArea, run: () => Scroll.resetToGlobal() },
  showScrollArea: { ...COMMAND_CATALOG.showScrollArea, run: () => Scroll.showHighlight() },
  zoomIn: { ...COMMAND_CATALOG.zoomIn, run: () => sendMessage("zoomBy", { delta: 0.1 }) },
  zoomOut: { ...COMMAND_CATALOG.zoomOut, run: () => sendMessage("zoomBy", { delta: -0.1 }) },

  newTab: { ...COMMAND_CATALOG.newTab, run: () => sendMessage("createTab") },
  closeTab: { ...COMMAND_CATALOG.closeTab, run: (c) => sendMessage("closeTab", { count: c.count }) },
  restoreTab: { ...COMMAND_CATALOG.restoreTab, run: (c) => sendMessage("restoreTab", { count: c.count }) },
  pasteOpen: {
    ...COMMAND_CATALOG.pasteOpen,
    run: async () => {
      const text = await pasteClipboard();
      if (!text) return ui.toast("Clipboard empty");
      const res = await sendMessage("navigate", { url: text });
      if (res && !res.ok) ui.toast("Not a URL");
    },
  },
  pasteOpenBackground: {
    ...COMMAND_CATALOG.pasteOpenBackground,
    run: async () => {
      const text = await pasteClipboard();
      if (!text) return ui.toast("Clipboard empty");
      const res = await sendMessage("openInBackgroundTab", { url: text });
      if (res && !res.ok) ui.toast("Not a URL");
    },
  },
  previousTab: { ...COMMAND_CATALOG.previousTab, run: (c) => sendMessage("previousTab", { count: c.count }) },
  nextTab: { ...COMMAND_CATALOG.nextTab, run: (c) => sendMessage("nextTab", { count: c.count }) },
  firstTab: { ...COMMAND_CATALOG.firstTab, run: () => sendMessage("firstTab") },
  lastTab: { ...COMMAND_CATALOG.lastTab, run: () => sendMessage("lastTab") },
  splitMerge: {
    ...COMMAND_CATALOG.splitMerge,
    run: async () => {
      const res = await sendMessage("splitOrMerge");
      if (res && res.needMerge) Prompt.openMerge(res);
    },
  },
  moveTabLeft: { ...COMMAND_CATALOG.moveTabLeft, run: () => sendMessage("moveTabLeft") },
  moveTabRight: { ...COMMAND_CATALOG.moveTabRight, run: () => sendMessage("moveTabRight") },
  duplicateTab: { ...COMMAND_CATALOG.duplicateTab, run: () => sendMessage("duplicateTab") },
  togglePin: { ...COMMAND_CATALOG.togglePin, run: () => sendMessage("togglePin") },
  toggleMute: { ...COMMAND_CATALOG.toggleMute, run: () => sendMessage("toggleMute") },
  tabSearch: { ...COMMAND_CATALOG.tabSearch, run: () => Prompt.open() },
  omnibar: { ...COMMAND_CATALOG.omnibar, run: () => Prompt.openOmnibar() },
  reloadTab: { ...COMMAND_CATALOG.reloadTab, run: () => sendMessage("reloadTab", { bypassCache: false }) },
  hardReload: { ...COMMAND_CATALOG.hardReload, run: () => sendMessage("reloadTab", { bypassCache: true }) },
  goUp: {
    ...COMMAND_CATALOG.goUp,
    run: () => {
      const target = Url.parentUrlOf(location.href);
      if (Url.isSamePath(target, location.href)) return ui.toast("Already at root");
      sendMessage("navigate", { url: target });
    },
  },
  goToRoot: {
    ...COMMAND_CATALOG.goToRoot,
    run: () => {
      const target = Url.rootUrlOf(location.href);
      if (Url.isSamePath(target, location.href)) return ui.toast("Already at root");
      sendMessage("navigate", { url: target });
    },
  },
  editUrl: {
    ...COMMAND_CATALOG.editUrl,
    run: () => Prompt.openEditUrl(),
  },

  historyBack: { ...COMMAND_CATALOG.historyBack, run: () => sendMessage("historyBack") },
  historyForward: { ...COMMAND_CATALOG.historyForward, run: () => sendMessage("historyForward") },

  copyUrl: { ...COMMAND_CATALOG.copyUrl, run: () => copyToClipboard(location.href, "Copied") },
  copyTitleUrl: { ...COMMAND_CATALOG.copyTitleUrl, run: () => copyToClipboard(copyTitleUrlText(), "Copied") },

  toggleIgnore: { ...COMMAND_CATALOG.toggleIgnore, run: () => ignoreToggle() },
  passthrough: { ...COMMAND_CATALOG.passthrough, run: () => passthroughEnter() },
  toggleDisabled: { ...COMMAND_CATALOG.toggleDisabled, run: () => settings.toggleDisabled() },

  hintClick: { ...COMMAND_CATALOG.hintClick, run: () => Hints.open("click") },
  hintOpen: { ...COMMAND_CATALOG.hintOpen, run: () => Hints.open("open") },
  hintOpenBackground: { ...COMMAND_CATALOG.hintOpenBackground, run: () => Hints.open("openBackground") },
  hintInput: { ...COMMAND_CATALOG.hintInput, run: () => Hints.open("input") },

  showHelp: { ...COMMAND_CATALOG.showHelp, run: () => Help.open() },
  openOptions: { ...COMMAND_CATALOG.openOptions, run: () => sendMessage("openOptions") },
};

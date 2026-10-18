import { Url } from "../shared/url.ts";
import { settings } from "./settings.ts";
import { sendMessage, sendMessageWithTimeout, ui } from "./ui.ts";
import { Scroll, scrollHeightOf, clientHeightOf, scrollPosOf, isFrame, frameWindow, frameViewportHeight, frameScrollBox, focusTarget, smoothScrollBy, shouldSmooth } from "./scroll.ts";
import { Prompt } from "./prompt.js";
import { TabManager } from "./tab-manager.js";
import { Help } from "./help.js";
import { Hints, setCommandRunner } from "./hints.js";
import { Find } from "./find.js";
import { Visual } from "./visual.js";
import { COMMAND_CATALOG } from "./catalog.ts";
import { goPage } from "./page-nav.ts";
import type { CommandDef, CommandName } from "./catalog.ts";
import { Palette } from "./palette.js";
import { Shot } from "./shot.js";
import { captureFullPage } from "./scrollshot.js";
import { downloadUrl, waitForPaint, isScreenshotable, isScreenshotDataUrl } from "./screenshot.ts";

const PAGE_RATIO = 0.9;
const HALF_RATIO = 0.5;

/** Runtime shape of a dispatched command: the catalog def plus its runner. */
export interface CommandContext {
  count: number;
  /** Synthetic dispatch (help banner, ignore-mode remap) has no key event. */
  event?: KeyboardEvent;
}

interface CommandImpl extends CommandDef {
  run(c: CommandContext): void;
}

let ignoreToggle: () => void = () => {};
let passthroughEnter: () => void = () => {};
export function setModeActions(
  { ignore, passthrough }: { ignore?: () => void; passthrough?: () => void } = {},
): void {
  if (ignore) ignoreToggle = ignore;
  if (passthrough) passthroughEnter = passthrough;
}

function getScrollElement(): Element | Window {
  return Scroll.getTarget();
}

function scrollFrame(
  frame: Element,
  apply: (target: Window | Element) => void,
): boolean {
  const w = frameWindow(frame as HTMLIFrameElement);
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

function frameScrollBehavior(): ScrollBehavior {
  return shouldSmooth() ? "smooth" : "instant";
}

function scrollFrameBy(frame: Element, x: number, y: number): boolean {
  let box: Element | null;
  try {
    box = frameScrollBox(frame as HTMLIFrameElement);
  } catch {
    box = null;
  }
  if (box) {
    if (shouldSmooth()) {
      smoothScrollBy(box, x, y);
    } else {
      try {
        box.scrollBy({ left: x, top: y, behavior: "instant" });
      } catch {}
    }
    return true;
  }
  return scrollFrame(frame, (t) =>
    t.scrollBy({ left: x, top: y, behavior: frameScrollBehavior() }),
  );
}

function scrollFrameTo(frame: Element, top: number): boolean {
  let box: Element | null;
  try {
    box = frameScrollBox(frame as HTMLIFrameElement);
  } catch {
    box = null;
  }
  if (box) {
    if (shouldSmooth()) {
      let pos;
      try {
        pos = box.scrollTop || 0;
      } catch {
        pos = 0;
      }
      smoothScrollBy(box, 0, top - pos);
    } else {
      try {
        box.scrollTo({ top, behavior: "instant" });
      } catch {}
    }
    return true;
  }
  return scrollFrame(frame, (t) =>
    t.scrollTo({ top, behavior: frameScrollBehavior() }),
  );
}

function scrollBy({
  x = 0,
  y = 0,
  count = 1,
}: { x?: number; y?: number; count?: number }): void {
  const el = getScrollElement();
  if (isFrame(el)) {
    scrollFrameBy(el as Element, x * count, y * count);
    return;
  }
  if (shouldSmooth()) {
    smoothScrollBy(el, x * count, y * count);
  } else {
    el.scrollBy({ left: x * count, top: y * count, behavior: "instant" });
  }
}

async function copyToClipboard(text: string, message: string): Promise<void> {
  const ok = await ui.copyText(text);
  ui.toast(ok ? message : "Copy failed");
}

function copyTitleAndUrlText(): string {
  return settings.getCopyFormat() === "markdown"
    ? `[${document.title}](${location.href})`
    : `${document.title}\n${location.href}`;
}

function readClipboardText(): Promise<string> {
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

function scrollPageBy(
  ratio: number,
  direction: number,
): (c: CommandContext) => void {
  return (c) => {
    const el = getScrollElement();
    const h = isFrame(el)
      ? frameViewportHeight(el as HTMLIFrameElement)
      : clientHeightOf(el);
    scrollBy({ y: direction * h * ratio, count: c.count });
  };
}

async function openClipboardWith(
  action: "navigate" | "openInBackgroundTab",
): Promise<void> {
  const text = await readClipboardText();
  if (!text) return ui.toast("Clipboard empty");
  const res = await sendMessage(action, { url: text });
  if (res && !res.ok) ui.toast("Not a URL");
}

function isFirefox(): boolean {
  try {
    return /firefox/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

function addonsBlockedHint(): string {
  let mac = false;
  try {
    mac =
      /mac/i.test(navigator.platform || "") ||
      /mac/i.test(navigator.userAgent || "");
  } catch {}
  return mac
    ? "Firefox blocks this - press Cmd+Shift+A for Add-ons Manager"
    : "Firefox blocks this - press Ctrl+Shift+A for Add-ons Manager";
}

function goTo(urlFn: (href: string) => string): void {
  const target = urlFn(location.href);
  if (Url.isSamePath(target, location.href)) return ui.toast("Already at root");
  sendMessage("navigate", { url: target });
}

let screenshotCapturing = false;

async function screenshotPage(): Promise<void> {
  if (!isScreenshotable()) {
    ui.toast("Cannot screenshot this page");
    return;
  }
  if (screenshotCapturing) {
    ui.toast("Already capturing");
    return;
  }
  screenshotCapturing = true;
  const restore = ui.hideOverlaysForCapture();
  await waitForPaint();
  let res;
  try {
    res = await sendMessageWithTimeout("captureScreenshot");
  } finally {
    try {
      restore();
    } catch {}
  }
  try {
    if (!res || !res.ok || !isScreenshotDataUrl(res.dataUrl)) {
      ui.toast("Screenshot failed");
      return;
    }
    ui.toast(downloadUrl(res.dataUrl) ? "Saved screenshot" : "Screenshot failed");
  } finally {
    screenshotCapturing = false;
  }
}

function cmd(
  name: CommandName,
  run: (c: CommandContext) => void,
): CommandImpl {
  return { ...COMMAND_CATALOG[name], run };
}

export const commands: Record<string, CommandImpl> = {

  scrollDown: cmd("scrollDown", (c) => scrollBy({ y: settings.getScrollStep(), count: c.count })),
  scrollUp: cmd("scrollUp", (c) => scrollBy({ y: -settings.getScrollStep(), count: c.count })),
  scrollLeft: cmd("scrollLeft", (c) => scrollBy({ x: -settings.getScrollStep(), count: c.count })),
  scrollRight: cmd("scrollRight", (c) => scrollBy({ x: settings.getScrollStep(), count: c.count })),
  scrollToTop: {
    ...COMMAND_CATALOG.scrollToTop,
    run: () => {
      const el = getScrollElement();
      if (isFrame(el)) {
        scrollFrameTo(el as Element, 0);
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
        let box;
        try {
          box = frameScrollBox(el as HTMLIFrameElement);
        } catch {
          box = null;
        }
        const w = box ? null : frameWindow(el as HTMLIFrameElement);
        let target;
        try {
          if (box) {
            target = Math.max(0, (box.scrollHeight || 0) - (box.clientHeight || 0));
          } else if (w) {
            const doc = w.document.scrollingElement || w.document.documentElement;
            target = Math.max(0, doc.scrollHeight - w.innerHeight);
          } else {
            target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
          }
        } catch {
          target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
        }
        scrollFrameTo(el as Element, target);
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
  cycleScrollFrame: { ...COMMAND_CATALOG.cycleScrollFrame, run: (c) => Scroll.cycle(c.count) },
  resetScrollTarget: { ...COMMAND_CATALOG.resetScrollTarget, run: () => Scroll.reset() },
  zoomIn: { ...COMMAND_CATALOG.zoomIn, run: () => sendMessage("zoomBy", { delta: 0.1 }) },
  zoomOut: { ...COMMAND_CATALOG.zoomOut, run: () => sendMessage("zoomBy", { delta: -0.1 }) },

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
      const res: {
        ok?: boolean;
        movedToWindow?: boolean;
        movedToNewWindow?: boolean;
        needWindowChoice?: boolean;
      } | null = await sendMessage("moveTabToWindow");
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
  openTabManager: { ...COMMAND_CATALOG.openTabManager, run: () => TabManager.open() },
  openOmnibar: { ...COMMAND_CATALOG.openOmnibar, run: () => Prompt.openOmnibar() },
  openOmnibarIncognito: { ...COMMAND_CATALOG.openOmnibarIncognito, run: () => Prompt.openIncognito() },
  reloadTab: { ...COMMAND_CATALOG.reloadTab, run: () => sendMessage("reloadTab", { bypassCache: false }) },
  forceReload: { ...COMMAND_CATALOG.forceReload, run: () => sendMessage("reloadTab", { bypassCache: true }) },
  goToParent: { ...COMMAND_CATALOG.goToParent, run: () => goTo(Url.parentUrlOf) },
  goToRoot: { ...COMMAND_CATALOG.goToRoot, run: () => goTo(Url.rootUrlOf) },
  nextPage: { ...COMMAND_CATALOG.nextPage, run: () => goPage("next") },
  prevPage: { ...COMMAND_CATALOG.prevPage, run: () => goPage("prev") },
  editUrl: {
    ...COMMAND_CATALOG.editUrl,
    run: () => Prompt.openEditUrl(),
  },

  goBack: { ...COMMAND_CATALOG.goBack, run: () => sendMessage("goBack") },
  goForward: { ...COMMAND_CATALOG.goForward, run: () => sendMessage("goForward") },

  copyUrl: { ...COMMAND_CATALOG.copyUrl, run: () => copyToClipboard(location.href, "Copied") },
  copyTitleAndUrl: { ...COMMAND_CATALOG.copyTitleAndUrl, run: () => copyToClipboard(copyTitleAndUrlText(), "Copied") },
  screenshotPage: cmd("screenshotPage", () => screenshotPage()),
  screenshotFullPage: cmd("screenshotFullPage", () => captureFullPage()),
  screenshotRegion: cmd("screenshotRegion", () => {
    if (!isScreenshotable()) {
      ui.toast("Cannot screenshot this page");
      return;
    }
    Shot.open();
  }),

  toggleIgnore: { ...COMMAND_CATALOG.toggleIgnore, run: () => ignoreToggle() },
  passthroughKeys: { ...COMMAND_CATALOG.passthroughKeys, run: () => passthroughEnter() },
  toggleSiteEnabled: { ...COMMAND_CATALOG.toggleSiteEnabled, run: () => settings.toggleSiteEnabled() },

  hintClick: { ...COMMAND_CATALOG.hintClick, run: () => Hints.open("click") },
  hintOpen: { ...COMMAND_CATALOG.hintOpen, run: () => Hints.open("open") },
  hintOpenBackground: { ...COMMAND_CATALOG.hintOpenBackground, run: () => Hints.open("openBackground") },
  hintOpenCurrent: { ...COMMAND_CATALOG.hintOpenCurrent, run: () => Hints.open("openCurrent") },
  hintInput: { ...COMMAND_CATALOG.hintInput, run: () => Hints.open("input") },
  hintYank: { ...COMMAND_CATALOG.hintYank, run: () => Hints.open("yank") },
  hintYankText: { ...COMMAND_CATALOG.hintYankText, run: () => Hints.open("yankText") },

  findText: { ...COMMAND_CATALOG.findText, run: () => Find.open() },
  findNext: { ...COMMAND_CATALOG.findNext, run: (c) => Find.next(c.count, false) },
  findPrev: { ...COMMAND_CATALOG.findPrev, run: (c) => Find.next(c.count, true) },

  enterVisual: { ...COMMAND_CATALOG.enterVisual, run: () => Visual.enter("visual") },
  enterVisualLine: { ...COMMAND_CATALOG.enterVisualLine, run: () => Visual.enter("line") },

  showHelp: { ...COMMAND_CATALOG.showHelp, run: () => Help.open() },
  showCommandPalette: {
    ...COMMAND_CATALOG.showCommandPalette,
    run: () => Palette.open(commands),
  },
  openSettings: { ...COMMAND_CATALOG.openSettings, run: () => sendMessage("openSettings") },
  openExtensions: {
    ...COMMAND_CATALOG.openExtensions,
    run: async () => {
      const res = await sendMessage("openExtensions");
      if (res && res.ok) return;
      ui.toast(isFirefox() ? addonsBlockedHint() : "Cannot open extensions page");
    },
  },
};

setCommandRunner((commandName: string, event: KeyboardEvent) => {
  const cmd = commands[commandName];
  if (!cmd) return;
  cmd.run({ count: 1, event });
});

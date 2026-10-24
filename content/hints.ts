import { sendMessage, ui } from "./ui.ts";
import { register, touch } from "./overlays.ts";
import { settings } from "./settings.ts";
import {
  normalizeCharset,
  genLabels,
  updateHintText,
  createHintsHost,
  layoutHints,
  holderOrigin,
  hintHomeRect,
} from "./hint-layer.ts";
import { COMMAND_CATALOG } from "./catalog.ts";
import {
  isEditable,
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  getRealRect,
  getHintRect,
  translateRect,
  isElementClickable,
  isExplicitlyRequested,
  isFrameElement,
  filterAncestors,
  filterOverlapElements,
  getHref,
  isOpenableLink,
  collectElements,
  collectIframeElements,
  collectMutationRoots,
  collectNewcomers,
  getClickableElements,
  listElements,
  prioritizeForViewport,
  viewportScore,
} from "./hints-elements.ts";
import type { JariElement, RectLike } from "./hints-elements.ts";
import type { HintLink } from "./hint-layer.ts";
import type { CommandName } from "./catalog.ts";

type HintEntry = {
  el: Element;
  label: string;
  hintEl: HintLink;
  hiddenByViewport: boolean;
  rendered: string | null;
};

const MAX_HINTS = 800;
const REGENERATE_DELAY = 150;

let active = false;
let hintsHost: HTMLDivElement | null = null;
let holder: HTMLElement | null = null;
let elements: JariElement[] = [];
let hints: HintEntry[] = [];
let prefix = "";
let mode = "click";
let multipleHits = false;
let resizeHandler: (() => void) | null = null;
let mutationObserver: MutationObserver | null = null;
let regenerateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRoots: Node[] = [];
let forceFullRegen = false;
let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
let hintPill: HTMLDivElement | null = null;
let spaceHeld = false;

let commandRunner: ((command: string, event: KeyboardEvent) => void) | null =
  null;
export function setCommandRunner(
  fn: (command: string, event: KeyboardEvent) => void,
): void {
  commandRunner = fn;
}

const NON_HINT_SCROLL_COMMANDS = new Set([
  "cycleScrollFrame",
  "resetScrollTarget",
]);

export function classifyHintKey(
  key: string,
  {
    labels = [],
    prefix = "",
    keymap = null,
    charset = "",
  }: {
    labels?: string[];
    prefix?: string;
    keymap?: Record<string, string> | null;
    charset?: string;
  } = {},
):
  | { type: "ignore" }
  | { type: "scroll"; command: string }
  | { type: "activate"; prefix: string; label: string }
  | { type: "filter"; prefix: string } {
  if (key.length !== 1) return { type: "ignore" };
  const command =
    (keymap && keymap[key]) || (key === "g" ? "scrollToTop" : null);
  const entry = (command && COMMAND_CATALOG[command as CommandName]) || null;
  if (
    entry &&
    entry.category === "scrolling" &&
    !NON_HINT_SCROLL_COMMANDS.has(command!)
  ) {
    return { type: "scroll", command: command! };
  }
  const lower = key.toLowerCase();
  if (!charset.includes(lower)) return { type: "ignore" };
  const next = prefix + lower.toUpperCase();
  if (labels.includes(next))
    return { type: "activate", prefix: next, label: next };
  return { type: "filter", prefix: next };
}

export { normalizeCharset, genLabels };

function showHintPill() {
  if (hintPill) return;
  try {
    hintPill = document.createElement("div");
    hintPill.className = "jari-pill";
    hintPill.textContent = "hint";
    ui.statusContainer().appendChild(hintPill);
  } catch {}
}

function hideHintPill() {
  if (!hintPill) return;
  try {
    hintPill.remove();
  } catch {}
  hintPill = null;
}

function hasJariClass(node: Node | null): boolean {
  try {
    if (!node || node.nodeType !== 1) return false;
    const classes = (node as Element).classList;
    if (classes) {
      for (const c of classes) {
        if (typeof c === "string" && c.startsWith("jari-")) return true;
      }
    }
    if ((node as Element).closest) {
      return !!((node as Element).closest(
        "[class^='jari-'], [class*=' jari-']",
      ) as Element);
    }
  } catch {}
  return false;
}

function isOwnMutation(mutation: MutationRecord): boolean {
  try {
    const nodes = [
      ...(mutation.addedNodes || []),
      ...(mutation.removedNodes || []),
    ];
    const allOwn = (list: Node[]) =>
      list.every((n: Node) => n.nodeType !== 1 || hasJariClass(n));
    if (
      mutation.target &&
      mutation.target.nodeType === 1 &&
      hasJariClass(mutation.target)
    ) {
      return allOwn(nodes);
    }
    return nodes.length > 0 && allOwn(nodes);
  } catch {}
  return false;
}

function mergeNewcomers(roots: Node[]): void {
  let newcomers: Element[];
  try {
    const known = new Set<Element>(elements);
    newcomers = filterOverlapElements(collectNewcomers(roots, mode, known));
    for (const el of collectIframeElements(mode)) {
      if (!known.has(el) && !newcomers.includes(el)) newcomers.push(el);
    }
  } catch {
    newcomers = [];
  }
  let alive: JariElement[];
  try {
    alive = elements.filter((el) => {
      try {
        return el.isConnected !== false;
      } catch {
        return false;
      }
    });
  } catch {
    alive = [];
  }
  if (newcomers.length === 0 && alive.length === elements.length) {
    repositionHints();
    refresh();
    return;
  }
  const merged = filterAncestors([...alive, ...newcomers]);
  replaceElements(merged);
}

function replaceElements(next: Element[]): void {
  if (next.length === 0) {
    close();
    ui.toast("No hints");
    return;
  }
  const capped =
    next.length > MAX_HINTS
      ? prioritizeForViewport(next).slice(0, MAX_HINTS)
      : next;
  if (capped.length !== next.length) {
    ui.toast(`Too many hints (${capped.length} shown)`);
  }
  elements = capped;
  render();
  if (holder && !spaceHeld) holder.style.display = "";
  refresh();
}

function scheduleRegenerate(
  mutations?: MutationRecord[] | null,
  force?: boolean,
): void {
  if (mutations && mutations.length > 0) {
    for (const m of mutations) collectMutationRoots(m, pendingRoots);
  }
  if (force) forceFullRegen = true;
  if (regenerateTimer) return;
  regenerateTimer = setTimeout(() => {
    regenerateTimer = null;
    if (!active) {
      pendingRoots = [];
      forceFullRegen = false;
      return;
    }
    const roots = pendingRoots;
    pendingRoots = [];
    const forced = forceFullRegen;
    forceFullRegen = false;
    if (!forced && roots.length > 0) {
      mergeNewcomers(roots);
      return;
    }
    if (!forced && prefix) {
      repositionHints();
      refresh();
      return;
    }
    replaceElements(collectElements(mode));
  }, REGENERATE_DELAY);
}

function isActive(): boolean {
  return active;
}

function focusFrame(el: Element): void {
  ui.focusFrameElement(el as HTMLIFrameElement);
  try {
    ui.toast("Focused frame");
  } catch {}
}

function focusInput(el: HTMLElement): void {
  try {
    el.scrollIntoView({ block: "center", inline: "center" });
  } catch {}
  ui.safeFocus(el, { preventScroll: true });
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const input = el as HTMLInputElement;
    try {
      const len = input.value ? input.value.length : 0;
      if (
        typeof input.select === "function" &&
        input.type !== "checkbox" &&
        input.type !== "radio"
      ) {
        input.select();
      } else if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(len, len);
      }
    } catch {}
  } else if (el.isContentEditable) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }
}

function refresh(): void {
  if (!active) return;
  for (const h of hints) {
    if (h.hiddenByViewport || (prefix && !h.label.startsWith(prefix))) {
      if (h.rendered !== "0") {
        h.hintEl.style.opacity = "0";
        h.hintEl.style.display = "none";
        h.rendered = "0";
      }
      continue;
    }
    if (!prefix) {
      if (h.rendered !== "1") {
        h.hintEl.style.opacity = "1";
        h.hintEl.style.display = "";
        h.hintEl.classList.remove("jari-hint-hidden");
        updateHintText(h.hintEl, h.label, "");
        h.rendered = "1";
      }
      continue;
    }
    if (h.rendered !== `m${prefix}`) {
      h.hintEl.style.opacity = "1";
      h.hintEl.style.display = "";
      updateHintText(h.hintEl, h.label, prefix);
      h.rendered = `m${prefix}`;
    }
  }
}

function currentHintRect(el: Element): RectLike | null {
  let frame: Element | null;
  try {
    frame = (el as JariElement)._jariFrame || null;
  } catch {
    frame = null;
  }
  let base: DOMRect | null;
  try {
    base = getRealRect(el);
  } catch {
    return null;
  }
  if (!base) return null;
  if (!frame) return base;
  let frect;
  try {
    frect = frame.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!frect) return null;
  return translateRect(
    base,
    (frect.left || 0) + (frame.clientLeft || 0),
    (frect.top || 0) + (frame.clientTop || 0),
  );
}

function repositionHints(): void {
  if (!active || !holder) return;
  let origin: { top: number; left: number };
  try {
    origin = holderOrigin(holder);
  } catch {
    return;
  }
  const bof = {
    top: origin.top + window.pageYOffset,
    left: origin.left + window.pageXOffset,
  };
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  for (const h of hints) {
    const r = currentHintRect(h.el);
    if (!r || r.width <= 0 || r.height <= 0) {
      h.hiddenByViewport = true;
      continue;
    }
    const home = hintHomeRect(r, bof);
    try {
      h.hintEl.style.left = `${home.left}px`;
      h.hintEl.style.top = `${home.top}px`;
    } catch {}
    h.hiddenByViewport = !(
      r.bottom > 0 &&
      r.top < vh &&
      r.right > 0 &&
      r.left < vw
    );
  }
}

function scheduleReposition(): void {
  if (repositionRaf !== null) return;
  try {
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      if (!active) return;
      repositionHints();
      refresh();
    });
  } catch {
    repositionRaf = null;
  }
}

function flip(): void {
  if (hints.length === 0) return;
  const first = hints[0].hintEl;
  const isFlipped = first.style.zIndex !== String(first.zIndex);
  hints.forEach((h, i) => {
    const el = h.hintEl;
    const z = parseInt(el.style.zIndex, 10) || 0;
    el.style.zIndex = isFlipped
      ? String(el.zIndex)
      : String(hints.length - i + 2147483000 - z);
  });
}

function assignLabels(nextElements: JariElement[], charset: string): string[] {
  const oldByEl = new Map(hints.map((h) => [h.el, h.label]));
  const assigned = new Map<JariElement, string>();
  const taken: string[] = [];
  const newcomers: JariElement[] = [];
  for (const el of nextElements) {
    const old = oldByEl.get(el);
    if (old) {
      assigned.set(el, old);
      taken.push(old);
    } else {
      newcomers.push(el);
    }
  }
  if (newcomers.length > 0) {
    if (taken.length === 0) return genLabels(nextElements.length, charset);
    const pool = genLabels(
      nextElements.length + newcomers.length,
      charset,
    ).filter((label) =>
      taken.every(
        (t) => t !== label && !t.startsWith(label) && !label.startsWith(t),
      ),
    );
    newcomers.forEach((el, i) => {
      if (i < pool.length) {
        assigned.set(el, pool[i]);
        taken.push(pool[i]);
      }
    });
    if (assigned.size !== nextElements.length) {
      prefix = "";
      return genLabels(nextElements.length, charset);
    }
  }
  return nextElements.map((el) => assigned.get(el)!);
}

function render(): void {
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
  }

  const created = createHintsHost(
    settings.getHintTheme(),
    settings.getHintFontSize(),
  );
  hintsHost = created.host;
  holder = created.holder;

  const charset = normalizeCharset();
  const labels = assignLabels(elements, charset);
  hints = [];

  const links = layoutHints(
    holder,
    elements,
    labels,
    settings.getHintFontSize(),
  );

  hints = links.map((link) => ({
    el: link.link,
    label: link.label,
    hintEl: link,
    hiddenByViewport: false,
    rendered: null,
  }));
  refresh();
}

function flashElement(el: Element): void {
  try {
    const r = getHintRect(el);
    if (!r || r.width <= 0 || r.height <= 0) return;
    const d = document.createElement("div");
    d.className = "jari-flash";
    d.style.left = `${r.left}px`;
    d.style.top = `${r.top}px`;
    d.style.width = `${r.width}px`;
    d.style.height = `${r.height}px`;
    (document.body || document.documentElement).appendChild(d);
    setTimeout(() => {
      try {
        d.remove();
      } catch {}
    }, 150);
  } catch {}
}

let scrollLockPrevent: ((e: Event) => void) | null = null;
let keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
let scrollHandler: (() => void) | null = null;
let repositionRaf: number | null = null;

const SCROLL_STOP_DELAY = 200;

function disableScrollLock(): void {
  if (scrollLockPrevent) return;
  scrollLockPrevent = (e) => {
    if (!active) return;
    const t = e.target as Element | null;
    if (t?.closest?.(".jari-hint")) return;
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of ["wheel", "touchmove"]) {
    try {
      window.addEventListener(type, scrollLockPrevent, {
        passive: false,
        capture: true,
      });
    } catch {}
  }
}

function enableScrollLock(): void {
  if (!scrollLockPrevent) return;
  for (const type of ["wheel", "touchmove"]) {
    try {
      window.removeEventListener(type, scrollLockPrevent, { capture: true });
    } catch {}
  }
  scrollLockPrevent = null;
}

function stopTracking(): void {
  if (resizeHandler) {
    try {
      window.removeEventListener("resize", resizeHandler);
    } catch {}
    resizeHandler = null;
  }
  if (mutationObserver) {
    try {
      mutationObserver.disconnect();
    } catch {}
    mutationObserver = null;
  }
  if (regenerateTimer) {
    clearTimeout(regenerateTimer);
    regenerateTimer = null;
  }
  pendingRoots = [];
  if (keyUpHandler) {
    try {
      window.removeEventListener("keyup", keyUpHandler, true);
    } catch {}
    keyUpHandler = null;
  }
  if (scrollHandler) {
    try {
      window.removeEventListener("scroll", scrollHandler, { capture: true });
    } catch {}
    scrollHandler = null;
  }
  try {
    clearTimeout(scrollStopTimer ?? undefined);
  } catch {}
  scrollStopTimer = null;
  forceFullRegen = false;
  if (repositionRaf !== null) {
    try {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(repositionRaf);
      }
    } catch {}
    repositionRaf = null;
  }
  enableScrollLock();
  hideHintPill();
}

function startTracking(): void {
  stopTracking();
  disableScrollLock();
  showHintPill();
  try {
    ui.toast(`Hints: ${elements.length} targets (${mode})`);
  } catch {}
  try {
    mutationObserver = new MutationObserver((mutations) => {
      try {
        if (mutations.every(isOwnMutation)) return;
      } catch {}
      scheduleRegenerate(mutations);
    });
    const target = document.body || document.documentElement;
    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden", "inert"],
    });
  } catch {}
  keyUpHandler = (e) => {
    if (active) onKeyUp(e);
  };
  try {
    window.addEventListener("keyup", keyUpHandler, true);
  } catch {}
  resizeHandler = () => {
    if (!active) return;
    scheduleRegenerate();
  };
  window.addEventListener("resize", resizeHandler);
  scrollHandler = () => {
    if (!active) return;
    scheduleReposition();
    try {
      clearTimeout(scrollStopTimer ?? undefined);
    } catch {}
    scrollStopTimer = setTimeout(() => {
      scrollStopTimer = null;
      if (!active) return;
      scheduleRegenerate(null, true);
    }, SCROLL_STOP_DELAY);
  };
  try {
    window.addEventListener("scroll", scrollHandler, {
      capture: true,
      passive: true,
    });
  } catch {}
}

function close(): void {
  if (!active) return;
  active = false;
  prefix = "";
  spaceHeld = false;
  for (const el of elements) {
    try {
      delete el._jariViewportRect;
      delete el._jariBase;
      delete el._jariFrame;
    } catch {}
  }
  elements = [];
  hints = [];
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
  }
  stopTracking();
}

const VALID_HINT_MODES: Set<string> = new Set([
  "click",
  "open",
  "openBackground",
  "openCurrent",
  "input",
  "yank",
  "yankText",
]);

function open(requestedMode: string): void {
  if (active) close();
  mode = VALID_HINT_MODES.has(requestedMode) ? requestedMode : "click";
  multipleHits = mode === "openBackground";

  let candidates = collectElements(mode);

  if (mode === "input" && candidates.length === 1) {
    focusInput(candidates[0] as HTMLElement);
    return;
  }

  if (candidates.length === 0) {
    const msg =
      mode === "yank"
        ? "No links to yank"
        : mode === "input"
          ? "No inputs"
          : "No hints";
    ui.toast(msg);
    return;
  }

  if (candidates.length > MAX_HINTS) {
    candidates = prioritizeForViewport(candidates).slice(0, MAX_HINTS);
    ui.toast(`Too many hints (${candidates.length} shown)`);
  }

  elements = candidates;
  prefix = "";
  active = true;
  touch("hints");

  render();
  startTracking();
}

function handleActivationEnd(): void {
  if (!multipleHits) close();
  else {
    prefix = "";
    refresh();
  }
}

function activate(el: Element): void {
  flashElement(el);
  if (mode === "click") {
    if (isFrameElement(el)) focusFrame(el);
    else if (isEditable(el)) focusInput(el as HTMLElement);
    else ui.dispatchClick(el);
    handleActivationEnd();
  } else if (mode === "open") {
    const url = getHref(el);
    if (url) sendMessage("openInForegroundTab", { url });
    else if (isFrameElement(el)) focusFrame(el);
    else ui.dispatchClick(el);
    handleActivationEnd();
  } else if (mode === "openBackground") {
    const url = getHref(el);
    if (url) sendMessage("openInBackgroundTab", { url });
    else if (isFrameElement(el)) focusFrame(el);
    handleActivationEnd();
  } else if (mode === "openCurrent") {
    const url = getHref(el);
    if (url) {
      sendMessage("navigate", { url });
      close();
    } else if (isFrameElement(el)) {
      focusFrame(el);
      close();
    } else {
      ui.dispatchClick(el);
      close();
    }
  } else if (mode === "input") {
    focusInput(el as HTMLElement);
    close();
  } else if (mode === "yank") {
    const url = getHref(el);
    if (url) {
      ui.copyText(url).then((ok) =>
        ui.toast(ok ? `Yanked ${url}` : "Copy failed"),
      );
    } else {
      ui.toast("No link");
    }
    close();
  } else if (mode === "yankText") {
    const text = ((el as HTMLElement).innerText || el.textContent || "").trim();
    if (text) {
      ui.copyText(text).then((ok) =>
        ui.toast(ok ? "Yanked text" : "Copy failed"),
      );
    } else {
      ui.toast("No text");
    }
    close();
  }
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!active) return false;
  const key = event.key;

  if (key === "Escape") {
    ui.consume(event);
    if (prefix) {
      prefix = "";
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Shift") {
    ui.consume(event);
    flip();
    return true;
  }
  if (key === " " || event.code === "Space") {
    ui.consume(event);
    spaceHeld = true;
    if (holder) holder.style.display = "none";
    return true;
  }
  if (key === "Backspace") {
    ui.consume(event);
    if (prefix) {
      prefix = prefix.slice(0, -1);
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Enter") {
    ui.consume(event);
    return true;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (key.length === 1) {
    const decision = classifyHintKey(key, {
      labels: hints.map((h) => h.label),
      prefix,
      keymap: settings.getKeymap(),
      charset: normalizeCharset(),
    });
    if (decision.type === "scroll") {
      ui.consume(event);
      if (commandRunner) commandRunner(decision.command, event);
      return true;
    }
    if (decision.type === "activate" || decision.type === "filter") {
      ui.consume(event);
      prefix = decision.prefix;
      refresh();
      if (decision.type === "activate") {
        const exact = hints.find((h) => h.label === decision.label);
        if (exact) activate(exact.el);
      }
      return true;
    }
  }
  ui.consume(event);
  return true;
}

function onKeyUp(event: KeyboardEvent): boolean {
  if (!active) return false;
  if (event.key === " " || event.code === "Space") {
    ui.consume(event);
    spaceHeld = false;
    if (holder) holder.style.display = "";
    return true;
  }
  return false;
}

export const Hints = { open, close, isActive, onKeyDown, onKeyUp, genLabels };

register("hints", { close, onKeyDown, onKeyUp, isActive });

export function __testReset() {
  close();
}

export const __testHelpers = {
  getHref,
  isOpenableLink,
  isOwnMutation,
  isElementClickable,
  isExplicitlyRequested,
  getRealRect,
  getHintRect,
  translateRect,
  collectElements,
  collectIframeElements,
  getClickableElements,
  listElements,
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  filterAncestors,
  prioritizeForViewport,
  viewportScore,
};

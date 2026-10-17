import { sendMessage, ui } from "./ui.ts";
import { register, touch } from "./overlays.js";
import { settings } from "./settings.ts";
import {
  normalizeCharset,
  genLabels,
  updateHintText,
  createHintsHost,
  layoutHints,
  coordinate,
  hintHomeRect,
} from "./hint-layer.js";
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
} from "./hints-elements.js";

const MAX_HINTS = 800;
const REGENERATE_DELAY = 150;

let active = false;
let hintsHost = null;
let holder = null;
let elements = [];
let hints = [];
let prefix = "";
let mode = "click";
let multipleHits = false;
let resizeHandler = null;
let mutationObserver = null;
let regenerateTimer = null;
let pendingRoots = [];
let forceFullRegen = false;
let scrollStopTimer = null;
let hintPill = null;
let spaceHeld = false;

let commandRunner = null;
export function setCommandRunner(fn) {
  commandRunner = fn;
}

const NON_HINT_SCROLL_COMMANDS = new Set([
  "cycleScrollFrame",
  "resetScrollTarget",
]);

export function classifyHintKey(key, { labels = [], prefix = "", keymap = null, charset = "" } = {}) {
  if (key.length !== 1) return { type: "ignore" };
  const command = (keymap && keymap[key]) || (key === "g" ? "scrollToTop" : null);
  const entry = (command && COMMAND_CATALOG[command]) || null;
  if (
    entry &&
    entry.category === "scrolling" &&
    !NON_HINT_SCROLL_COMMANDS.has(command)
  ) {
    return { type: "scroll", command };
  }
  const lower = key.toLowerCase();
  if (!charset.includes(lower)) return { type: "ignore" };
  const next = prefix + lower.toUpperCase();
  if (labels.includes(next)) return { type: "activate", prefix: next, label: next };
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

function hasJariClass(node) {
  try {
    if (!node || node.nodeType !== 1) return false;
    const classes = node.classList;
    if (classes) {
      for (const c of classes) {
        if (typeof c === "string" && c.startsWith("jari-")) return true;
      }
    }
    if (node.closest) {
      return !!node.closest("[class^='jari-'], [class*=' jari-']");
    }
  } catch {}
  return false;
}

function isOwnMutation(mutation) {
  try {
    const nodes = [
      ...(mutation.addedNodes || []),
      ...(mutation.removedNodes || []),
    ];
    const allOwn = (list) =>
      list.every((n) => n.nodeType !== 1 || hasJariClass(n));
    if (mutation.target && mutation.target.nodeType === 1 && hasJariClass(mutation.target)) {
      return allOwn(nodes);
    }
    return nodes.length > 0 && allOwn(nodes);
  } catch {}
  return false;
}

function mergeNewcomers(roots) {
  let newcomers;
  try {
    const known = new Set(elements);
    newcomers = filterOverlapElements(collectNewcomers(roots, mode, known));
    for (const el of collectIframeElements(mode)) {
      if (!known.has(el) && !newcomers.includes(el)) newcomers.push(el);
    }
  } catch {
    newcomers = [];
  }
  let alive;
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

function replaceElements(next) {
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

function scheduleRegenerate(mutations, force) {
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

function isActive() {
  return active;
}

function focusFrame(el) {
  ui.focusFrameElement(el);
  try {
    ui.toast("Focused frame");
  } catch {}
}

function focusInput(el) {
  try {
    el.scrollIntoView({ block: "center", inline: "center" });
  } catch {}
  ui.safeFocus(el, { preventScroll: true });
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      const len = el.value ? el.value.length : 0;
      if (
        typeof el.select === "function" &&
        el.type !== "checkbox" &&
        el.type !== "radio"
      ) {
        el.select();
      } else if (typeof el.setSelectionRange === "function") {
        el.setSelectionRange(len, len);
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

function refresh() {
  if (!active) return;
  for (const h of hints) {
    if (h.hiddenByViewport) {
      h.hintEl.style.opacity = "0";
      h.hintEl.style.display = "none";
      continue;
    }
    if (!prefix) {
      h.hintEl.style.opacity = "1";
      h.hintEl.style.display = "";
      h.hintEl.classList.remove("jari-hint-hidden");
      updateHintText(h.hintEl, h.label, "");
    } else if (h.label.startsWith(prefix)) {
      h.hintEl.style.opacity = "1";
      h.hintEl.style.display = "";
      updateHintText(h.hintEl, h.label, prefix);
    } else {
      h.hintEl.style.opacity = "0";
      h.hintEl.style.display = "none";
    }
  }
}

function currentHintRect(el) {
  let frame;
  try {
    frame = el._jariFrame || null;
  } catch {
    frame = null;
  }
  let base;
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

function repositionHints() {
  if (!active || !holder) return;
  let bof;
  try {
    bof = coordinate(holder);
  } catch {
    return;
  }
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

function scheduleReposition() {
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

function flip() {
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

function assignLabels(nextElements, charset) {
  const oldByEl = new Map(hints.map((h) => [h.el, h.label]));
  const assigned = new Map();
  const taken = [];
  const newcomers = [];
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
    const pool = genLabels(nextElements.length + newcomers.length, charset).filter(
      (label) => taken.every((t) => t !== label && !t.startsWith(label) && !label.startsWith(t)),
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
  return nextElements.map((el) => assigned.get(el));
}

function render() {
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
  }));
  refresh();
}

function flashElement(el) {
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

let scrollLockPrevent = null;
let keyUpHandler = null;
let scrollHandler = null;
let repositionRaf = null;

const SCROLL_STOP_DELAY = 200;

function disableScrollLock() {
  if (scrollLockPrevent) return;
  scrollLockPrevent = (e) => {
    if (!active) return;
    const t = e.target;
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

function enableScrollLock() {
  if (!scrollLockPrevent) return;
  for (const type of ["wheel", "touchmove"]) {
    try {
      window.removeEventListener(type, scrollLockPrevent, { capture: true });
    } catch {}
  }
  scrollLockPrevent = null;
}

function stopTracking() {
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
    clearTimeout(scrollStopTimer);
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

function startTracking() {
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
      clearTimeout(scrollStopTimer);
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

function close() {
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

const VALID_HINT_MODES = new Set([
  "click",
  "open",
  "openBackground",
  "openCurrent",
  "input",
  "yank",
  "yankText",
]);

function open(requestedMode) {
  if (active) close();
  mode = VALID_HINT_MODES.has(requestedMode) ? requestedMode : "click";
  multipleHits = mode === "openBackground";

  let candidates = collectElements(mode);

  if (mode === "input" && candidates.length === 1) {
    focusInput(candidates[0]);
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

function handleActivationEnd() {
  if (!multipleHits) close();
  else {
    prefix = "";
    refresh();
  }
}

function activate(el) {
  flashElement(el);
  if (mode === "click") {
    if (isFrameElement(el)) focusFrame(el);
    else if (isEditable(el)) focusInput(el);
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
    focusInput(el);
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
    const text = ((el.innerText || el.textContent) || "").trim();
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

function onKeyDown(event) {
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

function onKeyUp(event) {
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

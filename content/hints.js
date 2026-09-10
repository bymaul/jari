import { sendMessage, ui } from "./ui.js";
import { register, touch } from "./overlays.js";
import { settings } from "./settings.js";
import {
  normalizeCharset,
  genLabels,
  updateHintText,
  createHintsHost,
  layoutHints,
} from "./hint-layer.js";
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
let hintPill = null;
let spaceHeld = false;

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

function scheduleRegenerate() {
  if (regenerateTimer) return;
  regenerateTimer = setTimeout(() => {
    regenerateTimer = null;
    if (!active) return;
    const savedPrefix = prefix;
    const fresh = collectElements(mode);
    if (fresh.length === 0) {
      close();
      ui.toast("No hints");
      return;
    }
    const capped =
      fresh.length > MAX_HINTS
        ? prioritizeForViewport(fresh).slice(0, MAX_HINTS)
        : fresh;
    if (capped.length !== fresh.length) {
      ui.toast(`Too many hints (${capped.length} shown)`);
    }
    elements = capped;
    render();
    if (holder && !spaceHeld) holder.style.display = "";
    prefix = savedPrefix;
    if (prefix && !hints.some((h) => h.label.startsWith(prefix))) {
      prefix = "";
    }
    refresh();
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
  if (keyUpHandler) {
    try {
      window.removeEventListener("keyup", keyUpHandler, true);
    } catch {}
    keyUpHandler = null;
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
      scheduleRegenerate();
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
  "hover",
]);

function open(requestedMode) {
  if (active) close();
  mode = VALID_HINT_MODES.has(requestedMode) ? requestedMode : "click";
  multipleHits = mode === "openBackground" || mode === "hover";

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
  } else if (mode === "hover") {
    ui.dispatchHover(el);
    handleActivationEnd();
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
    const charset = normalizeCharset();
    const lower = key.toLowerCase();
    if (charset.includes(lower)) {
      ui.consume(event);
      const next = prefix + lower.toUpperCase();
      const exact = hints.find((h) => h.label === next);
      prefix = next;
      refresh();
      if (exact) activate(exact.el);
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

export const Hints = { open, close, isActive, onKeyDown, genLabels };

register("hints", { close, onKeyDown, isActive });

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

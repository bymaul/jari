import { settings } from "./settings.js";
import { HINT_CHARSET_DEFAULT } from "./keymap.js";
import { sendMessage, ui } from "./ui.js";
import { register } from "./overlays.js";
import {
  isEditable,
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  getRealRect,
  isElementClickable,
  isFrameElement,
  filterAncestors,
  filterOverlapElements,
  getHref,
  isOpenableLink,
  collectElements,
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

function getZIndex(node) {
  let z = 0;
  try {
    do {
      const v = parseInt(
        window.getComputedStyle(node).getPropertyValue("z-index"),
      );
      if (!isNaN(v) && v >= 0) z += v;
      node = node.parentNode;
    } while (
      node &&
      node !== document.body &&
      node !== document &&
      node.nodeType !== 11
    );
  } catch {}
  return z;
}

function placeHintsHost(host) {
  try {
    const topLayer = document.querySelector("dialog[open]");
    if (topLayer) {
      const r = topLayer.getBoundingClientRect();
      const style = window.getComputedStyle(topLayer);
      if (
        r.width > 0 &&
        r.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      ) {
        topLayer.appendChild(host);
        return;
      }
    }
  } catch {}
  (document.documentElement || document.body).appendChild(host);
}

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
    const capped = fresh.length > MAX_HINTS ? fresh.slice(0, MAX_HINTS) : fresh;
    if (capped.length !== fresh.length) {
      ui.toast(`Too many hints (${capped.length} shown)`);
    }
    elements = capped;
    render();
    if (holder) holder.style.display = "";
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

export function normalizeCharset() {
  const s = settings.getHintChars();
  if (!s) return HINT_CHARSET_DEFAULT;
  return s.toLowerCase();
}

export function genLabels(count, charset) {
  const chars = (charset || normalizeCharset()).toUpperCase().split("");
  if (count <= 0 || chars.length < 2) return [];
  if (count <= chars.length) return chars.slice(0, count);

  // BFS drain: consumed prefixes are removed via `head`, so no label
  // is ever a prefix of another (exact match always auto-activates).
  const labels = chars.slice();
  let head = 0;
  while (labels.length - head < count) {
    if (head >= labels.length) break;
    const p = labels[head++];
    for (const c of chars) {
      labels.push(p + c);
      if (labels.length - head >= count) break;
      if (labels.length > 10000) break;
    }
    if (labels.length > 10000) break;
  }
  return labels.slice(head, head + count);
}

function safeFocus(el, opts) {
  try {
    el.focus(opts);
  } catch {
    try {
      el.focus();
    } catch {}
  }
}

function dispatchClick(el) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
    } catch {}
  }
  safeFocus(el, { preventScroll: true });
}

function focusFrame(el) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  safeFocus(el, { preventScroll: true });
  try {
    const win = el.contentWindow;
    if (win && typeof win.focus === "function") win.focus();
  } catch {}
  try {
    ui.toast("Focused frame");
  } catch {}
}

function focusInput(el) {
  try {
    el.scrollIntoView({ block: "center", inline: "center" });
  } catch {}
  safeFocus(el, { preventScroll: true });
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

function coordinate(holderEl) {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.textContent = "A";
  holderEl.prepend(probe);
  const br = probe.getBoundingClientRect();
  const ret = {
    top: br.top + window.pageYOffset - document.documentElement.clientTop,
    left: br.left + window.pageXOffset - document.documentElement.clientLeft,
  };
  try {
    probe.remove();
  } catch {}
  return ret;
}

function updateHintText(hintEl, label, typed) {
  hintEl.textContent = "";
  if (!typed) {
    hintEl.textContent = label;
    return;
  }
  if (label.startsWith(typed)) {
    const pre = document.createElement("span");
    pre.className = "jari-hint-matched";
    pre.textContent = typed;
    const rest = document.createElement("span");
    rest.textContent = label.slice(typed.length);
    hintEl.append(pre, rest);
    hintEl.classList.remove("jari-hint-hidden");
  } else {
    hintEl.textContent = label;
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

function render() {
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
  }

  hintsHost = document.createElement("div");
  hintsHost.className = "jari-hints-host";
  hintsHost.style.position = "fixed";
  hintsHost.style.left = "0";
  hintsHost.style.top = "0";
  hintsHost.style.width = "0";
  hintsHost.style.height = "0";
  hintsHost.style.overflow = "visible";
  hintsHost.style.pointerEvents = "none";
  hintsHost.style.zIndex = "2147483647";
  try {
    hintsHost.attachShadow({ mode: "open" });
  } catch {
    hintsHost.shadowRoot = hintsHost;
  }

  const shadow = hintsHost.shadowRoot;
  const style = document.createElement("style");
  style.textContent = `
    .jari-hints { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .jari-hint {
      position: absolute;
      display: inline-block;
      box-sizing: border-box;
      font-family: monospace;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      letter-spacing: 0.02em;
      padding: 1px 3px;
      border: 1px solid #c38a22;
      border-radius: 3px;
      background: linear-gradient(#fff785, #ffc542);
      color: #1a1a1a;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      text-align: left;
    }
    .jari-hint-matched { color: #6a6a6a; opacity: 0.45; }
    .jari-hint-hidden { opacity: 0; display: none; }
  `;
  shadow.appendChild(style);
  holder = document.createElement("section");
  holder.className = "jari-hints";
  holder.style.display = "block";
  holder.style.opacity = "1";
  shadow.appendChild(holder);
  placeHintsHost(hintsHost);

  const charset = normalizeCharset();
  const labels = genLabels(elements.length, charset);
  hints = [];

  const bof = (() => {
    try {
      return coordinate(holder);
    } catch {
      return { top: 0, left: 0 };
    }
  })();

  let lastTop = -1;
  let lastLeft = -1;
  const links = elements.map((elm, i) => {
    const r = getRealRect(elm);
    const z = getZIndex(elm);
    const left = window.pageXOffset + r.left - bof.left;
    const link = document.createElement("div");
    link.className = "jari-hint";
    link.textContent = labels[i];
    link.dataset.label = labels[i];
    let lTop = Math.max(r.top + window.pageYOffset - bof.top, 0);
    if (lTop === lastTop && Math.abs(left - lastLeft) < 20) {
      link.style.left = `${left + 20 - Math.abs(left - lastLeft)}px`;
    } else if (left === lastLeft && Math.abs(lTop - lastTop) < 20) {
      lTop += 20 - Math.abs(lTop - lastTop);
      link.style.left = `${left}px`;
    } else {
      link.style.left = `${left}px`;
    }
    link.style.top = `${lTop}px`;
    link.style.zIndex = String(z + 9999);
    link.zIndex = link.style.zIndex;
    link.label = labels[i];
    link.link = elm;
    updateHintText(link, labels[i], "");
    lastTop = lTop;
    lastLeft = parseInt(link.style.left, 10);
    return link;
  });

  links.forEach((link) => holder.appendChild(link));

  if (links.length > 0) {
    let bcr = getRealRect(links[0]);
    for (let i = 1; i < links.length; i++) {
      const h = links[i];
      const tcr = getRealRect(h);
      if (tcr.top === bcr.top && Math.abs(tcr.left - bcr.left) < bcr.width) {
        h.style.top = `${h.offsetTop + h.offsetHeight}px`;
      }
      bcr = getRealRect(h);
    }
  }

  hints = links.map((link) => ({
    el: link.link,
    label: link.label,
    hintEl: link,
  }));
  refresh();
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
    mutationObserver = new MutationObserver(scheduleRegenerate);
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
  "input",
  "yank",
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
    candidates = candidates.slice(0, MAX_HINTS);
    ui.toast(`Too many hints (${candidates.length} shown)`);
  }

  elements = candidates;
  prefix = "";
  active = true;

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
  if (mode === "click") {
    if (isFrameElement(el)) focusFrame(el);
    else if (isEditable(el)) focusInput(el);
    else dispatchClick(el);
    handleActivationEnd();
  } else if (mode === "open") {
    const url = getHref(el);
    if (url) sendMessage("openInForegroundTab", { url });
    else if (isFrameElement(el)) focusFrame(el);
    else dispatchClick(el);
    handleActivationEnd();
  } else if (mode === "openBackground") {
    const url = getHref(el);
    if (url) sendMessage("openInBackgroundTab", { url });
    else if (isFrameElement(el)) focusFrame(el);
    handleActivationEnd();
  } else if (mode === "input") {
    focusInput(el);
    close();
  } else if (mode === "yank") {
    const url = getHref(el);
    if (url) {
      ui.copyText(url);
      ui.toast(`Yanked ${url}`);
    } else {
      ui.toast("No link");
    }
    close();
  }
}

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onKeyDown(event) {
  if (!active) return false;
  const key = event.key;

  if (key === "Escape") {
    consume(event);
    if (prefix) {
      prefix = "";
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Shift") {
    consume(event);
    flip();
    return true;
  }
  if (key === " " || event.code === "Space") {
    consume(event);
    if (holder) holder.style.display = "none";
    return true;
  }
  if (key === "Backspace") {
    consume(event);
    if (prefix) {
      prefix = prefix.slice(0, -1);
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Enter") {
    consume(event);
    return true;
  }
  if (key.length === 1) {
    const charset = normalizeCharset();
    const lower = key.toLowerCase();
    if (charset.includes(lower)) {
      consume(event);
      const next = prefix + lower.toUpperCase();
      const exact = hints.find((h) => h.label === next);
      prefix = next;
      refresh();
      if (exact) activate(exact.el);
      return true;
    }
  }
  consume(event);
  return true;
}

function onKeyUp(event) {
  if (!active) return false;
  if (event.key === " " || event.code === "Space") {
    consume(event);
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
  isElementClickable,
  getRealRect,
  collectElements,
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  filterAncestors,
};

import { overlaySelectors, queryAll } from "./keymap.js";
import { ui } from "./ui.js";
import { FRAME_SELECTOR, isFrameElement } from "./hints-elements.js";
import { MIN_SCROLL_AREA_SIZE } from "../shared/constants.js";
import { settings } from "./settings.js";

let target = null;

const HIGHLIGHT_MS = 400;

function getTarget() {
  if (target !== null && !target.isConnected) {
    target = null;
  }
  return target === null ? window : target;
}

function isScrollVisible(el, selfStyle) {
  let node = el;
  let first = true;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute("hidden")) return false;
      const style =
        first && selfStyle !== undefined
          ? selfStyle
          : window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
      if (parseFloat(style.opacity) === 0) return false;
    }
    first = false;
    node = node.getRootNode().host || node.parentElement;
  }
  return true;
}

function findScrollableElements() {
  const areas = [];
  const roots = new Set([document.documentElement, document.body]);
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;

  for (const el of queryAll("*")) {
    if (roots.has(el)) continue;
    if (el.closest(overlaySelectors)) continue;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") continue;
    if (
      el.clientHeight < MIN_SCROLL_AREA_SIZE &&
      el.clientWidth < MIN_SCROLL_AREA_SIZE
    )
      continue;
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect) continue;
    const right = Number.isFinite(rect.right)
      ? rect.right
      : (rect.left || 0) + (rect.width || 0);
    const bottom = Number.isFinite(rect.bottom)
      ? rect.bottom
      : (rect.top || 0) + (rect.height || 0);
    if (bottom <= 0 || right <= 0 || rect.top >= vh || rect.left >= vw)
      continue;
    const visibleW = Math.min(right, vw) - Math.max(rect.left || 0, 0);
    const visibleH = Math.min(bottom, vh) - Math.max(rect.top || 0, 0);
    if (visibleW < MIN_SCROLL_AREA_SIZE || visibleH < MIN_SCROLL_AREA_SIZE)
      continue;
    const canY = el.scrollHeight > el.clientHeight + 1;
    const canX = el.scrollWidth > el.clientWidth + 1;
    if (!canY && !canX) continue;
    const style = window.getComputedStyle(el);
    if (!isScrollVisible(el, style)) continue;
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const scrollableY =
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      canY;
    const scrollableX =
      (overflowX === "auto" ||
        overflowX === "scroll" ||
        overflowX === "overlay") &&
      canX;
    if (scrollableY || scrollableX) areas.push(el);
  }
  return areas;
}

function findFrameElements() {
  const frames = [];
  for (const el of queryAll(FRAME_SELECTOR)) {
    try {
      if (el.closest && el.closest(overlaySelectors)) continue;
    } catch {}
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect) continue;
    if (
      rect.width < MIN_SCROLL_AREA_SIZE ||
      rect.height < MIN_SCROLL_AREA_SIZE
    )
      continue;
    if (!isScrollVisible(el)) continue;
    if (!isFrameScrollable(el)) continue;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw)
      continue;
    frames.push(el);
  }
  return frames;
}

export function isFrame(el) {
  if (!el || el === window) return false;
  return isFrameElement(el);
}

function isFrameScrollable(el) {
  let doc;
  try {
    doc = el.contentDocument || null;
  } catch {
    return true;
  }
  if (!doc) return true;
  try {
    const root = doc.scrollingElement || doc.documentElement || doc.body;
    if (!root) return true;
    return (
      root.scrollHeight > root.clientHeight + 1 ||
      root.scrollWidth > root.clientWidth + 1
    );
  } catch {
    return true;
  }
}

export function focusTarget(el) {
  if (!el || el === window) return;
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  if (!isFrame(el)) return;
  ui.safeFocus(el, { preventScroll: true });
  try {
    const win = el.contentWindow;
    if (win && typeof win.focus === "function") win.focus();
  } catch {}
}

export function frameWindow(frame) {
  try {
    return frame.contentWindow || null;
  } catch {
    return null;
  }
}

export function frameViewportHeight(frame) {
  const w = frameWindow(frame);
  try {
    if (w && Number.isFinite(w.innerHeight)) return w.innerHeight;
  } catch {}
  return clientHeightOf(frame);
}

const CYCLE_FROM_FRAME = "jari-cycle-scroll";

function isTopFrame() {
  try {
    return window.top === window;
  } catch {
    return true;
  }
}

function releaseFrameFocus() {
  try {
    const active = document.activeElement;
    if (active && isFrame(active)) active.blur();
  } catch {}
  try {
    window.focus();
  } catch {}
}

function forwardCycleToTop(dir) {
  try {
    window.top.postMessage({ type: CYCLE_FROM_FRAME, dir }, "*");
  } catch {}
  try {
    if (
      document.activeElement &&
      typeof document.activeElement.blur === "function"
    ) {
      document.activeElement.blur();
    }
  } catch {}
  try {
    window.blur();
  } catch {}
  try {
    window.top.focus();
  } catch {}
}

function pageCanScroll() {
  const el = document.scrollingElement || document.documentElement;
  if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
  const y = window.getComputedStyle(el).overflowY;
  if (y === "hidden" || y === "clip") return false;
  if (y === "visible" && document.body) {
    const bodyY = window.getComputedStyle(document.body).overflowY;
    if (bodyY === "hidden" || bodyY === "clip") return false;
  }
  return true;
}

const DIALOG_SELECTOR = 'dialog[open], [role="dialog"], [aria-modal="true"]';

function isDialogStop(el) {
  if (!el || el === window) return false;
  try {
    if (el.tagName === "DIALOG") return true;
    if (typeof el.getAttribute === "function") {
      if (el.getAttribute("role") === "dialog") return true;
      if (el.getAttribute("aria-modal") === "true") return true;
    }
    if (typeof el.closest === "function" && el.closest(DIALOG_SELECTOR))
      return true;
  } catch {
    return false;
  }
  return false;
}

function currentStops() {
  const areas = dedupeNestedAreas(findScrollableElements());
  const frames = findFrameElements();
  const pageScrolls = pageCanScroll();
  const rest = sortStopsVisually([...areas, ...frames]);
  const stops = pageScrolls ? [null, ...rest] : rest;
  return [...new Set(stops)];
}

function rectTopLeft(el) {
  try {
    const r = el.getBoundingClientRect();
    if (!r) return null;
    return { top: r.top, left: r.left };
  } catch {
    return null;
  }
}

function sortStopsVisually(stops) {
  return stops
    .map((el, i) => ({ el, i, pos: rectTopLeft(el) }))
    .sort((a, b) => {
      if (!a.pos && !b.pos) return a.i - b.i;
      if (!a.pos) return 1;
      if (!b.pos) return -1;
      if (a.pos.top !== b.pos.top) return a.pos.top - b.pos.top;
      if (a.pos.left !== b.pos.left) return a.pos.left - b.pos.left;
      return a.i - b.i;
    })
    .map(({ el }) => el);
}

function dedupeNestedAreas(areas) {
  const kept = [];
  const contains = (outer, inner) => {
    try {
      return (
        outer !== inner &&
        typeof outer.contains === "function" &&
        outer.contains(inner)
      );
    } catch {
      return false;
    }
  };
  for (const el of areas) {
    if (kept.includes(el)) continue;
    if (kept.some((k) => contains(el, k))) continue;
    for (let j = kept.length - 1; j >= 0; j--) {
      if (contains(kept[j], el)) kept.splice(j, 1);
    }
    kept.push(el);
  }
  return kept;
}

function isUnverifiedFrame(el) {
  if (!isFrame(el)) return false;
  try {
    return !el.contentDocument;
  } catch {
    return true;
  }
}

function cycle(steps = 1) {
  if (!isTopFrame()) {
    forwardCycleToTop(steps < 0 ? -1 : 1);
    return;
  }
  const stops = currentStops();
  if (stops.length === 0) {
    target = null;
    ui.toast("No scroll areas");
    return;
  }
  const dir = steps < 0 ? -1 : 1;
  const count = Math.max(1, Math.abs(Math.floor(steps)) || 1);
  const idx = stops.indexOf(target);
  const next =
    idx === -1
      ? 0
      : (((idx + dir * count) % stops.length) + stops.length) % stops.length;
  target = stops[next];
  focusTarget(target);
  if (!isFrame(target)) releaseFrameFocus();
  showHighlight();
}

function scrollHeightOf(el) {
  return el === window
    ? (document.scrollingElement || document.documentElement || document.body).scrollHeight
    : el.scrollHeight;
}

function clientHeightOf(el) {
  return el === window ? window.innerHeight : el.clientHeight;
}

function scrollPosOf(el) {
  return el === window
    ? { x: window.scrollX, y: window.scrollY }
    : { x: el.scrollLeft, y: el.scrollTop };
}

let highlightEl = null;
let highlightTimer = null;

function showHighlight() {
  const area = getTarget();
  const stops = currentStops();
  const pos = stops.indexOf(area === window ? null : area);
  const count = pos === -1 ? "" : `${pos + 1}/${stops.length}`;
  if (!document.body) return;
  let rect;
  if (area === window) {
    rect = {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  } else {
    try {
      rect = area.getBoundingClientRect();
    } catch {
      return;
    }
    if (!rect) return;
  }

  clearTimeout(highlightTimer);
  if (highlightEl) highlightEl.remove();

  const el = document.createElement("div");
  el.className = "jari-scroll-highlight";
  el.style.left = rect.left + "px";
  el.style.top = rect.top + "px";
  el.style.width = rect.width + "px";
  el.style.height = rect.height + "px";
  const label = document.createElement("span");
  label.className = "jari-scroll-highlight-label";
  let kind = "current scroll area";
  if (area === window) kind = "global scroll";
  else if (isFrame(area)) kind = isUnverifiedFrame(area) ? "frame?" : "frame";
  else if (isDialogStop(area)) kind = "dialog scroll area";
  label.textContent = kind;
  el.appendChild(label);
  if (count) ui.toast(`${label.textContent} ${count}`);
  document.body.appendChild(el);
  highlightEl = el;
  highlightTimer = setTimeout(() => {
    if (highlightEl === el) {
      highlightEl.remove();
      highlightEl = null;
    }
  }, HIGHLIGHT_MS);
}

function reset() {
  if (!isTopFrame()) {
    forwardCycleToTop();
    return;
  }
  target = null;
  releaseFrameFocus();
  showHighlight();
}

let smoothState = null;

const SMOOTH_BASE_MS = 1000 / 60;
const SMOOTH_FRACTION = 0.4;
const SMOOTH_CAP = 80;
const SMOOTH_MAX_DT_MS = 100;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function flushSmoothQueue() {
  if (!smoothState) return;
  const { el, x, y } = smoothState;
  smoothState = null;
  if (x === 0 && y === 0) return;
  try {
    el.scrollBy({ left: x, top: y, behavior: "instant" });
  } catch {}
}

export function smoothScrollBy(el, x, y) {
  if (smoothState === null) {
    smoothState = { el, x: 0, y: 0, rafId: null, last: null };
  } else if (smoothState.el !== el) {
    flushSmoothQueue();
    smoothState = { el, x: 0, y: 0, rafId: null, last: null };
  }
  smoothState.x += x;
  smoothState.y += y;
  if (smoothState.rafId === null) {
    smoothState.rafId = requestAnimationFrame(smoothScrollStep);
  }
}

// Share of `pending` px to cover after `dt` ms: the time-parameterized form
// of "40% per 60fps frame". Identical feel at 60fps, but dropped frames
// cover proportionally more instead of slowing the whole motion down the
// way a fixed per-frame share does under load.
export function __smoothFrameMove(pending, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? dt : SMOOTH_BASE_MS;
  const frac = 1 - Math.pow(1 - SMOOTH_FRACTION, step / SMOOTH_BASE_MS);
  const cap = SMOOTH_CAP * (step / SMOOTH_BASE_MS);
  const want = Math.round(Math.abs(pending) * frac);
  return Math.sign(pending) * Math.max(1, Math.min(cap, want));
}

function smoothScrollStep(t) {
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

  const last = smoothState.last;
  smoothState.last = t;
  const dt =
    last === null || !Number.isFinite(t) || !Number.isFinite(last)
      ? SMOOTH_BASE_MS
      : Math.min(SMOOTH_MAX_DT_MS, Math.max(0, t - last));
  const moveX = pendingX !== 0 ? __smoothFrameMove(pendingX, dt) : 0;
  const moveY = pendingY !== 0 ? __smoothFrameMove(pendingY, dt) : 0;

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

export function shouldSmooth() {
  return settings.isSmoothScroll() && !prefersReducedMotion();
}

export const Scroll = { getTarget, cycle, reset, showHighlight };

function handleCycleMessage(event) {
  if (!isTopFrame()) return;
  const data = event && event.data;
  if (!data || data.type !== CYCLE_FROM_FRAME) return;
  if (!isChildFrameWindow(event.source)) return;
  cycle(data.dir === -1 ? -1 : 1);
}

function isChildFrameWindow(win) {
  if (!win || win === window) return false;
  let frames;
  try {
    frames = document.querySelectorAll
      ? document.querySelectorAll(FRAME_SELECTOR)
      : [];
  } catch {
    return false;
  }
  for (const el of frames) {
    try {
      if (el.contentWindow === win) return true;
    } catch {}
  }
  return false;
}

try {
  window.addEventListener("message", handleCycleMessage);
} catch {}

export { scrollHeightOf, clientHeightOf, scrollPosOf };

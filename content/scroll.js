import { overlaySelectors, queryAll } from "./keymap.js";
import { ui } from "./ui.js";
import { MIN_SCROLL_AREA_SIZE } from "../shared/constants.js";

let target = null;

const HIGHLIGHT_MS = 300;

let resolved = false;
let autoPicked = false;

function getTarget() {
  if (target !== null && !target.isConnected) {

    target = null;
    autoPicked = false;
    resolved = false;
  }
  if (target !== null && autoPicked && !resolved) {

    target = null;
  }
  if (target === null && !resolved) {
    resolved = true;
    if (!pageCanScroll()) {
      const areas = findScrollableElements();
      if (areas.length > 0) {
        target = nearestArea(areas) || areas[0];
        autoPicked = true;
      }
    }
  }
  return target === null ? window : target;
}

let scanEpoch = 0;
let cachedEpoch = -1;
let cachedAreas = null;
let cachedFrames = null;
let cachedFramesEpoch = -1;
let mutationTimeout = null;

function invalidateScrollCache() {
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
  }

  mutationTimeout = setTimeout(() => {
    scanEpoch++;
    resolved = false;
    mutationTimeout = null;
  }, 150);
}

const observedRoots = new Set();

function ensureObserved(root) {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  if (typeof window.MutationObserver !== "undefined") {
    new window.MutationObserver(invalidateScrollCache).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }
}

if (typeof window.MutationObserver !== "undefined") {
  new window.MutationObserver(() => {
    scanEpoch++;

    resolved = false;
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}

function isScrollVisible(el) {
  let node = el;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute("hidden")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
      if (parseFloat(style.opacity) === 0) return false;
    }
    node = node.getRootNode().host || node.parentElement;
  }
  return true;
}

function findScrollableElements() {
  if (cachedEpoch === scanEpoch && cachedAreas) return cachedAreas;
  cachedEpoch = scanEpoch;
  const areas = [];
  const roots = new Set([document.documentElement, document.body]);

  for (const el of queryAll("*", ensureObserved)) {
    if (roots.has(el)) continue;
    if (el.closest(overlaySelectors)) continue;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") continue;
    if (
      el.clientHeight < MIN_SCROLL_AREA_SIZE &&
      el.clientWidth < MIN_SCROLL_AREA_SIZE
    )
      continue;
    if (!isScrollVisible(el)) continue;
    const canY = el.scrollHeight > el.clientHeight + 1;
    const canX = el.scrollWidth > el.clientWidth + 1;
    if (!canY && !canX) continue;
    const style = window.getComputedStyle(el);
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
  cachedAreas = areas;
  return areas;
}

function findFrameElements() {
  if (cachedFramesEpoch === scanEpoch && cachedFrames) return cachedFrames;
  cachedFramesEpoch = scanEpoch;
  const frames = [];
  for (const el of queryAll("iframe,frame", ensureObserved)) {
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
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw)
      continue;
    frames.push(el);
  }
  cachedFrames = frames;
  return frames;
}

export function isFrame(el) {
  if (!el || el === window) return false;
  const tag = el.tagName;
  return tag === "IFRAME" || tag === "FRAME";
}

export function focusTarget(el) {
  if (!el || el === window) return;
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  if (!isFrame(el)) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {}
  }
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

function nearestArea(areas) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cx = vw / 2;
  const cy = vh / 2;
  let best = null;
  let bestScore = -Infinity;
  for (const el of areas) {
    const r = el.getBoundingClientRect();
    const coveredW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const coveredH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const coverage = (coveredW * coveredH) / (vw * vh);
    const containsCenter =
      r.left <= cx && cx <= r.right && r.top <= cy && cy <= r.bottom;
    const score = coverage + (containsCenter ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function cycle() {
  const areas = findScrollableElements();
  const frames = findFrameElements();
  const pageScrolls = pageCanScroll();
  const stops = pageScrolls ? [null, ...areas, ...frames] : [...areas, ...frames];
  if (stops.length === 0) {
    target = null;
    ui.toast("No scroll areas");
    return;
  }
  const idx = stops.indexOf(target);
  if (idx === -1) {
    target = pageScrolls ? null : nearestArea(stops) || stops[0];
  } else if (pageScrolls && idx === 0) {
    target = nearestArea(areas) || areas[0] || frames[0] || null;
  } else {
    target = stops[(idx + 1) % stops.length];
  }
  autoPicked = false;
  focusTarget(target);
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
  let area = getTarget();
  if (area === window && !pageCanScroll()) {
    const areas = findScrollableElements();
    const frames = findFrameElements();
    const stops = [...areas, ...frames];
    if (stops.length === 0) return;
    target = nearestArea(areas) || areas[0] || frames[0];
    autoPicked = false;
    area = target;
  }
  const rect =
    area === window
      ? {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        }
      : area.getBoundingClientRect();

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
  label.textContent =
    area === window
      ? "global scroll"
      : isFrame(area)
        ? "frame"
        : "current scroll area";
  el.appendChild(label);
  document.body.appendChild(el);
  highlightEl = el;
  highlightTimer = setTimeout(() => {
    if (highlightEl === el) {
      highlightEl.remove();
      highlightEl = null;
    }
  }, HIGHLIGHT_MS);
}

export const Scroll = { getTarget, cycle, showHighlight };

export { scrollHeightOf, clientHeightOf, scrollPosOf };

import { overlaySelectors, queryAll } from "./keymap.js";
import { ui } from "./ui.js";
import { FRAME_SELECTOR, isFrameElement } from "./hints-elements.js";
import { MIN_SCROLL_AREA_SIZE } from "../shared/constants.js";
import { settings } from "./settings.js";

let target = null;

const HIGHLIGHT_MS = 400;

let resolved = false;

function getTarget() {
  if (target !== null && !target.isConnected) {
    target = null;
    resolved = false;
  }
  if (target === null && !resolved) {
    resolved = true;
    if (!pageCanScroll()) {
      const stops = currentStops();
      if (stops.length > 0) {
        target = nearestArea(preferDialog(stops)) || stops[0];
      }
    }
  }
  return target === null ? window : target;
}

let scanEpoch = 0;
let mutationTimeout = null;

function epochCache(compute) {
  let epoch = -1;
  let value = null;
  return () => {
    if (epoch === scanEpoch) return value;
    epoch = scanEpoch;
    value = compute();
    return value;
  };
}

function invalidateScrollCache() {
  // Mark resolved stale synchronously so the next getTarget() re-picks
  // even within the throttle window; the epoch bump itself is throttled
  // (not debounced) so sustained churn still rescans periodically.
  resolved = false;
  if (mutationTimeout) return;

  mutationTimeout = setTimeout(() => {
    const prevStops = lastStops;
    scanEpoch++;
    resolved = false;
    mutationTimeout = null;
    lastStops = adoptNewDialog(prevStops);
  }, 150);
}

const observedRoots = new Set();
function ensureObserved(root, options) {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  if (typeof window.MutationObserver !== "undefined") {
    new window.MutationObserver(invalidateScrollCache).observe(
      root,
      options || { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] },
    );
  }
}

function observeDocument() {
  // queryAll only reports shadow roots to ensureObserved, so without this
  // the scan cache never invalidates on pages without shadow-DOM churn
  // (opened panels, SPA content, and feed growth would stay invisible).
  // Class attributes are watched for overflow flips; style is excluded:
  // progress bars and play-state churn would otherwise invalidate
  // near-continuously on video sites.
  try {
    ensureObserved(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch {}
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

const findScrollableElements = epochCache(() => {
  observeDocument();
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
  return areas;
});

const findFrameElements = epochCache(() => {
  observeDocument();
  const frames = [];
  for (const el of queryAll(FRAME_SELECTOR, ensureObserved)) {
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
});

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
  const areas = findScrollableElements();
  const frames = findFrameElements();
  const pageScrolls = pageCanScroll();
  return [
    ...new Set(
      pageScrolls ? [null, ...areas, ...frames] : [...areas, ...frames],
    ),
  ];
}

function preferDialog(stops) {
  const dialogs = stops.filter(isDialogStop);
  return dialogs.length > 0 ? dialogs : stops;
}

let lastStops = [];

function adoptNewDialog(prevStops) {
  const stops = currentStops();
  if (target === null) {
    const prev = new Set(prevStops);
    const fresh = stops.filter(
      (s) => s !== null && !prev.has(s) && isDialogStop(s),
    );
    if (fresh.length > 0) {
      target = nearestArea(fresh) || fresh[0];
      focusTarget(target);
      showHighlight();
    }
  }
  return stops;
}

function nearestArea(areas) {
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (vw === 0 || vh === 0) return areas[0] || null;
  const cx = vw / 2;
  const cy = vh / 2;
  let best = null;
  let bestScore = -Infinity;
  for (const el of areas) {
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!r) continue;
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

function cycle(steps = 1) {
  if (!isTopFrame()) {
    forwardCycleToTop(steps < 0 ? -1 : 1);
    return;
  }
  const stops = currentStops();
  // currentStops() leads with null exactly when the page itself scrolls.
  const pageScrolls = stops.length > 0 && stops[0] === null;
  if (stops.length === 0) {
    target = null;
    ui.toast("No scroll areas");
    return;
  }
  const dir = steps < 0 ? -1 : 1;
  const count = Math.max(1, Math.abs(Math.floor(steps)) || 1);
  const idx = stops.indexOf(target);
  if (idx === -1) {
    target = pageScrolls ? null : nearestArea(preferDialog(stops)) || stops[0];
  } else if (pageScrolls && idx === 0) {
    if (dir < 0) {
      target = stops[stops.length - 1];
    } else {
      const ranked = stops.filter((s) => s !== null);
      target = nearestArea(preferDialog(ranked)) || ranked[0] || null;
    }
  } else {
    const next =
      (((idx + dir * count) % stops.length) + stops.length) % stops.length;
    target = stops[next];
  }
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
  let area = getTarget();
  const pageScrolls = pageCanScroll();
  if (area === window && !pageScrolls) {
    const stops = currentStops();
    if (stops.length === 0) return;
    target = nearestArea(preferDialog(stops)) || stops[0];
    area = target;
  }
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
  else if (isFrame(area)) kind = "frame";
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
  resolved = false;
  releaseFrameFocus();
  showHighlight();
}

let smoothState = null;

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
    smoothState = { el, x: 0, y: 0, rafId: null };
  } else if (smoothState.el !== el) {
    flushSmoothQueue();
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

export function shouldSmooth() {
  return settings.isSmoothScroll() && !prefersReducedMotion();
}

export const Scroll = { getTarget, cycle, reset, showHighlight };

export function __resetScrollCache() {
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
    mutationTimeout = null;
  }
  scanEpoch++;
  resolved = false;
  lastStops = [];
}

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

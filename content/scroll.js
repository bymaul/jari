import { overlaySelectors, queryAll } from "./keymap.js";
import { ui } from "./ui.js";
import { FRAME_SELECTOR, isFrameElement } from "./hints-elements.js";
import { MIN_SCROLL_AREA_SIZE } from "../shared/constants.js";

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
      const areas = findScrollableElements();
      const frames = findFrameElements();
      const stops = [...areas, ...frames];
      if (stops.length > 0) {
        target = nearestArea(stops) || stops[0];
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
    scanEpoch++;
    resolved = false;
    mutationTimeout = null;
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

function forwardCycleToTop() {
  try {
    window.top.postMessage({ type: CYCLE_FROM_FRAME }, "*");
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

function cycle() {
  if (!isTopFrame()) {
    forwardCycleToTop();
    return;
  }
  const areas = findScrollableElements();
  const frames = findFrameElements();
  const pageScrolls = pageCanScroll();
  const stops = [
    ...new Set(pageScrolls ? [null, ...areas, ...frames] : [...areas, ...frames]),
  ];
  if (stops.length === 0) {
    target = null;
    ui.toast("No scroll areas");
    return;
  }
  const idx = stops.indexOf(target);
  if (idx === -1) {
    target = pageScrolls ? null : nearestArea(stops) || stops[0];
  } else if (pageScrolls && idx === 0) {
    const ranked = stops.filter((s) => s !== null);
    target = nearestArea(ranked) || areas[0] || frames[0] || null;
  } else {
    target = stops[(idx + 1) % stops.length];
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
  const areas = findScrollableElements();
  const frames = findFrameElements();
  const pageScrolls = pageCanScroll();
  if (area === window && !pageScrolls) {
    const stops = [...areas, ...frames];
    if (stops.length === 0) return;
    target = nearestArea(stops) || stops[0];
    area = target;
  }
  const stops = [
    ...new Set(pageScrolls ? [null, ...areas, ...frames] : [...areas, ...frames]),
  ];
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
  label.textContent = area === window ? "global scroll" : isFrame(area) ? "frame" : "current scroll area";
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

export const Scroll = { getTarget, cycle, reset, showHighlight };

export function __resetScrollCache() {
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
    mutationTimeout = null;
  }
  scanEpoch++;
  resolved = false;
}

function handleCycleMessage(event) {
  if (!isTopFrame()) return;
  const data = event && event.data;
  if (!data || data.type !== CYCLE_FROM_FRAME) return;
  if (event.source === window) return;
  cycle();
}

try {
  window.addEventListener("message", handleCycleMessage);
} catch {}

export { scrollHeightOf, clientHeightOf, scrollPosOf };

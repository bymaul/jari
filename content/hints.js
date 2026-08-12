// Jari: link-hint mode (f / i).
// Overlays a letter label on visible clickable/input elements; typing the
// label resolves it. Modes:
//   click  - activate the element (same tab)
//   newtab - open anchors in a background tab, otherwise click
//   yank   - copy the link URL to the clipboard (yf)
//   focus  - focus inputs; auto-focuses when exactly one match exists
import {
  allowedUrlSchemes,
  containsElement,
  deepActiveElement,
  overlaySelectors,
  queryAll,
  settingsDefaults,
} from "./keymap.js";

// Upper bound on labels rendered at once. Pages can match hundreds of
// clickables; labeling them all is slow and useless, so the first MAX_HINTS
// in document order get hints and the rest are skipped.
const MAX_HINTS = 100;
// Approximate hint-box height, used to keep labels fully inside the
// viewport when the hinted element only shows a sliver at the fold edge.
const LABEL_HEIGHT = 20;
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";
import { register } from "./overlays.js";

// Broad selector of "things you can click". Includes ARIA roles, inline
// onclick handlers, and form controls; hidden inputs are excluded.
const CLICKABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "summary",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  "[role='combobox']",
  "[role='treeitem']",
  "[onclick]",
].join(",");

// Text-entry targets for focus mode ("i"): text-like inputs, textarea and
// editable elements. Radio/checkbox/button/file/color/range are excluded.
const TEXT_INPUT_TYPES = [
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
];
const FOCUS_SELECTOR = [
  `input:not([type]), input[type="${TEXT_INPUT_TYPES.join('"], input[type="')}"]`,
  "textarea",
  "[contenteditable='true']",
  "[contenteditable='plaintext-only']",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='spinbutton']",
].join(",");

// True when the element carries a usable link href. "yank"/"newtab" only
// hint links — a button without an href has nothing to copy or open.
function linkHref(el) {
  const href = el.href || el.getAttribute?.("href");
  return typeof href === "string" && href.trim() !== "";
}

// Many sites (Google Docs, Notion, Gmail widgets) act on pointer/mouse
// input, often on a shadow host, and ignore a bare el.click(). Dispatch the
// full pointer sequence the way a real click does so those components react.
// Untrusted events trigger no default action — a text input is not moved or
// selected — so callers follow up with el.click() or el.focus() themselves.
function firePointerSequence(el) {
  const rect = el.getBoundingClientRect();
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, opts));
  }
}

// Focus a text target with the caret at the end of its content — "i" should
// drop you at the end of the line, not the start. Inputs/textarea use the
// selection API; editable elements get a collapsed range at the end.
// Browsers apply their own focus default (caret at start) after a
// programmatic focus, and some sites re-place the caret in focus or
// autocomplete handlers — so placement is retried until it sticks.
function placeCaretAtEnd(el) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    try {
      const len = el.value ? el.value.length : 0;
      el.setSelectionRange(len, len);
    } catch {
      // Some input types (number, date, ...) reject selection ranges.
    }
    return;
  }
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // Not a real text entry (custom widget); focusing is all we can do.
  }
}

// Focus the target of a focus-mode hint. Some editors (ProseMirror,
// CodeMirror, Notion blocks) only enter an editable state on pointer input,
// so fire a pointer sequence after focusing.
function focusAndPlaceCaret(el) {
  const editable = el.querySelector(
    '[contenteditable="true"], [contenteditable="plaintext-only"], input:not([type="hidden"]), textarea',
  );
  if (editable) el = editable;

  el.focus();
  if (el.isConnected) firePointerSequence(el);
  if (el.isConnected && deepActiveElement() !== el) el.focus();
  // Place the caret immediately, then again across a window of ticks:
  // Chrome finalizes its focus default selection after the keydown, and
  // page handlers (React, autocomplete) can re-place the caret even later.
  // Each attempt re-verifies the element still owns focus; a fixed shot
  // count stops early so a page that keeps fighting the caret wins in the
  // end rather than Jari re-placing forever.
  const target = el;
  const shots = [0, 16, 32, 64, 128, 256];
  for (const delay of shots) {
    setTimeout(() => {
      if (deepActiveElement() !== target) return;
      placeCaretAtEnd(target);
    }, delay);
  }
}

// click labels everything clickable; newtab and yank only links (a button
// without an href has nothing to open or copy).
const MODES = {
  click: {
    selector: CLICKABLE_SELECTOR,
    pointerCursor: true,
    activate: activateClick,
  },
  newtab: {
    selector: CLICKABLE_SELECTOR,
    linkOnly: true,
    activate: openInNewTab,
  },
  yank: { selector: CLICKABLE_SELECTOR, linkOnly: true, activate: yankLink },
  focus: { selector: FOCUS_SELECTOR, activate: focusAndPlaceCaret },
  // background: same as newtab, but sticky — the hints stay up after a pick
  // so the next label can be typed immediately (opening several links in a
  // row). See onKeyDown for the keep-open handling.
  background: {
    selector: CLICKABLE_SELECTOR,
    linkOnly: true,
    sticky: true,
    activate: openInNewTab,
  },
};

function activateClick(el) {
  firePointerSequence(el);
  el.click();
}

// Hint labels are built from the configured character set (settings
// hintChars, default home-row set). Empty fallback can't happen —
// normalizeSettings guarantees at least four characters — but guard anyway.
function alphabet() {
  return settings.getHintChars() || settingsDefaults.hintChars;
}

let mode = null;
let labels = new Map(); // hint label -> target element
let overlays = new Map(); // hint label -> overlay element
let typed = "";
let hintsHost = null;
let consumed = new Set(); // elements already opened in sticky (background) mode

// All hint labels live in one host element that is attached to the page as a
// single node. Appending 100 individual boxes to the body (open) and removing
// them one by one (close) was a visible source of jank; a single host makes
// both a one-node mutation. The absolute .jari-hint children are positioned
// relative to the document origin, so their viewport-derived coordinates
// still land in the same place as when they hung directly off the body.
function getHintsHost() {
  if (hintsHost && hintsHost.isConnected) return hintsHost;
  hintsHost = document.createElement("div");
  hintsHost.className = "jari-hints-host";
  hintsHost.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;";
  document.body.appendChild(hintsHost);
  return hintsHost;
}

function isActive() {
  return mode !== null;
}

// Hints sit at scan-time coordinates; while they are up, any scroll — a
// window scroll, a page container (Instagram's feed scrolls inside its own
// box), or a scrollbar drag — detaches every label from its element. A
// capture-phase scroll listener re-anchors the labels to their elements'
// current positions and, once the scroll settles, re-scans the viewport so
// links that scrolled into view get labels and links that left lose them.
// Scrolling is allowed while hints are up (there is no wheel block): the
// re-anchor keeps the overlay glued to its elements during the scroll, and
// the debounced re-render fixes up the set afterwards. The listener is
// passive because there is nothing to cancel, and it only exists while hints
// are open so no listener cost leaks into normal browsing. The re-anchor
// runs once per frame: scroll events can fire many times per frame, and
// recomputing 100 rects each is wasted work.
let scrollTracking = null;
let trackingFrame = null;

function setScrollTracking(on) {
  if (on && !scrollTracking) {
    scrollTracking = () => {
      scheduleHintReposition();
      scheduleRerender();
    };
    window.addEventListener("scroll", scrollTracking, {
      capture: true,
      passive: true,
    });
  } else if (!on && scrollTracking) {
    window.removeEventListener("scroll", scrollTracking, { capture: true });
    scrollTracking = null;
  }
}

function scheduleHintReposition() {
  if (trackingFrame !== null) return;
  trackingFrame = requestAnimationFrame(repositionHints);
}

// A scroll settled: re-scan the current viewport and re-render the overlay.
// Runs on a timer so a long scroll does not trigger a full style pass (the
// dominant cost) on every frame — only once the scroll stops. The result is
// the same scan the first render used, minus elements already opened in
// sticky background mode, so labels stay on the links currently in view.
const RERENDER_DEBOUNCE_MS = 80;
let rerenderTimer = null;

function scheduleRerender() {
  if (rerenderTimer !== null) return;
  rerenderTimer = setTimeout(() => {
    rerenderTimer = null;
    if (mode) rerenderHints();
  }, RERENDER_DEBOUNCE_MS);
}

function rerenderHints() {
  const config = MODES[mode];
  const typedBefore = typed;
  const candidates = config.pointerCursor
    ? queryClickables(config.selector)
    : queryAll(config.selector);
  const { topLevel, rects, labels: hintLabels } = recomputeHints(
    candidates,
    config,
    consumed,
  );
  labels.clear();
  overlays.clear();
  const host = getHintsHost();
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < topLevel.length; i++) {
    const el = topLevel[i];
    const label = hintLabels[i];
    labels.set(label, el);
    const box = createHintOverlay(label, rects.get(el));
    overlays.set(label, box);
    fragment.appendChild(box);
  }
  host.replaceChildren(fragment);
  typed = typedBefore;
  // Labels shift when consumed elements drop out of sticky mode; a typed
  // prefix that no longer matches any label is stale, drop it.
  if (![...labels.keys()].some((l) => l.toLowerCase().startsWith(typed)))
    typed = "";
  updateHighlight();
  if (labels.size === 0) cancel();
}

// Re-pin every visible label to its element. Labels whose element scrolled
// out of the viewport are hidden (display:none — they are absolute, so no
// layout shifts); an element that scrolls back in is shown again. Detached
// elements from a virtualized re-render read as zero-size and hide.
function repositionHints() {
  trackingFrame = null;
  for (const [label, el] of labels) {
    const box = overlays.get(label);
    if (!box) continue;
    const rect = hintRect(el, el.getBoundingClientRect());
    const pos = labelPlacement(
      rect,
      window.scrollX,
      window.scrollY,
      window.innerWidth,
      window.innerHeight,
    );
    if (!pos) {
      box.style.display = "none";
      continue;
    }
    box.style.display = "";
    box.style.left = pos.left + "px";
    box.style.top = pos.top + "px";
  }
}

const POINTER_CAP = 200;

function isPointerCursor(style) {
  const cursor = style && style.cursor;
  return (
    cursor === "pointer" ||
    (typeof cursor === "string" && cursor.startsWith("url("))
  );
}

// Cheap pre-filters before any style read: no box (display:none subtree,
// collapsed template content) or fully off-viewport means no pointer target.
// The rect is recomputed by the visibility pass; within one synchronous scan
// the browser caches it, so the double read is near-free.
function isPointerCandidate(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.left >= vw || rect.top >= vh || rect.right <= 0 || rect.bottom <= 0)
    return false;
  // One computed-style read covers visibility and cursor; hidden elements are
  // dropped before the cursor test (visibility is inherited, so a hidden
  // ancestor is caught too).
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden") return false;
  return isPointerCursor(style);
}

// Click-hint candidates in flat-tree order: selector matches plus, when
// enabled, elements SurfingKeys treats as clickable via the cursor heuristic.
// Like queryAll, every element and open shadow root is walked (the flat tree
// keeps shadow content after its host), so the ancestor-before-descendant
// order the nesting logic relies on is preserved. Pointer-only additions are
// capped so the style reads stay bounded.
function queryClickables(selector, { pointerCursor = true } = {}) {
  const out = [];
  let pointerCount = 0;
  const visit = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(selector)) {
        out.push(el);
      } else if (
        pointerCursor &&
        pointerCount < POINTER_CAP &&
        isPointerCandidate(el)
      ) {
        pointerCount++;
        out.push(el);
      }
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return out;
}

function start(nextMode) {
  const config = MODES[nextMode];
  if (!config) return;
  cancel();

  const candidates = config.pointerCursor
    ? queryClickables(config.selector)
    : queryAll(config.selector);
  const {
    top: topLevel,
    rects,
    total: counted,
  } = scanElements(candidates, {
    passes: (el) => isInteractive(el) && (!config.linkOnly || linkHref(el)),
    visible: isVisible,
    occluded: isOccluded,
    max: MAX_HINTS,
    nested: treeItemNested,
  });
  // Wrapped or clipped anchors report one merged box (getBoundingClientRect)
  // whose edges can point at empty space; the hint label lands on the box
  // instead of a fragment that is actually visible. getClientRects gives the
  // per-line fragments, so re-pin the label to a real one (SurfingKeys'
  // getRealRect). Placement only — hit-testing already ran on the scan rect.
  for (const el of topLevel) {
    rects.set(el, hintRect(el, rects.get(el)));
  }
  const hintCount = topLevel.length;

  if (nextMode === "focus" && topLevel.length === 1) {
    focusAndPlaceCaret(topLevel[0]);
    return;
  }
  if (topLevel.length === 0) {
    ui.toast("No matches");
    return;
  }

  mode = nextMode;
  // Multiple focus targets: hint labels appear on each input so the user
  // can pick one; tell them the hints are up.
  if (nextMode === "focus") {
    ui.toast(`${hintCount} inputs — pick one`);
  }
  if (counted > MAX_HINTS) {
    ui.toast(`Showing ${hintCount} of ${counted} hints`);
  }
  const hintLabels = generateLabels(hintCount);
  // Build every box into a detached fragment and attach it to the host once,
  // so the page sees a single DOM mutation instead of one per hint.
  const host = getHintsHost();
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < hintCount; i++) {
    const el = topLevel[i];
    const label = hintLabels[i];
    labels.set(label, el);
    const box = createHintOverlay(label, rects.get(el));
    overlays.set(label, box);
    fragment.appendChild(box);
  }
  host.appendChild(fragment);
  setScrollTracking(true);
}

// An element must be genuinely interactive: not disabled and not an anchor
// without a usable href. Visibility and occlusion are checked separately so
// the visibility pass can reuse the rect it computed.
function isInteractive(el) {
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest(overlaySelectors)) return false;
  if (el.tagName === "A" || el.tagName === "AREA") {
    const href = el.getAttribute("href");
    if (href === null || href.trim() === "") return false;
  }
  return true;
}

// The part of `rect` inside the viewport, or null when none of it shows.
// An element cut off by the fold or scrolled under a sticky bar is still a
// valid hint target — its visible part is clickable — so both the visibility
// test and the occlusion hit-test work on this portion instead of the full
// rect.
function visiblePortion(rect) {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, vw);
  const bottom = Math.min(rect.bottom, vh);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

// The element's on-screen rect, or null when it is not visible: zero-size,
// entirely off-viewport (display:none anywhere collapses the rect to zero
// size), visibility:hidden on itself or an ancestor (computed visibility is
// inherited), own opacity:0, or an opacity:0 ancestor (checked last, via
// checkVisibility, because opacity does not inherit). One computed-style read
// covers the cheap cases, which is faster than checkVisibility's ancestor
// walk on element-heavy pages; the walk only runs for the few elements that
// survive the fast-fails.
function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // At least a sliver must be inside the viewport.
  const portion = visiblePortion(rect);
  if (!portion) return null;
  // A pixel or two of an element is noise, not a target.
  const MIN_VISIBLE = 4;
  if (portion.right - portion.left < MIN_VISIBLE) return null;
  if (portion.bottom - portion.top < MIN_VISIBLE) return null;

  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden") return null;
  if (parseFloat(style.opacity) === 0) return null;
  // opacity:0 on an ancestor hides the subtree even though the element's own
  // opacity is 1 (opacity does not inherit) — dropdowns, carousels and
  // fade-in panels keep their content at opacity:0 until shown. checkVisibility
  // walks the flat tree with cached render state and computes no style per
  // ancestor, so it stays cheap; the rect and computed-style fast-fails above
  // run first.
  if (
    typeof el.checkVisibility === "function" &&
    !el.checkVisibility({ opacityProperty: true })
  ) {
    return null;
  }
  return rect;
}

// True when the topmost element at the visible area's center blocks the
// candidate: a sticky bar, an absolutely-positioned sibling, a carousel
// overlap. The hit-test ignores pointer-events:none layers, so decorative
// overlays (Instagram's gradient bars) don't cause false skips. Form
// controls are almost never occluded and hit-testing every one is the
// dominant scan cost on input-heavy pages, so they skip the test
// (Surfingkeys does the same). The hit-test runs on the element's own root
// so shadow content is tested against its shadow tree instead of the
// document.
// Sample points across the visible portion, center first. Hint activation
// clicks the element directly (el.click()), never the hit-test point, so an
// element only needs ONE uncovered sample to be a useful hint target. The
// extra points only run when the center is covered, so the common case stays
// a single hit test.
function occlusionSamples(portion) {
  const { left, top, right, bottom } = portion;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const points = [[cx, cy]];
  const w = right - left;
  const h = bottom - top;
  if (w >= 8) points.push([left + w * 0.25, cy], [left + w * 0.75, cy]);
  if (h >= 8) points.push([cx, top + h * 0.25], [cx, top + h * 0.75]);
  return points;
}

// True when `rect` (viewport coordinates) overlaps the visible area of
// `node` — i.e. the element is not clipped out of this overflow container.
// The rect and the node's box are both viewport coordinates, so no scroll
// offset enters the comparison; the box is layout-cached by the browser
// after the scan's first getBoundingClientRect, so the check adds no style
// computation or reflow.
function rectOverlapsScrollport(rect, node) {
  const box = node.getBoundingClientRect();
  return (
    rect.bottom > box.top &&
    rect.top < box.bottom &&
    rect.right > box.left &&
    rect.left < box.right
  );
}

function isOccluded(el, rect) {
  // Scrolled out of a clipping ancestor's viewport: carousel trays and scroll
  // containers keep off-view items invisible even though their rect is still
  // inside the window viewport (Instagram's stories bar). Only an ancestor
  // whose content overflows its box can clip, so the cheap scroll-size read
  // gates the walk; among those, an overflow:visible box clips nothing. The
  // walk runs before the form-control shortcut so scrolled-out inputs are
  // rejected too, while they still skip their expensive elementFromPoint test.
  let node = el.parentElement || el.getRootNode().host;
  while (node) {
    if (
      node.scrollWidth > node.clientWidth ||
      node.scrollHeight > node.clientHeight
    ) {
      const style = window.getComputedStyle(node);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        if (!rectOverlapsScrollport(rect, node)) return true;
      }
    }
    node = node.parentElement || node.getRootNode().host;
  }
  if (el.matches("input, textarea, select, [contenteditable]")) return false;
  // Hit-test the visible portion, not the full rect: a link scrolled under a
  // sticky header or cut off by the fold has an off-screen or covered center
  // even though its visible part is clickable (Google's sticky search bar is
  // the classic case).
  const portion = visiblePortion(rect);
  if (!portion) return true;
  const root = el.getRootNode();
  for (const [x, y] of occlusionSamples(portion)) {
    const top = root.elementFromPoint(x, y);
    if (!top) continue;
    // Not occluded when the hit is the candidate, lives inside it, or wraps
    // it: sites like Google make the whole result row the click zone, so the
    // topmost element at a link's center is its own ancestor (the anchor is
    // pointer-events:none or display:contents behind it). Real occluders —
    // sticky headers, modals, carousels — are siblings of what they cover,
    // never ancestors, so they are still caught.
    if (containsElement(el, top) || containsElement(top, el)) return false;
  }
  return true;
}

// A treeitem's clickable ancestor is its folder row — a different action
// (expand/collapse) than the item itself (open a file) — so neither nests the
// other: both must get hints, or every file under an expanded folder (e.g.
// GitHub's file tree) would be hidden by the generic ancestor-dedup rule.
function isTreeItem(el) {
  return el.getAttribute?.("role") === "treeitem";
}
function treeItemNested(el, ancestor) {
  return !(isTreeItem(el) && isTreeItem(ancestor));
}

// One pass collects every hintable element together with its rect: the rect
// from the visibility check is reused for the occlusion test and for the
// overlay position, so no rect is read twice and no overlay append
// invalidates the next read. Scanning stops once `max` top-level elements
// are found — ancestors always precede descendants in document order, so
// nested matches are recognizable as we go and the remaining candidates only
// need a cheap count for the "Showing N of M" toast. That caps the expensive
// occlusion hit tests at ~max regardless of how many matches the page has.
// The predicates are injected so the scan is testable without a DOM; the DOM
// reads live in the callers, not here.
// `visible` returns the element's rect, or null when it cannot be seen.
// `occluded(el, rect)` says whether the element's visible part is covered.
// `nested(el, ancestor)` decides whether an already-collected ancestor that
// also matched should suppress the element's hint (default: yes — a clickable
// card wrapping its link is one click). Callers may exempt pairs that are
// distinct actions, like treeitem rows.
// Returns the top-level elements in document order, a rect per element, and
// the total count of viable elements for the toast.
function scanElements(
  candidates,
  { passes, visible, occluded, max, nested = () => true },
) {
  const top = [];
  const viableSet = new Set();
  const rects = new Map();
  let counted = 0;
  for (const el of candidates) {
    if (!passes(el)) continue;
    if (top.length >= max) {
      // Past the cap: no hit test, just count the visible survivors.
      if (visible(el)) counted++;
      continue;
    }
    const rect = visible(el);
    if (!rect) continue;
    if (occluded(el, rect)) continue;
    viableSet.add(el);
    rects.set(el, rect);
    counted++;
    // Top-level unless an already-collected ancestor nests it.
    let node = el.parentElement || el.getRootNode().host;
    let isNested = false;
    while (node) {
      if (viableSet.has(node) && nested(el, node)) {
        isNested = true;
        break;
      }
      node = node.parentElement || node.getRootNode().host;
    }
    if (!isNested) top.push(el);
  }
  return { top, rects, total: counted };
}

// Re-scan a fresh candidate list into a hint set, excluding elements already
// opened in sticky background mode. Shares the scan predicates and rect
// re-pinning with start(), so the scroll re-render and the first render
// agree on what is hintable. The count-for-toast is dropped: re-renders do
// not toast.
function recomputeHints(candidates, config, exclude) {
  const { top, rects } = scanElements(candidates, {
    passes: (el) =>
      isInteractive(el) && (!config.linkOnly || linkHref(el)) && !exclude.has(el),
    visible: isVisible,
    occluded: isOccluded,
    max: MAX_HINTS,
    nested: treeItemNested,
  });
  for (const el of top) {
    rects.set(el, hintRect(el, rects.get(el)));
  }
  return { topLevel: top, rects, labels: generateLabels(top.length) };
}

// Labels are always at least two characters (AA, AB, ...) and grow a
// character whenever the set is exhausted, so they never duplicate.
function generateLabels(count) {
  const chars = alphabet();
  const n = chars.length;
  const labels = [];
  let i = 0;
  let length = 2;
  while (i < count) {
    const combos = Math.pow(n, length);
    for (let k = 0; k < combos && i < count; k++, i++) {
      labels.push(toBase26(k, length, chars));
    }
    length++;
  }
  return labels;
}

function toBase26(value, length, chars) {
  const n = chars.length;
  let s = "";
  for (let p = 0; p < length; p++) {
    s = chars[value % n] + s;
    value = Math.floor(value / n);
  }
  return s;
}

function hintRect(el, fallback) {
  if (el.childElementCount === 0) {
    const rects = el.getClientRects();
    if (rects.length === 3) return rects[1];
    if (rects.length === 2) return rects[0];
  }
  return fallback;
}

function labelPlacement(rect, scrollX, scrollY, viewportWidth, viewportHeight) {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewportWidth);
  const bottom = Math.min(rect.bottom, viewportHeight);
  if (right <= left || bottom <= top) return null;
  return {
    left: scrollX + left,
    top: scrollY + Math.min(top, viewportHeight - LABEL_HEIGHT),
  };
}

function createHintOverlay(label, rect) {
  const box = document.createElement("div");
  box.className = "jari-hint";
  for (const ch of label) {
    const span = document.createElement("span");
    span.textContent = ch;
    box.appendChild(span);
  }
  const pos = labelPlacement(
    rect,
    window.scrollX,
    window.scrollY,
    window.innerWidth,
    window.innerHeight,
  );
  box.style.left = pos.left + "px";
  box.style.top = pos.top + "px";
  return box;
}

function openInNewTab(el) {
  const href = el.href || el.getAttribute?.("href");
  // Only hand web-ish URLs to the background. Anything else (javascript:,
  // data:, mailto:, ...) is a same-tab click, which the site itself offers.
  const scheme =
    href && href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (scheme && allowedUrlSchemes.has(scheme)) {
    sendMessage("openInBackgroundTab", { url: href });
  } else {
    firePointerSequence(el);
    el.click();
  }
}

function yankLink(el) {
  const href = el.href || el.getAttribute?.("href");
  if (href) {
    ui.copyText(href).then(() => ui.toast("Copied"));
  }
}

function onKeyDown(event) {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (event.key === "Escape") {
    cancel();
    return;
  }

  typed += event.key.toLowerCase();

  let exact = null;
  let partial = 0;
  for (const label of labels.keys()) {
    const lower = label.toLowerCase();
    if (lower === typed) exact = label;
    else if (lower.startsWith(typed)) partial++;
  }

  if (exact && partial === 0) {
    const modeConfig = MODES[mode];
    modeConfig.activate(labels.get(exact));
    if (modeConfig.sticky) {
      // Keep the hints up so the next link can be picked: drop the label
      // just used — each link opens once — and clear the typed buffer.
      consumed.add(labels.get(exact));
      const box = overlays.get(exact);
      if (box) box.remove();
      overlays.delete(exact);
      labels.delete(exact);
      typed = "";
      updateHighlight();
      if (labels.size === 0) cancel();
      return;
    }
    cancel();
    return;
  }
  if (!exact && partial === 0) {
    typed = "";
  }
  updateHighlight();
}

function updateHighlight() {
  for (const [label, box] of overlays) {
    const matches = label.toLowerCase().startsWith(typed);
    box.classList.toggle("jari-hint-dim", !matches);
    for (let i = 0; i < box.children.length; i++) {
      box.children[i].classList.toggle("muted", matches && i < typed.length);
    }
  }
}

function cancel() {
  setScrollTracking(false);
  if (rerenderTimer !== null) {
    clearTimeout(rerenderTimer);
    rerenderTimer = null;
  }
  if (trackingFrame !== null) {
    cancelAnimationFrame(trackingFrame);
    trackingFrame = null;
  }
  if (hintsHost) hintsHost.remove();
  hintsHost = null;
  overlays.clear();
  labels.clear();
  consumed.clear();
  typed = "";
  mode = null;
}

export const Hints = {
  start,
  cancel,
  onKeyDown,
  isActive,
  generateLabels,
  visiblePortion,
  scanElements,
  setScrollTracking,
  recomputeHints,
  labelPlacement,
  rectOverlapsScrollport,
  treeItemNested,
  clickableSelector: CLICKABLE_SELECTOR,
  isPointerCursor,
  queryClickables,
  hintRect,
};

register("hints", { close: cancel, onKeyDown, isActive });

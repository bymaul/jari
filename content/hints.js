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
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='option']",
  "[role='combobox']",
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
  click: { selector: CLICKABLE_SELECTOR, activate: activateClick },
  newtab: { selector: CLICKABLE_SELECTOR, linkOnly: true, activate: openInNewTab },
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
let blockWheel = null;

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

// While hints are up, a wheel scroll invalidates the hint set: boxes sit at
// scan-time coordinates, so after any scroll the overlay no longer matches
// what is on screen. onKeyDown already preventDefaults every key (so arrow
// keys, space and PageDown are dead), which leaves the wheel — the last
// unguarded way to move the page. The capture-phase listener cancels it for
// the whole window while hints are open. `passive: false` is required:
// Chrome treats wheel listeners on window/document/body as passive by
// default and would refuse to let a passive one cancel the scroll. The
// listener only exists while hints are open, so the non-passive cost is zero
// the rest of the time.
function setWheelBlocking(on) {
  if (on && !blockWheel) {
    blockWheel = (event) => event.preventDefault();
    window.addEventListener("wheel", blockWheel, { capture: true, passive: false });
  } else if (!on && blockWheel) {
    window.removeEventListener("wheel", blockWheel, { capture: true });
    blockWheel = null;
  }
}

function start(nextMode) {
  const config = MODES[nextMode];
  if (!config) return;
  cancel();

  const { top: topLevel, rects, total: counted } = scanElements(
    queryAll(config.selector),
    {
      passes: (el) => isInteractive(el) && (!config.linkOnly || linkHref(el)),
      visible: isVisible,
      occluded: isOccluded,
      max: MAX_HINTS,
    },
  );
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
    ui.toast(`Showing ${MAX_HINTS} of ${counted} hints`);
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
  setWheelBlocking(true);
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
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true })) {
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

function isOccluded(el, rect) {
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
// Returns the top-level elements in document order, a rect per element, and
// the total count of viable elements for the toast.
function scanElements(candidates, { passes, visible, occluded, max }) {
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
    // Top-level unless an already-collected ancestor is also a match.
    let node = el.parentElement || el.getRootNode().host;
    let nested = false;
    while (node) {
      if (viableSet.has(node)) {
        nested = true;
        break;
      }
      node = node.parentElement || node.getRootNode().host;
    }
    if (!nested) top.push(el);
  }
  return { top, rects, total: counted };
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

function createHintOverlay(label, rect) {
  const box = document.createElement("div");
  box.className = "jari-hint";
  // One span per character so updateHighlight can mute the typed prefix.
  for (const ch of label) {
    const span = document.createElement("span");
    span.textContent = ch;
    box.appendChild(span);
  }
  // Keep the box fully inside the viewport: a link with only a sliver
  // visible at the fold edge would otherwise put its label half off-screen.
  const top = Math.max(0, Math.min(rect.top, window.innerHeight - LABEL_HEIGHT));
  box.style.left = window.scrollX + rect.left + "px";
  box.style.top = window.scrollY + top + "px";
  return box;
}

function openInNewTab(el) {
  const href = el.href || el.getAttribute?.("href");
  // Only hand web-ish URLs to the background. Anything else (javascript:,
  // data:, mailto:, ...) is a same-tab click, which the site itself offers.
  const scheme = href && href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
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
  setWheelBlocking(false);
  if (hintsHost) hintsHost.remove();
  hintsHost = null;
  overlays.clear();
  labels.clear();
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
  setWheelBlocking,
};

register("hints", { close: cancel, onKeyDown, isActive });

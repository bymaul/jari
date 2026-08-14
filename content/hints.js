import {
  allowedUrlSchemes,
  containsElement,
  deepActiveElement,
  overlaySelectors,
  queryAll,
  settingsDefaults,
} from "./keymap.js";
import {
  MIN_VISIBLE_HINT_SIZE,
  OCCLUSION_SAMPLE_THRESHOLD,
} from "../shared/constants.js";
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";
import { register } from "./overlays.js";

const MAX_HINTS = 100;
const LABEL_HEIGHT = 20;

const STRONG_CLICKABLE_SELECTOR = [
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
  "[ng-click]",
  "[\\@click]",
  "[v-on\\:click]",
].join(",");

const WEAK_CLICKABLE_SELECTOR = [
  "[class*='button' i]",
  "[class*='btn' i]",
  "[class*='link' i]",
  "[class*='clickable' i]",
  "[class*='cursor-pointer' i]",
  "[aria-haspopup='true']",
  "[aria-pressed]",
  "[aria-expanded]",
  "[aria-controls]",
].join(",");

const CLICKABLE_SELECTOR = `${STRONG_CLICKABLE_SELECTOR},${WEAK_CLICKABLE_SELECTOR}`;

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

function linkHref(el) {
  const href = el.href || el.getAttribute?.("href");
  return typeof href === "string" && href.trim() !== "";
}

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

function eventCoords(el) {
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  return {
    clientX,
    clientY,
    screenX: window.screenX + clientX,
    screenY: window.screenY + clientY,
  };
}

function fireHoverSequence(el) {
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    ...eventCoords(el),
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
  for (const type of [
    "pointerover",
    "pointerenter",
    "mouseover",
    "mouseenter",
    "mousemove",
  ]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, opts));
  }
}

function firePressSequence(el) {
  const opts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    ...eventCoords(el),
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    view: window,
    detail: 1,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 }));
  const mousedown = new MouseEvent("mousedown", { ...opts, buttons: 1 });
  const mousedownCanceled = el.dispatchEvent(mousedown) === false;
  el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
  return mousedownCanceled;
}

function fireClick(el) {
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 0,
      detail: 1,
      ...eventCoords(el),
    }),
  );
}

function elClick(el) {
  let canceled = false;
  const guard = (event) => {
    canceled = event.defaultPrevented;
  };
  el.addEventListener("click", guard);
  try {
    el.click();
  } finally {
    el.removeEventListener("click", guard);
  }
  return canceled;
}

function hrefOf(el) {
  const href = el.href || el.getAttribute?.("href");
  return typeof href === "string" ? href : null;
}

function navigatesSameTab(el, href) {
  if (!href) return false;
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!href.startsWith("/") && !(scheme && /^https?$/i.test(scheme))) {
    return false;
  }
  const target = el.getAttribute?.("target");
  if (target && target.toLowerCase() !== "_self") return false;
  if (el.hasAttribute?.("download")) return false;
  return true;
}

function simulateClick(el) {
  const startHref = location.href;
  fireHoverSequence(el);
  const mousedownCanceled = firePressSequence(el);
  let clickCanceled;
  if (mousedownCanceled) {
    fireClick(el);
    clickCanceled = true;
  } else {
    clickCanceled = elClick(el);
  }
  const href = hrefOf(el);
  if (mousedownCanceled || clickCanceled || !navigatesSameTab(el, href)) return;
  setTimeout(() => {
    if (location.href === startHref) {
      try {
        window.location.assign(href);
      } catch {}
    }
  }, 300);
}

function placeCaretAtEnd(el) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    try {
      const len = el.value ? el.value.length : 0;
      el.setSelectionRange(len, len);
    } catch {

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

  }
}

function focusAndPlaceCaret(el) {
  const editable = el.querySelector(
    '[contenteditable="true"], [contenteditable="plaintext-only"], input:not([type="hidden"]), textarea',
  );
  if (editable) el = editable;

  el.focus();
  if (el.isConnected) firePointerSequence(el);
  if (el.isConnected && deepActiveElement() !== el) el.focus();
  placeCaretAtEnd(el);
  const fightFocusStealer = () => {
    if (el.isConnected) {
      el.focus();
      placeCaretAtEnd(el);
    }
    el.removeEventListener("focusout", fightFocusStealer);
  };

  el.addEventListener("focusout", fightFocusStealer);

  setTimeout(() => {
    el.removeEventListener("focusout", fightFocusStealer);
  }, 300);
}

function focusSingleInput() {
  if (mode !== "focus" || pendingTopLevel.length !== 1) return;
  const el = pendingTopLevel[0];
  cancel();
  focusAndPlaceCaret(el);
}

const MODES = {
  click: {
    selector: STRONG_CLICKABLE_SELECTOR,
    weak: WEAK_CLICKABLE_SELECTOR,
    pointerCursor: true,
    activate: activateClick,
  },
  newtab: {
    selector: STRONG_CLICKABLE_SELECTOR,
    linkOnly: true,
    activate: openInNewTab,
  },
  yank: {
    selector: STRONG_CLICKABLE_SELECTOR,
    linkOnly: true,
    activate: yankLink,
  },
  focus: { selector: FOCUS_SELECTOR, activate: focusAndPlaceCaret },
  background: {
    selector: STRONG_CLICKABLE_SELECTOR,
    linkOnly: true,
    sticky: true,
    activate: openInNewTab,
  },
};

const ACTIVATABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
].join(",");

function activateClick(el) {
  if (el.matches(FOCUS_SELECTOR) || el.querySelector(FOCUS_SELECTOR)) {
    focusAndPlaceCaret(el);
    return;
  }
  if (!el.matches(ACTIVATABLE_SELECTOR)) {
    const inner = el.querySelector(ACTIVATABLE_SELECTOR);
    if (inner) el = inner;
  }
  simulateClick(el);
}

function alphabet() {
  return settings.getHintChars() || settingsDefaults.hintChars;
}

let mode = null;
let needsRelay = false;
let labels = new Map();
let overlays = new Map();
let typed = "";
let hintsHost = null;
let blockWheel = null;

function getHintsHost() {
  if (hintsHost && hintsHost.isConnected) return hintsHost;
  hintsHost = document.createElement("div");
  hintsHost.className = "jari-hints-host";
  hintsHost.setAttribute("aria-hidden", "true");
  hintsHost.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;";
  document.body.appendChild(hintsHost);
  return hintsHost;
}

function isActive() {
  return mode !== null;
}

function setWheelBlocking(on) {
  if (on && !blockWheel) {
    blockWheel = (event) => event.preventDefault();
    window.addEventListener("wheel", blockWheel, {
      capture: true,
      passive: false,
    });
  } else if (!on && blockWheel) {
    window.removeEventListener("wheel", blockWheel, { capture: true });
    blockWheel = null;
  }
}

let scrollTracking = null;
let trackingFrame = null;

function setScrollTracking(on) {
  if (on && !scrollTracking) {
    scrollTracking = () => scheduleHintReposition();
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

function repositionHints() {
  trackingFrame = null;
  for (const [label, el] of labels) {
    const box = overlays.get(label);
    if (!box) continue;
    const rect = hintRect(el, el.getBoundingClientRect());
    const pos = labelPlacement(
      rect,
      settings.getHintPosition(),
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
    if (pos.transform) box.style.transform = pos.transform;
  }
}

function isPointerCursor(style) {
  const cursor = style && style.cursor;
  return (
    cursor === "pointer" ||
    (typeof cursor === "string" && cursor.startsWith("url("))
  );
}

const POINTER_CAP = 200;

function isPointerCandidate(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.left >= vw || rect.top >= vh || rect.right <= 0 || rect.bottom <= 0)
    return false;

  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden") return false;
  return isPointerCursor(style);
}

function isJsactionClick(el) {
  const jsaction = el.getAttribute?.("jsaction");
  if (!jsaction) return false;
  for (const rawRule of jsaction.split(";")) {
    const rule = rawRule.trim();
    if (!rule) continue;
    const split = rule.split(":");
    if (split.length < 1 || split.length > 2) continue;
    const eventType = split.length === 1 ? "click" : split[0];
    if (eventType !== "click") continue;
    const action = split.length === 1 ? rule : split[1];
    const [namespace, actionName = "_"] = action.split(".");
    if (namespace === "none" || actionName === "_") continue;
    return true;
  }
  return false;
}

function queryClickables(
  strongSelector,
  { weak: weakSelector, pointerCursor = true } = {},
) {
  const candidates = [];
  const weak = new WeakSet();
  let pointerCount = 0;
  const visit = (root) => {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(strongSelector) || isJsactionClick(el)) {
        candidates.push(el);
      } else if (weakSelector && el.matches(weakSelector)) {
        candidates.push(el);
        weak.add(el);
      } else if (
        pointerCursor &&
        pointerCount < POINTER_CAP &&
        isPointerCandidate(el)
      ) {
        pointerCount++;
        candidates.push(el);
      }
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return { candidates, weak };
}

let pendingTopLevel = [];
let pendingRects = new Map();
let pendingTotal = 0;

async function start(nextMode) {
  if (!chrome.runtime?.id) {
    console.debug(
      "[jari] Extension context invalidated. Skipping hint coordination.",
    );
    return;
  }

  try {
    const res = await chrome.runtime.sendMessage({
      type: "COORDINATE_HINTS",
      mode: nextMode,
    });
    needsRelay = Boolean(res && res.needsRelay);
    if (res && res.drawLocally) {
      const count = countHints(nextMode);
      if (count === 0) {
        cancel();
        ui.toast("No matches");
      } else if (nextMode === "focus" && pendingTopLevel.length === 1) {
        focusSingleInput();
      } else {
        drawHints(0);
      }
    }
  } catch (err) {
    console.debug(
      "[jari] Failed to coordinate hints (context likely invalidated):",
      err,
    );
    needsRelay = false;
  }
}

function countHints(nextMode) {
  const config = MODES[nextMode];
  if (!config) return 0;

  cancel();
  mode = nextMode;

  const { candidates, weak } = config.pointerCursor
    ? queryClickables(config.selector, { weak: config.weak })
    : { candidates: queryAll(config.selector), weak: new WeakSet() };

  const scanned = scanElements(candidates, {
    passes: (el) => isInteractive(el) && (!config.linkOnly || linkHref(el)),
    visible: isVisible,
    occluded: isOccluded,
    max: MAX_HINTS,

    nested: (el, ancestor) => !weak.has(ancestor) && treeItemNested(el, ancestor),
  });

  let top = scanned.top;
  const rects = scanned.rects;

  if (weak.size > 0) {
    top = top.filter(
      (el) =>
        !weak.has(el) ||
        !top.some((other) => other !== el && containsElement(el, other)),
    );
  }

  for (const el of top) {
    rects.set(el, hintRect(el, rects.get(el)));
  }

  pendingTopLevel = top;
  pendingRects = rects;
  pendingTotal = scanned.total;
  return top.length;
}

function drawHints(startIndex) {
  const hintCount = pendingTopLevel.length;
  if (hintCount === 0) return;

  if (pendingTotal > MAX_HINTS) {
    ui.toast(`Showing ${hintCount} of ${pendingTotal} hints`);
  }

  const hintLabels = generateLabels(hintCount, startIndex);

  const host = getHintsHost();
  const fragment = document.createDocumentFragment();
  const position = settings.getHintPosition();

  for (let i = 0; i < hintCount; i++) {
    const el = pendingTopLevel[i];
    const label = hintLabels[i];
    const box = createHintOverlay(label, pendingRects.get(el), position);
    if (!box) continue;
    labels.set(label, el);
    overlays.set(label, box);
    fragment.appendChild(box);
  }

  host.appendChild(fragment);
  setWheelBlocking(true);
  setScrollTracking(true);
}

function isInteractive(el) {
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest(overlaySelectors)) return false;
  if (el.tagName === "A" || el.tagName === "AREA") {
    const href = el.getAttribute("href");
    if (href === null || href.trim() === "") return false;
  }
  return true;
}

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

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const portion = visiblePortion(rect);
  if (!portion) return null;
  if (portion.right - portion.left < MIN_VISIBLE_HINT_SIZE) return null;
  if (portion.bottom - portion.top < MIN_VISIBLE_HINT_SIZE) return null;

  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden") return null;
  if (parseFloat(style.opacity) === 0) return null;

  if (
    typeof el.checkVisibility === "function" &&
    !el.checkVisibility({ opacityProperty: true })
  ) {
    return null;
  }
  return rect;
}

function occlusionSamples(portion) {
  const { left, top, right, bottom } = portion;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const points = [[cx, cy]];
  const w = right - left;
  const h = bottom - top;
  if (w >= OCCLUSION_SAMPLE_THRESHOLD)
    points.push([left + w * 0.25, cy], [left + w * 0.75, cy]);
  if (h >= OCCLUSION_SAMPLE_THRESHOLD)
    points.push([cx, top + h * 0.25], [cx, top + h * 0.75]);
  return points;
}

function rectOverlapsScrollport(rect, node) {
  const box = node.getBoundingClientRect();

  const vw = globalThis.window?.innerWidth;
  const vh = globalThis.window?.innerHeight;
  if (
    vh != null &&
    (box.bottom <= 0 || box.top >= vh || box.right <= 0 || box.left >= vw)
  ) {
    return true;
  }
  return (
    rect.bottom > box.top &&
    rect.top < box.bottom &&
    rect.right > box.left &&
    rect.left < box.right
  );
}

function isOccluded(el, rect) {
  const portion = visiblePortion(rect);
  if (!portion) return true;

  let node = el.parentElement || el.getRootNode().host;
  while (
    node &&
    node !== document.documentElement &&
    node !== document.body
  ) {
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

  const root = el.getRootNode();
  const points = occlusionSamples(portion);
  let occludedPoints = 0;

  for (const [x, y] of points) {
    const top = root.elementFromPoint(x, y);

    if (!top) {
      occludedPoints++;
      continue;
    }

    if (
      containsElement(el, top) ||
      containsElement(top, el) ||
      flatContains(el, top) ||
      flatContains(top, el)
    ) {
      return false;
    } else {
      occludedPoints++;
    }
  }

  return occludedPoints === points.length;
}

function flatParent(node) {
  if (node.assignedSlot) return node.assignedSlot;
  if (node.parentElement) return node.parentElement;
  if (node.getRootNode().host) return node.getRootNode().host;
  return null;
}

function flatContains(ancestor, node) {
  let current = node;
  while (current && current !== ancestor) {
    current = flatParent(current);
  }
  return current === ancestor;
}

function isTreeItem(el) {
  return el.getAttribute?.("role") === "treeitem";
}
function treeItemNested(el, ancestor) {
  return !(isTreeItem(el) && isTreeItem(ancestor));
}

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

      if (visible(el)) counted++;
      continue;
    }
    const rect = visible(el);
    if (!rect) continue;
    if (occluded(el, rect)) continue;
    viableSet.add(el);
    rects.set(el, rect);
    counted++;

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

function generateLabels(count, startIndex = 0) {
  const chars = alphabet();
  const n = chars.length;
  const labels = [];
  let i = 0;
  let length = 2;

  const totalToGenerate = count + startIndex;

  while (i < totalToGenerate) {
    const combos = Math.pow(n, length);
    for (let k = 0; k < combos && i < totalToGenerate; k++, i++) {
      if (i >= startIndex) {
        labels.push(toBase26(k, length, chars));
      }
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
  return fallback;
}

function labelPlacement(
  rect,
  position,
  scrollX,
  scrollY,
  viewportWidth,
  viewportHeight,
) {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewportWidth);
  const bottom = Math.min(rect.bottom, viewportHeight);
  if (right <= left || bottom <= top) return null;

  const [vert, horiz] = position.split("-");
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const anchorX = horiz === "center" ? cx : horiz === "right" ? right : left;
  const anchorY = vert === "middle" ? cy : vert === "bottom" ? bottom : top;

  const tx = horiz === "center" ? -50 : horiz === "right" ? -100 : 0;
  const ty = vert === "middle" ? -50 : vert === "bottom" ? -100 : 0;

  const half = LABEL_HEIGHT / 2;
  const minX = tx === -100 ? LABEL_HEIGHT : tx === -50 ? half : 0;
  const maxX =
    tx === -100 ? viewportWidth : tx === -50 ? viewportWidth - half : viewportWidth - LABEL_HEIGHT;
  const minY = ty === -100 ? LABEL_HEIGHT : ty === -50 ? half : 0;
  const maxY =
    ty === -100 ? viewportHeight : ty === -50 ? viewportHeight - half : viewportHeight - LABEL_HEIGHT;

  return {
    left: scrollX + Math.min(Math.max(anchorX, minX), maxX),
    top: scrollY + Math.min(Math.max(anchorY, minY), maxY),
    transform: `translate(${tx}%, ${ty}%)`,
  };
}

function createHintOverlay(label, rect, position) {
  const box = document.createElement("div");
  box.className = "jari-hint";
  for (const ch of label) {
    const span = document.createElement("span");
    span.textContent = ch;
    box.appendChild(span);
  }
  const pos = labelPlacement(
    rect,
    position,
    window.scrollX,
    window.scrollY,
    window.innerWidth,
    window.innerHeight,
  );
  if (!pos) return null;
  box.style.left = pos.left + "px";
  box.style.top = pos.top + "px";
  if (pos.transform) box.style.transform = pos.transform;
  return box;
}

function openInNewTab(el) {
  const href = el.href || el.getAttribute?.("href");

  const scheme =
    href && href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (scheme && allowedUrlSchemes.has(scheme)) {
    sendMessage("openInBackgroundTab", { url: href });
  } else {
    simulateClick(el);
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

  const state = handleHintKey(event.key);
  if (needsRelay) {
    try {
      const p = chrome.runtime.sendMessage({
        type: "HINTS_KEY",
        key: event.key,
        remaining: state.remaining,
        closed: state.closed,
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {

    }
  }
}

function handleHintKey(key) {
  if (key === "Escape") {
    cancel();
    return { remaining: 0, closed: true };
  }

  typed += key.toLowerCase();

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

      const box = overlays.get(exact);
      if (box) box.remove();
      overlays.delete(exact);
      labels.delete(exact);
      typed = "";
      updateHighlight();
      if (labels.size === 0) {
        cancel();
        return { remaining: 0, closed: true };
      }
      return { remaining: labels.size, closed: false };
    }
    cancel();
    return { remaining: 0, closed: true };
  }
  if (!exact && partial === 0) {
    typed = "";
  }
  updateHighlight();
  return { remaining: labels.size, closed: false };
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
  setScrollTracking(false);
  if (trackingFrame !== null) {
    cancelAnimationFrame(trackingFrame);
    trackingFrame = null;
  }
  if (hintsHost) hintsHost.remove();
  hintsHost = null;
  overlays.clear();
  labels.clear();
  typed = "";
  mode = null;
  needsRelay = false;
}

export const Hints = {
  start,
  cancel,
  onKeyDown,
  isActive,
  placeCaretAtEnd,
  generateLabels,
  visiblePortion,
  isOccluded,
  scanElements,
  setWheelBlocking,
  setScrollTracking,
  labelPlacement,
  rectOverlapsScrollport,
  treeItemNested,
  clickableSelector: CLICKABLE_SELECTOR,
  isPointerCursor,
  isJsactionClick,
  queryClickables,
  flatContains,
  hintRect,
  simulateClick,
};

register("hints", { close: cancel, onKeyDown, isActive });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "COUNT_HINTS") {
    sendResponse(countHints(msg.mode));
  } else if (msg.type === "DRAW_HINTS") {
    drawHints(msg.startIndex);
  } else if (msg.type === "HINTS_RESET") {
    cancel();
    if (msg.toast) ui.toast(msg.toast);
  } else if (msg.type === "HINTS_KEY") {
    sendResponse(handleHintKey(msg.key));
  } else if (msg.type === "HINTS_FOCUS_SINGLE") {
    focusSingleInput();
  } else if (msg.type === "HINTS_CLOSE") {
    cancel();
  }
});

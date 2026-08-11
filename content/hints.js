// Jari: link-hint mode (f / i).
// Overlays a letter label on visible clickable/input elements; typing the
// label resolves it. Modes:
//   click  - activate the element (same tab)
//   newtab - open anchors in a background tab, otherwise click
//   yank   - copy the link URL to the clipboard (yf)
//   focus  - focus inputs; auto-focuses when exactly one match exists
import {
  allowedUrlSchemes,
  deepActiveElement,
  overlaySelectors,
  queryAll,
  settingsDefaults,
} from "./keymap.js";
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";

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

function isActive() {
  return mode !== null;
}

function start(nextMode) {
  const config = MODES[nextMode];
  if (!config) return;
  cancel();

  const elements = topLevelElements(
    queryAll(config.selector)
      .filter(isInteractive)
      .filter((el) => !config.linkOnly || linkHref(el)),
  );
  if (nextMode === "focus" && elements.length === 1) {
    focusAndPlaceCaret(elements[0]);
    return;
  }
  if (elements.length === 0) {
    ui.toast("No matches");
    return;
  }

  mode = nextMode;
  // Multiple focus targets: hint labels appear on each input so the user
  // can pick one; tell them the hints are up.
  if (nextMode === "focus") {
    ui.toast(`${elements.length} inputs — pick one`);
  }
  const hintLabels = generateLabels(elements.length);
  elements.forEach((el, i) => {
    const label = hintLabels[i];
    labels.set(label, el);
    overlays.set(label, createHintOverlay(label, el));
  });
}

// An element must be on-screen and genuinely interactive: not disabled,
// not hidden, and not an anchor without a usable href.
function isInteractive(el) {
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest(overlaySelectors)) return false;
  if (el.tagName === "A" || el.tagName === "AREA") {
    const href = el.getAttribute("href");
    if (href === null || href.trim() === "") return false;
  }
  return isVisible(el);
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (rect.width <= 0 || rect.height <= 0) return false;
  // Must be fully inside the viewport.
  if (rect.top < 0 || rect.left < 0 || rect.bottom > vh || rect.right > vw) return false;

  // Walk up the tree: an ancestor can hide the whole subtree even when the
  // element still reports a non-zero rect — e.g. custom-styled radios are
  // often opacity:0, or carousel slides are visibility:hidden. Crosses
  // shadow boundaries to the host so a shadow subtree inherits the host's
  // visibility.
  let node = el;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute("hidden")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (parseFloat(style.opacity) === 0) return false;
    }
    node = node.getRootNode().host || node.parentElement;
  }
  return true;
}

// Drop nested matches: if an element sits inside another matched element,
// only keep the outermost one so hints don't pile up on the same spot
// (e.g. <a><button>x</button></a>). Shadow boundaries are crossed to the
// host, so a clickable inside a shadow tree counts as nested under a host
// that is itself a match.
function topLevelElements(elements) {
  const set = new Set(elements);
  return elements.filter((el) => {
    let node = el.parentElement || el.getRootNode().host;
    while (node) {
      if (set.has(node)) return false;
      node = node.parentElement || node.getRootNode().host;
    }
    return true;
  });
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

function createHintOverlay(label, el) {
  const rect = el.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "jari-hint";
  // One span per character so updateHighlight can mute the typed prefix.
  for (const ch of label) {
    const span = document.createElement("span");
    span.textContent = ch;
    box.appendChild(span);
  }
  box.style.left = window.scrollX + rect.left + "px";
  box.style.top = window.scrollY + rect.top + "px";
  document.body.appendChild(box);
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
    MODES[mode].activate(labels.get(exact));
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
  for (const box of overlays.values()) box.remove();
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
};

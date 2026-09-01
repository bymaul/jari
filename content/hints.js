import { overlaySelectors, queryAll } from "./keymap.js";
import { settings } from "./settings.js";
import { sendMessage, ui } from "./ui.js";
import { blockedUrlSchemes } from "../shared/url.js";
import { register } from "./overlays.js";

const CLICKABLE_SELECTOR =
  "a, button, select, input, textarea, summary, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button, *[role=button], *[role=link], *[role=menuitem], *[role=option], *[role=switch], *[role=tab], *[role=checkbox], *[role=combobox], *[role=menuitemcheckbox], *[role=menuitemradio]";
const INPUT_SELECTOR =
  'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"]';

let active = false;
let container = null;
let elements = [];
let hints = [];
let prefix = "";
let mode = "click";
let multipleHits = false;
let scrollListener = null;

function isActive() {
  return active;
}

function normalizeCharset() {
  const s = settings.getHintChars ? settings.getHintChars() : "asdfgqwertzxcvb";
  if (!s) return "asdfgqwertzxcvb";
  return s.toLowerCase();
}

export function genLabels(count, charset) {
  const chars = (charset || normalizeCharset()).toUpperCase().split("");
  if (count <= 0) return [];
  if (chars.length < 2) return [];
  if (count <= chars.length) return chars.slice(0, count);
  const labels = chars.slice();
  let head = 0;
  while (labels.length - head < count) {
    if (head >= labels.length) break;
    const prefix = labels[head++];
    for (const c of chars) {
      labels.push(prefix + c);
      if (labels.length - head >= count) break;
      if (labels.length > 10000) break;
    }
    if (labels.length > 10000) break;
  }
  const out = labels.slice(head, head + count);
  // Fallback to uniform length if still not prefix-free due to edge
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      if (i !== j && out[j].startsWith(out[i])) {
        // not prefix-free, regenerate with uniform length
        let L = 1;
        while (Math.pow(chars.length, L) < count) L++;
        const uni = [];
        for (let k = 0; k < count; k++) {
          let n = k;
          let s = "";
          for (let p = 0; p < L; p++) {
            s = chars[n % chars.length] + s;
            n = Math.floor(n / chars.length);
          }
          uni.push(s);
        }
        return uni;
      }
    }
  }
  return out;
}

function isVisible(el) {
  let node = el;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute && node.hasAttribute("hidden")) return false;
      try {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (parseFloat(style.opacity) === 0) return false;
      } catch {
        // ignore
      }
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node = (root && root.host) ? root.host : node.parentElement;
  }
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
  if (rect.width === 0 && rect.height === 0) {
    const rects = el.getClientRects ? el.getClientRects() : [];
    if (rects.length === 0) return false;
  }
  return true;
}

function isInViewport(rect) {
  if (!rect) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

function getRealRect(el) {
  try {
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return el.getBoundingClientRect();
    if (rects.length === 1) return rects[0];
    let best = rects[0];
    let bestArea = 0;
    for (const r of rects) {
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = r;
      }
    }
    return bestArea > 0 ? best : rects[0];
  } catch {
    return el.getBoundingClientRect();
  }
}

function isElementClickable(el) {
  try {
    if (el.matches && el.matches(CLICKABLE_SELECTOR)) return true;
  } catch {}
  try {
    const style = window.getComputedStyle(el);
    const cursor = style.cursor || "";
    if (cursor === "pointer") return true;
    if (cursor.startsWith("url(")) return true;
  } catch {}
  try {
    if (el.closest) {
      const anc = el.closest("a, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button");
      if (anc) return true;
    }
  } catch {}
  return false;
}

function getHref(el) {
  try {
    if (el.href) return el.href;
  } catch {}
  const raw = el.getAttribute ? (el.getAttribute("href") || el.getAttribute("xlink:href")) : null;
  if (!raw) return null;
  if (raw.startsWith("#") || raw.trim() === "") return null;
  try {
    const url = new URL(raw, location.href);
    return url.href;
  } catch {
    return null;
  }
}

function isOpenableLink(el) {
  const href = getHref(el);
  if (!href) return false;
  try {
    const url = new URL(href);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    if (blockedUrlSchemes.has(scheme)) return false;
    if (scheme === "javascript" || scheme === "data" || scheme === "vbscript") return false;
    return true;
  } catch {
    return false;
  }
}

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute ? el.getAttribute("role") : null;
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  return false;
}

function filterVisible(candidates) {
  const out = [];
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const rect = getRealRect(el);
    if (!isInViewport(rect)) continue;
    if (el.closest && el.closest(overlaySelectors)) continue;
    out.push(el);
  }
  return out;
}

function filterOverlap(candidates) {
  const out = [];
  for (const el of candidates) {
    const rect = getRealRect(el);
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
    let hit = null;
    try {
      hit = document.elementFromPoint(cx, cy);
    } catch {}
    if (!hit) {
      out.push(el);
      continue;
    }
    if (hit === el || el.contains(hit) || hit.contains(el)) {
      out.push(el);
      continue;
    }
    try {
      const root = hit.getRootNode ? hit.getRootNode() : null;
      if (root && root.host) {
        const host = root.host;
        if (host === el || el.contains(host) || host.contains(el)) {
          out.push(el);
          continue;
        }
      }
    } catch {}
    // check if element is inside hit's shadow? fallback keep if rect visibly not occluded?
    // If hit is inside a hint overlay, ignore
    try {
      if (hit.closest && hit.closest(".jari-hint, .jari-hints")) {
        out.push(el);
        continue;
      }
    } catch {}
    // otherwise considered overlapped, skip
  }
  return out;
}

function filterAncestors(candidates) {
  const sorted = candidates.slice().sort((a, b) => {
    let da = 0, db = 0;
    let n = a; while (n.parentElement) { da++; n = n.parentElement; }
    n = b; while (n.parentElement) { db++; n = n.parentElement; }
    return da - db;
  });
  const keep = [];
  for (const el of sorted) {
    let inside = false;
    for (const k of keep) {
      try {
        if (k.contains(el)) { inside = true; break; }
      } catch {}
    }
    if (!inside) keep.push(el);
  }
  return keep;
}

function getClickableElements() {
  const all = queryAll("*");
  const raw = [];
  for (const el of all) {
    if (el.closest && el.closest(overlaySelectors)) continue;
    if (isElementClickable(el)) raw.push(el);
  }
  // Fallback if few? include all matched selector anyway
  return raw;
}

function getLinkElements() {
  const withHref = queryAll("[href]");
  const raw = [];
  for (const el of withHref) {
    if (el.closest && el.closest(overlaySelectors)) continue;
    if (isOpenableLink(el)) raw.push(el);
  }
  return raw;
}

function getInputElements() {
  const raw = queryAll(INPUT_SELECTOR);
  const out = [];
  for (const el of raw) {
    if (el.closest && el.closest(overlaySelectors)) continue;
    const type = el.getAttribute ? (el.getAttribute("type") || "").toLowerCase() : "";
    if (type === "hidden") continue;
    if (el.disabled) continue;
    out.push(el);
  }
  return out;
}

function collectElements(requestedMode) {
  let raw = [];
  if (requestedMode === "click") raw = getClickableElements();
  else if (requestedMode === "open" || requestedMode === "openBackground") raw = getLinkElements();
  else if (requestedMode === "input") raw = getInputElements();
  let filtered = filterVisible(raw);
  filtered = filterOverlap(filtered);
  filtered = filterAncestors(filtered);
  return filtered;
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
    hintEl.appendChild(pre);
    hintEl.appendChild(rest);
    hintEl.classList.remove("jari-hint-hidden");
  } else if (typed.startsWith(label)) {
    // exact match will be activated, not rendered
    hintEl.textContent = label;
  } else {
    hintEl.textContent = label;
  }
}

function refresh() {
  if (!active) return;
  let visibleCount = 0;
  for (const h of hints) {
    if (!prefix) {
      h.hintEl.style.opacity = "1";
      h.hintEl.style.display = "";
      h.hintEl.classList.remove("jari-hint-hidden");
      updateHintText(h.hintEl, h.label, "");
      visibleCount++;
    } else if (h.label === prefix) {
      // will activate, handled outside
      h.hintEl.style.opacity = "1";
    } else if (h.label.startsWith(prefix)) {
      h.hintEl.style.opacity = "1";
      h.hintEl.style.display = "";
      updateHintText(h.hintEl, h.label, prefix);
      visibleCount++;
    } else {
      h.hintEl.style.opacity = "0";
      h.hintEl.style.display = "none";
    }
  }
  if (prefix && visibleCount === 0) {
    // no match, keep hidden but allow backspace
  }
}

function flashElement(el) {
  const prevOutline = el.style.outline;
  const prevOutlineOffset = el.style.outlineOffset;
  el.style.outline = "2px solid #e0a363";
  el.style.outlineOffset = "1px";
  setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOutlineOffset;
  }, 300);
}

function dispatchClick(el) {
  try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {}
  const events = ["mouseover", "mousedown", "mouseup", "click"];
  for (const type of events) {
    try {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: type === "mousedown" ? 1 : 0 });
      el.dispatchEvent(ev);
    } catch {}
  }
  try { if (typeof el.focus === "function") el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
}

function focusInput(el) {
  try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      const len = el.value ? el.value.length : 0;
      if (typeof el.select === "function" && el.type !== "checkbox" && el.type !== "radio") {
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
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch {}
  }
  flashElement(el);
}

function render() {
  if (container) { try { container.remove(); } catch {} container = null; }
  container = document.createElement("div");
  container.className = "jari-hints";
  const parent = document.body || document.documentElement;
  parent.appendChild(container);

  const charset = normalizeCharset();
  const labels = genLabels(elements.length, charset);
  hints = [];
  const lastPos = { left: -1000, top: -1000 };
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const label = labels[i];
    const rect = getRealRect(el);
    const hintEl = document.createElement("span");
    hintEl.className = "jari-hint";
    hintEl.dataset.label = label;
    updateHintText(hintEl, label, "");
    let left = window.scrollX + rect.left;
    let top = window.scrollY + rect.top;
    // de-overlap: if too close to previous hint, shift a bit
    if (Math.abs(left - lastPos.left) < 20 && Math.abs(top - lastPos.top) < 10) {
      left += 20;
      top += 0;
    }
    // clamp inside viewport
    const maxLeft = window.scrollX + window.innerWidth - 40;
    const minLeft = window.scrollX;
    if (left > maxLeft) left = maxLeft;
    if (left < minLeft) left = minLeft;
    hintEl.style.left = left + "px";
    hintEl.style.top = top + "px";
    const z = (() => {
      try {
        const cz = window.getComputedStyle(el).zIndex;
        const n = parseInt(cz, 10);
        return Number.isFinite(n) ? n + 10000 : 2147483646;
      } catch { return 2147483646; }
    })();
    hintEl.style.zIndex = String(z);
    container.appendChild(hintEl);
    hints.push({ el, label, hintEl, rect });
    lastPos.left = left;
    lastPos.top = top;
  }
  refresh();
}

function close() {
  if (!active) return;
  active = false;
  prefix = "";
  elements = [];
  hints = [];
  if (container) {
    try { container.remove(); } catch {}
    container = null;
  }
  if (scrollListener) {
    try { window.removeEventListener("scroll", scrollListener); } catch {}
    scrollListener = null;
  }
  try { window.removeEventListener("resize", close); } catch {}
}

function open(requestedMode) {
  if (active) close();
  let m = requestedMode;
  if (m === "click") { mode = "click"; multipleHits = false; }
  else if (m === "open") { mode = "open"; multipleHits = false; }
  else if (m === "openBackground") { mode = "openBackground"; multipleHits = true; }
  else if (m === "input") { mode = "input"; multipleHits = false; }
  else { mode = "click"; multipleHits = false; }

  let candidates = collectElements(mode);

  if (mode === "input") {
    if (candidates.length === 0) {
      ui.toast("No inputs");
      return;
    }
    if (candidates.length === 1) {
      focusInput(candidates[0]);
      return;
    }
  }

  if (candidates.length === 0) {
    ui.toast(mode === "input" ? "No inputs" : "No hints");
    return;
  }

  elements = candidates;
  prefix = "";
  active = true;

  render();

  // close on scroll/resize
  scrollListener = () => close();
  window.addEventListener("scroll", scrollListener, { once: true, capture: true });
  window.addEventListener("resize", close, { once: true });
}

function activate(el) {
  if (mode === "click") {
    if (isEditable(el)) {
      focusInput(el);
    } else {
      dispatchClick(el);
      flashElement(el);
    }
    if (!multipleHits) close();
    else {
      prefix = "";
      refresh();
    }
  } else if (mode === "open") {
    const url = getHref(el);
    if (url) {
      sendMessage("openInForegroundTab", { url });
    } else {
      dispatchClick(el);
    }
    if (!multipleHits) close();
    else { prefix = ""; refresh(); }
  } else if (mode === "openBackground") {
    const url = getHref(el);
    if (url) {
      sendMessage("openInBackgroundTab", { url });
    }
    flashElement(el);
    if (!multipleHits) close();
    else {
      prefix = "";
      refresh();
    }
  } else if (mode === "input") {
    focusInput(el);
    close();
  }
}

function onKeyDown(event) {
  if (!active) return false;
  const key = event.key;
  if (key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (prefix.length > 0) {
      prefix = "";
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Backspace") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (prefix.length > 0) {
      prefix = prefix.slice(0, -1);
      refresh();
    } else {
      close();
    }
    return true;
  }
  if (key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    // if single visible hint, activate it
    const visible = hints.filter(h => h.label.startsWith(prefix));
    if (visible.length === 1) activate(visible[0].el);
    return true;
  }
  if (key.length === 1) {
    const charset = normalizeCharset();
    const lower = key.toLowerCase();
    if (charset.includes(lower)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = prefix + lower.toUpperCase();
      // Check if any label starts with next
      const any = hints.some(h => h.label.startsWith(next));
      const exact = hints.find(h => h.label === next);
      if (exact) {
        prefix = next;
        refresh();
        activate(exact.el);
      } else if (any) {
        prefix = next;
        refresh();
      } else {
        // invalid prefix - still show feedback by hiding all
        prefix = next;
        refresh();
        // if no hints visible, we allow backspace; keep prefix
      }
      return true;
    }
  }
  // Any other key while hints active should be swallowed to prevent page handling
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

export const Hints = { open, close, isActive, onKeyDown, genLabels };

register("hints", { close, onKeyDown, isActive });

export function __testReset() {
  close();
  prefix = "";
  elements = [];
  hints = [];
}

export const __testHelpers = {
  getHref,
  isOpenableLink,
  isElementClickable,
  isVisible,
  isInViewport,
  getRealRect,
  filterVisible,
  filterOverlap,
  filterAncestors,
  collectElements,
};

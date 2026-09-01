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
let scrollHandler = null;
let resizeHandler = null;
let mutationObserver = null;
let regenerateTimer = null;
let scrollEndTimer = null;
let hintPill = null;

function showHintPill() {
  if (hintPill) return;
  try {
    hintPill = document.createElement("div");
    hintPill.className = "jari-pill";
    hintPill.textContent = "Hints";
    ui.statusContainer().appendChild(hintPill);
  } catch {}
}

function hideHintPill() {
  if (!hintPill) return;
  try { hintPill.remove(); } catch {}
  hintPill = null;
}

function hideHints() {
  if (container) {
    container.style.display = "none";
  }
  prefix = "";
}

function scheduleRegenerate() {
  if (regenerateTimer) return;
  regenerateTimer = setTimeout(() => {
    regenerateTimer = null;
    if (!active) return;
    const savedPrefix = prefix;
    const fresh = collectElements(mode);
    if (fresh.length === 0) { close(); ui.toast("No hints"); return; }
    const capped = fresh.length > 800 ? fresh.slice(0, 800) : fresh;
    if (capped.length !== fresh.length) {
      ui.toast(`Too many hints (${capped.length} shown)`);
    }
    elements = capped;
    render();
    if (container) {
      container.style.display = "";
    }
    prefix = savedPrefix;
    refresh();
    const any = hints.some((h) => h.label.startsWith(prefix));
    if (prefix && !any) { prefix = ""; refresh(); }
  }, 150);
}

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
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  try {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      try {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, checkContentVisibility: true })) return false;
      } catch {}
    }
  } catch {}
  let node = el;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute && node.hasAttribute("hidden")) return false;
      if (node.hasAttribute && node.hasAttribute("inert")) return false;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return false;
      if (node.closest) {
        try {
          if (node.closest("[hidden]")) return false;
          if (node.closest("[inert]")) return false;
          const details = node.closest("details:not([open])");
          if (details && !node.closest("summary") && details.contains(el)) return false;
        } catch {}
      }
      try {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
        if (parseFloat(style.opacity) === 0) return false;
        if (style.contentVisibility === "hidden") return false;
      } catch {}
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node = (root && root.host) ? root.host : node.parentElement;
  }
  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
  const rects = el.getClientRects ? el.getClientRects() : [];
  const hasSize = rect.width >= 1 && rect.height >= 1;
  const hasRects = rects.length > 0 && Array.from(rects).some((r) => r.width >= 1 && r.height >= 1);
  if (!hasSize && !hasRects) return false;
  if (!isEditable(el)) {
    const min = 4;
    if (rect.width < min || rect.height < min) {
      let ok = false;
      for (const r of rects) if (r.width >= min && r.height >= min) { ok = true; break; }
      if (!ok && rect.width < min && rect.height < min) return false;
    }
  } else {
    if (rect.width < 1 || rect.height < 1) return false;
  }
  try {
    const style = window.getComputedStyle(el);
    if (style.pointerEvents === "none" && !isEditable(el)) {
      // still consider visible but not clickable; let isElementClickable decide
    }
    if (style.position !== "fixed" && style.position !== "sticky") {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) {
        if (!hasSize && !hasRects) return false;
      }
    }
  } catch {}
  return true;
}

function isClippedByOverflow(el) {
  const rect = getRealRect(el);
  if (!rect || rect.width <= 0 || rect.height <= 0) return true;
  try {
    const style = window.getComputedStyle(el);
    if (style.position === "fixed") return false;
  } catch {}
  let parent = el.parentElement;
  if (!parent) {
    try {
      const root = el.getRootNode?.();
      if (root && root.host) parent = root.host;
    } catch {}
  }
  while (parent && parent !== document.body && parent !== document.documentElement) {
    try {
      const pStyle = window.getComputedStyle(parent);
      const overflowVals = [pStyle.overflow, pStyle.overflowX, pStyle.overflowY];
      const isClip = overflowVals.some((v) => v && ["hidden", "clip", "scroll", "auto"].includes(v));
      const hasClipPath = pStyle.clipPath && pStyle.clipPath !== "none";
      const hasContainPaint = pStyle.contain && pStyle.contain.includes("paint");
      if (isClip || hasClipPath || hasContainPaint) {
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width === 0 && parentRect.height === 0) {
          // no area, skip
        } else {
          const tol = 1;
          if (
            rect.right <= parentRect.left + tol ||
            rect.left >= parentRect.right - tol ||
            rect.bottom <= parentRect.top + tol ||
            rect.top >= parentRect.bottom - tol
          ) {
            return true;
          }
          const pClientTop = parentRect.top + (parseFloat(pStyle.borderTopWidth) || 0);
          const pClientLeft = parentRect.left + (parseFloat(pStyle.borderLeftWidth) || 0);
          const pClientRight = parentRect.right - (parseFloat(pStyle.borderRightWidth) || 0);
          const pClientBottom = parentRect.bottom - (parseFloat(pStyle.borderBottomWidth) || 0);
          if (
            rect.right <= pClientLeft + tol ||
            rect.left >= pClientRight - tol ||
            rect.bottom <= pClientTop + tol ||
            rect.top >= pClientBottom - tol
          ) {
            return true;
          }
        }
      }
    } catch {}
    let next;
    try {
      const root = parent.getRootNode?.();
      if (root && root.host) next = root.host;
      else next = parent.parentElement;
    } catch {
      next = parent.parentElement;
    }
    parent = next;
    if (!parent || parent === document.documentElement) break;
  }
  return false;
}

function isInViewport(rect) {
  if (!rect) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  const tol = 2;
  if (rect.bottom <= tol || rect.top >= window.innerHeight - tol) return false;
  if (rect.right <= tol || rect.left >= window.innerWidth - tol) return false;
  if (rect.top > window.innerHeight - 2 || rect.left > window.innerWidth - 2) return false;
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
    if (isClippedByOverflow(el)) continue;
    if (el.closest && el.closest(overlaySelectors)) continue;
    out.push(el);
  }
  return out;
}

function isTopmostAt(el, x, y) {
  let hit;
  try {
    hit = document.elementFromPoint(x, y);
  } catch { return false; }
  if (!hit) return false;
  if (hit === el || el.contains(hit) || hit.contains(el)) return true;
  try {
    const root = hit.getRootNode ? hit.getRootNode() : null;
    if (root && root.host) {
      const host = root.host;
      if (host === el || el.contains(host) || host.contains(el)) return true;
    }
  } catch {}
  try {
    if (hit.closest && hit.closest(".jari-hint, .jari-hints")) return true;
  } catch {}
  return false;
}

function filterOverlap(candidates) {
  const out = [];
  for (const el of candidates) {
    const rect = getRealRect(el);
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
    if (isTopmostAt(el, cx, cy)) {
      out.push(el);
      continue;
    }
    const x2 = Math.min(Math.max(rect.left + 4, 0), window.innerWidth - 1);
    const y2 = Math.min(Math.max(rect.top + 4, 0), window.innerHeight - 1);
    if (isTopmostAt(el, x2, y2)) {
      out.push(el);
      continue;
    }
    const x3 = Math.min(Math.max(rect.right - 4, 0), window.innerWidth - 1);
    const y3 = Math.min(Math.max(rect.top + 4, 0), window.innerHeight - 1);
    if (isTopmostAt(el, x3, y3)) {
      out.push(el);
      continue;
    }
  }
  return out;
}

function scoreForDedupe(el) {
  let score = 0;
  try {
    if (el.matches && el.matches(CLICKABLE_SELECTOR)) score += 10;
  } catch {}
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "SUMMARY") score += 5;
  if (el.hasAttribute && el.hasAttribute("href")) score += 5;
  if (el.hasAttribute && el.hasAttribute("onclick")) score += 3;
  if (el.getAttribute && el.getAttribute("role")) score += 2;
  return score;
}

function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function filterAncestors(candidates) {
  const seen = new Set();
  const uniq = [];
  for (const el of candidates) if (!seen.has(el)) { seen.add(el); uniq.push(el); }
  const scored = uniq.map((el) => {
    let depth = 0;
    let n = el;
    while (n.parentElement) { depth++; n = n.parentElement; }
    return { el, score: scoreForDedupe(el), depth, rect: getRealRect(el) };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.rect.top - b.rect.top || a.rect.left - b.rect.left;
  });
  const keep = [];
  const keptRects = [];
  for (const { el, rect } of scored) {
    let dominated = false;
    for (let i = 0; i < keep.length; i++) {
      const k = keep[i];
      const kr = keptRects[i];
      try {
        const contains = k.contains(el) || el.contains(k);
        const overlap = rectsOverlap(rect, kr);
        const samePos = Math.abs(rect.left - kr.left) < 4 && Math.abs(rect.top - kr.top) < 4 && Math.abs(rect.width - kr.width) < 4 && Math.abs(rect.height - kr.height) < 4;
        if (samePos) { dominated = true; break; }
        if (contains && overlap) { dominated = true; break; }
      } catch {}
    }
    if (!dominated) {
      keep.push(el);
      keptRects.push(rect);
    }
  }
  keep.sort((a, b) => {
    const ra = getRealRect(a);
    const rb = getRealRect(b);
    return ra.top - rb.top || ra.left - rb.left;
  });
  return keep;
}

function getClickableElements() {
  const direct = queryAll(CLICKABLE_SELECTOR);
  const seen = new Set(direct);
  const raw = [...direct];
  if (raw.length > 800) return raw;
  const all = queryAll("*");
  for (const el of all) {
    if (seen.has(el)) continue;
    if (el.closest && el.closest(overlaySelectors)) continue;
    let rect;
    try { rect = el.getBoundingClientRect(); } catch { continue; }
    if (!rect || rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue;
    if (raw.length > 1000) break;
    if (!isVisible(el)) continue;
    if (isElementClickable(el)) {
      seen.add(el);
      raw.push(el);
      if (raw.length > 1000) break;
    }
  }
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
  const parent = document.documentElement;
  parent.appendChild(container);

  const charset = normalizeCharset();
  const labels = genLabels(elements.length, charset);
  hints = [];
  const placed = [];
  const margin = 2;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const label = labels[i];
    const rect = getRealRect(el);
    const hintEl = document.createElement("span");
    hintEl.className = "jari-hint";
    hintEl.dataset.label = label;
    updateHintText(hintEl, label, "");
    container.appendChild(hintEl);
    let w = hintEl.offsetWidth || 24;
    let h = hintEl.offsetHeight || 14;
    try {
      const r = hintEl.getBoundingClientRect();
      if (r.width) w = r.width;
      if (r.height) h = r.height;
    } catch {}
    let left = rect.left;
    let top = rect.top;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    let attempts = 0;
    while (attempts < 4) {
      let collided = false;
      for (const pr of placed) {
        if (!(left + w < pr.left || left > pr.left + pr.w || top + h < pr.top || top > pr.top + pr.h)) {
          collided = true;
          break;
        }
      }
      if (!collided) break;
      left += 16;
      if (left + w > window.innerWidth - margin) {
        left = margin;
        top += h + 2;
        if (top + h > window.innerHeight - margin) top = margin;
      }
      attempts++;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - h - margin));
    hintEl.style.left = left + "px";
    hintEl.style.top = top + "px";
    hintEl.style.zIndex = "2147483647";
    hints.push({ el, label, hintEl, rect });
    placed.push({ left, top, w, h });
  }
  refresh();
}

let scrollLockPrevOverflow = null;
let scrollLockPrevent = null;

function disableScrollLock() {
  if (scrollLockPrevent) return;
  scrollLockPrevent = (e) => {
    if (!active) return;
    const t = e.target;
    if (t && t.closest && t.closest(".jari-hints, .jari-hint")) return;
    e.preventDefault();
    e.stopPropagation();
  };
  try { window.addEventListener("wheel", scrollLockPrevent, { passive: false, capture: true }); } catch {}
  try { window.addEventListener("touchmove", scrollLockPrevent, { passive: false, capture: true }); } catch {}
  try { window.addEventListener("scroll", scrollLockPrevent, { passive: false, capture: true }); } catch {}
  try {
    scrollLockPrevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body && (document.body.style.overflow = "hidden");
  } catch {}
}

function enableScrollLock() {
  if (!scrollLockPrevent) return;
  try { window.removeEventListener("wheel", scrollLockPrevent, { capture: true }); } catch {}
  try { window.removeEventListener("touchmove", scrollLockPrevent, { capture: true }); } catch {}
  try { window.removeEventListener("scroll", scrollLockPrevent, { capture: true }); } catch {}
  scrollLockPrevent = null;
  try {
    if (scrollLockPrevOverflow !== null) {
      document.documentElement.style.overflow = scrollLockPrevOverflow;
      if (document.body) document.body.style.overflow = "";
      scrollLockPrevOverflow = null;
    }
  } catch {}
}

function stopTracking() {
  if (scrollHandler) { try { window.removeEventListener("scroll", scrollHandler, true); } catch {} scrollHandler = null; }
  if (resizeHandler) { try { window.removeEventListener("resize", resizeHandler); } catch {} resizeHandler = null; }
  if (mutationObserver) { try { mutationObserver.disconnect(); } catch {} mutationObserver = null; }
  if (regenerateTimer) { clearTimeout(regenerateTimer); regenerateTimer = null; }
  if (scrollEndTimer) { clearTimeout(scrollEndTimer); scrollEndTimer = null; }
  enableScrollLock();
  hideHintPill();
}

function startTracking() {
  stopTracking();
  disableScrollLock();
  showHintPill();
  try { ui.toast(`Hints: ${elements.length} targets (${mode})`); } catch {}
  try {
    mutationObserver = new MutationObserver(scheduleRegenerate);
    const target = document.body || document.documentElement;
    mutationObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden", "inert"] });
  } catch {}
  scrollHandler = () => {
    if (!active) return;
    hideHints();
    if (regenerateTimer) { clearTimeout(regenerateTimer); regenerateTimer = null; }
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      scrollEndTimer = null;
      if (!active) return;
      scheduleRegenerate();
    }, 150);
  };
  resizeHandler = () => {
    if (!active) return;
    scheduleRegenerate();
  };
  window.addEventListener("scroll", scrollHandler, true);
  window.addEventListener("resize", resizeHandler);
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
  stopTracking();
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

  if (candidates.length > 800) {
    candidates = candidates.slice(0, 800);
    ui.toast(`Too many hints (${candidates.length} shown)`);
  }

  elements = candidates;
  prefix = "";
  active = true;

  render();
  startTracking();
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
  isClippedByOverflow,
};

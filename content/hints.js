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
let hintsHost = null;
let holder = null;
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

function getZIndex(node) {
  let z = 0;
  try {
    do {
      const v = parseInt(
        window.getComputedStyle(node).getPropertyValue("z-index"),
      );
      if (!isNaN(v) && v >= 0) z += v;
      node = node.parentNode;
    } while (
      node &&
      node !== document.body &&
      node !== document &&
      node.nodeType !== 11
    );
  } catch {}
  return z;
}

function placeHintsHost(host) {
  try {
    const topLayer = document.querySelector("dialog[open]");
    if (topLayer) {
      const r = topLayer.getBoundingClientRect();
      const style = window.getComputedStyle(topLayer);
      if (
        r.width > 0 &&
        r.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      ) {
        topLayer.appendChild(host);
        return;
      }
    }
  } catch {}
  (document.documentElement || document.body).appendChild(host);
}

function showHintPill() {
  if (hintPill) return;
  try {
    hintPill = document.createElement("div");
    hintPill.className = "jari-pill";
    hintPill.textContent = "hint";
    ui.statusContainer().appendChild(hintPill);
  } catch {}
}

function hideHintPill() {
  if (!hintPill) return;
  try {
    hintPill.remove();
  } catch {}
  hintPill = null;
}

function hideHints() {
  if (holder) {
    holder.style.display = "none";
  } else if (container) {
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
    if (fresh.length === 0) {
      close();
      ui.toast("No hints");
      return;
    }
    const capped = fresh.length > 800 ? fresh.slice(0, 800) : fresh;
    if (capped.length !== fresh.length) {
      ui.toast(`Too many hints (${capped.length} shown)`);
    }
    elements = capped;
    render();
    if (holder) {
      holder.style.display = "";
    } else if (container) {
      container.style.display = "";
    }
    prefix = savedPrefix;
    refresh();
    const any = hints.some((h) => h.label.startsWith(prefix));
    if (prefix && !any) {
      prefix = "";
      refresh();
    }
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
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      if (i !== j && out[j].startsWith(out[i])) {
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

function isElementDrawn(e, rect) {
  const min = isEditable(e) ? 1 : 4;
  rect = rect || e.getBoundingClientRect();
  return (
    rect.width > min &&
    rect.height > min &&
    (parseFloat(window.getComputedStyle(e).opacity) > 0.1 ||
      (e.tagName === "INPUT" && e.type !== "text"))
  );
}

function isElementPartiallyInViewport(el, ignoreSize) {
  const rect = el.getBoundingClientRect();
  const windowHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;
  return (
    (ignoreSize || isElementDrawn(el, rect)) &&
    rect.top < windowHeight &&
    rect.bottom > 0 &&
    rect.left < windowWidth &&
    rect.right > 0
  );
}

function getVisibleElements(filter) {
  const all = Array.from(document.documentElement.getElementsByTagName("*"));
  const visibleElements = [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.shadowRoot) {
      const cc = e.shadowRoot.querySelectorAll("*");
      for (let j = 0; j < cc.length; j++) all.push(cc[j]);
    }
    const rect = e.getBoundingClientRect();
    if (
      rect.top <= window.innerHeight &&
      rect.bottom >= 0 &&
      rect.left <= window.innerWidth &&
      rect.right >= 0 &&
      rect.height > 0 &&
      window.getComputedStyle(e).visibility !== "hidden"
    ) {
      filter(e, visibleElements);
    }
  }
  return visibleElements;
}

function filterInvisibleElements(nodes) {
  return nodes.filter(
    (n) =>
      n.offsetHeight &&
      n.offsetWidth &&
      !n.getAttribute("disabled") &&
      isElementPartiallyInViewport(n) &&
      window.getComputedStyle(n).visibility !== "hidden",
  );
}

function getRealRect(elm) {
  try {
    if (elm.childElementCount === 0) {
      const r = elm.getClientRects();
      if (r.length === 3) return r[1];
      if (r.length === 2) return r[0];
      return elm.getBoundingClientRect();
    } else if (
      elm.childElementCount === 1 &&
      elm.firstElementChild &&
      elm.firstElementChild.textContent
    ) {
      const r = elm.firstElementChild.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return elm.getBoundingClientRect();
      return r;
    }
    return elm.getBoundingClientRect();
  } catch {
    return elm.getBoundingClientRect();
  }
}

function isElementClickable(e) {
  try {
    if (e.matches && e.matches(CLICKABLE_SELECTOR)) return true;
  } catch {}
  try {
    const style = window.getComputedStyle(e);
    if (style.cursor === "pointer" || style.cursor.substr(0, 4) === "url(")
      return true;
  } catch {}
  try {
    if (
      e.closest &&
      e.closest(
        "a, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button",
      )
    )
      return true;
  } catch {}
  return false;
}

function filterOverlapElements(elements) {
  elements = elements.filter((e) => {
    const be = getRealRect(e);
    if (e.disabled || e.readOnly || !isElementDrawn(e, be)) return false;
    if (
      e.matches &&
      (e.matches("input, textarea, select, form") ||
        e.contentEditable === "true")
    )
      return true;
    try {
      if (e.closest && e.closest(overlaySelectors)) return false;
    } catch {}
    const el = e
      .getRootNode()
      .elementFromPoint(be.left + be.width / 2, be.top + be.height / 2);
    return (
      !el ||
      (el.shadowRoot &&
        (el.childElementCount === 0 || el.shadowRoot.contains(e))) ||
      el.contains(e) ||
      e.contains(el)
    );
  });
  return filterAncestors(elements);
}

function filterAncestors(elements) {
  if (elements.length === 0) return elements;
  const result = [];
  elements.forEach((e) => {
    for (let j = 0; j < result.length; j++) {
      if (result[j].contains(e)) {
        if (result[j].tagName !== "A" || !result[j].href) result[j] = e;
        return;
      } else if (result[j].shadowRoot && result[j].shadowRoot.contains(e)) {
        return;
      } else if (e.contains(result[j])) {
        return;
      }
    }
    result.push(e);
  });
  return result;
}

function getClickableElements() {
  let elements = getVisibleElements((e, v) => {
    try {
      if (e.closest && e.closest(overlaySelectors)) return;
    } catch {}
    if (isElementClickable(e)) v.push(e);
  });
  elements = filterOverlapElements(elements);
  return elements;
}

function getLinkElements() {
  let elements = getVisibleElements((e, v) => {
    if (e.matches && e.matches("[href]") && !e.disabled && !e.readOnly)
      v.push(e);
  });
  elements = elements.filter((el) => {
    if (el.closest && el.closest(overlaySelectors)) return false;
    return isOpenableLink(el);
  });
  elements = filterInvisibleElements(elements);
  elements = filterOverlapElements(elements);
  return elements;
}

function getInputElements() {
  const raw = queryAll(INPUT_SELECTOR);
  const out = [];
  for (const el of raw) {
    if (el.closest && el.closest(overlaySelectors)) continue;
    const type = el.getAttribute
      ? (el.getAttribute("type") || "").toLowerCase()
      : "";
    if (type === "hidden") continue;
    if (el.disabled) continue;
    out.push(el);
  }
  let elements = filterInvisibleElements(out);
  elements = filterOverlapElements(elements);
  return elements;
}

function getHref(el) {
  try {
    if (el.href) return el.href;
  } catch {}
  const raw = el.getAttribute
    ? el.getAttribute("href") || el.getAttribute("xlink:href")
    : null;
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
    if (scheme === "javascript" || scheme === "data" || scheme === "vbscript")
      return false;
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
  if (role === "textbox" || role === "searchbox" || role === "combobox")
    return true;
  return false;
}

function collectElements(requestedMode) {
  let raw = [];
  if (requestedMode === "click") raw = getClickableElements();
  else if (
    requestedMode === "open" ||
    requestedMode === "openBackground" ||
    requestedMode === "yank"
  )
    raw = getLinkElements();
  else if (requestedMode === "input") raw = getInputElements();
  return raw;
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
    // no match
  }
}

function flip() {
  if (hints.length === 0) return;
  const first = hints[0].hintEl;
  const isFlipped = first.style.zIndex !== String(first.zIndex);
  hints.forEach((h, i) => {
    const el = h.hintEl;
    const z = parseInt(el.zIndex, 10) || parseInt(el.style.zIndex, 10) || 0;
    if (isFlipped) {
      el.style.zIndex = String(el.zIndex);
    } else {
      el.style.zIndex = String(hints.length - i + 2147483000 - z);
    }
  });
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
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  const events = ["mouseover", "mousedown", "mouseup", "click"];
  for (const type of events) {
    try {
      const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: type === "mousedown" ? 1 : 0,
      });
      el.dispatchEvent(ev);
    } catch {}
  }
  try {
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {}
  }
}

function focusInput(el) {
  try {
    el.scrollIntoView({ block: "center", inline: "center" });
  } catch {}
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {}
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    try {
      const len = el.value ? el.value.length : 0;
      if (
        typeof el.select === "function" &&
        el.type !== "checkbox" &&
        el.type !== "radio"
      ) {
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
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }
  flashElement(el);
}

function coordinate(holder) {
  const link = document.createElement("div");
  link.style.position = "absolute";
  link.style.top = "0";
  link.style.left = "0";
  link.textContent = "A";
  holder.prepend(link);
  const br = link.getBoundingClientRect();
  const ret = {
    top: br.top + window.pageYOffset - document.documentElement.clientTop,
    left: br.left + window.pageXOffset - document.documentElement.clientLeft,
  };
  try {
    link.remove();
  } catch {}
  return ret;
}

function render() {
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
    container = null;
  } else if (container) {
    try {
      container.remove();
    } catch {}
    container = null;
  }

  hintsHost = document.createElement("div");
  hintsHost.className = "jari-hints-host";
  hintsHost.style.position = "fixed";
  hintsHost.style.left = "0";
  hintsHost.style.top = "0";
  hintsHost.style.width = "0";
  hintsHost.style.height = "0";
  hintsHost.style.overflow = "visible";
  hintsHost.style.pointerEvents = "none";
  hintsHost.style.zIndex = "2147483647";
  try {
    hintsHost.attachShadow({ mode: "open" });
  } catch {
    hintsHost.shadowRoot = hintsHost;
  }

  const shadow = hintsHost.shadowRoot;
  const style = document.createElement("style");
  style.textContent = `
    .jari-hints { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .jari-hint {
      position: absolute;
      display: inline-block;
      box-sizing: border-box;
      font-family: monospace;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      letter-spacing: 0.02em;
      padding: 1px 3px;
      border: 1px solid #c38a22;
      border-radius: 3px;
      background: linear-gradient(#fff785, #ffc542);
      color: #1a1a1a;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      text-align: left;
    }
    .jari-hint-matched { color: #6a6a6a; opacity: 0.45; }
    .jari-hint-hidden { opacity: 0; display: none; }
  `;
  shadow.appendChild(style);
  holder = document.createElement("section");
  holder.className = "jari-hints";
  holder.style.display = "block";
  holder.style.opacity = "1";
  shadow.appendChild(holder);
  container = holder;
  placeHintsHost(hintsHost);

  const charset = normalizeCharset();
  const labels = genLabels(elements.length, charset);
  hints = [];

  const bof = (() => {
    try {
      return coordinate(holder);
    } catch {
      return { top: 0, left: 0 };
    }
  })();

  let lastTop = -1,
    lastLeft = -1;
  const links = elements.map((elm, i) => {
    const r = getRealRect(elm);
    const z = getZIndex(elm);
    const left = window.pageXOffset + r.left - bof.left;
    const link = document.createElement("div");
    link.className = "jari-hint";
    link.textContent = labels[i];
    link.dataset.label = labels[i];
    let lTop = Math.max(r.top + window.pageYOffset - bof.top, 0);
    if (lTop === lastTop && Math.abs(left - lastLeft) < 20) {
      link.style.left = left + 20 - Math.abs(left - lastLeft) + "px";
    } else if (left === lastLeft && Math.abs(lTop - lastTop) < 20) {
      lTop += 20 - Math.abs(lTop - lastTop);
      link.style.left = left + "px";
    } else {
      link.style.left = left + "px";
    }
    link.style.top = lTop + "px";
    link.style.zIndex = String(z + 9999);
    link.zIndex = link.style.zIndex;
    link.label = labels[i];
    link.link = elm;
    updateHintText(link, labels[i], "");
    lastTop = lTop;
    lastLeft = parseInt(link.style.left, 10);
    return link;
  });

  links.forEach((link) => holder.appendChild(link));

  if (links.length > 0) {
    let bcr = getRealRect(links[0]);
    for (let i = 1; i < links.length; i++) {
      const h = links[i];
      const tcr = getRealRect(h);
      if (tcr.top === bcr.top && Math.abs(tcr.left - bcr.left) < bcr.width) {
        h.style.top = h.offsetTop + h.offsetHeight + "px";
      }
      bcr = getRealRect(h);
    }
  }

  hints = links.map((link) => ({
    el: link.link,
    label: link.label,
    hintEl: link,
    rect: getRealRect(link.link),
  }));
  refresh();
}

let scrollLockPrevent = null;
let keyUpHandler = null;

function disableScrollLock() {
  if (scrollLockPrevent) return;
  scrollLockPrevent = (e) => {
    if (!active) return;
    const t = e.target;
    if (t && t.closest && t.closest(".jari-hint")) return;
    e.preventDefault();
    e.stopPropagation();
  };
  try {
    window.addEventListener("wheel", scrollLockPrevent, {
      passive: false,
      capture: true,
    });
  } catch {}
  try {
    window.addEventListener("touchmove", scrollLockPrevent, {
      passive: false,
      capture: true,
    });
  } catch {}
}

function enableScrollLock() {
  if (!scrollLockPrevent) return;
  try {
    window.removeEventListener("wheel", scrollLockPrevent, { capture: true });
  } catch {}
  try {
    window.removeEventListener("touchmove", scrollLockPrevent, {
      capture: true,
    });
  } catch {}
  scrollLockPrevent = null;
}

function stopTracking() {
  if (scrollHandler) {
    try {
      window.removeEventListener("scroll", scrollHandler, true);
    } catch {}
    scrollHandler = null;
  }
  if (resizeHandler) {
    try {
      window.removeEventListener("resize", resizeHandler);
    } catch {}
    resizeHandler = null;
  }
  if (mutationObserver) {
    try {
      mutationObserver.disconnect();
    } catch {}
    mutationObserver = null;
  }
  if (regenerateTimer) {
    clearTimeout(regenerateTimer);
    regenerateTimer = null;
  }
  if (scrollEndTimer) {
    clearTimeout(scrollEndTimer);
    scrollEndTimer = null;
  }
  if (keyUpHandler) {
    try {
      window.removeEventListener("keyup", keyUpHandler, true);
    } catch {}
    keyUpHandler = null;
  }
  enableScrollLock();
  hideHintPill();
}

function startTracking() {
  stopTracking();
  disableScrollLock();
  showHintPill();
  try {
    ui.toast(`Hints: ${elements.length} targets (${mode})`);
  } catch {}
  try {
    mutationObserver = new MutationObserver(scheduleRegenerate);
    const target = document.body || document.documentElement;
    mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden", "inert"],
    });
  } catch {}
  keyUpHandler = (e) => {
    if (active) onKeyUp(e);
  };
  try {
    window.addEventListener("keyup", keyUpHandler, true);
  } catch {}
  scrollHandler = () => {
    if (!active) return;
    hideHints();
    if (regenerateTimer) {
      clearTimeout(regenerateTimer);
      regenerateTimer = null;
    }
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
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
    container = null;
  } else if (container) {
    try {
      container.remove();
    } catch {}
    container = null;
  }
  stopTracking();
}

function open(requestedMode) {
  if (active) close();
  let m = requestedMode;
  if (m === "click") {
    mode = "click";
    multipleHits = false;
  } else if (m === "open") {
    mode = "open";
    multipleHits = false;
  } else if (m === "openBackground") {
    mode = "openBackground";
    multipleHits = true;
  } else if (m === "input") {
    mode = "input";
    multipleHits = false;
  } else if (m === "yank") {
    mode = "yank";
    multipleHits = false;
  } else {
    mode = "click";
    multipleHits = false;
  }

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
    if (mode === "yank") ui.toast("No links to yank");
    else ui.toast(mode === "input" ? "No inputs" : "No hints");
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
    else {
      prefix = "";
      refresh();
    }
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
  } else if (mode === "yank") {
    const url = getHref(el);
    if (url) {
      ui.copyText(url);
      ui.toast("Yanked " + url);
    } else {
      ui.toast("No link");
    }
    flashElement(el);
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
  if (key === "Shift") {
    event.preventDefault();
    event.stopImmediatePropagation();
    flip();
    return true;
  }
  if (key === " " || event.code === "Space") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (holder) holder.style.display = "none";
    else if (container) container.style.display = "none";
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
    const visible = hints.filter((h) => h.label.startsWith(prefix));
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
      const any = hints.some((h) => h.label.startsWith(next));
      const exact = hints.find((h) => h.label === next);
      if (exact) {
        prefix = next;
        refresh();
        activate(exact.el);
      } else if (any) {
        prefix = next;
        refresh();
      } else {
        prefix = next;
        refresh();
      }
      return true;
    }
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function onKeyUp(event) {
  if (!active) return false;
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (holder) holder.style.display = "";
    else if (container) container.style.display = "";
    return true;
  }
  return false;
}

export const Hints = { open, close, isActive, onKeyDown, genLabels };

register("hints", { close, onKeyDown, isActive });

export function __testReset() {
  close();
  if (hintsHost) {
    try {
      hintsHost.remove();
    } catch {}
    hintsHost = null;
    holder = null;
    container = null;
  }
  prefix = "";
  elements = [];
  hints = [];
}

export const __testHelpers = {
  getHref,
  isOpenableLink,
  isElementClickable,
  getRealRect,
  collectElements,
  isElementDrawn,
  isElementPartiallyInViewport,
  getVisibleElements,
  filterInvisibleElements,
  filterOverlapElements,
  filterAncestors,
};

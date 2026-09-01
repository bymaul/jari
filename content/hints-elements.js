import { overlaySelectors, queryAll } from "./keymap.js";
import { blockedUrlSchemes } from "../shared/url.js";

export const CLICKABLE_SELECTOR =
  "a, button, select, input, textarea, summary, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button, *[role=button], *[role=link], *[role=menuitem], *[role=option], *[role=switch], *[role=tab], *[role=checkbox], *[role=combobox], *[role=menuitemcheckbox], *[role=menuitemradio]";
export const INPUT_SELECTOR =
  'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"]';

export function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute ? el.getAttribute("role") : null;
  if (role === "textbox" || role === "searchbox" || role === "combobox")
    return true;
  return false;
}

export function isElementDrawn(e, rect) {
  const min = isEditable(e) ? 1 : 4;
  rect = rect || e.getBoundingClientRect();
  return (
    rect.width > min &&
    rect.height > min &&
    (parseFloat(window.getComputedStyle(e).opacity) > 0.1 ||
      (e.tagName === "INPUT" && e.type !== "text"))
  );
}

export function isElementPartiallyInViewport(el, ignoreSize) {
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

export function getVisibleElements(filter) {
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

export function filterInvisibleElements(nodes) {
  return nodes.filter(
    (n) =>
      n.offsetHeight &&
      n.offsetWidth &&
      !n.getAttribute("disabled") &&
      isElementPartiallyInViewport(n) &&
      window.getComputedStyle(n).visibility !== "hidden",
  );
}

export function getRealRect(elm) {
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

export function isElementClickable(e) {
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

export function filterAncestors(elements) {
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

export function filterOverlapElements(elements) {
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

export function getClickableElements() {
  let elements = getVisibleElements((e, v) => {
    try {
      if (e.closest && e.closest(overlaySelectors)) return;
    } catch {}
    if (isElementClickable(e)) v.push(e);
  });
  elements = filterOverlapElements(elements);
  return elements;
}

export function getHref(el) {
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

export function isOpenableLink(el) {
  const href = getHref(el);
  if (!href) return false;
  try {
    const url = new URL(href);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    if (blockedUrlSchemes.has(scheme)) return false;
    return true;
  } catch {
    return false;
  }
}

export function getLinkElements() {
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

export function getInputElements() {
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

export function collectElements(requestedMode) {
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

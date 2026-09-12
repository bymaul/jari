import { overlaySelectors, queryAll } from "./keymap.js";
import { blockedUrlSchemes } from "../shared/url.js";
import { settings } from "./settings.js";

// NodeFilter.SHOW_ELEMENT is 1 by spec; spelled out so this module also
// loads where NodeFilter is undefined (unit tests).
const SHOW_ELEMENT = 1;

export const CLICKABLE_SELECTOR =
  "a, button, select, input, textarea, summary, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button, *[role=button], *[role=link], *[role=menuitem], *[role=option], *[role=switch], *[role=tab], *[role=checkbox], *[role=combobox], *[role=menuitemcheckbox], *[role=menuitemradio]";
export const INPUT_SELECTOR =
  'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"]';
export const FRAME_SELECTOR = "iframe,frame";

export function isFrameElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "IFRAME" || tag === "FRAME";
}

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

const NON_RENDERED_TAGS = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "META",
  "LINK",
  "TITLE",
  "BASE",
  "NOSCRIPT",
  "TEMPLATE",
]);

export function listElements(root, whatToShow, filter) {
  const out = [];
  try {
    // Numeric codes: NodeFilter may be undefined in unit tests.
    const walker = document.createTreeWalker(root, whatToShow, {
      acceptNode(node) {
        try {
          if (node.tagName && NON_RENDERED_TAGS.has(node.tagName)) return 3;
        } catch {}
        return 1;
      },
    });
    let node = walker.nextNode();
    while (node) {
      try {
        if (filter(node)) out.push(node);
      } catch {}
      if (node.shadowRoot) {
        try {
          out.push(...listElements(node.shadowRoot, whatToShow, filter));
        } catch {}
      }
      node = walker.nextNode();
    }
  } catch {}
  return out;
}

export function getVisibleElements(filter) {
  const visibleElements = [];
  for (const e of listElements(document.documentElement, SHOW_ELEMENT, () => true)) {
    let rect;
    try {
      rect = e.getBoundingClientRect();
    } catch {
      continue;
    }
    if (
      !Number.isFinite(
        rect.top + rect.bottom + rect.left + rect.right + rect.height,
      ) ||
      rect.top > window.innerHeight ||
      rect.bottom < 0 ||
      rect.left > window.innerWidth ||
      rect.right < 0 ||
      rect.height <= 0
    ) {
      continue;
    }
    let hidden;
    try {
      hidden = window.getComputedStyle(e).visibility === "hidden";
    } catch {
      hidden = true;
    }
    if (hidden) continue;
    try {
      filter(e, visibleElements);
    } catch {}
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

export function isExplicitlyRequested(e) {
  let selector;
  try {
    selector = settings.getClickableSelector() || "";
  } catch {
    return false;
  }
  if (!selector) return false;
  try {
    return !!e.matches && e.matches(selector);
  } catch {
    return false;
  }
}

export function viewportScore(el) {
  let rect;
  try {
    rect = getHintRect(el);
  } catch {
    return Infinity;
  }
  if (!rect || rect.width <= 0 || rect.height <= 0) return Infinity;
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (vw <= 0 || vh <= 0) return 0;
  const visW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
  const visH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
  if (visW <= 0 || visH <= 0) return Infinity;
  const coverage = (visW * visH) / (rect.width * rect.height);
  const cx = rect.left + rect.width / 2 - vw / 2;
  const cy = rect.top + rect.height / 2 - vh / 2;
  return (coverage >= 0.99 ? 0 : 1e9) + Math.hypot(cx, cy);
}

export function prioritizeForViewport(elements) {
  return elements
    .map((el, i) => ({ el, i, score: viewportScore(el) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map(({ el }) => el);
}

export function isElementClickable(e) {
  try {
    if (e.matches && e.matches(CLICKABLE_SELECTOR)) return true;
  } catch {}
  if (isExplicitlyRequested(e)) return true;
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
    if (isExplicitlyRequested(e)) {
      result.push(e);
      return;
    }
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
      (e.matches &&
        e.matches("input, textarea, select, form")) ||
      e.contentEditable === "true" ||
      isExplicitlyRequested(e)
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

function matchesHintSelector(e, selectorString, pattern) {
  if (!selectorString && !pattern) return true;
  try {
    if (selectorString && e.matches && e.matches(selectorString)) return true;
  } catch {}
  if (pattern) {
    try {
      pattern.lastIndex = 0;
      const text = e.innerText || "";
      if (pattern.test(text)) return true;
      const label = e.getAttribute ? e.getAttribute("aria-label") : "";
      if (label) {
        pattern.lastIndex = 0;
        if (pattern.test(label)) return true;
      }
    } catch {}
  }
  return false;
}

export function getClickableElements(selectorString = "", pattern = null) {
  let elements = getVisibleElements((e, v) => {
    try {
      if (e.closest && e.closest(overlaySelectors)) return;
    } catch {}
    if (!matchesHintSelector(e, selectorString, pattern)) return;
    if (isElementClickable(e)) v.push(e);
  });
  for (const frame of getFrameElements()) {
    if (!elements.includes(frame)) elements.push(frame);
  }
  elements = filterOverlapElements(elements);
  return elements;
}

export function getFrameElements() {
  const raw = queryAll(FRAME_SELECTOR);
  const out = [];
  for (const el of raw) {
    try {
      if (el.closest && el.closest(overlaySelectors)) continue;
    } catch {}
    out.push(el);
  }
  let elements = filterInvisibleElements(out);
  elements = filterOverlapElements(elements);
  return elements;
}

export function getHref(el, base) {
  const raw = el.getAttribute
    ? (el.getAttribute("href") ?? el.getAttribute("xlink:href"))
    : null;
  if (raw != null && (raw.startsWith("#") || raw.trim() === "")) return null;
  try {
    if (typeof el.href === "string" && el.href) return el.href;
  } catch {}
  if (!raw) return null;
  try {
    const url = new URL(raw, base || el._jariBase || location.href);
    return url.href;
  } catch {
    return null;
  }
}

export function isOpenableLink(el, base) {
  const href = getHref(el, base);
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

export function getLinkAncestor(el, base) {
  if (!el) return null;
  const docBase = base || el._jariBase;
  if (el.closest) {
    try {
      const a = el.closest("a");
      if (a && isOpenableLink(a, docBase)) return a;
      const hrefEl = el.closest("[href]");
      if (hrefEl && isOpenableLink(hrefEl, docBase)) return hrefEl;
    } catch {}
  }
  let cur = el;
  while (cur) {
    if (cur.tagName === "A" && isOpenableLink(cur, docBase)) return cur;
    if (cur.getAttribute && cur.getAttribute("href") && isOpenableLink(cur, docBase))
      return cur;
    const parent = cur.parentElement;
    if (parent) {
      cur = parent;
    } else {
      const root = cur.getRootNode && cur.getRootNode();
      if (root && root.host) cur = root.host;
      else break;
    }
  }
  return null;
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
    requestedMode === "openCurrent" ||
    requestedMode === "yank"
  )
    raw = getLinkElements();
  else if (requestedMode === "input") raw = getInputElements();
  else if (requestedMode === "yankText") raw = getClickableElements();
  try {
    for (const el of collectIframeElements(requestedMode)) {
      if (!raw.includes(el)) raw.push(el);
    }
  } catch {}
  return raw;
}

export function translateRect(rect, dx, dy) {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
    width: rect.width,
    height: rect.height,
  };
}

export function getHintRect(el) {
  try {
    if (el && el._jariViewportRect) return el._jariViewportRect;
  } catch {}
  return getRealRect(el);
}

function getAccessibleFrameDocs() {
  const out = [];
  let frames;
  try {
    frames = queryAll(FRAME_SELECTOR);
  } catch {
    return out;
  }
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  for (const frame of frames) {
    try {
      if (frame.closest && frame.closest(overlaySelectors)) continue;
    } catch {}
    let doc;
    try {
      doc = frame.contentDocument;
    } catch {
      continue;
    }
    if (!doc || !doc.body) continue;
    let rect;
    try {
      rect = frame.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect) continue;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw)
      continue;
    out.push({ frame, doc, rect });
  }
  return out;
}

function eachInnerElement(doc, fn) {
  const visit = (root) => {
    let nodes;
    try {
      nodes = root.querySelectorAll("*");
    } catch {
      return;
    }
    for (const el of nodes) {
      try {
        fn(el);
      } catch {}
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  try {
    if (doc.body) visit(doc.body);
  } catch {}
}

function innerPointVisible(el, be) {
  try {
    const doc = el.ownerDocument;
    if (!doc || typeof doc.elementFromPoint !== "function") return true;
    const hit = doc.elementFromPoint(
      be.left + be.width / 2,
      be.top + be.height / 2,
    );
    return !hit || hit.contains(el) || el.contains(hit);
  } catch {
    return true;
  }
}

function matchesInnerInput(el) {
  try {
    if (!el.matches || !el.matches(INPUT_SELECTOR)) return false;
  } catch {
    return false;
  }
  const type = el.getAttribute
    ? (el.getAttribute("type") || "").toLowerCase()
    : "";
  return type !== "hidden" && !el.disabled;
}

function matchesInnerLink(el, base) {
  try {
    if (!el.matches || !el.matches("[href]")) return false;
  } catch {
    return false;
  }
  return !el.disabled && !el.readOnly && isOpenableLink(el, base);
}

export function collectIframeElements(requestedMode) {
  const out = [];
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  for (const { frame, doc, rect } of getAccessibleFrameDocs()) {
    const dx = rect.left + (frame.clientLeft || 0);
    const dy = rect.top + (frame.clientTop || 0);
    let base = location.href;
    try {
      base = doc.URL || doc.baseURI || location.href;
    } catch {}
    eachInnerElement(doc, (el) => {
      if (requestedMode === "click" || requestedMode === "yankText") {
        if (!isElementClickable(el)) return;
      } else if (requestedMode === "input") {
        if (!matchesInnerInput(el)) return;
      } else {
        if (!matchesInnerLink(el, base)) return;
      }
      let be;
      try {
        be = el.getBoundingClientRect();
      } catch {
        return;
      }
      if (!be || be.width <= 0 || be.height <= 0) return;
      if (!isElementDrawn(el, be)) return;
      const t = translateRect(be, dx, dy);
      if (t.bottom <= 0 || t.right <= 0 || t.top >= vh || t.left >= vw) return;
      try {
        if (el.closest && el.closest(overlaySelectors)) return;
      } catch {}
      if (el.disabled || el.readOnly) return;
      if (!innerPointVisible(el, be)) return;
      try {
        el._jariViewportRect = t;
        el._jariBase = base;
      } catch {}
      out.push(el);
    });
  }
  return out;
}

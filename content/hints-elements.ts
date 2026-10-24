import { deepActiveElement, overlaySelectors, queryAll } from "./keymap.ts";
import { blockedUrlSchemes } from "../shared/url.ts";
import { settings } from "./settings.ts";

// NodeFilter.SHOW_ELEMENT is 1 by spec; spelled out so this module also
// loads where NodeFilter is undefined (unit tests).
const SHOW_ELEMENT = 1;

/** Rect-shaped plain object; DOMRect is structurally compatible. */
/** Rect measurements compatible with DOMRect minus offsets. */
export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Jari expandos stored on hint targets (see collectIframeElements). */
export interface JariElement extends Element {
  _jariBase?: string;
  _jariViewportRect?: RectLike;
  _jariFrame?: Element;
}

export const CLICKABLE_SELECTOR =
  "a, button, select, input, textarea, summary, *[onclick], *[contenteditable=true], *.jfk-button, *.goog-flat-menu-button, *[role=button], *[role=link], *[role=menuitem], *[role=option], *[role=switch], *[role=tab], *[role=checkbox], *[role=combobox], *[role=menuitemcheckbox], *[role=menuitemradio]";
export const INPUT_SELECTOR =
  'input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"]';
export const FRAME_SELECTOR = "iframe,frame";

const openableCache = new Map<string, boolean>();

export function isFrameElement(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "IFRAME" || tag === "FRAME";
}

export function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute ? el.getAttribute("role") : null;
  if (role === "textbox" || role === "searchbox" || role === "combobox")
    return true;
  return false;
}

export function isElementDrawn(
  e: Element,
  rect?: DOMRect | null,
  style?: CSSStyleDeclaration,
): boolean {
  const min = isEditable(e) ? 1 : 4;
  rect = rect || e.getBoundingClientRect();
  const st = style || window.getComputedStyle(e);
  return (
    rect.width > min &&
    rect.height > min &&
    (parseFloat(st.opacity) > 0.1 ||
      (e.tagName === "INPUT" && (e as HTMLInputElement).type !== "text"))
  );
}

export function isElementPartiallyInViewport(
  el: Element,
  ignoreSize?: boolean,
): boolean {
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

export function listElements(
  root: Node,
  whatToShow: number,
  filter: (node: Node) => boolean,
): Element[] {
  const out: Element[] = [];
  try {
    // Numeric codes: NodeFilter may be undefined in unit tests.
    const walker = document.createTreeWalker(root, whatToShow, {
      acceptNode(node) {
        try {
          if (
            (node as Element).tagName &&
            NON_RENDERED_TAGS.has((node as Element).tagName)
          )
            return 3;
        } catch {}
        return 1;
      },
    });
    let node = walker.nextNode();
    while (node) {
      try {
        if (filter(node)) out.push(node as Element);
      } catch {}
      if ((node as Element).shadowRoot) {
        try {
          out.push(
            ...listElements((node as Element).shadowRoot!, whatToShow, filter),
          );
        } catch {}
      }
      node = walker.nextNode();
    }
  } catch {}
  return out;
}

export function measureElement(
  e: Element,
): { rect: DOMRect; style: CSSStyleDeclaration } | null {
  let rect: DOMRect;
  try {
    rect = e.getBoundingClientRect();
  } catch {
    return null;
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
    return null;
  }
  let style: CSSStyleDeclaration;
  try {
    style = window.getComputedStyle(e);
  } catch {
    return null;
  }
  if (style.visibility === "hidden") return null;
  return { rect, style };
}

export function getVisibleElements(
  filter: (e: Element, out: Element[], style: CSSStyleDeclaration) => void,
  prefilter?: (e: Element) => boolean,
): Element[] {
  const visibleElements: Element[] = [];
  for (const e of listElements(
    document.documentElement,
    SHOW_ELEMENT,
    () => true,
  )) {
    if (prefilter) {
      let pass;
      try {
        pass = prefilter(e);
      } catch {
        pass = false;
      }
      if (!pass) continue;
    }
    const measured = measureElement(e);
    if (!measured) continue;
    try {
      filter(e, visibleElements, measured.style);
    } catch {}
  }
  return visibleElements;
}

export function collectMutationRoots(
  mutation: MutationRecord,
  out: Node[],
): void {
  try {
    const added = mutation.addedNodes || [];
    for (const n of added) {
      if (n && n.nodeType === 1) out.push(n);
    }
    const t = mutation.target;
    if (t) {
      if (t.nodeType === 1) out.push(t);
      else if (t.parentElement) out.push(t.parentElement);
    }
  } catch {}
}

function pushSubtree(
  root: Node | null,
  seen: Set<Node>,
  pool: Element[],
): void {
  if (!root || (root.nodeType !== 1 && root.nodeType !== 11) || seen.has(root))
    return;
  seen.add(root);
  if (root.nodeType === 1) pool.push(root as Element);
  let shadow: ShadowRoot | null;
  try {
    shadow = (root as Element).shadowRoot || null;
  } catch {
    shadow = null;
  }
  let nodes: Iterable<Element>;
  try {
    nodes = (root as Element | ShadowRoot).querySelectorAll("*") || [];
  } catch {
    nodes = [];
  }
  for (const el of nodes) pushSubtree(el, seen, pool);
  if (shadow) pushSubtree(shadow, seen, pool);
}

function isLinkCandidate(e: Element): boolean {
  try {
    if (e.closest && e.closest(overlaySelectors)) return false;
  } catch {}
  try {
    return !!(
      e.matches &&
      e.matches("[href]") &&
      !(e as HTMLInputElement).disabled &&
      !(e as HTMLInputElement).readOnly
    );
  } catch {
    return false;
  }
}

function isInputCandidate(e: Element): boolean {
  try {
    if (!e.matches || !e.matches(INPUT_SELECTOR)) return false;
  } catch {
    return false;
  }
  try {
    if (e.closest && e.closest(overlaySelectors)) return false;
  } catch {}
  const type = e.getAttribute
    ? (e.getAttribute("type") || "").toLowerCase()
    : "";
  return type !== "hidden" && !(e as HTMLInputElement).disabled;
}

export function collectNewcomers(
  roots: (Node | null)[],
  requestedMode: string,
  known?: Set<Element> | null,
): Element[] {
  const seen = new Set<Node>();
  const pool: Element[] = [];
  for (const root of roots || []) {
    pushSubtree(root, seen, pool);
  }
  const out = [];
  for (const e of pool) {
    if (known && known.has(e)) continue;
    if (requestedMode === "click" || requestedMode === "yankText") {
      if (!prefilterClickable(e, "", null)) continue;
    } else if (requestedMode === "input") {
      if (!isInputCandidate(e)) continue;
    } else {
      if (!isLinkCandidate(e)) continue;
    }
    const measured = measureElement(e);
    if (!measured) continue;
    if (requestedMode === "click" || requestedMode === "yankText") {
      if (!isElementClickable(e, measured.style)) continue;
    } else if (requestedMode !== "input") {
      if (!isOpenableLink(e, location.href)) continue;
    }
    out.push(e);
  }
  return out;
}

export function filterInvisibleElements(nodes: Element[]): Element[] {
  return nodes.filter(
    (n) =>
      (n as HTMLElement).offsetHeight &&
      (n as HTMLElement).offsetWidth &&
      !n.getAttribute("disabled") &&
      isElementPartiallyInViewport(n) &&
      window.getComputedStyle(n).visibility !== "hidden",
  );
}

export function getRealRect(elm: Element): DOMRect {
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

export function isExplicitlyRequested(e: Element): boolean {
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

export function viewportScore(el: Element): number {
  let rect: RectLike;
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

export function prioritizeForViewport(elements: Element[]): Element[] {
  return elements
    .map((el, i) => ({ el, i, score: viewportScore(el) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map(({ el }) => el);
}

function matchesClickableSelector(e: Element) {
  try {
    if (e.matches && e.matches(CLICKABLE_SELECTOR)) return true;
  } catch {}
  return isExplicitlyRequested(e);
}

export function isElementClickable(
  e: Element,
  style?: CSSStyleDeclaration,
): boolean {
  if (matchesClickableSelector(e)) return true;
  try {
    const st = style || window.getComputedStyle(e);
    if (st.cursor === "pointer" || st.cursor.substr(0, 4) === "url(")
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

export function filterAncestors(
  elements: Element[],
  base: Element[] = [],
): Element[] {
  if (elements.length === 0) return base.length > 0 ? [...base] : elements;
  const result: Element[] = [...base];
  elements.forEach((e) => {
    if (isExplicitlyRequested(e)) {
      result.push(e);
      return;
    }
    for (let j = 0; j < result.length; j++) {
      if (result[j].contains(e)) {
        if (result[j].tagName !== "A" || !(result[j] as HTMLAnchorElement).href)
          result[j] = e;
        return;
      } else if (result[j].shadowRoot && result[j].shadowRoot!.contains(e)) {
        return;
      } else if (e.contains(result[j])) {
        return;
      }
    }
    result.push(e);
  });
  return result;
}

export function filterOverlapElements(elements: Element[]): Element[] {
  elements = elements.filter((e) => {
    const be = getRealRect(e);
    if (
      (e as HTMLInputElement).disabled ||
      (e as HTMLInputElement).readOnly ||
      !isElementDrawn(e, be)
    )
      return false;
    if (
      (e.matches && e.matches("input, textarea, select, form")) ||
      (e as HTMLElement).contentEditable === "true" ||
      isExplicitlyRequested(e)
    )
      return true;
    try {
      if (e.closest && e.closest(overlaySelectors)) return false;
    } catch {}
    const el = (e.getRootNode() as Document | ShadowRoot).elementFromPoint(
      be.left + be.width / 2,
      be.top + be.height / 2,
    );
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

function matchesHintSelector(
  e: Element,
  selectorString: string,
  pattern: RegExp | null | undefined,
): boolean {
  if (!selectorString && !pattern) return true;
  try {
    if (selectorString && e.matches && e.matches(selectorString)) return true;
  } catch {}
  if (pattern) {
    try {
      pattern.lastIndex = 0;
      const text = (e as HTMLElement).innerText || "";
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

function prefilterClickable(
  e: Element,
  selectorString: string,
  pattern: RegExp | null | undefined,
): boolean {
  try {
    if (e.closest && e.closest(overlaySelectors)) return false;
  } catch {}
  if (!matchesHintSelector(e, selectorString, pattern)) return false;
  if (matchesClickableSelector(e)) return true;
  try {
    const cursor = window.getComputedStyle(e).cursor;
    return cursor === "pointer" || cursor.substr(0, 4) === "url(";
  } catch {
    return false;
  }
}

export function getClickableElements(
  selectorString = "",
  pattern: RegExp | null = null,
): Element[] {
  let elements: Element[] = getVisibleElements(
    (e, v, style) => {
      if (isElementClickable(e, style)) v.push(e);
    },
    (e) => prefilterClickable(e, selectorString, pattern),
  );
  for (const frame of getFrameElements()) {
    if (!elements.includes(frame)) elements.push(frame);
  }
  elements = filterOverlapElements(elements);
  return elements;
}

export function getFrameElements(): Element[] {
  const raw = queryAll(FRAME_SELECTOR);
  const out: Element[] = [];
  for (const el of raw) {
    try {
      if (el.closest && el.closest(overlaySelectors)) continue;
    } catch {}
    out.push(el);
  }
  let elements: Element[] = filterInvisibleElements(out);
  elements = filterOverlapElements(elements);
  return elements;
}

export function getHref(el: Element, base?: string): string | null {
  const raw = el.getAttribute
    ? (el.getAttribute("href") ?? el.getAttribute("xlink:href"))
    : null;
  if (raw != null && (raw.startsWith("#") || raw.trim() === "")) return null;
  try {
    if (
      typeof (el as HTMLAnchorElement).href === "string" &&
      (el as HTMLAnchorElement).href
    )
      return (el as HTMLAnchorElement).href;
  } catch {}
  if (!raw) return null;
  try {
    const url = new URL(
      raw,
      base || (el as JariElement)._jariBase || location.href,
    );
    return url.href;
  } catch {
    return null;
  }
}

export function isOpenableLink(el: Element, base?: string): boolean {
  const href = getHref(el, base);
  if (!href) return false;
  const cached = openableCache.get(href);
  if (cached !== undefined) return cached;
  let openable;
  try {
    const url = new URL(href);
    const scheme = url.protocol.replace(":", "").toLowerCase();
    openable = !blockedUrlSchemes.has(scheme);
  } catch {
    openable = false;
  }
  if (openableCache.size > 2000) openableCache.clear();
  openableCache.set(href, openable);
  return openable;
}

export function getLinkAncestor(
  el: Element | null,
  base?: string,
): Element | null {
  if (!el) return null;
  const docBase = base || (el as JariElement)._jariBase;
  if (el.closest) {
    try {
      const a = el.closest("a");
      if (a && isOpenableLink(a, docBase)) return a;
      const hrefEl = el.closest("[href]");
      if (hrefEl && isOpenableLink(hrefEl, docBase)) return hrefEl;
    } catch {}
  }
  let cur: Element | null = el;
  while (cur) {
    if (cur.tagName === "A" && isOpenableLink(cur, docBase)) return cur;
    if (
      cur.getAttribute &&
      cur.getAttribute("href") &&
      isOpenableLink(cur, docBase)
    )
      return cur;
    const parent: Element | null = cur.parentElement;
    if (parent) {
      cur = parent;
    } else {
      const root: unknown = cur.getRootNode && cur.getRootNode();
      const host: Element | null | undefined = root
        ? (root as unknown as { host?: Element }).host
        : null;
      if (host) cur = host;
      else break;
    }
  }
  return null;
}

export function getLinkElements(): Element[] {
  let elements: Element[] = getVisibleElements(
    (e, v) => {
      v.push(e);
    },
    (e) => {
      try {
        return !!(
          e.matches &&
          e.matches("[href]") &&
          !(e as HTMLInputElement).disabled &&
          !(e as HTMLInputElement).readOnly
        );
      } catch {
        return false;
      }
    },
  );
  elements = elements.filter((el) => {
    if (el.closest && el.closest(overlaySelectors)) return false;
    return isOpenableLink(el);
  });
  elements = filterInvisibleElements(elements);
  elements = filterOverlapElements(elements);
  return elements;
}

export function getInputElements(): Element[] {
  const raw = queryAll(INPUT_SELECTOR);
  const out: Element[] = [];
  for (const el of raw) {
    if (el.closest && el.closest(overlaySelectors)) continue;
    const type = el.getAttribute
      ? (el.getAttribute("type") || "").toLowerCase()
      : "";
    if (type === "hidden") continue;
    if ((el as HTMLInputElement).disabled) continue;
    out.push(el);
  }
  let elements: Element[] = filterInvisibleElements(out);
  elements = filterOverlapElements(elements);
  return elements;
}

export function collectElements(requestedMode: string): Element[] {
  let raw: Element[] = [];
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

export function translateRect(rect: DOMRect, dx: number, dy: number): RectLike {
  return {
    left: rect.left + dx,
    top: rect.top + dy,
    right: rect.right + dx,
    bottom: rect.bottom + dy,
    width: rect.width,
    height: rect.height,
  };
}

export function getHintRect(el: Element): RectLike {
  try {
    if (el && (el as JariElement)._jariViewportRect)
      return (el as JariElement)._jariViewportRect!;
  } catch {}
  return getRealRect(el);
}

function getAccessibleFrameDocs(): {
  frame: HTMLIFrameElement;
  doc: Document;
  rect: DOMRect;
}[] {
  const out: { frame: HTMLIFrameElement; doc: Document; rect: DOMRect }[] = [];
  let frames;
  try {
    frames = queryAll(FRAME_SELECTOR);
  } catch {
    return out;
  }
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  for (const frame of frames) {
    const htmlFrame = frame as HTMLIFrameElement;
    try {
      if (htmlFrame.closest && htmlFrame.closest(overlaySelectors)) continue;
    } catch {}
    let doc: Document | null;
    try {
      doc = htmlFrame.contentDocument;
    } catch {
      continue;
    }
    if (!doc || !doc.body) continue;
    let rect: DOMRect;
    try {
      rect = htmlFrame.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!rect) continue;
    if (
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= vh ||
      rect.left >= vw
    )
      continue;
    out.push({ frame: htmlFrame, doc, rect });
  }
  return out;
}

function eachInnerElement(doc: Document, fn: (el: Element) => void): void {
  const visit = (root: Document | ShadowRoot | Element): void => {
    let nodes: NodeListOf<Element>;
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

function innerPointVisible(el: Element, be: RectLike): boolean {
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

function matchesInnerInput(el: Element): boolean {
  try {
    if (!el.matches || !el.matches(INPUT_SELECTOR)) return false;
  } catch {
    return false;
  }
  const type = el.getAttribute
    ? (el.getAttribute("type") || "").toLowerCase()
    : "";
  return type !== "hidden" && !(el as HTMLInputElement).disabled;
}

function matchesInnerLink(el: Element, base?: string): boolean {
  try {
    if (!el.matches || !el.matches("[href]")) return false;
  } catch {
    return false;
  }
  return (
    !(el as HTMLInputElement).disabled &&
    !(el as HTMLInputElement).readOnly &&
    isOpenableLink(el, base)
  );
}

export function collectIframeElements(requestedMode: string): Element[] {
  const out: Element[] = [];
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  let focused: Element | null;
  try {
    focused = deepActiveElement();
  } catch {
    focused = null;
  }
  for (const { frame, doc, rect } of getAccessibleFrameDocs()) {
    if (!frame || frame !== focused) continue;
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
      if (
        (el as HTMLInputElement).disabled ||
        (el as HTMLInputElement).readOnly
      )
        return;
      if (!innerPointVisible(el, be)) return;
      try {
        const jel = el as JariElement;
        jel._jariViewportRect = t;
        jel._jariBase = base;
        jel._jariFrame = frame;
      } catch {}
      out.push(el);
    });
  }
  return out;
}

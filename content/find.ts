/* global CSS, Highlight */
import { register, touch } from "./overlays.ts";
import { ui, createShadowHost } from "./ui.ts";
import { deepActiveElement } from "./keymap.ts";
import { getLinkAncestor } from "./hints-elements.ts";
import {
  detectHighlightSupport,
  clearHighlightNames,
} from "./highlight.ts";
import { buildMatcher, hasUpperCase } from "./find/matcher.ts";
import { collectTextNodes } from "./find/collect.ts";
import { Visual } from "./visual.js";

export { buildMatcher, hasUpperCase };

const MAX_MATCHES = 1500;

let active = false;
let host: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let statusEl: HTMLSpanElement | null = null;
let restoreFocus: Element | null = null;

let matches: Range[] = [];
let currentIdx = 0;
let lastQuery = "";
let pendingQuery = "";
let committedQuery = "";
let committedIdx = 0;
let committedHidden = false;

const FIND_HISTORY_KEY = "findHistory";
const MAX_FIND_HISTORY = 20;
let findHistory: string[] = [];
let historyIdx = -1;
let historyDraft = "";

let useHighlights = false;
let highlightsHidden = false;
let inputDebounce: ReturnType<typeof setTimeout> | null = null;
let findObserver: MutationObserver | null = null;
let findObserverTimer: ReturnType<typeof setTimeout> | null = null;

function hasHighlights() {
  return matches.length > 0 && !highlightsHidden;
}

function isActive() {
  return active;
}

function matchesChanged(a: Range[], b: Range[]) {
  if (a.length !== b.length) return true;
  return a.some((r, i) => {
    const o = b[i];
    return (
      !o ||
      r.startContainer !== o.startContainer ||
      r.startOffset !== o.startOffset ||
      r.endOffset !== o.endOffset
    );
  });
}
function scheduleFindRebuild() {
  clearTimeout(findObserverTimer ?? undefined);
  findObserverTimer = setTimeout(() => {
    try {
      if (active && pendingQuery) {
        const q = pendingQuery.trim();
        if (!q) return;
        const rebuilt = buildMatches(q);
        if (matchesChanged(rebuilt, matches)) {
          matches = rebuilt;
          currentIdx = Math.min(currentIdx, Math.max(0, matches.length - 1));
          applyHighlights();
          updateStatus();
          if (matches.length > 0) scrollToCurrent();
        }
        return;
      }
      if (!active && hasHighlights() && (lastQuery || "").trim()) {
        const rebuilt = buildMatches(lastQuery.trim());
        if (matchesChanged(rebuilt, matches)) {
          matches = rebuilt;
          currentIdx = Math.min(currentIdx, Math.max(0, matches.length - 1));
          applyHighlights();
        }
      }
    } catch {}
  }, 150);
}
function startFindObserver() {
  stopFindObserver();
  try {
    findObserver = new MutationObserver(scheduleFindRebuild);
    findObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden", "aria-hidden"] });
  } catch {}
}
function stopFindObserver() {
  clearTimeout(findObserverTimer ?? undefined);
  findObserverTimer = null;
  if (findObserver) {
    try { findObserver.disconnect(); } catch {}
    findObserver = null;
  }
}

function syncObserver() {
  if (active || hasHighlights()) {
    if (!findObserver) startFindObserver();
  } else {
    stopFindObserver();
  }
}

function buildMatches(query: string): Range[] {
  if (!query) return [];
  const matcher = buildMatcher(query, { caseSensitive: hasUpperCase(query) });
  if (!matcher) return [];
  const nodes = collectTextNodes();
  const out: Range[] = [];
  for (const node of nodes) {
    matcher.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = matcher.exec(node.nodeValue as string)) !== null) {
      if (m[0].length === 0) {
        matcher.lastIndex++;
        continue;
      }
      try {
        const rangeDoc =
          (node.ownerDocument &&
            typeof node.ownerDocument.createRange === "function" &&
            node.ownerDocument) ||
          document;
        const range = rangeDoc.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        out.push(range);
      } catch {}
      if (out.length >= MAX_MATCHES) break;
    }
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

function clearHighlightApi() {
  clearHighlightNames("jari-find", "jari-find-current");
}

function clearHighlights() {
  matches = [];
  currentIdx = 0;
  highlightsHidden = false;
  clearHighlightApi();
  updateStatus();
}

function hideHighlights() {
  highlightsHidden = true;
  clearHighlightApi();
}

function getCurrentLinkElement(): Element | null {
  if (matches.length === 0) return null;
  const r = matches[currentIdx];
  if (!r || !r.startContainer) return null;
  return getLinkAncestor(r.startContainer.parentElement);
}

function activateCurrentLink(): boolean {
  const link = getCurrentLinkElement();
  if (!link) return false;
  try {
    ui.dispatchClick(link);
  } catch {}
  return true;
}

function applyHighlights() {
  clearHighlightApi();
  if (matches.length === 0) return;
  if (highlightsHidden) return;
  const valid = matches.filter(r => {
    try {
      return r.startContainer && r.startContainer.isConnected !== false && r.endContainer && r.endContainer.isConnected !== false;
    } catch { return false; }
  });
  if (valid.length !== matches.length) {
    matches = valid;
    if (currentIdx >= matches.length) currentIdx = Math.max(0, matches.length - 1);
    if (matches.length === 0) { updateStatus(); return; }
  }
  const cur = matches[currentIdx];
  if (!useHighlights) return;
  try {
    const others = valid.filter((_, i) => i !== currentIdx);
    if (others.length > 0) {
      CSS.highlights.set("jari-find", new Highlight(...others));
    } else {
      try { CSS.highlights.delete("jari-find"); } catch {}
    }
    if (cur) {
      CSS.highlights.set("jari-find-current", new Highlight(cur));
    } else {
      try { CSS.highlights.delete("jari-find-current"); } catch {}
    }
  } catch {
    useHighlights = false;
  }
}

function scrollToCurrent() {
  if (matches.length === 0) return;
  const r = matches[currentIdx];
  if (!r) return;
  try {
    if (r.startContainer && r.startContainer.isConnected === false) return;
    const el = r.startContainer && r.startContainer.parentElement ? r.startContainer.parentElement : null;
    if (!el || !el.isConnected) return;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
    } catch {}
    let rect: DOMRect | null = null;
    try { rect = r.getBoundingClientRect ? r.getBoundingClientRect() : el.getBoundingClientRect(); } catch {}
    if (rect && rectIntersectsViewport(rect)) return;
    const fixed = findFixedAncestor(el);
    if (fixed) {
      scrollFixedMatchIntoView(el, fixed, rect);
      return;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    try { rect = r.getBoundingClientRect ? r.getBoundingClientRect() : el.getBoundingClientRect(); } catch {}
    if (rect) {
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (rect.top < 0 || rect.bottom > vh) {
        try { window.scrollBy(0, rect.top - vh / 2); } catch {}
      }
    }
  } catch {}
}

function rectIntersectsViewport(rect: DOMRect | null): boolean {
  if (!rect) return false;
  try {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
  } catch {
    return false;
  }
}

function findFixedAncestor(el: HTMLElement): Element | null {
  try {
    let node: Element | null = el;
    while (node && node.nodeType === 1) {
      if (window.getComputedStyle(node).position === "fixed") return node;
      const root = (
        node.getRootNode ? node.getRootNode() : null
      ) as ShadowRoot | null;
      node = (root && root.host) || node.parentElement;
    }
  } catch {}
  return null;
}

function isScrollableBox(node: Element): boolean {
  try {
    if (
      node.scrollHeight <= node.clientHeight + 1 &&
      node.scrollWidth <= node.clientWidth + 1
    )
      return false;
    const style = window.getComputedStyle(node);
    return (
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      style.overflowY === "overlay" ||
      style.overflowX === "auto" ||
      style.overflowX === "scroll" ||
      style.overflowX === "overlay"
    );
  } catch {
    return false;
  }
}

function nearestScrollableAncestor(
  el: HTMLElement | null,
  stopAfter: Element | null,
): Element | null {
  try {
    let node = el && el.parentElement ? el.parentElement : null;
    while (node && node.nodeType === 1) {
      if (isScrollableBox(node)) return node;
      if (node === stopAfter) return null;
      node = node.parentElement;
    }
  } catch {}
  return null;
}

function scrollFixedMatchIntoView(
  el: HTMLElement,
  fixed: Element,
  rect: DOMRect | null,
): void {
  try {
    if (!rect) {
      try {
        rect = el.getBoundingClientRect();
      } catch {
        return;
      }
    }
    if (rectIntersectsViewport(rect)) return;
    const box = nearestScrollableAncestor(el, fixed);
    if (!box) return;
    const crect = box.getBoundingClientRect();
    if (crect.top > rect.top) box.scrollTop -= crect.top - rect.top;
    else if (rect.bottom > crect.bottom) box.scrollTop += rect.bottom - crect.bottom;
    if (crect.left > rect.left) box.scrollLeft -= crect.left - rect.left;
    else if (rect.right > crect.right) box.scrollLeft += rect.right - crect.right;
  } catch {}
}

function executeQuery(q: string): void {
  highlightsHidden = false;
  pendingQuery = q;
  const query = (q || "").trim();
  clearTimeout(inputDebounce ?? undefined);
  if (!query) {
    matches = [];
    currentIdx = 0;
    clearHighlightApi();
    updateStatus();
    return;
  }
  inputDebounce = setTimeout(() => {
    runQuery(query);
  }, 80);
}

function runQuery(query: string): void {
  highlightsHidden = false;
  try {
    matches = buildMatches(query);
    currentIdx = 0;
    applyHighlights();
    if (matches.length > 0) scrollToCurrent();
    updateStatus();
  } catch {}
}

async function loadFindHistory(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(FIND_HISTORY_KEY);
    const list = stored && stored[FIND_HISTORY_KEY];
    if (Array.isArray(list)) {
      findHistory = list.filter((s) => typeof s === "string" && s).slice(0, MAX_FIND_HISTORY);
    }
  } catch {}
}

async function pushFindHistory(q: string): Promise<void> {
  const query = (q || "").trim();
  if (!query) return;
  findHistory = [query, ...findHistory.filter((s) => s !== query)].slice(
    0,
    MAX_FIND_HISTORY,
  );
  historyIdx = -1;
  try {
    await chrome.storage.local.set({ [FIND_HISTORY_KEY]: findHistory });
  } catch {}
}

function stepHistory(delta: number): void {
  if (!inputEl || findHistory.length === 0) return;
  if (historyIdx === -1 && delta < 0) return;
  if (historyIdx === -1 && delta > 0) historyDraft = inputEl.value;
  historyIdx = Math.min(
    findHistory.length - 1,
    Math.max(-1, historyIdx + delta),
  );
  inputEl.value = historyIdx === -1 ? historyDraft : findHistory[historyIdx];
  executeQuery(inputEl.value);
}

function updateStatus(): void {
  if (!statusEl) return;
  if (!pendingQuery && matches.length === 0 && !lastQuery) {
    statusEl.textContent = "";
    statusEl.classList.remove("jari-find-no-match");
    return;
  }
  const q = pendingQuery || lastQuery;
  if (!q) {
    statusEl.textContent = "";
    return;
  }
  if (matches.length === 0) {
    statusEl.textContent = `No match for "${q}"`;
    statusEl.classList.add("jari-find-no-match");
  } else {
    statusEl.textContent = `${currentIdx + 1}/${matches.length}`;
    statusEl.classList.remove("jari-find-no-match");
  }
}

function findCss(): string {
  return `
    :host { all: initial !important; }
    .jari-overlay {
      all: initial;
      display: block;
      position: fixed !important;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483646 !important;
      box-sizing: border-box;
      background: var(--jari-cmplt-bg, #f5f5f7) !important;
      color: var(--jari-cmplt-fg, #333738) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      max-height: 75vh;
      overflow: hidden;
      text-align: left !important;
      pointer-events: auto;
    }
    .jari-find {
      background: #1c1c24 !important;
      color: #cdcdcd !important;
      font-size: var(--jari-cmplt-font-size, 9pt) !important;
      font-family: var(--jari-cmplt-font-family, monospace) !important;
      outline: none !important;
      border-top: 1px solid #333738;
    }
    .jari-find-bar {
      display: flex;
      align-items: center;
      gap: 0.5ex;
      padding: 0.25ex 0.5ex;
      margin: 0;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      text-align: left !important;
    }
    .jari-find-label {
      color: var(--jari-accent, #e0a363);
      font-weight: bold !important;
      flex: 0 0 auto;
    }
    .jari-find-input {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      box-sizing: border-box;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      color: #cdcdcd;
      background: #1c1c24;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      text-align: left !important;
      padding: 0;
      margin: 0;
    }
    .jari-find-input:focus,
    .jari-find-input:focus-visible,
    .jari-find-input:active {
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
    }
    .jari-find-status {
      flex: 0 0 auto;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      color: #878787;
      white-space: nowrap;
    }
    .jari-find-status.jari-find-no-match {
      color: #e06c75;
    }
    .jari-overlay ::selection {
      background: var(--jari-accent, #e0a363);
      color: #1a1a1a;
    }
  `;
}

function renderBar(): void {
  const created = createShadowHost("jari-find-host", findCss());
  host = created.host;
  const shadow = created.shadow;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-find";
  const bar = document.createElement("div");
  bar.className = "jari-find-bar";
  const label = document.createElement("span");
  label.className = "jari-find-label";
  label.textContent = "/";
  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.className = "jari-find-input";
  inputEl.setAttribute("autocomplete", "off");
  inputEl.setAttribute("spellcheck", "false");
  statusEl = document.createElement("span");
  statusEl.className = "jari-find-status";
  bar.appendChild(label);
  bar.appendChild(inputEl);
  bar.appendChild(statusEl);
  overlay.appendChild(bar);
  shadow.appendChild(overlay);

  restoreFocus = document.activeElement;
  historyIdx = -1;
  historyDraft = "";

  inputEl.addEventListener("input", () => {
    historyIdx = -1;
    executeQuery(inputEl!.value);
  });

  inputEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      stepHistory(e.key === "ArrowUp" ? 1 : -1);
    }
  });

  ui.safeFocus(inputEl, { preventScroll: true });
  updateStatus();
}

function open(): void {
  if (active) return;
  touch("find");
  useHighlights = detectHighlightSupport();
  committedQuery = lastQuery;
  committedIdx = currentIdx;
  committedHidden = highlightsHidden;
  active = true;
  startFindObserver();
  pendingQuery = "";
  loadFindHistory();
  renderBar();
}

function closeBar(): void {
  if (!active) return;
  clearTimeout(inputDebounce ?? undefined);
  inputDebounce = null;
  const wasInput = inputEl;
  const wasHost = host;
  active = false;
  pendingQuery = "";
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  inputEl = null;
  statusEl = null;
  let focused: Element | null;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  if (restoreFocus && restoreFocus.isConnected && focused !== restoreFocus) {
    try {
      ui.safeFocus(restoreFocus as HTMLElement, { preventScroll: true });
    } catch {}
  } else if (wasInput && (focused === wasInput || focused === wasHost)) {
    try {
      wasInput.blur();
    } catch {}
    let refocused: Element | null;
    try {
      refocused = deepActiveElement();
    } catch {
      refocused = document.activeElement;
    }
    if (refocused === wasInput) {
      try {
        const body = document.body || null;
        if (body && typeof body.focus === "function")
          ui.safeFocus(body, { preventScroll: true });
      } catch {}
    }
  }
  restoreFocus = null;
  syncObserver();
}

function closeAndClear(): void {
  clearHighlights();
  closeBar();
  lastQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
}

function closeDiscardPending(): void {
  closeBar();
  const q = (committedQuery || "").trim();
  if (!q) {
    clearHighlights();
    lastQuery = "";
    committedQuery = "";
    committedIdx = 0;
    committedHidden = false;
    syncObserver();
    return;
  }
  lastQuery = committedQuery;
  pendingQuery = "";
  try {
    matches = buildMatches(q);
    currentIdx = Math.min(committedIdx, Math.max(0, matches.length - 1));
  } catch {
    matches = [];
    currentIdx = 0;
  }
  highlightsHidden = committedHidden;
  useHighlights = detectHighlightSupport();
  applyHighlights();
  updateStatus();
  syncObserver();
}

function commitQuery(q: string): void {
  clearTimeout(inputDebounce ?? undefined);
  inputDebounce = null;
  const query = (q || "").trim();
  if (!query) {
    closeDiscardPending();
    return;
  }
  try {
    matches = buildMatches(query);
    currentIdx = 0;
  } catch {
    matches = [];
    currentIdx = 0;
  }
  lastQuery = query;
  committedQuery = query;
  committedIdx = 0;
  committedHidden = false;
  pendingQuery = "";
  highlightsHidden = false;
  useHighlights = detectHighlightSupport();
  pushFindHistory(query);
  closeBar();
  applyHighlights();
  if (matches.length > 0) scrollToCurrent();
  updateStatus();
  syncObserver();
}

function next(count: number = 1, reverse: boolean = false): void {
  const c = Math.max(1, Math.floor(count) || 1);
  if (highlightsHidden && matches.length > 0) {
    highlightsHidden = false;
    useHighlights = detectHighlightSupport();
    syncObserver();
  }
  if (matches.length > 0) {
    try {
      const stale = matches.some(r => !r.startContainer || r.startContainer.isConnected === false);
      if (stale) {
        const q = (lastQuery || pendingQuery || "").trim();
        if (q) {
          const rebuilt = buildMatches(q);
          if (rebuilt.length === 0) {
            clearHighlights();
            updateStatus();
            ui.toast(`No match for "${q}"`);
            return;
          }
          matches = rebuilt;
          if (currentIdx >= matches.length) currentIdx = 0;
          useHighlights = detectHighlightSupport();
          applyHighlights();
          updateStatus();
        } else {
          clearHighlights();
          updateStatus();
        }
      }
    } catch {}
  }
  if (matches.length === 0) {
    const q = (pendingQuery && pendingQuery.trim()) || lastQuery;
    if (!q) {
      ui.toast("No search");
      return;
    }
    pendingQuery = q;
    lastQuery = q;
    pushFindHistory(q);
    matches = buildMatches(q);
    currentIdx = 0;
    if (matches.length === 0) {
      ui.toast(`No match for "${q}"`);
      clearHighlightApi();
      updateStatus();
      return;
    }
    useHighlights = detectHighlightSupport();
    applyHighlights();
    updateStatus();
    if (c > 1) {
      const delta = reverse ? -c : c;
      const len = matches.length;
      currentIdx = (((currentIdx + (delta > 0 ? delta - 1 : delta)) % len) + len) % len;
      applyHighlights();
      updateStatus();
    }
    scrollToCurrent();
    ui.toast(`${currentIdx + 1}/${matches.length}`);
    return;
  }
  const len = matches.length;
  const delta = reverse ? -c : c;
  currentIdx = (((currentIdx + delta) % len) + len) % len;
  applyHighlights();
  scrollToCurrent();
  updateStatus();
  ui.toast(`${currentIdx + 1}/${len}`);
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!active) return false;
  let focused;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  const inInput = focused === inputEl;
  if (inInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDiscardPending();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      commitQuery(inputEl!.value);
      return true;
    }
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeDiscardPending();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeBar();
    return true;
  }
  return false;
}

function handleGlobalEsc(event: KeyboardEvent): boolean {
  if (hasHighlights()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    hideHighlights();
    syncObserver();
    return true;
  }
  return false;
}

function handleGlobalEnter(event: KeyboardEvent): boolean {
  if (!hasHighlights()) return false;
  const link = getCurrentLinkElement();
  if (!link) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  activateCurrentLink();
  clearHighlights();
  lastQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
  return true;
}

export const Find = {
  open,
  close: closeBar,
  clearHighlights,
  hideHighlights,
  next,
  isActive,
  hasHighlights,
  handleGlobalEsc,
  handleGlobalEnter,
  onKeyDown,
};

register("find", { close: closeAndClear, onKeyDown, isActive });

try {
  Visual.setFindOpen(() => open());
  if (typeof Visual.setFindNav === "function") Visual.setFindNav((count: number, reverse: boolean) => next(count, reverse));
} catch {}

export const __testHelpers = {
  buildMatches,
  buildMatcher,
  hasUpperCase,
  matchesChanged,
  syncObserver,
  rectIntersectsViewport,
  findFixedAncestor,
  nearestScrollableAncestor,
  scrollFixedMatchIntoView,
  executeQuery,
  runQuery,
  commitQuery,
  closeDiscardPending,
};

export function __setFindTestState({
  matches: seed = [],
  query = "",
  index = 0,
  pending = "",
  committed = null,
  committedIndex = null,
  hidden = false,
}: {
  matches?: Range[];
  query?: string;
  index?: number;
  pending?: string;
  committed?: string | null;
  committedIndex?: number | null;
  hidden?: boolean;
} = {}) {
  matches = seed;
  currentIdx = index;
  lastQuery = query;
  pendingQuery = pending;
  highlightsHidden = hidden;
  committedQuery = committed === null ? query : committed;
  committedIdx = committedIndex === null ? index : committedIndex;
  committedHidden = hidden;
}

export function __getFindTestState() {
  return {
    matchCount: matches.length,
    currentIdx,
    lastQuery,
    pendingQuery,
    committedQuery,
    highlightsHidden,
  };
}

export function __resetFindState() {
  try { stopFindObserver(); } catch {}
  closeAndClear();
  highlightsHidden = false;
  lastQuery = "";
  pendingQuery = "";
  committedQuery = "";
  committedIdx = 0;
  committedHidden = false;
  useHighlights = false;
  findHistory = [];
  historyIdx = -1;
  historyDraft = "";
}


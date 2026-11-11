import { fuzzyIndices, rankMatches, substringIndices } from "./rank.ts";
import { settings } from "./settings.ts";
import { createShadowHost, sendMessageWithTimeout, ui } from "./ui.ts";
import { promptCss, renderText } from "./prompt/shared.ts";
import { register, touch } from "./overlays.ts";
import type { ClosedSessionRow, MessageResponse } from "../shared/protocol.ts";

const HOST_CLASS = "jari-restore-host";
const POLL_MS = 2000;
const FILTER_MAX = 200;

const FOOTER =
  "j/k move | Space mark | v range | V all | Enter restore | / filter | q close";

type ListRes = {
  ok?: boolean;
  rows: ClosedSessionRow[];
};

let active = false;
let host: HTMLElement | null = null;
let overlay: HTMLDivElement | null = null;
let headerEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let footerEl: HTMLDivElement | null = null;
let restoreFocus: Element | null = null;

let rows: ClosedSessionRow[] = [];
let filtered: ClosedSessionRow[] = [];
let selected = 0;
let marked = new Set<string>();
let query = "";
let visualAnchor: number | null = null;
let visualPainted = new Set<string>();
let visualBaseline = new Set<string>();
let fieldEl: HTMLInputElement | null = null;
let fieldFocusBefore: Element | null = null;
let matchCache = new Map<
  string,
  { q: string; fuzzy: boolean; text: string; indices: number[] }
>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;
let refreshQueued = false;

export function filterSessions(
  list: ClosedSessionRow[],
  text: string,
  fuzzy = true,
): ClosedSessionRow[] {
  const q = String(text || "").trim();
  if (!q) return [...list];
  const ranked = rankMatches(q, list, fuzzy);
  return fuzzy
    ? (ranked.map((entry) => entry.item) as unknown as ClosedSessionRow[])
    : (ranked as unknown as ClosedSessionRow[]);
}

const SNAPSHOT_FIELDS: (keyof ClosedSessionRow)[] = [
  "sessionId",
  "kind",
  "title",
  "url",
  "tabCount",
  "lastModified",
];

export function isSameSessions(
  prevRows: ClosedSessionRow[],
  res: ListRes,
): boolean {
  if (!res || !Array.isArray(res.rows)) return false;
  if (res.rows.length !== prevRows.length) return false;
  for (let i = 0; i < res.rows.length; i++) {
    const a = prevRows[i];
    const b = res.rows[i];
    for (const key of SNAPSHOT_FIELDS) {
      if (a[key] !== b[key]) return false;
    }
  }
  return true;
}

export function restoreTargets(
  list: ClosedSessionRow[],
  markedIds?: Iterable<string>,
  focusedId?: string | null,
): ClosedSessionRow[] {
  const source = Array.isArray(list) ? list : [];
  const ids = [...(markedIds || [])];
  if (ids.length > 0) {
    const wanted = new Set(ids);
    return source.filter((row) => wanted.has(row.sessionId));
  }
  const focused = source.find((row) => row.sessionId === focusedId);
  return focused ? [focused] : [];
}

export function sessionMeta(row: ClosedSessionRow): string {
  if (!row || row.kind !== "window") return "";
  const count = row.tabCount || 0;
  return `${count} tab${count === 1 ? "" : "s"}`;
}

function isActive(): boolean {
  return active;
}

function focusedRow(): ClosedSessionRow | null {
  return filtered[selected] || null;
}

function focusedId(): string | null {
  const row = focusedRow();
  return row ? row.sessionId : null;
}

function currentTargets(): ClosedSessionRow[] {
  return restoreTargets(rows, marked, focusedId());
}

async function askList(): Promise<ListRes | null> {
  try {
    return (await sendMessageWithTimeout(
      "recentSessionsList",
    )) as ListRes | null;
  } catch {
    return null;
  }
}

async function askRestore(
  sessionIds: string[],
): Promise<MessageResponse<"restoreRecentSessions"> | null> {
  try {
    return await sendMessageWithTimeout("restoreRecentSessions", {
      sessionIds,
    });
  } catch {
    return null;
  }
}

function restoreCss() {
  return (
    promptCss() +
    `
    .jari-prompt-list li.jari-rest-row {
      display: grid !important;
      grid-template-columns: auto auto auto minmax(0, 1fr) minmax(0, 36%);
      column-gap: 1ex;
      align-items: baseline !important;
      height: auto !important;
      line-height: 1.7 !important;
      white-space: nowrap !important;
      padding: 0 1ex !important;
      margin: 0;
      overflow: hidden !important;
      cursor: pointer;
    }
    .jari-prompt-list li.jari-rest-row .jari-rest-mark {
      color: var(--jari-accent, #e0a363);
      white-space: pre;
      overflow: hidden;
    }
    .jari-prompt-list li.jari-rest-row .jari-rest-kind {
      opacity: 0.7;
      white-space: nowrap;
    }
    .jari-prompt-list li.jari-rest-row.window .jari-rest-kind {
      color: var(--jari-accent, #e0a363);
      font-weight: bold !important;
    }
    .jari-prompt-list li.jari-rest-row .jari-rest-meta {
      opacity: 0.7;
      white-space: nowrap;
    }
    .jari-prompt-list li.jari-rest-row.marked {
      background: rgba(224, 163, 99, 0.16) !important;
    }
    .jari-prompt-list li.jari-rest-row.selected {
      background: var(--jari-of-bg, #333738) !important;
    }
    .jari-prompt-list li.jari-rest-row .title,
    .jari-prompt-list li.jari-rest-row .url {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .jari-manager-backdrop {
      all: initial;
      display: block;
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.45) !important;
      z-index: 2147483645 !important;
      pointer-events: auto !important;
    }
    .jari-overlay {
      left: 50% !important;
      right: auto !important;
      bottom: auto !important;
      top: 12vh !important;
      transform: translateX(-50%) !important;
      width: min(1020px, calc(100vw - 48px)) !important;
      max-height: 76vh !important;
      display: flex !important;
      flex-direction: column !important;
      border: 1px solid #45454f !important;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55) !important;
      overflow: hidden !important;
    }
    .jari-prompt-list {
      max-height: 52vh !important;
    }
    .jari-prompt-header.jari-rest-header {
      display: flex !important;
      align-items: baseline !important;
      gap: 0 1.5ex;
    }
    .jari-rest-title {
      flex: none;
      font-weight: var(--jari-header-font-weight, bold) !important;
    }
    .jari-rest-stats {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-rest-badge {
      flex: none;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-rest-pos {
      flex: none;
      opacity: 0.7;
      font-weight: normal !important;
    }
  `
  );
}

function appendSpan(
  li: HTMLElement,
  className: string,
  text: string,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  li.appendChild(span);
  return span;
}

function titleMatch(row: ClosedSessionRow, text: string): number[] {
  const fuzzy = settings.isFuzzyMatching();
  const hit = matchCache.get(row.sessionId);
  if (hit && hit.q === query && hit.fuzzy === fuzzy && hit.text === text) {
    return hit.indices;
  }
  const indices = fuzzy
    ? fuzzyIndices(query, text)
    : substringIndices(query, text);
  matchCache.set(row.sessionId, { q: query, fuzzy, text, indices });
  return indices;
}

function renderRow(row: ClosedSessionRow): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "jari-rest-row";
  li.classList.toggle("window", row.kind === "window");
  li.classList.toggle("marked", marked.has(row.sessionId));
  const isWindow = row.kind === "window";
  appendSpan(li, "jari-rest-mark", marked.has(row.sessionId) ? "●" : "○");
  appendSpan(li, "jari-rest-kind", isWindow ? "window" : "tab");
  appendSpan(li, "jari-rest-meta", sessionMeta(row));
  const title = document.createElement("span");
  title.className = "title";
  const text = row.title || "(untitled)";
  if (query) renderText(title, text, titleMatch(row, text));
  else title.textContent = text;
  li.appendChild(title);
  appendSpan(li, "url", row.url || "");
  return li;
}

function renderHeader(): void {
  headerEl!.textContent = "";
  headerEl!.classList.add("jari-rest-header");

  appendSpan(headerEl!, "jari-rest-title", "Recently closed");

  const stats = document.createElement("span");
  stats.className = "jari-rest-stats";
  stats.textContent = `${rows.length} items · ${marked.size} marked`;
  headerEl!.appendChild(stats);

  if (query) appendSpan(headerEl!, "jari-rest-badge", `/${query}`);
  if (fieldEl) appendSpan(headerEl!, "jari-rest-badge", "(filtering)");
  if (visualAnchor !== null)
    appendSpan(headerEl!, "jari-rest-badge", "(visual)");

  const total = filtered.length;
  appendSpan(
    headerEl!,
    "jari-rest-pos",
    total === 0 ? "0/0" : `${selected + 1}/${total}`,
  );
}

function renderFooter(): void {
  if (fieldEl) {
    setFooterLines(["Enter done · Esc cancel"]);
    return;
  }
  setFooterLines([FOOTER]);
}

function setFooterLines(lines: string[]): void {
  footerEl!.textContent = "";
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    footerEl!.appendChild(div);
  }
}

function renderList(): void {
  listEl!.textContent = "";
  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.textContent = query ? "No matching items" : "No recently closed tabs";
    listEl!.appendChild(li);
    return;
  }
  for (const row of filtered) listEl!.appendChild(renderRow(row));
  Array.from(listEl!.children).forEach((li, i) =>
    li.classList.toggle("selected", i === selected),
  );
  const el = listEl!.children[selected];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function renderAll(): void {
  if (!active) return;
  renderHeader();
  renderList();
  renderFooter();
}

function paintSelection(prev: number): void {
  if (!listEl) return;
  const items = listEl.children;
  const old = items[prev];
  if (old) old.classList.remove("selected");
  const el = items[selected];
  if (el) {
    el.classList.add("selected");
    try {
      el.scrollIntoView({ block: "nearest" });
    } catch {}
  }
}

function repaintRow(index: number): void {
  if (!listEl) return;
  const row = filtered[index];
  const old = listEl.children[index];
  if (!row || !old) return;
  const next = renderRow(row);
  next.classList.toggle("selected", index === selected);
  try {
    listEl.replaceChild(next, old);
  } catch {}
}

function indexOfSession(sessionId: string): number {
  return filtered.findIndex((row) => row.sessionId === sessionId);
}

function applyFilter(): void {
  const focused = focusedId();
  filtered = filterSessions(rows, query, settings.isFuzzyMatching());
  const kept = focused === null ? -1 : indexOfSession(focused);
  selected = kept >= 0 ? kept : Math.min(selected, filtered.length - 1);
}

function adoptSnapshot(res: ListRes): void {
  rows = Array.isArray(res.rows) ? res.rows : [];
}

function pruneMarks(): void {
  const alive = new Set(rows.map((row) => row.sessionId));
  for (const id of [...marked]) {
    if (!alive.has(id)) marked.delete(id);
  }
}

async function refresh(): Promise<void> {
  if (refreshing) {
    refreshQueued = true;
    return;
  }
  refreshing = true;
  let res: ListRes | null;
  try {
    res = await askList();
  } catch {
    res = null;
  } finally {
    refreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      if (active) await refresh();
    }
  }
  if (!active) return;
  if (!res || res.ok !== true) {
    ui.toast("Recently closed unavailable");
    close();
    return;
  }
  const focused = focusedId();
  const unchanged = isSameSessions(rows, res);
  adoptSnapshot(res);
  if (unchanged) return;
  matchCache = new Map();
  pruneMarks();
  applyFilter();
  const kept = focused === null ? -1 : indexOfSession(focused);
  if (kept >= 0) selected = kept;
  renderAll();
}

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!active || refreshing || document.hidden) return;
    if (fieldEl) return;
    refresh();
  }, POLL_MS);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function open(): Promise<void> {
  if (active) return;
  const res = await askList();
  if (!res || res.ok !== true) {
    ui.toast("Recently closed unavailable");
    return;
  }
  adoptSnapshot(res);
  filtered = [];
  selected = 0;
  marked = new Set();
  query = "";
  matchCache = new Map();
  fieldEl = null;
  fieldFocusBefore = null;
  refreshQueued = false;
  endVisual();
  active = true;
  touch("restore-manager");

  const created = createShadowHost(HOST_CLASS, restoreCss());
  host = created.host;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  headerEl = document.createElement("div");
  headerEl.className = "jari-prompt-header";

  listEl = document.createElement("ul");
  listEl.className = "jari-prompt-list";

  footerEl = document.createElement("div");
  footerEl.className = "jari-prompt-footer";

  const backdrop = document.createElement("div");
  backdrop.className = "jari-manager-backdrop";
  backdrop.addEventListener("click", () => close());

  overlay.appendChild(headerEl);
  overlay.appendChild(listEl);
  overlay.appendChild(footerEl);
  created.shadow.appendChild(backdrop);
  created.shadow.appendChild(overlay);

  restoreFocus = document.activeElement;
  applyFilter();
  renderAll();
  overlay.tabIndex = -1;
  ui.safeFocus(overlay, { preventScroll: true });
  document.addEventListener("visibilitychange", onVisibility);
  startPolling();
}

function onVisibility(): void {
  if (!document.hidden && active) refresh();
}

function close(): void {
  stopPolling();
  endVisual();
  refreshing = false;
  document.removeEventListener("visibilitychange", onVisibility);
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  headerEl = null;
  listEl = null;
  footerEl = null;
  rows = [];
  filtered = [];
  selected = 0;
  marked = new Set();
  query = "";
  matchCache = new Map();
  fieldEl = null;
  fieldFocusBefore = null;
  refreshQueued = false;
  active = false;

  if (
    restoreFocus &&
    restoreFocus.isConnected &&
    document.activeElement !== restoreFocus
  ) {
    try {
      ui.safeFocus(restoreFocus as HTMLElement, { preventScroll: true });
    } catch {}
  }
  restoreFocus = null;
}

function move(delta: number): void {
  if (filtered.length === 0) return;
  endVisual();
  const prev = selected;
  selected = (selected + delta + filtered.length) % filtered.length;
  renderHeader();
  paintSelection(prev);
}

function paintRange(): void {
  if (visualAnchor === null) return;
  const from = Math.min(visualAnchor, selected);
  const to = Math.max(visualAnchor, selected);
  const painted = new Set<string>();
  for (let i = from; i <= to; i++) {
    const row = filtered[i];
    if (!row) continue;
    painted.add(row.sessionId);
    marked.add(row.sessionId);
  }
  for (const id of visualPainted) {
    if (painted.has(id) || visualBaseline.has(id)) continue;
    marked.delete(id);
  }
  visualPainted = painted;
}

function moveVisual(delta: number): void {
  if (filtered.length === 0) return;
  const anchor = visualAnchor ?? selected;
  const lo = Math.min(anchor, selected);
  const hi = Math.max(anchor, selected);
  selected = (selected + delta + filtered.length) % filtered.length;
  paintRange();
  renderHeader();
  const from = Math.min(lo, selected);
  const to = Math.max(hi, selected);
  for (let i = from; i <= to; i++) repaintRow(i);
}

function endVisual(): void {
  visualAnchor = null;
  visualPainted = new Set();
  visualBaseline = new Set();
}

function startVisual(): void {
  if (filtered.length === 0) return;
  visualAnchor = selected;
  visualBaseline = new Set(marked);
  visualPainted = new Set();
  paintRange();
}

function toggleMark(): void {
  const row = focusedRow();
  if (!row) return;
  if (marked.has(row.sessionId)) marked.delete(row.sessionId);
  else marked.add(row.sessionId);
  renderHeader();
  repaintRow(selected);
}

function markAllVisible(): void {
  endVisual();
  for (const row of filtered) marked.add(row.sessionId);
  renderAll();
}

async function restoreSelected(): Promise<void> {
  const targets = currentTargets();
  if (targets.length === 0) return;
  const res = await askRestore(targets.map((row) => row.sessionId));
  if (!active) return;
  if (!res || !res.ok) {
    ui.toast(
      res && res.reason === "unsupported"
        ? "Sessions not supported here"
        : "Restore failed",
    );
    renderAll();
    return;
  }
  ui.toast(`Restored ${res.restored}`);
  close();
}

function focusOverlay(): void {
  if (!overlay) return;
  ui.safeFocus(overlay, { preventScroll: true });
}

function isOwnChrome(el: Element | null): boolean {
  try {
    if (!el) return false;
    if (el === host || el === overlay) return true;
    const cls = el.className;
    return typeof cls === "string" && cls.includes(HOST_CLASS);
  } catch {
    return false;
  }
}

function openField(text: string): void {
  if (fieldEl) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "jari-prompt-input";
  input.placeholder = "Filter items";
  input.value = text || "";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("maxlength", String(FILTER_MAX));
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    if (!fieldEl || !active) return;
    query = fieldEl.value;
    applyFilter();
    renderAll();
  });
  fieldEl = input;
  overlay!.insertBefore(input, footerEl);
  renderAll();
  const prev = document.activeElement;
  fieldFocusBefore = isOwnChrome(prev) ? null : prev;
  ui.safeFocus(input, { preventScroll: true });
  try {
    input.select();
  } catch {}
}

function closeField(resetQuery: boolean): void {
  if (!fieldEl) return;
  try {
    fieldEl.remove();
  } catch {}
  fieldEl = null;
  if (resetQuery) {
    query = "";
    applyFilter();
  }
  renderAll();
  const prev = fieldFocusBefore;
  fieldFocusBefore = null;
  if (prev && prev.isConnected) {
    if (document.activeElement !== prev) {
      try {
        ui.safeFocus(prev as HTMLElement, { preventScroll: true });
      } catch {
        focusOverlay();
      }
    }
    return;
  }
  focusOverlay();
}

function onFieldKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key === "Escape") {
    ui.consume(event);
    closeField(true);
    return true;
  }
  if (event.key === "Enter") {
    ui.consume(event);
    closeField(false);
    return true;
  }
  return false;
}

function isModifier(event: KeyboardEvent): boolean {
  return (
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Shift" ||
    event.key === "Meta"
  );
}

function onNormalKey(event: KeyboardEvent): boolean {
  if (isModifier(event)) return false;
  const hasMod = event.ctrlKey || event.altKey || event.metaKey;
  if (hasMod) return false;
  switch (event.key) {
    case "q":
    case "Escape":
      ui.consume(event);
      if (visualAnchor !== null) {
        endVisual();
        renderAll();
      } else if (query) {
        query = "";
        applyFilter();
        renderAll();
      } else if (marked.size > 0) {
        marked = new Set();
        renderAll();
      } else {
        close();
      }
      return true;
    case "/":
      ui.consume(event);
      openField(query);
      return true;
    case "Enter":
      ui.consume(event);
      restoreSelected();
      return true;
    case "Tab":
      ui.consume(event);
      move(event.shiftKey ? -1 : 1);
      return true;
    case " ":
      ui.consume(event);
      toggleMark();
      return true;
    case "ArrowDown":
    case "j":
      ui.consume(event);
      if (visualAnchor !== null) moveVisual(1);
      else move(1);
      return true;
    case "ArrowUp":
    case "k":
      ui.consume(event);
      if (visualAnchor !== null) moveVisual(-1);
      else move(-1);
      return true;
    case "v":
      ui.consume(event);
      if (visualAnchor !== null) endVisual();
      else startVisual();
      renderAll();
      return true;
    case "V":
      ui.consume(event);
      markAllVisible();
      return true;
    default:
      return false;
  }
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!active) return false;
  if (fieldEl) return onFieldKey(event);
  return onNormalKey(event);
}

export const RestoreManager = {
  open,
  close,
  onKeyDown,
  isActive,
};

register("restore-manager", { close, onKeyDown, isActive });

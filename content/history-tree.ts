import { fuzzyIndices, rankMatches, substringIndices } from "./rank.ts";
import { settings } from "./settings.ts";
import { createShadowHost, sendMessageWithTimeout, ui } from "./ui.ts";
import { promptCss, renderText } from "./prompt/shared.ts";
import { register, touch } from "./overlays.ts";
import type { HistoryTreeRow, MessageResponse } from "../shared/protocol.ts";

const HOST_CLASS = "jari-history-host";
const POLL_MS = 2000;
const FILTER_MAX = 200;

const FOOTER =
  "j/k move | Enter load page | t new background tab | / filter | q close";

type ListRes = {
  ok?: boolean;
  rows: HistoryTreeRow[];
  currentId: number | null;
};

let active = false;
let host: HTMLElement | null = null;
let overlay: HTMLDivElement | null = null;
let headerEl: HTMLDivElement | null = null;
let listEl: HTMLUListElement | null = null;
let footerEl: HTMLDivElement | null = null;
let restoreFocus: Element | null = null;

let rows: HistoryTreeRow[] = [];
let currentId: number | null = null;
let filtered: HistoryTreeRow[] = [];
let selected = 0;
let query = "";
let fieldEl: HTMLInputElement | null = null;
let fieldFocusBefore: Element | null = null;
let matchCache = new Map<
  number,
  { q: string; fuzzy: boolean; text: string; indices: number[] }
>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;
let refreshQueued = false;

export function filterRows(
  list: HistoryTreeRow[],
  text: string,
  fuzzy = true,
): HistoryTreeRow[] {
  const q = String(text || "").trim();
  if (!q) return [...list];
  const ranked = rankMatches(q, list, fuzzy);
  return fuzzy
    ? (ranked.map((entry) => entry.item) as unknown as HistoryTreeRow[])
    : (ranked as unknown as HistoryTreeRow[]);
}

const SNAPSHOT_FIELDS: (keyof HistoryTreeRow)[] = [
  "id",
  "url",
  "title",
  "ts",
  "depth",
  "seq",
  "prefix",
];

export function isSameRows(
  prevRows: HistoryTreeRow[],
  prevCurrentId: number | null,
  res: ListRes,
): boolean {
  if (!res || !Array.isArray(res.rows)) return false;
  if (prevCurrentId !== res.currentId) return false;
  const nextRows = res.rows;
  if (nextRows.length !== prevRows.length) return false;
  for (let i = 0; i < nextRows.length; i++) {
    const a = prevRows[i];
    const b = nextRows[i];
    for (const key of SNAPSHOT_FIELDS) {
      if (a[key] !== b[key]) return false;
    }
  }
  return true;
}

function isActive(): boolean {
  return active;
}

async function askGo(
  nodeId: number,
): Promise<MessageResponse<"historyTreeGo"> | null> {
  try {
    return await sendMessageWithTimeout("historyTreeGo", { nodeId });
  } catch {
    return null;
  }
}

async function askOpenBackground(
  url: string,
): Promise<MessageResponse<"openInBackgroundTab"> | null> {
  try {
    return await sendMessageWithTimeout("openInBackgroundTab", { url });
  } catch {
    return null;
  }
}

async function askList(): Promise<ListRes | null> {
  try {
    const res = await sendMessageWithTimeout("historyTreeList");
    return res as ListRes | null;
  } catch {
    return null;
  }
}

function focusedRow(): HistoryTreeRow | null {
  return filtered[selected] || null;
}

function focusedId(): number | null {
  const row = focusedRow();
  return row ? row.id : null;
}

function historyCss() {
  return (
    promptCss() +
    `
    .jari-prompt-list li.jari-hist-row {
      display: grid !important;
      grid-template-columns: auto auto minmax(0, 1fr) minmax(0, 36%);
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
    .jari-prompt-list li.jari-hist-row .jari-hist-mark {
      color: #878787;
      white-space: pre;
      overflow: hidden;
    }
    .jari-prompt-list li.jari-hist-row.current .jari-hist-mark {
      color: var(--jari-accent, #e0a363);
      font-weight: bold !important;
    }
    .jari-prompt-list li.jari-hist-row .jari-hist-loc {
      opacity: 0.7;
      white-space: nowrap;
    }
    .jari-prompt-list li.jari-hist-row .title,
    .jari-prompt-list li.jari-hist-row .url {
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
    .jari-prompt-header.jari-hist-header {
      display: flex !important;
      align-items: baseline !important;
      gap: 0 1.5ex;
    }
    .jari-hist-title {
      flex: none;
      font-weight: var(--jari-header-font-weight, bold) !important;
    }
    .jari-hist-stats {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-hist-badge {
      flex: none;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-hist-pos {
      flex: none;
      opacity: 0.7;
      font-weight: normal !important;
    }
  `
  );
}

function branchCount(list: HistoryTreeRow[]): number {
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const depth = list[i].depth;
    let kids = 0;
    for (let j = i + 1; j < list.length; j++) {
      if (list[j].depth <= depth) break;
      if (list[j].depth === depth + 1) kids++;
    }
    if (kids > 1) count++;
  }
  return count;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "??";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function titleMatch(row: HistoryTreeRow, text: string): number[] {
  const fuzzy = settings.isFuzzyMatching();
  const hit = matchCache.get(row.id);
  if (hit && hit.q === query && hit.fuzzy === fuzzy && hit.text === text) {
    return hit.indices;
  }
  const indices = fuzzy
    ? fuzzyIndices(query, text)
    : substringIndices(query, text);
  matchCache.set(row.id, { q: query, fuzzy, text, indices });
  return indices;
}

function renderRow(row: HistoryTreeRow): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "jari-hist-row";
  li.classList.toggle("current", row.id === currentId);
  appendSpan(
    li,
    "jari-hist-mark",
    `${row.prefix}${row.id === currentId ? "●" : "·"}`,
  );
  appendSpan(li, "jari-hist-loc", `#${row.seq} ${formatTime(row.ts)}`);
  const title = document.createElement("span");
  title.className = "title";
  if (!query) {
    title.textContent = row.title || "(untitled)";
  } else {
    renderText(
      title,
      row.title || "(untitled)",
      titleMatch(row, row.title || ""),
    );
  }
  li.appendChild(title);
  appendSpan(li, "url", row.url || "");
  return li;
}

function renderHeader(): void {
  headerEl!.textContent = "";
  headerEl!.classList.add("jari-hist-header");

  appendSpan(headerEl!, "jari-hist-title", "Page history");

  const stats = document.createElement("span");
  stats.className = "jari-hist-stats";
  stats.textContent = `${rows.length} pages · ${branchCount(rows)} branches`;
  headerEl!.appendChild(stats);

  if (query) appendSpan(headerEl!, "jari-hist-badge", `/${query}`);
  if (fieldEl) appendSpan(headerEl!, "jari-hist-badge", "(filtering)");

  const total = filtered.length;
  appendSpan(
    headerEl!,
    "jari-hist-pos",
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
    li.textContent = query ? "No matching pages" : "No history yet";
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
  const rows_ = listEl.children;
  const old = rows_[prev];
  if (old) old.classList.remove("selected");
  const el = rows_[selected];
  if (el) {
    el.classList.add("selected");
    try {
      el.scrollIntoView({ block: "nearest" });
    } catch {}
  }
}

function indexOfRow(id: number): number {
  return filtered.findIndex((row) => row.id === id);
}

function applyFilter(): void {
  const focused = focusedId();
  filtered = filterRows(rows, query, settings.isFuzzyMatching());
  const kept = focused === null ? -1 : indexOfRow(focused);
  selected = kept >= 0 ? kept : Math.min(selected, filtered.length - 1);
}

function adoptSnapshot(res: ListRes): void {
  rows = Array.isArray(res.rows) ? res.rows : [];
  currentId = res.currentId === null ? null : res.currentId;
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
    ui.toast("History tree unavailable");
    close();
    return;
  }
  const focused = focusedId();
  const unchanged = isSameRows(rows, currentId, res);
  adoptSnapshot(res);
  if (unchanged) return;
  matchCache = new Map();
  applyFilter();
  const kept = focused === null ? -1 : indexOfRow(focused);
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
    ui.toast("History tree unavailable");
    return;
  }
  adoptSnapshot(res);
  filtered = [];
  selected = 0;
  query = "";
  matchCache = new Map();
  fieldEl = null;
  fieldFocusBefore = null;
  refreshQueued = false;
  active = true;
  touch("history-tree");

  const created = createShadowHost(HOST_CLASS, historyCss());
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
  const here =
    rows.find((row) => row.url === location.href) ||
    (currentId === null ? null : rows.find((row) => row.id === currentId));
  if (here) {
    const idx = indexOfRow(here.id);
    if (idx >= 0) selected = idx;
  }
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
  currentId = null;
  filtered = [];
  selected = 0;
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
  const prev = selected;
  selected = (selected + delta + filtered.length) % filtered.length;
  renderHeader();
  paintSelection(prev);
}

async function activateRow(): Promise<void> {
  const row = focusedRow();
  if (!row) return;
  const res = await askGo(row.id);
  if (!active) return;
  if (res && res.ok) {
    if (typeof res.delta === "number" && res.delta !== 0) {
      try {
        window.history.go(res.delta);
      } catch {
        ui.toast("History jump failed");
        return;
      }
    }
    close();
    return;
  }
  ui.toast("History jump failed");
  await refresh();
}

async function openRowInBackground(): Promise<void> {
  const row = focusedRow();
  if (!row) return;
  const res = await askOpenBackground(row.url);
  if (!active) return;
  if (res && res.ok) {
    ui.toast("Opened in background tab");
  } else {
    ui.toast("Not a URL");
  }
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
  input.placeholder = "Filter pages";
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
      if (query) {
        query = "";
        applyFilter();
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
      activateRow();
      return true;
    case "Tab":
      ui.consume(event);
      move(event.shiftKey ? -1 : 1);
      return true;
    case "ArrowDown":
    case "j":
      ui.consume(event);
      move(1);
      return true;
    case "ArrowUp":
    case "k":
      ui.consume(event);
      move(-1);
      return true;
    case "t":
      ui.consume(event);
      openRowInBackground();
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

export const HistoryTree = {
  open,
  close,
  onKeyDown,
  isActive,
};

register("history-tree", { close, onKeyDown, isActive });

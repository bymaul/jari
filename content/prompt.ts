import { Url, normalizeUrl } from "../shared/url.ts";
import { parseEngineKeyword } from "../shared/search-engines.ts";
import { rankMatches } from "./rank.ts";
import { settings } from "./settings.ts";
import { sendMessage, createShadowHost, ui } from "./ui.ts";
import { promptCss, renderText } from "./prompt/shared.ts";
import { renderList as renderPromptList, move as movePrompt } from "./prompt/list.ts";
export { promptCss, renderText };
import { deepActiveElement } from "./keymap.ts";
import { register, touch } from "./overlays.ts";
import type {
  Suggestion,
  TabSummary,
  WindowSummary,
} from "../shared/protocol.ts";
import type { SearchEngine } from "../shared/search-engines.ts";
import type { RankItem, RankMatch } from "./rank.ts";

// List entries are heterogeneous: omnibar rows carry kind/search fields,
// tab/window rows are raw TabSummary/WindowSummary entries. All-optional
// duck matches both.
type PromptRow = {
  kind?: "search" | "url" | "suggestion" | "calc";
  title?: string;
  url?: string | null;
  keyword?: string;
  folderPath?: string;
  id?: number;
  windowId?: number;
  match?: { score: number; indices: number[]; baseScore: number } | null;
  source?: string;
  lastVisit?: number;
  lastAccessed?: number;
  lastVisitTime?: number;
  dateAdded?: number;
  visitCount?: number;
  typedCount?: number;
  typedVisits?: number;
};

function parseKeyword(query: string) {
  return parseEngineKeyword(query, cachedEngines || settings.getSearchEngines());
}

const CALC_CHARS = new RegExp("^[\\d\\s.%+*/()-]*$");
const HAS_OPERATOR = /[-+*/%]/;

export function calcEval(expr: string): string | null {
  if (!CALC_CHARS.test(expr) || !HAS_OPERATOR.test(expr)) return null;

  const tokens: { type: "num" | "op" | "lparen" | "rparen"; value: string }[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[\d.]/.test(ch)) {
      let num = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
      tokens.push({ type: "num", value: num });
    } else if (/[-+*/%]/.test(ch)) {
      tokens.push({ type: "op", value: ch }); i++;
    } else if (ch === "(") {
      tokens.push({ type: "lparen", value: ch }); i++;
    } else if (ch === ")") {
      tokens.push({ type: "rparen", value: ch }); i++;
    } else {
      return null;
    }
  }
  if (tokens.length === 0) return null;

  let pos = 0;
  const peek = (): { type: string; value: string } | null =>
    pos < tokens.length ? tokens[pos] : null;
  const advance = (): { type: string; value: string } | null => tokens[pos++];

  const parseFactor = (): number | null => {
    const t = peek();
    if (!t) return null;
    if (t.type === "num") {
      advance();
      const n = Number(t.value);
      if (!Number.isFinite(n)) return null;
      return n;
    }
    if (t.type === "lparen") {
      advance();
      const val = parseExpr();
      if (val === null) return null;
      const close = peek();
      if (!close || close.type !== "rparen") return null;
      advance();
      return val;
    }
    return null;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    while (true) {
      const t = peek();
      if (!t || t.type !== "op" || (t.value !== "*" && t.value !== "/" && t.value !== "%")) break;
      advance();
      const right = parseFactor();
      if (right === null) return null;
      if (t.value === "*") left = left * right;
      else if (t.value === "/") left = left / right;
      else left = left % right;
    }
    return left;
  };

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (true) {
      const t = peek();
      if (!t || t.type !== "op" || (t.value !== "+" && t.value !== "-")) break;
      advance();
      const right = parseTerm();
      if (right === null) return null;
      if (t.value === "+") left = left + right;
      else left = left - right;
    }
    return left;
  };

  const result = parseExpr();
  if (result === null || !Number.isFinite(result) || pos !== tokens.length) return null;
  return String(result);
}

function parseExpression(text: string): { expr: string; result: string } | null {
  const expr = text.trim();
  const result = calcEval(expr);
  return result == null ? null : { expr, result };
}

let active = false;
let host: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLUListElement | null = null;
let tabs: RankItem[] = [];
let filtered: PromptRow[] = [];
let selected = 0;
let query = "";
let mode = "tabs";
let suggestSeq = 0;
let suggestTimer: ReturnType<typeof setTimeout> | null = null;
let restoreFocus: Element | null = null;
const tabUrlMap = new Map<
  string,
  { source?: "tab" | "history" | "bookmark"; id?: number }
>();
let cachedEngines: SearchEngine[] | null = null;
let lastPool: Suggestion[] = [];

function isActive(): boolean {
  return active;
}

export function parseTabPrefix(text: string): string | null {
  const m = String(text || "").match(/^t\s+(.*\S)\s*$/i);
  return m ? m[1] : null;
}

export function isTabListAll(text: string): boolean {
  return /^\s*t\s+$/i.test(String(text || ""));
}

function openOmnibar(): void {
  if (active) return;
  tabs = [];
  mode = "open";
  active = true;
  render("Open", "Search, URL, or t for tabs");
}

function openIncognito(): void {
  if (active) return;
  tabs = [];
  mode = "incognito";
  active = true;
  render("Incognito", "Search or type URL");
}

function openEditUrl(): void {
  if (active) return;
  tabs = [];
  mode = "edit";
  active = true;
  render("Edit URL", "Search or type URL");
  inputEl!.value = location.href;
  ui.safeFocus(inputEl!, { preventScroll: true });
  try {
    inputEl!.select();
  } catch {}
  handleOpenInput(inputEl!.value);
}

function chooseWindow(
  data: { tabs?: WindowSummary[] } | null | undefined,
): void {
  if (active) return;
  tabs = (data && data.tabs) || [];
  mode = "moveWindow";
  active = true;
  render("Move tab to", "Choose a window...");
}

function requestSuggestions(
  suggestQuery: string,
  onResults: (items: Suggestion[]) => void,
): void {
  clearTimeout(suggestTimer ?? undefined);
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    if (!active || seq !== suggestSeq) return;
    const res =
      ((await sendMessage("suggest", {
        query: suggestQuery,
      })) as Suggestion[] | null) || [];
    if (!active || seq !== suggestSeq) return;
    const items = mode === "incognito" ? res.filter((it) => it.source !== "tab") : res;
    lastPool = items;
    onResults(items);
  }, 130);
}

function toSuggestionRow(
  item: RankItem,
  match: RankMatch["match"] | null,
): PromptRow {
  return {
    kind: "suggestion",
    title: item.title,
    url: item.url,
    match,
    source: item.source,
    folderPath: item.folderPath,
  };
}

function isOmnibarMode(): boolean {
  return mode === "open" || mode === "edit" || mode === "incognito";
}

function handleInput(): void {
  const raw = inputEl!.value;
  query = raw.trim();
  if (isOmnibarMode()) {
    handleOpenInput(raw);
  } else {
    filtered = query ? rankTabs(query, tabs) : tabs;
    selected = 0;
    renderList();
  }
}

function syncTabUrlMap(pool: Suggestion[]): void {
  tabUrlMap.clear();
  for (const it of pool) if (it.url) tabUrlMap.set(it.url, it);
}

function renderRecents(pool: Suggestion[]): void {
  syncTabUrlMap(pool);
  filtered = pool
    .slice(0, settings.getMaxResults())
    .map((item) => toSuggestionRow(item, null));
  selected = 0;
  renderList();
}

function renderRanked(
  pool: Suggestion[],
  term: string,
  row: PromptRow,
  tabQuery: string | null,
): void {
  syncTabUrlMap(pool);
  const scoped =
    tabQuery != null ? pool.filter((item) => item.source === "tab") : pool;
  const suggestions = rank(scoped, term).map(({ item, match }) =>
    toSuggestionRow(item, match),
  );
  const max = settings.getMaxResults();
  filtered = (tabQuery != null ? suggestions : [row, ...suggestions]).slice(0, max);
  selected = 0;
  renderList();
}

function handleOpenInput(queryText: string): void {
  if (mode !== "incognito" && isTabListAll(queryText)) {
    handleTabListAll();
    return;
  }
  const q = queryText.trim();
  const calc = parseExpression(q);
  if (calc) {
    query = q;
    tabUrlMap.clear();
    filtered = [{ kind: "calc", title: calc.expr, url: calc.result }];
    selected = 0;
    renderList();
    return;
  }
  const tabQuery = parseTabPrefix(q);
  const effective = tabQuery != null ? tabQuery : q;
  const kw = tabQuery != null ? null : parseKeyword(effective);
  const term = kw ? kw.rest : Url.suggestionTerm(effective);
  query = term;
  tabUrlMap.clear();
  if (!q) {
    filtered = [];
    selected = 0;
    renderList();
    if (lastPool.length) renderRecents(lastPool);
    requestSuggestions("", renderRecents);
    return;
  }
  let row: PromptRow;
  if (kw) {
    row = {
      kind: "search",
      title: `${kw.keyword} ${kw.rest}`,
      url: kw.url,
      keyword: kw.keyword,
    };
  } else {
    const isUrl = Url.looksLikeUrl(effective);
    row = isUrl
      ? { kind: "url", title: effective, url: effective }
      : { kind: "search", title: term, url: null };
  }
  filtered = [row];
  selected = 0;
  renderList();
  if (lastPool.length) renderRanked(lastPool, term, row, tabQuery);
  requestSuggestions(term, (res) => renderRanked(res, term, row, tabQuery));
}

function handleTabListAll(): void {
  clearTimeout(suggestTimer ?? undefined);
  suggestSeq++;
  const seq = suggestSeq;
  query = "";
  filtered = [];
  selected = 0;
  renderList();
  sendMessage("listTabs").then((res) => {
    if (!active || seq !== suggestSeq || !inputEl || !isTabListAll(inputEl.value)) return;
    tabUrlMap.clear();
    filtered = ((res || []) as TabSummary[])
      .map((item) => {
        const tab = { ...item, source: "tab" as const };
        if (tab.url) tabUrlMap.set(tab.url, tab);
        return toSuggestionRow(tab, null);
      })
      .slice(0, settings.getMaxResults());
    selected = 0;
    renderList();
  });
}

function rank(list: RankItem[], query: string): RankMatch[] {
  return rankMatches(query, list, settings.isFuzzyMatching());
}

function rankTabs(q: string, list: RankItem[]): RankItem[] {
  return rank(list, q).map((x) => x.item);
}

function render(title: string, placeholder: string): void {
  touch("prompt");
  cachedEngines = settings.getSearchEngines();
  const created = createShadowHost("jari-prompt-host", promptCss());
  host = created.host;
  const shadow = created.shadow;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = placeholder;
  inputEl.setAttribute("autocomplete", "off");
  inputEl.setAttribute("spellcheck", "false");
  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("input", (event) => event.stopPropagation());
  inputEl.addEventListener("beforeinput", (event) => event.stopPropagation());

  inputEl.addEventListener("keydown", (event) => event.stopPropagation());

  listEl = document.createElement("ul");
  listEl.className = "jari-prompt-list";

  const header = document.createElement("div");
  header.className = "jari-prompt-header";
  header.textContent = title;

  overlay.appendChild(listEl);
  overlay.appendChild(header);
  overlay.appendChild(inputEl);
  shadow.appendChild(overlay);

  filtered = tabs;
  renderList();

  restoreFocus = document.activeElement;
  ui.safeFocus(inputEl, { preventScroll: true });
}

function renderList(): void {
  return renderPromptList({
    listEl: listEl!,
    filtered,
    query,
    mode,
    tabUrlMap,
    selected,
  });
}

function move(delta: number): number {
  const next = movePrompt({
    listEl: listEl!,
    filtered,
    selected,
    delta,
  });
  selected = next;
  return next;
}

function onKeyDown(event: KeyboardEvent): void {
  let focused: Element | null;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  const inInput = focused === inputEl;
  if (inInput) {
    if (event.key === "Escape") {
      ui.consume(event);
      close();
    } else if (event.key === "Enter") {
      ui.consume(event);
      activate(event.ctrlKey || event.metaKey);
    } else if (event.key === "ArrowDown") {
      ui.consume(event);
      move(1);
    } else if (event.key === "ArrowUp") {
      ui.consume(event);
      move(-1);
    } else if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      ui.consume(event);
      move(event.shiftKey ? -1 : 1);
    }
    return;
  }
  if (event.key === "Escape") {
    ui.consume(event);
    close();
  } else if (event.key === "Enter") {
    ui.consume(event);
    if (event.ctrlKey || event.metaKey) activate(true);
    else close();
  } else if (
    event.key === "Tab" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    ui.consume(event);
    move(event.shiftKey ? -1 : 1);
  }
}

function openUrl(url: string, forceNewTab: boolean = false): void {
  sendMessage(
    mode === "incognito"
      ? "openIncognitoTab"
      : mode === "open" || forceNewTab
        ? "createTab"
        : "navigate",
    { url },
  );
}

function searchQuery(text: string, forceNewTab: boolean = false): void {
  sendMessage("search", {
    query: text,
    newTab: forceNewTab || mode !== "edit",
    incognito: mode === "incognito",
  });
}

function activate(forceNewTab: boolean = false): void {
  const item = filtered[selected];
  const rawValue = inputEl ? inputEl.value : "";
  const rawInput = rawValue.trim();
  const inOmnibar = isOmnibarMode();
  const tabRest = inOmnibar ? parseTabPrefix(rawInput) : null;
  const effectiveInput = tabRest != null ? tabRest : rawInput;
  const kwInput = tabRest != null ? null : parseKeyword(effectiveInput);
  const commitTerm = kwInput ? kwInput.rest : Url.suggestionTerm(effectiveInput);
  if (!item) {
    if (isTabListAll(rawValue)) {
      close();
      return;
    }
    if (mode === "open" && !rawInput) sendMessage("createTab");
    else if (mode === "incognito" && !rawInput) sendMessage("openIncognitoTab");
    else if (kwInput) openUrl(kwInput.url, forceNewTab);
    else if (effectiveInput && Url.looksLikeUrl(effectiveInput)) {
      openUrl(normalizeUrl(effectiveInput) || effectiveInput, forceNewTab);
    } else if (commitTerm) searchQuery(commitTerm, forceNewTab);
    close();
    return;
  }
  if (mode === "moveWindow") {
    sendMessage("moveTabIntoWindow", { targetWindowId: item.windowId });
  } else if (mode === "open" || mode === "edit" || mode === "incognito") {
    if (item.kind === "calc") {
      ui.copyText(item.url ?? "").then((ok) =>
        ui.toast(ok ? "Copied" : "Copy failed"),
      );
      close();
      return;
    }
    if (item.kind === "search") {
      if (item.keyword && item.url) openUrl(item.url, forceNewTab);
      else if (kwInput && kwInput.url) openUrl(kwInput.url, forceNewTab);
      else searchQuery(commitTerm, forceNewTab);
    } else if (item.url) {
      const match = mode === "edit" || forceNewTab
        ? undefined
        : tabUrlMap.get(item.url) || tabUrlMap.get(normalizeUrl(item.url) || "");
      if (match && match.id) sendMessage("activateTab", { id: match.id });
      else openUrl(item.url, forceNewTab);
    }
  } else {
    if (forceNewTab && item.url) openUrl(item.url, true);
    else sendMessage("activateTab", { id: item.id });
  }
  close();
}

function close(): void {
  clearTimeout(suggestTimer ?? undefined);
  suggestSeq++;
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  inputEl = null;
  listEl = null;
  tabs = [];
  filtered = [];
  selected = 0;
  query = "";
  mode = "tabs";
  active = false;
  cachedEngines = null;
  tabUrlMap.clear();

  if (
    restoreFocus &&
    restoreFocus.isConnected &&
    document.activeElement !== restoreFocus
  ) {
    ui.safeFocus(restoreFocus as HTMLElement, { preventScroll: true });
  }
  restoreFocus = null;
}

export const Prompt = {
  openOmnibar,
  openIncognito,
  openEditUrl,
  chooseWindow,
  close,
  onKeyDown,
  isActive,
};

register("prompt", { close, onKeyDown, isActive });

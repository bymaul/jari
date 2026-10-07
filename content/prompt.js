import { Url, normalizeUrl } from "../shared/url.js";
import { parseEngineKeyword } from "../shared/search-engines.js";
import { rankMatches } from "./rank.js";
import { settings } from "./settings.js";
import { sendMessage, createShadowHost, ui } from "./ui.js";
import { promptCss, renderText } from "./prompt/shared.js";
import { renderList as renderPromptList, move as movePrompt } from "./prompt/list.js";
export { promptCss, renderText };
import { deepActiveElement } from "./keymap.js";
import { register, touch } from "./overlays.js";

function parseKeyword(query) {
  return parseEngineKeyword(query, settings.getSearchEngines());
}

let active = false;
let host = null;
let overlay = null;
let inputEl = null;
let listEl = null;
let tabs = [];
let filtered = [];
let selected = 0;
let query = "";
let mode = "tabs";
let suggestSeq = 0;
let suggestTimer = null;
let restoreFocus = null;
let tabUrlMap = new Map();

function isActive() {
  return active;
}

export function parseTabPrefix(text) {
  const m = String(text || "").match(/^t\s+(.*\S)\s*$/i);
  return m ? m[1] : null;
}

export function isTabListAll(text) {
  return /^\s*t\s+$/i.test(String(text || ""));
}

function openOmnibar() {
  if (active) return;
  tabs = [];
  mode = "open";
  active = true;
  render("Open", "Search, URL, or t for tabs");
}

function openIncognito() {
  if (active) return;
  tabs = [];
  mode = "incognito";
  active = true;
  render("Incognito", "Search or type URL");
}

function openEditUrl() {
  if (active) return;
  tabs = [];
  mode = "edit";
  active = true;
  render("Edit URL", "Search or type URL");
  inputEl.value = location.href;
  inputEl.focus();
  try {
    inputEl.select();
  } catch {}
  handleOpenInput(inputEl.value);
}

function chooseWindow(data) {
  if (active) return;
  tabs = (data && data.tabs) || [];
  mode = "moveWindow";
  active = true;
  render("Move tab to", "Choose a window...");
}

function requestSuggestions(suggestQuery, onResults) {
  clearTimeout(suggestTimer);
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    if (!active || seq !== suggestSeq) return;
    const res = (await sendMessage("suggest", { query: suggestQuery })) || [];
    if (!active || seq !== suggestSeq) return;
    const items = mode === "incognito" ? res.filter((it) => it.source !== "tab") : res;
    tabUrlMap.clear();
    for (const it of items) if (it.url) tabUrlMap.set(it.url, it);
    onResults(items);
  }, 130);
}

function toSuggestionRow(item, match) {
  return {
    kind: "suggestion",
    title: item.title,
    url: item.url,
    match,
    source: item.source,
    folderPath: item.folderPath,
  };
}

function isOmnibarMode() {
  return mode === "open" || mode === "edit" || mode === "incognito";
}

function handleInput() {
  const raw = inputEl.value;
  query = raw.trim();
  if (isOmnibarMode()) {
    handleOpenInput(raw);
  } else {
    filtered = query ? rankTabs(query, tabs) : tabs;
    selected = 0;
    renderList();
  }
}

function handleOpenInput(queryText) {
  if (mode !== "incognito" && isTabListAll(queryText)) {
    handleTabListAll();
    return;
  }
  const q = queryText.trim();
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
    requestSuggestions("", (res) => {
      filtered = res
        .slice(0, settings.getMaxResults())
        .map((item) => toSuggestionRow(item, null));
      selected = 0;
      renderList();
    });
    return;
  }
  let row;
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
  requestSuggestions(term, (res) => {
    const pool =
      tabQuery != null ? res.filter((item) => item.source === "tab") : res;
    const suggestions = rank(pool, term).map(({ item, match }) =>
      toSuggestionRow(item, match),
    );
    const max = settings.getMaxResults();
    filtered = (tabQuery != null ? suggestions : [row, ...suggestions]).slice(0, max);
    selected = 0;
    renderList();
  });
}

function handleTabListAll() {
  clearTimeout(suggestTimer);
  suggestSeq++;
  const seq = suggestSeq;
  query = "";
  filtered = [];
  selected = 0;
  renderList();
  sendMessage("listTabs").then((res) => {
    if (!active || seq !== suggestSeq || !inputEl || !isTabListAll(inputEl.value)) return;
    tabUrlMap.clear();
    filtered = (res || [])
      .map((item) => {
        const tab = { ...item, source: "tab" };
        if (tab.url) tabUrlMap.set(tab.url, tab);
        return toSuggestionRow(tab, null);
      })
      .slice(0, settings.getMaxResults());
    selected = 0;
    renderList();
  });
}

function rank(list, query) {
  return rankMatches(query, list, settings.isFuzzyMatching());
}

function rankTabs(q, list) {
  return rank(list, q).map((x) => x.item);
}

function render(title, placeholder) {
  touch("prompt");
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
  inputEl.focus();
}

function renderList() {
  return renderPromptList({ listEl, filtered, query, mode, tabUrlMap, selected });
}

function move(delta) {
  const next = movePrompt({ listEl, filtered, selected, delta });
  selected = next;
  return next;
}

function onKeyDown(event) {
  let focused;
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

function openUrl(url, forceNewTab = false) {
  sendMessage(
    mode === "incognito"
      ? "openIncognitoTab"
      : mode === "open" || forceNewTab
        ? "createTab"
        : "navigate",
    { url },
  );
}

function searchQuery(text, forceNewTab = false) {
  sendMessage("search", {
    query: text,
    newTab: forceNewTab || mode !== "edit",
    incognito: mode === "incognito",
  });
}

function activate(forceNewTab = false) {
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

function close() {
  clearTimeout(suggestTimer);
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

  if (
    restoreFocus &&
    restoreFocus.isConnected &&
    document.activeElement !== restoreFocus
  ) {
    restoreFocus.focus();
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

import { Url } from "../shared/url.js";
import { fuzzyIndices, rankMatches, substringIndices } from "./rank.js";
import { settings } from "./settings.js";
import { sendMessage } from "./ui.js";
import { register, touch } from "./overlays.js";

const SEARCH_ENGINES = {
  g: "https://www.google.com/search?q=%s",
  yt: "https://www.youtube.com/results?search_query=%s",
  gh: "https://github.com/search?q=%s",
  wiki: "https://en.wikipedia.org/wiki/Special:Search?search=%s",
  chat: "https://chatgpt.com/?q=%s",
};
function parseKeyword(query) {
  const m = query.trim().match(/^(\w+)\s+(.*\S)/);
  if (!m) return null;
  const kw = m[1].toLowerCase();
  const tmpl = SEARCH_ENGINES[kw];
  if (!tmpl) return null;
  return {
    keyword: kw,
    rest: m[2],
    url: tmpl.replace("%s", encodeURIComponent(m[2])),
  };
}

let active = false;
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
    tabUrlMap.clear();
    for (const it of res) if (it.url) tabUrlMap.set(it.url, it);
    onResults(res);
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

function handleOpenInput(queryText) {
  if (isTabListAll(queryText)) {
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
      : { kind: "search", title: effective, url: null };
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
    filtered = tabQuery != null ? suggestions : [row, ...suggestions];
    selected = 0;
    renderList();
  });
}

function handleTabListAll() {
  clearTimeout(suggestTimer);
  suggestSeq++;
  query = "";
  filtered = [];
  selected = 0;
  renderList();
  sendMessage("listTabs").then((res) => {
    if (!active || !inputEl || !isTabListAll(inputEl.value)) return;
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
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = placeholder;
  inputEl.addEventListener("input", () => {
    const raw = inputEl.value;
    query = raw.trim();
    if (mode === "open" || mode === "edit" || mode === "incognito") {
      handleOpenInput(raw);
    } else {
      filtered = query ? rankTabs(query, tabs) : tabs;
      selected = 0;
      renderList();
    }
  });

  inputEl.addEventListener("keydown", (event) => event.stopPropagation());

  listEl = document.createElement("ul");
  listEl.className = "jari-prompt-list";

  const header = document.createElement("div");
  header.className = "jari-prompt-header";
  header.textContent = title;

  overlay.appendChild(listEl);
  overlay.appendChild(header);
  overlay.appendChild(inputEl);
  document.body.appendChild(overlay);

  filtered = tabs;
  renderList();

  restoreFocus = document.activeElement;
  inputEl.focus();
}

function renderText(el, text, indices) {
  if (!indices || indices.length === 0) {
    el.textContent = text;
    return;
  }
  const matched = new Set(indices);
  const frag = document.createDocumentFragment();
  let run = "";
  for (let i = 0; i < text.length; i++) {
    if (matched.has(i)) {
      if (run) {
        frag.appendChild(document.createTextNode(run));
        run = "";
      }
      const mark = document.createElement("span");
      mark.className = "jari-match";
      mark.textContent = text[i];
      frag.appendChild(mark);
    } else {
      run += text[i];
    }
  }
  if (run) frag.appendChild(document.createTextNode(run));
  el.appendChild(frag);
}

function makeSpan(className) {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

function renderTitleUrl(li, titleText, urlText, q) {
  const title = makeSpan("title");
  const url = makeSpan("url");
  if (q) {
    if (settings.isFuzzyMatching()) {
      renderText(title, titleText, fuzzyIndices(q, titleText));
      renderText(url, urlText, fuzzyIndices(q, urlText));
    } else {
      renderText(title, titleText, substringIndices(q, titleText));
      renderText(url, urlText, substringIndices(q, urlText));
    }
  } else {
    title.textContent = titleText;
    url.textContent = urlText;
  }
  li.appendChild(title);
  li.appendChild(url);
  return li;
}

function renderSuggestionRow(row) {
  const li = document.createElement("li");
  let titleText;
  if (row.kind === "search") {
    if (row.keyword)
      titleText = `Search ${row.keyword} for "${row.title.split(" ").slice(1).join(" ")}"`;
    else titleText = `Search for "${row.title}"`;
  } else if (row.kind === "url") {
    titleText = `Open ${row.title}`;
  } else {
    const isSwitch =
      row.url &&
      tabUrlMap.has(row.url) &&
      tabUrlMap.get(row.url).source === "tab";
    titleText = isSwitch
      ? `Switch to: ${row.title || "(untitled)"}`
      : row.title || "(untitled)";
  }
  let urlText = row.kind === "suggestion" ? row.url || "" : "";
  if (row.kind === "suggestion" && row.url && tabUrlMap.has(row.url)) {
    const tabInfo = tabUrlMap.get(row.url);
    if (tabInfo && tabInfo.source === "tab") urlText = `${urlText}  •  Tab`;
    else if (row.folderPath) urlText = `${urlText}  •  ${row.folderPath}`;
  } else if (row.folderPath) {
    urlText = row.folderPath;
  }
  return renderTitleUrl(
    li,
    titleText,
    urlText,
    row.kind === "suggestion" ? query : "",
  );
}

function renderTabRow(tab, winLabel) {
  const li = document.createElement("li");
  const win = makeSpan("jari-win-tag");
  win.textContent = "#" + winLabel;
  li.appendChild(win);
  return renderTitleUrl(li, tab.title || "(untitled)", tab.url || "", query);
}

function renderList() {
  const rows = filtered.slice(0, settings.getMaxResults());
  listEl.textContent = "";
  if (mode === "open" || mode === "edit" || mode === "incognito") {
    for (const row of rows) listEl.appendChild(renderSuggestionRow(row));
    highlight();
    return;
  }

  const winLabels = new Map();
  let winIndex = 0;
  for (const tab of rows) {
    if (!winLabels.has(tab.windowId)) winLabels.set(tab.windowId, ++winIndex);
  }
  for (const tab of rows)
    listEl.appendChild(renderTabRow(tab, winLabels.get(tab.windowId)));
  highlight();
}

function highlight() {
  Array.from(listEl.children).forEach((li, i) =>
    li.classList.toggle("selected", i === selected),
  );
  const el = listEl.children[selected];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function move(delta) {
  if (filtered.length === 0) return;
  selected = (selected + delta + filtered.length) % filtered.length;
  highlight();
}

function onKeyDown(event) {
  const inInput = document.activeElement === inputEl;
  if (inInput) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(-1);
    } else if (
      event.key === "Tab" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(event.shiftKey ? -1 : 1);
    }
    return;
  }
  if (event.key === "Escape" || event.key === "Enter") {
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  } else if (
    event.key === "Tab" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    move(event.shiftKey ? -1 : 1);
  }
}

function openUrl(url) {
  sendMessage(
    mode === "incognito"
      ? "openIncognitoTab"
      : mode === "open"
        ? "createTab"
        : "navigate",
    { url },
  );
}

function searchQuery(text) {
  sendMessage("search", {
    query: text,
    newTab: mode !== "edit",
    incognito: mode === "incognito",
  });
}

function activate() {
  const item = filtered[selected];
  const rawInput = inputEl ? inputEl.value.trim() : "";
  const inOmnibar =
    mode === "open" || mode === "edit" || mode === "incognito";
  const tabRest = inOmnibar ? parseTabPrefix(rawInput) : null;
  const effectiveInput = tabRest != null ? tabRest : rawInput;
  const kwInput = parseKeyword(effectiveInput);
  if (!item) {
    if (mode === "open" && !rawInput) sendMessage("createTab");
    else if (mode === "incognito" && !rawInput) sendMessage("openIncognitoTab");
    else if (kwInput) openUrl(kwInput.url);
    else if (effectiveInput && Url.looksLikeUrl(effectiveInput)) {
      openUrl(Url.normalizeUrl(effectiveInput) || effectiveInput);
    } else if (effectiveInput) searchQuery(effectiveInput);
    close();
    return;
  }
  if (mode === "moveWindow") {
    sendMessage("moveTabIntoWindow", { targetWindowId: item.windowId });
  } else if (mode === "open" || mode === "edit" || mode === "incognito") {
    if (item.kind === "search") {
      if (item.keyword && item.url) openUrl(item.url);
      else if (kwInput && kwInput.url) openUrl(kwInput.url);
      else searchQuery(rawInput);
    } else if (item.url) {
      const match = tabUrlMap.get(item.url);
      if (match && match.id) sendMessage("activateTab", { id: match.id });
      else openUrl(item.url);
    }
  } else {
    sendMessage("activateTab", { id: item.id });
  }
  close();
}

function close() {
  clearTimeout(suggestTimer);
  suggestSeq++;
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
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

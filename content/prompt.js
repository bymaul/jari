import { Url, fuzzyIndices, rankMatches } from "./keymap.js";
import { settings } from "./settings.js";
import { sendMessage } from "./ui.js";
import { register } from "./overlays.js";

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

function isActive() {
  return active;
}

async function open() {
  if (active) return;
  tabs = (await sendMessage("listTabs")) || [];
  if (tabs.length === 0) return;
  mode = "tabs";
  active = true;
  render("Tabs", "Search tabs...");
}

function openOmnibar() {
  if (active) return;
  tabs = [];
  mode = "open";
  active = true;
  render("Open", "Search or type URL");
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

function openMerge(data) {
  if (active) return;
  tabs = (data && data.tabs) || [];
  mode = "merge";
  active = true;
  render("Merge into", "Choose a window...");
}

function handleOpenInput(queryText) {
  const q = queryText.trim();
  const term = Url.suggestionTerm(q);
  query = term;
  if (!q) {
    clearTimeout(suggestTimer);
    suggestSeq++;
    filtered = [];
    selected = 0;
    renderList();
    return;
  }
  const row = Url.looksLikeUrl(q)
    ? { kind: "url", title: q, url: q }
    : { kind: "search", title: q, url: null };
  filtered = [row];
  selected = 0;
  renderList();
  clearTimeout(suggestTimer);
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    if (!active || seq !== suggestSeq) return;
    const res = (await sendMessage("suggest", { query: term })) || [];
    if (!active || seq !== suggestSeq) return;
    const suggestions = rank(res, term).map(({ item, match }) => ({
      kind: "suggestion",
      title: item.title,
      url: item.url,
      match,
    }));
    filtered = [row, ...suggestions];
    selected = 0;
    renderList();
  }, 130);
}

function rank(list, query) {
  return rankMatches(query, list, settings.isFuzzyMatching());
}

function rankTabs(q, list) {
  return rank(list, q).map((x) => x.item);
}

function render(title, placeholder) {
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = placeholder;
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    query = q;
    if (mode === "open" || mode === "edit") {
      handleOpenInput(q);
    } else {
      filtered = q ? rankTabs(q, tabs) : tabs;
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
  if (q && settings.isFuzzyMatching()) {
    renderText(title, titleText, fuzzyIndices(q, titleText));
    renderText(url, urlText, fuzzyIndices(q, urlText));
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
  const titleText =
    row.kind === "search"
      ? `Search for "${row.title}"`
      : row.kind === "url"
        ? `Open ${row.title}`
        : row.title || "(untitled)";
  const urlText = row.kind === "suggestion" ? row.url || "" : "";
  return renderTitleUrl(li, titleText, urlText, row.kind === "suggestion" ? query : "");
}

function renderTabRow(tab, winLabel) {
  const li = document.createElement("li");
  const win = makeSpan("jari-win-tag");
  win.textContent = "#" + winLabel;
  li.appendChild(win);
  return renderTitleUrl(li, tab.title || "(untitled)", tab.url || "", query);
}

function renderList() {
  const rows = filtered.slice(0, 50);
  listEl.textContent = "";
  if (mode === "open" || mode === "edit") {
    for (const row of rows) listEl.appendChild(renderSuggestionRow(row));
    highlight();
    return;
  }

  const winLabels = new Map();
  let winIndex = 0;
  for (const tab of rows) {
    if (!winLabels.has(tab.windowId)) winLabels.set(tab.windowId, ++winIndex);
  }
  for (const tab of rows) listEl.appendChild(renderTabRow(tab, winLabels.get(tab.windowId)));
  highlight();
}

function highlight() {
  Array.from(listEl.children).forEach((li, i) => li.classList.toggle("selected", i === selected));
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

function activate() {
  const item = filtered[selected];
  if (!item) {

    if (mode === "open" && !inputEl.value.trim()) sendMessage("createTab");
    close();
    return;
  }
  if (mode === "merge") {

    sendMessage("mergeTab", { targetWindowId: item.windowId });
  } else if (mode === "open" || mode === "edit") {

    if (item.kind === "search") sendMessage("search", { query: inputEl.value, newTab: mode === "open" });
    else if (item.url) sendMessage(mode === "open" ? "createTab" : "navigate", { url: item.url });
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

  if (restoreFocus && restoreFocus.isConnected && document.activeElement !== restoreFocus) {
    restoreFocus.focus();
  }
  restoreFocus = null;
}

export const Prompt = { open, openOmnibar, openEditUrl, openMerge, close, onKeyDown, isActive };

register("prompt", { close, onKeyDown, isActive });

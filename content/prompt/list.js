import { fuzzyIndices, substringIndices } from "../rank.js";
import { settings } from "../settings.js";
import { renderText } from "./shared.js";

function makeSpan(className) {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

export function renderTitleUrl(li, titleText, urlText, q) {
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

export function renderSuggestionRow(row, query, tabUrlMap) {
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

export function renderTabRow(tab, winLabel, query) {
  const li = document.createElement("li");
  const win = makeSpan("jari-win-tag");
  win.textContent = "#" + winLabel;
  li.appendChild(win);
  return renderTitleUrl(li, tab.title || "(untitled)", tab.url || "", query);
}

export function renderList({ listEl, filtered, query, mode, tabUrlMap, selected = 0 }) {
  const rows = filtered.slice(0, settings.getMaxResults());
  const frag = document.createDocumentFragment();
  if (mode === "open" || mode === "edit" || mode === "incognito") {
    for (const row of rows) frag.appendChild(renderSuggestionRow(row, query, tabUrlMap));
  } else {
    const winLabels = new Map();
    let winIndex = 0;
    for (const tab of rows) {
      if (!winLabels.has(tab.windowId)) winLabels.set(tab.windowId, ++winIndex);
    }
    for (const tab of rows)
      frag.appendChild(renderTabRow(tab, winLabels.get(tab.windowId), query));
  }
  listEl.textContent = "";
  listEl.appendChild(frag);
  highlight({ listEl, selected });
  if (selected === 0) {
    try {
      listEl.scrollTop = 0;
    } catch {}
  }
}

export function highlight({ listEl, selected, scroll = false }) {
  const sel = typeof selected === "number" ? selected : 0;
  Array.from(listEl.children).forEach((li, i) =>
    li.classList.toggle("selected", i === sel),
  );
  if (!scroll) return;
  const el = listEl.children[sel];
  if (el) el.scrollIntoView({ block: "nearest" });
}

export function move({ listEl, filtered, selected, delta }) {
  if (filtered.length === 0) return selected;
  const next = (selected + delta + filtered.length) % filtered.length;
  highlight({ listEl, selected: next, scroll: true });
  return next;
}

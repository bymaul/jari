import { settings } from "./settings.js";
import { ui } from "./ui.js";
import { COMMAND_CATALOG } from "./catalog.js";
import { displayCombo } from "./keymap.js";
import { register, touch } from "./overlays.js";

const STEP = 50;
const COLUMNS = 3;

let active = false;
let overlay = null;
let listEl = null;
let footerBar = null;
let entries = [];
let searching = false;
let query = '';
let matches = [];
let currentIdx = 0;
let gPending = false;

const FOOTER_DEFAULT = 'j/k scroll | / search | esc close';

function isActive() {
  return active;
}

function open() {
  if (active) return;
  active = true;
  touch("help");
  render();

  overlay.tabIndex = -1;
  overlay.focus();
}

function render() {
  overlay = document.createElement('div');
  overlay.className = 'jari-overlay jari-help';

  const title = document.createElement('div');
  title.className = 'jari-help-title';
  title.textContent = 'Jari keybindings';
  overlay.appendChild(title);

  entries = [];
  searching = false;
  query = '';
  matches = [];
  currentIdx = 0;

  const byCommand = new Map();
  for (const [key, commandName] of Object.entries(settings.getKeymap())) {
    if (!byCommand.has(commandName)) byCommand.set(commandName, []);
    byCommand.get(commandName).push(key);
  }

  const byCategory = new Map();
  for (const [commandName, meta] of Object.entries(COMMAND_CATALOG)) {
    const keys = byCommand.get(commandName) || [];
    const id = meta.category || "other";
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push({ keys, label: meta.label, commandName });
  }

  listEl = document.createElement('div');
  listEl.className = 'jari-help-list';
  listEl.appendChild(
    ui.buildCategorizedGrid(byCategory, {
      columnCount: COLUMNS,
      gridClass: 'jari-help-columns',
      columnClass: 'jari-help-column',
      headerClass: 'jari-help-cat-header',
      renderEntries(tbody, rowEntries) {
        for (const { keys, label, commandName } of rowEntries) {
          const tr = document.createElement('tr');
          const keyTd = document.createElement('td');
          keyTd.className = 'jari-help-key';
          if (keys.length === 0) {
            keyTd.textContent = 'unbound';
            keyTd.classList.add('jari-unbound');
          } else {
            keyTd.textContent = keys.map(displayCombo).join(', ');
          }
          const labelTd = document.createElement('td');
          labelTd.className = 'jari-help-label';
          labelTd.textContent = label;
          tr.appendChild(keyTd);
          tr.appendChild(labelTd);
          tbody.appendChild(tr);
          entries.push({
            tr,
            keyTd,
            labelTd,
            haystack: `${keys.join(' ')} ${label} ${commandName}`.toLowerCase(),
          });
        }
      },
    }),
  );
  overlay.appendChild(listEl);

  const footer = document.createElement('div');
  footer.className = 'jari-help-footer';
  footerBar = document.createElement('span');
  footerBar.textContent = FOOTER_DEFAULT;
  footer.appendChild(footerBar);
  overlay.appendChild(footer);

  document.body.appendChild(overlay);
}

function updateFooter() {
  if (!footerBar) return;
  if (searching) {
    footerBar.textContent =
      matches.length === 0
        ? `/${query} — No match`
        : `/${query} ${currentIdx + 1}/${matches.length} (Enter done)`;
  } else if (matches.length > 0) {
    footerBar.textContent = `${currentIdx + 1}/${matches.length} (n/N jump) | / search | esc close`;
  } else {
    footerBar.textContent = FOOTER_DEFAULT;
  }
}

function saveOriginal(td) {
  if (td._jariOrig === undefined) td._jariOrig = td.textContent;
  return td._jariOrig;
}

function restoreCell(td) {
  if (td._jariOrig !== undefined) {
    try {
      td.textContent = td._jariOrig;
    } catch {}
    td._jariOrig = undefined;
  }
}

function clearSearchHighlights() {
  for (const entry of entries) {
    restoreCell(entry.keyTd);
    restoreCell(entry.labelTd);
  }
  matches = [];
  currentIdx = 0;
}

function highlightCell(td, q) {
  const orig = saveOriginal(td);
  const lower = orig.toLowerCase();
  const parts = [];
  let pos = 0;
  let found = false;
  while (true) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    found = true;
    parts.push({ text: orig.slice(pos, idx), match: false });
    parts.push({ text: orig.slice(idx, idx + q.length), match: true });
    pos = idx + q.length;
  }
  if (!found) return [];
  parts.push({ text: orig.slice(pos), match: false });
  try {
    td.textContent = '';
  } catch {
    return [];
  }
  const spans = [];
  for (const part of parts) {
    if (!part.text) continue;
    if (part.match) {
      const span = document.createElement('span');
      span.className = 'jari-find-hit';
      span.textContent = part.text;
      td.appendChild(span);
      spans.push(span);
    } else {
      td.appendChild(document.createTextNode(part.text));
    }
  }
  return spans;
}

function markCurrent() {
  for (const m of matches) m.span.className = 'jari-find-hit';
  if (matches.length > 0) matches[currentIdx].span.className = 'jari-find-current';
}

function scrollMatchIntoView() {
  if (matches.length === 0) return;
  try {
    matches[currentIdx].entry.tr.scrollIntoView({ block: 'nearest' });
  } catch {}
}

function applySearch() {
  clearSearchHighlights();
  const q = query.toLowerCase();
  if (q) {
    for (const entry of entries) {
      for (const td of [entry.keyTd, entry.labelTd]) {
        try {
          for (const span of highlightCell(td, q)) {
            matches.push({ entry, span });
          }
        } catch {}
      }
    }
  }
  currentIdx = 0;
  markCurrent();
  updateFooter();
  scrollMatchIntoView();
}

function stepMatch(delta) {
  if (matches.length === 0) return;
  const len = matches.length;
  currentIdx = (((currentIdx + delta) % len) + len) % len;
  markCurrent();
  updateFooter();
  scrollMatchIntoView();
}

function onKeyDown(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const key = event.key;
  const hasMod = event.ctrlKey || event.altKey || event.metaKey;
  if (searching) {
    if (key === 'Escape') {
      searching = false;
      query = '';
      clearSearchHighlights();
      updateFooter();
      return;
    }
    if (key === 'Enter') {
      searching = false;
      updateFooter();
      return;
    }
    if (key === 'Backspace') {
      query = query.slice(0, -1);
      applySearch();
      return;
    }
    if (key.length === 1 && !hasMod) {
      query += key;
      applySearch();
      return;
    }
  } else {
    if (key === 'Escape') {
      if (matches.length > 0) {
        clearSearchHighlights();
        updateFooter();
        return;
      }
      close();
      return;
    }
    if (key === '/' && !hasMod) {
      searching = true;
      query = '';
      clearSearchHighlights();
      updateFooter();
      return;
    }
    if ((key === 'n' || key === 'N') && !hasMod && matches.length > 0) {
      stepMatch(key === 'n' ? 1 : -1);
      return;
    }
  }
  if (event.key === 'g') {
    gPending = true;
    return;
  }
  if (gPending) {
    gPending = false;
    if (event.key === 'g') listEl.scrollTo(0, 0);
    return;
  }
  if (event.ctrlKey) {
    if (event.key === 'd') listEl.scrollBy(0, listEl.clientHeight * 0.5);
    else if (event.key === 'u') listEl.scrollBy(0, -listEl.clientHeight * 0.5);
    else if (event.key === 'f') listEl.scrollBy(0, listEl.clientHeight * 0.9);
    else if (event.key === 'b') listEl.scrollBy(0, -listEl.clientHeight * 0.9);
    return;
  }
  switch (event.key) {
    case 'G':
      listEl.scrollTo(0, listEl.scrollHeight);
      break;
    case 'j':
    case 'ArrowDown':
      listEl.scrollBy(0, STEP);
      break;
    case 'k':
    case 'ArrowUp':
      listEl.scrollBy(0, -STEP);
      break;
  }
}

function close() {
  try {
    clearSearchHighlights();
  } catch {}
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  listEl = null;
  footerBar = null;
  entries = [];
  searching = false;
  query = '';
  matches = [];
  currentIdx = 0;
  gPending = false;
  active = false;
}

export const Help = { open, close, onKeyDown, isActive };

register("help", { close, onKeyDown, isActive });

import { settings } from "./settings.js";
import { ui, createShadowHost } from "./ui.js";
import { COMMAND_CATALOG } from "./catalog.js";
import { deepActiveElement, displayCombo } from "./keymap.js";
import { register, touch } from "./overlays.js";
import { promptCss } from "./prompt/shared.js";
import { Find } from "./find.js";

const STEP = 50;
const COLUMNS = 3;

let active = false;
let host = null;
let overlay = null;
let listEl = null;
let barEl = null;
let statusEl = null;
let inputEl = null;
let restoreFocus = null;
let entries = [];
let query = '';
let matches = [];
let currentIdx = 0;
let gPending = false;

const HINTS_FILTER = 'Enter done | Esc cancel';
const HINTS_NAV = 'j/k scroll | / filter | n/N jump | esc close';

function isActive() {
  return active;
}

function open() {
  if (active) return;
  active = true;
  touch("help");
  try {
    if (Find.hasHighlights()) Find.hideHighlights();
  } catch {}
  restoreFocus = document.activeElement;
  render();
  overlay.tabIndex = -1;
  overlay.focus();
  updateStatus();
}

function filterFocused() {
  if (!inputEl) return false;
  try {
    return deepActiveElement() === inputEl;
  } catch {
    return document.activeElement === inputEl;
  }
}

function focusOverlay() {
  if (!overlay) return;
  try {
    overlay.focus();
  } catch {}
}

function openFilter() {
  if (inputEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'jari-prompt-input';
  input.placeholder = 'Filter keys and commands';
  input.value = query;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('maxlength', '200');
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepMatch(event.key === 'ArrowDown' ? 1 : -1);
    }
  });
  input.addEventListener('input', () => {
    query = input.value;
    applySearch();
  });
  inputEl = input;
  barEl.insertBefore(input, statusEl);
  input.focus();
  try {
    input.select();
  } catch {}
  updateStatus();
}

function closeFilter() {
  if (!inputEl) return;
  try {
    inputEl.remove();
  } catch {}
  try {
    inputEl.blur();
  } catch {}
  inputEl = null;
  focusOverlay();
  updateStatus();
}

function helpCss() {
  return (
    promptCss() +
    `
    .jari-help-list {
      display: block;
      max-height: 60vh;
      overflow: auto;
    }
    .jari-help-columns {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0 3ex;
      align-items: start;
    }
    .jari-help-column { min-width: 0; }
    .jari-help table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin-bottom: 2ex;
      margin-top: 0;
    }
    .jari-help tr.jari-help-cat-header th {
      background: #252530;
      font-size: var(--jari-header-font-size, 9pt) !important;
      font-weight: var(--jari-header-font-weight, bold) !important;
      color: #cdcdcd;
      text-align: left;
      border-bottom: 1px solid #333738;
      padding: 0.25ex 0.5ex;
    }
    .jari-help td {
      padding: 0 0.5ex;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      height: var(--jari-cmplt-option-height, 1.4em);
      line-height: var(--jari-cmplt-option-height, 1.4em) !important;
      text-align: left !important;
    }
    .jari-help td.jari-help-key {
      width: 40%;
      font-weight: bold !important;
      color: #cdcdcd;
    }
    .jari-help td.jari-help-key.jari-unbound {
      font-weight: normal !important;
      font-style: italic;
      color: #878787;
    }
    .jari-prompt-footer {
      display: flex;
      align-items: baseline;
      gap: 1ex;
      line-height: var(--jari-cmdl-line-height, 1.5);
    }
    .jari-help-status {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .jari-prompt-input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      color: #cdcdcd;
      background: #1c1c24;
      border: none !important;
      border-top: 1px solid #333738;
      outline: none !important;
      box-shadow: none !important;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      font-weight: normal !important;
      text-align: left !important;
      padding: 0.25ex 0.5ex;
      margin: 0;
    }
    .jari-prompt-input::placeholder {
      color: #878787;
    }
    .jari-prompt-footer .jari-prompt-input {
      flex: 1 1 auto;
      min-width: 0;
      width: auto;
      padding: 0;
      background: transparent;
      line-height: inherit !important;
    }
    .jari-find-hit {
      background: rgba(var(--jari-accent-rgb, 224, 163, 99), 0.35) !important;
      color: #1a1a1a !important;
      border-radius: 2px;
      padding: 0 1px;
    }
    .jari-find-current {
      background: var(--jari-accent, #e0a363) !important;
      color: #1a1a1a !important;
      border-radius: 2px;
      padding: 0 1px;
      outline: 1px solid var(--jari-accent-border, #c38a22);
    }
    .jari-overlay ::selection {
      background: var(--jari-accent, #e0a363);
      color: #1a1a1a;
    }
  `
  );
}

function render() {
  const created = createShadowHost("jari-help-host", helpCss());
  host = created.host;
  const shadow = created.shadow;
  overlay = document.createElement('div');
  overlay.className = 'jari-overlay jari-prompt jari-help';

  const title = document.createElement('div');
  title.className = 'jari-prompt-header';
  title.textContent = 'Jari keybindings';
  overlay.appendChild(title);

  entries = [];
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

  barEl = document.createElement('div');
  barEl.className = 'jari-prompt-footer';
  statusEl = document.createElement('span');
  statusEl.className = 'jari-help-status';
  barEl.appendChild(statusEl);
  overlay.appendChild(barEl);

  shadow.appendChild(overlay);
}

function updateStatus() {
  if (!statusEl) return;
  const hints = inputEl ? HINTS_FILTER : HINTS_NAV;
  const q = (query || '').trim();
  if (!q) {
    statusEl.textContent = hints;
    return;
  }
  const count =
    matches.length === 0 ? `no match for ${q}` : `${currentIdx + 1}/${matches.length}`;
  statusEl.textContent = `${count} | ${hints}`;
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
  updateStatus();
  scrollMatchIntoView();
}

function stepMatch(delta) {
  if (matches.length === 0) return;
  const len = matches.length;
  currentIdx = (((currentIdx + delta) % len) + len) % len;
  markCurrent();
  updateStatus();
  scrollMatchIntoView();
}

function clearFilter() {
  query = '';
  if (inputEl) inputEl.value = '';
  clearSearchHighlights();
}

function onKeyDown(event) {
  if (!active) return false;
  const key = event.key;
  if (key === "Control" || key === "Alt" || key === "Shift" || key === "Meta") {
    return false;
  }

  if (filterFocused()) {
    if (key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearFilter();
      closeFilter();
      return true;
    }
    if (key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeFilter();
      return true;
    }
    return false;
  }

  const hasMod = event.ctrlKey || event.altKey || event.metaKey;
  const scrollOnly =
    event.ctrlKey && ["d", "u", "f", "b"].includes(key) && !event.altKey && !event.metaKey;
  if (hasMod && !scrollOnly) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (key === 'Escape') {
    gPending = false;
    if (matches.length > 0) {
      clearFilter();
      updateStatus();
      return;
    }
    close();
    return;
  }
  if (key === '/') {
    gPending = false;
    openFilter();
    return;
  }
  if ((key === 'n' || key === 'N') && matches.length > 0) {
    gPending = false;
    stepMatch(key === 'n' ? 1 : -1);
    return;
  }
  if (key === 'g' && !gPending) {
    gPending = true;
    return;
  }
  if (gPending) {
    gPending = false;
    if (key === 'g') listEl.scrollTo(0, 0);
    return;
  }
  if (event.ctrlKey) {
    if (key === 'd') listEl.scrollBy(0, listEl.clientHeight * 0.5);
    else if (key === 'u') listEl.scrollBy(0, -listEl.clientHeight * 0.5);
    else if (key === 'f') listEl.scrollBy(0, listEl.clientHeight * 0.9);
    else if (key === 'b') listEl.scrollBy(0, -listEl.clientHeight * 0.9);
    return;
  }
  switch (key) {
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
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  listEl = null;
  barEl = null;
  statusEl = null;
  inputEl = null;
  entries = [];
  query = '';
  matches = [];
  currentIdx = 0;
  gPending = false;
  active = false;
  if (
    restoreFocus &&
    restoreFocus.isConnected &&
    document.activeElement !== restoreFocus
  ) {
    try {
      restoreFocus.focus();
    } catch {}
  }
  restoreFocus = null;
}

export const Help = { open, close, onKeyDown, isActive };

register("help", { close, onKeyDown, isActive });

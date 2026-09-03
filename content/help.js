import { settings } from "./settings.js";
import { ui } from "./ui.js";
import { COMMAND_CATALOG } from "./catalog.js";
import { register } from "./overlays.js";

const STEP = 50;
const COLUMNS = 3;

let active = false;
let overlay = null;
let listEl = null;
let gPending = false;

function isActive() {
  return active;
}

function open() {
  if (active) return;
  active = true;
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

  const byCommand = new Map();
  for (const [key, commandName] of Object.entries(settings.getKeymap())) {
    if (!byCommand.has(commandName)) byCommand.set(commandName, []);
    byCommand.get(commandName).push(key);
  }

  const byCategory = new Map();
  for (const [commandName, meta] of Object.entries(COMMAND_CATALOG)) {
    const keys = byCommand.get(commandName);
    if (!keys) continue;
    const id = meta.category || "other";
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push({ keys, label: meta.label });
  }

  listEl = document.createElement('div');
  listEl.className = 'jari-help-list';
  listEl.appendChild(
    ui.buildCategorizedGrid(byCategory, {
      columnCount: COLUMNS,
      gridClass: 'jari-help-columns',
      columnClass: 'jari-help-column',
      headerClass: 'jari-help-cat-header',
      renderEntries(tbody, entries) {
        for (const { keys, label } of entries) {
          const tr = document.createElement('tr');
          const keyTd = document.createElement('td');
          keyTd.className = 'jari-help-key';
          keyTd.textContent = keys.join(', ');
          const labelTd = document.createElement('td');
          labelTd.className = 'jari-help-label';
          labelTd.textContent = label;
          tr.appendChild(keyTd);
          tr.appendChild(labelTd);
          tbody.appendChild(tr);
        }
      },
    }),
  );
  overlay.appendChild(listEl);

  const footer = document.createElement('div');
  footer.className = 'jari-help-footer';
  const footerBar = document.createElement('span');
  footerBar.textContent = 'j/k scroll | 0-9 count | esc close';
  footer.appendChild(footerBar);
  overlay.appendChild(footer);

  document.body.appendChild(overlay);
}

function onKeyDown(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === 'Escape') {
    close();
    return;
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
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  listEl = null;
  gPending = false;
  active = false;
}

export const Help = { open, close, onKeyDown, isActive };

register("help", { close, onKeyDown, isActive });

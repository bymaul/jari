import { COMMAND_CATALOG } from "./catalog.js";
import { deepActiveElement, displayCombo, keysForCommand } from "./keymap.js";
import { fuzzyIndices, rankMatches, substringIndices } from "./rank.js";
import { settings } from "./settings.js";
import { createShadowHost } from "./ui.js";
import { promptCss, renderText } from "./prompt.js";
import { register, touch } from "./overlays.js";

let active = false;
let host = null;
let overlay = null;
let inputEl = null;
let listEl = null;
let source = [];
let filtered = [];
let selected = 0;
let query = "";
let restoreFocus = null;
let commandTable = null;

function isActive() {
  return active;
}

export function buildCommandSource(keymap) {
  const out = [];
  for (const [name, meta] of Object.entries(COMMAND_CATALOG)) {
    const keys = keysForCommand(keymap || {}, name);
    out.push({
      name,
      title: `${meta.label} ${name}`,
      url: keys.join(" "),
      detail: keys.map(displayCombo).join(", ") || "unbound",
    });
  }
  return out;
}

export function filterCommands(items, q, fuzzy = true) {
  const trimmed = String(q || "").trim();
  if (!trimmed) return [...items];
  const ranked = rankMatches(trimmed, items, fuzzy);
  return fuzzy ? ranked.map((x) => x.item) : ranked;
}

function open(table) {
  if (active) return;
  commandTable = table || null;
  source = buildCommandSource(settings.getKeymap());
  filtered = source;
  selected = 0;
  query = "";
  active = true;
  touch("palette");
  const created = createShadowHost("jari-palette-host", promptCss());
  host = created.host;
  const shadow = created.shadow;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  inputEl = document.createElement("input");
  inputEl.type = "text";
  inputEl.placeholder = "Run command...";
  inputEl.setAttribute("autocomplete", "off");
  inputEl.setAttribute("spellcheck", "false");
  inputEl.addEventListener("input", () => {
    query = inputEl.value.trim();
    filtered = filterCommands(source, query, settings.isFuzzyMatching());
    selected = 0;
    renderList();
  });
  inputEl.addEventListener("keydown", (event) => event.stopPropagation());

  listEl = document.createElement("ul");
  listEl.className = "jari-prompt-list";

  const header = document.createElement("div");
  header.className = "jari-prompt-header";
  header.textContent = "Command";

  overlay.appendChild(listEl);
  overlay.appendChild(header);
  overlay.appendChild(inputEl);
  shadow.appendChild(overlay);

  renderList();

  restoreFocus = document.activeElement;
  inputEl.focus();
}

function renderRow(item) {
  const li = document.createElement("li");
  const title = document.createElement("span");
  title.className = "title";
  if (query) {
    renderText(
      title,
      item.title,
      settings.isFuzzyMatching()
        ? fuzzyIndices(query, item.title)
        : substringIndices(query, item.title),
    );
  } else {
    title.textContent = item.title;
  }
  const detail = document.createElement("span");
  detail.className = "url";
  detail.textContent = item.detail;
  li.appendChild(title);
  li.appendChild(detail);
  return li;
}

function renderList() {
  const rows = filtered.slice(0, settings.getMaxResults());
  listEl.textContent = "";
  for (const row of rows) listEl.appendChild(renderRow(row));
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

function activate() {
  const item = filtered[selected];
  const table = commandTable;
  close();
  if (!item || !table) return;
  const cmd = table[item.name];
  if (!cmd || typeof cmd.run !== "function") return;
  cmd.run({ count: 1 });
}

function onKeyDown(event) {
  let focused;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  if (focused === inputEl) {
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

function close() {
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  inputEl = null;
  listEl = null;
  source = [];
  filtered = [];
  selected = 0;
  query = "";
  commandTable = null;
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

export const Palette = {
  open,
  close,
  onKeyDown,
  isActive,
};

register("palette", { close, onKeyDown, isActive });

import { COMMAND_CATALOG } from "./catalog.ts";
import { deepActiveElement, displayCombo, keysForCommand } from "./keymap.ts";
import { fuzzyIndices, rankMatches, substringIndices } from "./rank.ts";
import { settings } from "./settings.ts";
import { createShadowHost, ui } from "./ui.ts";
import { promptCss, renderText } from "./prompt/shared.ts";
import { register, touch } from "./overlays.ts";
import type { CommandContext } from "./commands.ts";

/** One palette row: the command plus its bound-key summary. */
type PaletteItem = {
  name: string;
  title: string;
  url: string;
  detail: string;
};

type CommandTable = Record<string, { run: (ctx: CommandContext) => void }>;

let active = false;
let host: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLUListElement | null = null;
let source: PaletteItem[] = [];
let filtered: PaletteItem[] = [];
let selected = 0;
let query = "";
let restoreFocus: Element | null = null;
let commandTable: CommandTable | null = null;

function isActive(): boolean {
  return active;
}

export function buildCommandSource(keymap: Record<string, string> | null) {
  const out: PaletteItem[] = [];
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

export function filterCommands(
  items: PaletteItem[],
  q: string,
  fuzzy = true,
): PaletteItem[] {
  const trimmed = String(q || "").trim();
  if (!trimmed) return [...items];
  const ranked = rankMatches(trimmed, items, fuzzy);
  return fuzzy
    ? (ranked.map((x) => x.item) as PaletteItem[])
    : (ranked as unknown as PaletteItem[]);
}

function handleInput(): void {
  query = inputEl!.value.trim();
  filtered = filterCommands(source, query, settings.isFuzzyMatching());
  selected = 0;
  renderList();
}

function open(table?: CommandTable | null): void {
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
  inputEl.addEventListener("input", handleInput);
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
  ui.safeFocus(inputEl, { preventScroll: true });
}

function renderRow(item: PaletteItem): HTMLLIElement {
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

function renderList(): void {
  const rows = filtered.slice(0, settings.getMaxResults());
  listEl!.textContent = "";
  for (const row of rows) listEl!.appendChild(renderRow(row));
  highlight();
}

function highlight(): void {
  Array.from(listEl!.children).forEach((li, i) =>
    li.classList.toggle("selected", i === selected),
  );
  const el = listEl!.children[selected];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function move(delta: number): void {
  if (filtered.length === 0) return;
  selected = (selected + delta + filtered.length) % filtered.length;
  highlight();
}

function activate(): void {
  const item = filtered[selected];
  const table = commandTable;
  close();
  if (!item || !table) return;
  const cmd = table[item.name];
  if (!cmd || typeof cmd.run !== "function") return;
  cmd.run({ count: 1 });
}

function onKeyDown(event: KeyboardEvent): void {
  let focused: Element | null;
  try {
    focused = deepActiveElement();
  } catch {
    focused = document.activeElement;
  }
  if (focused === inputEl) {
    if (event.key === "Escape") {
      ui.consume(event);
      close();
    } else if (event.key === "Enter") {
      ui.consume(event);
      activate();
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
  if (event.key === "Escape" || event.key === "Enter") {
    ui.consume(event);
    close();
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

function close(): void {
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
    ui.safeFocus(restoreFocus as HTMLElement, { preventScroll: true });
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

import { displayCombo, getPrefixEntries } from "./keymap.ts";
import { settings } from "./settings.ts";
import { COMMAND_CATALOG, type CommandDef } from "./catalog.ts";

let clueEl: HTMLDivElement | null = null;
let clueTimer: ReturnType<typeof setTimeout> | null = null;
let activePrefix: string | null = null;
let renderPrefix: string | null = null;
let renderCount = "";
let listEl: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;

function commandLabel(commandName: string): string {
  return (
    (COMMAND_CATALOG as Record<string, CommandDef | undefined>)[commandName]
      ?.label || commandName
  );
}

function isVisible() {
  return clueEl !== null;
}

function clearTimer() {
  if (clueTimer !== null) {
    clearTimeout(clueTimer);
    clueTimer = null;
  }
}

function hide() {
  clearTimer();
  activePrefix = null;
  renderPrefix = null;
  renderCount = "";
  listEl = null;
  titleEl = null;
  if (clueEl) {
    try {
      clueEl.remove();
    } catch {}
    clueEl = null;
  }
}

function displaySuffix(suffix: string): string {
  if (suffix === " ") return "<Space>";
  return suffix.length > 1 ? `${suffix[0]} ▸ ${suffix.slice(1)}` : suffix;
}

function paint(): void {
  if (!clueEl || !listEl || !titleEl) return;
  const rows = getPrefixEntries(settings.getKeymap(), renderPrefix);
  titleEl.textContent = `${renderCount || ""}${displayCombo(renderPrefix)} — ${rows.length} bindings`;
  listEl.textContent = "";
  for (const { suffix, command } of rows) {
    const row = document.createElement("div");
    row.className = "jari-clue-row";

    const key = document.createElement("span");
    key.className = "jari-clue-key";
    key.textContent = displaySuffix(suffix);

    const label = document.createElement("span");
    label.className = "jari-clue-label";
    label.textContent = commandLabel(command);

    row.appendChild(key);
    row.appendChild(label);
    listEl.appendChild(row);
  }
}

function render(prefix: string, countStr?: string): void {
  const keymap = settings.getKeymap();
  const entries = getPrefixEntries(keymap, prefix);
  if (entries.length === 0) return;

  if (clueEl) hide();

  try {
    if (document.fullscreenElement) return;
    const root = document.createElement("div");
    root.className = "jari-clue";

    const title = document.createElement("div");
    title.className = "jari-clue-title";
    root.appendChild(title);

    const list = document.createElement("div");
    list.className = "jari-clue-list";
    root.appendChild(list);

    (document.body || document.documentElement).appendChild(root);
    clueEl = root;
    titleEl = title;
    listEl = list;
    activePrefix = prefix;
    renderPrefix = prefix;
    renderCount = countStr || "";
    paint();
  } catch {}
}

function schedule(prefix: string, countStr = ""): void {
  hide();
  if (!settings.isClueEnabled()) return;
  const entries = getPrefixEntries(settings.getKeymap(), prefix);
  if (entries.length === 0) return;
  const delay = settings.getClueDelayMs();
  if (!Number.isFinite(delay) || delay <= 0) {
    render(prefix, countStr);
    return;
  }
  activePrefix = prefix;
  clueTimer = setTimeout(() => {
    clueTimer = null;
    render(prefix, countStr);
  }, delay);
}

function refresh(prefix: string, countStr = ""): void {
  if (!settings.isClueEnabled()) return;
  if (!isVisible()) {
    schedule(prefix, countStr);
    return;
  }
  renderPrefix = prefix;
  renderCount = countStr || "";
  paint();
}

function getActivePrefix(): string | null {
  return activePrefix;
}

export const Clue = {
  schedule,
  refresh,
  hide,
  isVisible,
  getActivePrefix,
};

export function __resetClueState(): void {
  hide();
}

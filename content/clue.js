import { getPrefixEntries } from "./keymap.js";
import { settings } from "./settings.js";
import { COMMAND_CATALOG } from "./catalog.js";

let clueEl = null;
let clueTimer = null;
let activePrefix = null;

function commandLabel(commandName) {
  return COMMAND_CATALOG[commandName]?.label || commandName;
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
  if (clueEl) {
    try {
      clueEl.remove();
    } catch {}
    clueEl = null;
  }
}

function render(prefix, countStr) {
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
    title.textContent = `${countStr || ""}${prefix} — ${entries.length} bindings`;
    root.appendChild(title);

    const list = document.createElement("div");
    list.className = "jari-clue-list";
    for (const { suffix, command } of entries) {
      const row = document.createElement("div");
      row.className = "jari-clue-row";

      const key = document.createElement("span");
      key.className = "jari-clue-key";
      key.textContent = suffix;

      const label = document.createElement("span");
      label.className = "jari-clue-label";
      label.textContent = commandLabel(command);

      row.appendChild(key);
      row.appendChild(label);
      list.appendChild(row);
    }
    root.appendChild(list);

    (document.body || document.documentElement).appendChild(root);
    clueEl = root;
    activePrefix = prefix;
  } catch {}
}

function schedule(prefix, countStr = "") {
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

function getActivePrefix() {
  return activePrefix;
}

export const Clue = { schedule, hide, isVisible, getActivePrefix };

export function __resetClueState() {
  hide();
}

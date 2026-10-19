import {
  SETTINGS_SCHEMA_VERSION,
  canonicalKey,
  clearingKeys,
  displayCombo,
  findBindingConflict,
  findOverlapConflicts,
  isBindablePrefixStarter,
  isBrowserTrapped,
  isReservedCombo,
  keymapDefaults,
  keysForCommand,
  modifierKeys,
  normalizeHintChars,
  settingsDefaults,
} from "../content/keymap.ts";
import { normalizeSitePattern } from "../shared/url.ts";
import { searchEngineDefaults } from "../shared/search-engines.ts";
import { pageNavTextDefaults } from "../shared/page-nav-texts.ts";
import { COMMAND_CATALOG } from "../content/catalog.ts";
import type { CommandDef, CommandName } from "../content/catalog.ts";
import type { Settings, HintTheme } from "../content/keymap.ts";
import { settings } from "../content/settings.ts";
import { ui } from "../content/ui.ts";
import { renderEngines, initEngines } from "./engines.ts";
import { renderPagenav, initPagenav } from "./pagenav.ts";

/* The unguarded elements are present in the static options.html — they are
   asserted non-null here so every runtime access keeps its original (throwing
   on missing) behavior; the `?.`-guarded ones stay nullable. */
const tableEl = document.querySelector<HTMLElement>("#keymap-table")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset")!;
const resetKeysBtn = document.querySelector<HTMLButtonElement>("#reset-keys");
const statusEl = document.querySelector<
  HTMLElement & { _timer?: ReturnType<typeof setTimeout> }
>("#status")!;
const saveStateEl = document.querySelector<HTMLElement>("#save-state");
const disabledList = document.querySelector<HTMLElement>("#disabled-list")!;
const scrollStepEl =
  document.querySelector<HTMLInputElement>("#scroll-step")!;
const smoothScrollEl =
  document.querySelector<HTMLInputElement>("#smooth-scroll")!;
const fuzzyMatchingEl =
  document.querySelector<HTMLInputElement>("#fuzzy-matching")!;
const timeoutEl = document.querySelector<HTMLInputElement>("#timeout")!;
const passthroughEl =
  document.querySelector<HTMLInputElement>("#passthrough-timeout")!;
const clueEnabledEl =
  document.querySelector<HTMLInputElement>("#clue-enabled")!;
const clueDelayEl = document.querySelector<HTMLInputElement>("#clue-delay")!;
const sourceTabEl = document.querySelector<HTMLInputElement>("#source-tab")!;
const sourceHistoryEl =
  document.querySelector<HTMLInputElement>("#source-history")!;
const sourceBookmarkEl =
  document.querySelector<HTMLInputElement>("#source-bookmark")!;
const maxResultsEl =
  document.querySelector<HTMLInputElement>("#max-results")!;
const copyFormatEl =
  document.querySelector<HTMLSelectElement>("#copy-format")!;
const hintCharsEl = document.querySelector<HTMLInputElement>("#hint-chars")!;
const hintCharsMetaEl = document.querySelector<HTMLElement>(
  "#hint-chars-meta",
);
const clickableSelectorEl = document.querySelector<HTMLInputElement>(
  "#clickable-selector",
);
const hintThemeEl =
  document.querySelector<HTMLSelectElement>("#hint-theme");
const hintFontSizeEl = document.querySelector<HTMLInputElement>(
  "#hint-font-size",
)!;
const keymapFilterEl =
  document.querySelector<HTMLInputElement>("#keymap-filter")!;
const keymapUnboundEl =
  document.querySelector<HTMLInputElement>("#keymap-unbound");
const keymapCountEl = document.querySelector<HTMLElement>("#keymap-count");
const siteInputEl =
  document.querySelector<HTMLInputElement>("#disabled-site-input")!;
const addSiteBtn = document.querySelector<HTMLButtonElement>(
  "#add-disabled-site",
)!;
const siteErrorEl = document.querySelector<HTMLElement>("#site-error");
const summaries: Record<string, HTMLElement | null> = {
  scrolling: document.querySelector("#summary-scrolling"),
  search: document.querySelector("#summary-search"),
  clipboard: document.querySelector("#summary-clipboard"),
  timing: document.querySelector("#summary-timing"),
  hints: document.querySelector("#summary-hints"),
  keybindings: document.querySelector("#summary-keybindings"),
  disabled: document.querySelector("#summary-disabled"),
};
const cards: Record<string, HTMLDetailsElement | null> = {
  scrolling: document.querySelector("#card-scrolling"),
  search: document.querySelector("#card-search"),
  clipboard: document.querySelector("#card-clipboard"),
  timing: document.querySelector("#card-timing"),
  hints: document.querySelector("#card-hints"),
  keybindings: document.querySelector("#card-keybindings"),
  disabled: document.querySelector("#card-disabled"),
};

const ADD_LABEL = "+";
const RECORDING_TITLE =
  "Press a key to bind. Esc cancels. Any letter can start a multi-key sequence — keep typing keys, then Enter to save.";

const OPEN_KEY = "jari.options.open";

function setSaveState(
  mode: "saving" | "failed" | "warn" | "saved",
  message?: string,
): void {
  if (!saveStateEl) return;
  saveStateEl.classList.remove("saving", "failed", "warn");
  if (mode === "saving") {
    saveStateEl.classList.add("saving");
    saveStateEl.textContent = message || "Saving...";
  } else if (mode === "failed") {
    saveStateEl.classList.add("failed");
    saveStateEl.textContent =
      message || "Save failed — will retry on next change";
  } else if (mode === "warn") {
    saveStateEl.classList.add("warn");
    saveStateEl.textContent = message || "Saved locally";
  } else {
    saveStateEl.textContent = message || "All changes saved";
  }
}

function savedState(): void {
  if (settings.isPersistedLocally()) {
    setSaveState("warn", "Saved on this device only — browser sync is full");
  } else {
    setSaveState("saved");
  }
}

async function savePatch(patch: Partial<Settings>): Promise<boolean> {
  setSaveState("saving");
  try {
    await settings.update(patch);
  } catch {
    setSaveState("failed");
    return false;
  }
  savedState();
  updateSummaries();
  return true;
}

function showFieldError(id: string, message: string): void {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = message;
  (el as HTMLElement).hidden = false;
}

function clearFieldError(id: string): void {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = "";
  (el as HTMLElement).hidden = true;
}

function markInvalid(el: Element | null, invalid: boolean): void {
  if (!el) return;
  if (invalid) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

function uniqueHintCount(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  return new Set(raw.toLowerCase().replace(/[^a-z0-9]/g, "")).size;
}

function updateHintMeta(): void {
  if (!hintCharsMetaEl) return;
  const n = uniqueHintCount(hintCharsEl.value);
  hintCharsMetaEl.textContent =
    n === 0
      ? ""
      : `${n} unique letter${n === 1 ? "" : "s"}/digit${n === 1 ? "" : "s"}`;
}

function countUnbound(): number {
  rebuildKeyIndex();
  let unbound = 0;
  for (const name of Object.keys(COMMAND_CATALOG)) {
    if (!keyByCommand.has(name)) unbound++;
  }
  return unbound;
}

function updateSummaries(): void {
  if (summaries.scrolling) {
    summaries.scrolling.textContent = `${settings.getScrollStep()}px · smooth ${settings.isSmoothScroll() ? "on" : "off"}`;
  }
  if (summaries.search) {
    const n = settings.getSuggestionSources().length;
    const engines = settings.getSearchEngines();
    const nav = settings.getPageNavTexts();
    summaries.search.textContent =
      `fuzzy ${settings.isFuzzyMatching() ? "on" : "off"} · ${n} source${n === 1 ? "" : "s"} · max ${settings.getMaxResults()}` +
      ` · ${engines.length} engine${engines.length === 1 ? "" : "s"} · default ${settings.getDefaultEngine()}` +
      ` · page nav ${nav.next.length}+${nav.prev.length}`;
  }
  if (summaries.clipboard) {
    summaries.clipboard.textContent =
      settings.getCopyFormat() === "markdown"
        ? "Markdown link"
        : "Plain (title + URL)";
  }
  if (summaries.timing) {
    const clue = settings.isClueEnabled()
      ? `${settings.getClueDelayMs()}ms`
      : "off";
    summaries.timing.textContent = `timeout ${settings.getTimeoutMs()}ms · passthrough ${settings.getPassthroughMs()}ms · clue ${clue}`;
  }
  if (summaries.hints) {
    const chars = settings.getHintChars();
    const custom = settings.getClickableSelector();
    summaries.hints.textContent =
      `${chars} (${chars.length}) · ${settings.getHintTheme()} ${settings.getHintFontSize()}px` +
      (custom ? " · custom selector" : "");
  }
  if (summaries.keybindings) {
    const total = Object.keys(COMMAND_CATALOG).length;
    const unbound = countUnbound();
    summaries.keybindings.textContent =
      unbound === 0
        ? `${total} commands · all bound`
        : `${total - unbound}/${total} bound · ${unbound} unbound`;
  }
  if (summaries.disabled) {
    const n = settings.getDisabledSites().length;
    summaries.disabled.textContent =
      n === 0 ? "enabled everywhere" : `${n} site${n === 1 ? "" : "s"}`;
  }
}

function restoreOpenState(): void {
  try {
    const stored = window.localStorage?.getItem(OPEN_KEY);
    if (!stored) return;
    const open = JSON.parse(stored);
    if (!open || typeof open !== "object") return;
    for (const [id, card] of Object.entries(cards)) {
      if (!card || typeof open[id] !== "boolean") continue;
      card.open = open[id];
    }
  } catch {
    // Invalid JSON or localStorage unavailable
  }
}

function persistOpenState(): void {
  const open: Record<string, boolean> = {};
  for (const [id, card] of Object.entries(cards)) {
    if (!card) continue;
    open[id] = card.open;
  }
  if (Object.keys(open).length === 0) return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {}
}

/* Single active capture session. Only one field records at a time so tabbing
   through the grid never arms a field by accident. */
let activeRecording: {
  button: HTMLButtonElement;
  name: string;
  waitingKeys: string[];
} | null = null;

function commandLabel(name: string): string {
  return COMMAND_CATALOG[name as CommandName]?.label || name;
}

async function load(): Promise<void> {
  await settings.load();
  /* Numeric settings are assigned raw and coerced by the DOM value setter —
     the casts preserve that exact runtime. */
  scrollStepEl.value = settings.getScrollStep() as unknown as string;
  smoothScrollEl.checked = settings.isSmoothScroll();
  fuzzyMatchingEl.checked = settings.isFuzzyMatching();
  timeoutEl.value = settings.getTimeoutMs() as unknown as string;
  passthroughEl.value = settings.getPassthroughMs() as unknown as string;
  clueEnabledEl.checked = settings.isClueEnabled();
  clueDelayEl.value = settings.getClueDelayMs() as unknown as string;
  const sources = settings.getSuggestionSources();
  sourceTabEl.checked = sources.includes("tab");
  sourceHistoryEl.checked = sources.includes("history");
  sourceBookmarkEl.checked = sources.includes("bookmark");
  maxResultsEl.value = settings.getMaxResults() as unknown as string;
  renderEngines();
  renderPagenav();
  copyFormatEl.value = settings.getCopyFormat();
  hintCharsEl.value = settings.getHintChars();
  if (clickableSelectorEl)
    clickableSelectorEl.value = settings.getClickableSelector();
  if (hintThemeEl) hintThemeEl.value = settings.getHintTheme();
  if (hintFontSizeEl)
    hintFontSizeEl.value = settings.getHintFontSize() as unknown as string;
  for (const el of [
    scrollStepEl,
    maxResultsEl,
    timeoutEl,
    passthroughEl,
    clueDelayEl,
    hintCharsEl,
    clickableSelectorEl,
    hintFontSizeEl,
    siteInputEl,
  ]) {
    markInvalid(el, false);
  }
  for (const id of [
    "error-scroll-step",
    "error-max-results",
    "error-engines",
    "error-timeout",
    "error-passthrough-timeout",
    "error-clue-delay",
    "error-hint-chars",
    "error-clickable-selector",
    "error-hint-font-size",
  ]) {
    clearFieldError(id);
  }
  if (siteErrorEl) {
    siteErrorEl.textContent = "";
    siteErrorEl.hidden = true;
  }
  updateHintMeta();
  restoreOpenState();
  renderKeymap();
  renderDisabled();
  updateSummaries();
  savedState();
  updateAddButton();
}

function matchesFilter(
  name: string,
  cmd: CommandDef,
  filter: string,
): boolean {
  if (name.toLowerCase().includes(filter)) return true;
  if (cmd.label.toLowerCase().includes(filter)) return true;
  return keysFor(name).some((key) => key.toLowerCase().includes(filter));
}

function renderKeymap(): void {
  cancelRecordingSilent();
  tableEl.textContent = "";
  rebuildKeyIndex();
  const rawFilter = keymapFilterEl.value.trim();
  const filter = rawFilter.toLowerCase();
  const unboundOnly = Boolean(keymapUnboundEl?.checked);
  const total = Object.keys(COMMAND_CATALOG).length;
  const byCategory = new Map<string, [string, CommandDef][]>();
  let shown = 0;
  let unboundTotal = 0;
  for (const [name, cmd] of Object.entries(COMMAND_CATALOG)) {
    const bound = keysFor(name).length > 0;
    if (!bound) unboundTotal++;
    if (unboundOnly && bound) continue;
    const id = cmd.category || "other";
    if (filter && !matchesFilter(name, cmd, filter)) continue;
    shown++;
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id)!.push([name, cmd]);
  }

  if (keymapCountEl) {
    const base =
      filter || unboundOnly
        ? `${shown} of ${total} commands`
        : `${total} commands`;
    keymapCountEl.textContent =
      unboundTotal === 0 ? base : `${base} · ${unboundTotal} unbound`;
  }

  if (byCategory.size === 0) {
    const empty = document.createElement("div");
    empty.className = "jari-keymap-filter-empty";
    const msg = document.createElement("span");
    msg.textContent =
      unboundOnly && !filter
        ? "Every command is bound. "
        : `No commands match "${rawFilter}". `;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = unboundOnly && !filter ? "Show all" : "Clear filter";
    clear.addEventListener("click", () => {
      keymapFilterEl.value = "";
      if (keymapUnboundEl) keymapUnboundEl.checked = false;
      renderKeymap();
      keymapFilterEl.focus();
    });
    empty.appendChild(msg);
    empty.appendChild(clear);
    tableEl.appendChild(empty);
    return;
  }

  tableEl.appendChild(
    ui.buildCategorizedGrid(byCategory, {
      columnCount: 2,
      gridClass: "jari-keymap-columns",
      columnClass: "jari-keymap-column",
      headerClass: "cat-header",
      renderEntries(tbody, entries) {
        for (const [name, cmd] of entries) {
          const row = document.createElement("tr");
          row.dataset.command = name;

          const labelTd = document.createElement("td");
          labelTd.className = "key-label";
          labelTd.textContent = cmd.label;

          const keyTd = document.createElement("td");
          keyTd.className = "key-cell";

          const inline = document.createElement("div");
          inline.className = "key-inline";
          const bindings = keysFor(name);
          const overlaps = rowOverlaps(name);
          for (const combo of bindings) {
            inline.appendChild(
              buildChip(name, cmd, combo, overlaps.mine.has(combo)),
            );
          }

          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.className = "key-add";
          addBtn.dataset.command = name;
          addBtn.textContent = ADD_LABEL;
          addBtn.title = `Add another binding for ${cmd.label}`;
          addBtn.setAttribute(
            "aria-label",
            `Add another binding for ${cmd.label}`,
          );
          addBtn.addEventListener("click", () => startRecording(addBtn, name));
          addBtn.addEventListener("keydown", (event) =>
            onAddKeydown(event, addBtn, name),
          );
          addBtn.addEventListener("blur", (event) => onAddBlur(event, addBtn));
          inline.appendChild(addBtn);
          keyTd.appendChild(inline);
          const hint = document.createElement("div");
          hint.className = "key-recording-hint";
          hint.hidden = true;
          keyTd.appendChild(hint);

          const overlapNote = buildOverlapNote(overlaps);
          if (overlapNote) keyTd.appendChild(overlapNote);

          row.appendChild(labelTd);
          row.appendChild(keyTd);
          tbody.appendChild(row);
        }
      },
    }),
  );
  refreshKeyLabels();
}

function refreshKeyLabels(): void {
  for (const el of document.querySelectorAll<HTMLElement>("code[data-key]")) {
    const keys = keysFor(el.dataset.key!);
    el.textContent =
      keys.length > 0 ? keys.map(displayCombo).join(", ") : "unbound";
  }
}

let keyByCommand = new Map<string, string[]>();
function rebuildKeyIndex(): void {
  keyByCommand = new Map();
  for (const [key, name] of Object.entries(settings.getKeymap())) {
    if (!keyByCommand.has(name)) keyByCommand.set(name, []);
    keyByCommand.get(name)!.push(key);
  }
  for (const keys of keyByCommand.values()) keys.sort();
}

function keysFor(commandName: string): string[] {
  return (keyByCommand.get(commandName) || []).slice();
}

function buildChip(
  name: string,
  cmd: CommandDef,
  combo: string,
  overlapped: boolean,
): HTMLSpanElement {
  const shown = displayCombo(combo);
  const chip = document.createElement("span");
  chip.className = overlapped ? "chip overlap" : "chip";
  chip.tabIndex = 0;
  chip.dataset.command = name;
  chip.dataset.binding = combo;
  chip.title = overlapped
    ? `${shown} → ${cmd.label}. Overlaps another binding — single key fires first. Backspace removes.`
    : `${shown} → ${cmd.label}. Backspace removes.`;
  chip.setAttribute(
    "aria-label",
    overlapped
      ? `${shown}, ${cmd.label}, overlaps another binding. Press Delete to remove.`
      : `${shown}, ${cmd.label}. Press Delete to remove.`,
  );
  const keySpan = document.createElement("span");
  keySpan.className = "chip-key";
  keySpan.textContent = shown;
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "chip-remove";
  rm.textContent = "×";
  rm.title = `Remove ${shown} from ${cmd.label}`;
  rm.setAttribute("aria-label", `Remove ${shown} from ${cmd.label}`);
  rm.addEventListener("click", (event) => {
    event.stopPropagation();
    clearBinding(name, combo);
  });
  chip.addEventListener("keydown", (event) => {
    if (clearingKeys.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      clearBinding(name, combo);
    }
  });
  chip.appendChild(keySpan);
  chip.appendChild(rm);
  return chip;
}

type OverlapInfo = { mine: Set<string>; others: string[] };

function rowOverlaps(name: string): OverlapInfo {
  const keymap = settings.getKeymap();
  const mine = new Set<string>();
  const others = new Set<string>();
  for (const combo of keysFor(name)) {
    for (const overlap of findOverlapConflicts(keymap, combo)) {
      mine.add(combo);
      others.add(overlap.key);
    }
  }
  return { mine, others: [...others].sort() };
}

function buildOverlapNote(overlaps: OverlapInfo | null): HTMLDivElement | null {
  if (!overlaps || overlaps.others.length === 0) return null;
  const warn = document.createElement("div");
  warn.className = "key-overlap-warn";
  warn.textContent = `Overlaps ${overlaps.others.map(displayCombo).join(", ")} — single key fires first`;
  return warn;
}

function recordingHintEl(
  button?: HTMLButtonElement | null,
): HTMLElement | null {
  const cell = button?.closest?.(".key-cell");
  return cell?.querySelector?.<HTMLElement>(".key-recording-hint") || null;
}

function isRecording(button: HTMLButtonElement): boolean {
  return activeRecording?.button === button;
}

/* Shared with the content dispatcher (content.js): while true, Jari yields
   every key to the recorder instead of running commands. */
function setRecordingFlag(on: boolean): void {
  try {
    (window as { __jariOptionsRecording?: unknown }).__jariOptionsRecording =
      Boolean(on);
  } catch {}
}

function startRecording(button: HTMLButtonElement, name: string): void {
  if (isRecording(button)) return;
  cancelRecordingSilent();
  dismissConflict(button);
  const hint = recordingHintEl(button);
  activeRecording = { button, name, waitingKeys: [] };
  setRecordingFlag(true);
  button.classList.add("recording");
  button.title = RECORDING_TITLE;
  if (hint) {
    hint.textContent = "Press a key… Esc cancels.";
    hint.hidden = false;
  }
}

function cancelRecordingSilent(): void {
  if (!activeRecording) return;
  const { button } = activeRecording;
  activeRecording = null;
  setRecordingFlag(false);
  if (!button.isConnected) return;
  dismissConflict(button);
  button.classList.remove("recording");
  const hint = recordingHintEl(button);
  if (hint) hint.hidden = true;
}

function cancelRecording(): void {
  if (!activeRecording) return;
  const { button } = activeRecording;
  cancelRecordingSilent();
  status("Cancelled — no changes");
  if (button.isConnected) button.focus?.();
}

function exitRecording(): void {
  if (!activeRecording) return;
  const { button } = activeRecording;
  activeRecording = null;
  setRecordingFlag(false);
  dismissConflict(button);
  if (!button.isConnected) return;
  button.classList.remove("recording");
  const hint = recordingHintEl(button);
  if (hint) hint.hidden = true;
}

function onAddBlur(event: FocusEvent, button: HTMLButtonElement): void {
  if (!isRecording(button)) return;
  const next = event.relatedTarget;
  const cell = button.closest(".key-cell");
  if (next && cell && cell.contains(next as Node)) return;
  cancelRecordingSilent();
}

function onAddKeydown(
  event: KeyboardEvent,
  button: HTMLButtonElement,
  name: string,
): void {
  if (!isRecording(button)) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
  if (modifierKeys.has(event.key)) return;

  if (event.key === "Escape") {
    if (activeRecording!.waitingKeys.length > 0) {
      activeRecording!.waitingKeys = [];
      const hint = recordingHintEl(button);
      if (hint) hint.textContent = "Press a key… Esc cancels.";
      status("Sequence cancelled — press a key, or Esc again to stop");
      return;
    }
    cancelRecording();
    return;
  }

  if (clearingKeys.has(event.key)) {
    if (activeRecording!.waitingKeys.length > 0) {
      activeRecording!.waitingKeys.pop();
      const keys = activeRecording!.waitingKeys.join("");
      const shown = displayCombo(keys);
      const hint = recordingHintEl(button);
      if (hint) {
        hint.textContent = keys
          ? `Next key for ${shown}… or Enter to save ${shown}`
          : "Press a key… Esc cancels.";
      }
      status(
        keys ? `Sequence ${shown} — press the next key, or Enter to save` : "Press a key",
      );
      return;
    }
    cancelRecordingSilent();
    status("Cancelled — no changes (remove bindings with the × on each key)");
    if (button.isConnected) button.focus?.();
    return;
  }

  if (event.key === "Enter" && activeRecording!.waitingKeys.length > 0) {
    const combo = activeRecording!.waitingKeys.join("");
    activeRecording!.waitingKeys = [];
    attemptCommit(combo, name, button);
    return;
  }

  const combo = canonicalKey(event);

  if (activeRecording!.waitingKeys.length > 0) {
    activeRecording!.waitingKeys.push(combo);
    const shown = displayCombo(activeRecording!.waitingKeys.join(""));
    const hint = recordingHintEl(button);
    if (hint) hint.textContent = `Next key for ${shown}… or Enter to save ${shown}`;
    status(`Sequence ${shown} — press the next key, or Enter to save`);
    return;
  }

  if (isBindablePrefixStarter(combo)) {
    activeRecording!.waitingKeys = [combo];
    const shown = displayCombo(combo);
    const hint = recordingHintEl(button);
    if (hint)
      hint.textContent = `Next key for ${shown}… or Enter to save ${shown} alone`;
    status(
      `Sequence ${shown} — press the next key, or Enter to save ${shown} alone`,
    );
    return;
  }

  if (isReservedCombo(combo)) {
    exitRecording();
    status("Digits 0-9 are reserved for the repeat count");
    if (button.isConnected) button.focus?.();
    return;
  }

  attemptCommit(combo, name, button);
}

function attemptCommit(
  combo: string,
  name: string,
  button: HTMLButtonElement,
): void {
  const shown = displayCombo(combo);
  if (isBrowserTrapped(combo)) {
    const hint = recordingHintEl(button);
    if (hint) {
      hint.textContent = `${shown} may be grabbed by the browser before Jari sees it.`;
      hint.hidden = false;
    }
  }
  const keymap = settings.getKeymap();
  if (keymap[combo] === name) {
    exitRecording();
    renderKeymap();
    status(`${shown} is already bound to ${commandLabel(name)}`);
    focusChipFor(name, combo);
    return;
  }
  const conflict = findBindingConflict(keymap, combo, name);
  if (!conflict) {
    commitCombo(combo, name, null);
    return;
  }
  showConflict(button, name, combo, conflict);
}

function persistKeymap(): Promise<boolean> {
  setSaveState("saving");
  return settings
    .update({ keymap: { ...settings.getKeymap() } })
    .then(() => {
      savedState();
      updateSummaries();
      return true;
    })
    .catch(() => {
      setSaveState("failed");
      status("Save failed");
      return false;
    });
}

async function commitCombo(
  combo: string,
  name: string,
  swapWith: string | null,
  doSwap = false,
): Promise<void> {
  const keymap = settings.getKeymap();
  const previous =
    keysForCommand(keymap, name).filter((k) => k !== combo)[0] || "";
  delete keymap[combo];
  keymap[combo] = name;
  const swapped = doSwap && swapWith && previous && previous !== combo;
  if (swapped) keymap[previous] = swapWith!;
  const overlaps = findOverlapConflicts(keymap, combo);
  const ok = await persistKeymap();
  exitRecording();
  renderKeymap();
  if (!ok) return;
  const overlapNote =
    overlaps.length > 0
      ? ` (note: overlaps ${overlaps.map((o) => displayCombo(o.key)).join(", ")} — single key fires first)`
      : "";
  const trappedNote = isBrowserTrapped(combo)
    ? ` (note: the browser may grab ${displayCombo(combo)} before Jari sees it)`
    : "";
  const notes = `${overlapNote}${trappedNote}`;
  const shown = displayCombo(combo);
  const shownPrevious = previous ? displayCombo(previous) : "";
  if (swapped) {
    status(
      `Swapped: ${shown} → ${commandLabel(name)}, ${shownPrevious} → ${commandLabel(swapWith!)}${notes}`,
    );
  } else if (swapWith) {
    status(
      `Saved ${shown} → ${commandLabel(name)} (moved ${commandLabel(swapWith!)} off ${shown})${notes}`,
    );
  } else {
    status(`Saved ${shown} → ${commandLabel(name)}${notes}`);
  }
  focusChipFor(name, combo);
}

async function clearBinding(
  name: string,
  specificKey: string,
): Promise<void> {
  cancelRecordingSilent();
  const keymap = settings.getKeymap();
  const removed: string[] = [];
  if (specificKey) {
    if (keymap[specificKey] === name) {
      delete keymap[specificKey];
      removed.push(specificKey);
    }
  } else {
    for (const [k, cmd] of Object.entries(keymap)) {
      if (cmd === name) {
        delete keymap[k];
        removed.push(k);
      }
    }
  }
  if (removed.length === 0) {
    renderKeymap();
    return;
  }
  const ok = await persistKeymap();
  renderKeymap();
  if (!ok) return;
  if (removed.length === 1) {
    const rest = keysFor(name).length;
    status(
      rest > 0
        ? `Removed ${removed[0]} from ${commandLabel(name)}`
        : `Removed ${removed[0]} — ${commandLabel(name)} now unbound`,
    );
  } else {
    status(`Cleared ${commandLabel(name)} — now unbound`);
  }
  focusAddFor(name);
}

function focusChipFor(name: string, combo: string): boolean {
  for (const row of tableEl.querySelectorAll<HTMLTableRowElement>(
    "tr[data-command]",
  )) {
    if (row.dataset.command !== name) continue;
    for (const chip of row.querySelectorAll<HTMLElement>(".chip")) {
      if (chip.dataset.binding === combo) {
        chip.focus?.();
        return true;
      }
    }
    const add = row.querySelector<HTMLButtonElement>(".key-add");
    if (add) add.focus?.();
    return false;
  }
  return false;
}

function focusAddFor(name: string): void {
  for (const row of tableEl.querySelectorAll<HTMLTableRowElement>(
    "tr[data-command]",
  )) {
    if (row.dataset.command !== name) continue;
    const add = row.querySelector<HTMLButtonElement>(".key-add");
    if (add) add.focus?.();
    return;
  }
}

function dismissConflict(anchor?: HTMLButtonElement | null): void {
  const cell = anchor?.closest?.(".key-cell");
  cell?.querySelector?.(".key-conflict")?.remove();
}

function showConflict(
  button: HTMLButtonElement,
  name: string,
  combo: string,
  conflictingCommand: string,
): void {
  const cell = button.closest(".key-cell");
  if (!cell) {
    commitCombo(combo, name, conflictingCommand);
    return;
  }
  dismissConflict(button);
  const shown = displayCombo(combo);
  const hint = recordingHintEl(button);
  if (hint) {
    hint.textContent = `${shown} is taken — choose below, or Esc to keep recording`;
    hint.hidden = false;
  }
  const box = document.createElement("div");
  box.className = "key-conflict";
  const msg = document.createElement("div");
  msg.className = "key-conflict-msg";
  msg.textContent = `${shown} is already ${commandLabel(conflictingCommand)}.`;
  const actions = document.createElement("div");
  actions.className = "key-conflict-actions";

  const reassign = document.createElement("button");
  reassign.type = "button";
  reassign.className = "primary";
  reassign.textContent = "Reassign";
  reassign.title = `Move ${shown} here from ${commandLabel(conflictingCommand)} (keeps your other bindings)`;
  reassign.addEventListener("click", () =>
    commitCombo(combo, name, conflictingCommand, false),
  );

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Keep both";
  cancel.title = "Cancel — keep the existing binding (Esc)";
  cancel.addEventListener("click", () => {
    dismissConflict(button);
    if (!isRecording(button)) return;
    const hint = recordingHintEl(button);
    if (hint) hint.textContent = "Press a key… Esc cancels.";
    button.focus?.();
    status("Kept the existing binding");
  });

  actions.appendChild(reassign);
  const previous =
    keysForCommand(settings.getKeymap(), name).filter((k) => k !== combo)[0] ||
    "";
  if (previous && previous !== combo) {
    const swap = document.createElement("button");
    swap.type = "button";
    swap.textContent = "Swap";
    swap.title = `Use ${shown} here and move ${commandLabel(conflictingCommand)} to ${displayCombo(previous)}`;
    swap.addEventListener("click", () =>
      commitCombo(combo, name, conflictingCommand, true),
    );
    actions.appendChild(swap);
  }
  actions.appendChild(cancel);
  box.appendChild(msg);
  box.appendChild(actions);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel.click();
    }
  });
  cell.appendChild(box);
  status(`${shown} is already bound — choose Reassign or Keep both`);
  cancel.focus();
}

type NumberGetterName =
  | "getScrollStep"
  | "getMaxResults"
  | "getTimeoutMs"
  | "getPassthroughMs"
  | "getClueDelayMs"
  | "getHintFontSize";

type NumberSettingKey =
  | "scrollStep"
  | "maxResults"
  | "timeoutMs"
  | "passthroughMs"
  | "clueDelayMs"
  | "hintFontSize";

function commitNumber(
  el: HTMLInputElement | HTMLSelectElement,
  errorId: string,
  {
    min,
    max,
    fallback,
    settingKey,
    label,
    unit,
  }: {
    min: number;
    max: number;
    fallback: NumberGetterName;
    settingKey: NumberSettingKey;
    label: string;
    unit?: string;
  },
): void {
  const raw = el.value.trim();
  const parsed = Number(raw);
  const invalid =
    raw === "" ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max;
  if (invalid) {
    el.value = settings[fallback]() as unknown as string;
    markInvalid(el, true);
    showFieldError(
      errorId,
      `Enter ${min}-${max}${unit ? ` ${unit}` : ""} (reset to ${el.value})`,
    );
    status(`${label}: reset to ${el.value}`);
    return;
  }
  markInvalid(el, false);
  clearFieldError(errorId);
  el.value = String(parsed);
  savePatch({ [settingKey]: parsed });
}

function commitHintChars(): void {
  const raw = hintCharsEl.value;
  const trimmed = raw.trim().toLowerCase();
  const deduped = [...new Set(trimmed.replace(/[^a-z0-9]/g, ""))].join("");
  if (deduped.length < 2) {
    hintCharsEl.value = settings.getHintChars();
    markInvalid(hintCharsEl, true);
    showFieldError(
      "error-hint-chars",
      "Need at least 2 unique letters or digits (reset to previous)",
    );
    status("Hint characters: need at least 2 unique letters or digits");
    updateHintMeta();
    return;
  }
  markInvalid(hintCharsEl, false);
  clearFieldError("error-hint-chars");
  const cleaned = deduped !== trimmed;
  hintCharsEl.value = deduped;
  updateHintMeta();
  savePatch({ hintChars: normalizeHintChars(deduped) }).then((ok) => {
    if (ok && cleaned) status(`Cleaned up hint characters: ${deduped}`);
  });
}

function isValidSelector(sel: string): boolean {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

function commitClickableSelector(): void {
  if (!clickableSelectorEl) return;
  const raw = clickableSelectorEl.value.trim();
  if (raw && !isValidSelector(raw)) {
    clickableSelectorEl.value = settings.getClickableSelector();
    markInvalid(clickableSelectorEl, true);
    showFieldError(
      "error-clickable-selector",
      "Not a valid CSS selector (reset to previous)",
    );
    status("Clickable selector: not valid CSS");
    return;
  }
  markInvalid(clickableSelectorEl, false);
  clearFieldError("error-clickable-selector");
  clickableSelectorEl.value = raw;
  savePatch({ clickableSelector: raw });
}

function collectSources(): string[] {
  const sources: string[] = [];
  if (sourceTabEl.checked) sources.push("tab");
  if (sourceHistoryEl.checked) sources.push("history");
  if (sourceBookmarkEl.checked) sources.push("bookmark");
  return sources;
}

let confirmCount = 0;

function confirmDialog(
  message: string,
  confirmLabel?: string,
): Promise<boolean> {
  const previousFocus = document.activeElement;
  setRecordingFlag(true);
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "jari-confirm-box";
    const msgId = `jari-confirm-msg-${++confirmCount}`;
    dialog.setAttribute("aria-labelledby", msgId);
    const msg = document.createElement("p");
    msg.className = "jari-confirm-msg";
    msg.id = msgId;
    msg.textContent = message;
    const actions = document.createElement("div");
    actions.className = "jari-confirm-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close("cancel"));
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary danger";
    ok.textContent = confirmLabel || "Confirm";
    ok.setAttribute("autofocus", "");
    ok.addEventListener("click", () => dialog.close("ok"));
    actions.appendChild(cancel);
    actions.appendChild(ok);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close("cancel");
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      setRecordingFlag(false);
      if (previousFocus?.isConnected)
        ui.safeFocus(previousFocus as HTMLElement);
      resolve(dialog.returnValue === "ok");
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

async function resetKeys(): Promise<void> {
  cancelRecordingSilent();
  if (
    !(await confirmDialog("Reset all keybindings to defaults?", "Reset keys"))
  )
    return;
  savePatch({ keymap: { ...keymapDefaults } }).then((ok) => {
    if (!ok) return;
    renderKeymap();
    status("Keybindings reset to defaults");
  });
}

async function reset(): Promise<void> {
  cancelRecordingSilent();
  if (
    !(await confirmDialog(
      "Reset all settings (including disabled sites) to defaults?",
      "Reset all",
    ))
  )
    return;
  setSaveState("saving");
  settings
    .update({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      keymap: { ...keymapDefaults },
      scrollStep: settingsDefaults.scrollStep,
      smoothScroll: settingsDefaults.smoothScroll,
      fuzzyMatching: settingsDefaults.fuzzyMatching,
      timeoutMs: settingsDefaults.timeoutMs,
      passthroughMs: settingsDefaults.passthroughMs,
      clueEnabled: settingsDefaults.clueEnabled,
      clueDelayMs: settingsDefaults.clueDelayMs,
      suggestionSources: settingsDefaults.suggestionSources.slice(),
      maxResults: settingsDefaults.maxResults,
      searchEngines: searchEngineDefaults(),
      defaultEngine: settingsDefaults.defaultEngine,
      pageNavTexts: pageNavTextDefaults(),
      copyFormat: settingsDefaults.copyFormat,
      hintChars: settingsDefaults.hintChars,
      clickableSelector: settingsDefaults.clickableSelector,
      hintTheme: settingsDefaults.hintTheme,
      hintFontSize: settingsDefaults.hintFontSize,
      disabledSites: [],
    })
    .then(() => load())
    .then(() => status("Reset everything to defaults"))
    .catch(() => {
      setSaveState("failed");
      status("Save failed");
    });
}

function renderDisabled(): void {
  disabledList.textContent = "";
  const sites = settings.getDisabledSites();
  if (sites.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No disabled sites.";
    disabledList.appendChild(li);
  } else {
    for (const site of sites) {
      const li = document.createElement("li");
      const siteSpan = document.createElement("span");
      siteSpan.textContent = site || "(blank page)";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Enable";
      btn.title = `Re-enable Jari on ${site}`;
      btn.setAttribute("aria-label", `Re-enable Jari on ${site}`);
      btn.addEventListener("click", async () => {
        const ok = await savePatch({
          disabledSites: sites.filter((s) => s !== site),
        });
        renderDisabled();
        if (ok) status(`Enabled: ${site}`);
      });
      li.appendChild(siteSpan);
      li.appendChild(btn);
      disabledList.appendChild(li);
    }
  }
  updateSummaries();
}

function showSiteError(message: string): void {
  if (!siteErrorEl) {
    status(message);
    return;
  }
  siteErrorEl.textContent = message;
  siteErrorEl.hidden = false;
  markInvalid(siteInputEl, true);
}

function clearSiteError(): void {
  if (!siteErrorEl) return;
  siteErrorEl.textContent = "";
  siteErrorEl.hidden = true;
  markInvalid(siteInputEl, false);
}

function updateAddButton(): void {
  if (!addSiteBtn || !siteInputEl) return;
  addSiteBtn.disabled = siteInputEl.value.trim() === "";
}

async function addDisabledSite(): Promise<void> {
  const raw = siteInputEl.value;
  const pattern = normalizeSitePattern(raw);
  if (!pattern) {
    showSiteError("Enter a hostname like example.com (or *.example.com)");
    siteInputEl.focus();
    return;
  }
  const sites = settings.getDisabledSites();
  if (sites.includes(pattern)) {
    showSiteError(`Already disabled: ${pattern}`);
    siteInputEl.focus();
    return;
  }
  clearSiteError();
  const ok = await savePatch({ disabledSites: [...sites, pattern] });
  siteInputEl.value = "";
  updateAddButton();
  renderDisabled();
  if (ok) status(`Disabled: ${pattern}`);
  siteInputEl.focus();
}

function status(message: string): void {
  statusEl!.textContent = message;
  clearTimeout(statusEl._timer ?? undefined);
  statusEl!._timer = setTimeout(() => {
    statusEl!.textContent = "";
  }, 2500);
}

resetBtn.addEventListener("click", reset);
resetKeysBtn?.addEventListener("click", resetKeys);
keymapFilterEl.addEventListener("input", renderKeymap);
keymapUnboundEl?.addEventListener("change", renderKeymap);
keymapFilterEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && keymapFilterEl.value) {
    keymapFilterEl.value = "";
    renderKeymap();
  }
});
addSiteBtn.addEventListener("click", addDisabledSite);
siteInputEl.addEventListener("input", () => {
  if (siteInputEl.value.trim() !== "") clearSiteError();
  updateAddButton();
});
siteInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addDisabledSite();
});

scrollStepEl.addEventListener("change", () =>
  commitNumber(scrollStepEl, "error-scroll-step", {
    min: 1,
    max: 500,
    fallback: "getScrollStep",
    settingKey: "scrollStep",
    label: "Scroll step",
    unit: "px",
  }),
);
maxResultsEl.addEventListener("change", () =>
  commitNumber(maxResultsEl, "error-max-results", {
    min: 5,
    max: 100,
    fallback: "getMaxResults",
    settingKey: "maxResults",
    label: "Max results",
  }),
);
timeoutEl.addEventListener("change", () =>
  commitNumber(timeoutEl, "error-timeout", {
    min: 0,
    max: 10000,
    fallback: "getTimeoutMs",
    settingKey: "timeoutMs",
    label: "Sequence timeout",
    unit: "ms",
  }),
);
passthroughEl.addEventListener("change", () =>
  commitNumber(passthroughEl, "error-passthrough-timeout", {
    min: 0,
    max: 30000,
    fallback: "getPassthroughMs",
    settingKey: "passthroughMs",
    label: "Passthrough duration",
    unit: "ms",
  }),
);
clueDelayEl.addEventListener("change", () =>
  commitNumber(clueDelayEl, "error-clue-delay", {
    min: 0,
    max: 5000,
    fallback: "getClueDelayMs",
    settingKey: "clueDelayMs",
    label: "Clue delay",
    unit: "ms",
  }),
);
smoothScrollEl.addEventListener("change", () =>
  savePatch({ smoothScroll: smoothScrollEl.checked }),
);
fuzzyMatchingEl.addEventListener("change", () =>
  savePatch({ fuzzyMatching: fuzzyMatchingEl.checked }),
);
clueEnabledEl.addEventListener("change", () =>
  savePatch({ clueEnabled: clueEnabledEl.checked }),
);
copyFormatEl.addEventListener("change", () =>
  savePatch({
    copyFormat: copyFormatEl.value as "plain" | "markdown",
  }).then(() => {
    copyFormatEl.value = settings.getCopyFormat();
  }),
);
for (const el of [sourceTabEl, sourceHistoryEl, sourceBookmarkEl]) {
  el.addEventListener("change", () =>
    savePatch({ suggestionSources: collectSources() }),
  );
}
initEngines();
initPagenav();
hintCharsEl.addEventListener("input", () => {
  clearFieldError("error-hint-chars");
  markInvalid(hintCharsEl, false);
  updateHintMeta();
});
hintCharsEl.addEventListener("change", commitHintChars);
hintThemeEl?.addEventListener("change", () =>
  savePatch({ hintTheme: hintThemeEl!.value as HintTheme }).then(() => {
    if (hintThemeEl) hintThemeEl.value = settings.getHintTheme();
  }),
);
hintFontSizeEl.addEventListener("change", () =>
  commitNumber(hintFontSizeEl, "error-hint-font-size", {
    min: 8,
    max: 20,
    fallback: "getHintFontSize",
    settingKey: "hintFontSize",
    label: "Hint font size",
    unit: "px",
  }),
);
clickableSelectorEl?.addEventListener("input", () => {
  clearFieldError("error-clickable-selector");
  markInvalid(clickableSelectorEl, false);
});
clickableSelectorEl?.addEventListener("change", commitClickableSelector);
for (const card of Object.values(cards)) {
  card?.addEventListener("toggle", persistOpenState);
}
load();

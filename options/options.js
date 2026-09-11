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
} from "../content/keymap.js";
import { normalizeSitePattern } from "../shared/url.js";
import {
  MAX_SEARCH_ENGINES,
  searchEngineDefaults,
  validateSearchEngine,
} from "../shared/search-engines.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { settings } from "../content/settings.js";
import { ui } from "../content/ui.js";

const tableEl = document.querySelector("#keymap-table");
const resetBtn = document.querySelector("#reset");
const resetKeysBtn = document.querySelector("#reset-keys");
const statusEl = document.querySelector("#status");
const saveStateEl = document.querySelector("#save-state");
const disabledList = document.querySelector("#disabled-list");
const scrollStepEl = document.querySelector("#scroll-step");
const smoothScrollEl = document.querySelector("#smooth-scroll");
const fuzzyMatchingEl = document.querySelector("#fuzzy-matching");
const timeoutEl = document.querySelector("#timeout");
const passthroughEl = document.querySelector("#passthrough-timeout");
const clueEnabledEl = document.querySelector("#clue-enabled");
const clueDelayEl = document.querySelector("#clue-delay");
const sourceTabEl = document.querySelector("#source-tab");
const sourceHistoryEl = document.querySelector("#source-history");
const sourceBookmarkEl = document.querySelector("#source-bookmark");
const maxResultsEl = document.querySelector("#max-results");
const defaultEngineEl = document.querySelector("#default-engine");
const engineListEl = document.querySelector("#engine-list");
const addEngineBtn = document.querySelector("#add-engine");
const resetEnginesBtn = document.querySelector("#reset-engines");
const copyFormatEl = document.querySelector("#copy-format");
const hintCharsEl = document.querySelector("#hint-chars");
const hintCharsMetaEl = document.querySelector("#hint-chars-meta");
const clickableSelectorEl = document.querySelector("#clickable-selector");
const hintThemeEl = document.querySelector("#hint-theme");
const hintFontSizeEl = document.querySelector("#hint-font-size");
const keymapFilterEl = document.querySelector("#keymap-filter");
const keymapUnboundEl = document.querySelector("#keymap-unbound");
const keymapCountEl = document.querySelector("#keymap-count");
const siteInputEl = document.querySelector("#disabled-site-input");
const addSiteBtn = document.querySelector("#add-disabled-site");
const siteErrorEl = document.querySelector("#site-error");
const summaries = {
  scrolling: document.querySelector("#summary-scrolling"),
  search: document.querySelector("#summary-search"),
  clipboard: document.querySelector("#summary-clipboard"),
  timing: document.querySelector("#summary-timing"),
  hints: document.querySelector("#summary-hints"),
  keybindings: document.querySelector("#summary-keybindings"),
  disabled: document.querySelector("#summary-disabled"),
};
const cards = {
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

function setSaveState(mode, message) {
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

function savedState() {
  if (settings.isPersistedLocally()) {
    setSaveState("warn", "Saved on this device only — browser sync is full");
  } else {
    setSaveState("saved");
  }
}

async function savePatch(patch) {
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

function showFieldError(id, message) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearFieldError(id) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function markInvalid(el, invalid) {
  if (!el) return;
  if (invalid) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

function uniqueHintCount(raw) {
  if (typeof raw !== "string") return 0;
  return new Set(raw.toLowerCase().replace(/[^a-z0-9]/g, "")).size;
}

function updateHintMeta() {
  if (!hintCharsMetaEl) return;
  const n = uniqueHintCount(hintCharsEl.value);
  hintCharsMetaEl.textContent =
    n === 0
      ? ""
      : `${n} unique letter${n === 1 ? "" : "s"}/digit${n === 1 ? "" : "s"}`;
}

function countUnbound() {
  rebuildKeyIndex();
  let unbound = 0;
  for (const name of Object.keys(COMMAND_CATALOG)) {
    if (!keyByCommand.has(name)) unbound++;
  }
  return unbound;
}

function updateSummaries() {
  if (summaries.scrolling) {
    summaries.scrolling.textContent = `${settings.getScrollStep()}px · smooth ${settings.isSmoothScroll() ? "on" : "off"}`;
  }
  if (summaries.search) {
    const n = settings.getSuggestionSources().length;
    const engines = settings.getSearchEngines();
    summaries.search.textContent =
      `fuzzy ${settings.isFuzzyMatching() ? "on" : "off"} · ${n} source${n === 1 ? "" : "s"} · max ${settings.getMaxResults()}` +
      ` · ${engines.length} engine${engines.length === 1 ? "" : "s"} · default ${settings.getDefaultEngine()}`;
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

function restoreOpenState() {
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

function persistOpenState() {
  const open = {};
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
let activeRecording = null;

function commandLabel(name) {
  return COMMAND_CATALOG[name]?.label || name;
}

async function load() {
  await settings.load();
  scrollStepEl.value = settings.getScrollStep();
  smoothScrollEl.checked = settings.isSmoothScroll();
  fuzzyMatchingEl.checked = settings.isFuzzyMatching();
  timeoutEl.value = settings.getTimeoutMs();
  passthroughEl.value = settings.getPassthroughMs();
  clueEnabledEl.checked = settings.isClueEnabled();
  clueDelayEl.value = settings.getClueDelayMs();
  const sources = settings.getSuggestionSources();
  sourceTabEl.checked = sources.includes("tab");
  sourceHistoryEl.checked = sources.includes("history");
  sourceBookmarkEl.checked = sources.includes("bookmark");
  maxResultsEl.value = settings.getMaxResults();
  renderEngines();
  copyFormatEl.value = settings.getCopyFormat();
  hintCharsEl.value = settings.getHintChars();
  if (clickableSelectorEl)
    clickableSelectorEl.value = settings.getClickableSelector();
  if (hintThemeEl) hintThemeEl.value = settings.getHintTheme();
  if (hintFontSizeEl) hintFontSizeEl.value = settings.getHintFontSize();
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

function matchesFilter(name, cmd, filter) {
  if (name.toLowerCase().includes(filter)) return true;
  if (cmd.label.toLowerCase().includes(filter)) return true;
  return keysFor(name).some((key) => key.toLowerCase().includes(filter));
}

function renderKeymap() {
  cancelRecordingSilent();
  tableEl.textContent = "";
  rebuildKeyIndex();
  const rawFilter = keymapFilterEl.value.trim();
  const filter = rawFilter.toLowerCase();
  const unboundOnly = Boolean(keymapUnboundEl?.checked);
  const total = Object.keys(COMMAND_CATALOG).length;
  const byCategory = new Map();
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
    byCategory.get(id).push([name, cmd]);
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

function refreshKeyLabels() {
  for (const el of document.querySelectorAll("code[data-key]")) {
    const keys = keysFor(el.dataset.key);
    el.textContent =
      keys.length > 0 ? keys.map(displayCombo).join(", ") : "unbound";
  }
}

let keyByCommand = new Map();
function rebuildKeyIndex() {
  keyByCommand = new Map();
  for (const [key, name] of Object.entries(settings.getKeymap())) {
    if (!keyByCommand.has(name)) keyByCommand.set(name, []);
    keyByCommand.get(name).push(key);
  }
  for (const keys of keyByCommand.values()) keys.sort();
}

function keysFor(commandName) {
  return (keyByCommand.get(commandName) || []).slice();
}

function buildChip(name, cmd, combo, overlapped) {
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

function rowOverlaps(name) {
  const keymap = settings.getKeymap();
  const mine = new Set();
  const others = new Set();
  for (const combo of keysFor(name)) {
    for (const overlap of findOverlapConflicts(keymap, combo)) {
      mine.add(combo);
      others.add(overlap.key);
    }
  }
  return { mine, others: [...others].sort() };
}

function buildOverlapNote(overlaps) {
  if (!overlaps || overlaps.others.length === 0) return null;
  const warn = document.createElement("div");
  warn.className = "key-overlap-warn";
  warn.textContent = `Overlaps ${overlaps.others.map(displayCombo).join(", ")} — single key fires first`;
  return warn;
}

function recordingHintEl(button) {
  const cell = button?.closest?.(".key-cell");
  return cell?.querySelector?.(".key-recording-hint") || null;
}

function isRecording(button) {
  return activeRecording?.button === button;
}

/* Shared with the content dispatcher (content.js): while true, Jari yields
   every key to the recorder instead of running commands. */
function setRecordingFlag(on) {
  try {
    window.__jariOptionsRecording = Boolean(on);
  } catch {}
}

function startRecording(button, name) {
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

function cancelRecordingSilent() {
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

function cancelRecording() {
  if (!activeRecording) return;
  const { button } = activeRecording;
  cancelRecordingSilent();
  status("Cancelled — no changes");
  if (button.isConnected) button.focus?.();
}

function exitRecording() {
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

function onAddBlur(event, button) {
  if (!isRecording(button)) return;
  const next = event.relatedTarget;
  const cell = button.closest(".key-cell");
  if (next && cell && cell.contains(next)) return;
  cancelRecordingSilent();
}

function onAddKeydown(event, button, name) {
  if (!isRecording(button)) return;
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
  if (modifierKeys.has(event.key)) return;

  if (event.key === "Escape") {
    if (activeRecording.waitingKeys.length > 0) {
      activeRecording.waitingKeys = [];
      const hint = recordingHintEl(button);
      if (hint) hint.textContent = "Press a key… Esc cancels.";
      status("Sequence cancelled — press a key, or Esc again to stop");
      return;
    }
    cancelRecording();
    return;
  }

  if (clearingKeys.has(event.key)) {
    if (activeRecording.waitingKeys.length > 0) {
      activeRecording.waitingKeys.pop();
      const keys = activeRecording.waitingKeys.join("");
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

  if (event.key === "Enter" && activeRecording.waitingKeys.length > 0) {
    const combo = activeRecording.waitingKeys.join("");
    activeRecording.waitingKeys = [];
    attemptCommit(combo, name, button);
    return;
  }

  const combo = canonicalKey(event);

  if (activeRecording.waitingKeys.length > 0) {
    activeRecording.waitingKeys.push(combo);
    const shown = displayCombo(activeRecording.waitingKeys.join(""));
    const hint = recordingHintEl(button);
    if (hint) hint.textContent = `Next key for ${shown}… or Enter to save ${shown}`;
    status(`Sequence ${shown} — press the next key, or Enter to save`);
    return;
  }

  if (isBindablePrefixStarter(combo)) {
    activeRecording.waitingKeys = [combo];
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

function attemptCommit(combo, name, button) {
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

function persistKeymap() {
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

async function commitCombo(combo, name, swapWith, doSwap = false) {
  const keymap = settings.getKeymap();
  const previous =
    keysForCommand(keymap, name).filter((k) => k !== combo)[0] || "";
  delete keymap[combo];
  keymap[combo] = name;
  const swapped = doSwap && swapWith && previous && previous !== combo;
  if (swapped) keymap[previous] = swapWith;
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
      `Swapped: ${shown} → ${commandLabel(name)}, ${shownPrevious} → ${commandLabel(swapWith)}${notes}`,
    );
  } else if (swapWith) {
    status(
      `Saved ${shown} → ${commandLabel(name)} (moved ${commandLabel(swapWith)} off ${shown})${notes}`,
    );
  } else {
    status(`Saved ${shown} → ${commandLabel(name)}${notes}`);
  }
  focusChipFor(name, combo);
}

async function clearBinding(name, specificKey) {
  cancelRecordingSilent();
  const keymap = settings.getKeymap();
  const removed = [];
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

function focusChipFor(name, combo) {
  for (const row of tableEl.querySelectorAll("tr[data-command]")) {
    if (row.dataset.command !== name) continue;
    for (const chip of row.querySelectorAll(".chip")) {
      if (chip.dataset.binding === combo) {
        chip.focus?.();
        return true;
      }
    }
    const add = row.querySelector(".key-add");
    if (add) add.focus?.();
    return false;
  }
  return false;
}

function focusAddFor(name) {
  for (const row of tableEl.querySelectorAll("tr[data-command]")) {
    if (row.dataset.command !== name) continue;
    const add = row.querySelector(".key-add");
    if (add) add.focus?.();
    return;
  }
}

function dismissConflict(anchor) {
  const cell = anchor?.closest?.(".key-cell");
  cell?.querySelector?.(".key-conflict")?.remove();
}

function showConflict(button, name, combo, conflictingCommand) {
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

function commitNumber(
  el,
  errorId,
  { min, max, fallback, settingKey, label, unit },
) {
  const raw = el.value.trim();
  const parsed = Number(raw);
  const invalid =
    raw === "" ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max;
  if (invalid) {
    el.value = settings[fallback]();
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

function commitHintChars() {
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

function isValidSelector(sel) {
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

function commitClickableSelector() {
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

function collectSources() {
  const sources = [];
  if (sourceTabEl.checked) sources.push("tab");
  if (sourceHistoryEl.checked) sources.push("history");
  if (sourceBookmarkEl.checked) sources.push("bookmark");
  return sources;
}

function engineRow(keyword, url) {
  const li = document.createElement("li");
  const kwEl = document.createElement("input");
  kwEl.type = "text";
  kwEl.className = "engine-keyword";
  kwEl.value = keyword;
  kwEl.placeholder = "kw";
  kwEl.setAttribute("aria-label", "Search engine keyword");
  kwEl.setAttribute("autocomplete", "off");
  kwEl.setAttribute("spellcheck", "false");
  kwEl.addEventListener("change", commitEngines);
  const urlEl = document.createElement("input");
  urlEl.type = "text";
  urlEl.className = "engine-url";
  urlEl.value = url;
  urlEl.placeholder = "https://example.com/search?q=%s";
  urlEl.setAttribute(
    "aria-label",
    "Search engine URL (%s is replaced by the query)",
  );
  urlEl.setAttribute("autocomplete", "off");
  urlEl.setAttribute("spellcheck", "false");
  urlEl.addEventListener("change", commitEngines);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${keyword || "engine"}`);
  remove.addEventListener("click", () => removeEngine(li));
  li.appendChild(kwEl);
  li.appendChild(urlEl);
  li.appendChild(remove);
  return li;
}

function readEngineRows() {
  const rows = [];
  if (!engineListEl) return rows;
  for (const li of engineListEl.children) {
    const kwEl = li.querySelector(".engine-keyword");
    const urlEl = li.querySelector(".engine-url");
    if (!kwEl || !urlEl) continue;
    rows.push({
      kwEl,
      urlEl,
      keyword: kwEl.value.trim(),
      url: urlEl.value.trim(),
    });
  }
  return rows;
}

function renderEngines() {
  if (!engineListEl) return;
  engineListEl.textContent = "";
  clearFieldError("error-engines");
  for (const engine of settings.getSearchEngines()) {
    engineListEl.appendChild(engineRow(engine.keyword, engine.url));
  }
  syncDefaultEngineOptions();
}

function syncDefaultEngineOptions() {
  if (!defaultEngineEl) return;
  const engines = settings.getSearchEngines();
  defaultEngineEl.textContent = "";
  for (const engine of engines) {
    const opt = document.createElement("option");
    opt.value = engine.keyword;
    opt.textContent = engine.keyword;
    defaultEngineEl.appendChild(opt);
  }
  defaultEngineEl.value = settings.getDefaultEngine();
}

function failEngines(message, badEls) {
  for (const el of badEls || []) markInvalid(el, true);
  showFieldError("error-engines", `${message} (not saved)`);
  status(`Search engines: ${message.charAt(0).toLowerCase() + message.slice(1)}`);
}

function commitEngines() {
  const rows = readEngineRows();
  for (const row of rows) {
    markInvalid(row.kwEl, false);
    markInvalid(row.urlEl, false);
  }
  clearFieldError("error-engines");
  // Rows missing a keyword or URL are still being filled in - leave them
  // alone until both fields have something.
  const complete = rows.filter((r) => r.keyword !== "" && r.url !== "");
  const seen = new Set();
  const list = [];
  for (const row of complete) {
    const problem = validateSearchEngine({
      keyword: row.keyword,
      url: row.url,
    });
    if (problem) {
      failEngines(problem, [row.kwEl, row.urlEl]);
      return;
    }
    const keyword = row.keyword.toLowerCase();
    if (seen.has(keyword)) {
      failEngines(`Duplicate keyword "${keyword}"`, [row.kwEl]);
      return;
    }
    seen.add(keyword);
    list.push({ keyword, url: row.url });
  }
  if (list.length === 0) {
    if (rows.length === 0) {
      failEngines("At least one search engine is required", []);
      renderEngines();
    }
    return;
  }
  if (list.length > MAX_SEARCH_ENGINES) {
    failEngines(`At most ${MAX_SEARCH_ENGINES} search engines`, []);
    return;
  }
  const current = settings.getDefaultEngine();
  const def = list.some((e) => e.keyword === current)
    ? current
    : list[0].keyword;
  savePatch({ searchEngines: list, defaultEngine: def }).then((ok) => {
    if (!ok) return;
    for (let i = 0; i < list.length; i++) {
      const row = complete[i];
      if (!row) break;
      row.kwEl.value = list[i].keyword;
      row.urlEl.value = list[i].url;
    }
    syncDefaultEngineOptions();
  });
}

function removeEngine(li) {
  const rows = readEngineRows();
  if (rows.length <= 1) {
    failEngines("At least one search engine is required", []);
    return;
  }
  const remaining = rows.filter((row) => {
    try {
      return row.kwEl.closest("li") !== li;
    } catch {
      return true;
    }
  });
  if (!remaining.some((r) => r.keyword !== "" && r.url !== "")) {
    failEngines("At least one search engine is required", []);
    return;
  }
  li.remove();
  commitEngines();
}

function addEngine() {
  if (!engineListEl) return;
  clearFieldError("error-engines");
  if (engineListEl.children.length >= MAX_SEARCH_ENGINES) {
    showFieldError(
      "error-engines",
      `At most ${MAX_SEARCH_ENGINES} search engines (not saved)`,
    );
    return;
  }
  const li = engineRow("", "");
  engineListEl.appendChild(li);
  li.querySelector(".engine-keyword").focus();
}

function resetEngines() {
  savePatch({
    searchEngines: searchEngineDefaults(),
    defaultEngine: settingsDefaults.defaultEngine,
  }).then((ok) => {
    if (ok) {
      renderEngines();
      status("Search engines restored to defaults");
    }
  });
}

let confirmCount = 0;

function confirmDialog(message, confirmLabel) {
  const previousFocus = document.activeElement;
  setRecordingFlag(true);
  return new Promise((resolve) => {
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
      if (previousFocus?.isConnected) ui.safeFocus(previousFocus);
      resolve(dialog.returnValue === "ok");
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

async function resetKeys() {
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

async function reset() {
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

function renderDisabled() {
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

function showSiteError(message) {
  if (!siteErrorEl) {
    status(message);
    return;
  }
  siteErrorEl.textContent = message;
  siteErrorEl.hidden = false;
  markInvalid(siteInputEl, true);
}

function clearSiteError() {
  if (!siteErrorEl) return;
  siteErrorEl.textContent = "";
  siteErrorEl.hidden = true;
  markInvalid(siteInputEl, false);
}

function updateAddButton() {
  if (!addSiteBtn || !siteInputEl) return;
  addSiteBtn.disabled = siteInputEl.value.trim() === "";
}

async function addDisabledSite() {
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

function status(message) {
  statusEl.textContent = message;
  clearTimeout(statusEl._timer);
  statusEl._timer = setTimeout(() => {
    statusEl.textContent = "";
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
  savePatch({ copyFormat: copyFormatEl.value }).then(() => {
    copyFormatEl.value = settings.getCopyFormat();
  }),
);
for (const el of [sourceTabEl, sourceHistoryEl, sourceBookmarkEl]) {
  el.addEventListener("change", () =>
    savePatch({ suggestionSources: collectSources() }),
  );
}
defaultEngineEl?.addEventListener("change", () =>
  savePatch({ defaultEngine: defaultEngineEl.value }).then(() => {
    syncDefaultEngineOptions();
  }),
);
addEngineBtn?.addEventListener("click", addEngine);
resetEnginesBtn?.addEventListener("click", resetEngines);
hintCharsEl.addEventListener("input", () => {
  clearFieldError("error-hint-chars");
  markInvalid(hintCharsEl, false);
  updateHintMeta();
});
hintCharsEl.addEventListener("change", commitHintChars);
hintThemeEl?.addEventListener("change", () =>
  savePatch({ hintTheme: hintThemeEl.value }).then(() => {
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

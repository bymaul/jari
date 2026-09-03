import {
  canonicalKey,
  clearingKeys,
  findBindingConflict,
  isReservedCombo,
  keymapDefaults,
  keysForCommand,
  modifierKeys,
  normalizeHintChars,
  prefixKeys,
  settingsDefaults,
} from "../content/keymap.js";
import { normalizeHost } from "../shared/url.js";
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
const copyFormatEl = document.querySelector("#copy-format");
const hintCharsEl = document.querySelector("#hint-chars");
const hintCharsMetaEl = document.querySelector("#hint-chars-meta");
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

const IDLE_TITLE = "Click or press Enter, then press a key to rebind.";
const RECORDING_TITLE = "Press a key to bind. Esc cancels, Backspace clears.";

const OPEN_KEY = "jari.options.open";

function setSaveState(mode, message) {
  if (!saveStateEl) return;
  saveStateEl.classList.remove("saving", "failed");
  if (mode === "saving") {
    saveStateEl.classList.add("saving");
    saveStateEl.textContent = message || "Saving...";
  } else if (mode === "failed") {
    saveStateEl.classList.add("failed");
    saveStateEl.textContent = message || "Save failed — will retry on next change";
  } else {
    saveStateEl.textContent = message || "All changes saved";
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
  setSaveState("saved");
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
  hintCharsMetaEl.textContent = n === 0 ? "" : `${n} unique letter${n === 1 ? "" : "s"}/digit${n === 1 ? "" : "s"}`;
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
    summaries.search.textContent = `fuzzy ${settings.isFuzzyMatching() ? "on" : "off"} · ${n} source${n === 1 ? "" : "s"}`;
  }
  if (summaries.clipboard) {
    summaries.clipboard.textContent = settings.getCopyFormat() === "markdown" ? "Markdown link" : "Plain (title + URL)";
  }
  if (summaries.timing) {
    const clue = settings.isClueEnabled() ? `${settings.getClueDelayMs()}ms` : "off";
    summaries.timing.textContent = `timeout ${settings.getTimeoutMs()}ms · passthrough ${settings.getPassthroughMs()}ms · clue ${clue}`;
  }
  if (summaries.hints) {
    const chars = settings.getHintChars();
    summaries.hints.textContent = `${chars} (${chars.length})`;
  }
  if (summaries.keybindings) {
    const total = Object.keys(COMMAND_CATALOG).length;
    const unbound = countUnbound();
    summaries.keybindings.textContent = unbound === 0 ? `${total} commands · all bound` : `${total - unbound}/${total} bound · ${unbound} unbound`;
  }
  if (summaries.disabled) {
    const n = settings.getDisabledSites().length;
    summaries.disabled.textContent = n === 0 ? "enabled everywhere" : `${n} site${n === 1 ? "" : "s"}`;
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
  copyFormatEl.value = settings.getCopyFormat();
  hintCharsEl.value = settings.getHintChars();
  for (const el of [scrollStepEl, timeoutEl, passthroughEl, clueDelayEl, hintCharsEl, siteInputEl]) {
    markInvalid(el, false);
  }
  for (const id of ["error-scroll-step", "error-timeout", "error-passthrough-timeout", "error-clue-delay", "error-hint-chars"]) {
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
  setSaveState("saved");
  updateAddButton();
}

function matchesFilter(name, cmd, filter) {
  return (
    name.toLowerCase().includes(filter) ||
    cmd.label.toLowerCase().includes(filter) ||
    keyFor(name).toLowerCase().includes(filter)
  );
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
    const bound = Boolean(keyFor(name));
    if (!bound) unboundTotal++;
    if (unboundOnly && bound) continue;
    const id = cmd.category || "other";
    if (filter && !matchesFilter(name, cmd, filter)) continue;
    shown++;
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push([name, cmd]);
  }

  if (keymapCountEl) {
    const base = filter || unboundOnly ? `${shown} of ${total} commands` : `${total} commands`;
    keymapCountEl.textContent = unboundTotal === 0 ? base : `${base} · ${unboundTotal} unbound`;
  }

  if (byCategory.size === 0) {
    const empty = document.createElement("div");
    empty.className = "jari-keymap-filter-empty";
    const msg = document.createElement("span");
    msg.textContent = unboundOnly && !filter
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
          const fieldRow = document.createElement("div");
          fieldRow.className = "key-cell-row";
          const input = document.createElement("input");
          input.type = "text";
          input.readOnly = true;
          input.className = "key-input";
          input.dataset.command = name;
          input.value = keyFor(name);
          input.placeholder = "unbound";
          input.dataset.bound = keyFor(name) ? "true" : "false";
          input.title = IDLE_TITLE;
          input.setAttribute(
            "aria-label",
            `${cmd.label} shortcut. ${IDLE_TITLE}`,
          );
          const clearBtn = document.createElement("button");
          clearBtn.type = "button";
          clearBtn.className = "key-clear";
          clearBtn.textContent = "×";
          clearBtn.title = `Clear ${cmd.label} binding`;
          clearBtn.setAttribute("aria-label", `Clear ${cmd.label} binding`);
          clearBtn.disabled = !keyFor(name);
          clearBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            clearBinding(name);
          });

          input.addEventListener("click", () => startRecording(input, name));
          input.addEventListener("keydown", (event) =>
            onKeyInputKeydown(event, input, name),
          );
          input.addEventListener("blur", (event) => onKeyInputBlur(event, input));
          input.addEventListener("focus", () => {
            if (!isRecording(input)) input.select?.();
          });

          keyTd.appendChild(fieldRow);
          fieldRow.appendChild(input);
          fieldRow.appendChild(clearBtn);
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
  for (const el of document.querySelectorAll("[data-key]")) {
    el.textContent = keyFor(el.dataset.key) || "unbound";
  }
}

let keyByCommand = new Map();
function rebuildKeyIndex() {
  keyByCommand = new Map();
  for (const [key, name] of Object.entries(settings.getKeymap())) {
    if (!keyByCommand.has(name)) keyByCommand.set(name, key);
  }
}

function keyFor(commandName) {
  return keyByCommand.get(commandName) || "";
}

function isRecording(input) {
  return activeRecording?.input === input;
}

function startRecording(input, name) {
  if (isRecording(input)) return;
  cancelRecordingSilent();
  dismissConflict(input);
  activeRecording = { input, name, previous: input.value, waitingPrefix: null };
  input.value = "press a key...";
  input.classList.add("recording");
  input.title = RECORDING_TITLE;
  input.removeAttribute("placeholder");
}

function cancelRecordingSilent() {
  if (!activeRecording) return;
  const { input, previous } = activeRecording;
  activeRecording = null;
  if (!input.isConnected) return;
  dismissConflict(input);
  input.classList.remove("recording");
  input.value = previous;
  input.placeholder = "unbound";
  input.title = IDLE_TITLE;
}

function cancelRecording() {
  if (!activeRecording) return;
  cancelRecordingSilent();
  status("Cancelled — no changes");
}

function exitRecording() {
  if (!activeRecording) return;
  const { input } = activeRecording;
  activeRecording = null;
  dismissConflict(input);
  input.classList.remove("recording");
  input.placeholder = "unbound";
  input.title = IDLE_TITLE;
}

function onKeyInputBlur(event, input) {
  if (!isRecording(input)) return;
  const next = event.relatedTarget;
  const cell = input.closest(".key-cell");
  if (next && cell && cell.contains(next)) return;
  cancelRecordingSilent();
}

function onKeyInputKeydown(event, input, name) {
  if (!isRecording(input)) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      startRecording(input, name);
    }
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
  if (modifierKeys.has(event.key)) return;

  if (event.key === "Escape") {
    if (activeRecording.waitingPrefix) {
      activeRecording.waitingPrefix = null;
      input.value = "press a key...";
      status("Prefix cancelled — press a key, or Esc again to stop");
      return;
    }
    cancelRecording();
    return;
  }

  if (clearingKeys.has(event.key)) {
    if (activeRecording.waitingPrefix) {
      activeRecording.waitingPrefix = null;
      input.value = "press a key...";
      status("Prefix cancelled — press a key");
      return;
    }
    clearBinding(name);
    return;
  }

  const combo = canonicalKey(event);

  if (activeRecording.waitingPrefix) {
    const full = activeRecording.waitingPrefix + combo;
    activeRecording.waitingPrefix = null;
    attemptCommit(full, name, input);
    return;
  }

  if (prefixKeys.has(combo)) {
    activeRecording.waitingPrefix = combo;
    input.value = `${combo} — press the next key...`;
    status("Prefix key — press the next key (Esc cancels)");
    return;
  }

  if (isReservedCombo(combo)) {
    exitRecording();
    input.value = keyFor(name);
    status("Digits 0-9 are reserved for the repeat count");
    return;
  }

  attemptCommit(combo, name, input);
}

function attemptCommit(combo, name, input) {
  const conflict = findBindingConflict(settings.getKeymap(), combo, name);
  if (!conflict) {
    commitCombo(combo, name, null);
    return;
  }
  showConflict(input, name, combo, conflict);
}

function persistKeymap() {
  setSaveState("saving");
  return settings
    .update({ keymap: { ...settings.getKeymap() } })
    .then(() => {
      setSaveState("saved");
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
  const previous = keysForCommand(keymap, name)[0] || "";
  for (const [k, cmd] of Object.entries(keymap)) {
    if (k === combo || cmd === name || (swapWith && cmd === swapWith)) {
      delete keymap[k];
    }
  }
  keymap[combo] = name;
  const swapped = doSwap && swapWith && previous && previous !== combo;
  if (swapped) keymap[previous] = swapWith;
  const ok = await persistKeymap();
  exitRecording();
  updateAllInputs();
  if (!ok) return;
  if (swapped) {
    status(`Swapped: ${combo} → ${commandLabel(name)}, ${previous} → ${commandLabel(swapWith)}`);
  } else if (swapWith) {
    status(`Saved ${combo} → ${commandLabel(name)} (unbound ${commandLabel(swapWith)})`);
  } else {
    status(`Saved ${combo} → ${commandLabel(name)}`);
  }
  focusInputFor(name);
}

async function clearBinding(name) {
  cancelRecordingSilent();
  const keymap = settings.getKeymap();
  let had = false;
  for (const [k, cmd] of Object.entries(keymap)) {
    if (cmd === name) {
      delete keymap[k];
      had = true;
    }
  }
  if (!had) {
    updateAllInputs();
    return;
  }
  const ok = await persistKeymap();
  updateAllInputs();
  if (ok) status(`Cleared ${commandLabel(name)} — now unbound`);
  focusInputFor(name);
}

function updateAllInputs() {
  rebuildKeyIndex();
  for (const row of tableEl.querySelectorAll("tr[data-command]")) {
    const name = row.dataset.command;
    const input = row.querySelector(".key-input");
    const clearBtn = row.querySelector(".key-clear");
    if (!input) continue;
    if (isRecording(input)) continue;
    input.value = keyFor(name);
    input.dataset.bound = keyFor(name) ? "true" : "false";
    if (clearBtn) clearBtn.disabled = !keyFor(name);
  }
  refreshKeyLabels();
  updateSummaries();
}

function focusInputFor(name) {
  const input = tableEl.querySelector(`.key-input[data-command="${name}"]`);
  if (input) input.focus();
}

function dismissConflict(input) {
  const cell = input?.closest?.(".key-cell");
  cell?.querySelector?.(".key-conflict")?.remove();
}

function showConflict(input, name, combo, conflictingCommand) {
  const cell = input.closest(".key-cell");
  if (!cell) {
    commitCombo(combo, name, conflictingCommand);
    return;
  }
  dismissConflict(input);
  input.value = `${combo} — taken`;
  const box = document.createElement("div");
  box.className = "key-conflict";
  const msg = document.createElement("div");
  msg.className = "key-conflict-msg";
  msg.textContent = `${combo} is already ${commandLabel(conflictingCommand)}.`;
  const actions = document.createElement("div");
  actions.className = "key-conflict-actions";

  const reassign = document.createElement("button");
  reassign.type = "button";
  reassign.className = "primary";
  reassign.textContent = "Reassign";
  reassign.title = `Unbind ${commandLabel(conflictingCommand)} and use ${combo} here`;
  reassign.addEventListener("click", () => commitCombo(combo, name, conflictingCommand, false));

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Keep both";
  cancel.title = "Cancel — keep the existing binding (Esc)";
  cancel.addEventListener("click", () => {
    dismissConflict(input);
    if (!isRecording(input)) return;
    input.value = "press a key...";
    input.focus();
    status("Kept the existing binding");
  });

  actions.appendChild(reassign);
  const previous = keysForCommand(settings.getKeymap(), name)[0] || "";
  if (previous && previous !== combo) {
    const swap = document.createElement("button");
    swap.type = "button";
    swap.textContent = "Swap";
    swap.title = `Use ${combo} here and move ${commandLabel(conflictingCommand)} to ${previous}`;
    swap.addEventListener("click", () => commitCombo(combo, name, conflictingCommand, true));
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
  status(`${combo} is already bound — choose Reassign or Keep both`);
  cancel.focus();
}

function commitNumber(el, errorId, { min, max, fallback, settingKey, label, unit }) {
  const raw = el.value.trim();
  const parsed = Number(raw);
  const invalid = raw === "" || !Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max;
  if (invalid) {
    el.value = settings[fallback]();
    markInvalid(el, true);
    showFieldError(errorId, `Enter ${min}-${max}${unit ? ` ${unit}` : ""} (reset to ${el.value})`);
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
    showFieldError("error-hint-chars", "Need at least 2 unique letters or digits (reset to previous)");
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

function collectSources() {
  const sources = [];
  if (sourceTabEl.checked) sources.push("tab");
  if (sourceHistoryEl.checked) sources.push("history");
  if (sourceBookmarkEl.checked) sources.push("bookmark");
  return sources;
}

function resetKeys() {
  cancelRecordingSilent();
  if (!window.confirm?.("Reset all keybindings to defaults?")) return;
  savePatch({ keymap: { ...keymapDefaults } }).then((ok) => {
    if (!ok) return;
    renderKeymap();
    status("Keybindings reset to defaults");
  });
}

function reset() {
  cancelRecordingSilent();
  if (!window.confirm?.("Reset all settings (including disabled sites) to defaults?")) return;
  setSaveState("saving");
  settings
    .update({
      keymap: { ...keymapDefaults },
      scrollStep: settingsDefaults.scrollStep,
      smoothScroll: settingsDefaults.smoothScroll,
      fuzzyMatching: settingsDefaults.fuzzyMatching,
      timeoutMs: settingsDefaults.timeoutMs,
      passthroughMs: settingsDefaults.passthroughMs,
      clueEnabled: settingsDefaults.clueEnabled,
      clueDelayMs: settingsDefaults.clueDelayMs,
      suggestionSources: settingsDefaults.suggestionSources.slice(),
      copyFormat: settingsDefaults.copyFormat,
      hintChars: settingsDefaults.hintChars,
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
      siteSpan.textContent = site;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Enable";
      btn.title = `Re-enable Jari on ${site}`;
      btn.setAttribute("aria-label", `Re-enable Jari on ${site}`);
      btn.addEventListener("click", async () => {
        const ok = await savePatch({ disabledSites: sites.filter((s) => s !== site) });
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
  const host = normalizeHost(raw);
  if (!host) {
    showSiteError("Enter a hostname like example.com");
    siteInputEl.focus();
    return;
  }
  const sites = settings.getDisabledSites();
  if (sites.includes(host)) {
    showSiteError(`Already disabled: ${host}`);
    siteInputEl.focus();
    return;
  }
  clearSiteError();
  const ok = await savePatch({ disabledSites: [...sites, host] });
  siteInputEl.value = "";
  updateAddButton();
  renderDisabled();
  if (ok) status(`Disabled: ${host}`);
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
smoothScrollEl.addEventListener("change", () => savePatch({ smoothScroll: smoothScrollEl.checked }));
fuzzyMatchingEl.addEventListener("change", () => savePatch({ fuzzyMatching: fuzzyMatchingEl.checked }));
clueEnabledEl.addEventListener("change", () => savePatch({ clueEnabled: clueEnabledEl.checked }));
copyFormatEl.addEventListener("change", () => savePatch({ copyFormat: copyFormatEl.value }));
for (const el of [sourceTabEl, sourceHistoryEl, sourceBookmarkEl]) {
  el.addEventListener("change", () => savePatch({ suggestionSources: collectSources() }));
}
hintCharsEl.addEventListener("input", () => {
  clearFieldError("error-hint-chars");
  markInvalid(hintCharsEl, false);
  updateHintMeta();
});
hintCharsEl.addEventListener("change", commitHintChars);
for (const card of Object.values(cards)) {
  card?.addEventListener("toggle", persistOpenState);
}
load();

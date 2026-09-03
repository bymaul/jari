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
const saveBtn = document.querySelector("#save");
const resetBtn = document.querySelector("#reset");
const statusEl = document.querySelector("#status");
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
const keymapFilterEl = document.querySelector("#keymap-filter");
const keymapCountEl = document.querySelector("#keymap-count");
const siteInputEl = document.querySelector("#disabled-site-input");
const addSiteBtn = document.querySelector("#add-disabled-site");

const IDLE_TITLE = "Click or press Enter, then press a key to rebind.";
const RECORDING_TITLE = "Press a key to bind. Esc cancels, Backspace clears.";

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
  renderKeymap();
  renderDisabled();
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
  const total = Object.keys(COMMAND_CATALOG).length;
  const byCategory = new Map();
  let shown = 0;
  for (const [name, cmd] of Object.entries(COMMAND_CATALOG)) {
    const id = cmd.category || "other";
    if (filter && !matchesFilter(name, cmd, filter)) continue;
    shown++;
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push([name, cmd]);
  }

  if (keymapCountEl) {
    keymapCountEl.textContent = filter
      ? `${shown} of ${total} commands`
      : `${total} commands`;
  }

  if (byCategory.size === 0) {
    const empty = document.createElement("div");
    empty.className = "jari-keymap-filter-empty";
    const msg = document.createElement("span");
    msg.textContent = `No commands match "${rawFilter}". `;
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear filter";
    clear.addEventListener("click", () => {
      keymapFilterEl.value = "";
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
  return settings
    .update({ keymap: { ...settings.getKeymap() } })
    .then(() => true)
    .catch(() => {
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
    if (clearBtn) clearBtn.disabled = !keyFor(name);
  }
  refreshKeyLabels();
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

function readPositiveInt(el, fallback) {
  const raw = parseInt(el.value, 10);
  el.value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return parseInt(el.value, 10);
}

function readClueDelay(el, fallback) {
  const raw = parseInt(el.value, 10);
  el.value = Number.isFinite(raw) && raw >= 0 ? Math.min(5000, raw) : fallback;
  return parseInt(el.value, 10);
}

function readTimeoutMs(el, fallback, max) {
  const raw = parseInt(el.value, 10);
  el.value = Number.isFinite(raw) && raw >= 0 ? Math.min(max, raw) : fallback;
  return parseInt(el.value, 10);
}

function collectBehaviorSettings() {
  const sources = [];
  if (sourceTabEl.checked) sources.push("tab");
  if (sourceHistoryEl.checked) sources.push("history");
  if (sourceBookmarkEl.checked) sources.push("bookmark");
  hintCharsEl.value = normalizeHintChars(hintCharsEl.value);
  return {
    scrollStep: readPositiveInt(scrollStepEl, settingsDefaults.scrollStep),
    smoothScroll: smoothScrollEl.checked,
    fuzzyMatching: fuzzyMatchingEl.checked,
    timeoutMs: readTimeoutMs(timeoutEl, settingsDefaults.timeoutMs, 10000),
    passthroughMs: readTimeoutMs(passthroughEl, settingsDefaults.passthroughMs, 30000),
    clueEnabled: clueEnabledEl.checked,
    clueDelayMs: readClueDelay(clueDelayEl, settingsDefaults.clueDelayMs),
    suggestionSources: sources,
    copyFormat: copyFormatEl.value,
    hintChars: hintCharsEl.value,
  };
}

function save() {
  const patch = collectBehaviorSettings();

  patch.keymap = { ...settings.getKeymap() };
  patch.disabledSites = settings.getDisabledSites();
  settings
    .update(patch)
    .then(() => status("Saved"))
    .catch(() => status("Save failed"));
}

function reset() {
  cancelRecordingSilent();
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
    })
    .then(() => load())
    .then(() => status("Reset to defaults"))
    .catch(() => status("Save failed"));
}

function renderDisabled() {
  disabledList.textContent = "";
  const sites = settings.getDisabledSites();
  if (sites.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No disabled sites.";
    disabledList.appendChild(li);
    return;
  }
  for (const site of sites) {
    const li = document.createElement("li");
    const siteSpan = document.createElement("span");
    siteSpan.textContent = site;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Enable";
    btn.addEventListener("click", () => {
      settings.update({ disabledSites: sites.filter((s) => s !== site) });
      renderDisabled();
    });
    li.appendChild(siteSpan);
    li.appendChild(btn);
    disabledList.appendChild(li);
  }
}

function addDisabledSite() {
  const host = normalizeHost(siteInputEl.value);
  if (!host) {
    status("Enter a hostname like example.com");
    siteInputEl.focus();
    return;
  }
  const sites = settings.getDisabledSites();
  if (sites.includes(host)) {
    status("Already disabled: " + host);
  } else {
    settings.update({ disabledSites: [...sites, host] });
    status("Disabled: " + host);
  }
  siteInputEl.value = "";
  renderDisabled();
}

function status(message) {
  statusEl.textContent = message;
  clearTimeout(statusEl._timer);
  statusEl._timer = setTimeout(() => {
    statusEl.textContent = "";
  }, 2500);
}

saveBtn.addEventListener("click", save);
resetBtn.addEventListener("click", reset);
keymapFilterEl.addEventListener("input", renderKeymap);
keymapFilterEl.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && keymapFilterEl.value) {
    keymapFilterEl.value = "";
    renderKeymap();
  }
});
addSiteBtn.addEventListener("click", addDisabledSite);
siteInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addDisabledSite();
});
load();

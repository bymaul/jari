import {
  balanceCategories,
  canonicalKey,
  keymapDefaults,
  modifierKeys,
  prefixKeys,
  settingsDefaults,
} from "../content/keymap.js";
import { normalizeHost } from "../shared/url.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { settings } from "../content/settings.js";
import { ui } from "../content/ui.js";

const SETTINGS_DEFAULTS = settingsDefaults;
const COMMANDS = COMMAND_CATALOG;

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
const sourceTabEl = document.querySelector("#source-tab");
const sourceHistoryEl = document.querySelector("#source-history");
const sourceBookmarkEl = document.querySelector("#source-bookmark");
const copyFormatEl = document.querySelector("#copy-format");
const hintCharsEl = document.querySelector("#hint-chars");
const keymapFilterEl = document.querySelector("#keymap-filter");
const siteInputEl = document.querySelector("#disabled-site-input");
const addSiteBtn = document.querySelector("#add-disabled-site");

const RESERVED_KEYS = /^[0-9]$/;

async function load() {
  await settings.load();
  scrollStepEl.value = settings.getScrollStep();
  smoothScrollEl.checked = settings.isSmoothScroll();
  fuzzyMatchingEl.checked = settings.isFuzzyMatching();
  timeoutEl.value = settings.getTimeoutMs();
  passthroughEl.value = settings.getPassthroughMs();
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
  tableEl.textContent = "";
  const filter = keymapFilterEl.value.trim().toLowerCase();
  const byCategory = new Map();
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    const id = cmd.category || "other";
    if (filter && !matchesFilter(name, cmd, filter)) continue;
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push([name, cmd]);
  }

  if (byCategory.size === 0) {
    const empty = document.createElement("div");
    empty.className = "jari-keymap-filter-empty";
    empty.textContent = `No commands match "${keymapFilterEl.value.trim()}".`;
    tableEl.appendChild(empty);
    return;
  }

  const columns = balanceCategories(byCategory, 3);

  const grid = document.createElement("div");
  grid.className = "jari-keymap-columns";
  for (const cats of columns) {
    const col = document.createElement("div");
    col.className = "jari-keymap-column";
    for (const cat of cats) {
      col.appendChild(
        ui.buildCategoryTable(cat, "cat-header", (tbody) => {
          for (const [name, cmd] of byCategory.get(cat.id)) {
            const row = document.createElement("tr");
            row.dataset.command = name;

            const labelTd = document.createElement("td");
            labelTd.textContent = cmd.label;

            const keyTd = document.createElement("td");
            const input = document.createElement("input");
            input.type = "text";
            input.readOnly = true;
            input.value = keyFor(name);
            input.title =
              "Click, then press a key to rebind. Backspace clears.";
            input.addEventListener("focus", () => startRecording(input, name));

            keyTd.appendChild(input);
            row.appendChild(labelTd);
            row.appendChild(keyTd);
            tbody.appendChild(row);
          }
        }),
      );
    }
    grid.appendChild(col);
  }
  tableEl.appendChild(grid);
  refreshKeyLabels();
}

function refreshKeyLabels() {
  for (const el of document.querySelectorAll("[data-key]")) {
    el.textContent = keyFor(el.dataset.key) || "unbound";
  }
}

function keyFor(commandName) {
  for (const [key, name] of Object.entries(settings.getKeymap())) {
    if (name === commandName) return key;
  }
  return "";
}

function startRecording(input, name) {
  const previous = input.value;
  input.value = "press a key...";
  input.classList.add("recording");

  let waitingPrefix = null;

  const commit = (combo) => {
    input.removeEventListener("keydown", handler);
    input.classList.remove("recording");
    waitingPrefix = null;

    const keymap = settings.getKeymap();
    for (const [k, cmd] of Object.entries(keymap)) {
      if (k === combo || cmd === name) delete keymap[k];
    }
    keymap[combo] = name;
    status("Binding set");
    renderKeymap();
  };

  const handler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (modifierKeys.has(event.key)) return;

    if (event.key === "Escape" || event.key === "Backspace") {
      if (waitingPrefix) {

        waitingPrefix = null;
        input.value = "press a key...";
        status(
          "Prefix cancelled — press a key, or Esc/Backspace to clear the binding",
        );
        return;
      }
      input.removeEventListener("keydown", handler);
      input.classList.remove("recording");
      const keymap = settings.getKeymap();
      for (const [k, cmd] of Object.entries(keymap)) {
        if (cmd === name) delete keymap[k];
      }
      status("Binding cleared");
      renderKeymap();
      return;
    }

    const combo = canonicalKey(event);

    if (waitingPrefix) {

      commit(waitingPrefix + combo);
      return;
    }

    if (prefixKeys.has(combo)) {
      waitingPrefix = combo;
      input.value = combo + " — press the next key, or Esc/Backspace to cancel";
      status(
        "Prefix keys can't be bound alone; press the next key of the sequence",
      );
      return;
    }

    if (RESERVED_KEYS.test(combo)) {
      input.removeEventListener("keydown", handler);
      input.classList.remove("recording");
      input.value = previous;
      status("Digits 0-9 are reserved for the repeat count");
      renderKeymap();
      return;
    }

    commit(combo);
  };
  input.addEventListener("keydown", handler);
}

function collectBehaviorSettings() {
  const raw = parseInt(scrollStepEl.value, 10);
  scrollStepEl.value =
    Number.isFinite(raw) && raw > 0 ? raw : SETTINGS_DEFAULTS.scrollStep;
  const tRaw = parseInt(timeoutEl.value, 10);
  timeoutEl.value =
    Number.isFinite(tRaw) && tRaw > 0 ? tRaw : SETTINGS_DEFAULTS.timeoutMs;
  const pRaw = parseInt(passthroughEl.value, 10);
  passthroughEl.value =
    Number.isFinite(pRaw) && pRaw > 0 ? pRaw : SETTINGS_DEFAULTS.passthroughMs;
  const sources = [];
  if (sourceTabEl.checked) sources.push("tab");
  if (sourceHistoryEl.checked) sources.push("history");
  if (sourceBookmarkEl.checked) sources.push("bookmark");
  const hintCharsRaw = hintCharsEl.value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const deduped = [...new Set(hintCharsRaw)].join("");
  if (deduped.length >= 2) {
    hintCharsEl.value = deduped;
  } else {
    hintCharsEl.value = SETTINGS_DEFAULTS.hintChars;
  }
  return {
    scrollStep: parseInt(scrollStepEl.value, 10),
    smoothScroll: smoothScrollEl.checked,
    fuzzyMatching: fuzzyMatchingEl.checked,
    timeoutMs: parseInt(timeoutEl.value, 10),
    passthroughMs: parseInt(passthroughEl.value, 10),
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

  settings
    .update({
      keymap: { ...keymapDefaults },
      scrollStep: SETTINGS_DEFAULTS.scrollStep,
      smoothScroll: SETTINGS_DEFAULTS.smoothScroll,
      fuzzyMatching: SETTINGS_DEFAULTS.fuzzyMatching,
      timeoutMs: SETTINGS_DEFAULTS.timeoutMs,
      passthroughMs: SETTINGS_DEFAULTS.passthroughMs,
      suggestionSources: SETTINGS_DEFAULTS.suggestionSources.slice(),
      copyFormat: SETTINGS_DEFAULTS.copyFormat,
      hintChars: SETTINGS_DEFAULTS.hintChars,
    })
    .then(() => status("Reset to defaults"))
    .catch(() => status("Save failed"));
  scrollStepEl.value = SETTINGS_DEFAULTS.scrollStep;
  smoothScrollEl.checked = SETTINGS_DEFAULTS.smoothScroll;
  fuzzyMatchingEl.checked = SETTINGS_DEFAULTS.fuzzyMatching;
  timeoutEl.value = SETTINGS_DEFAULTS.timeoutMs;
  passthroughEl.value = SETTINGS_DEFAULTS.passthroughMs;

  sourceTabEl.checked = SETTINGS_DEFAULTS.suggestionSources.includes("tab");
  sourceHistoryEl.checked =
    SETTINGS_DEFAULTS.suggestionSources.includes("history");
  sourceBookmarkEl.checked =
    SETTINGS_DEFAULTS.suggestionSources.includes("bookmark");
  copyFormatEl.value = SETTINGS_DEFAULTS.copyFormat;
  hintCharsEl.value = SETTINGS_DEFAULTS.hintChars;
  renderKeymap();
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
  }, 2000);
}

saveBtn.addEventListener("click", save);
resetBtn.addEventListener("click", reset);
keymapFilterEl.addEventListener("input", renderKeymap);
addSiteBtn.addEventListener("click", addDisabledSite);
siteInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addDisabledSite();
});
load();

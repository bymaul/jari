// Jari options page: edit behavior options, keybindings and manage per-site
// disabling. Imports the shared settings store, the command registry and the
// keymap helpers directly (bundled by build.js into options.bundle.js).
import {
  balanceCategories,
  canonicalKey,
  keymapDefaults,
  modifierKeys,
  prefixKeys,
  settingsDefaults,
} from "../content/keymap.js";
import { settings } from "../content/settings.js";
import { commands } from "../content/commands.js";
import { ui } from "../content/ui.js";

const SETTINGS_DEFAULTS = settingsDefaults;
const COMMANDS = commands;

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
const hintCharsEl = document.querySelector("#hint-chars");
const sourceTabEl = document.querySelector("#source-tab");
const sourceHistoryEl = document.querySelector("#source-history");
const sourceBookmarkEl = document.querySelector("#source-bookmark");
const copyFormatEl = document.querySelector("#copy-format");
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
  hintCharsEl.value = settings.getHintChars();
  const sources = settings.getSuggestionSources();
  sourceTabEl.checked = sources.includes("tab");
  sourceHistoryEl.checked = sources.includes("history");
  sourceBookmarkEl.checked = sources.includes("bookmark");
  copyFormatEl.value = settings.getCopyFormat();
  renderKeymap();
  renderDisabled();
}

// Case-insensitive filter match on the command name, its label, or the key
// it is currently bound to.
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
    if (cmd.hidden) continue;
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

  // Split the categories across three columns, keeping each category whole
  // and balancing by row count (category header + one row per command).
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
  refreshKeyHints();
}

// Fill every <code data-key="..."> with the key currently bound to that
// command so the hint texts stay in sync with the live keymap. Called from
// renderKeymap(), which runs after every rebind, clear, reset and load.
function refreshKeyHints() {
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

  // A prefix key ("g", ";", "y") can't be bound on its own — it starts a
  // two-key sequence. Pressing one makes the recorder wait for the next key
  // and binds the pair ("g" then "o" binds "go"); Escape/Backspace cancels
  // the wait and returns to "press a key...". Any second key binds, digits
  // included.
  let waitingPrefix = null;

  const commit = (combo) => {
    input.removeEventListener("keydown", handler);
    input.classList.remove("recording");
    waitingPrefix = null;
    // Drop this command's old key(s) and any other command that already
    // uses the new key, then bind. Without this, the command keeps its
    // previous key and keyFor() would show that instead of what was
    // just pressed. The live keymap object is mutated so Save persists
    // exactly what the recorder produced.
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
    if (modifierKeys.has(event.key)) return; // keep waiting for the real key

    if (event.key === "Escape" || event.key === "Backspace") {
      if (waitingPrefix) {
        // Cancel the pending prefix and go back to recording; the existing
        // binding (if any) is untouched.
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
      // Second key of a two-key binding; any key binds, digits included.
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

// Read the behavior fields, snapping invalid values back to their defaults
// in the DOM, and return them as a patch for the settings store.
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
  return {
    scrollStep: parseInt(scrollStepEl.value, 10),
    smoothScroll: smoothScrollEl.checked,
    fuzzyMatching: fuzzyMatchingEl.checked,
    timeoutMs: parseInt(timeoutEl.value, 10),
    passthroughMs: parseInt(passthroughEl.value, 10),
    hintChars: hintCharsEl.value,
    suggestionSources: sources,
    copyFormat: copyFormatEl.value,
  };
}

function save() {
  const patch = collectBehaviorSettings();
  // keymap and disabledSites were already mutated in the live store (the
  // recorder and list buttons edit in place) — include snapshots so the
  // write persists exactly what the user sees.
  patch.keymap = { ...settings.getKeymap() };
  patch.disabledSites = settings.getDisabledSites();
  settings
    .update(patch)
    .then(() => status("Saved"))
    .catch(() => status("Save failed"));
}

function reset() {
  // Restore defaults for the keymap and behavior options; the disabled
  // sites list is per-user data and is left untouched. update() persists
  // immediately — a memory-only reset would be silently undone on reload.
  settings
    .update({
      keymap: { ...keymapDefaults },
      scrollStep: SETTINGS_DEFAULTS.scrollStep,
      smoothScroll: SETTINGS_DEFAULTS.smoothScroll,
      fuzzyMatching: SETTINGS_DEFAULTS.fuzzyMatching,
      timeoutMs: SETTINGS_DEFAULTS.timeoutMs,
      passthroughMs: SETTINGS_DEFAULTS.passthroughMs,
      hintChars: SETTINGS_DEFAULTS.hintChars,
      suggestionSources: SETTINGS_DEFAULTS.suggestionSources.slice(),
      copyFormat: SETTINGS_DEFAULTS.copyFormat,
    })
    .then(() => status("Reset to defaults"))
    .catch(() => status("Save failed"));
  scrollStepEl.value = SETTINGS_DEFAULTS.scrollStep;
  smoothScrollEl.checked = SETTINGS_DEFAULTS.smoothScroll;
  fuzzyMatchingEl.checked = SETTINGS_DEFAULTS.fuzzyMatching;
  timeoutEl.value = SETTINGS_DEFAULTS.timeoutMs;
  passthroughEl.value = SETTINGS_DEFAULTS.passthroughMs;
  hintCharsEl.value = SETTINGS_DEFAULTS.hintChars;
  sourceTabEl.checked = SETTINGS_DEFAULTS.suggestionSources.includes("tab");
  sourceHistoryEl.checked =
    SETTINGS_DEFAULTS.suggestionSources.includes("history");
  sourceBookmarkEl.checked =
    SETTINGS_DEFAULTS.suggestionSources.includes("bookmark");
  copyFormatEl.value = SETTINGS_DEFAULTS.copyFormat;
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
      settings.set({ disabledSites: sites.filter((s) => s !== site) });
      renderDisabled();
    });
    li.appendChild(siteSpan);
    li.appendChild(btn);
    disabledList.appendChild(li);
  }
}

// Reduce a typed site to a plain hostname, matching location.hostname so
// settings.isDisabled() finds it: accept a full URL or a bare host, drop
// scheme/port/path. Unparseable input returns "".
function normalizeHost(raw) {
  let host = raw.trim().toLowerCase();
  if (!host) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }
  host = host.split(/[/?#:]/)[0].replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(
    host,
  )
    ? host
    : "";
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
    settings.set({ disabledSites: [...sites, host] });
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

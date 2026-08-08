// Jari options page: edit behavior options, keybindings and manage per-site
// disabling. Relies on window.Jari.keymapDefaults, Jari.settingsDefaults,
// Jari.prefixes and Jari.commands (loaded via script tags).
(() => {
  const DEFAULTS = window.Jari.keymapDefaults;
  const SETTINGS_DEFAULTS = window.Jari.settingsDefaults;
  const COMMANDS = window.Jari.commands;

  // Fixed prefixes ("gg", "gt", ...) live in Jari.prefixes. They are shown
  // in the key fields so the user can see them, but they cannot be rebound —
  // Backspace only clears the single-key binding.
  const PREFIXES = {};
  for (const [prefix, subs] of Object.entries(window.Jari.prefixes || {})) {
    for (const [suffix, name] of Object.entries(subs)) {
      PREFIXES[name] = prefix + suffix;
    }
  }

  const tableEl = document.querySelector("#keymap-table");
  const saveBtn = document.querySelector("#save");
  const resetBtn = document.querySelector("#reset");
  const statusEl = document.querySelector("#status");
  const disabledList = document.querySelector("#disabled-list");
  const scrollStepEl = document.querySelector("#scroll-step");
  const smoothScrollEl = document.querySelector("#smooth-scroll");
  const timeoutEl = document.querySelector("#timeout");
  const accentEl = document.querySelector("#accent");

  // Display order and titles for the command categories (shared with the
  // help overlay; defined in keymap.js).
  const CATEGORIES = window.Jari.categories || [];

  const STORAGE_KEY = "settings";
  const RESERVED_KEYS = /^[0-9]$/;

  // Modifier keys on their own are not bindable and must not end a recording:
  // holding Ctrl to type "ctrl+a" first fires keydown("Control"), which would
  // otherwise be recorded as "ctrl+Control".
  const MODIFIER_ONLY = new Set(["Control", "Alt", "Shift", "Meta", "CapsLock", "NumLock", "ScrollLock", "Fn", "AltGraph"]);

  let keymap = {};
  let disabledSites = [];
  let scrollStep = SETTINGS_DEFAULTS.scrollStep;
  let smoothScroll = SETTINGS_DEFAULTS.smoothScroll;
  let timeoutMs = SETTINGS_DEFAULTS.timeoutMs;
  let accentColor = SETTINGS_DEFAULTS.accentColor;

  function isColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }

  // Push the chosen accent into the page's stylesheet variable so h2, code,
  // buttons and the primary button all follow it live.
  function applyAccent() {
    document.documentElement.style.setProperty("--accent", accentColor);
  }

  // Mirror of the content-script canonical key format: [ctrl/alt/meta] + key.
  function canonicalKey(event) {
    const parts = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.metaKey) parts.push("meta");
    parts.push(event.key);
    return parts.join("+");
  }

  async function load() {
    let saved = {};
    try {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      saved = data[STORAGE_KEY] || {};
    } catch {}
    keymap = { ...DEFAULTS, ...(saved.keymap || {}) };
    for (const key of window.Jari.unboundKeys) delete keymap[key];
    disabledSites = saved.disabledSites || [];
    scrollStep = Number.isFinite(saved.scrollStep)
      ? saved.scrollStep
      : SETTINGS_DEFAULTS.scrollStep;
    smoothScroll = typeof saved.smoothScroll === "boolean"
      ? saved.smoothScroll
      : SETTINGS_DEFAULTS.smoothScroll;
    timeoutMs = Number.isFinite(saved.timeoutMs) && saved.timeoutMs > 0
      ? saved.timeoutMs
      : SETTINGS_DEFAULTS.timeoutMs;
    accentColor = isColor(saved.accentColor)
      ? saved.accentColor
      : SETTINGS_DEFAULTS.accentColor;
    scrollStepEl.value = scrollStep;
    smoothScrollEl.checked = smoothScroll;
    timeoutEl.value = timeoutMs;
    accentEl.value = accentColor;
    applyAccent();
    renderKeymap();
    renderDisabled();
  }

  function renderKeymap() {
    tableEl.textContent = "";
    const byCategory = new Map();
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      if (cmd.hidden) continue;
      const id = cmd.category || "other";
      if (!byCategory.has(id)) byCategory.set(id, []);
      byCategory.get(id).push([name, cmd]);
    }

    // Split the categories across three columns, keeping each category whole
    // and balancing by row count (category header + one row per command).
    const COLUMNS = 3;
    const columns = Array.from({ length: COLUMNS }, () => []);
    const columnRows = columns.map(() => 0);
    for (const cat of CATEGORIES) {
      if (!byCategory.has(cat.id)) continue;
      let best = 0;
      for (let i = 1; i < COLUMNS; i++) {
        if (columnRows[i] < columnRows[best]) best = i;
      }
      columns[best].push(cat);
      columnRows[best] += 1 + byCategory.get(cat.id).length;
    }

    const grid = document.createElement("div");
    grid.className = "jari-keymap-columns";
    for (const cats of columns) {
      const col = document.createElement("div");
      col.className = "jari-keymap-column";
      for (const cat of cats) col.appendChild(buildCategoryTable(byCategory, cat));
      grid.appendChild(col);
    }
    tableEl.appendChild(grid);
  }

  function buildCategoryTable(byCategory, cat) {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");

    const headerRow = document.createElement("tr");
    headerRow.className = "cat-header";
    const th = document.createElement("th");
    th.colSpan = 2;
    th.textContent = cat.label;
    headerRow.appendChild(th);
    tbody.appendChild(headerRow);

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
      const isPrefix = !hasKeyBinding(name) && Boolean(PREFIXES[name]);
      if (isPrefix) {
        input.classList.add("prefix");
        input.title = "Fixed prefix, cannot be rebound";
      } else {
        input.title = "Click, then press a key to rebind. Backspace clears.";
      }
      input.addEventListener("focus", () => startRecording(input, name));

      keyTd.appendChild(input);
      row.appendChild(labelTd);
      row.appendChild(keyTd);
      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    return table;
  }

  function hasKeyBinding(commandName) {
    return Object.values(keymap).includes(commandName);
  }

  function keyFor(commandName) {
    for (const [key, name] of Object.entries(keymap)) {
      if (name === commandName) return key;
    }
    return PREFIXES[commandName] || "";
  }

  function startRecording(input, name) {
    const previous = input.value;
    input.value = "press a key...";
    input.classList.add("recording");

    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (MODIFIER_ONLY.has(event.key)) return; // keep waiting for the real key
      input.removeEventListener("keydown", handler);
      input.classList.remove("recording");

      if (event.key === "Escape" || event.key === "Backspace") {
        keymap = Object.fromEntries(Object.entries(keymap).filter(([, cmd]) => cmd !== name));
        status("Binding cleared");
      } else {
        const combo = canonicalKey(event);
        if (RESERVED_KEYS.test(combo)) {
          input.value = previous;
          status("Digits 0-9 are reserved for the repeat count");
          renderKeymap();
          return;
        }
        // Drop this command's old key(s) and any other command that already
        // uses the new key, then bind. Without this, the command keeps its
        // previous key and keyFor() would show that instead of what was
        // just pressed.
        keymap = Object.fromEntries(
          Object.entries(keymap).filter(([key, cmd]) => key !== combo && cmd !== name)
        );
        keymap[combo] = name;
        status("Binding set");
      }
      renderKeymap();
    };
    input.addEventListener("keydown", handler);
  }

  function collectScrollSettings() {
    const raw = parseInt(scrollStepEl.value, 10);
    scrollStep = Number.isFinite(raw) && raw > 0 ? raw : SETTINGS_DEFAULTS.scrollStep;
    scrollStepEl.value = scrollStep;
    smoothScroll = smoothScrollEl.checked;
    const tRaw = parseInt(timeoutEl.value, 10);
    timeoutMs = Number.isFinite(tRaw) && tRaw > 0 ? tRaw : SETTINGS_DEFAULTS.timeoutMs;
    timeoutEl.value = timeoutMs;
    accentColor = isColor(accentEl.value) ? accentEl.value : SETTINGS_DEFAULTS.accentColor;
    accentEl.value = accentColor;
    applyAccent();
  }

  function save() {
    collectScrollSettings();
    const next = {};
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      if (cmd.hidden) continue;
      const row = tableEl.querySelector(`tr[data-command="${name}"]`);
      const input = row && row.querySelector("input");
      if (input && input.value && !input.classList.contains("prefix")) next[input.value] = name;
    }
    keymap = next;
    chrome.storage.sync
      .set({
        [STORAGE_KEY]: { keymap: next, disabledSites, scrollStep, smoothScroll, timeoutMs, accentColor },
      })
      .then(() => status("Saved"))
      .catch(() => status("Save failed"));
    renderKeymap();
  }

  function reset() {
    keymap = { ...DEFAULTS };
    scrollStep = SETTINGS_DEFAULTS.scrollStep;
    smoothScroll = SETTINGS_DEFAULTS.smoothScroll;
    timeoutMs = SETTINGS_DEFAULTS.timeoutMs;
    accentColor = SETTINGS_DEFAULTS.accentColor;
    scrollStepEl.value = scrollStep;
    smoothScrollEl.checked = smoothScroll;
    timeoutEl.value = timeoutMs;
    accentEl.value = accentColor;
    applyAccent();
    renderKeymap();
    status("Reset to defaults");
  }

  function renderDisabled() {
    disabledList.textContent = "";
    if (disabledSites.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No disabled sites.";
      disabledList.appendChild(li);
      return;
    }
    for (const site of disabledSites) {
      const li = document.createElement("li");
      const siteSpan = document.createElement("span");
      siteSpan.textContent = site;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Enable";
      btn.addEventListener("click", () => {
        disabledSites = disabledSites.filter((s) => s !== site);
        renderDisabled();
      });
      li.appendChild(siteSpan);
      li.appendChild(btn);
      disabledList.appendChild(li);
    }
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
  load();
})();

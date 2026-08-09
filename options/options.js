// Jari options page: edit behavior options, keybindings and manage per-site
// disabling. Relies on window.Jari.keymapDefaults, Jari.settingsDefaults,
// Jari.prefixes, Jari.commands and the shared helpers in keymap.js (all
// loaded via script tags).
(() => {
  const DEFAULTS = window.Jari.keymapDefaults;
  const SETTINGS_DEFAULTS = window.Jari.settingsDefaults;
  const COMMANDS = window.Jari.commands;

  const tableEl = document.querySelector("#keymap-table");
  const saveBtn = document.querySelector("#save");
  const resetBtn = document.querySelector("#reset");
  const statusEl = document.querySelector("#status");
  const disabledList = document.querySelector("#disabled-list");
  const scrollStepEl = document.querySelector("#scroll-step");
  const smoothScrollEl = document.querySelector("#smooth-scroll");
  const timeoutEl = document.querySelector("#timeout");
  const passthroughEl = document.querySelector("#passthrough-timeout");
  const accentEl = document.querySelector("#accent");
  const keymapFilterEl = document.querySelector("#keymap-filter");
  const siteInputEl = document.querySelector("#disabled-site-input");
  const addSiteBtn = document.querySelector("#add-disabled-site");

  const STORAGE_KEY = "settings";
  const RESERVED_KEYS = /^[0-9]$/;

  let keymap = {};
  let disabledSites = [];
  let scrollStep = SETTINGS_DEFAULTS.scrollStep;
  let smoothScroll = SETTINGS_DEFAULTS.smoothScroll;
  let timeoutMs = SETTINGS_DEFAULTS.timeoutMs;
  let passthroughMs = SETTINGS_DEFAULTS.passthroughMs;
  let accentColor = SETTINGS_DEFAULTS.accentColor;

  // Push the chosen accent into the page's stylesheet variable so h2, code,
  // buttons and the primary button all follow it live.
  function applyAccent() {
    document.documentElement.style.setProperty("--accent", accentColor);
  }

  async function load() {
    let saved = {};
    try {
      const data = await chrome.storage.sync.get(STORAGE_KEY);
      saved = data[STORAGE_KEY] || {};
    } catch {}
    const s = window.Jari.normalizeSettings(saved);
    keymap = s.keymap;
    disabledSites = s.disabledSites;
    scrollStep = s.scrollStep;
    smoothScroll = s.smoothScroll;
    timeoutMs = s.timeoutMs;
    passthroughMs = s.passthroughMs;
    accentColor = s.accentColor;
    scrollStepEl.value = scrollStep;
    smoothScrollEl.checked = smoothScroll;
    timeoutEl.value = timeoutMs;
    passthroughEl.value = passthroughMs;
    accentEl.value = accentColor;
    applyAccent();
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
    const columns = window.Jari.balanceCategories(byCategory, 3);

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
      input.title = "Click, then press a key to rebind. Backspace clears.";
      input.addEventListener("focus", () => startRecording(input, name));

      keyTd.appendChild(input);
      row.appendChild(labelTd);
      row.appendChild(keyTd);
      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    return table;
  }

  function keyFor(commandName) {
    for (const [key, name] of Object.entries(keymap)) {
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
      // just pressed.
      keymap = Object.fromEntries(
        Object.entries(keymap).filter(([key, cmd]) => key !== combo && cmd !== name)
      );
      keymap[combo] = name;
      status("Binding set");
      renderKeymap();
    };

    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window.Jari.modifierKeys.has(event.key)) return; // keep waiting for the real key

      if (event.key === "Escape" || event.key === "Backspace") {
        if (waitingPrefix) {
          // Cancel the pending prefix and go back to recording; the existing
          // binding (if any) is untouched.
          waitingPrefix = null;
          input.value = "press a key...";
          status("Prefix cancelled — press a key, or Esc/Backspace to clear the binding");
          return;
        }
        input.removeEventListener("keydown", handler);
        input.classList.remove("recording");
        keymap = Object.fromEntries(Object.entries(keymap).filter(([, cmd]) => cmd !== name));
        status("Binding cleared");
        renderKeymap();
        return;
      }

      const combo = window.Jari.canonicalKey(event);

      if (waitingPrefix) {
        // Second key of a two-key binding; any key binds, digits included.
        commit(waitingPrefix + combo);
        return;
      }

      if (window.Jari.prefixKeys.has(combo)) {
        waitingPrefix = combo;
        input.value = combo + " — press the next key, or Esc/Backspace to cancel";
        status("Prefix keys can't be bound alone; press the next key of the sequence");
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

  function collectScrollSettings() {
    const raw = parseInt(scrollStepEl.value, 10);
    scrollStep = Number.isFinite(raw) && raw > 0 ? raw : SETTINGS_DEFAULTS.scrollStep;
    scrollStepEl.value = scrollStep;
    smoothScroll = smoothScrollEl.checked;
    const tRaw = parseInt(timeoutEl.value, 10);
    timeoutMs = Number.isFinite(tRaw) && tRaw > 0 ? tRaw : SETTINGS_DEFAULTS.timeoutMs;
    timeoutEl.value = timeoutMs;
    const pRaw = parseInt(passthroughEl.value, 10);
    passthroughMs = Number.isFinite(pRaw) && pRaw > 0 ? pRaw : SETTINGS_DEFAULTS.passthroughMs;
    passthroughEl.value = passthroughMs;
    accentColor = window.Jari.isColor(accentEl.value) ? accentEl.value : SETTINGS_DEFAULTS.accentColor;
    accentEl.value = accentColor;
    applyAccent();
  }

  function save() {
    collectScrollSettings();
    // keymap state is authoritative — the recording handler mutates it and
    // the inputs only mirror it — so persist it directly instead of
    // re-reading the DOM (which could store empty keys from stale inputs).
    chrome.storage.sync
      .set({
        [STORAGE_KEY]: { keymap, disabledSites, scrollStep, smoothScroll, timeoutMs, passthroughMs, accentColor },
      })
      .then(() => status("Saved"))
      .catch(() => status("Save failed"));
  }

  function reset() {
    keymap = { ...DEFAULTS };
    scrollStep = SETTINGS_DEFAULTS.scrollStep;
    smoothScroll = SETTINGS_DEFAULTS.smoothScroll;
    timeoutMs = SETTINGS_DEFAULTS.timeoutMs;
    passthroughMs = SETTINGS_DEFAULTS.passthroughMs;
    accentColor = SETTINGS_DEFAULTS.accentColor;
    scrollStepEl.value = scrollStep;
    smoothScrollEl.checked = smoothScroll;
    timeoutEl.value = timeoutMs;
    passthroughEl.value = passthroughMs;
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
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)
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
    if (disabledSites.includes(host)) {
      status("Already disabled: " + host);
    } else {
      disabledSites.push(host);
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
})();

// Jari: keybinding help overlay (?).
// Flat bottom bar listing every bound key and its command.
// Rendered from the live keymap, so rebinds are reflected immediately.
// On open the overlay takes focus and the help list owns the scroll:
// j/k, gg/G and ctrl+d/u/f/b move through it.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const STEP = 50;

  let active = false;
  let overlay = null;
  let listEl = null;
  let gPending = false;

  function isActive() {
    return active;
  }

  function open() {
    if (active) return;
    active = true;
    render();
    // Give the overlay focus so the list owns the scroll (j/k etc.).
    overlay.tabIndex = -1;
    overlay.focus();
  }

  function render() {
    overlay = document.createElement("div");
    overlay.className = "jari-overlay jari-help";

    const title = document.createElement("div");
    title.className = "jari-help-title";
    title.textContent = "Jari keybindings";
    overlay.appendChild(title);

    listEl = document.createElement("div");
    listEl.className = "jari-help-list";
    // Single keys from the keymap, then multi-key chords ("gg", "gt").
    const rows = new Map();
    for (const [key, commandName] of Object.entries(Jari.settings.getKeymap())) {
      rows.set(key, commandName);
    }
    for (const [prefix, subs] of Object.entries(Jari.chords || {})) {
      for (const [suffix, commandName] of Object.entries(subs)) {
        rows.set(prefix + suffix, commandName);
      }
    }
    for (const [key, commandName] of rows) {
      const cmd = Jari.commands[commandName];
      if (!cmd) continue;
      const row = document.createElement("div");
      row.className = "jari-help-row";
      const keyEl = document.createElement("span");
      keyEl.className = "jari-help-key";
      keyEl.textContent = key;
      const labelEl = document.createElement("span");
      labelEl.className = "jari-help-label";
      labelEl.textContent = cmd.label;
      row.appendChild(keyEl);
      row.appendChild(labelEl);
      listEl.appendChild(row);
    }
    overlay.appendChild(listEl);

    const footer = document.createElement("div");
    footer.className = "jari-help-footer";
    const hint = document.createElement("span");
    hint.textContent = "j/k scroll  |  g chords  |  ;s settings  |  0-9 count  |  esc close";
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.textContent = "Open settings";
    settingsBtn.addEventListener("click", () => {
      Jari.sendMessage("openOptions");
      close();
    });
    footer.appendChild(hint);
    footer.appendChild(settingsBtn);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
  }

  function onKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "g") {
      gPending = true;
      return;
    }
    if (gPending) {
      gPending = false;
      if (event.key === "g") listEl.scrollTo(0, 0);
      return;
    }
    if (event.ctrlKey) {
      if (event.key === "d") listEl.scrollBy(0, listEl.clientHeight * 0.5);
      else if (event.key === "u") listEl.scrollBy(0, -listEl.clientHeight * 0.5);
      else if (event.key === "f") listEl.scrollBy(0, listEl.clientHeight * 0.9);
      else if (event.key === "b") listEl.scrollBy(0, -listEl.clientHeight * 0.9);
      return;
    }
    switch (event.key) {
      case "G":
        listEl.scrollTo(0, listEl.scrollHeight);
        break;
      case "j":
      case "ArrowDown":
        listEl.scrollBy(0, STEP);
        break;
      case "k":
      case "ArrowUp":
        listEl.scrollBy(0, -STEP);
        break;
    }
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    listEl = null;
    gPending = false;
    active = false;
  }

  Jari.Help = { open, close, onKeyDown, isActive };
})();

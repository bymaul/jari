// Jari: keybinding help overlay (?).
// Categorized three-column modal listing every bound key and its command.
// Rendered from the live keymap, so rebinds are reflected immediately.
// On open the overlay takes focus and the help list owns the scroll:
// j/k, G and ctrl+d/u/f/b move through it.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const STEP = 50;
  const COLUMNS = 3;

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
    // Give the overlay focus so the list owns the scroll (j/k etc.). The
    // focus ring is suppressed in CSS — the modal must not show an outline.
    overlay.tabIndex = -1;
    overlay.focus();
  }

  function render() {
    overlay = document.createElement('div');
    overlay.className = 'jari-overlay jari-help';

    const title = document.createElement('div');
    title.className = 'jari-help-title';
    title.textContent = 'Jari keybindings';
    overlay.appendChild(title);

    // Collect every binding: single keys and two-key pairs from the keymap.
    const byCommand = new Map();
    for (const [key, commandName] of Object.entries(Jari.settings.getKeymap())) {
      byCommand.set(commandName, key);
    }

    const byCategory = new Map();
    for (const [commandName, key] of byCommand) {
      const cmd = Jari.commands[commandName];
      if (!cmd) continue;
      const id = cmd.category || 'other';
      if (!byCategory.has(id)) byCategory.set(id, []);
      byCategory.get(id).push({ key, label: cmd.label });
    }

    // Split the categories across three columns, keeping each category whole
    // and balancing by row count (category header + one row per command).
    const columns = Jari.balanceCategories(byCategory, COLUMNS);

    listEl = document.createElement('div');
    listEl.className = 'jari-help-list';
    const grid = document.createElement('div');
    grid.className = 'jari-help-columns';
    for (const col of columns) {
      const colEl = document.createElement('div');
      colEl.className = 'jari-help-column';
      for (const cat of col) {
        colEl.appendChild(
          Jari.ui.buildCategoryTable(cat, 'jari-help-cat-header', (tbody) => {
            for (const { key, label } of byCategory.get(cat.id)) {
              const tr = document.createElement('tr');
              const keyTd = document.createElement('td');
              keyTd.className = 'jari-help-key';
              keyTd.textContent = key;
              const labelTd = document.createElement('td');
              labelTd.className = 'jari-help-label';
              labelTd.textContent = label;
              tr.appendChild(keyTd);
              tr.appendChild(labelTd);
              tbody.appendChild(tr);
            }
          }),
        );
      }
      grid.appendChild(colEl);
    }
    listEl.appendChild(grid);
    overlay.appendChild(listEl);

    const footer = document.createElement('div');
    footer.className = 'jari-help-footer';
    const hint = document.createElement('span');
    hint.textContent = 'j/k scroll | 0-9 count | esc close';
    footer.appendChild(hint);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
  }

  function onKeyDown(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'g') {
      gPending = true;
      return;
    }
    if (gPending) {
      gPending = false;
      if (event.key === 'g') listEl.scrollTo(0, 0);
      return;
    }
    if (event.ctrlKey) {
      if (event.key === 'd') listEl.scrollBy(0, listEl.clientHeight * 0.5);
      else if (event.key === 'u') listEl.scrollBy(0, -listEl.clientHeight * 0.5);
      else if (event.key === 'f') listEl.scrollBy(0, listEl.clientHeight * 0.9);
      else if (event.key === 'b') listEl.scrollBy(0, -listEl.clientHeight * 0.9);
      return;
    }
    switch (event.key) {
      case 'G':
        listEl.scrollTo(0, listEl.scrollHeight);
        break;
      case 'j':
      case 'ArrowDown':
        listEl.scrollBy(0, STEP);
        break;
      case 'k':
      case 'ArrowUp':
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

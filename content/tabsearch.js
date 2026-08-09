// Jari: tab-search mode (g t).
// Shows a filterable list of tabs. Typing filters by title/URL, arrows move
// the selection, Enter activates, Escape closes.
//
// Also serves as the merge picker for splitOrMergeTab: in a single-tab window
// it lists the tabs of the other windows and Enter moves this tab into the
// chosen one.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  let active = false;
  let overlay = null;
  let inputEl = null;
  let listEl = null;
  let tabs = [];
  let filtered = [];
  let selected = 0;
  let mergeData = null; // { ownTabId, ownWindowId } when in merge mode

  function isActive() {
    return active;
  }

  async function open() {
    if (active) return;
    tabs = (await Jari.sendMessage("listTabs")) || [];
    if (tabs.length === 0) return;
    mergeData = null;
    active = true;
    render("Tabs", "Search tabs...");
  }

  // Merge picker: entries are the OTHER windows (title = active tab, subtitle
  // = tab count); Enter moves this tab into the picked window.
  function openMerge(data) {
    if (active) return;
    tabs = (data && data.tabs) || [];
    mergeData = data || null;
    active = true;
    render("Merge into", "Choose a window...");
  }

  function render(title, placeholder) {
    overlay = document.createElement("div");
    overlay.className = "jari-overlay jari-tabsearch";

    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.placeholder = placeholder;
    inputEl.addEventListener("input", () => {
      const query = inputEl.value.toLowerCase();
      filtered = tabs.filter((tab) => (tab.title + " " + tab.url).toLowerCase().includes(query));
      selected = 0;
      renderList();
    });

    listEl = document.createElement("ul");
    listEl.className = "jari-tabsearch-list";

    const header = document.createElement("div");
    header.className = "jari-tabsearch-header";
    header.textContent = title;

    overlay.appendChild(inputEl);
    overlay.appendChild(header);
    overlay.appendChild(listEl);
    document.body.appendChild(overlay);

    filtered = tabs;
    renderList();
    inputEl.focus();
  }

  function renderList() {
    listEl.textContent = "";
    // Label windows #1, #2, ... in order of first appearance so tabs from
    // different windows are distinguishable in the list.
    const winLabels = new Map();
    let winIndex = 0;
    const rows = filtered.slice(0, 50);
    for (const tab of rows) {
      if (!winLabels.has(tab.windowId)) winLabels.set(tab.windowId, ++winIndex);
    }
    for (const tab of rows) {
      const li = document.createElement("li");
      const win = document.createElement("span");
      win.className = "jari-win-tag";
      win.textContent = "#" + winLabels.get(tab.windowId);
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = tab.title || "(untitled)";
      const url = document.createElement("span");
      url.className = "url";
      url.textContent = tab.url || "";
      li.appendChild(win);
      li.appendChild(title);
      li.appendChild(url);
      listEl.appendChild(li);
    }
    highlight();
  }

  function highlight() {
    Array.from(listEl.children).forEach((li, i) => li.classList.toggle("selected", i === selected));
    const el = listEl.children[selected];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function move(delta) {
    if (filtered.length === 0) return;
    selected = (selected + delta + filtered.length) % filtered.length;
    highlight();
  }

  // Capture-phase key handler. The search box owns printable keys; Escape,
  // Enter, Tab and the arrow keys are intercepted here and stopped so the
  // page never sees them.
  function onKeyDown(event) {
    const inInput = document.activeElement === inputEl;
    if (inInput) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(event.shiftKey ? -1 : 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        move(-1);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(event.shiftKey ? -1 : 1);
    }
  }

  function activate() {
    const tab = filtered[selected];
    if (tab) {
      if (mergeData) {
        // Merge mode: entries are windows; the background moves this tab into
        // the picked window and focuses it there.
        Jari.sendMessage("mergeTab", { targetWindowId: tab.windowId });
      } else {
        Jari.sendMessage("activateTab", { id: tab.id });
      }
    }
    close();
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    inputEl = null;
    listEl = null;
    tabs = [];
    filtered = [];
    selected = 0;
    mergeData = null;
    active = false;
  }

  Jari.TabSearch = { open, openMerge, close, onKeyDown, isActive };
})();

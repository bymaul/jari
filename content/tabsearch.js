// Jari: tab-search mode (gt).
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
    for (const tab of filtered.slice(0, 50)) {
      const li = document.createElement("li");
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = tab.title || "(untitled)";
      const url = document.createElement("span");
      url.className = "url";
      url.textContent = tab.url || "";
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
  // Enter, Tab and the arrow keys are intercepted here.
  function onKeyDown(event) {
    const inInput = document.activeElement === inputEl;
    if (inInput) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        activate();
      } else if (event.key === "Tab") {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
  }

  function activate() {
    const tab = filtered[selected];
    if (tab) {
      if (mergeData) {
        // Merge mode: entries are windows; dropping the tab into the window
        // makes it active there (tabs.move does that automatically).
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

// Jari: tab-search mode (T).
// Shows a filterable list of tabs in the current window. Typing filters by
// title/URL, arrows move the selection, Enter activates, Escape closes.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  let active = false;
  let overlay = null;
  let inputEl = null;
  let listEl = null;
  let tabs = [];
  let filtered = [];
  let selected = 0;

  function isActive() {
    return active;
  }

  async function open() {
    if (active) return;
    tabs = (await Jari.sendMessage("listTabs")) || [];
    if (tabs.length === 0) return;
    active = true;
    render();
  }

  function render() {
    overlay = document.createElement("div");
    overlay.className = "jari-overlay jari-tabsearch";

    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.placeholder = "Search tabs...";
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
    header.textContent = "Tabs";

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
  // Enter and the arrow keys are intercepted here.
  function onKeyDown(event) {
    const inInput = document.activeElement === inputEl;
    if (inInput) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        activate();
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
    }
  }

  function activate() {
    const tab = filtered[selected];
    if (tab) Jari.sendMessage("activateTab", { id: tab.id });
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
    active = false;
  }

  Jari.TabSearch = { open, close, onKeyDown, isActive };
})();

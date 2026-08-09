// Jari: the prompt overlay — a filterable list owned by a search box.
// "gt" (tab search) lists the open tabs: typing filters by title/URL, arrows
// move the selection, Enter activates, Escape closes.
//
// "t" (omnibar) reuses the same overlay to open a URL or search: the first
// row is the typed query (opened as a URL when it looks like one, otherwise
// searched with the default engine), below it come autocomplete matches from
// the browser (history, bookmarks, open tabs).
//
// "ge" edits the current page URL: the same omnibar prefilled with the
// current URL, and Enter navigates this tab instead of opening a new one.
//
// The overlay also serves as the merge picker for splitOrMergeTab: in a
// single-tab window it lists the tabs of the other windows and Enter moves
// this tab into the chosen one. Each feature is a mode over the one overlay.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  let active = false;
  let overlay = null;
  let inputEl = null;
  let listEl = null;
  let tabs = [];
  let filtered = [];
  let selected = 0;
  let mode = "tabs"; // "tabs" | "merge" | "open" | "edit"
  let suggestSeq = 0; // invalidates in-flight suggestion fetches
  let suggestTimer = null;

  function isActive() {
    return active;
  }

  async function open() {
    if (active) return;
    tabs = (await Jari.sendMessage("listTabs")) || [];
    if (tabs.length === 0) return;
    mode = "tabs";
    active = true;
    render("Tabs", "Search tabs...");
  }

  // "t": open a URL or search. The omnibar needs no initial data — the list
  // is built from the typed query as it comes in.
  function openOmnibar() {
    if (active) return;
    tabs = [];
    mode = "open";
    active = true;
    render("Open", "Search or type URL");
  }

  // "ge": edit the current page URL. Same omnibar as "t", but prefilled with
  // the current URL and Enter navigates this tab instead of opening a new one.
  function openEditUrl() {
    if (active) return;
    tabs = [];
    mode = "edit";
    active = true;
    render("Edit URL", "Search or type URL");
    inputEl.value = location.href;
    handleOpenInput(inputEl.value);
  }

  // Merge picker: entries are the OTHER windows (title = active tab, subtitle
  // = tab count); Enter moves this tab into the picked window.
  function openMerge(data) {
    if (active) return;
    tabs = (data && data.tabs) || [];
    mode = "merge";
    active = true;
    render("Merge into", "Choose a window...");
  }

  // A bare query that is a URL — scheme, protocol-relative, localhost, or a
  // dotted hostname (with an optional path/port). Everything else is search
  // terms. The background's normalizeUrl turns bare hosts into https.
  function looksLikeUrl(text) {
    const s = text.trim();
    if (!s || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("//")) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([:/?#].*)?$/i.test(s);
  }

  // Omnibar input: row 0 is always the typed query — labeled as an open or a
  // search depending on looksLikeUrl — and the suggestions arrive async,
  // debounced, replacing that row's list. A stale response (query changed or
  // overlay closed) is dropped via suggestSeq.
  function handleOpenInput(query) {
    const q = query.trim();
    if (!q) {
      clearTimeout(suggestTimer);
      suggestSeq++;
      filtered = [];
      selected = 0;
      renderList();
      return;
    }
    const row = looksLikeUrl(q)
      ? { kind: "url", title: q, url: q }
      : { kind: "search", title: q, url: null };
    filtered = [row];
    selected = 0;
    renderList();
    clearTimeout(suggestTimer);
    const seq = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      if (!active || seq !== suggestSeq) return;
      const res = (await Jari.sendMessage("suggest", { query: q })) || [];
      if (!active || seq !== suggestSeq) return;
      filtered = [row, ...res.map((r) => ({ kind: "suggestion", title: r.title, url: r.url }))];
      selected = 0;
      renderList();
    }, 130);
  }

  function render(title, placeholder) {
    overlay = document.createElement("div");
    overlay.className = "jari-overlay jari-prompt";

    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.placeholder = placeholder;
    inputEl.addEventListener("input", () => {
      const query = inputEl.value;
      if (mode === "open" || mode === "edit") {
        handleOpenInput(query);
      } else {
        const q = query.toLowerCase();
        filtered = tabs.filter((tab) => (tab.title + " " + tab.url).toLowerCase().includes(q));
        selected = 0;
        renderList();
      }
    });

    listEl = document.createElement("ul");
    listEl.className = "jari-prompt-list";

    const header = document.createElement("div");
    header.className = "jari-prompt-header";
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
    if (mode === "open" || mode === "edit") {
      listEl.textContent = "";
      for (const row of filtered.slice(0, 50)) {
        const li = document.createElement("li");
        const title = document.createElement("span");
        title.className = "title";
        title.textContent =
          row.kind === "search"
            ? `Search for "${row.title}"`
            : row.kind === "url"
              ? `Open ${row.title}`
              : row.title || "(untitled)";
        const url = document.createElement("span");
        url.className = "url";
        url.textContent = row.kind === "suggestion" ? row.url || "" : "";
        li.appendChild(title);
        li.appendChild(url);
        listEl.appendChild(li);
      }
      highlight();
      return;
    }

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
    const item = filtered[selected];
    if (!item) {
      // Nothing selected: in the omnibar an empty query still opens a blank
      // new tab, preserving the old "t" behavior.
      if (mode === "open" && !inputEl.value.trim()) Jari.sendMessage("createTab");
      close();
      return;
    }
    if (mode === "merge") {
      // Merge mode: entries are windows; the background moves this tab into
      // the picked window and focuses it there.
      Jari.sendMessage("mergeTab", { targetWindowId: item.windowId });
    } else if (mode === "open" || mode === "edit") {
      // "t" opens a new tab; "ge" edits the current page, so it navigates
      // this tab instead.
      if (item.kind === "search") Jari.sendMessage("search", { query: inputEl.value, newTab: mode === "open" });
      else if (item.url) Jari.sendMessage(mode === "open" ? "createTab" : "navigate", { url: item.url });
    } else {
      Jari.sendMessage("activateTab", { id: item.id });
    }
    close();
  }

  function close() {
    clearTimeout(suggestTimer);
    suggestSeq++;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    inputEl = null;
    listEl = null;
    tabs = [];
    filtered = [];
    selected = 0;
    mode = "tabs";
    active = false;
  }

  Jari.Prompt = { open, openOmnibar, openEditUrl, openMerge, close, onKeyDown, isActive };
})();

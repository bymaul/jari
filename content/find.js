// Jari: find-in-page mode (/ , n, N).
// A bottom overlay bar collects the query and live-highlights matches with
// <span> marks; the bar shows a "current/total" counter. n/N cycle matches.
// Escape clears the search entirely: bar, highlights and query are gone.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const SKIP_SELECTOR =
    "script, style, noscript, " +
    Jari.overlaySelectors +
    ", input, textarea, select, [contenteditable]";

  let active = false;
  let bar = null;
  let countEl = null;
  let marks = [];
  let current = -1;
  let lastQuery = "";
  let searchTimer = null;

  function isActive() {
    return active;
  }

  function start() {
    if (active) {
      bar.querySelector("input").focus();
      return;
    }
    active = true;
    bar = createBar();
    document.body.appendChild(bar);
    const input = bar.querySelector("input");
    // Reopen with the previous query, like most editors.
    if (lastQuery) {
      input.value = lastQuery;
      search(lastQuery, { scroll: false });
      input.select();
    }
    input.focus();
  }

  function createBar() {
    const el = document.createElement("div");
    el.className = "jari-find-bar";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Find in page";
    input.addEventListener("input", () => scheduleSearch(input.value));
    countEl = document.createElement("span");
    countEl.className = "jari-find-count";
    el.appendChild(input);
    el.appendChild(countEl);
    return el;
  }

  // Typing fires one input event per keystroke, and search() walks the whole
  // document body to collect text nodes. Debounce so a fast typist does not
  // re-walk the tree on every key.
  function scheduleSearch(query) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(query, { scroll: false }), 80);
  }

  // Capture-phase key handler. While the search box is focused, printable
  // keys pass through to it; after Enter (blur), n/N navigate matches. Keys
  // Jari consumes are stopped so the page never sees them.
  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    const input = bar.querySelector("input");
    if (document.activeElement === input) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        input.blur();
        next();
      }
      return;
    }
    if (event.key === "n") {
      event.preventDefault();
      event.stopPropagation();
      next();
    } else if (event.key === "N") {
      event.preventDefault();
      event.stopPropagation();
      prev();
    }
  }

  function search(query, { scroll = false } = {}) {
    clearMarks();
    lastQuery = query;
    updateCount();
    if (!query) return;

    const lower = query.toLowerCase();
    for (const node of collectTextNodes()) {
      const text = node.textContent;
      const lowerText = text.toLowerCase();

      const positions = [];
      let idx = lowerText.indexOf(lower);
      while (idx !== -1) {
        positions.push(idx);
        idx = lowerText.indexOf(lower, idx + query.length);
      }
      if (positions.length === 0) continue;

      const parent = node.parentNode;
      if (!parent) continue;

      // Replace the text node with [text][mark][text][mark]... segments.
      const parts = [];
      let cursor = 0;
      for (const pos of positions) {
        if (pos > cursor) parts.push(document.createTextNode(text.slice(cursor, pos)));
        const span = document.createElement("span");
        span.className = "jari-find-mark";
        span.textContent = text.slice(pos, pos + query.length);
        marks.push(span);
        parts.push(span);
        cursor = pos + query.length;
      }
      if (cursor < text.length) parts.push(document.createTextNode(text.slice(cursor)));

      parent.replaceChild(parts[0], node);
      for (let i = 1; i < parts.length; i++) {
        parent.insertBefore(parts[i], parts[i - 1].nextSibling);
      }
    }

    current = marks.length ? 0 : -1;
    updateCurrent();
    updateCount();
    if (scroll && marks.length) marks[current].scrollIntoView({ block: "center" });
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function next() {
    move(1);
  }

  function prev() {
    move(-1);
  }

  function move(delta) {
    if (marks.length === 0) {
      // Find bar closed (or nothing found): re-run the last query.
      if (lastQuery) search(lastQuery, { scroll: false });
      else return;
    }
    if (marks.length === 0) return;
    current = (current + delta + marks.length) % marks.length;
    updateCurrent();
    updateCount();
    marks[current].scrollIntoView({ block: "center" });
  }

  function updateCurrent() {
    marks.forEach((mark, i) => mark.classList.toggle("jari-find-current", i === current));
  }

  function updateCount() {
    if (!countEl) return;
    if (!lastQuery) {
      countEl.textContent = "";
      countEl.classList.remove("jari-find-nomatch");
      return;
    }
    if (marks.length === 0) {
      countEl.textContent = "No matches";
      countEl.classList.add("jari-find-nomatch");
      return;
    }
    countEl.textContent = `${current + 1}/${marks.length}`;
    countEl.classList.remove("jari-find-nomatch");
  }

  function clearMarks() {
    for (const span of marks) {
      if (span.parentNode) {
        span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
      }
    }
    marks = [];
    current = -1;
    // Restoring the marks leaves adjacent text-node fragments behind
    // ("h" + "ell" + "o world"). Re-merge them so the next, longer query can
    // match across the whole text again — without this, "hello" never matches
    // after a previous search split the node, so multi-character searches
    // only ever worked for the first character typed.
    document.body.normalize();
  }

  // Escape: close the bar but keep highlights and the query, Vim-style.
  function close() {
    if (bar) {
      bar.remove();
      bar = null;
    }
    countEl = null;
    active = false;
  }

  // Full reset (e.g. Jari disabled): bar, highlights and query all gone.
  function cancel() {
    clearTimeout(searchTimer);
    close();
    clearMarks();
    lastQuery = "";
  }

  Jari.Find = { start, cancel, onKeyDown, next, prev, isActive };
})();

import { balanceCategories } from "./keymap.js";

export function sendMessage(action, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response);
      });
    } catch {
      resolve(null);
    }
  });
}

let statusStack = null;
function statusContainer() {
  if (!statusStack) {
    statusStack = document.createElement("div");
    statusStack.className = "jari-status-stack";

    (document.body || document.documentElement).appendChild(statusStack);
  }
  return statusStack;
}

let toastEl = null;
let toastTimer = null;

function toast(message) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "jari-toast";
    statusContainer().appendChild(toastEl);
  }
  toastEl.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.remove();
    toastEl = null;
  }, 1500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    withHiddenTextarea((ta) => {
      ta.value = text;
      ta.select();
      document.execCommand("copy");
    });
  }
}

function withHiddenTextarea(fn) {
  const ta = document.createElement("textarea");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  try {
    return fn(ta);
  } finally {
    ta.remove();
  }
}

let showcmdEl = null;
let flashTimer = null;

function showcmd(text) {
  if (!text) {
    if (showcmdEl) {
      showcmdEl.remove();
      showcmdEl = null;
    }
    return;
  }
  if (!showcmdEl) {
    showcmdEl = document.createElement("div");
    showcmdEl.className = "jari-showcmd";
    statusContainer().appendChild(showcmdEl);
  }
  showcmdEl.textContent = text;
}

function flash(text, ms = 600) {
  showcmd(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => showcmd(null), ms);
}

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function safeFocus(el, opts) {
  try {
    el.focus(opts);
  } catch {
    try {
      el.focus();
    } catch {}
  }
}

function dispatchClick(el) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
    } catch {}
  }
  safeFocus(el, { preventScroll: true });
}

function focusFrameElement(el) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  safeFocus(el, { preventScroll: true });
  try {
    const win = el.contentWindow;
    if (win && typeof win.focus === "function") win.focus();
  } catch {}
}

function buildCategoryTable(cat, headerClass, renderBody) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");
  headerRow.className = headerClass;
  const th = document.createElement("th");
  th.colSpan = 2;
  th.textContent = cat.label;
  headerRow.appendChild(th);
  tbody.appendChild(headerRow);
  renderBody(tbody);
  table.appendChild(tbody);
  return table;
}

function buildCategorizedGrid(
  byCategory,
  { columnCount = 3, gridClass, columnClass, headerClass, renderEntries },
) {
  const grid = document.createElement("div");
  grid.className = gridClass;
  for (const cats of balanceCategories(byCategory, columnCount)) {
    const col = document.createElement("div");
    col.className = columnClass;
    for (const cat of cats) {
      const entries = byCategory.get(cat.id);
      if (!entries || entries.length === 0) continue;
      col.appendChild(
        buildCategoryTable(cat, headerClass, (tbody) =>
          renderEntries(tbody, entries),
        ),
      );
    }
    grid.appendChild(col);
  }
  return grid;
}

export const ui = {
  toast,
  showcmd,
  flash,
  copyText,
  statusContainer,
  buildCategoryTable,
  buildCategorizedGrid,
  withHiddenTextarea,
  consume,
  safeFocus,
  dispatchClick,
  focusFrameElement,
};

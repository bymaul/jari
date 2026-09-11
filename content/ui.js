import { balanceCategories, displayCombo } from "./keymap.js";

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
    return true;
  } catch {}
  try {
    return (
      withHiddenTextarea((ta) => {
        ta.value = text;
        ta.select();
        return document.execCommand("copy");
      }) !== false
    );
  } catch {
    return false;
  }
}

function withHiddenTextarea(fn) {
  const ta = document.createElement("textarea");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  const prevFocus =
    document.activeElement && document.activeElement.isConnected
      ? document.activeElement
      : null;
  document.body.appendChild(ta);
  ta.focus();
  try {
    return fn(ta);
  } finally {
    ta.remove();
    if (prevFocus) {
      try {
        prevFocus.focus();
      } catch {}
    }
  }
}

let showcmdEl = null;
let flashTimer = null;

function showcmd(text) {
  if (!text) {
    clearTimeout(flashTimer);
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
  showcmdEl.textContent = displayCombo(text);
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

function eventView(el) {
  try {
    const doc = el.ownerDocument;
    if (doc && doc.defaultView) return doc.defaultView;
  } catch {}
  return window;
}

function pointerEvent(el, type, x, y, buttons) {
  const view = eventView(el);
  try {
    if (typeof PointerEvent === "function") {
      return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      });
    }
  } catch {}
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
  });
}

function mouseEvent(el, type, x, y, buttons) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: eventView(el),
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
  });
}

function dispatchClick(el) {
  let x = 0;
  let y = 0;
  try {
    const r = el.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) {
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
  } catch {}
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  const steps = [
    () => el.dispatchEvent(mouseEvent(el, "mouseover", x, y, 0)),
    () => el.dispatchEvent(pointerEvent(el, "pointerdown", x, y, 1)),
    () => el.dispatchEvent(mouseEvent(el, "mousedown", x, y, 1)),
    () => safeFocus(el, { preventScroll: true }),
    () => el.dispatchEvent(pointerEvent(el, "pointerup", x, y, 0)),
    () => el.dispatchEvent(mouseEvent(el, "mouseup", x, y, 0)),
    () => el.dispatchEvent(mouseEvent(el, "click", x, y, 0)),
  ];
  for (const step of steps) {
    try {
      step();
    } catch {}
  }
}

const HOVER_EVENTS = ["pointerover", "mouseover", "mouseenter", "pointerenter"];

function dispatchHover(el) {
  for (const type of HOVER_EVENTS) {
    try {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: type !== "mouseenter" && type !== "pointerenter",
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
        }),
      );
    } catch {}
  }
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

export function createShadowHost(hostClass, cssText, zIndex = "2147483646") {
  const host = document.createElement("div");
  if (hostClass) host.className = hostClass;
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "visible";
  host.style.pointerEvents = "none";
  host.style.zIndex = zIndex;
  try {
    host.attachShadow({ mode: "open" });
  } catch {
    host.shadowRoot = host;
  }
  const shadow = host.shadowRoot || host;
  try {
    const style = document.createElement("style");
    style.textContent = cssText || "";
    shadow.appendChild(style);
  } catch {}
  try {
    (document.body || document.documentElement).appendChild(host);
  } catch {}
  return { host, shadow };
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
  dispatchHover,
  focusFrameElement,
  createShadowHost,
};

import { balanceCategories, displayCombo } from "./keymap.js";
import type { Action, MessagePayload, MessageResponse } from "../shared/protocol.ts";

export function sendMessage<A extends Action>(
  action: A,
  payload: MessagePayload<A> = {} as MessagePayload<A>,
): Promise<MessageResponse<A> | null> {
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

const CAPTURE_MESSAGE_TIMEOUT_MS = 8000;

export function sendMessageWithTimeout<A extends Action>(
  action: A,
  payload: MessagePayload<A> = {} as MessagePayload<A>,
  timeoutMs = CAPTURE_MESSAGE_TIMEOUT_MS,
): Promise<MessageResponse<A> | null> {
  const cap =
    Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : CAPTURE_MESSAGE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (value) => {
      if (settled) return;
      settled = true;
      try {
        if (timer !== null) clearTimeout(timer);
      } catch {}
      resolve(value);
    };
    try {
      timer = setTimeout(() => done(null), cap);
    } catch {
      return done(null);
    }
    try {
      sendMessage(action, payload).then(done, () => done(null));
    } catch {
      done(null);
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

let toastEl: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "jari-toast";
    statusContainer().appendChild(toastEl);
  }
  toastEl.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl!.remove();
    toastEl = null;
  }, 1500);
}

async function copyText(text: string): Promise<boolean> {
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

function withHiddenTextarea(fn: (ta: HTMLTextAreaElement) => unknown) {
  const ta = document.createElement("textarea");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  const prevFocus =
    document.activeElement && document.activeElement.isConnected
      ? document.activeElement
      : null;
  document.body.appendChild(ta);
  safeFocus(ta, { preventScroll: true });
  try {
    return fn(ta);
  } finally {
    ta.remove();
    if (prevFocus) {
      try {
        safeFocus(prevFocus as HTMLElement, { preventScroll: true });
      } catch {}
    }
  }
}

let showcmdEl: HTMLDivElement | null = null;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function showcmd(text: string | null) {
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

function flash(text: string | null, ms = 600) {
  showcmd(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => showcmd(null), ms);
}

function consume(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function safeFocus(el: HTMLElement, opts: FocusOptions) {
  try {
    el.focus(opts);
  } catch {
    try {
      el.focus();
    } catch {}
  }
}

function eventView(el: Element): Window {
  try {
    const doc = el.ownerDocument;
    if (doc && doc.defaultView) return doc.defaultView;
  } catch {}
  return window;
}

function pointerEvent(el: Element, type: string, x: number, y: number, buttons: number) {
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

function mouseEvent(el: Element, type: string, x: number, y: number, buttons: number) {
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

function dispatchClick(el: Element) {
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
    () => safeFocus(el as HTMLElement, { preventScroll: true }),
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

function focusFrameElement(el: HTMLIFrameElement) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
  safeFocus(el, { preventScroll: true });
  try {
    const win = el.contentWindow;
    if (win && typeof win.focus === "function") win.focus();
  } catch {}
}

export function createShadowHost(
  hostClass: string,
  cssText: string,
  zIndex = "2147483646",
): { host: HTMLDivElement; shadow: ShadowRoot | HTMLDivElement } {
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
    (host as { shadowRoot: ShadowRoot | null }).shadowRoot =
      host as unknown as ShadowRoot;
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

const CAPTURE_HIDE_SELECTORS = [
  ".jari-hints-host",
  ".jari-find-host",
  ".jari-prompt-host",
  ".jari-palette-host",
  ".jari-help-host",
  ".jari-tab-manager-host",
  ".jari-visual-caret-host",
  ".jari-status-stack",
  ".jari-clue",
  ".jari-scroll-highlight",
  ".jari-flash",
];

export function hideOverlaysForCapture(): () => void {
  const hidden: [HTMLElement, string][] = [];
  for (const sel of CAPTURE_HIDE_SELECTORS) {
    try {
      const els = document.querySelectorAll(sel) || [];
      for (const node of els) {
        const el = node as HTMLElement;
        if (!el || !el.style) continue;
        hidden.push([el, el.style.display]);
        try {
          el.style.display = "none";
        } catch {}
      }
    } catch {
      continue;
    }
  }
  return () => {
    for (const [el, prev] of hidden) {
      try {
        if (!el.isConnected) continue;
        el.style.display = prev;
      } catch {}
    }
  };
}

function buildCategoryTable(
  cat: { label: string },
  headerClass: string,
  renderBody: (tbody: HTMLElement) => void,
): HTMLTableElement {
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

function buildCategorizedGrid<E>(
  byCategory: Map<string, E[]>,
  {
    columnCount = 3,
    gridClass,
    columnClass,
    headerClass,
    renderEntries,
  }: {
    columnCount?: number;
    gridClass: string;
    columnClass: string;
    headerClass: string;
    renderEntries: (tbody: HTMLElement, entries: E[]) => void;
  },
): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = gridClass;
  const columns = balanceCategories(byCategory, columnCount) as {
    id: string;
    label: string;
  }[][];
  for (const cats of columns) {
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
  createShadowHost,
  hideOverlaysForCapture,
};

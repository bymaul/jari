import { sendMessageWithTimeout, ui } from "./ui.js";
import { register, touch } from "./overlays.js";
import {
  normalizeRect,
  cropDataUrl,
  downloadBlob,
  waitForPaint,
  isScreenshotDataUrl,
} from "./screenshot.js";

const STEP = 16;
const SHIFT_STEP = 1;
const PENDING_G_MS = 1500;

let active = false;
let cursor = { x: 0, y: 0 };
let start = null;
let pendingCount = "";
let pendingG = false;
let pendingGTimer = null;
let cursorEl = null;
let markEl = null;
let rectEl = null;
let pillEl = null;
let finishing = false;

function isActive() {
  return active;
}

function viewport() {
  return {
    w: window.innerWidth || 0,
    h: window.innerHeight || 0,
  };
}

function showPill(text) {
  try {
    if (!pillEl) {
      pillEl = document.createElement("div");
      pillEl.className = "jari-pill";
      ui.statusContainer().appendChild(pillEl);
    }
    pillEl.textContent = text;
  } catch {}
}

function hidePill() {
  if (!pillEl) return;
  try {
    pillEl.remove();
  } catch {}
  pillEl = null;
}

function clearPendingGTimer() {
  if (pendingGTimer !== null) {
    clearTimeout(pendingGTimer);
    pendingGTimer = null;
  }
}

function styleEl(el, styles) {
  try {
    for (const [prop, value] of Object.entries(styles)) {
      el.style[prop] = value;
    }
  } catch {}
}

const BASE_EL_STYLE = {
  position: "fixed",
  pointerEvents: "none",
  zIndex: "2147483646",
};

function appendLayer(el) {
  try {
    (document.body || document.documentElement).appendChild(el);
  } catch {}
}

function makeLayer() {
  try {
    cursorEl = document.createElement("div");
    cursorEl.className = "jari-shot-cursor";
    styleEl(cursorEl, {
      ...BASE_EL_STYLE,
      width: "12px",
      height: "12px",
      border: "2px solid var(--jari-accent, #e0a363)",
      background: "rgba(var(--jari-accent-rgb, 224, 163, 99), 0.35)",
    });
    appendLayer(cursorEl);
  } catch {
    cursorEl = null;
  }
  try {
    markEl = document.createElement("div");
    markEl.className = "jari-shot-mark";
    styleEl(markEl, {
      ...BASE_EL_STYLE,
      width: "8px",
      height: "8px",
      background: "var(--jari-accent, #e0a363)",
      border: "1px solid var(--jari-accent-border, #c38a22)",
      display: "none",
    });
    appendLayer(markEl);
  } catch {
    markEl = null;
  }
  try {
    rectEl = document.createElement("div");
    rectEl.className = "jari-shot-rect";
    styleEl(rectEl, {
      ...BASE_EL_STYLE,
      border: "2px solid var(--jari-accent, #e0a363)",
      background: "rgba(var(--jari-accent-rgb, 224, 163, 99), 0.12)",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.35)",
      display: "none",
    });
    appendLayer(rectEl);
  } catch {
    rectEl = null;
  }
}

function removeLayer() {
  for (const el of [cursorEl, markEl, rectEl]) {
    if (!el) continue;
    try {
      el.remove();
    } catch {}
  }
  cursorEl = null;
  markEl = null;
  rectEl = null;
}

function paintCursor() {
  if (!cursorEl) return;
  try {
    cursorEl.style.left = `${cursor.x - 6}px`;
    cursorEl.style.top = `${cursor.y - 6}px`;
  } catch {}
}

function paintMark() {
  if (!markEl) return;
  try {
    if (!start) {
      markEl.style.display = "none";
      return;
    }
    markEl.style.display = "";
    markEl.style.left = `${start.x - 4}px`;
    markEl.style.top = `${start.y - 4}px`;
  } catch {}
}

function paintRect() {
  if (!rectEl) return;
  try {
    if (!start) {
      rectEl.style.display = "none";
      showPill("shot: mark start");
      return;
    }
    const { w, h } = viewport();
    const r = normalizeRect(start, cursor, w, h);
    // Always render the outline once a start mark exists, with a minimum
    // 2px box so a zero-area anchor stays visible instead of vanishing.
    rectEl.style.display = "";
    rectEl.style.left = `${r.left}px`;
    rectEl.style.top = `${r.top}px`;
    rectEl.style.width = `${Math.max(r.width, 2)}px`;
    rectEl.style.height = `${Math.max(r.height, 2)}px`;
    showPill(`shot: ${r.width}x${r.height}`);
  } catch {}
}

function paint() {
  paintCursor();
  paintMark();
  paintRect();
}

function open() {
  if (active) return;
  active = true;
  touch("shot");
  const { w, h } = viewport();
  cursor = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  start = null;
  pendingCount = "";
  pendingG = false;
  clearPendingGTimer();
  makeLayer();
  showPill("shot: mark start");
  paint();
}

function close() {
  if (!active) return;
  active = false;
  start = null;
  pendingCount = "";
  pendingG = false;
  clearPendingGTimer();
  removeLayer();
  hidePill();
}

function clampCursor() {
  const { w, h } = viewport();
  cursor.x = Math.max(0, Math.min(Math.max(0, w - 1), cursor.x));
  cursor.y = Math.max(0, Math.min(Math.max(0, h - 1), cursor.y));
}

function move(dx, dy, step) {
  const n = pendingCount ? parseInt(pendingCount, 10) || 1 : 1;
  pendingCount = "";
  cursor.x += dx * step * n;
  cursor.y += dy * step * n;
  clampCursor();
  paint();
}

function jumpTo(x, y) {
  pendingCount = "";
  pendingG = false;
  clearPendingGTimer();
  if (x !== null) cursor.x = x;
  if (y !== null) cursor.y = y;
  clampCursor();
  paint();
}

async function finish() {
  if (finishing) return;
  finishing = true;
  try {
    const { w, h } = viewport();
    const rect = normalizeRect(start, cursor, w, h);
    close();
    if (
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width < 2 ||
      rect.height < 2
    ) {
      ui.toast("Empty region");
      return;
    }
    await waitForPaint();
    const res = await sendMessageWithTimeout("captureScreenshot");
    if (!res || !res.ok || !isScreenshotDataUrl(res.dataUrl)) {
      ui.toast("Screenshot failed");
      return;
    }
    const blob = await cropDataUrl(res.dataUrl, rect);
    if (!blob) {
      ui.toast("Screenshot failed");
      return;
    }
    ui.toast(downloadBlob(blob) ? "Saved screenshot" : "Screenshot failed");
  } finally {
    finishing = false;
  }
}

function armPendingG() {
  pendingG = true;
  clearPendingGTimer();
  try {
    pendingGTimer = setTimeout(() => {
      pendingGTimer = null;
      pendingG = false;
    }, PENDING_G_MS);
  } catch {}
}

function onKeyDown(event) {
  if (!active) return false;
  const key = event.key;
  if (key === "Escape") {
    ui.consume(event);
    if (start || pendingCount || pendingG) {
      start = null;
      pendingCount = "";
      pendingG = false;
      clearPendingGTimer();
      paint();
    } else {
      close();
    }
    return true;
  }
  if (key === "g" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    ui.consume(event);
    if (pendingG) {
      jumpTo(null, 0);
    } else {
      armPendingG();
    }
    return true;
  }
  pendingG = false;
  clearPendingGTimer();
  if (key === "0" && pendingCount === "") {
    ui.consume(event);
    jumpTo(0, null);
    return true;
  }
  if (/^[0-9]$/.test(key)) {
    ui.consume(event);
    if (pendingCount.length < 9) pendingCount += key;
    return true;
  }
  if (key === "Enter") {
    ui.consume(event);
    if (!start) {
      start = { ...cursor };
      paint();
    } else {
      finish();
    }
    return true;
  }
  if (key === "Backspace") {
    ui.consume(event);
    start = null;
    pendingCount = "";
    paint();
    return true;
  }
  if (key === "$") {
    ui.consume(event);
    const { w } = viewport();
    jumpTo(Math.max(0, w - 1), null);
    return true;
  }
  if (key === "G") {
    ui.consume(event);
    const { h } = viewport();
    jumpTo(null, Math.max(0, h - 1));
    return true;
  }
  if (key === "M") {
    ui.consume(event);
    const { w, h } = viewport();
    jumpTo(Math.floor(w / 2), Math.floor(h / 2));
    return true;
  }
  const big = key === "H" || key === "J" || key === "K" || key === "L";
  const dirs = {
    h: [-1, 0],
    j: [0, 1],
    k: [0, -1],
    l: [1, 0],
    H: [-1, 0],
    J: [0, 1],
    K: [0, -1],
    L: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
    ArrowRight: [1, 0],
  };
  if (key in dirs) {
    ui.consume(event);
    const [dx, dy] = dirs[key];
    const step =
      big || (key.startsWith("Arrow") && event.shiftKey) ? SHIFT_STEP : STEP;
    move(dx, dy, step);
    return true;
  }
  ui.consume(event);
  return true;
}

export const Shot = {
  open,
  close,
  onKeyDown,
  isActive,
};

register("shot", { close, onKeyDown, isActive });

export const __shotTest = {
  state() {
    return {
      active,
      cursor: { ...cursor },
      start: start ? { ...start } : null,
      finishing,
    };
  },
};

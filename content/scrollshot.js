/* global Image */

import { sendMessage, ui } from "./ui.js";
import { queryAll } from "./keymap.js";
import {
  isScreenshotable,
  downloadBlob,
  waitForPaint,
  waitForMediaReady,
  computeSlices,
} from "./screenshot.js";

const SETTLE_MS = 120;

function computedPosition(el) {
  try {
    const view =
      (el.ownerDocument && el.ownerDocument.defaultView) || window;
    return view.getComputedStyle(el).position;
  } catch {
    return "";
  }
}

function collectFrameDocs() {
  const docs = [];
  try {
    const frames = document.querySelectorAll("iframe, frame") || [];
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument;
        if (doc) docs.push(doc);
      } catch {}
    }
  } catch {}
  return docs;
}

export function hideFixedElements(seen = new Set()) {
  const hidden = [];
  const hideIn = (els) => {
    for (const el of els || []) {
      if (seen.has(el)) continue;
      let pos;
      try {
        pos = computedPosition(el);
      } catch {
        continue;
      }
      if (pos !== "fixed" && pos !== "sticky") continue;
      if (!el.style) continue;
      seen.add(el);
      hidden.push([el, el.style.visibility]);
      try {
        el.style.visibility = "hidden";
      } catch {}
    }
  };
  // queryAll descends into shadow roots, so fixed widgets rendered in
  // shadow DOM (cookie banners, chat bubbles, players) are covered too.
  try {
    hideIn(queryAll("*"));
  } catch {}
  for (const doc of collectFrameDocs()) {
    try {
      hideIn(doc.querySelectorAll("*"));
    } catch {}
  }
  return () => {
    for (const [el, prev] of hidden) {
      try {
        if (!el.isConnected) continue;
        el.style.visibility = prev;
      } catch {}
    }
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

function scrollTo(x, y) {
  try {
    window.scrollTo(x, y);
  } catch {}
}

export async function captureFullPage({ settleMs = SETTLE_MS } = {}) {
  if (!isScreenshotable()) {
    ui.toast("Cannot screenshot this page");
    return;
  }
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  if (!(vw > 0 && vh > 0)) {
    ui.toast("Screenshot failed");
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const scroller = document.scrollingElement || document.documentElement;
  const totalH =
    scroller && Number.isFinite(scroller.scrollHeight)
      ? scroller.scrollHeight
      : vh;
  const { slices, truncated } = computeSlices(totalH, vh);
  const restoreOverlays = ui.hideOverlaysForCapture();
  const seenFixed = new Set();
  const fixedRestores = [hideFixedElements(seenFixed)];
  const rootEl = document.documentElement;
  let prevBehavior;
  try {
    prevBehavior = rootEl && rootEl.style ? rootEl.style.scrollBehavior : undefined;
    if (rootEl && rootEl.style) rootEl.style.scrollBehavior = "auto";
  } catch {}
  const startX = window.scrollX || 0;
  const startY = window.scrollY || 0;
  try {
    scrollTo(0, 0);
    await waitForPaint();
    const canvas = document.createElement("canvas");
    const capH = Math.min(totalH, slices.length * vh);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.max(1, Math.round(capH * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      ui.toast("Screenshot failed");
      return;
    }
    for (const y of slices) {
      scrollTo(0, y);
      await waitForPaint();
      await waitForMediaReady({ timeoutMs: settleMs });
      // Pages like Google toggle fixed/sticky headers on scroll, so
      // re-sweep before every slice instead of only once up front.
      try {
        fixedRestores.push(hideFixedElements(seenFixed));
      } catch {}
      let actualY = y;
      try {
        actualY = window.scrollY || 0;
      } catch {}
      const res = await sendMessage("captureScreenshot");
      if (!res || !res.ok || !res.dataUrl) {
        ui.toast("Screenshot failed");
        return;
      }
      const img = await loadImage(res.dataUrl);
      if (!img) {
        ui.toast("Screenshot failed");
        return;
      }
      try {
        ctx.drawImage(img, 0, Math.round(actualY * dpr));
      } catch {
        ui.toast("Screenshot failed");
        return;
      }
    }
    const blob = await new Promise((resolve) => {
      try {
        if (typeof canvas.toBlob === "function") {
          canvas.toBlob((b) => resolve(b || null));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
    if (!blob) {
      ui.toast("Screenshot failed");
      return;
    }
    const ok = downloadBlob(blob);
    if (!ok) ui.toast("Screenshot failed");
    else if (truncated) ui.toast("Saved partial screenshot");
    else ui.toast("Saved screenshot");
  } finally {
    scrollTo(startX, startY);
    try {
      if (rootEl && rootEl.style) rootEl.style.scrollBehavior = prevBehavior;
    } catch {}
    for (const restore of fixedRestores.splice(0).reverse()) {
      try {
        restore();
      } catch {}
    }
    try {
      restoreOverlays();
    } catch {}
  }
}

/* global Image */

import { sendMessageWithTimeout, ui } from "./ui.js";
import { queryAll } from "./keymap.js";
import {
  isScreenshotable,
  isScreenshotDataUrl,
  downloadBlob,
  waitForPaint,
  waitForMediaReady,
  computeSlices,
} from "./screenshot.js";

const SETTLE_MS = 120;
const IMAGE_LOAD_TIMEOUT_MS = 5000;
const BLOB_TIMEOUT_MS = 5000;
const MAX_CAPTURE_SIDE = 8000;
const MAX_CAPTURE_PIXELS = 16000000;

let capturing = false;

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

function loadImage(src, { timeoutMs = IMAGE_LOAD_TIMEOUT_MS } = {}) {
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
      if (typeof src !== "string" || !src.startsWith("data:image/")) {
        return done(null);
      }
      const cap =
        Number.isFinite(timeoutMs) && timeoutMs >= 0
          ? timeoutMs
          : IMAGE_LOAD_TIMEOUT_MS;
      const img = new Image();
      img.onload = () => {
        const out = img;
        img.onload = null;
        img.onerror = null;
        done(out);
      };
      img.onerror = () => {
        img.onload = null;
        img.onerror = null;
        try {
          img.src = "";
        } catch {}
        done(null);
      };
      try {
        timer = setTimeout(() => {
          img.onload = null;
          img.onerror = null;
          try {
            img.src = "";
          } catch {}
          done(null);
        }, cap);
      } catch {}
      img.src = src;
    } catch {
      done(null);
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
  if (capturing) {
    ui.toast("Already capturing");
    return;
  }
  capturing = true;
  try {
    const vw = Number.isFinite(window.innerWidth) ? window.innerWidth : 0;
    const vh = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
    if (!(vw > 0 && vh > 0)) {
      ui.toast("Screenshot failed");
      return;
    }
    const rawDpr =
      typeof window !== "undefined" ? window.devicePixelRatio : undefined;
    const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
    const scroller = document.scrollingElement || document.documentElement;
    const totalH =
      scroller && Number.isFinite(scroller.scrollHeight)
        ? scroller.scrollHeight
        : vh;
    const { slices, truncated } = computeSlices(totalH, vh);
    const canvasWidth = Math.round(vw * dpr);
    const captureHeight = Math.min(totalH, slices.length * vh);
    const canvasHeight = Math.max(1, Math.round(captureHeight * dpr));
    if (
      !(canvasWidth >= 1 && canvasHeight >= 1) ||
      canvasWidth > MAX_CAPTURE_SIDE ||
      canvasHeight > MAX_CAPTURE_SIDE ||
      canvasWidth * canvasHeight > MAX_CAPTURE_PIXELS
    ) {
      ui.toast("Screenshot too large");
      return;
    }
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
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        ui.toast("Screenshot failed");
        return;
      }
      let prevActualY = null;
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
        if (
          prevActualY !== null &&
          y !== prevActualY &&
          actualY === prevActualY
        ) {
          ui.toast("Screenshot failed");
          return;
        }
        prevActualY = actualY;
        const res = await sendMessageWithTimeout("captureScreenshot");
        if (!res || !res.ok || !isScreenshotDataUrl(res.dataUrl)) {
          ui.toast("Screenshot failed");
          return;
        }
        const img = await loadImage(res.dataUrl);
        if (!img) {
          ui.toast("Screenshot failed");
          return;
        }
        try {
          const destY = Math.round(actualY * dpr);
          let naturalW;
          let naturalH;
          try {
            naturalW = img.naturalWidth;
            naturalH = img.naturalHeight;
          } catch {
            naturalW = undefined;
            naturalH = undefined;
          }
          const expectedH = Math.round(vh * dpr);
          if (
            Number.isFinite(naturalW) &&
            naturalW > 0 &&
            Number.isFinite(naturalH) &&
            naturalH > 0 &&
            (naturalW !== canvasWidth || naturalH !== expectedH)
          ) {
            const scale = canvasWidth / naturalW;
            const destH = Math.max(1, Math.round(naturalH * scale));
            ctx.drawImage(img, 0, 0, naturalW, naturalH, 0, destY, canvasWidth, destH);
          } else {
            ctx.drawImage(img, 0, destY);
          }
        } catch {
          ui.toast("Screenshot failed");
          return;
        } finally {
          try {
            img.src = "";
          } catch {}
        }
      }
      const blob = await new Promise((resolve) => {
        let timer = null;
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          try {
            if (timer !== null) clearTimeout(timer);
          } catch {}
          resolve(value);
        };
        try {
          timer = setTimeout(() => done(null), BLOB_TIMEOUT_MS);
        } catch {}
        try {
          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((b) => done(b || null));
          } else {
            done(null);
          }
        } catch {
          done(null);
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
      if (rootEl && rootEl.style) {
        if (
          (prevBehavior === undefined ||
            prevBehavior === null ||
            prevBehavior === "") &&
          typeof rootEl.style.removeProperty === "function"
        ) {
          rootEl.style.removeProperty("scroll-behavior");
        } else {
          rootEl.style.scrollBehavior = prevBehavior;
        }
      }
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
  } finally {
    capturing = false;
  }
}

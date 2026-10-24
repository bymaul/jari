/* global Image */

import { sendMessageWithTimeout, ui } from "./ui.ts";
import { queryAll } from "./keymap.ts";
import {
  isScreenshotable,
  isScreenshotDataUrl,
  downloadBlob,
  waitForPaint,
  waitForMediaReady,
  computeSlices,
} from "./screenshot.ts";

const SETTLE_MS = 120;
const IMAGE_LOAD_TIMEOUT_MS = 5000;
const BLOB_TIMEOUT_MS = 5000;
const MAX_CAPTURE_SIDE = 8000;
const MAX_CAPTURE_PIXELS = 16000000;

let capturing = false;

function computedPosition(el: Element): string {
  try {
    const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    return view.getComputedStyle(el).position;
  } catch {
    return "";
  }
}

function collectFrameDocs(): Document[] {
  const docs: Document[] = [];
  try {
    const frames = document.querySelectorAll("iframe, frame") || [];
    for (const frame of frames) {
      try {
        const doc = (frame as HTMLIFrameElement).contentDocument;
        if (doc) docs.push(doc);
      } catch {}
    }
  } catch {}
  return docs;
}

export function hideFixedElements(seen: Set<Element> = new Set()): () => void {
  const hidden: [Element, string][] = [];
  const hideIn = (els: Element[] | NodeListOf<Element>): void => {
    for (const el of els || []) {
      if (seen.has(el)) continue;
      let pos: string;
      try {
        pos = computedPosition(el);
      } catch {
        continue;
      }
      if (pos !== "fixed" && pos !== "sticky") continue;
      if (!(el as HTMLElement).style) continue;
      seen.add(el);
      hidden.push([el, (el as HTMLElement).style.visibility]);
      try {
        (el as HTMLElement).style.visibility = "hidden";
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
        (el as HTMLElement).style.visibility = prev;
      } catch {}
    }
  };
}

function loadImage(
  src: string,
  { timeoutMs = IMAGE_LOAD_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (value: HTMLImageElement | null): void => {
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

function scrollTo(x: number, y: number): void {
  try {
    window.scrollTo(x, y);
  } catch {}
}

export async function captureFullPage({
  settleMs = SETTLE_MS,
}: { settleMs?: number } = {}): Promise<void> {
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
    const dpr = (
      Number.isFinite(rawDpr) && (rawDpr as number) > 0 ? rawDpr : 1
    ) as number;
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
    const seenFixed = new Set<Element>();
    const fixedRestores = [hideFixedElements(seenFixed)];
    const rootEl = document.documentElement;
    let prevBehavior: string | null | undefined;
    try {
      prevBehavior =
        rootEl && rootEl.style ? rootEl.style.scrollBehavior : undefined;
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
          let naturalW: number | undefined;
          let naturalH: number | undefined;
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
            (naturalW as number) > 0 &&
            Number.isFinite(naturalH) &&
            (naturalH as number) > 0 &&
            (naturalW !== canvasWidth || naturalH !== expectedH)
          ) {
            const scale = canvasWidth / (naturalW as number);
            const destH = Math.max(1, Math.round((naturalH as number) * scale));
            ctx.drawImage(
              img,
              0,
              0,
              naturalW as number,
              naturalH as number,
              0,
              destY,
              canvasWidth,
              destH,
            );
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
      const blob = await new Promise<Blob | null>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;
        const done = (value: Blob | null): void => {
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
            rootEl.style.scrollBehavior = prevBehavior as string;
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

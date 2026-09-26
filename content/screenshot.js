/* global Image */

const UNSCREENSHOTABLE_PROTOCOLS = /^(chrome|edge|about|view-source|chrome-extension|moz-extension|opera|brave|javascript|data):/i;

export function isScreenshotable() {
  try {
    return !UNSCREENSHOTABLE_PROTOCOLS.test(location.protocol || "");
  } catch {
    return true;
  }
}

export function sanitizeHostForFilename(host) {
  const s = String(host || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40);
}

export function screenshotFilename(date = new Date(), host = "") {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const h = sanitizeHostForFilename(host);
  return h ? `jari-${h}-${stamp}.png` : `jari-${stamp}.png`;
}

function pageHost() {
  try {
    return location.hostname || "";
  } catch {
    return "";
  }
}

export function pageScreenshotFilename(date = new Date()) {
  return screenshotFilename(date, pageHost());
}

export function downloadUrl(url, filename = pageScreenshotFilename()) {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

export async function waitForPaint() {
  try {
    await new Promise((resolve) => {
      try {
        if (typeof requestAnimationFrame !== "function") return resolve();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      } catch {
        resolve();
      }
    });
  } catch {}
}

export function downloadBlob(blob, filename = pageScreenshotFilename()) {
  let url;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    return false;
  }
  if (!url) return false;
  const ok = downloadUrl(url, filename);
  try {
    URL.revokeObjectURL(url);
  } catch {}
  return ok;
}

export async function waitForMediaReady({ timeoutMs = 1500 } = {}) {
  const cap = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 1500;
  const deadline = Date.now() + cap;
  try {
    const fontsReady =
      document.fonts && typeof document.fonts.ready?.then === "function"
        ? document.fonts.ready
        : null;
    if (fontsReady) {
      await Promise.race([
        fontsReady,
        new Promise((r) => setTimeout(r, cap)),
      ]);
    }
  } catch {}
  for (;;) {
    let pending = false;
    try {
      const vh = window.innerHeight || 0;
      const imgs = document.images ? [...document.images] : [];
      for (const img of imgs) {
        try {
          if (img.complete) continue;
        } catch {
          continue;
        }
        let rect = null;
        try {
          rect = img.getBoundingClientRect();
        } catch {
          continue;
        }
        if (!rect || rect.bottom < 0 || rect.top > vh) continue;
        pending = true;
        break;
      }
    } catch {}
    if (!pending) return;
    if (Date.now() >= deadline) return;
    try {
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return;
    }
  }
}

export function computeSlices(totalH, vh, maxSlices = 8, maxH = 8000) {
  const h = Math.max(0, Math.min(totalH || 0, maxH));
  const step = Math.max(1, vh || 1);
  const cap = Math.max(1, maxSlices || 1);
  const slices = [];
  let y = 0;
  while (y < h && slices.length < cap) {
    slices.push(y);
    y += step;
  }
  if (slices.length === 0) slices.push(0);
  return { slices, truncated: (totalH || 0) > h };
}

export function normalizeRect(a, b, vw, vh) {
  const left = Math.max(0, Math.min(a.x, b.x));
  const top = Math.max(0, Math.min(a.y, b.y));
  const right = Math.min(vw, Math.max(a.x, b.x));
  const bottom = Math.min(vh, Math.max(a.y, b.y));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function scaleRect(rect, dpr) {
  const s = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    x: Math.round(rect.left * s),
    y: Math.round(rect.top * s),
    w: Math.max(1, Math.round(rect.width * s)),
    h: Math.max(1, Math.round(rect.height * s)),
  };
}

export function cropDataUrl(dataUrl, rect) {
  return new Promise((resolve) => {
    try {
      const dpr =
        (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const src = scaleRect(rect, dpr);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = src.w;
          canvas.height = src.h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((blob) => resolve(blob || null));
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

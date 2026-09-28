/* global Image */

const UNSCREENSHOTABLE_PROTOCOLS = /^(chrome|edge|about|view-source|chrome-extension|moz-extension|opera|brave|javascript|data):/i;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const IMAGE_LOAD_TIMEOUT_MS = 5000;
const PAINT_TIMEOUT_MS = 500;
const MAX_CANVAS_SIDE = 8000;
const MAX_CANVAS_PIXELS = 16000000;
const FILENAME_PATTERN = /^jari-[a-z0-9-]{0,64}\.png$/;

export function isScreenshotable() {
  try {
    return !UNSCREENSHOTABLE_PROTOCOLS.test(location.protocol || "");
  } catch {
    return false;
  }
}

export function isScreenshotDataUrl(value) {
  return typeof value === "string" && value.startsWith(PNG_DATA_URL_PREFIX);
}

export function sanitizeHostForFilename(host) {
  const s = String(host || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 40);
}

export function screenshotFilename(date = new Date(), host = "") {
  const d =
    date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
  if (
    typeof url !== "string" ||
    (!url.startsWith("blob:") && !url.startsWith("data:image/"))
  ) {
    return false;
  }
  const name =
    typeof filename === "string" && FILENAME_PATTERN.test(filename)
      ? filename
      : pageScreenshotFilename();
  let a = null;
  try {
    a = document.createElement("a");
    a.href = url;
    a.download = name;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (a) a.remove();
    } catch {}
  }
}

export async function waitForPaint({ timeoutMs = PAINT_TIMEOUT_MS } = {}) {
  const cap =
    Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : PAINT_TIMEOUT_MS;
  try {
    await new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          if (timer !== null) clearTimeout(timer);
        } catch {}
        resolve();
      };
      try {
        if (typeof requestAnimationFrame !== "function") return finish();
        try {
          timer = setTimeout(finish, cap);
        } catch {}
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } catch {
        finish();
      }
    });
  } catch {}
}

export function downloadBlob(blob, filename = pageScreenshotFilename()) {
  if (!blob || typeof blob !== "object") return false;
  let url;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    return false;
  }
  if (!url) return false;
  const ok = downloadUrl(url, filename);
  try {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }, 5000);
  } catch {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
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
      const vh = Number.isFinite(window.innerHeight)
        ? window.innerHeight
        : 0;
      const imgs = document.images || [];
      const count = Math.min(imgs.length || 0, 500);
      for (let i = 0; i < count; i++) {
        const img = imgs[i];
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
  const total = Number.isFinite(totalH) && totalH > 0 ? totalH : 0;
  const limit =
    Number.isFinite(maxH) && maxH > 0 ? Math.min(maxH, 8000) : 8000;
  const step = Number.isFinite(vh) && vh > 0 ? vh : 1;
  const cap =
    Number.isFinite(maxSlices) && maxSlices > 0
      ? Math.min(Math.floor(maxSlices), 8)
      : 8;
  const h = Math.max(0, Math.min(total, limit));
  const slices = [];
  let y = 0;
  while (y < h && slices.length < cap) {
    slices.push(y);
    y += step;
  }
  if (slices.length === 0) slices.push(0);
  return { slices, truncated: total > h };
}

const ZERO_RECT = { left: 0, top: 0, width: 0, height: 0 };

export function normalizeRect(a, b, vw, vh) {
  const coords = [
    a ? a.x : NaN,
    a ? a.y : NaN,
    b ? b.x : NaN,
    b ? b.y : NaN,
    vw,
    vh,
  ].map(Number);
  if (!coords.every(Number.isFinite)) return { ...ZERO_RECT };
  const [ax, ay, bx, by, w, hh] = coords;
  const left = Math.max(0, Math.min(ax, bx));
  const top = Math.max(0, Math.min(ay, by));
  const right = Math.min(w, Math.max(ax, bx));
  const bottom = Math.min(hh, Math.max(ay, by));
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function scaleRect(rect, dpr) {
  const s = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const parts = rect
    ? [rect.left, rect.top, rect.width, rect.height].map(Number)
    : [NaN, NaN, NaN, NaN];
  if (!parts.every(Number.isFinite)) return { x: 0, y: 0, w: 1, h: 1 };
  const [left, top, width, height] = parts;
  return {
    x: Math.round(left * s),
    y: Math.round(top * s),
    w: Math.max(1, Math.round(width * s)),
    h: Math.max(1, Math.round(height * s)),
  };
}

export function cropDataUrl(dataUrl, rect, { timeoutMs = IMAGE_LOAD_TIMEOUT_MS } = {}) {
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
      if (!isScreenshotDataUrl(dataUrl)) return done(null);
      const w = rect ? Number(rect.width) : NaN;
      const h = rect ? Number(rect.height) : NaN;
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w <= 0 ||
        h <= 0 ||
        w > MAX_CANVAS_SIDE ||
        h > MAX_CANVAS_SIDE
      ) {
        return done(null);
      }
      const dpr =
        (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      const src = scaleRect(rect, dpr);
      if (
        src.w > MAX_CANVAS_SIDE ||
        src.h > MAX_CANVAS_SIDE ||
        src.w * src.h > MAX_CANVAS_PIXELS
      ) {
        return done(null);
      }
      const cap =
        Number.isFinite(timeoutMs) && timeoutMs >= 0
          ? timeoutMs
          : IMAGE_LOAD_TIMEOUT_MS;
      const img = new Image();
      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
        try {
          img.src = "";
        } catch {}
      };
      img.onload = () => {
        try {
          let naturalW;
          let naturalH;
          try {
            naturalW = img.naturalWidth;
            naturalH = img.naturalHeight;
          } catch {
            naturalW = undefined;
            naturalH = undefined;
          }
          let sx = src.x;
          let sy = src.y;
          let sw = src.w;
          let sh = src.h;
          if (
            Number.isFinite(naturalW) &&
            naturalW > 0 &&
            Number.isFinite(naturalH) &&
            naturalH > 0
          ) {
            sx = Math.min(Math.max(0, src.x), Math.max(0, naturalW - 1));
            sy = Math.min(Math.max(0, src.y), Math.max(0, naturalH - 1));
            sw = Math.min(sw, Math.max(1, naturalW - sx));
            sh = Math.min(sh, Math.max(1, naturalH - sy));
          }
          const canvas = document.createElement("canvas");
          canvas.width = sw;
          canvas.height = sh;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            cleanup();
            return done(null);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((blob) => {
              cleanup();
              done(blob || null);
            });
          } else {
            cleanup();
            done(null);
          }
        } catch {
          try {
            img.onload = null;
            img.onerror = null;
          } catch {}
          done(null);
        }
      };
      img.onerror = () => {
        try {
          img.onload = null;
          img.onerror = null;
        } catch {}
        done(null);
      };
      try {
        timer = setTimeout(done, cap, null);
      } catch {}
      img.src = dataUrl;
    } catch {
      done(null);
    }
  });
}

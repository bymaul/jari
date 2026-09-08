import { settings } from "./settings.js";
import { HINT_CHARSET_DEFAULT, HINT_FONT_SIZE_DEFAULT, HINT_FONT_SIZE_MAX, HINT_FONT_SIZE_MIN } from "./keymap.js";
import { getHintRect, getRealRect } from "./hints-elements.js";

export function normalizeCharset() {
  const s = settings.getHintChars();
  if (!s) return HINT_CHARSET_DEFAULT;
  return s.toLowerCase();
}

export function genLabels(count, charset) {
  const chars = (charset || normalizeCharset()).toUpperCase().split("");
  if (count <= 0 || chars.length < 2) return [];
  if (count <= chars.length) return chars.slice(0, count);

  // BFS drain: consumed prefixes are removed via `head`, so no label
  // is ever a prefix of another (exact match always auto-activates).
  const labels = chars.slice();
  let head = 0;
  while (labels.length - head < count) {
    if (head >= labels.length) break;
    const p = labels[head++];
    for (const c of chars) {
      labels.push(p + c);
      if (labels.length - head >= count) break;
      if (labels.length > 10000) break;
    }
    if (labels.length > 10000) break;
  }
  return labels.slice(head, head + count);
}

export function getZIndex(node) {
  let z = 0;
  try {
    do {
      const v = parseInt(
        window.getComputedStyle(node).getPropertyValue("z-index"),
      );
      if (!isNaN(v) && v >= 0) z += v;
      node = node.parentNode;
    } while (
      node &&
      node !== document.body &&
      node !== document &&
      node.nodeType !== 11
    );
  } catch {}
  return z;
}

export function placeHintsHost(host) {
  try {
    const topLayer = document.querySelector("dialog[open]");
    if (topLayer) {
      const r = topLayer.getBoundingClientRect();
      const style = window.getComputedStyle(topLayer);
      if (
        r.width > 0 &&
        r.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      ) {
        topLayer.appendChild(host);
        return;
      }
    }
  } catch {}
  (document.documentElement || document.body).appendChild(host);
}

export function coordinate(holderEl) {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.textContent = "A";
  holderEl.prepend(probe);
  const br = probe.getBoundingClientRect();
  const ret = {
    top: br.top + window.pageYOffset - document.documentElement.clientTop,
    left: br.left + window.pageXOffset - document.documentElement.clientLeft,
  };
  try {
    probe.remove();
  } catch {}
  return ret;
}

export function updateHintText(hintEl, label, typed) {
  hintEl.textContent = "";
  if (!typed) {
    hintEl.textContent = label;
    return;
  }
  if (label.startsWith(typed)) {
    const pre = document.createElement("span");
    pre.className = "jari-hint-matched";
    pre.textContent = typed;
    const rest = document.createElement("span");
    rest.textContent = label.slice(typed.length);
    hintEl.append(pre, rest);
    hintEl.classList.remove("jari-hint-hidden");
  } else {
    hintEl.textContent = label;
  }
}

const HINT_THEMES = {
  yellow: {
    border: "#c38a22",
    background: "linear-gradient(#fff785, #ffc542)",
    color: "#1a1a1a",
    matched: "#6a6a6a",
  },
  cyan: {
    border: "#1a7f8f",
    background: "linear-gradient(#b0f2ff, #00b4d8)",
    color: "#0a2e3a",
    matched: "#3a6a7a",
  },
  dark: {
    border: "#e0a363",
    background: "linear-gradient(#2b2b38, #1c1c24)",
    color: "#f5f0e6",
    matched: "#8a8a99",
  },
};

function hintFontSize(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return HINT_FONT_SIZE_DEFAULT;
  return Math.min(HINT_FONT_SIZE_MAX, Math.max(HINT_FONT_SIZE_MIN, Math.round(n)));
}

function hintCss(theme, fontSize) {
  const t = HINT_THEMES[theme] || HINT_THEMES.yellow;
  const size = hintFontSize(fontSize);
  return `
    .jari-hints { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .jari-hint {
      position: absolute;
      display: inline-block;
      box-sizing: border-box;
      font-family: monospace !important;
      font-size: ${size}px !important;
      font-weight: bold !important;
      line-height: 1 !important;
      letter-spacing: 0.02em !important;
      padding: 1px 3px;
      border: 1px solid ${t.border};
      border-radius: 3px;
      background: ${t.background};
      color: ${t.color};
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      text-align: left;
    }
    .jari-hint-matched { color: ${t.matched}; opacity: 0.45; }
    .jari-hint-hidden { opacity: 0; display: none; }
  `;
}

export function createHintsHost(theme = "yellow", fontSize = HINT_FONT_SIZE_DEFAULT) {
  const host = document.createElement("div");
  host.className = "jari-hints-host";
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "visible";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483647";
  try {
    host.attachShadow({ mode: "open" });
  } catch {
    host.shadowRoot = host;
  }

  const shadow = host.shadowRoot;
  const style = document.createElement("style");
  style.textContent = hintCss(theme, fontSize);
  shadow.appendChild(style);
  const holder = document.createElement("section");
  holder.className = "jari-hints";
  holder.style.display = "block";
  holder.style.opacity = "1";
  shadow.appendChild(holder);
  placeHintsHost(host);
  return { host, holder };
}

function estimateLabelBox(label, fontSize) {
  const size = hintFontSize(fontSize);
  return {
    w: Math.ceil(String(label).length * size * 0.62 + 10),
    h: Math.ceil(size + 8),
  };
}

function boxesOverlap(a, b) {
  return (
    a.left < b.left + b.w &&
    b.left < a.left + a.w &&
    a.top < b.top + b.h &&
    b.top < a.top + a.h
  );
}

const LABEL_SHIFTS = [
  [0, 0],
  [12, 0],
  [0, 18],
  [12, 18],
  [-12, 0],
  [0, 36],
];

function resolveLabelBox(home, w, h, placed) {
  for (const [dx, dy] of LABEL_SHIFTS) {
    const box = {
      left: Math.max(0, home.left + dx),
      top: Math.max(0, home.top + dy),
      w,
      h,
    };
    let hit = false;
    for (const p of placed) {
      if (boxesOverlap(box, p)) {
        hit = true;
        break;
      }
    }
    if (!hit) return box;
  }
  return { left: Math.max(0, home.left), top: Math.max(0, home.top), w, h };
}

export function layoutHints(holder, elements, labels, fontSize = HINT_FONT_SIZE_DEFAULT) {
  const bof = (() => {
    try {
      return coordinate(holder);
    } catch {
      return { top: 0, left: 0 };
    }
  })();

  // Estimated boxes are close enough for de-collision (monospace labels);
  // the measured second pass below corrects any residual overlap.
  const placed = [];
  const links = elements.map((elm, i) => {
    const r = getHintRect(elm);
    const z = getZIndex(elm);
    const home = {
      left: window.pageXOffset + r.left - bof.left,
      top: Math.max(r.top + window.pageYOffset - bof.top, 0),
    };
    const est = estimateLabelBox(labels[i], fontSize);
    const box = resolveLabelBox(home, est.w, est.h, placed);
    placed.push(box);
    const link = document.createElement("div");
    link.className = "jari-hint";
    link.textContent = labels[i];
    link.dataset.label = labels[i];
    link.style.left = `${box.left}px`;
    link.style.top = `${box.top}px`;
    link.style.zIndex = String(z + 9999);
    link.zIndex = link.style.zIndex;
    link.label = labels[i];
    link.link = elm;
    link.targetEl = elm;
    updateHintText(link, labels[i], "");
    return link;
  });

  links.forEach((link) => holder.appendChild(link));

  if (links.length > 0) {
    let bcr = getRealRect(links[0]);
    for (let i = 1; i < links.length; i++) {
      const h = links[i];
      const tcr = getRealRect(h);
      if (tcr.top === bcr.top && Math.abs(tcr.left - bcr.left) < bcr.width) {
        h.style.top = `${h.offsetTop + h.offsetHeight}px`;
      }
      bcr = getRealRect(h);
    }
  }

  return links;
}

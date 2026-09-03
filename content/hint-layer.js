import { settings } from "./settings.js";
import { HINT_CHARSET_DEFAULT } from "./keymap.js";
import { getRealRect } from "./hints-elements.js";

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
};

function hintCss(theme) {
  const t = HINT_THEMES[theme] || HINT_THEMES.yellow;
  return `
    .jari-hints { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .jari-hint {
      position: absolute;
      display: inline-block;
      box-sizing: border-box;
      font-family: monospace;
      font-size: 10px;
      font-weight: bold;
      line-height: 1;
      letter-spacing: 0.02em;
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

export function createHintsHost(theme = "yellow") {
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
  style.textContent = hintCss(theme);
  shadow.appendChild(style);
  const holder = document.createElement("section");
  holder.className = "jari-hints";
  holder.style.display = "block";
  holder.style.opacity = "1";
  shadow.appendChild(holder);
  placeHintsHost(host);
  return { host, holder };
}

export function layoutHints(holder, elements, labels) {
  const bof = (() => {
    try {
      return coordinate(holder);
    } catch {
      return { top: 0, left: 0 };
    }
  })();

  let lastTop = -1;
  let lastLeft = -1;
  const links = elements.map((elm, i) => {
    const r = getRealRect(elm);
    const z = getZIndex(elm);
    const left = window.pageXOffset + r.left - bof.left;
    const link = document.createElement("div");
    link.className = "jari-hint";
    link.textContent = labels[i];
    link.dataset.label = labels[i];
    let lTop = Math.max(r.top + window.pageYOffset - bof.top, 0);
    if (lTop === lastTop && Math.abs(left - lastLeft) < 20) {
      link.style.left = `${left + 20 - Math.abs(left - lastLeft)}px`;
    } else if (left === lastLeft && Math.abs(lTop - lastTop) < 20) {
      lTop += 20 - Math.abs(lTop - lastTop);
      link.style.left = `${left}px`;
    } else {
      link.style.left = `${left}px`;
    }
    link.style.top = `${lTop}px`;
    link.style.zIndex = String(z + 9999);
    link.zIndex = link.style.zIndex;
    link.label = labels[i];
    link.link = elm;
    link.targetEl = elm;
    updateHintText(link, labels[i], "");
    lastTop = lTop;
    lastLeft = parseInt(link.style.left, 10);
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

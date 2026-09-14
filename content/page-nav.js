import { getClickableElements } from "./hints-elements.js";
import { settings } from "./settings.js";
import { ui } from "./ui.js";

function normText(value) {
  return String(value || "").trim().toLowerCase();
}

function relTokens(el) {
  try {
    const rel = el.getAttribute ? el.getAttribute("rel") : "";
    return String(rel || "").toLowerCase().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function elementLabel(el) {
  let text = "";
  try {
    text = el.textContent || "";
  } catch {}
  let aria = "";
  try {
    aria = el.getAttribute ? el.getAttribute("aria-label") : "";
  } catch {}
  return { text: normText(text), aria: normText(aria) };
}

export function findPageNavLink(direction, texts, elements) {
  const rel = direction === "prev" ? "prev" : "next";
  const els = elements || getClickableElements();
  for (const el of els) {
    if (relTokens(el).includes(rel)) return el;
  }
  const wants = new Set((texts || []).map(normText).filter(Boolean));
  if (wants.size === 0) return null;
  for (const el of els) {
    const { text, aria } = elementLabel(el);
    if ((text && wants.has(text)) || (aria && wants.has(aria))) return el;
  }
  return null;
}

export function goPage(direction) {
  const dir = direction === "prev" ? "prev" : "next";
  const texts = settings.getPageNavTexts()[dir] || [];
  const el = findPageNavLink(dir, texts);
  if (!el) {
    ui.toast(dir === "prev" ? "No previous page" : "No next page");
    return;
  }
  ui.dispatchClick(el);
}

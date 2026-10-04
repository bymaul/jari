/* global NodeFilter */

import { overlaySelectors } from "../keymap.js";
import { isElementDrawn } from "../hints-elements.js";

function isOverlayElement(el) {
  try {
    return el.closest && el.closest(overlaySelectors);
  } catch {
    return false;
  }
}

function shouldSkipNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  const tag = parent.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "IFRAME" || tag === "CANVAS" || tag === "SVG") return true;
  if (isOverlayElement(parent)) return true;
  try {
    const root = parent.getRootNode && parent.getRootNode();
    if (root && root.host && root.host.classList) {
      const host = root.host;
      if (
        host.classList.contains("jari-help-host") ||
        host.classList.contains("jari-find-host") ||
        host.classList.contains("jari-prompt-host") ||
        host.classList.contains("jari-hints-host") ||
        host.classList.contains("jari-visual-caret-host")
      )
        return true;
    }
  } catch {}
  if (parent.closest) {
    try {
      if (
        parent.closest(
          ".jari-find, .jari-find-bar, .jari-visual-caret, .jari-visual-caret-host, .jari-hints-host, .jari-help, .jari-help-host, .jari-help-list, .jari-help-columns, .jari-overlay",
        )
      )
        return true;
      if (parent.closest('[aria-hidden="true"]')) return true;
      if (parent.closest('[hidden]')) return true;
    } catch {}
  }
  try {
    if (!isElementDrawn(parent)) return true;
    const style = window.getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
    if (parseFloat(style.opacity) < 0.05) return true;
  } catch {}
  return false;
}

export function collectTextNodes() {
  const out = [];
  const rootEl = document.body || document.documentElement;
  if (!rootEl) return out;
  try {
    const walker = document.createTreeWalker(
      rootEl,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node = walker.nextNode();
    while (node) {
      out.push(node);
      if (out.length > 5000) break;
      node = walker.nextNode();
    }
  } catch {}
  try {
    const visit = (root) => {
      let els;
      try {
        els = root.querySelectorAll("*");
      } catch { return; }
      for (const el of els) {
        if (el.shadowRoot) {
          try {
            const sw = document.createTreeWalker(
              el.shadowRoot,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode(n) {
                  if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                  if (shouldSkipNode(n)) return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                },
              },
            );
            let sn = sw.nextNode();
            while (sn) {
              out.push(sn);
              if (out.length > 5000) return;
              sn = sw.nextNode();
            }
            visit(el.shadowRoot);
          } catch {}
        }
        if (el.tagName === "IFRAME") {
          try {
            const doc = el.contentDocument;
            if (doc && doc.body) {
              const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                acceptNode(n) {
                  if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                  const p = n.parentElement;
                  if (!p) return NodeFilter.FILTER_REJECT;
                  const tag = p.tagName;
                  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
                  return NodeFilter.FILTER_ACCEPT;
                },
              });
              let nn = w.nextNode();
              while (nn) {
                out.push(nn);
                if (out.length > 5000) return;
                nn = w.nextNode();
              }
            }
          } catch {}
        }
      }
    };
    visit(document);
  } catch {}
  return out;
}

/* global CSS, Highlight */

export function detectHighlightSupport() {
  try {
    return (
      typeof CSS !== "undefined" &&
      CSS.highlights &&
      typeof Highlight !== "undefined"
    );
  } catch {
    return false;
  }
}

export function clearHighlightNames(...names) {
  try {
    if (CSS.highlights) {
      for (const name of names) CSS.highlights.delete(name);
    }
  } catch {}
}

export function unwrapSpans(spans) {
  for (const span of spans) {
    try {
      const parent = span.parentNode;
      if (!parent) continue;
      const text = span.textContent;
      const tn = document.createTextNode(text);
      parent.replaceChild(tn, span);
      parent.normalize();
    } catch {}
  }
  spans.length = 0;
}

export function detectHighlightSupport(): boolean {
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

export function clearHighlightNames(...names: string[]): void {
  try {
    if (CSS.highlights) {
      for (const name of names) CSS.highlights.delete(name);
    }
  } catch {}
}

export function unwrapSpans(spans: HTMLElement[]): void {
  for (const span of spans) {
    try {
      const parent = span.parentNode;
      if (!parent) continue;
      const text = span.textContent;
      const tn = document.createTextNode(text as string);
      parent.replaceChild(tn, span);
      parent.normalize();
    } catch {}
  }
  spans.length = 0;
}

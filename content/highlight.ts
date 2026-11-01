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


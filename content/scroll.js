// Jari: scroll-area targeting (g s / g S / w).
// Scrolling normally targets the window (the whole page). Some sites nest
// their content in their own scroll containers (chat panes, code panes,
// sidebars); "gs" cycles through the page's scrollable elements and "gS"
// returns to the global window scroll. "w" flashes a translucent wash over
// the active scroll area — labeled "current scroll area" — and it
// auto-dismisses; the same flash fires on every gs/gS switch.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  // The active scroll target. null = the window (global scroll).
  let target = null;

  const HIGHLIGHT_MS = 300;

  // The active scroll target, as a scrollable element or the window. A page
  // mutation may have removed the element since it was picked — fall back to
  // the window so scrolling never targets a detached node.
  //
  // On a page whose viewport cannot scroll (a fixed app shell), the window
  // itself scrolls nothing, so the first lookup resolves the target to the
  // scroll area nearest the viewport. Without this, scrolling stays dead
  // until the user presses gs/w. The decision is made once and cached:
  // a picked area lives in `target`, a negative outcome in `resolved`.
  let resolved = false;

  function getTarget() {
    if (target !== null && !target.isConnected) {
      // A page change removed the element since it was picked — fall back to
      // the window and re-resolve on the next call.
      target = null;
      resolved = false;
    }
    if (target === null && !resolved) {
      resolved = true;
      if (!pageCanScroll()) {
        const areas = findScrollableElements();
        if (areas.length > 0) target = nearestArea(areas) || areas[0];
      }
    }
    return target === null ? window : target;
  }

  // Elements that can actually scroll in either axis: overflow allows it and
  // the content overflows the box. Form fields (textarea/select/input) are
  // their own scrollable widgets, not page scroll areas, so they are skipped.
  // The html/body pair is the document's own scroll root — that is the
  // "global" target, so it is skipped too. Jari's overlays are excluded.
  function findScrollableElements() {
    const areas = [];
    const roots = new Set([document.documentElement, document.body]);
    for (const el of document.querySelectorAll('*')) {
      if (roots.has(el)) continue;
      if (el.closest(Jari.overlaySelectors)) continue;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') continue;
      if (el.clientHeight < 16 && el.clientWidth < 16) continue;
      const canY = el.scrollHeight > el.clientHeight + 1;
      const canX = el.scrollWidth > el.clientWidth + 1;
      if (!canY && !canX) continue;
      const style = getComputedStyle(el);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const scrollableY =
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && canY;
      const scrollableX =
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') && canX;
      if (scrollableY || scrollableX) areas.push(el);
    }
    return areas;
  }

  // The page itself can scroll (the document's scroll root overflows AND is
  // allowed to scroll). Many app pages set html/body { overflow: hidden } —
  // the content then overflows in measurements but the viewport cannot
  // scroll, so those pages have no global scroll stop. When the scroll
  // root's overflow is visible, the body's overflow applies to the viewport
  // instead.
  function pageCanScroll() {
    const el = document.scrollingElement || document.documentElement;
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    const y = getComputedStyle(el).overflowY;
    if (y === 'hidden' || y === 'clip') return false;
    if (y === 'visible' && document.body) {
      const bodyY = getComputedStyle(document.body).overflowY;
      if (bodyY === 'hidden' || bodyY === 'clip') return false;
    }
    return true;
  }

  // Nearest scroll area to the viewport center — used to pick the starting
  // point on pages without global scroll, so cycling begins where the user
  // is looking instead of at the first match in document order.
  function nearestArea(areas) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const el of areas) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
    return best;
  }

  // "gs": move to the next stop, wrapping around. The rotation includes the
  // window (global scroll) only when the page itself can scroll — a global
  // stop on a fixed page would scroll nothing. From the last stop the cycle
  // wraps back to the top (global or the nearest area).
  function cycle() {
    const areas = findScrollableElements();
    const pageScrolls = pageCanScroll();
    const stops = pageScrolls ? [null, ...areas] : areas;
    if (stops.length === 0) {
      target = null;
      Jari.ui.toast('No scroll areas');
      return;
    }
    const idx = stops.indexOf(target);
    if (idx === -1) {
      // Current target is not in the rotation: global on a page that cannot
      // scroll, or a detached element. Land on the nearest area, or on
      // global when the page itself scrolls.
      target = pageScrolls ? null : nearestArea(areas) || areas[0];
    } else if (pageScrolls && idx === 0) {
      // Leaving global: skip the first match in document order and go
      // straight to the area nearest the viewport — the one the user is
      // looking at.
      target = nearestArea(areas) || areas[0] || null;
    } else {
      target = stops[(idx + 1) % stops.length];
    }
    showHighlight();
  }

  // "gS": back to the global window scroll; on a page that cannot scroll,
  // there is nothing global to return to, so land on the nearest area.
  function resetToGlobal() {
    if (pageCanScroll()) {
      target = null;
    } else {
      const areas = findScrollableElements();
      if (areas.length === 0) {
        target = null;
        Jari.ui.toast('No scroll areas');
        return;
      }
      target = nearestArea(areas) || areas[0];
    }
    showHighlight();
  }

  // "w" (and every gs/gS switch): paint a translucent wash over the active
  // scroll area with a "current scroll area" label, then auto-dismiss.
  let highlightEl = null;
  let highlightTimer = null;

  function showHighlight() {
    let area = getTarget();
    if (area === window && !pageCanScroll()) {
      // The page has no global scroll, so there is nothing to highlight at
      // the window level. Pick the nearest area instead — that is the one
      // scrolling commands will act on. If nothing on the page scrolls,
      // show nothing.
      const areas = findScrollableElements();
      if (areas.length === 0) return;
      target = nearestArea(areas) || areas[0];
      area = target;
    }
    const rect =
      area === window
        ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
        : area.getBoundingClientRect();

    clearTimeout(highlightTimer);
    if (highlightEl) highlightEl.remove();

    const el = document.createElement('div');
    el.className = 'jari-scroll-highlight';
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    const label = document.createElement('span');
    label.className = 'jari-scroll-highlight-label';
    label.textContent = area === window ? 'global scroll' : 'current scroll area';
    el.appendChild(label);
    document.body.appendChild(el);
    highlightEl = el;
    highlightTimer = setTimeout(() => {
      if (highlightEl === el) {
        highlightEl.remove();
        highlightEl = null;
      }
    }, HIGHLIGHT_MS);
  }

  Jari.Scroll = { getTarget, cycle, resetToGlobal, showHighlight };
})();

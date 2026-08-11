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
  //
  // An auto-picked area is provisional: the DOM mutates as a page loads, and
  // the best target can change (Instagram's profile column appears only once
  // the feed renders; until then the sidebar menu is the only scroller). The
  // mutation observer clears `resolved` on any DOM change, so an auto-picked
  // target is re-evaluated on the next lookup. Targets the user picks
  // explicitly (gs/gS/w) are not — they chose it.
  let resolved = false;
  let autoPicked = false;

  function getTarget() {
    if (target !== null && !target.isConnected) {
      // A page change removed the element since it was picked — fall back to
      // the window and re-resolve on the next call.
      target = null;
      autoPicked = false;
      resolved = false;
    }
    if (target !== null && autoPicked && !resolved) {
      // The DOM changed after an auto-pick; re-resolve so a newly loaded
      // content column can take over from an early sidebar/menu pick.
      target = null;
    }
    if (target === null && !resolved) {
      resolved = true;
      if (!pageCanScroll()) {
        const areas = findScrollableElements();
        if (areas.length > 0) {
          target = nearestArea(areas) || areas[0];
          autoPicked = true;
        }
      }
    }
    return target === null ? window : target;
  }

  // findScrollableElements() walks the whole DOM and reads layout on every
  // call, which is the most expensive work in this module. The result only
  // changes when the DOM changes, so the scan is cached and invalidated by a
  // MutationObserver watching the document for node changes and for
  // class/style mutations that can turn an element scrollable or not.
  // The document (rather than documentElement) is observed because this runs
  // at document_start, when the root element may not exist yet; subtree
  // observation of the document covers the root and everything below it.
  // Callers only read the returned array, so returning the cache directly is
  // safe.
  let scanEpoch = 0;
  let cachedEpoch = -1;
  let cachedAreas = null;

  // The document observer only sees the light DOM — mutations inside a
  // shadow root do not bubble into the host's document tree. Any open shadow
  // root discovered during a scan gets its own observer so the epoch cache
  // invalidates when scrollability changes inside a shadow subtree too.
  const observedRoots = new Set();

  function ensureObserved(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    if (typeof window.MutationObserver === 'undefined') return;
    new window.MutationObserver(() => {
      scanEpoch++;
      resolved = false;
    }).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  if (typeof window.MutationObserver !== 'undefined') {
    new window.MutationObserver(() => {
      scanEpoch++;
      // The one-shot pageCanScroll decision may be stale after a DOM change
      // (an SPA can turn a scrolling page into a fixed shell or back), so the
      // next scroll command re-evaluates it. Cheap: pageCanScroll reads only
      // computed styles and the area scan is epoch-cached.
      resolved = false;
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  // A scrollable pane that is hidden from view (display:none, visibility:
  // hidden, opacity:0, or a "hidden" attribute on itself or an ancestor) must
  // not become a "gs" stop — the wheel would move an invisible surface.
  // Crosses shadow boundaries to the host, mirroring hints.isVisible but
  // without the viewport test: an off-screen but real pane is still a valid
  // scroll target.
  function isScrollVisible(el) {
    let node = el;
    while (node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.hasAttribute('hidden')) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) === 0) return false;
      }
      node = node.getRootNode().host || node.parentElement;
    }
    return true;
  }

  // Elements that can actually scroll in either axis: overflow allows it and
  // the content overflows the box. Form fields (textarea/select/input) are
  // their own scrollable widgets, not page scroll areas, so they are skipped.
  // The html/body pair is the document's own scroll root — that is the
  // "global" target, so it is skipped too. Jari's overlays are excluded.
  function findScrollableElements() {
    if (cachedEpoch === scanEpoch && cachedAreas) return cachedAreas;
    cachedEpoch = scanEpoch;
    const areas = [];
    const roots = new Set([document.documentElement, document.body]);
    // queryAll walks open shadow roots too, and attaches observers to each
    // root it finds (see ensureObserved).
    for (const el of Jari.queryAll('*', ensureObserved)) {
      if (roots.has(el)) continue;
      if (el.closest(Jari.overlaySelectors)) continue;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') continue;
      if (el.clientHeight < 16 && el.clientWidth < 16) continue;
      if (!isScrollVisible(el)) continue;
      const canY = el.scrollHeight > el.clientHeight + 1;
      const canX = el.scrollWidth > el.clientWidth + 1;
      if (!canY && !canX) continue;
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      const scrollableY =
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && canY;
      const scrollableX =
        (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') && canX;
      if (scrollableY || scrollableX) areas.push(el);
    }
    cachedAreas = areas;
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
    const y = window.getComputedStyle(el).overflowY;
    if (y === 'hidden' || y === 'clip') return false;
    if (y === 'visible' && document.body) {
      const bodyY = window.getComputedStyle(document.body).overflowY;
      if (bodyY === 'hidden' || bodyY === 'clip') return false;
    }
    return true;
  }

  // Picks the initial scroll target on pages without global scroll (a fixed
  // app shell). Prefer the area that covers the most viewport, with a bonus
  // for containing the viewport center — the main content scroller wins over
  // a sidebar menu or suggestion panel even when that panel is closer to the
  // center.
  function nearestArea(areas) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;
    let best = null;
    let bestScore = -Infinity;
    for (const el of areas) {
      const r = el.getBoundingClientRect();
      const coveredW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const coveredH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const coverage = (coveredW * coveredH) / (vw * vh);
      const containsCenter = r.left <= cx && cx <= r.right && r.top <= cy && cy <= r.bottom;
      const score = coverage + (containsCenter ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
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
    autoPicked = false;
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
    autoPicked = false;
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
      autoPicked = false;
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

// Jari: the command registry.
// Each command is { category, label, run, repeatable? }. category groups
// commands on the options page.
// run receives { count, event }. repeatable commands scale with the count
// prefix (e.g. "3j", "5x").
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const PAGE_RATIO = 0.9;
  const HALF_RATIO = 0.5;

  // Scrolling always targets the window; there is no per-element scroll focus
  // anymore.
  function getScrollElement() {
    return window;
  }

  function scrollHeightOf(el) {
    return el === window
      ? (document.scrollingElement || document.documentElement || document.body).scrollHeight
      : el.scrollHeight;
  }

  function clientHeightOf(el) {
    return el === window ? window.innerHeight : el.clientHeight;
  }

  // Manual smooth scrolling. Holding a key fires repeated keydowns; each
  // scrollBy({ behavior: "smooth" }) cancels the previous animation, which
  // stutters. Instead, accumulate the requested distance and animate it with
  // requestAnimationFrame until it is consumed.
  let smoothState = null; // { el, x, y, rafId }

  function scrollPosOf(el) {
    return el === window
      ? { x: window.scrollX, y: window.scrollY }
      : { x: el.scrollLeft, y: el.scrollTop };
  }

  // Respect the OS-level reduced-motion preference: when set, skip the smooth
  // animation and jump instantly even if smoothScroll is enabled.
  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function smoothScrollBy(el, x, y) {
    if (smoothState === null || smoothState.el !== el) {
      smoothState = { el, x: 0, y: 0, rafId: null };
    }
    smoothState.x += x;
    smoothState.y += y;
    if (smoothState.rafId === null) {
      smoothState.rafId = requestAnimationFrame(smoothScrollStep);
    }
  }

  function smoothScrollStep() {
    if (!smoothState) return;
    smoothState.rafId = null;
    const { el } = smoothState;
    const pendingX = smoothState.x;
    const pendingY = smoothState.y;
    if (pendingX === 0 && pendingY === 0) {
      smoothState = null;
      return;
    }
    // Ease-out toward the target, capped per frame so a large backlog (a held
    // key) still scrolls at a steady, sane speed.
    const CAP = 150;
    const moveX =
      pendingX !== 0
        ? Math.sign(pendingX) * Math.max(1, Math.min(CAP, Math.round(Math.abs(pendingX) * 0.25)))
        : 0;
    const moveY =
      pendingY !== 0
        ? Math.sign(pendingY) * Math.max(1, Math.min(CAP, Math.round(Math.abs(pendingY) * 0.25)))
        : 0;

    const before = scrollPosOf(el);
    el.scrollBy({ left: moveX, top: moveY, behavior: "auto" });
    const after = scrollPosOf(el);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    // Consume what actually moved; an axis that couldn't move (scroll limit
    // reached) is dropped so the loop can end, while the other axis keeps
    // animating.
    if (dx !== 0) smoothState.x -= dx;
    else smoothState.x = 0;
    if (dy !== 0) smoothState.y -= dy;
    else smoothState.y = 0;

    smoothState.rafId = requestAnimationFrame(smoothScrollStep);
  }

  function scrollBy({ x = 0, y = 0, count = 1 }) {
    const el = getScrollElement();
    if (Jari.settings.isSmoothScroll() && !prefersReducedMotion()) {
      smoothScrollBy(el, x * count, y * count);
    } else {
      el.scrollBy({ left: x * count, top: y * count, behavior: "auto" });
    }
  }

  async function copyToClipboard(text, message) {
    await Jari.ui.copyText(text);
    Jari.ui.toast(message);
  }

  // Read the clipboard. A hidden textarea + execCommand("paste") is the
  // reliable path from a content script (needs the "clipboardRead" permission
  // in the manifest); navigator.clipboard.readText() is the fallback on
  // secure pages. The caller treats the result as a URL — background
  // normalizeUrl turns bare hostnames into https.
  function pasteClipboard() {
    const ta = document.createElement("textarea");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    let text = "";
    try {
      if (document.execCommand("paste")) text = ta.value.trim();
    } catch {}
    ta.remove();
    if (text) return Promise.resolve(text);
    try {
      return navigator.clipboard.readText().then((t) => t.trim()).catch(() => "");
    } catch {
      return Promise.resolve("");
    }
  }

  // "gu": go one path segment up, keeping the current origin.
  //   acme.com/1/2/3  ->  acme.com/1/2
  //   acme.com/1/2/   ->  acme.com/1
  //   acme.com/1/2/3.html -> acme.com/1/2
  //   acme.com/       ->  acme.com/  (already root: caller shows a toast)
  function parentUrlOf(href) {
    try {
      const url = new URL(href);
      let path = url.pathname;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      const idx = path.lastIndexOf("/");
      path = idx > 0 ? path.slice(0, idx) : "/";
      url.pathname = path;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  }

  // "gU": go to the root of the current URL hierarchy (the origin).
  //   acme.com/1/2/3  ->  acme.com/
  function rootUrlOf(href) {
    try {
      const url = new URL(href);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return href;
    }
  }

  // Same path, ignoring query/hash: "https://x.com/?ref=1" counts as root for
  // the already-there check, otherwise navigation with a stale query reloads.
  function isSamePath(a, b) {
    try {
      return new URL(a).pathname === new URL(b).pathname;
    } catch {
      return a === b;
    }
  }

  const commands = {
    // Scrolling
    scrollDown: { category: "scrolling", label: "Scroll down", repeatable: true, run: (c) => scrollBy({ y: Jari.settings.getScrollStep(), count: c.count }) },
    scrollUp: { category: "scrolling", label: "Scroll up", repeatable: true, run: (c) => scrollBy({ y: -Jari.settings.getScrollStep(), count: c.count }) },
    scrollLeft: { category: "scrolling", label: "Scroll left", repeatable: true, run: (c) => scrollBy({ x: -Jari.settings.getScrollStep(), count: c.count }) },
    scrollRight: { category: "scrolling", label: "Scroll right", repeatable: true, run: (c) => scrollBy({ x: Jari.settings.getScrollStep(), count: c.count }) },
    scrollTop: {
      category: "scrolling",
      label: "Scroll to top",
      run: () => {
        const el = getScrollElement();
        if (Jari.settings.isSmoothScroll() && !prefersReducedMotion()) smoothScrollBy(el, 0, -scrollPosOf(el).y);
        else el.scrollTo({ top: 0, behavior: "auto" });
      },
    },
    scrollBottom: {
      category: "scrolling",
      label: "Scroll to bottom",
      run: () => {
        const el = getScrollElement();
        const target = Math.max(0, scrollHeightOf(el) - clientHeightOf(el));
        if (Jari.settings.isSmoothScroll() && !prefersReducedMotion()) smoothScrollBy(el, 0, target - scrollPosOf(el).y);
        else el.scrollTo({ top: target, behavior: "auto" });
      },
    },
    scrollPageDown: {
      category: "scrolling",
      label: "Scroll page down",
      repeatable: true,
      run: (c) => scrollBy({ y: clientHeightOf(getScrollElement()) * PAGE_RATIO, count: c.count }),
    },
    scrollPageUp: {
      category: "scrolling",
      label: "Scroll page up",
      repeatable: true,
      run: (c) => scrollBy({ y: -clientHeightOf(getScrollElement()) * PAGE_RATIO, count: c.count }),
    },
    scrollHalfDown: {
      category: "scrolling",
      label: "Scroll half page down",
      repeatable: true,
      run: (c) => scrollBy({ y: clientHeightOf(getScrollElement()) * HALF_RATIO, count: c.count }),
    },
    scrollHalfUp: {
      category: "scrolling",
      label: "Scroll half page up",
      repeatable: true,
      run: (c) => scrollBy({ y: -clientHeightOf(getScrollElement()) * HALF_RATIO, count: c.count }),
    },
    zoomIn: { category: "view", label: "Zoom in", run: () => Jari.sendMessage("zoomBy", { delta: 0.1 }) },
    zoomOut: { category: "view", label: "Zoom out", run: () => Jari.sendMessage("zoomBy", { delta: -0.1 }) },

    // Tabs
    newTab: { category: "tabs", label: "New tab", run: () => Jari.sendMessage("createTab") },
    closeTab: { category: "tabs", label: "Close tab", repeatable: true, run: (c) => Jari.sendMessage("closeTab", { count: c.count }) },
    restoreTab: { category: "tabs", label: "Reopen closed tab", repeatable: true, run: (c) => Jari.sendMessage("restoreTab", { count: c.count }) },
    pasteOpenTab: {
      category: "tabs",
      label: "Open clipboard URL in new tab",
      run: async () => {
        const text = await pasteClipboard();
        if (!text) return Jari.ui.toast("Clipboard empty");
        const res = await Jari.sendMessage("createTab", { url: text });
        if (res && !res.ok) Jari.ui.toast("Not a URL");
      },
    },
    pasteOpenTabBackground: {
      category: "tabs",
      label: "Open clipboard URL in background tab",
      run: async () => {
        const text = await pasteClipboard();
        if (!text) return Jari.ui.toast("Clipboard empty");
        const res = await Jari.sendMessage("openInBackgroundTab", { url: text });
        if (res && !res.ok) Jari.ui.toast("Not a URL");
      },
    },
    previousTab: { category: "tabs", label: "Previous tab", repeatable: true, run: (c) => Jari.sendMessage("previousTab", { count: c.count }) },
    nextTab: { category: "tabs", label: "Next tab", repeatable: true, run: (c) => Jari.sendMessage("nextTab", { count: c.count }) },
    firstTab: { category: "tabs", label: "Jump to first tab", run: () => Jari.sendMessage("firstTab") },
    lastTab: { category: "tabs", label: "Jump to last tab", run: () => Jari.sendMessage("lastTab") },
    splitTab: { category: "tabActions", label: "Move tab to new window", run: () => Jari.sendMessage("splitTab") },
    splitOrMergeTab: {
      category: "tabActions",
      label: "Split tab / merge window",
      run: async () => {
        const res = await Jari.sendMessage("splitOrMerge");
        if (res && res.needMerge) Jari.TabSearch.openMerge(res);
      },
    },
    moveTabLeft: { category: "tabActions", label: "Move tab left", run: () => Jari.sendMessage("moveTabLeft") },
    moveTabRight: { category: "tabActions", label: "Move tab right", run: () => Jari.sendMessage("moveTabRight") },
    duplicateTab: { category: "tabActions", label: "Duplicate tab", run: () => Jari.sendMessage("duplicateTab") },
    togglePin: { category: "tabActions", label: "Pin/unpin tab", run: () => Jari.sendMessage("togglePin") },
    toggleMute: { category: "tabActions", label: "Mute/unmute tab", run: () => Jari.sendMessage("toggleMute") },
    tabSearch: { category: "tabs", label: "Tab search", run: () => Jari.TabSearch.open() },
    reloadTab: { category: "page", label: "Reload", run: () => Jari.sendMessage("reloadTab", { bypassCache: false }) },
    hardReload: { category: "page", label: "Hard reload", run: () => Jari.sendMessage("reloadTab", { bypassCache: true }) },
    goParentUrl: {
      category: "page",
      label: "Go to parent path",
      run: () => {
        const target = parentUrlOf(location.href);
        if (isSamePath(target, location.href)) return Jari.ui.toast("Already at root");
        Jari.sendMessage("navigate", { url: target });
      },
    },
    goUrlRoot: {
      category: "page",
      label: "Go to site root",
      run: () => {
        const target = rootUrlOf(location.href);
        if (isSamePath(target, location.href)) return Jari.ui.toast("Already at root");
        Jari.sendMessage("navigate", { url: target });
      },
    },

    // Hints
    linkHints: { category: "hints", label: "Link hints", run: () => Jari.Hints.start("click") },
    linkHintsNewTab: { category: "hints", label: "Link hints (new tab)", run: () => Jari.Hints.start("newtab") },
    linkHintsYank: { category: "hints", label: "Copy link URL", run: () => Jari.Hints.start("yank") },
    focusInput: { category: "hints", label: "Focus input", run: () => Jari.Hints.start("focus") },

    // Page navigation
    historyBack: { category: "history", label: "Back", run: () => Jari.sendMessage("historyBack") },
    historyForward: { category: "history", label: "Forward", run: () => Jari.sendMessage("historyForward") },

    // Clipboard
    copyUrl: { category: "clipboard", label: "Copy URL", run: () => copyToClipboard(location.href, "Copied") },
    copyTitleUrl: { category: "clipboard", label: "Copy title + URL", run: () => copyToClipboard(`${document.title}\n${location.href}`, "Copied") },

    // Site-level control
    toggleIgnore: { category: "modes", label: "Ignore mode", run: () => Jari.Ignore.toggle() },
    passthrough: { category: "modes", label: "Passthrough keys (timed)", run: () => Jari.Passthrough.enter() },
    toggleDisabled: { category: "modes", label: "Enable/disable on this site", run: () => Jari.settings.toggleDisabled() },

    // Help & settings
    showHelp: { category: "help", label: "Show keybindings", run: () => Jari.Help.open() },
    openOptions: { category: "help", label: "Open settings", run: () => Jari.sendMessage("openOptions") },
  };

  Jari.commands = commands;
})();

// Jari: content-script entry point.
// Boots settings and installs the capture-phase keydown dispatcher that
// routes keys to active modes (hints/find/tabsearch), the count prefix, the
// "g" chord, and the user keymap. A Neovim-style showcmd
// readout echoes counts and chord prefixes while they are being composed.
//
// "I" toggles ignore mode: Jari stops reacting to every key (except the
// toggle itself) until it is pressed again, with a persistent status pill.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const TIMEOUT_MS = 1200;

  let pendingCount = "";
  let pendingPrefix = null;
  let typedSeq = "";
  let timer = null;
  let ignoreMode = false;
  let ignorePill = null;

  function canonicalKey(event) {
    const parts = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.metaKey) parts.push("meta");
    parts.push(event.key);
    return parts.join("+");
  }

  // The user stopped mid-composition: drop count/chord state and the echo.
  function clearPending() {
    pendingCount = "";
    pendingPrefix = null;
    typedSeq = "";
    Jari.ui.showcmd(null);
  }

  function restartTimer() {
    clearTimeout(timer);
    timer = setTimeout(clearPending, TIMEOUT_MS);
  }

  function isTypingTarget(el) {
    return (
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable ||
        el.getAttribute("role") === "textbox")
    );
  }

  function run(commandName, count, event) {
    const cmd = Jari.commands[commandName];
    if (!cmd) return;
    event.preventDefault();
    cmd.run({ count, event });
  }

  // --- Ignore mode --------------------------------------------------------

  function setIgnore(on) {
    ignoreMode = on;
    clearPending();
    if (on) {
      // No overlay may stay open while keys pass through.
      Jari.Help.close();
      Jari.Hints.cancel();
      Jari.Find.cancel();
      Jari.TabSearch.close();
      showIgnorePill();
    } else {
      hideIgnorePill();
    }
  }

  function toggleIgnore() {
    setIgnore(!ignoreMode);
    Jari.ui.toast(ignoreMode ? "Ignore mode on" : "Ignore mode off");
    return ignoreMode;
  }

  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  function showIgnorePill() {
    if (ignorePill || isFullscreen()) return;
    ignorePill = document.createElement("div");
    ignorePill.className = "jari-ignore-pill";
    ignorePill.textContent = "Ignore mode — press I or Esc to exit";
    document.body.appendChild(ignorePill);
  }

  function hideIgnorePill() {
    if (ignorePill) {
      ignorePill.remove();
      ignorePill = null;
    }
  }

  // Entering fullscreen (e.g. a video) hides the pill so it never covers
  // fullscreen content; leaving fullscreen brings it back while the mode is
  // still active.
  function handleFullscreenChange() {
    if (!ignoreMode) return;
    if (isFullscreen()) hideIgnorePill();
    else showIgnorePill();
  }

  // --- Dispatcher ---------------------------------------------------------

  function handleKeydown(event) {
    // Ignore synthetic events: pages must not be able to trigger commands
    // by dispatching fake KeyboardEvents.
    if (!event.isTrusted) return;

    // Ignore mode: everything passes through except the toggle itself and
    // Escape, both of which leave the mode.
    if (ignoreMode) {
      const plainI = event.key === "I" && !event.ctrlKey && !event.altKey && !event.metaKey;
      if (plainI || event.key === "Escape") {
        event.preventDefault();
        toggleIgnore();
      }
      return;
    }

    // Active overlays own every key.
    if (Jari.Help.isActive()) return Jari.Help.onKeyDown(event);
    if (Jari.Hints.isActive()) return Jari.Hints.onKeyDown(event);
    if (Jari.Find.isActive()) return Jari.Find.onKeyDown(event);
    if (Jari.TabSearch.isActive()) return Jari.TabSearch.onKeyDown(event);

    const key = canonicalKey(event);

    // Resolve a pending chord, e.g. "gt", "gg". The composed keys stay
    // in typedSeq so the showcmd readout can echo them on execution.
    const prefixWasPending = pendingPrefix !== null;
    let commandName = null;
    if (prefixWasPending) {
      const sub = Jari.chords[pendingPrefix] || {};
      if (key in sub) commandName = sub[key];
      pendingPrefix = null;
      Jari.ui.showcmd(null);
    }

    // Form fields: pass everything through except Escape (blur) and the
    // site-toggle shortcut.
    const activeEl = document.activeElement;
    if (isTypingTarget(activeEl)) {
      if (commandName === "toggleDisabled") run(commandName, 1, event);
      else if (event.key === "Escape") activeEl.blur();
      return;
    }

    // Escape with no form field focused clears any composition in progress.
    if (event.key === "Escape") {
      clearPending();
      return;
    }

    // Count prefix: digits 0-9 accumulate an unlimited repeat count.
    if (/^[0-9]$/.test(key)) {
      pendingCount += key;
      typedSeq += key;
      Jari.ui.showcmd(typedSeq);
      event.preventDefault();
      restartTimer();
      return;
    }

    // Start a new chord prefix (e.g. "g", "y").
    if (!commandName && Jari.chords[key]) {
      pendingPrefix = key;
      typedSeq += key;
      Jari.ui.showcmd(typedSeq);
      event.preventDefault();
      restartTimer();
      return;
    }

    if (!commandName) commandName = Jari.settings.getKeymap()[key];
    if (!commandName) {
      // Dead key: nothing runs, drop any composed prefix.
      clearPending();
      return;
    }

    // Disabled sites only allow the toggle command.
    if (Jari.settings.isDisabled() && commandName !== "toggleDisabled") return;

    const count = pendingCount ? parseInt(pendingCount, 10) : 1;
    const hadCount = pendingCount !== "";
    pendingCount = "";
    if (!prefixWasPending) typedSeq += key;
    const seq = typedSeq || key;
    typedSeq = "";
    // Echo composed counts/chords prominently; plain keys echo muted so the
    // readout still shows what was pressed without being loud.
    if (hadCount || prefixWasPending) Jari.ui.flash(seq);
    else Jari.ui.flash(seq, 600, { muted: true });
    restartTimer();

    run(commandName, count, event);
  }

  async function boot() {
    await Jari.settings.load();

    Jari.Events.on("settingsChanged", () => {
      if (Jari.settings.isDisabled()) {
        setIgnore(false);
        Jari.Help.close();
        Jari.Hints.cancel();
        Jari.Find.cancel();
        Jari.TabSearch.close();
      }
    });

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
  }

  Jari.Ignore = { toggle: toggleIgnore, isActive: () => ignoreMode };

  boot();
})();

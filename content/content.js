// Jari: content-script entry point.
// Boots settings and installs the capture-phase keydown dispatcher that
// routes keys to active modes (hints/find/tabsearch), the count prefix, the
// "g" prefix, and the user keymap. A Neovim-style showcmd
// readout echoes counts and prefix keys while they are being composed; an
// inactivity timeout drops the composition if it is never completed.
//
// "I" toggles ignore mode: Jari stops reacting to every key (except the
// toggle itself) until it is pressed again, with a persistent status pill.
(() => {
  const Jari = window.Jari || (window.Jari = {});

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

  // The user stopped mid-composition (Escape, dead key, ignore toggle, or
  // inactivity timeout): drop count/prefix state and the echo.
  function clearPending() {
    pendingCount = "";
    pendingPrefix = null;
    typedSeq = "";
    Jari.ui.showcmd(null);
  }

  function restartTimer() {
    clearTimeout(timer);
    timer = setTimeout(clearPending, Jari.settings.getTimeoutMs());
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
    ignorePill.textContent = "Ignore mode";
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

  function isModifierKey(key) {
    return (
      key === "Shift" ||
      key === "Control" ||
      key === "Alt" ||
      key === "Meta" ||
      key === "OS" ||
      key === "CapsLock" ||
      key === "NumLock" ||
      key === "ScrollLock"
    );
  }

  function handleKeydown(event) {
    // Ignore synthetic events: pages must not be able to trigger commands
    // by dispatching fake KeyboardEvents.
    if (!event.isTrusted) return;

    // A bare modifier press (Shift/Ctrl/Alt/...) is only ever a prefix of the
    // real key. Let it pass and keep any pending composition: "g" followed by
    // Shift+u must complete "gU", not cancel the prefix on the Shift keydown.
    if (isModifierKey(event.key)) return;

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

    // Resolve a pending prefix, e.g. "gt", "gg". The composed keys stay
    // in typedSeq so the showcmd readout can echo them on execution.
    const prefixWasPending = pendingPrefix !== null;
    let commandName = null;
    if (prefixWasPending) {
      const sub = Jari.prefixes[pendingPrefix] || {};
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

    // Strict prefix composition: while a prefix is pending, a key that does
    // not complete it is a dead key, not a single-key command — "gi" must
    // never fall through to run "i". (Form fields were handled above, so
    // typing in an input still passes through normally.)
    if (prefixWasPending && !commandName) {
      clearPending();
      return;
    }

    // Escape with no form field focused clears any composition in progress.
    if (event.key === "Escape") {
      clearPending();
      return;
    }

    // Count prefix: digits 0-9 accumulate an unlimited repeat count. Only
    // when no prefix already claimed the key — "g0" is firstTab, not a count.
    if (!commandName && /^[0-9]$/.test(key)) {
      pendingCount += key;
      typedSeq += key;
      Jari.ui.showcmd(typedSeq);
      event.preventDefault();
      restartTimer();
      return;
    }

    // Start a new prefix (e.g. "g", "y").
    if (!commandName && Jari.prefixes[key]) {
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
    // Append the completing key even when it finished a prefix, so the echo
    // shows the full sequence ("g$", "gg", ";s") rather than just the prefix.
    typedSeq += key;
    const seq = typedSeq || key;
    typedSeq = "";
    // Echo only compositions: a count or a finished prefix. Plain single-key
    // commands show nothing — the readout exists to track what is pending.
    if (hadCount || prefixWasPending) Jari.ui.flash(seq);
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

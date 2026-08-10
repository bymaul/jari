// Jari: content-script entry point.
// Boots settings and installs the capture-phase keydown dispatcher that
// routes keys to active modes (hints/prompt), the count prefix, the
// "g" prefix, and the user keymap. A Neovim-style showcmd
// readout echoes counts and prefix keys while they are being composed; an
// inactivity timeout drops the composition if it is never completed.
//
// "I" toggles ignore mode: Jari stops reacting to every key (except the
// toggle itself) until it is pressed again, with a persistent status pill.
// "o" enters passthrough mode: every key reaches the page until the timeout
// expires or Escape is pressed, with a transient status pill.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  let pendingCount = '';
  let pendingPrefix = null;
  let typedSeq = '';
  let timer = null;
  let ignoreMode = false;
  let passthroughMode = false;
  let passthroughTimer = null;
  const pills = {}; // mode name -> pill element

  // The user stopped mid-composition (Escape, dead key, ignore toggle, or
  // inactivity timeout): drop count/prefix state and the echo.
  function clearPending() {
    pendingCount = '';
    pendingPrefix = null;
    typedSeq = '';
    Jari.ui.showcmd(null);
  }

  function restartTimer() {
    clearTimeout(timer);
    timer = setTimeout(clearPending, Jari.settings.getTimeoutMs());
  }

  function isTypingTarget(el) {
    return (
      !!el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable ||
        el.getAttribute('role') === 'textbox' ||
        el.getAttribute('role') === 'searchbox')
    );
  }

  // A command consumes its key: preventDefault stops the browser default
  // action and stopImmediatePropagation (capture phase, window) keeps the
  // keydown from reaching the page or other extensions — a Jari shortcut
  // must not also trigger the site's own handler or another extension's
  // shortcut (e.g. SponsorBlock's ";" segment skip).
  function run(commandName, count, event) {
    const cmd = Jari.commands[commandName];
    if (!cmd) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cmd.run({ count, event });
  }

  // --- Modes: ignore ("I") and passthrough ("o") --------------------------

  function setIgnore(on) {
    ignoreMode = on;
    clearPending();
    if (on) {
      // No overlay may stay open while keys pass through.
      Jari.Help.close();
      Jari.Hints.cancel();
      Jari.Prompt.close();
      showPill('ignore', 'Ignore mode');
    } else {
      hidePill('ignore');
    }
  }

  function toggleIgnore() {
    exitPassthrough();
    setIgnore(!ignoreMode);
    return ignoreMode;
  }

  // Passthrough is enter-only: while it is active the "o" key passes through
  // to the page (the user may be typing it), so only Escape — which is always
  // intercepted — and the timeout leave the mode.
  function enterPassthrough() {
    setIgnore(false);
    clearPending();
    // No overlay may stay open while keys pass through.
    Jari.Help.close();
    Jari.Hints.cancel();
    Jari.Prompt.close();
    passthroughMode = true;
    showPill('passthrough', 'Passthrough (' + Jari.settings.getPassthroughMs() + 'ms)');
    clearTimeout(passthroughTimer);
    passthroughTimer = setTimeout(exitPassthrough, Jari.settings.getPassthroughMs());
  }

  function exitPassthrough() {
    if (!passthroughMode) return;
    clearTimeout(passthroughTimer);
    passthroughMode = false;
    hidePill('passthrough');
  }

  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  function showPill(name, text) {
    if (pills[name] || isFullscreen()) return;
    const el = document.createElement("div");
    el.className = "jari-pill";
    el.textContent = text;
    Jari.ui.statusContainer().appendChild(el);
    pills[name] = el;
  }

  function hidePill(name) {
    const el = pills[name];
    if (el) {
      el.remove();
      delete pills[name];
    }
  }

  // Entering fullscreen (e.g. a video) hides the pills so they never cover
  // fullscreen content; leaving fullscreen brings them back while the mode is
  // still active.
  function handleFullscreenChange() {
    if (!ignoreMode && !passthroughMode) return;
    if (isFullscreen()) {
      hidePill('ignore');
      hidePill('passthrough');
    } else {
      if (ignoreMode) showPill('ignore', 'Ignore mode');
      if (passthroughMode) showPill('passthrough', 'Passthrough');
    }
  }

  // --- Dispatcher ---------------------------------------------------------

  function handleKeydown(event) {
    // Ignore synthetic events: pages must not be able to trigger commands
    // by dispatching fake KeyboardEvents.
    if (!event.isTrusted) return;

    // A bare modifier press (Shift/Ctrl/Alt/...) is only ever a prefix of the
    // real key. Let it pass and keep any pending composition: "g" followed by
    // Shift+u must complete "gU", not cancel the prefix on the Shift keydown.
    if (Jari.modifierKeys.has(event.key)) return;

    // Passthrough mode: the page owns every key except Escape, which leaves
    // the mode early; the timeout exits it on its own.
    if (passthroughMode) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        exitPassthrough();
      }
      return;
    }

    // Ignore mode: everything passes through except the toggle itself and
    // Escape, both of which leave the mode.
    if (ignoreMode) {
      const plainI = event.key === 'I' && !event.ctrlKey && !event.altKey && !event.metaKey;
      if (plainI || event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleIgnore();
      }
      return;
    }

    // Disabled sites: Jari is off — only the key bound to the toggle is
    // intercepted, every other key reaches the page untouched.
    if (Jari.settings.isDisabled()) {
      const key = Jari.canonicalKey(event);
      if (Jari.settings.getKeymap()[key] === 'toggleDisabled') run('toggleDisabled', 1, event);
      return;
    }

    // Active overlays own every key; each overlay blocks the keys it
    // consumes from reaching the page.
    if (Jari.Help.isActive()) return Jari.Help.onKeyDown(event);
    if (Jari.Hints.isActive()) return Jari.Hints.onKeyDown(event);
    if (Jari.Prompt.isActive()) return Jari.Prompt.onKeyDown(event);

    const key = Jari.canonicalKey(event);

    // Resolve a pending prefix: the composed pair (e.g. "go" = "g" then "o")
    // is looked up in the keymap like any binding. Unbound pairs resolve to
    // nothing and become dead keys below. The keys stay in typedSeq so the
    // showcmd readout can echo them on execution.
    const prefixWasPending = pendingPrefix !== null;
    let commandName = null;
    if (prefixWasPending) {
      commandName = Jari.settings.getKeymap()[pendingPrefix + key] || null;
      pendingPrefix = null;
      Jari.ui.showcmd(null);
    }

    // Form fields: pass everything through except Escape (blur) and the
    // site-toggle shortcut.
    const activeEl = document.activeElement;
    if (isTypingTarget(activeEl)) {
      if (commandName === 'toggleDisabled') run(commandName, 1, event);
      else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        activeEl.blur();
      }
      return;
    }

    // Strict prefix composition: while a prefix is pending, a key that does
    // not complete it is a dead key, not a single-key command — "gi" must
    // never fall through to run "i", and the completing key must not reach
    // the page either (an unbound "g/" must not fire a site's "/" shortcut).
    // (Form fields were handled above, so typing in an input still passes
    // through normally.)
    if (prefixWasPending && !commandName) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearPending();
      return;
    }

    // Escape with no form field focused cancels a pending count. When idle,
    // leave Escape to the page — sites use it to close dialogs, and Jari has
    // nothing to clear.
    if (event.key === 'Escape') {
      if (pendingCount) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearPending();
      }
      return;
    }

    // Count prefix: digits 0-9 accumulate an unlimited repeat count. Only
    // when no prefix already claimed the key — "g0" is firstTab, not a count.
    if (!commandName && /^[0-9]$/.test(key)) {
      pendingCount += key;
      typedSeq += key;
      Jari.ui.showcmd(typedSeq);
      event.preventDefault();
      event.stopImmediatePropagation();
      restartTimer();
      return;
    }

    // Start a new prefix (e.g. "g", "y").
    if (!commandName && Jari.prefixes[key]) {
      pendingPrefix = key;
      typedSeq += key;
      Jari.ui.showcmd(typedSeq);
      event.preventDefault();
      event.stopImmediatePropagation();
      restartTimer();
      return;
    }

    if (!commandName) commandName = Jari.settings.getKeymap()[key];
    if (!commandName) {
      // Dead key: nothing runs, drop any composed prefix and let the page
      // see the key.
      clearPending();
      return;
    }

    const count = pendingCount ? parseInt(pendingCount, 10) : 1;
    const hadCount = pendingCount !== '';
    pendingCount = '';
    // Append the completing key even when it finished a prefix, so the echo
    // shows the full sequence ("go", "gu") rather than just the prefix.
    typedSeq += key;
    const seq = typedSeq || key;
    typedSeq = '';
    // Echo only compositions: a count or a finished prefix. Plain single-key
    // commands show nothing — the readout exists to track what is pending.
    if (hadCount || prefixWasPending) Jari.ui.flash(seq);
    restartTimer();

    run(commandName, count, event);
  }

  async function boot() {
    await Jari.settings.load();

    Jari.Events.on('settingsChanged', () => {
      if (Jari.settings.isDisabled()) {
        setIgnore(false);
        exitPassthrough();
        Jari.Help.close();
        Jari.Hints.cancel();
        Jari.Prompt.close();
      }
    });

    // window (not document) capture: the window is the outermost node in the
    // event path, so Jari claims its keys before any document-level listener
    // from the page or other extensions (e.g. SponsorBlock's ";" shortcut),
    // regardless of content-script injection order.
    window.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
  }

  Jari.Ignore = { toggle: toggleIgnore };
  Jari.Passthrough = { enter: enterPassthrough };

  boot();
})();

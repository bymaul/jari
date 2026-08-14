import { Events, canonicalKey, deepActiveElement, modifierKeys, parseRepeatCount, prefixes } from "./keymap.js";
import { settings } from "./settings.js";
import { ui } from "./ui.js";
import { commands, setModeActions } from "./commands.js";
import { Overlays } from "./overlays.js";

let pendingCount = '';
let pendingPrefix = null;
let typedSeq = '';
let timer = null;
let ignoreMode = false;
let passthroughMode = false;
let passthroughTimer = null;
const pills = {};

function clearPending() {
  pendingCount = '';
  pendingPrefix = null;
  typedSeq = '';
  ui.showcmd(null);
}

function restartTimer() {
  clearTimeout(timer);
  timer = setTimeout(clearPending, settings.getTimeoutMs());
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

function run(commandName, count, event) {
  const cmd = commands[commandName];
  if (!cmd) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cmd.run({ count, event });
}

function setIgnore(on) {
  ignoreMode = on;
  clearPending();
  if (on) {

    Overlays.closeAll();
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

function enterPassthrough() {
  setIgnore(false);
  clearPending();

  Overlays.closeAll();
  passthroughMode = true;
  showPill('passthrough', 'Passthrough (' + settings.getPassthroughMs() + 'ms)');
  clearTimeout(passthroughTimer);
  passthroughTimer = setTimeout(exitPassthrough, settings.getPassthroughMs());
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
  ui.statusContainer().appendChild(el);
  pills[name] = el;
}

function hidePill(name) {
  const el = pills[name];
  if (el) {
    el.remove();
    delete pills[name];
  }
}

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

function handleKeydown(event) {

  if (!event.isTrusted) return;

  if (modifierKeys.has(event.key)) return;

  if (passthroughMode) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitPassthrough();
    }
    return;
  }

  if (ignoreMode) {
    const key = canonicalKey(event);
    if (settings.getKeymap()[key] === 'toggleIgnore' || event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleIgnore();
    }
    return;
  }

  if (settings.isDisabled()) {
    const key = canonicalKey(event);
    if (settings.getKeymap()[key] === 'toggleDisabled') run('toggleDisabled', 1, event);
    return;
  }

  const overlay = Overlays.active();
  if (overlay) return overlay.onKeyDown(event);

  const key = canonicalKey(event);

  const prefixWasPending = pendingPrefix !== null;
  let commandName = null;
  if (prefixWasPending) {
    commandName = settings.getKeymap()[pendingPrefix + key] || null;
    pendingPrefix = null;
    ui.showcmd(null);
  }

  const activeEl = deepActiveElement();
  if (isTypingTarget(activeEl)) {
    if (commandName === 'toggleDisabled') run(commandName, 1, event);
    else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeEl.blur();
    }
    return;
  }

  if (prefixWasPending && !commandName) {
    event.preventDefault();
    event.stopImmediatePropagation();
    clearPending();
    return;
  }

  if (event.key === 'Escape') {
    if (pendingCount) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearPending();
    }
    return;
  }

  if (!commandName && /^[0-9]$/.test(key)) {
    if (pendingCount.length < 9) pendingCount += key;
    typedSeq += key;
    ui.showcmd(typedSeq);
    event.preventDefault();
    event.stopImmediatePropagation();
    restartTimer();
    return;
  }

  if (!commandName && prefixes[key]) {
    pendingPrefix = key;
    typedSeq += key;
    ui.showcmd(typedSeq);
    event.preventDefault();
    event.stopImmediatePropagation();
    restartTimer();
    return;
  }

  if (!commandName) commandName = settings.getKeymap()[key];
  if (!commandName) {

    clearPending();
    return;
  }

  const count = parseRepeatCount(pendingCount);
  const hadCount = pendingCount !== '';
  pendingCount = '';

  typedSeq += key;
  const seq = typedSeq || key;
  typedSeq = '';

  if (hadCount || prefixWasPending) ui.flash(seq);
  restartTimer();

  run(commandName, count, event);
}

async function boot() {
  await settings.load();

  Events.on('settingsChanged', () => {
    if (settings.isDisabled()) {
      setIgnore(false);
      exitPassthrough();
      Overlays.closeAll();
    }
  });

  window.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
}

setModeActions({ ignore: toggleIgnore, passthrough: enterPassthrough });

boot();

export { handleKeydown };

export function __resetState() {
  clearTimeout(timer);
  clearTimeout(passthroughTimer);
  timer = null;
  passthroughTimer = null;
  pendingCount = '';
  pendingPrefix = null;
  typedSeq = '';
  ignoreMode = false;
  passthroughMode = false;
  if (pills.ignore) hidePill('ignore');
  if (pills.passthrough) hidePill('passthrough');
}

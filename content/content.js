import {
  Events,
  canonicalKey,
  deepActiveElement,
  isPrefixKey,
  modifierKeys,
  parseRepeatCount,
} from "./keymap.js";
import { settings } from "./settings.js";
import { ui } from "./ui.js";
import { commands, setModeActions } from "./commands.js";
import { Overlays } from "./overlays.js";
import { isEditable } from "./hints-elements.js";
import { Find, __resetFindState } from "./find.js";
import { __resetVisualState } from "./visual.js";
import { Clue, __resetClueState } from "./clue.js";

let pendingCount = "";
let pendingKeys = "";
let timer = null;
let ignoreMode = false;
let passthroughMode = false;
let passthroughTimer = null;
const pills = {};

const PILL_IGNORE_TEXT = "ignore";
function pillPassthroughText() {
  return "passthrough (" + settings.getPassthroughMs() + "ms)";
}

function clearPending() {
  pendingCount = "";
  pendingKeys = "";
  ui.showcmd(null);
  Clue.hide();
}

function restartTimer() {
  clearTimeout(timer);
  timer = null;
  const timeoutMs = settings.getTimeoutMs();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
  timer = setTimeout(clearPending, timeoutMs);
}

function run(commandName, count, event) {
  const cmd = commands[commandName];
  if (!cmd) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  Clue.hide();
  cmd.run({ count: cmd.repeatable ? count : 1, event });
}

function setIgnore(on) {
  ignoreMode = on;
  clearPending();
  if (on) {
    Overlays.closeAll();
    showPill("ignore", PILL_IGNORE_TEXT);
  } else {
    hidePill("ignore");
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
  showPill("passthrough", pillPassthroughText());
  clearTimeout(passthroughTimer);
  passthroughTimer = null;
  const passthroughMs = settings.getPassthroughMs();
  if (Number.isFinite(passthroughMs) && passthroughMs > 0) {
    passthroughTimer = setTimeout(exitPassthrough, passthroughMs);
  }
}

function exitPassthrough() {
  if (!passthroughMode) return;
  clearTimeout(passthroughTimer);
  passthroughMode = false;
  hidePill("passthrough");
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
  Clue.hide();
  if (!ignoreMode && !passthroughMode) return;
  if (isFullscreen()) {
    hidePill("ignore");
    hidePill("passthrough");
  } else {
    if (ignoreMode) showPill("ignore", PILL_IGNORE_TEXT);
    if (passthroughMode) showPill("passthrough", pillPassthroughText());
  }
}

function handleKeydown(event) {
  if (!event.isTrusted) return;

  // The options page recorder claims keys while rebinding (see options.js).
  if (window.__jariOptionsRecording) {
    clearPending();
    return;
  }

  const overlay = Overlays.active();
  if (overlay) {
    Clue.hide();
    return overlay.onKeyDown(event);
  }

  if (modifierKeys.has(event.key)) return;

  if (passthroughMode) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitPassthrough();
    }
    return;
  }

  if (ignoreMode) {
    const key = canonicalKey(event);
    if (
      settings.getKeymap()[key] === "toggleIgnore" ||
      event.key === "Escape"
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleIgnore();
    }
    return;
  }

  if (settings.isDisabled()) {
    const key = canonicalKey(event);
    if (settings.getKeymap()[key] === "toggleSiteEnabled")
      run("toggleSiteEnabled", 1, event);
    return;
  }

  const key = canonicalKey(event);

  const buffer = pendingKeys;
  const bufferWasPending = buffer !== "";
  let commandName = null;
  if (bufferWasPending) {
    commandName = settings.getKeymap()[buffer + key] || null;
    if (commandName) {
      pendingKeys = "";
      ui.showcmd(null);
    }
  }

  const activeEl = deepActiveElement();
  if (isEditable(activeEl)) {
    if (commandName === "toggleSiteEnabled") run(commandName, 1, event);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeEl.blur();
    }
    return;
  }

  if (bufferWasPending && !commandName) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Backspace" && Clue.hasFilter()) {
      Clue.backspaceFilter();
      restartTimer();
      return;
    }
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      isPrefixKey(settings.getKeymap(), buffer + key)
    ) {
      pendingKeys = buffer + key;
      ui.showcmd(pendingCount + pendingKeys);
      Clue.refresh(pendingKeys, pendingCount);
      restartTimer();
      return;
    }
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key.length === 1 &&
      Clue.refilter(event.key)
    ) {
      restartTimer();
      return;
    }
    clearPending();
    return;
  }

  if (event.key === "Escape") {
    if (pendingCount) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearPending();
      return;
    }
    if (Find.hasHighlights()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      Find.handleGlobalEsc(event);
      return;
    }
    return;
  }

  if (event.key === "Enter" && Find.hasHighlights()) {
    if (Find.handleGlobalEnter(event)) return;
  }

  if (!commandName && /^[0-9]$/.test(key)) {
    if (pendingCount.length < 9) pendingCount += key;
    ui.showcmd(pendingCount);
    event.preventDefault();
    event.stopImmediatePropagation();
    restartTimer();
    return;
  }

  if (!commandName && isPrefixKey(settings.getKeymap(), key)) {
    pendingKeys = key;
    ui.showcmd(pendingCount + key);
    Clue.schedule(key, pendingCount);
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

  const countStr = pendingCount;
  const count = parseRepeatCount(pendingCount);
  const hadCount = countStr !== "";
  pendingCount = "";

  if (hadCount || bufferWasPending)
    ui.flash(countStr + buffer + key);
  restartTimer();

  run(commandName, count, event);
}

async function boot() {
  await settings.load();

  Events.on("settingsChanged", () => {
    Clue.hide();
    if (settings.isDisabled()) {
      setIgnore(false);
      exitPassthrough();
      Overlays.closeAll();
    }
  });

  window.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
}

setModeActions({ ignore: toggleIgnore, passthrough: enterPassthrough });

boot();

export { handleKeydown };

export function __resetState() {
  clearTimeout(timer);
  clearTimeout(passthroughTimer);
  timer = null;
  passthroughTimer = null;
  pendingCount = "";
  pendingKeys = "";
  ignoreMode = false;
  passthroughMode = false;
  if (pills.ignore) hidePill("ignore");
  if (pills.passthrough) hidePill("passthrough");
  try {
    __resetClueState();
  } catch {}
  try {
    __resetFindState();
  } catch {}
  try {
    __resetVisualState();
  } catch {}
}

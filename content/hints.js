// Jari: link-hint mode (f / i).
// Overlays a letter label on visible clickable/input elements; typing the
// label resolves it. Modes:
//   click  - activate the element (same tab)
//   newtab - open anchors in a background tab, otherwise click
//   yank   - copy the link URL to the clipboard (unbound by default)
//   focus  - focus inputs; auto-focuses when exactly one match exists
(() => {
  const Jari = window.Jari || (window.Jari = {});

  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Broad selector of "things you can click". Includes ARIA roles, inline
  // onclick handlers, and form controls; hidden inputs are excluded.
  const CLICKABLE_SELECTOR = [
    "a[href]",
    "area[href]",
    "button",
    "summary",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[contenteditable='true']",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='tab']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='switch']",
    "[role='option']",
    "[role='combobox']",
    "[onclick]",
  ].join(",");

  // Text-entry targets for focus mode ("i"): text-like inputs, textarea and
  // editable elements. Radio/checkbox/button/file/color/range are excluded.
  const TEXT_INPUT_TYPES = [
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
  ];
  const FOCUS_SELECTOR = [
    `input:not([type]), input[type="${TEXT_INPUT_TYPES.join('"], input[type="')}"]`,
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
  ].join(",");

  const MODES = {
    click: { selector: CLICKABLE_SELECTOR, activate: (el) => el.click() },
    newtab: { selector: CLICKABLE_SELECTOR, activate: openInNewTab },
    yank: { selector: CLICKABLE_SELECTOR, activate: yankLink },
    focus: { selector: FOCUS_SELECTOR, activate: (el) => el.focus() },
  };

  let mode = null;
  let labels = new Map(); // hint label -> target element
  let overlays = new Map(); // hint label -> overlay element
  let typed = "";

  function isActive() {
    return mode !== null;
  }

  function start(nextMode) {
    const config = MODES[nextMode];
    if (!config) return;
    cancel();

    const elements = topLevelElements(
      Array.from(document.querySelectorAll(config.selector)).filter(isInteractive),
    );
    if (nextMode === "focus" && elements.length === 1) {
      elements[0].focus();
      return;
    }
    if (elements.length === 0) {
      Jari.ui.toast("No matches");
      return;
    }

    mode = nextMode;
    const hintLabels = generateLabels(elements.length);
    elements.forEach((el, i) => {
      const label = hintLabels[i];
      labels.set(label, el);
      overlays.set(label, createHintOverlay(label, el));
    });
  }

  // An element must be on-screen and genuinely interactive: not disabled,
  // not hidden, and not an anchor without a usable href.
  function isInteractive(el) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.closest(".jari-overlay, .jari-hint")) return false;
    if (el.tagName === "A" || el.tagName === "AREA") {
      const href = el.getAttribute("href");
      if (href === null || href.trim() === "") return false;
    }
    return isVisible(el);
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Must be fully inside the viewport.
    if (rect.top < 0 || rect.left < 0 || rect.bottom > vh || rect.right > vw) return false;

    // Walk up the tree: an ancestor can hide the whole subtree even when the
    // element still reports a non-zero rect — e.g. custom-styled radios are
    // often opacity:0, or carousel slides are visibility:hidden.
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      if (node.hasAttribute("hidden")) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (parseFloat(style.opacity) === 0) return false;
      node = node.parentElement;
    }
    return true;
  }

  // Drop nested matches: if an element sits inside another matched element,
  // only keep the outermost one so hints don't pile up on the same spot
  // (e.g. <a><button>x</button></a>).
  function topLevelElements(elements) {
    const set = new Set(elements);
    return elements.filter((el) => {
      let parent = el.parentElement;
      while (parent) {
        if (set.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }

  // Always two characters (AA, AB, ... ZZ). Past 676 matches it grows to
  // three characters and beyond, so labels never duplicate.
  function generateLabels(count) {
    const n = ALPHABET.length;
    const labels = [];
    let i = 0;
    let length = 2;
    while (i < count) {
      const combos = Math.pow(n, length);
      for (let k = 0; k < combos && i < count; k++, i++) {
        labels.push(toBase26(k, length));
      }
      length++;
    }
    return labels;
  }

  function toBase26(value, length) {
    let s = "";
    for (let p = 0; p < length; p++) {
      s = ALPHABET[value % 26] + s;
      value = Math.floor(value / 26);
    }
    return s;
  }

  function createHintOverlay(label, el) {
    const rect = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "jari-hint";
    box.textContent = label;
    box.style.left = window.scrollX + rect.left + "px";
    box.style.top = window.scrollY + rect.top + "px";
    document.body.appendChild(box);
    return box;
  }

  function openInNewTab(el) {
    const href = el.href || el.getAttribute?.("href");
    // Only hand web-ish URLs to the background. Anything else (javascript:,
    // data:, mailto:, ...) is a same-tab click, which the site itself offers.
    if (href && /^(https?:|file:|about:)/i.test(href)) {
      Jari.sendMessage("openInBackgroundTab", { url: href });
    } else {
      el.click();
    }
  }

  function yankLink(el) {
    const href = el.href || el.getAttribute?.("href");
    if (href) {
      Jari.ui.copyText(href).then(() => Jari.ui.toast("Copied"));
    }
  }

  function onKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      cancel();
      return;
    }

    typed += event.key.toLowerCase();

    let exact = null;
    let partial = 0;
    for (const label of labels.keys()) {
      const lower = label.toLowerCase();
      if (lower === typed) exact = label;
      else if (lower.startsWith(typed)) partial++;
    }

    if (exact && partial === 0) {
      MODES[mode].activate(labels.get(exact));
      cancel();
      return;
    }
    if (!exact && partial === 0) {
      typed = "";
    }
    updateHighlight();
  }

  function updateHighlight() {
    for (const [label, box] of overlays) {
      box.classList.toggle("jari-hint-dim", !label.toLowerCase().startsWith(typed));
    }
  }

  function cancel() {
    for (const box of overlays.values()) box.remove();
    overlays.clear();
    labels.clear();
    typed = "";
    mode = null;
  }

  Jari.Hints = { start, cancel, onKeyDown, isActive };
})();

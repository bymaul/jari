// Jari: shared UI helpers for content scripts.
(() => {
  const Jari = window.Jari || (window.Jari = {});

  // Promise-based wrapper around chrome.runtime.sendMessage that works with
  // the callback-style API in both Chrome and Firefox.
  function sendMessage(action, payload = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action, ...payload }, (response) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  // Shared fixed container for the corner UI (toast, showcmd, mode pill): a
  // single flex row pinned flush to the bottom-right so the three sit side by
  // side instead of stacking. Lazy — created on first use.
  let statusStack = null;
  function statusContainer() {
    if (!statusStack) {
      statusStack = document.createElement("div");
      statusStack.className = "jari-status-stack";
      document.body.appendChild(statusStack);
    }
    return statusStack;
  }

  // A single toast element, reused: a new message replaces the old one
  // instead of stacking another pill in the row.
  let toastEl = null;
  let toastTimer = null;

  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "jari-toast";
      statusContainer().appendChild(toastEl);
    }
    toastEl.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.remove();
      toastEl = null;
    }, 1500);
  }

  // Copy text to the clipboard, with a fallback for contexts without async
  // clipboard support. Callers toast their own message.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  // Neovim-style showcmd readout: echoes the keys currently being composed
  // (count digits, prefix keys) in the bottom-right corner.
  let showcmdEl = null;
  let flashTimer = null;

  function showcmd(text) {
    if (!text) {
      if (showcmdEl) {
        showcmdEl.remove();
        showcmdEl = null;
      }
      return;
    }
    if (!showcmdEl) {
      showcmdEl = document.createElement("div");
      showcmdEl.className = "jari-showcmd";
      statusContainer().appendChild(showcmdEl);
    }
    showcmdEl.textContent = text;
  }

  // Show the composed key sequence for a moment after a command runs.
  function flash(text, ms = 600) {
    showcmd(text);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => showcmd(null), ms);
  }

  // Shared table shell for the help and options keybinding lists: a category
  // header row over a caller-supplied body renderer, so both overlays build
  // identical tables without duplicating the shell.
  function buildCategoryTable(cat, headerClass, renderBody) {
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const headerRow = document.createElement("tr");
    headerRow.className = headerClass;
    const th = document.createElement("th");
    th.colSpan = 2;
    th.textContent = cat.label;
    headerRow.appendChild(th);
    tbody.appendChild(headerRow);
    renderBody(tbody);
    table.appendChild(tbody);
    return table;
  }

  Jari.sendMessage = sendMessage;
  Jari.ui = { toast, showcmd, flash, copyText, statusContainer, buildCategoryTable };
})();

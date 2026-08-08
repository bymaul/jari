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

  function toast(message) {
    const el = document.createElement("div");
    el.className = "jari-overlay jari-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
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
  // (count digits, chord prefixes) in the bottom-left corner.
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
      document.body.appendChild(showcmdEl);
    }
    showcmdEl.textContent = text;
  }

  // Show the composed key sequence for a moment after a command runs. Plain
  // single keys may be echoed muted so they stay subtle.
  function flash(text, ms = 600, { muted = false } = {}) {
    showcmd(text);
    if (showcmdEl) showcmdEl.classList.toggle("muted", muted);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => showcmd(null), ms);
  }

  Jari.sendMessage = sendMessage;
  Jari.ui = { toast, showcmd, flash, copyText };
})();

// Jari: background service worker / event page entry.
// Bundled by build.js into background.js (IIFE classic script), so the
// manifest keeps pointing at a single classic file for both Chrome
// (service_worker) and Firefox (scripts array).
import { handlers } from "./handlers.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message && message.action];
  if (!handler) return;

  const result = handler(sender, message || {});
  if (result && typeof result.then === "function") {
    result.then(
      (value) => sendResponse(value || { ok: true }),
      (err) => {
        console.error(`[jari] ${message.action} failed`, err);
        sendResponse({ ok: false, error: String(err) });
      },
    );
    return true; // keep the message channel open for the async response
  }
  sendResponse(result || { ok: true });
});

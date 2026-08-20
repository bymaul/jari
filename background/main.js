import {
  handlers,
} from "./handlers.js";

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
    return true;
  }
  sendResponse(result || { ok: true });
});

import {
  handlers,
  coordinateHints,
  relayHintKey,
  handleRescan,
} from "./handlers.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "COORDINATE_HINTS") {
    coordinateHints(message, sender).then(sendResponse, () =>
      sendResponse({ needsRelay: false }),
    );
    return true;
  }

  if (message.type === "HINTS_KEY") {
    relayHintKey(message, sender);
    return;
  }

  if (message.type === "RESCAN_HINTS") {
    handleRescan(message, sender);
    return;
  }

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

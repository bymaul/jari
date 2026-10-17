import { handlers } from "./handlers.ts";
import type { Action } from "../shared/protocol.ts";

// Handlers live in JS until each module migrates, so they are dispatched with
// a loose internal signature; ui.sendMessage call sites are checked against
// shared/protocol.ts on the sender side.
type Handler = (
  sender: unknown,
  message: object,
) => Promise<unknown> | unknown;
type Thenable = {
  then: (onFulfilled: (value: unknown) => void, onRejected: (err: unknown) => void) => unknown;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = (handlers as Record<PropertyKey, Handler | undefined>)[
    (message && message.action) as Action
  ];
  if (!handler) return;

  const result = handler(sender, message || {}) as Thenable | object | null;
  if (result && typeof (result as Thenable).then === "function") {
    (result as Thenable).then(
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

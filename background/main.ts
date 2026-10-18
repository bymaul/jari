import { handlers } from "./handlers.ts";
import type { Action, Messages } from "../shared/protocol.ts";

type ResponseFor<A extends Action> = Messages[A]["response"];
type HandlerFor<A extends Action> = (
  sender: chrome.runtime.MessageSender,
  payload: Messages[A]["payload"],
) => ResponseFor<A> | Promise<ResponseFor<A>>;
type Thenable = {
  then: (onFulfilled: (value: unknown) => void, onRejected: (err: unknown) => void) => unknown;
};

// Compile-time dispatch contract: assigning the handlers table to this mapped
// type fails to build when an action is missing or a handler's payload or
// response drifts from shared/protocol.ts. Runtime dispatch stays duck-typed,
// because message contents come from content scripts unchecked.
const typedHandlers: { [A in Action]: HandlerFor<A> } = handlers;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = (
    typedHandlers as unknown as Record<
      PropertyKey,
      HandlerFor<Action> | undefined
    >
  )[(message && message.action) as Action];
  if (!handler) return;

  const result: unknown = handler(sender, message || {});
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

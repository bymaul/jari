import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import {
  clampCount,
  coordinateHints,
  normalizeUrl,
  relayHintKey,
} from "../background/handlers.js";
import { blockedUrlSchemes, suggestionSources, urlSchemes } from "../shared/constants.js";

test("normalizeUrl assumes https for bare hosts", () => {
  assert.equal(normalizeUrl("acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("acme.com/a/b"), "https://acme.com/a/b");
  assert.equal(normalizeUrl("//acme.com"), "https://acme.com");
});

test("normalizeUrl assumes http for localhost", () => {
  assert.equal(normalizeUrl("localhost"), "http://localhost");
  assert.equal(normalizeUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeUrl("localhost:8080/path"), "http://localhost:8080/path");
  assert.equal(normalizeUrl("127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("normalizeUrl rejects unsafe schemes", () => {
  assert.equal(normalizeUrl("http://acme.com"), "http://acme.com");
  assert.equal(normalizeUrl("https://acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
});

test("normalizeUrl allows chrome://", () => {
  assert.equal(normalizeUrl("chrome://settings"), "chrome://settings");
  assert.equal(normalizeUrl("chrome://extensions"), "chrome://extensions");
});

test("normalizeUrl keeps host:port but rejects unknown schemes", () => {
  assert.equal(normalizeUrl("mailto:foo@bar.com"), null);
  assert.equal(normalizeUrl("tel:+123"), null);
  assert.equal(normalizeUrl("steam:run/xyz"), null);
});

test("normalizeUrl rejects junk input", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl("two words"), null);
  assert.equal(normalizeUrl(42), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(undefined), null);
});

test("clampCount bounds and normalizes the count", () => {
  assert.equal(clampCount(1), 1);
  assert.equal(clampCount(5), 5);
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount(-3), 1);
  assert.equal(clampCount(50), 20);
  assert.equal(clampCount(2.9), 2);
  assert.equal(clampCount(NaN), 1);
  assert.equal(clampCount(Infinity), 1);
});

test("URL schemes and suggestion sources are the single shared source", () => {

  assert.ok(urlSchemes.has("https"));
  assert.ok(!urlSchemes.has("javascript"));
  assert.ok(blockedUrlSchemes.has("data"));
  assert.deepEqual(suggestionSources, ["tab", "history", "bookmark"]);
});

function chromeStub({ frames, countFor, keyResponse }) {
  const sent = [];
  globalThis.chrome = {
    webNavigation: {
      getAllFrames: async () => frames,
    },
    tabs: {
      onRemoved: { addListener() {} },
      sendMessage: async (_tabId, msg, opts) => {
        sent.push({ type: msg.type, ...msg, frameId: opts.frameId });
        if (msg.type === "COUNT_HINTS") return countFor(opts.frameId);
        if (msg.type === "HINTS_KEY") return keyResponse;
        return undefined;
      },
    },
  };
  return sent;
}

test("coordinateHints needs no relay when only the sender frame has hints", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }],
    countFor: () => 5,
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "click" },
    { tab: { id: 101 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, false);
  const draws = sent.filter((s) => s.type === "DRAW_HINTS");
  assert.equal(draws.length, 1);
  assert.equal(draws[0].frameId, 0);
  assert.equal(draws[0].startIndex, 0);
});

test("coordinateHints relays keys when hints span frames and closes on activation", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }, { frameId: 1 }],
    countFor: (id) => (id === 0 ? 2 : 3),
    keyResponse: { remaining: 1, closed: false },
  });
  const res = await coordinateHints(
    { mode: "click" },
    { tab: { id: 102 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, true);
  const draws = sent.filter((s) => s.type === "DRAW_HINTS");
  assert.deepEqual(
    draws.map((d) => [d.frameId, d.startIndex]),
    [
      [0, 0],
      [1, 2],
    ],
  );

  await relayHintKey(
    { key: "a", remaining: 0, closed: true },
    { tab: { id: 102 }, frameId: 0 },
  );
  const closes = sent.filter((s) => s.type === "HINTS_CLOSE");
  assert.deepEqual(closes.map((c) => c.frameId).sort(), [0, 1]);
});

test("coordinateHints relays when hints live only in another frame", async () => {
  chromeStub({
    frames: [{ frameId: 0 }, { frameId: 1 }],
    countFor: (id) => (id === 1 ? 3 : 0),
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "click" },
    { tab: { id: 103 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, true);
});

test("coordinateHints asks extension pages to draw locally instead of relaying", async () => {
  const sent = chromeStub({
    frames: [],
    countFor: () => 0,
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "click" },
    { frameId: 0 },
  );
  assert.equal(res.needsRelay, false);
  assert.equal(res.drawLocally, true);
  assert.equal(sent.length, 0);
});

test("coordinateHints resets every frame with a toast when nothing matches", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }, { frameId: 1 }],
    countFor: () => 0,
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "click" },
    { tab: { id: 104 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, false);
  const resets = sent.filter((s) => s.type === "HINTS_RESET");
  assert.deepEqual(resets.map((r) => r.frameId).sort(), [0, 1]);
  assert.equal(resets.find((r) => r.frameId === 0).toast, "No matches");
});

test("coordinateHints auto-focuses the single input in focus mode instead of hinting", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }, { frameId: 1 }],
    countFor: (id) => (id === 1 ? 1 : 0),
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "focus" },
    { tab: { id: 106 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, false);
  assert.equal(sent.filter((s) => s.type === "DRAW_HINTS").length, 0);
  const focuses = sent.filter((s) => s.type === "HINTS_FOCUS_SINGLE");
  assert.deepEqual(focuses.map((f) => f.frameId), [1]);
  const resets = sent.filter((s) => s.type === "HINTS_RESET");
  assert.deepEqual(resets.map((r) => r.frameId), [0]);
});

test("coordinateHints still hints focus mode when more than one input matches", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }],
    countFor: () => 2,
    keyResponse: null,
  });
  const res = await coordinateHints(
    { mode: "focus" },
    { tab: { id: 107 }, frameId: 0 },
  );
  assert.equal(res.needsRelay, false);
  assert.equal(sent.filter((s) => s.type === "HINTS_FOCUS_SINGLE").length, 0);
  assert.equal(sent.filter((s) => s.type === "DRAW_HINTS").length, 1);
});

test("relayHintKey leaves hints open while a key is only a partial match", async () => {
  const sent = chromeStub({
    frames: [{ frameId: 0 }, { frameId: 1 }],
    countFor: (id) => (id === 0 ? 2 : 3),
    keyResponse: { remaining: 1, closed: false },
  });
  await coordinateHints({ mode: "click" }, { tab: { id: 105 }, frameId: 0 });

  await relayHintKey(
    { key: "a", remaining: 2, closed: false },
    { tab: { id: 105 }, frameId: 0 },
  );
  assert.equal(sent.filter((s) => s.type === "HINTS_CLOSE").length, 0);
});

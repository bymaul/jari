import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { clampCount, getStoredSettings } from "../background/utils.js";
import { suggestionSources } from "../shared/constants.js";

test("background/utils direct import: clampCount", () => {
  assert.equal(clampCount(1), 1);
  assert.equal(clampCount(0), 1);
  assert.equal(clampCount(50), 20);
  assert.equal(clampCount(2.9), 2);
  assert.equal(clampCount(NaN), 1);
});

test("background/utils direct import: getStoredSettings prefers newer", async () => {
  const savedSync = globalThis.chrome.storage.sync.get;
  const savedLocal = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.sync.get = async () => ({ settings: { updatedAt: 1000, suggestionSources: ["tab"] } });
  globalThis.chrome.storage.local.get = async () => ({ settings: { updatedAt: 2000, suggestionSources: ["bookmark"] } });
  try {
    const s = await getStoredSettings();
    assert.deepEqual(s.suggestionSources, ["bookmark"]);
  } finally {
    globalThis.chrome.storage.sync.get = savedSync;
    globalThis.chrome.storage.local.get = savedLocal;
  }
});

test("background/utils direct import: suggestionSources single source", () => {
  assert.deepEqual(suggestionSources, ["tab", "history", "bookmark"]);
});

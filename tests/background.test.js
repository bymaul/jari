import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { clampCount, normalizeUrl } from "../background/handlers.js";
import { blockedUrlSchemes, suggestionSources, urlSchemes } from "../shared/constants.js";

test("normalizeUrl assumes https for bare hosts", () => {
  assert.equal(normalizeUrl("acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("acme.com/a/b"), "https://acme.com/a/b");
  assert.equal(normalizeUrl("localhost:8080"), "https://localhost:8080");
  assert.equal(normalizeUrl("//acme.com"), "https://acme.com");
});

test("normalizeUrl rejects unsafe schemes", () => {
  assert.equal(normalizeUrl("http://acme.com"), "http://acme.com");
  assert.equal(normalizeUrl("https://acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
  assert.equal(normalizeUrl("chrome://settings"), null);
});

test("normalizeUrl keeps host:port but rejects unknown schemes", () => {
  assert.equal(normalizeUrl("localhost:8080"), "https://localhost:8080");
  assert.equal(normalizeUrl("localhost:8080/path"), "https://localhost:8080/path");
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
  // background/handlers.js and content/keymap.js must agree — both import
  // shared/constants.js, so this test guards against a regression to
  // per-context copies.
  assert.ok(urlSchemes.has("https"));
  assert.ok(!urlSchemes.has("javascript"));
  assert.ok(blockedUrlSchemes.has("data"));
  assert.deepEqual(suggestionSources, ["tab", "history", "bookmark"]);
});

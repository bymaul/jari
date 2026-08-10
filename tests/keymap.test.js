"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { loadContentScript } = require("./harness.js");

const Jari = loadContentScript("keymap.js");

test("canonicalKey orders modifiers and keeps the bare key", () => {
  assert.equal(Jari.canonicalKey({ key: "g" }), "g");
  assert.equal(Jari.canonicalKey({ key: "t", ctrlKey: true, altKey: true }), "ctrl+alt+t");
  assert.equal(Jari.canonicalKey({ key: "G", metaKey: true }), "meta+G");
});

test("normalizeSettings fills defaults and drops invalid values", () => {
  const s = Jari.normalizeSettings({ scrollStep: 100, smoothScroll: true, keymap: { j: "scrollTop" } });
  assert.equal(s.scrollStep, 100);
  assert.equal(s.smoothScroll, true);
  assert.equal(s.keymap.j, "scrollTop");
  assert.equal(s.keymap.t, "omnibar");
  assert.equal(s.timeoutMs, 2000);

  const bad = Jari.normalizeSettings({ scrollStep: "x", timeoutMs: 0, disabledSites: "x" });
  assert.equal(bad.scrollStep, 200);
  assert.equal(bad.timeoutMs, 2000);
  assert.deepEqual(bad.disabledSites, []);
});

test("normalizeSettings migrates renamed command ids in stored keymaps", () => {
  const s = Jari.normalizeSettings({
    keymap: {
      p: "pasteOpenTab",
      P: "pasteOpenTabBackground",
      gu: "goParentUrl",
      gU: "goUrlRoot",
      d: "scrollHalfDown",
      u: "scrollHalfUp",
    },
  });
  assert.equal(s.keymap.p, "pasteOpen");
  assert.equal(s.keymap.P, "pasteOpenBackground");
  assert.equal(s.keymap.gu, "goUp");
  assert.equal(s.keymap.gU, "goToRoot");
  assert.equal(s.keymap.d, "scrollHalfPageDown");
  assert.equal(s.keymap.u, "scrollHalfPageUp");
  assert.equal(s.keymap.j, "scrollDown");
});

test("fuzzyMatch returns null when chars are missing or out of order", () => {
  assert.equal(Jari.fuzzyMatch("xyz", "abcdef"), null);
  assert.equal(Jari.fuzzyMatch("ba", "abc"), null);
  assert.equal(Jari.fuzzyMatch("", "anything"), null);
});

test("fuzzyMatch reports matched indices in order", () => {
  assert.deepEqual(Jari.fuzzyMatch("fb", "foo bar").indices, [0, 4]);
  assert.deepEqual(Jari.fuzzyMatch("gt", "gtx").indices, [0, 1]);
});

test("fuzzyMatch prefers consecutive runs and word starts", () => {
  const consecutive = Jari.fuzzyMatch("ab", "abxx").score;
  const scattered = Jari.fuzzyMatch("ab", "axb").score;
  assert.ok(consecutive > scattered);
  const wordStart = Jari.fuzzyMatch("ab", "ab").score;
  const midWord = Jari.fuzzyMatch("ab", "cab").score;
  assert.ok(wordStart > midWord);
});

test("balanceCategories spreads categories across the columns", () => {
  const byCategory = new Map([
    ["scrolling", ["scrollDown", "scrollUp"]],
    ["tabs", ["tabSearch"]],
    ["hints", ["linkHints", "linkHintsNewTab"]],
  ]);
  const columns = Jari.balanceCategories(byCategory, 3);
  const total = columns.reduce((n, col) => n + col.length, 0);
  assert.equal(total, 3);
  for (const col of columns) {
    for (const cat of col) assert.ok(byCategory.has(cat.id));
  }
});

test("Url.parentUrlOf climbs one path segment", () => {
  const { parentUrlOf } = Jari.Url;
  assert.equal(parentUrlOf("https://acme.com/1/2/3"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/1/2/"), "https://acme.com/1");
  assert.equal(parentUrlOf("https://acme.com/1/2/3.html"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(parentUrlOf("not a url"), "not a url");
});

test("Url.rootUrlOf climbs to the origin", () => {
  const { rootUrlOf } = Jari.Url;
  assert.equal(rootUrlOf("https://acme.com/1/2/3"), "https://acme.com/");
  assert.equal(rootUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(rootUrlOf("not a url"), "not a url");
});

test("Url.isSamePath ignores query and hash", () => {
  const { isSamePath } = Jari.Url;
  assert.ok(isSamePath("https://acme.com/", "https://acme.com/?ref=1"));
  assert.ok(!isSamePath("https://acme.com/a", "https://acme.com/b"));
});

test("Url.looksLikeUrl classifies bare queries", () => {
  const { looksLikeUrl } = Jari.Url;
  assert.ok(looksLikeUrl("https://acme.com/a"));
  assert.ok(looksLikeUrl("//acme.com"));
  assert.ok(looksLikeUrl("localhost:8080/path"));
  assert.ok(looksLikeUrl("acme.com/a:b"));
  assert.ok(looksLikeUrl("sub.example.com"));
  assert.ok(!looksLikeUrl("hello world"));
  assert.ok(!looksLikeUrl("acme"));
  assert.ok(!looksLikeUrl(""));
});

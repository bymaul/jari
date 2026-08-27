import { test } from "node:test";
import assert from "node:assert";
import * as Jari from "../content/keymap.js";

test("canonicalKey orders modifiers and keeps the bare key", () => {
  assert.equal(Jari.canonicalKey({ key: "g" }), "g");
  assert.equal(Jari.canonicalKey({ key: "t", ctrlKey: true, altKey: true }), "ctrl+alt+t");
  assert.equal(Jari.canonicalKey({ key: "G", metaKey: true }), "meta+G");
});

test("parseRepeatCount clamps counts to at least 1", () => {
  assert.equal(Jari.parseRepeatCount("3"), 3);
  assert.equal(Jari.parseRepeatCount("05"), 5);
  assert.equal(Jari.parseRepeatCount("0"), 1);
  assert.equal(Jari.parseRepeatCount(""), 1);
  assert.equal(Jari.parseRepeatCount(undefined), 1);
});

test("normalizeSettings treats a stored keymap as authoritative and drops invalid values", () => {
  const s = Jari.normalizeSettings({ scrollStep: 100, smoothScroll: true, keymap: { j: "scrollTop" } });
  assert.equal(s.scrollStep, 100);
  assert.equal(s.smoothScroll, true);
  assert.equal(s.keymap.j, "scrollTop");
  assert.equal(s.keymap.t, undefined);
  assert.equal(s.timeoutMs, 1500);
  assert.deepEqual(s.suggestionSources, ["tab", "history", "bookmark"]);
  assert.equal(s.copyFormat, "plain");

  const bad = Jari.normalizeSettings({ scrollStep: "x", timeoutMs: 0, disabledSites: "x" });
  assert.equal(bad.scrollStep, 120);
  assert.equal(bad.timeoutMs, 1500);
  assert.deepEqual(bad.disabledSites, []);

  assert.equal(Jari.normalizeSettings({}).fuzzyMatching, true);
  assert.equal(Jari.normalizeSettings({ fuzzyMatching: false }).fuzzyMatching, false);
});

test("normalizeSettings fills defaults only when no keymap is stored", () => {
  const s = Jari.normalizeSettings({});
  assert.equal(s.keymap.t, "omnibar");
  assert.equal(s.keymap.p, "passthrough");
});

test("rebinding away a default key removes the default binding", () => {
  const s = Jari.normalizeSettings({ keymap: { z: "passthrough" } });
  assert.equal(s.keymap.z, "passthrough");
  assert.equal(s.keymap.p, undefined);
});

test("normalizeSettings validates suggestionSources and copyFormat", () => {
  const s = Jari.normalizeSettings({
    suggestionSources: ["tab"],
    copyFormat: "markdown",
  });
  assert.deepEqual(s.suggestionSources, ["tab"]);
  assert.equal(s.copyFormat, "markdown");

  assert.deepEqual(Jari.normalizeSettings({ suggestionSources: [] }).suggestionSources, []);
  assert.deepEqual(
    Jari.normalizeSettings({ suggestionSources: ["tab", "bogus", "bookmark"] }).suggestionSources,
    ["tab", "bookmark"],
  );
  assert.equal(Jari.normalizeSettings({ copyFormat: "bogus" }).copyFormat, "plain");
});

test("balanceCategories spreads categories across the columns", () => {
  const byCategory = new Map([
    ["scrolling", ["scrollDown", "scrollUp"]],
    ["tabs", ["tabSearch"]],
  ]);
  const columns = Jari.balanceCategories(byCategory, 3);
  const total = columns.reduce((n, col) => n + col.length, 0);
  assert.equal(total, 2);
  for (const col of columns) {
    for (const cat of col) assert.ok(byCategory.has(cat.id));
  }
});
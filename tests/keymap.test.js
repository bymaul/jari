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
  const s = Jari.normalizeSettings({ scrollStep: 100, smoothScroll: true, keymap: { j: "scrollToTop" } });
  assert.equal(s.scrollStep, 100);
  assert.equal(s.smoothScroll, true);
  assert.equal(s.keymap.j, "scrollToTop");
  assert.equal(s.keymap.t, "openOmnibar");
  assert.equal(s.timeoutMs, Jari.settingsDefaults.timeoutMs);
  assert.deepEqual(s.suggestionSources, ["tab", "history", "bookmark"]);
  assert.equal(s.copyFormat, "plain");

  const bad = Jari.normalizeSettings({ scrollStep: "x", timeoutMs: -1, disabledSites: "x" });
  assert.equal(bad.scrollStep, 120);
  assert.equal(bad.timeoutMs, Jari.settingsDefaults.timeoutMs);
  assert.deepEqual(bad.disabledSites, []);
});

test("normalizeSettings allows a zero timeout to disable the expiry", () => {
  assert.equal(Jari.normalizeSettings({ timeoutMs: 0 }).timeoutMs, 0);
  assert.equal(Jari.normalizeSettings({ passthroughMs: 0 }).passthroughMs, 0);
});

test("rebinding away a default key removes the default binding", () => {
  const s = Jari.normalizeSettings({ keymap: { z: "passthroughKeys" } });
  assert.equal(s.keymap.z, "passthroughKeys");
  assert.equal(s.keymap.p, undefined);
});

test("normalizeSettings drops keymap entries with bogus commands or keys", () => {
  const s = Jari.normalizeSettings({
    keymap: { j: "scrollDown", x: "bogusCommand", "": "scrollUp" },
  });
  assert.equal(s.keymap.j, "scrollDown");
  assert.equal(s.keymap.x, undefined);
  assert.equal(s.keymap[""], undefined);
});

test("balanceCategories spreads categories across the columns", () => {
  const byCategory = new Map([
    ["scrolling", ["scrollDown", "scrollUp"]],
    ["tabs", ["openOmnibar"]],
  ]);
  const columns = Jari.balanceCategories(byCategory, 3);
  const total = columns.reduce((n, col) => n + col.length, 0);
  assert.equal(total, 2);
  for (const col of columns) {
    for (const cat of col) assert.ok(byCategory.has(cat.id));
  }
});

test("isReservedCombo reserves bare digits for the repeat count", () => {
  assert.equal(Jari.isReservedCombo("5"), true);
  assert.equal(Jari.isReservedCombo("0"), true);
  assert.equal(Jari.isReservedCombo("ctrl+5"), false);
  assert.equal(Jari.isReservedCombo("g"), false);
  assert.equal(Jari.isReservedCombo("gg"), false);
});

test("findBindingConflict reports only bindings owned by another command", () => {
  const keymap = { j: "scrollDown", k: "scrollUp" };
  assert.equal(Jari.findBindingConflict(keymap, "j", "scrollUp"), "scrollDown");
  assert.equal(Jari.findBindingConflict(keymap, "j", "scrollDown"), null);
  assert.equal(Jari.findBindingConflict(keymap, "z", "scrollDown"), null);
});

test("normalizeSettings stamps the schema version and migrates v0 data", () => {
  assert.equal(Jari.normalizeSettings({}).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  const migrated = Jari.normalizeSettings({ keymap: { j: "scrollDown" } });
  assert.equal(migrated.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(migrated.keymap.j, "scrollDown");
  assert.deepEqual(Jari.migrateSettings(null).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(Jari.migrateSettings({ schemaVersion: 1 }).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
});

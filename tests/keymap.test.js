import { test } from "node:test";
import assert from "node:assert";
import * as Jari from "../content/keymap.js";
import { COMMAND_CATALOG } from "../content/catalog.js";

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

  assert.equal(Jari.normalizeSettings({}).fuzzyMatching, true);
  assert.equal(Jari.normalizeSettings({ fuzzyMatching: false }).fuzzyMatching, false);
});

test("normalizeSettings allows a zero timeout to disable the expiry", () => {
  assert.equal(Jari.normalizeSettings({ timeoutMs: 0 }).timeoutMs, 0);
  assert.equal(Jari.normalizeSettings({ passthroughMs: 0 }).passthroughMs, 0);
});

test("normalizeSettings fills defaults only when no keymap is stored", () => {
  const s = Jari.normalizeSettings({});
  assert.equal(s.keymap.t, "openOmnibar");
  assert.equal(s.keymap.T, "openOmnibarIncognito");
  assert.equal(s.keymap.p, "passthroughKeys");
});

test("rebinding away a default key removes the default binding", () => {
  const s = Jari.normalizeSettings({ keymap: { z: "passthroughKeys" } });
  assert.equal(s.keymap.z, "passthroughKeys");
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

test("normalizeSettings clamps maxResults", () => {
  assert.equal(Jari.normalizeSettings({}).maxResults, 50);
  assert.equal(Jari.normalizeSettings({ maxResults: 10 }).maxResults, 10);
  assert.equal(Jari.normalizeSettings({ maxResults: 4 }).maxResults, 5);
  assert.equal(Jari.normalizeSettings({ maxResults: 101 }).maxResults, 100);
  assert.equal(Jari.normalizeSettings({ maxResults: 7.9 }).maxResults, 7);
  assert.equal(Jari.normalizeSettings({ maxResults: "lots" }).maxResults, 50);
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

test("keysForCommand lists every key bound to a command", () => {
  const keymap = { j: "scrollDown", z: "scrollDown", k: "scrollUp" };
  assert.deepEqual(Jari.keysForCommand(keymap, "scrollDown").sort(), ["j", "z"]);
  assert.deepEqual(Jari.keysForCommand(keymap, "scrollUp"), ["k"]);
  assert.deepEqual(Jari.keysForCommand(keymap, "closeTab"), []);
});

test("isBindablePrefixStarter allows any single non-digit key", () => {
  assert.equal(Jari.isBindablePrefixStarter("z"), true);
  assert.equal(Jari.isBindablePrefixStarter("g"), true);
  assert.equal(Jari.isBindablePrefixStarter(";"), true);
  assert.equal(Jari.isBindablePrefixStarter("G"), true);
  assert.equal(Jari.isBindablePrefixStarter(","), true);
  assert.equal(Jari.isBindablePrefixStarter("5"), false);
  assert.equal(Jari.isBindablePrefixStarter("0"), false);
  assert.equal(Jari.isBindablePrefixStarter("ctrl+t"), false);
  assert.equal(Jari.isBindablePrefixStarter("gg"), false);
  assert.equal(Jari.isBindablePrefixStarter(""), false);
});

test("findOverlapConflicts reports prefix shadowing in both directions", () => {
  const keymap = { z: "closeTab", zf: "hintYank", j: "scrollDown" };
  assert.deepEqual(Jari.findOverlapConflicts(keymap, "z"), [
    { key: "zf", command: "hintYank", kind: "shadows" },
  ]);
  assert.deepEqual(Jari.findOverlapConflicts(keymap, "zf"), [
    { key: "z", command: "closeTab", kind: "shadowed-by" },
  ]);
  assert.deepEqual(Jari.findOverlapConflicts(keymap, "j"), []);
  assert.deepEqual(Jari.findOverlapConflicts(keymap, "ctrl+t"), []);
});

test("normalizeSettings keeps bare prefix bindings so custom prefixes survive", () => {
  const s = Jari.normalizeSettings({ keymap: { z: "closeTab", zf: "hintYank" } });
  assert.equal(s.keymap.z, "closeTab");
  assert.equal(s.keymap.zf, "hintYank");
});

test(";w resets the scroll target without conflicting with ;e/;x", () => {
  assert.equal(Jari.keymapDefaults[";w"], "resetScrollTarget");
  assert.equal(COMMAND_CATALOG.resetScrollTarget.category, "scrolling");
  assert.equal(Jari.findBindingConflict(Jari.keymapDefaults, ";w", "resetScrollTarget"), null);
  assert.ok(Jari.isPrefixKey(Jari.keymapDefaults, ";"));
  assert.deepEqual(
    Jari.findOverlapConflicts(Jari.keymapDefaults, ";w").filter((o) => o.key === ";"),
    [],
  );
});

test("normalizeSettings stamps the schema version and migrates v0 data", () => {
  assert.equal(Jari.normalizeSettings({}).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  const migrated = Jari.normalizeSettings({ keymap: { j: "scrollDown" } });
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.keymap.j, "scrollDown");
  assert.deepEqual(Jari.migrateSettings(null).schemaVersion, 4);
  assert.equal(Jari.migrateSettings({ schemaVersion: 1 }).schemaVersion, 4);
});

test("v1 settings migrate forward keeping data and gaining clickableSelector", () => {
  const v1 = { schemaVersion: 1, keymap: { j: "scrollDown" }, scrollStep: 200 };
  const migrated = Jari.normalizeSettings(v1);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.keymap.j, "scrollDown");
  assert.equal(migrated.scrollStep, 200);
  assert.equal(migrated.clickableSelector, "");
  const custom = Jari.normalizeSettings({ clickableSelector: "div.card" });
  assert.equal(custom.clickableSelector, "div.card");
});

test("v2 settings migrate forward gaining hint theme and size", () => {
  const v2 = { schemaVersion: 2, hintTheme: "cyan", hintFontSize: 14 };
  const migrated = Jari.normalizeSettings(v2);
  assert.equal(migrated.schemaVersion, 4);
  assert.equal(migrated.hintTheme, "cyan");
  assert.equal(migrated.hintFontSize, 14);
  const bare = Jari.normalizeSettings({ schemaVersion: 2 });
  assert.equal(bare.hintTheme, "yellow");
  assert.equal(bare.hintFontSize, 10);
});

test("v3 keymaps gain new default bindings without clobbering customs", () => {
  const old = {
    schemaVersion: 3,
    keymap: { j: "scrollToTop", x: "closeTab", gf: "hintYank" },
  };
  const s = Jari.normalizeSettings(old);
  assert.equal(s.schemaVersion, 4);
  assert.equal(s.keymap.j, "scrollToTop");
  assert.equal(s.keymap.x, "closeTab");
  assert.equal(s.keymap.gf, "hintYank");
  assert.equal(s.keymap[";w"], "resetScrollTarget");
});

test("backfillNewBindings only fills free combos for unused commands", () => {
  assert.equal(Jari.backfillNewBindings(null), null);
  const filled = Jari.backfillNewBindings({});
  assert.equal(filled[";w"], "resetScrollTarget");
  assert.equal(filled.j, "scrollDown");
  const full = { ...Jari.keymapDefaults };
  assert.deepEqual(Jari.backfillNewBindings(full), full);
});

test("normalizeHintTheme falls back to yellow for unknown themes", () => {
  assert.equal(Jari.normalizeHintTheme("dark"), "dark");
  assert.equal(Jari.normalizeHintTheme("cyan"), "cyan");
  assert.equal(Jari.normalizeHintTheme("neon"), "yellow");
  assert.equal(Jari.normalizeHintTheme(null), "yellow");
});

test("normalizeHintFontSize clamps to 8-20px", () => {
  assert.equal(Jari.normalizeHintFontSize(14), 14);
  assert.equal(Jari.normalizeHintFontSize(4), 8);
  assert.equal(Jari.normalizeHintFontSize(99), 20);
  assert.equal(Jari.normalizeHintFontSize(12.6), 13);
  assert.equal(Jari.normalizeHintFontSize("big"), 10);
});

test("normalizeClickableSelector trims and caps the selector", () => {
  assert.equal(Jari.normalizeClickableSelector("  div.card  "), "div.card");
  assert.equal(Jari.normalizeClickableSelector(""), "");
  assert.equal(Jari.normalizeClickableSelector(null), "");
  assert.equal(Jari.normalizeClickableSelector("x".repeat(600)).length, 500);
});

test("normalizeSettings cleans disabled site patterns", () => {
  const s = Jari.normalizeSettings({
    disabledSites: ["Example.COM", "*.example.com", "bogus host", "", "file://"],
  });
  assert.deepEqual(s.disabledSites, ["example.com", "*.example.com", "file://"]);
  assert.deepEqual(Jari.normalizeSettings({}).disabledSites, []);
});

test("isBrowserTrapped flags combos the page may never see", () => {
  assert.equal(Jari.isBrowserTrapped("ctrl+t"), true);
  assert.equal(Jari.isBrowserTrapped("ctrl+Tab"), true);
  assert.equal(Jari.isBrowserTrapped("F5"), true);
  assert.equal(Jari.isBrowserTrapped("j"), false);
  assert.equal(Jari.isBrowserTrapped("gg"), false);
  assert.equal(Jari.isBrowserTrapped("ctrl+f"), false);
});

test("find toggles default to Alt chords without conflicts", () => {
  assert.equal(Jari.keymapDefaults["alt+r"], "toggleFindRegex");
  assert.equal(Jari.keymapDefaults["alt+w"], "toggleFindWholeWord");
  assert.equal(Jari.keymapDefaults["alt+c"], "toggleFindCase");
  assert.equal(COMMAND_CATALOG.toggleFindRegex.category, "find");
  assert.equal(
    Jari.findBindingConflict(Jari.keymapDefaults, "alt+r", "toggleFindRegex"),
    null,
  );
});

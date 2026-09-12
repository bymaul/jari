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

test("normalizeSettings drops keymap entries with bogus commands or keys", () => {
  const s = Jari.normalizeSettings({
    keymap: { j: "scrollDown", x: "bogusCommand", "": "scrollUp" },
  });
  assert.equal(s.keymap.j, "scrollDown");
  assert.equal(s.keymap.x, undefined);
  assert.equal(s.keymap[""], undefined);
});

test("normalizeSettings clamps scroll steps and timeouts to the UI bounds", () => {
  assert.equal(Jari.normalizeSettings({ scrollStep: 0 }).scrollStep, 120);
  assert.equal(Jari.normalizeSettings({ scrollStep: 501 }).scrollStep, 120);
  assert.equal(Jari.normalizeSettings({ scrollStep: 120.9 }).scrollStep, 120);
  assert.equal(Jari.normalizeSettings({ scrollStep: 200 }).scrollStep, 200);
  assert.equal(Jari.normalizeSettings({ timeoutMs: 99999 }).timeoutMs, 10000);
  assert.equal(Jari.normalizeSettings({ passthroughMs: 99999 }).passthroughMs, 30000);
});

test("normalizeClickableSelector rejects invalid selectors when DOM is present", () => {
  const savedDocument = globalThis.document;
  try {
    globalThis.document = {
      querySelector: (sel) => {
        if (sel === "[") throw new Error("invalid selector");
        return null;
      },
    };
    assert.equal(Jari.normalizeClickableSelector("["), "");
    assert.equal(Jari.normalizeClickableSelector("div.card"), "div.card");
    assert.equal(Jari.normalizeClickableSelector(""), "");
  } finally {
    globalThis.document = savedDocument;
  }
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
  assert.equal(migrated.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(migrated.keymap.j, "scrollDown");
  assert.deepEqual(Jari.migrateSettings(null).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(Jari.migrateSettings({ schemaVersion: 1 }).schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
});

test("v1 settings migrate forward keeping data and gaining clickableSelector", () => {
  const v1 = { schemaVersion: 1, keymap: { j: "scrollDown" }, scrollStep: 200 };
  const migrated = Jari.normalizeSettings(v1);
  assert.equal(migrated.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(migrated.keymap.j, "scrollDown");
  assert.equal(migrated.scrollStep, 200);
  assert.equal(migrated.clickableSelector, "");
  const custom = Jari.normalizeSettings({ clickableSelector: "div.card" });
  assert.equal(custom.clickableSelector, "div.card");
});

test("v2 settings migrate forward gaining hint theme and size", () => {
  const v2 = { schemaVersion: 2, hintTheme: "cyan", hintFontSize: 14 };
  const migrated = Jari.normalizeSettings(v2);
  assert.equal(migrated.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
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
  assert.equal(s.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.equal(s.keymap.j, "scrollToTop");
  assert.equal(s.keymap.x, "closeTab");
  assert.equal(s.keymap.gf, "hintYank");
  assert.equal(s.keymap[";w"], "resetScrollTarget");
});

test("v4 settings migrate forward gaining seeded search engines", () => {
  const v4 = { schemaVersion: 4, keymap: { j: "scrollDown" } };
  const s = Jari.normalizeSettings(v4);
  assert.equal(s.schemaVersion, Jari.SETTINGS_SCHEMA_VERSION);
  assert.deepEqual(
    s.searchEngines.map((e) => e.keyword),
    ["g", "yt", "gh", "wiki", "chat"],
  );
  assert.equal(s.defaultEngine, "g");
  const custom = Jari.normalizeSettings({
    schemaVersion: 4,
    searchEngines: [
      { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
      { keyword: "g", url: "https://www.google.com/search?q=%s" },
    ],
    defaultEngine: "ddg",
  });
  assert.deepEqual(
    custom.searchEngines.map((e) => e.keyword),
    ["ddg", "g"],
  );
  assert.equal(custom.defaultEngine, "ddg");
  const dangling = Jari.normalizeSettings({
    schemaVersion: 4,
    searchEngines: [{ keyword: "ddg", url: "https://duckduckgo.com/?q=%s" }],
    defaultEngine: "g",
  });
  assert.equal(dangling.defaultEngine, "ddg");
});

test("backfillNewBindings only fills free combos for unused commands", () => {
  assert.equal(Jari.backfillNewBindings(null), null);
  const filled = Jari.backfillNewBindings({});
  assert.equal(filled[";w"], "resetScrollTarget");
  assert.equal(filled.j, "scrollDown");
  const full = { ...Jari.keymapDefaults };
  assert.deepEqual(Jari.backfillNewBindings(full), full);
});

test("link yank binds are two keys without conflicts", () => {
  assert.equal(Jari.keymapDefaults.yf, "hintYank");
  assert.equal(Jari.keymapDefaults.yF, "hintYankText");
  for (const [combo, command] of [["yf", "hintYank"], ["yF", "hintYankText"]]) {
    assert.equal(Jari.findBindingConflict(Jari.keymapDefaults, combo, command), null);
    assert.deepEqual(Jari.findOverlapConflicts(Jari.keymapDefaults, combo), []);
    assert.equal(Jari.isBrowserTrapped(combo), false);
  }
});

test("migrateYankBindings swaps default-shaped yfa/yft for yf/yF", () => {
  const swapped = Jari.migrateYankBindings({
    j: "scrollDown",
    yfa: "hintYank",
    yft: "hintYankText",
  });
  assert.equal(swapped.yf, "hintYank");
  assert.equal(swapped.yF, "hintYankText");
  assert.equal(swapped.j, "scrollDown");
  assert.equal(swapped.yfa, undefined);
  assert.equal(swapped.yft, undefined);
});

test("migrateYankBindings leaves custom rebinds and occupied targets alone", () => {
  const custom = {
    yfa: "scrollDown",
    yft: "hintYankText",
    yF: "closeTab",
  };
  assert.deepEqual(Jari.migrateYankBindings(custom), custom);
  assert.equal(Jari.migrateYankBindings(null), null);
  assert.deepEqual(Jari.migrateYankBindings([]), []);
});

test("v5 stored keymaps migrate yank binds through v7", () => {
  const s = Jari.normalizeSettings({
    schemaVersion: 5,
    keymap: { yfa: "hintYank", yft: "hintYankText" },
  });
  assert.equal(s.schemaVersion, 7);
  assert.equal(s.keymap.yf, "hintYank");
  assert.equal(s.keymap.yF, "hintYankText");
  assert.equal(s.keymap.yfa, undefined);
  assert.equal(s.keymap.yft, undefined);
});

test("stored keymaps without yank binds keep them unbound through v7", () => {
  const s = Jari.normalizeSettings({ schemaVersion: 5, keymap: { j: "scrollDown" } });
  assert.equal(s.schemaVersion, 7);
  assert.equal(s.keymap.j, "scrollDown");
  for (const combo of ["yf", "yF", "yfa", "yft"]) {
    assert.equal(s.keymap[combo], undefined);
  }
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

test("find toggles default to alt+1/2/3 without conflicts", () => {
  assert.equal(Jari.keymapDefaults["alt+1"], "toggleFindRegex");
  assert.equal(Jari.keymapDefaults["alt+2"], "toggleFindWholeWord");
  assert.equal(Jari.keymapDefaults["alt+3"], "toggleFindCase");
  assert.equal(Jari.keymapDefaults["alt+r"], undefined);
  assert.equal(Jari.keymapDefaults["alt+w"], undefined);
  assert.equal(Jari.keymapDefaults["alt+c"], undefined);
  assert.equal(COMMAND_CATALOG.toggleFindRegex.category, "find");
  for (const [combo, command] of [
    ["alt+1", "toggleFindRegex"],
    ["alt+2", "toggleFindWholeWord"],
    ["alt+3", "toggleFindCase"],
    ["d", "scrollHalfPageDown"],
    ["u", "scrollHalfPageUp"],
  ]) {
    assert.equal(Jari.findBindingConflict(Jari.keymapDefaults, combo, command), null);
    assert.deepEqual(Jari.findOverlapConflicts(Jari.keymapDefaults, combo), []);
    assert.equal(Jari.isBrowserTrapped(combo), false);
  }
  assert.equal(Jari.keymapDefaults.d, "scrollHalfPageDown");
  assert.equal(Jari.keymapDefaults.u, "scrollHalfPageUp");
});

test("migrateFindToggleBindings prunes old toggles and fills the new binds", () => {
  const swapped = Jari.migrateFindToggleBindings({
    j: "scrollDown",
    "alt+r": "toggleFindRegex",
    "alt+w": "toggleFindWholeWord",
    "alt+c": "toggleFindCase",
  });
  assert.equal(swapped["alt+1"], "toggleFindRegex");
  assert.equal(swapped["alt+2"], "toggleFindWholeWord");
  assert.equal(swapped["alt+3"], "toggleFindCase");
  assert.equal(swapped.d, "scrollHalfPageDown");
  assert.equal(swapped.u, "scrollHalfPageUp");
  assert.equal(swapped.j, "scrollDown");
  for (const combo of ["alt+r", "alt+w", "alt+c"]) {
    assert.equal(swapped[combo], undefined);
  }
});

test("migrateFindToggleBindings leaves custom rebinds and occupied combos alone", () => {
  const custom = {
    "alt+r": "closeTab",
    "alt+1": "reloadTab",
    "alt+w": "toggleFindWholeWord",
  };
  const out = Jari.migrateFindToggleBindings(custom);
  assert.equal(out["alt+r"], "closeTab");
  assert.equal(out["alt+1"], "reloadTab");
  assert.equal(out["alt+2"], "toggleFindWholeWord");
  assert.equal(out["alt+w"], undefined);
  assert.equal(Jari.migrateFindToggleBindings(null), null);
  assert.deepEqual(Jari.migrateFindToggleBindings([]), []);
});

test("v6 stored keymaps migrate to the new toggle binds and stamp v7", () => {
  const s = Jari.normalizeSettings({
    schemaVersion: 6,
    keymap: { "alt+r": "toggleFindRegex" },
  });
  assert.equal(s.schemaVersion, 7);
  assert.equal(s.keymap["alt+1"], "toggleFindRegex");
  assert.equal(s.keymap["alt+r"], undefined);
  assert.equal(s.keymap.d, "scrollHalfPageDown");
});

test("prefix helpers work for multi-key sequences", () => {
  const keymap = { gfk: "hintYank", gu: "goToParent" };
  assert.equal(Jari.isPrefixKey(keymap, "g"), true);
  assert.equal(Jari.isPrefixKey(keymap, "gf"), true);
  assert.equal(Jari.isPrefixKey(keymap, "gfk"), false);
  assert.equal(Jari.isPrefixKey(keymap, "x"), false);
  assert.deepEqual(
    Jari.getPrefixEntries(keymap, "gf").map((e) => e.suffix),
    ["k"],
  );
  assert.deepEqual(
    Jari.getPrefixEntries(keymap, "g")
      .map((e) => e.suffix)
      .sort(),
    ["fk", "u"],
  );
});

test("displayCombo names the space key", () => {
  assert.equal(Jari.displayCombo(" "), "<Space>");
  assert.equal(Jari.displayCombo("g "), "g <Space>");
  assert.equal(Jari.displayCombo("ctrl+ "), "ctrl+ <Space>");
  assert.equal(Jari.displayCombo("gf"), "gf");
  assert.equal(Jari.displayCombo("ctrl+t"), "ctrl+t");
  assert.equal(Jari.displayCombo(""), "");
  assert.equal(Jari.displayCombo(null), null);
});

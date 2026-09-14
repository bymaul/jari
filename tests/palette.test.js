import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { buildCommandSource, filterCommands } from "../content/palette.js";
import { COMMAND_CATALOG } from "../content/catalog.js";
import { keymapDefaults } from "../content/keymap.js";

test("command source covers the catalog with keys and unbound marks", () => {
  const items = buildCommandSource(keymapDefaults);
  assert.equal(items.length, Object.keys(COMMAND_CATALOG).length);
  const byName = new Map(items.map((item) => [item.name, item]));
  assert.equal(byName.get("scrollDown").detail, "j");
  assert.equal(byName.get("toggleBookmark").detail, "unbound");
  assert.equal(byName.get("showCommandPalette").detail, ":");
  assert.ok(byName.get("hintYank").title.includes("hintYank"));
});

test("empty query returns every command", () => {
  const items = buildCommandSource(keymapDefaults);
  assert.deepEqual(filterCommands(items, ""), items);
  assert.deepEqual(filterCommands(items, "   "), items);
});

test("fuzzy filter finds commands by label or name", () => {
  const items = buildCommandSource(keymapDefaults);
  const results = filterCommands(items, "bookmark");
  assert.ok(results.length > 0);
  assert.equal(results[0].name, "toggleBookmark");
});

test("fuzzy filter finds commands by bound keys", () => {
  const items = buildCommandSource(keymapDefaults);
  const results = filterCommands(items, "gf");
  assert.ok(results.some((item) => item.name === "hintOpenBackground"));
});

test("substring filter matches keys and labels", () => {
  const items = buildCommandSource(keymapDefaults);
  const byKeys = filterCommands(items, "[[", false);
  assert.ok(byKeys.some((item) => item.name === "prevPage"));
  const byLabel = filterCommands(items, "incognito", false);
  assert.ok(byLabel.some((item) => item.name === "openOmnibarIncognito"));
  assert.deepEqual(filterCommands(items, "zzz-no-such-command", false), []);
});

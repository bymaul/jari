import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { buildMatcher, hasUpperCase } from "../content/find/matcher.js";

test("find/matcher direct import: buildMatcher is a literal substring", () => {
  const sub = buildMatcher("a.c");
  assert.ok(sub.test("a.c"));
  assert.ok(!sub.test("aXc"));
  assert.equal(buildMatcher(""), null);
});

test("find/matcher direct import: hasUpperCase", () => {
  assert.equal(hasUpperCase("abc"), false);
  assert.equal(hasUpperCase("aBc"), true);
  assert.equal(hasUpperCase("Äpfel"), true);
});

test("find/matcher direct import: caseSensitive flag", () => {
  const insensitive = buildMatcher("Abc");
  assert.ok(insensitive.test("abc"));
  const sensitive = buildMatcher("Abc", { caseSensitive: true });
  assert.ok(sensitive.test("Abc"));
  assert.ok(!sensitive.test("abc"));
});

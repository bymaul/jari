import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { buildMatcher, hasUpperCase } from "../content/find/matcher.js";

test("find/matcher direct import: buildMatcher substring and regex", () => {
  const sub = buildMatcher("a.c");
  assert.ok(sub.test("a.c"));
  assert.ok(!sub.test("aXc"));
  const rx = buildMatcher("a+c", { regex: true });
  assert.ok(rx.test("aaac"));
  assert.equal(buildMatcher(""), null);
  assert.equal(buildMatcher("(unclosed", { regex: true }), null);
});

test("find/matcher direct import: hasUpperCase", () => {
  assert.equal(hasUpperCase("abc"), false);
  assert.equal(hasUpperCase("aBc"), true);
  assert.equal(hasUpperCase("Äpfel"), true);
});

test("find/matcher direct import: wholeWord and caseSensitive", () => {
  const word = buildMatcher("cat", { wholeWord: true });
  assert.ok(word.test("a cat sat"));
  assert.ok(!word.test("concatenate"));
  const sensitive = buildMatcher("Abc", { caseSensitive: true });
  assert.ok(sensitive.test("Abc"));
  assert.ok(!sensitive.test("abc"));
});

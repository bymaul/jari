import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import { calcEval } from "../content/prompt.ts";

test("calcEval evaluates basic arithmetic without a prefix", () => {
  assert.equal(calcEval("2 + 2"), "4");
  assert.equal(calcEval("12*12"), "144");
  assert.equal(calcEval("2/8"), "0.25");
  assert.equal(calcEval("6 * 7"), "42");
  assert.equal(calcEval("10 - 3"), "7");
  assert.equal(calcEval("100 / 4"), "25");
  assert.equal(calcEval("2 * (3 + 4)"), "14");
  assert.equal(calcEval("3.5 + 2.5"), "6");
});

test("calcEval ignores whitespace", () => {
  assert.equal(calcEval("  2 + 2  "), "4");
  assert.equal(calcEval("2+2"), "4");
});

test("calcEval rejects invalid expressions", () => {
  assert.equal(calcEval(""), null);
  assert.equal(calcEval("   "), null);
  assert.equal(calcEval("abc"), null);
  assert.equal(calcEval("2 +"), null);
  assert.equal(calcEval("alert(1)"), null);
  assert.equal(calcEval("2; console.log(1)"), null);
  assert.equal(calcEval("2 & 1"), null);
});

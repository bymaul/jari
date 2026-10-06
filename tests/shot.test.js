import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Shot } from "../content/shot.js";

function keyEvent(key) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

test("Escape clears the start anchor first and closes on the second press", () => {
  try {
    Shot.open();
    assert.equal(Shot.isActive(), true);
    Shot.onKeyDown(keyEvent("Enter"));
    Shot.onKeyDown(keyEvent("Escape"));
    assert.equal(Shot.isActive(), true);
    Shot.onKeyDown(keyEvent("Escape"));
    assert.equal(Shot.isActive(), false);
  } finally {
    Shot.close();
  }
});

test("Escape with no anchor closes immediately", () => {
  try {
    Shot.open();
    assert.equal(Shot.isActive(), true);
    Shot.onKeyDown(keyEvent("Escape"));
    assert.equal(Shot.isActive(), false);
  } finally {
    Shot.close();
  }
});

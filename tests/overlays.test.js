import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { Overlays, register, touch } from "../content/overlays.js";

const closedOrder = [];

function fake(name, opts) {
  let active = false;
  const api = {
    isActive: () => active,
    close: () => {
      active = false;
      closedOrder.push(name);
    },
    onKeyDown: () => {},
  };
  register(name, api, opts);
  return {
    show() {
      active = true;
      touch(name);
    },
    hide() {
      active = false;
    },
  };
}

const a = fake("overlay-a");
const b = fake("overlay-b");
const passive = fake("overlay-passive", { modal: false });

test("active() prefers the most recently opened overlay", () => {
  a.show();
  b.show();
  assert.equal(Overlays.active().name, "overlay-b");
  a.show();
  assert.equal(Overlays.active().name, "overlay-a");
  a.hide();
  b.hide();
});

test("active() skips passive overlays", () => {
  passive.show();
  assert.equal(Overlays.active(), null);
  a.show();
  assert.equal(Overlays.active().name, "overlay-a");
  a.hide();
  passive.hide();
});

test("closeAll closes topmost first and clears the order", () => {
  closedOrder.length = 0;
  a.show();
  b.show();
  passive.show();
  Overlays.closeAll();
  assert.deepEqual(closedOrder, ["overlay-passive", "overlay-b", "overlay-a"]);
  assert.equal(Overlays.active(), null);
});

import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";

const { hintHomeRect } = await import("../content/hint-layer.ts");

test("hintHomeRect converts viewport rects to holder coordinates", () => {
  const prevX = globalThis.window.pageXOffset;
  const prevY = globalThis.window.pageYOffset;
  globalThis.window.pageXOffset = 100;
  globalThis.window.pageYOffset = 200;
  try {
    assert.deepEqual(hintHomeRect({ left: 50, top: 60 }, { left: 100, top: 200 }), {
      left: 50,
      top: 60,
    });
    assert.deepEqual(hintHomeRect({ left: 10, top: -300 }, { left: 0, top: 200 }), {
      left: 110,
      top: 0,
    });
  } finally {
    globalThis.window.pageXOffset = prevX;
    globalThis.window.pageYOffset = prevY;
  }
});

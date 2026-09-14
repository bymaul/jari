import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import { findPageNavLink } from "../content/page-nav.js";

function link({ text = "", aria = "", rel = "" } = {}) {
  return {
    textContent: text,
    getAttribute: (name) => {
      if (name === "aria-label") return aria || null;
      if (name === "rel") return rel || null;
      return null;
    },
  };
}

test("rel=next wins over text matches", () => {
  const textLink = link({ text: "Next" });
  const relLink = link({ text: "Something else", rel: "next" });
  assert.equal(
    findPageNavLink("next", ["Next"], [textLink, relLink]),
    relLink,
  );
});

test("rel tokens are matched case-insensitively among other tokens", () => {
  const el = link({ text: "Older posts", rel: "NEXT prefetch" });
  assert.equal(findPageNavLink("next", ["Next"], [el]), el);
});

test("visible text matches case-insensitively after trimming", () => {
  const el = link({ text: "  NEXT  " });
  assert.equal(findPageNavLink("next", ["Next"], [el]), el);
  assert.equal(findPageNavLink("next", ["Previous"], [el]), null);
});

test("aria-label matches when visible text does not", () => {
  const el = link({ text: "›", aria: "Go to next page" });
  assert.equal(findPageNavLink("next", ["Go to next page"], [el]), el);
});

test("prev direction uses the prev texts and rel=prev", () => {
  const next = link({ text: "Next" });
  const prev = link({ text: "‹" });
  const els = [next, prev];
  assert.equal(findPageNavLink("prev", ["‹"], els), prev);
  assert.equal(findPageNavLink("next", ["Next"], els), next);
  assert.equal(findPageNavLink("next", ["›"], els), null);
});

test("no match and empty text lists return null", () => {
  const els = [link({ text: "Home" }), link({ text: "About" })];
  assert.equal(findPageNavLink("next", ["Next"], els), null);
  assert.equal(findPageNavLink("next", [], els), null);
  assert.equal(findPageNavLink("next", ["Next"], []), null);
});

test("rel still matches when the text list is empty", () => {
  const el = link({ text: "3", rel: "next" });
  assert.equal(findPageNavLink("next", [], [el]), el);
});

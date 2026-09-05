import { test } from "node:test";
import assert from "node:assert";
import {
  fuzzyIndices,
  fuzzyMatch,
  rankMatches,
  substringMatch,
} from "../content/rank.js";

test("fuzzyMatch returns null when chars are missing or out of order", () => {
  assert.equal(fuzzyMatch("xyz", "abcdef"), null);
  assert.equal(fuzzyMatch("ba", "abc"), null);
  assert.equal(fuzzyMatch("", "anything"), null);
});

test("fuzzyMatch reports matched indices in order", () => {
  assert.deepEqual(fuzzyMatch("fb", "foo bar").indices, [0, 4]);
  assert.deepEqual(fuzzyMatch("gt", "gtx").indices, [0, 1]);
});

test("fuzzyMatch prefers consecutive runs and word starts", () => {
  const consecutive = fuzzyMatch("ab", "abxx").score;
  const scattered = fuzzyMatch("ab", "axb").score;
  assert.ok(consecutive > scattered);
  const wordStart = fuzzyMatch("ab", "ab").score;
  const midWord = fuzzyMatch("ab", "cab").score;
  assert.ok(wordStart > midWord);
});

test("fuzzyMatch rewards camel-case boundaries", () => {
  const camel = fuzzyMatch("ot", "inOTabs").score;
  const plain = fuzzyMatch("ot", "inotabs").score;
  assert.ok(camel > plain);
});

test("fuzzyMatch picks the tightest alignment over a greedy first-char scan", () => {
  assert.deepEqual(fuzzyMatch("ob", "o x ob").indices, [4, 5]);
  assert.deepEqual(fuzzyMatch("er", "e x er").indices, [4, 5]);
  assert.deepEqual(fuzzyMatch("ab", "abxb").indices, [0, 1]);
});

test("fuzzyMatch ranks an uppercase boundary above a separator boundary", () => {
  assert.ok(
    fuzzyMatch("gh", "GitHub").score > fuzzyMatch("gh", "g h").score,
  );
});

test("fuzzyMatch prefers a match at the start of the text", () => {
  assert.ok(
    fuzzyMatch("hub", "GitHub").score > fuzzyMatch("hub", "ZZZ hub").score,
  );
});

test("fuzzyMatch multi-term requires every term and sums scores", () => {
  assert.deepEqual(fuzzyMatch("pria youtube", "Pria on YouTube").indices, [
    0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14,
  ]);
  assert.ok(
    fuzzyMatch("pria youtube", "Pria on YouTube").score >
      fuzzyMatch("pria", "Pria on YouTube").score,
  );
  assert.equal(fuzzyMatch("pria youtube", "Pria only"), null);
  assert.equal(fuzzyMatch("pria   youtube", "Pria on YouTube") === null, false);
  assert.equal(fuzzyMatch("", "anything"), null);
});

test("rankMatches orders by score, then tightness, then text length", () => {
  const items = [
    { title: "g h", url: "https://g-h.example", source: "history" },
    { title: "GitHub", url: "https://github.com", source: "tab" },
    { title: "GitHub Actions", url: "https://github.com/actions", source: "history" },
    { title: "Go home", url: "https://home.example", source: "history" },
  ];
  const titles = rankMatches("gh", items).map((x) => x.item.title);
  assert.deepEqual(titles, ["GitHub", "GitHub Actions", "g h", "Go home"]);
});

test("rankMatches breaks score ties by shorter text, then source", () => {
  const items = [
    { title: "GitHub Actions", url: "https://github.com/actions", source: "history" },
    { title: "GitHub", url: "https://github.com", source: "tab" },
  ];
  assert.deepEqual(
    rankMatches("gh", items).map((x) => x.item.title),
    ["GitHub", "GitHub Actions"],
  );

  const sameHay = [
    { title: "Foo", url: "https://foo.example", source: "bookmark" },
    { title: "Foo", url: "https://foo.example", source: "history" },
  ];
  assert.deepEqual(
    rankMatches("foo", sameHay).map((x) => x.item.source),
    ["history", "bookmark"],
  );
});

test("rankMatches prefers a title match over a URL-only match", () => {
  const items = [
    { title: "Archive", url: "https://example.com/projects/github" },
    { title: "GitHub", url: "https://github.com" },
  ];
  assert.deepEqual(
    rankMatches("hub", items).map((x) => x.item.title),
    ["GitHub", "Archive"],
  );
});

test("rankMatches with fuzzy matching off keeps the original order", () => {
  const items = [
    { title: "zzz foo", url: "https://z.example" },
    { title: "foo", url: "https://f.example" },
  ];
  assert.deepEqual(
    rankMatches("foo", items, false).map((x) => x.title),
    ["zzz foo", "foo"],
  );
});

test("rankMatches finds youtube from the ytb shorthand", () => {
  const items = [
    { title: "GitHub: opencode", url: "https://github.com/anomalyco/opencode", source: "tab" },
    { title: "lofi hip hop radio - YouTube", url: "https://www.youtube.com/watch?v=jfKfPfyJRdk", source: "tab" },
  ];
  const titles = rankMatches("ytb", items).map((x) => x.item.title);
  assert.ok(titles.includes("lofi hip hop radio - YouTube"));
  assert.equal(titles[0], "lofi hip hop radio - YouTube");
});

test("fuzzyIndices skips terms that are not in the field", () => {
  assert.deepEqual(fuzzyIndices("pria youtube", "Pria"), [0, 1, 2, 3]);
  assert.deepEqual(fuzzyIndices("pria youtube", "YouTube"), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(fuzzyIndices("pria youtube", "zzz"), []);
  assert.deepEqual(fuzzyIndices("", "anything"), []);
});

test("substringMatch requires every term as a substring", () => {
  assert.equal(substringMatch("pria youtube", "Pria on YouTube"), true);
  assert.equal(substringMatch("pria youtube", "Pria only"), false);
  assert.equal(substringMatch("pria", "My Pria Page"), true);
  assert.equal(substringMatch("", "anything"), false);
});
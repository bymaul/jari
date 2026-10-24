import { test } from "node:test";
import assert from "node:assert";
import {
  fuzzyIndices,
  fuzzyMatch,
  parseQuery,
  rankMatches,
  substringMatch,
} from "../content/rank.ts";

test("fuzzyMatch returns null when chars are missing or out of order", () => {
  assert.equal(fuzzyMatch("xyz", "abcdef"), null);
  assert.equal(fuzzyMatch("ba", "abc"), null);
  assert.equal(fuzzyMatch("", "anything"), null);
});

test("fuzzyMatch reports matched indices in order", () => {
  assert.deepEqual(fuzzyMatch("fb", "foo bar")!.indices, [0, 4]);
  assert.deepEqual(fuzzyMatch("gt", "gtx")!.indices, [0, 1]);
});

test("fuzzyMatch prefers consecutive runs and word starts", () => {
  const consecutive = fuzzyMatch("ab", "abxx")!.score;
  const scattered = fuzzyMatch("ab", "axb")!.score;
  assert.ok(consecutive > scattered);
  const wordStart = fuzzyMatch("ab", "ab")!.score;
  const midWord = fuzzyMatch("ab", "cab")!.score;
  assert.ok(wordStart > midWord);
});

test("rankMatches orders by score, then tightness, then text length", () => {
  const items = [
    { title: "g h", url: "https://g-h.example", source: "history" },
    { title: "GitHub", url: "https://github.com", source: "tab" },
    {
      title: "GitHub Actions",
      url: "https://github.com/actions",
      source: "history",
    },
    { title: "Go home", url: "https://home.example", source: "history" },
  ];
  const titles = rankMatches("gh", items).map((x) => x.item.title);
  assert.deepEqual(titles, ["GitHub", "GitHub Actions", "g h", "Go home"]);
});

test("rankMatches breaks score ties by shorter text, then source", () => {
  const items = [
    {
      title: "GitHub Actions",
      url: "https://github.com/actions",
      source: "history",
    },
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
    {
      title: "GitHub: opencode",
      url: "https://github.com/anomalyco/opencode",
      source: "tab",
    },
    {
      title: "lofi hip hop radio - YouTube",
      url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
      source: "tab",
    },
  ];
  const titles = rankMatches("ytb", items).map((x) => x.item.title);
  assert.ok(titles.includes("lofi hip hop radio - YouTube"));
  assert.equal(titles[0], "lofi hip hop radio - YouTube");
});

test("fuzzyMatch skips terms with chars missing from the target", () => {
  assert.equal(fuzzyMatch("foo qzx", "foo bar"), null);
  assert.deepEqual(fuzzyMatch("f", "foo")!.indices, [0]);
  assert.deepEqual(fuzzyIndices("foo qzx", "foo bar"), [0, 1, 2]);
  assert.deepEqual(fuzzyIndices("qzx", "foo bar"), []);
});

test("rankMatches rejects a fuzzy match spanning the title/url seam", () => {
  const items = [{ title: "Team", url: "https://plug.io/" }];
  assert.equal(rankMatches("ampl", items).length, 0);
});

test("rankMatches ignores query-string token soup in urls", () => {
  const items = [
    {
      title: "prefix - Google Search",
      url: "https://www.google.com/search?q=prefix&sxsrf=APpeQnt7tnS99EhPc",
      source: "history",
    },
  ];
  assert.equal(rankMatches("axmurk", items).length, 0);
});

test("rankMatches does not match a query through tracking tokens", () => {
  const items = [
    {
      title: "prefix - Google Search",
      url: "https://www.google.com/search?q=prefix&sxsrf=APpeQnt7tnS99EhPcaDMw3ufFYHds2eqDOX3A1792574748164",
      source: "history",
    },
  ];
  assert.equal(rankMatches("facebok", items).length, 0);
});

test("rankMatches still finds a page by a literal query string", () => {
  const items = [
    {
      title: "Search results",
      url: "https://example.com/find?q=needle",
      source: "history",
    },
  ];
  assert.equal(rankMatches("needle", items).length, 1);
});

test("rankMatches favors matched fields over boosted loose matches", () => {
  const items = [
    {
      title: "Eff Ace Bed Lock",
      url: "https://noise.example/",
      visitCount: 9999,
    },
    { title: "Facebook", url: "https://facebook.com/", visitCount: 1 },
  ];
  assert.equal(
    rankMatches("facebok", items)[0].item.url,
    "https://facebook.com/",
  );
});

test("rankMatches ranks a title hit above a fresher url hit", () => {
  const items = [
    {
      title: "Example Domain",
      url: "https://github.com/",
      visitCount: 9999,
      lastVisit: Date.now(),
    },
    { title: "GitHub", url: "https://example.com/repo", visitCount: 1 },
  ];
  assert.equal(rankMatches("gh", items)[0].item.title, "GitHub");
});

test("rankMatches ranks a title hit above a query-string only hit", () => {
  const items = [
    {
      title: "Search results",
      url: "https://example.com/find?q=needle",
      visitCount: 500,
      lastVisit: Date.now(),
    },
    { title: "Needle docs", url: "https://docs.example/" },
  ];
  assert.equal(rankMatches("needle", items)[0].item.title, "Needle docs");
});

test("substringMatch requires every term as a substring", () => {
  assert.equal(substringMatch("pria youtube", "Pria on YouTube"), true);
  assert.equal(substringMatch("pria youtube", "Pria only"), false);
  assert.equal(substringMatch("pria", "My Pria Page"), true);
  assert.equal(substringMatch("", "anything"), false);
});

test("parseQuery handles negated phrases and stray quotes", () => {
  assert.deepEqual(parseQuery('-"foo bar"'), {
    include: [],
    exclude: ["foo bar"],
    phrases: [],
  });
  assert.deepEqual(parseQuery('"foo bar" baz').phrases, ["foo bar"]);
  assert.deepEqual(parseQuery('"unclosed').include, ["unclosed"]);
});

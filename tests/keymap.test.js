import { test } from "node:test";
import assert from "node:assert";
import * as Jari from "../content/keymap.js";

test("canonicalKey orders modifiers and keeps the bare key", () => {
  assert.equal(Jari.canonicalKey({ key: "g" }), "g");
  assert.equal(Jari.canonicalKey({ key: "t", ctrlKey: true, altKey: true }), "ctrl+alt+t");
  assert.equal(Jari.canonicalKey({ key: "G", metaKey: true }), "meta+G");
});

test("parseRepeatCount clamps counts to at least 1", () => {
  assert.equal(Jari.parseRepeatCount("3"), 3);
  assert.equal(Jari.parseRepeatCount("05"), 5);
  assert.equal(Jari.parseRepeatCount("0"), 1);
  assert.equal(Jari.parseRepeatCount(""), 1);
  assert.equal(Jari.parseRepeatCount(undefined), 1);
});

test("normalizeSettings treats a stored keymap as authoritative and drops invalid values", () => {
  const s = Jari.normalizeSettings({ scrollStep: 100, smoothScroll: true, keymap: { j: "scrollTop" } });
  assert.equal(s.scrollStep, 100);
  assert.equal(s.smoothScroll, true);
  assert.equal(s.keymap.j, "scrollTop");
  assert.equal(s.keymap.t, undefined);
  assert.equal(s.timeoutMs, 1500);
  assert.deepEqual(s.suggestionSources, ["tab", "history", "bookmark"]);
  assert.equal(s.copyFormat, "plain");

  const bad = Jari.normalizeSettings({ scrollStep: "x", timeoutMs: 0, disabledSites: "x" });
  assert.equal(bad.scrollStep, 120);
  assert.equal(bad.timeoutMs, 1500);
  assert.deepEqual(bad.disabledSites, []);

  assert.equal(Jari.normalizeSettings({}).fuzzyMatching, true);
  assert.equal(Jari.normalizeSettings({ fuzzyMatching: false }).fuzzyMatching, false);
});

test("normalizeSettings fills defaults only when no keymap is stored", () => {
  const s = Jari.normalizeSettings({});
  assert.equal(s.keymap.t, "omnibar");
  assert.equal(s.keymap.p, "passthrough");
});

test("rebinding away a default key removes the default binding", () => {
  const s = Jari.normalizeSettings({ keymap: { z: "passthrough" } });
  assert.equal(s.keymap.z, "passthrough");
  assert.equal(s.keymap.p, undefined);
});

test("normalizeSettings validates suggestionSources and copyFormat", () => {
  const s = Jari.normalizeSettings({
    suggestionSources: ["tab"],
    copyFormat: "markdown",
  });
  assert.deepEqual(s.suggestionSources, ["tab"]);
  assert.equal(s.copyFormat, "markdown");

  assert.deepEqual(Jari.normalizeSettings({ suggestionSources: [] }).suggestionSources, []);
  assert.deepEqual(
    Jari.normalizeSettings({ suggestionSources: ["tab", "bogus", "bookmark"] }).suggestionSources,
    ["tab", "bookmark"],
  );
  assert.equal(Jari.normalizeSettings({ copyFormat: "bogus" }).copyFormat, "plain");
});

test("fuzzyMatch returns null when chars are missing or out of order", () => {
  assert.equal(Jari.fuzzyMatch("xyz", "abcdef"), null);
  assert.equal(Jari.fuzzyMatch("ba", "abc"), null);
  assert.equal(Jari.fuzzyMatch("", "anything"), null);
});

test("fuzzyMatch reports matched indices in order", () => {
  assert.deepEqual(Jari.fuzzyMatch("fb", "foo bar").indices, [0, 4]);
  assert.deepEqual(Jari.fuzzyMatch("gt", "gtx").indices, [0, 1]);
});

test("fuzzyMatch prefers consecutive runs and word starts", () => {
  const consecutive = Jari.fuzzyMatch("ab", "abxx").score;
  const scattered = Jari.fuzzyMatch("ab", "axb").score;
  assert.ok(consecutive > scattered);
  const wordStart = Jari.fuzzyMatch("ab", "ab").score;
  const midWord = Jari.fuzzyMatch("ab", "cab").score;
  assert.ok(wordStart > midWord);
});

test("fuzzyMatch rewards camel-case boundaries", () => {
  const camel = Jari.fuzzyMatch("ot", "inOTabs").score;
  const plain = Jari.fuzzyMatch("ot", "inotabs").score;
  assert.ok(camel > plain);
});

test("fuzzyMatch picks the tightest alignment over a greedy first-char scan", () => {
  assert.deepEqual(Jari.fuzzyMatch("ob", "o x ob").indices, [4, 5]);
  assert.deepEqual(Jari.fuzzyMatch("er", "e x er").indices, [4, 5]);
  assert.deepEqual(Jari.fuzzyMatch("ab", "abxb").indices, [0, 1]);
});

test("fuzzyMatch ranks an uppercase boundary above a separator boundary", () => {
  assert.ok(
    Jari.fuzzyMatch("gh", "GitHub").score > Jari.fuzzyMatch("gh", "g h").score,
  );
});

test("fuzzyMatch prefers a match at the start of the text", () => {
  assert.ok(
    Jari.fuzzyMatch("hub", "GitHub").score > Jari.fuzzyMatch("hub", "ZZZ hub").score,
  );
});

test("fuzzyMatch multi-term requires every term and sums scores", () => {
  assert.deepEqual(Jari.fuzzyMatch("pria youtube", "Pria on YouTube").indices, [
    0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14,
  ]);
  assert.ok(
    Jari.fuzzyMatch("pria youtube", "Pria on YouTube").score >
      Jari.fuzzyMatch("pria", "Pria on YouTube").score,
  );
  assert.equal(Jari.fuzzyMatch("pria youtube", "Pria only"), null);
  assert.equal(Jari.fuzzyMatch("pria   youtube", "Pria on YouTube") === null, false);
  assert.equal(Jari.fuzzyMatch("", "anything"), null);
});

test("rankMatches orders by score, then tightness, then text length", () => {
  const items = [
    { title: "g h", url: "https://g-h.example", source: "history" },
    { title: "GitHub", url: "https://github.com", source: "tab" },
    { title: "GitHub Actions", url: "https://github.com/actions", source: "history" },
    { title: "Go home", url: "https://home.example", source: "history" },
  ];
  const titles = Jari.rankMatches("gh", items).map((x) => x.item.title);
  assert.deepEqual(titles, ["GitHub", "GitHub Actions", "g h", "Go home"]);
});

test("rankMatches breaks score ties by shorter text, then source", () => {
  const items = [
    { title: "GitHub Actions", url: "https://github.com/actions", source: "history" },
    { title: "GitHub", url: "https://github.com", source: "tab" },
  ];
  assert.deepEqual(
    Jari.rankMatches("gh", items).map((x) => x.item.title),
    ["GitHub", "GitHub Actions"],
  );

  const sameHay = [
    { title: "Foo", url: "https://foo.example", source: "bookmark" },
    { title: "Foo", url: "https://foo.example", source: "history" },
  ];
  assert.deepEqual(
    Jari.rankMatches("foo", sameHay).map((x) => x.item.source),
    ["history", "bookmark"],
  );
});

test("rankMatches prefers a title match over a URL-only match", () => {
  const items = [
    { title: "Archive", url: "https://example.com/projects/github" },
    { title: "GitHub", url: "https://github.com" },
  ];
  assert.deepEqual(
    Jari.rankMatches("hub", items).map((x) => x.item.title),
    ["GitHub", "Archive"],
  );
});

test("rankMatches with fuzzy matching off keeps the original order", () => {
  const items = [
    { title: "zzz foo", url: "https://z.example" },
    { title: "foo", url: "https://f.example" },
  ];
  assert.deepEqual(
    Jari.rankMatches("foo", items, false).map((x) => x.title),
    ["zzz foo", "foo"],
  );
});

test("fuzzyIndices skips terms that are not in the field", () => {
  assert.deepEqual(Jari.fuzzyIndices("pria youtube", "Pria"), [0, 1, 2, 3]);
  assert.deepEqual(Jari.fuzzyIndices("pria youtube", "YouTube"), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Jari.fuzzyIndices("pria youtube", "zzz"), []);
  assert.deepEqual(Jari.fuzzyIndices("", "anything"), []);
});

test("substringMatch requires every term as a substring", () => {
  assert.equal(Jari.substringMatch("pria youtube", "Pria on YouTube"), true);
  assert.equal(Jari.substringMatch("pria youtube", "Pria only"), false);
  assert.equal(Jari.substringMatch("pria", "My Pria Page"), true);
  assert.equal(Jari.substringMatch("", "anything"), false);
});

test("balanceCategories spreads categories across the columns", () => {
  const byCategory = new Map([
    ["scrolling", ["scrollDown", "scrollUp"]],
    ["tabs", ["tabSearch"]],
  ]);
  const columns = Jari.balanceCategories(byCategory, 3);
  const total = columns.reduce((n, col) => n + col.length, 0);
  assert.equal(total, 2);
  for (const col of columns) {
    for (const cat of col) assert.ok(byCategory.has(cat.id));
  }
});

test("Url.parentUrlOf climbs one path segment", () => {
  const { parentUrlOf } = Jari.Url;
  assert.equal(parentUrlOf("https://acme.com/1/2/3"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/1/2/"), "https://acme.com/1");
  assert.equal(parentUrlOf("https://acme.com/1/2/3.html"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(parentUrlOf("not a url"), "not a url");
});

test("Url.rootUrlOf climbs to the origin", () => {
  const { rootUrlOf } = Jari.Url;
  assert.equal(rootUrlOf("https://acme.com/1/2/3"), "https://acme.com/");
  assert.equal(rootUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(rootUrlOf("not a url"), "not a url");
});

test("Url.isSamePath ignores query and hash", () => {
  const { isSamePath } = Jari.Url;
  assert.ok(isSamePath("https://acme.com/", "https://acme.com/?ref=1"));
  assert.ok(!isSamePath("https://acme.com/a", "https://acme.com/b"));
});

test("Url.looksLikeUrl classifies bare queries", () => {
  const { looksLikeUrl } = Jari.Url;
  assert.ok(looksLikeUrl("https://acme.com/a"));
  assert.ok(looksLikeUrl("//acme.com"));
  assert.ok(looksLikeUrl("localhost:8080/path"));
  assert.ok(looksLikeUrl("acme.com/a:b"));
  assert.ok(looksLikeUrl("sub.example.com"));
  assert.ok(!looksLikeUrl("hello world"));
  assert.ok(!looksLikeUrl("acme"));
  assert.ok(!looksLikeUrl(""));
});

test("Url.suggestionTerm strips a leading URL token", () => {
  const { suggestionTerm } = Jari.Url;
  assert.equal(suggestionTerm("https://youtube.com/ pria"), "pria");
  assert.equal(suggestionTerm("youtube.com/watch?v=1 foo bar"), "foo bar");
  assert.equal(suggestionTerm("//acme.com/a query"), "query");
  assert.equal(suggestionTerm("https://youtube.com/"), "https://youtube.com/");
  assert.equal(suggestionTerm("pria"), "pria");
  assert.equal(suggestionTerm("pria videos"), "pria videos");
  assert.equal(suggestionTerm(""), "");
});

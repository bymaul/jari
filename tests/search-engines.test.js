import { test } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_SEARCH_ENGINE,
  MAX_SEARCH_ENGINES,
  RESERVED_ENGINE_KEYWORDS,
  SEARCH_ENGINE_DEFAULTS,
  buildEngineUrl,
  normalizeDefaultEngine,
  normalizeSearchEngines,
  parseEngineKeyword,
  searchEngineDefaults,
  validateSearchEngine,
} from "../shared/search-engines.js";

test("defaults seed the five previous hardcoded engines", () => {
  assert.deepEqual(
    SEARCH_ENGINE_DEFAULTS.map((e) => e.keyword),
    ["g", "yt", "gh", "wiki", "chat"],
  );
  for (const engine of SEARCH_ENGINE_DEFAULTS) {
    assert.match(engine.url, /^https:\/\//);
    assert.ok(engine.url.includes("%s"));
  }
  assert.equal(DEFAULT_SEARCH_ENGINE, "g");
  assert.deepEqual(searchEngineDefaults(), SEARCH_ENGINE_DEFAULTS);
  assert.notEqual(searchEngineDefaults(), SEARCH_ENGINE_DEFAULTS);
});

test("validateSearchEngine accepts a well-formed engine", () => {
  assert.equal(
    validateSearchEngine({ keyword: "ddg", url: "https://duckduckgo.com/?q=%s" }),
    null,
  );
  assert.equal(
    validateSearchEngine({ keyword: "YT", url: "https://example.com/?q=%s" }),
    null,
  );
});

test("validateSearchEngine rejects bad keywords", () => {
  assert.match(validateSearchEngine({ keyword: "", url: "https://e.com/?q=%s" }), /Keyword/);
  assert.match(validateSearchEngine({ keyword: "a b", url: "https://e.com/?q=%s" }), /Keyword/);
  assert.match(validateSearchEngine({ keyword: "g!", url: "https://e.com/?q=%s" }), /Keyword/);
  assert.match(
    validateSearchEngine({ keyword: "a".repeat(17), url: "https://e.com/?q=%s" }),
    /Keyword/,
  );
  assert.match(validateSearchEngine(null), /keyword/i);
});

test("validateSearchEngine reserves tab search keywords", () => {
  assert.deepEqual(RESERVED_ENGINE_KEYWORDS, ["t"]);
  assert.match(
    validateSearchEngine({ keyword: "t", url: "https://e.com/?q=%s" }),
    /reserved/,
  );
  assert.match(
    validateSearchEngine({ keyword: "T", url: "https://e.com/?q=%s" }),
    /reserved/,
  );
});

test("validateSearchEngine rejects bad URLs", () => {
  assert.match(
    validateSearchEngine({ keyword: "ddg", url: "ftp://e.com/?q=%s" }),
    /http/,
  );
  assert.match(
    validateSearchEngine({ keyword: "ddg", url: "javascript:alert(1)" }),
    /http/,
  );
  assert.match(
    validateSearchEngine({ keyword: "ddg", url: "https://e.com/search" }),
    /%s/,
  );
  assert.match(
    validateSearchEngine({ keyword: "ddg", url: `https://e.com/${"a".repeat(490)}?q=%s` }),
    /500/,
  );
});

test("normalizeSearchEngines falls back to defaults", () => {
  assert.deepEqual(normalizeSearchEngines(undefined), SEARCH_ENGINE_DEFAULTS);
  assert.deepEqual(normalizeSearchEngines(null), SEARCH_ENGINE_DEFAULTS);
  assert.deepEqual(normalizeSearchEngines("g"), SEARCH_ENGINE_DEFAULTS);
  assert.deepEqual(normalizeSearchEngines([]), SEARCH_ENGINE_DEFAULTS);
  assert.deepEqual(
    normalizeSearchEngines([{ keyword: "t", url: "https://e.com/?q=%s" }]),
    SEARCH_ENGINE_DEFAULTS,
  );
});

test("normalizeSearchEngines dedupes, cleans, and caps", () => {
  const list = normalizeSearchEngines([
    { keyword: "DDG", url: "  https://duckduckgo.com/?q=%s  " },
    { keyword: "ddg", url: "https://example.com/?q=%s" },
    { keyword: "nope", url: "https://example.com/search" },
    { keyword: "gh", url: "https://github.com/search?q=%s" },
  ]);
  assert.deepEqual(list, [
    { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
    { keyword: "gh", url: "https://github.com/search?q=%s" },
  ]);
  const many = Array.from({ length: MAX_SEARCH_ENGINES + 5 }, (_, i) => ({
    keyword: `e${i}`,
    url: "https://example.com/?q=%s",
  }));
  assert.equal(normalizeSearchEngines(many).length, MAX_SEARCH_ENGINES);
});

test("normalizeDefaultEngine keeps known keywords and repairs the rest", () => {
  const engines = [{ keyword: "ddg", url: "https://duckduckgo.com/?q=%s" }];
  assert.equal(normalizeDefaultEngine("DDG", engines), "ddg");
  assert.equal(normalizeDefaultEngine("g", engines), "ddg");
  assert.equal(normalizeDefaultEngine(undefined, engines), "ddg");
  assert.equal(
    normalizeDefaultEngine(undefined, normalizeSearchEngines(undefined)),
    "g",
  );
});

test("parseEngineKeyword resolves custom engines case-insensitively", () => {
  const engines = normalizeSearchEngines([
    { keyword: "ddg", url: "https://duckduckgo.com/?q=%s" },
  ]);
  assert.deepEqual(parseEngineKeyword("ddg hello world", engines), {
    keyword: "ddg",
    rest: "hello world",
    url: "https://duckduckgo.com/?q=hello%20world",
  });
  assert.deepEqual(parseEngineKeyword("DDG hi", engines).keyword, "ddg");
  assert.equal(parseEngineKeyword("g hi", engines), null);
  assert.equal(parseEngineKeyword("ddg", engines), null);
  assert.equal(parseEngineKeyword("", engines), null);
  assert.equal(
    parseEngineKeyword("t something", searchEngineDefaults()),
    null,
  );
});

test("buildEngineUrl encodes the query and replaces every marker", () => {
  const engines = [
    { keyword: "x", url: "https://e.com/?a=%s&b=%s" },
  ];
  assert.equal(
    buildEngineUrl(engines, "x", "a b&c"),
    "https://e.com/?a=a%20b%26c&b=a%20b%26c",
  );
  assert.equal(buildEngineUrl(engines, "missing", "q"), null);
  assert.equal(buildEngineUrl([], "x", "q"), null);
});

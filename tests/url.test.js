import { test } from "node:test";
import assert from "node:assert";
import {
  blockedUrlSchemes,
  matchesSitePattern,
  normalizeHost,
  normalizeSitePattern,
  normalizeUrl,
  pageSiteKey,
  urlSchemes,
  Url,
} from "../shared/url.js";

test("normalizeUrl assumes https for bare hosts", () => {
  assert.equal(normalizeUrl("acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("acme.com/a/b"), "https://acme.com/a/b");
  assert.equal(normalizeUrl("//acme.com"), "https://acme.com");
});

test("normalizeUrl assumes http for localhost", () => {
  assert.equal(normalizeUrl("localhost"), "http://localhost");
  assert.equal(normalizeUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeUrl("localhost:8080/path"), "http://localhost:8080/path");
  assert.equal(normalizeUrl("127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("normalizeUrl rejects unsafe schemes", () => {
  assert.equal(normalizeUrl("http://acme.com"), "http://acme.com");
  assert.equal(normalizeUrl("https://acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
});

test("normalizeUrl allows chrome://", () => {
  assert.equal(normalizeUrl("chrome://settings"), "chrome://settings");
  assert.equal(normalizeUrl("chrome://extensions"), "chrome://extensions");
});

test("normalizeUrl keeps host:port but rejects unknown schemes", () => {
  assert.equal(normalizeUrl("mailto:foo@bar.com"), null);
  assert.equal(normalizeUrl("tel:+123"), null);
  assert.equal(normalizeUrl("steam:run/xyz"), null);
  assert.equal(normalizeUrl("example.com:8080"), "https://example.com:8080");
  assert.equal(normalizeUrl("example.com:8080?x=1"), "https://example.com:8080?x=1");
  assert.equal(normalizeUrl("example.com:8080#h"), "https://example.com:8080#h");
  assert.equal(normalizeUrl("example.com:8080/path?x=1#y"), "https://example.com:8080/path?x=1#y");
  assert.equal(normalizeUrl("example.com:"), null);
  assert.equal(normalizeUrl("example.com:/path"), null);
  assert.equal(normalizeUrl("example.com:99999"), null);
  assert.equal(normalizeUrl("example.com:65535"), "https://example.com:65535");
  assert.equal(normalizeUrl("//example.com:"), null);
  assert.equal(normalizeUrl("snacks.nvim:3000"), null);
  assert.equal(normalizeUrl("asdf.asdf:3000"), null);
});

test("normalizeUrl treats unknown bare TLDs as search, explicit scheme as URL", () => {
  assert.equal(normalizeUrl("snacks.nvim"), null);
  assert.equal(normalizeUrl("asdf.asdf"), null);
  assert.equal(normalizeUrl("snacks.nvim/docs"), null);
  assert.equal(normalizeUrl("//asdf.asdf"), null);
  assert.equal(normalizeUrl("https://snacks.nvim"), "https://snacks.nvim");
  assert.equal(normalizeUrl("http://asdf.asdf"), "http://asdf.asdf");
  assert.equal(normalizeUrl("https://acme.com"), "https://acme.com");
  assert.equal(normalizeUrl("http://foo"), null);
  assert.equal(normalizeUrl("http://-bad.com/"), null);
  assert.equal(normalizeUrl("about:blank"), "about:blank");
});

test("normalizeUrl keeps http for localhost variants with query or fragment", () => {
  assert.equal(normalizeUrl("localhost?x=1"), "http://localhost?x=1");
  assert.equal(normalizeUrl("localhost#frag"), "http://localhost#frag");
  assert.equal(normalizeUrl("localhost:3000/path?q=1#h"), "http://localhost:3000/path?q=1#h");
  assert.equal(normalizeUrl("0.0.0.0:3000"), "http://0.0.0.0:3000");
});

test("normalizeUrl treats bare file-like names as search, paths as URL", () => {
  assert.equal(normalizeUrl("foo.sh"), null);
  assert.equal(normalizeUrl("test.md"), null);
  assert.equal(normalizeUrl("foo.sh/bar"), "https://foo.sh/bar");
  assert.equal(normalizeUrl("report.zip"), "https://report.zip");
});

test("normalizeUrl rejects junk input", () => {
  assert.equal(normalizeUrl(""), null);
  assert.equal(normalizeUrl("   "), null);
  assert.equal(normalizeUrl("two words"), null);
  assert.equal(normalizeUrl(42), null);
  assert.equal(normalizeUrl(null), null);
  assert.equal(normalizeUrl(undefined), null);
});

test("Url.parentUrlOf climbs one path segment", () => {
  const { parentUrlOf } = Url;
  assert.equal(parentUrlOf("https://acme.com/1/2/3"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/1/2/"), "https://acme.com/1");
  assert.equal(parentUrlOf("https://acme.com/1/2/3.html"), "https://acme.com/1/2");
  assert.equal(parentUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(parentUrlOf("not a url"), "not a url");
});

test("Url.rootUrlOf climbs to the origin", () => {
  const { rootUrlOf } = Url;
  assert.equal(rootUrlOf("https://acme.com/1/2/3"), "https://acme.com/");
  assert.equal(rootUrlOf("https://acme.com/"), "https://acme.com/");
  assert.equal(rootUrlOf("not a url"), "not a url");
});

test("Url.isSamePath ignores query and hash", () => {
  const { isSamePath } = Url;
  assert.ok(isSamePath("https://acme.com/", "https://acme.com/?ref=1"));
  assert.ok(!isSamePath("https://acme.com/a", "https://acme.com/b"));
});

test("Url.looksLikeUrl classifies bare queries", () => {
  const { looksLikeUrl } = Url;
  assert.ok(looksLikeUrl("https://acme.com/a"));
  assert.ok(looksLikeUrl("//acme.com"));
  assert.ok(looksLikeUrl("localhost:8080/path"));
  assert.ok(looksLikeUrl("acme.com/a:b"));
  assert.ok(looksLikeUrl("sub.example.com"));
  assert.ok(!looksLikeUrl("hello world"));
  assert.ok(!looksLikeUrl("acme"));
  assert.ok(!looksLikeUrl(""));
});

test("Url.looksLikeUrl searches unknown TLDs but keeps explicit scheme as URL", () => {
  const { looksLikeUrl } = Url;
  assert.ok(!looksLikeUrl("snacks.nvim"));
  assert.ok(!looksLikeUrl("asdf.asdf"));
  assert.ok(!looksLikeUrl("snacks.nvim/docs"));
  assert.ok(!looksLikeUrl("asdf.asdf:3000"));
  assert.ok(!looksLikeUrl("//asdf.asdf"));
  assert.ok(looksLikeUrl("https://snacks.nvim"));
  assert.ok(looksLikeUrl("http://asdf.asdf"));
  assert.ok(looksLikeUrl("example.com"));
  assert.ok(looksLikeUrl("example.com:8080/path"));
  assert.ok(looksLikeUrl("example.co.uk"));
  assert.ok(looksLikeUrl("example.com:8080?x=1"));
  assert.ok(looksLikeUrl("example.com:8080#h"));
  assert.ok(!looksLikeUrl("example.com:"));
  assert.ok(!looksLikeUrl("example.com:/path"));
  assert.ok(!looksLikeUrl("//example.com:"));
  assert.ok(!looksLikeUrl("example.com:99999"));
  assert.ok(looksLikeUrl("about:blank"));
  assert.ok(!looksLikeUrl("http://foo"));
  assert.ok(!looksLikeUrl("http://-bad.com/"));
  assert.ok(!looksLikeUrl("https://a..b/"));
  assert.ok(!looksLikeUrl("foo.sh"));
  assert.ok(looksLikeUrl("foo.sh/bar"));
  assert.ok(looksLikeUrl("report.zip"));
  assert.ok(looksLikeUrl("localhost?x=1"));
});

test("Url.suggestionTerm strips a leading URL token", () => {
  const { suggestionTerm } = Url;
  assert.equal(suggestionTerm("https://youtube.com/ pria"), "pria");
  assert.equal(suggestionTerm("youtube.com/watch?v=1 foo bar"), "foo bar");
  assert.equal(suggestionTerm("//acme.com/a query"), "query");
  assert.equal(suggestionTerm("https://youtube.com/"), "https://youtube.com/");
  assert.equal(suggestionTerm("pria"), "pria");
  assert.equal(suggestionTerm("pria videos"), "pria videos");
  assert.equal(suggestionTerm(""), "");
});

test("normalizeHost strips schemes, ports and paths", () => {
  assert.equal(normalizeHost("example.com"), "example.com");
  assert.equal(normalizeHost(" https://Example.COM:8080/a/b "), "example.com");
  assert.equal(normalizeHost("sub.example.com"), "sub.example.com");
  assert.equal(normalizeHost("example.com."), "example.com");
  assert.equal(normalizeHost(""), "");
  assert.equal(normalizeHost("not a host"), "");
  assert.equal(normalizeHost(".."), "");
  assert.equal(normalizeHost("http:///"), "");
});

test("URL schemes are the single shared source", () => {
  assert.ok(urlSchemes.has("https"));
  assert.ok(!urlSchemes.has("javascript"));
  assert.ok(blockedUrlSchemes.has("data"));
});

test("normalizeSitePattern keeps hosts and *. wildcards", () => {
  assert.equal(normalizeSitePattern("example.com"), "example.com");
  assert.equal(normalizeSitePattern("*.Example.COM"), "*.example.com");
  assert.equal(normalizeSitePattern(" https://sub.example.com:8080/a "), "sub.example.com");
  assert.equal(normalizeSitePattern("file://"), "file://");
  assert.equal(normalizeSitePattern(""), "");
  assert.equal(normalizeSitePattern("not a host"), "");
  assert.equal(normalizeSitePattern("*."), "");
  assert.equal(normalizeSitePattern("*"), "");
});

test("matchesSitePattern matches exact, wildcard and file entries", () => {
  assert.equal(matchesSitePattern("example.com", "example.com"), true);
  assert.equal(matchesSitePattern("other.com", "example.com"), false);
  assert.equal(matchesSitePattern("sub.example.com", "*.example.com"), true);
  assert.equal(matchesSitePattern("example.com", "*.example.com"), true);
  assert.equal(matchesSitePattern("deep.sub.example.com", "*.example.com"), true);
  assert.equal(matchesSitePattern("notexample.com", "*.example.com"), false);
  assert.equal(matchesSitePattern("example.com.evil.com", "*.example.com"), false);
  assert.equal(matchesSitePattern("", "file://", "file:"), true);
  assert.equal(matchesSitePattern("example.com", "file://", "https:"), false);
  assert.equal(matchesSitePattern("a.com", ""), false);
});

test("pageSiteKey maps local files to the file sentinel", () => {
  assert.equal(pageSiteKey("", "file:"), "file://");
  assert.equal(pageSiteKey("example.com", "https:"), "example.com");
  assert.equal(pageSiteKey("", "about:"), "");
});
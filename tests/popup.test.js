import "./setup.mjs";
import { test } from "node:test";
import assert from "node:assert";
import {
  isSiteDisabled,
  parseTabSite,
  toggleSiteInList,
} from "../popup/site.js";

test("parseTabSite extracts a toggleable host", () => {
  assert.deepEqual(parseTabSite("https://example.com/page?q=1"), {
    toggleable: true,
    host: "example.com",
    protocol: "https:",
    label: "example.com",
    key: "example.com",
  });
});

test("parseTabSite rejects pages Jari cannot run on", () => {
  assert.equal(parseTabSite("chrome://extensions").toggleable, false);
  assert.equal(parseTabSite("about:addons").toggleable, false);
  assert.equal(parseTabSite("not a url").toggleable, false);
  assert.equal(parseTabSite("").toggleable, false);
});

test("parseTabSite maps local files to the file key", () => {
  assert.deepEqual(parseTabSite("file:///home/user/doc.html"), {
    toggleable: true,
    host: "",
    protocol: "file:",
    label: "file://",
    key: "file://",
  });
});

test("isSiteDisabled matches wildcards and the file key", () => {
  assert.equal(
    isSiteDisabled(["*.example.com"], "sub.example.com", "https:"),
    true,
  );
  assert.equal(isSiteDisabled(["*.example.com"], "other.com", "https:"), false);
  assert.equal(isSiteDisabled(["file://"], "", "file:"), true);
  assert.equal(isSiteDisabled([], "example.com", "https:"), false);
});

test("toggleSiteInList adds and removes the site key", () => {
  assert.deepEqual(toggleSiteInList([], "example.com"), ["example.com"]);
  assert.deepEqual(toggleSiteInList(["example.com"], "example.com"), []);
});

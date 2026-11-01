import "./setup.ts";
import { test } from "node:test";
import assert from "node:assert";
import type { ClosedSessionRow } from "../shared/protocol.ts";

const { filterSessions, isSameSessions, restoreTargets, sessionMeta } =
  await import("../content/restore-manager.ts");

function row(over: Partial<ClosedSessionRow> = {}): ClosedSessionRow {
  return {
    sessionId: "s1",
    kind: "tab",
    title: "Example",
    url: "https://example.com/",
    tabCount: 1,
    lastModified: 1000,
    ...over,
  };
}

test("filterSessions matches titles and urls and keeps everything when empty", () => {
  const rows = [
    row(),
    row({
      sessionId: "s2",
      title: "Docs",
      url: "https://docs.example/",
    }),
    row({
      sessionId: "s3",
      kind: "window",
      title: "News",
      url: "https://news.example/",
      tabCount: 3,
    }),
  ];
  assert.deepEqual(
    filterSessions(rows, "").map((item) => item.sessionId),
    ["s1", "s2", "s3"],
  );
  assert.deepEqual(
    filterSessions(rows, "docs").map((item) => item.sessionId),
    ["s2"],
  );
  assert.deepEqual(
    filterSessions(rows, "news.example").map((item) => item.sessionId),
    ["s3"],
  );
  assert.deepEqual(filterSessions(rows, "missing"), []);
});

test("isSameSessions compares order and every displayed field", () => {
  const rows = [row(), row({ sessionId: "s2" })];
  assert.equal(isSameSessions(rows, { ok: true, rows: [...rows] }), true);
  assert.equal(
    isSameSessions(rows, { ok: true, rows: [rows[1], rows[0]] }),
    false,
  );
  for (const over of [
    { title: "Other" },
    { url: "https://other.example/" },
    { kind: "window" as const, tabCount: 2 },
    { lastModified: 2000 },
  ]) {
    assert.equal(
      isSameSessions(rows, {
        ok: true,
        rows: [row(over), row({ sessionId: "s2" })],
      }),
      false,
    );
  }
  assert.equal(isSameSessions(rows, { ok: true, rows: [rows[0]] }), false);
});

test("restoreTargets prefers marked rows and falls back to the focused one", () => {
  const rows = [
    row(),
    row({ sessionId: "s2", title: "B" }),
    row({ sessionId: "s3", title: "C" }),
  ];
  assert.deepEqual(
    restoreTargets(rows, new Set(["s1", "s3"]), "s2").map(
      (item) => item.sessionId,
    ),
    ["s1", "s3"],
  );
  assert.deepEqual(
    restoreTargets(rows, new Set(), "s2").map((item) => item.sessionId),
    ["s2"],
  );
  assert.deepEqual(restoreTargets(rows, new Set(), "gone"), []);
  assert.deepEqual(restoreTargets(rows, new Set(), null), []);
});

test("sessionMeta counts tabs for windows and stays empty for tabs", () => {
  assert.equal(sessionMeta(row()), "");
  assert.equal(sessionMeta(row({ kind: "window", tabCount: 1 })), "1 tab");
  assert.equal(sessionMeta(row({ kind: "window", tabCount: 4 })), "4 tabs");
});

import "./setup.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { settings } from "../content/settings.js";
import { keymapDefaults } from "../content/keymap.js";

const origSync = { ...globalThis.chrome.storage.sync };
const origLocal = { ...globalThis.chrome.storage.local };
const origLocation = { ...globalThis.location };

function stubStorage({ syncGet, syncSet, localGet, localSet } = {}) {
  if (syncGet) globalThis.chrome.storage.sync.get = syncGet;
  if (syncSet) globalThis.chrome.storage.sync.set = syncSet;
  if (localGet) globalThis.chrome.storage.local.get = localGet;
  if (localSet) globalThis.chrome.storage.local.set = localSet;
}

beforeEach(() => {
  settings.set({
    schemaVersion: 1,
    keymap: { ...keymapDefaults },
    disabledSites: [],
    scrollStep: 120,
  });
});

afterEach(() => {
  globalThis.chrome.storage.sync.get = origSync.get;
  globalThis.chrome.storage.sync.set = origSync.set;
  globalThis.chrome.storage.local.get = origLocal.get;
  globalThis.chrome.storage.local.set = origLocal.set;
  globalThis.location = { ...origLocation };
  settings.set({
    schemaVersion: 1,
    keymap: { ...keymapDefaults },
    disabledSites: [],
    scrollStep: 120,
  });
});

test("update falls back to local storage on sync quota errors", async () => {
  const localWrites = [];
  stubStorage({
    syncSet: async () => {
      throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
    },
    localSet: async (data) => {
      localWrites.push(data);
    },
  });
  await settings.update({ scrollStep: 111 });
  assert.equal(settings.getScrollStep(), 111);
  assert.equal(settings.isPersistedLocally(), true);
  assert.equal(localWrites.length, 1);
  assert.equal(localWrites[0].settings.scrollStep, 111);
});

test("non-quota sync errors still throw", async () => {
  let localWrites = 0;
  stubStorage({
    syncSet: async () => {
      throw new Error("network down");
    },
    localSet: async () => {
      localWrites++;
    },
  });
  await assert.rejects(settings.update({ scrollStep: 112 }), /network down/);
  assert.equal(localWrites, 0);
});

test("failed updates roll back the in-memory state", async () => {
  stubStorage({
    syncSet: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(settings.getScrollStep(), 120);
  await assert.rejects(settings.update({ scrollStep: 999 }), /network down/);
  assert.equal(settings.getScrollStep(), 120);
});

test("load reads back the local fallback", async () => {
  stubStorage({
    syncGet: async () => ({}),
    localGet: async () => ({ settings: { scrollStep: 222 } }),
  });
  await settings.load();
  assert.equal(settings.getScrollStep(), 222);
  assert.equal(settings.isPersistedLocally(), true);
});

test("load prefers newer local settings over stale sync after quota fallback", async () => {
  stubStorage({
    syncGet: async () => ({ settings: { scrollStep: 100, updatedAt: 1000 } }),
    localGet: async () => ({ settings: { scrollStep: 200, updatedAt: 2000 } }),
  });
  await settings.load();
  assert.equal(settings.getScrollStep(), 200);
  assert.equal(settings.isPersistedLocally(), true);
});

test("load prefers newer sync settings when sync is fresher", async () => {
  stubStorage({
    syncGet: async () => ({ settings: { scrollStep: 300, updatedAt: 3000 } }),
    localGet: async () => ({ settings: { scrollStep: 200, updatedAt: 2000 } }),
  });
  await settings.load();
  assert.equal(settings.getScrollStep(), 300);
  assert.equal(settings.isPersistedLocally(), false);
});

test("update stamps the persisted snapshot", async () => {
  const writes = [];
  stubStorage({
    syncSet: async (data) => {
      writes.push(data);
    },
  });
  await settings.update({ scrollStep: 124 });
  assert.equal(writes.length, 1);
  assert.ok(Number.isFinite(writes[0].settings.updatedAt));
  assert.ok(writes[0].settings.updatedAt > 0);
});

test("stale sync changes do not clobber newer local state", async () => {
  stubStorage({
    syncGet: async () => ({ settings: { scrollStep: 100, updatedAt: 1000 } }),
    localGet: async () => ({ settings: { scrollStep: 200, updatedAt: 2000 } }),
  });
  await settings.load();
  assert.equal(settings.getScrollStep(), 200);
  const fire = globalThis.chrome.storage.onChanged._listeners.at(-1);
  fire({ settings: { newValue: { scrollStep: 150, updatedAt: 1500 } } }, "sync");
  assert.equal(settings.getScrollStep(), 200);
  assert.equal(settings.isPersistedLocally(), true);
  fire({ settings: { newValue: { scrollStep: 250, updatedAt: 2500 } } }, "sync");
  assert.equal(settings.getScrollStep(), 250);
  assert.equal(settings.isPersistedLocally(), false);
});

test("persisted settings carry the current schema version", async () => {
  const writes = [];
  stubStorage({
    syncSet: async (data) => {
      writes.push(data);
    },
  });
  await settings.update({ scrollStep: 123 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].settings.schemaVersion, 5);
});

test("unbinding a backfilled combo sticks", async () => {
  const map = { ...settings.getKeymap() };
  assert.ok("t" in map);
  delete map["t"];
  stubStorage({
    syncSet: async () => {},
  });
  await settings.update({ keymap: map });
  assert.equal(settings.getKeymap()["t"], undefined);
});

test("isDisabled matches wildcards and the file sentinel", () => {
  settings.set({ disabledSites: ["*.example.com", "file://"] });
  globalThis.location = { hostname: "sub.example.com", protocol: "https:" };
  assert.equal(settings.isDisabled(), true);
  globalThis.location = { hostname: "example.com", protocol: "https:" };
  assert.equal(settings.isDisabled(), true);
  globalThis.location = { hostname: "other.com", protocol: "https:" };
  assert.equal(settings.isDisabled(), false);
  globalThis.location = { hostname: "", protocol: "file:" };
  assert.equal(settings.isDisabled(), true);
});

test("toggleSiteEnabled uses the file sentinel on local files", () => {
  globalThis.location = { hostname: "", protocol: "file:" };
  settings.toggleSiteEnabled();
  assert.deepEqual(settings.getDisabledSites(), ["file://"]);
  assert.equal(settings.isDisabled(), true);
  settings.toggleSiteEnabled();
  assert.deepEqual(settings.getDisabledSites(), []);
});

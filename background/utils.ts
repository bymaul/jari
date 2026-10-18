import type { RawSettings } from "../content/keymap.ts";

/** The stored settings doc: schema fields plus the updatedAt staleness stamp
 *  written by content/settings.ts. Field access stays guard-first. */
type StoredSettings = Partial<RawSettings> & { updatedAt?: number };

export function clampCount(count: unknown, max = 20): number {
  const n = Math.floor(count as number);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

export async function readStoredSettings(
  area: "sync" | "local",
): Promise<StoredSettings | null> {
  try {
    const stored = await chrome.storage[area].get("settings");
    if (stored && stored.settings) return stored.settings as StoredSettings;
  } catch (err) {
    console.debug(`[jari] Failed to get ${area} settings:`, err);
  }
  return null;
}

export async function getStoredSettings(): Promise<StoredSettings> {
  const [synced, local] = await Promise.all([
    readStoredSettings("sync"),
    readStoredSettings("local"),
  ]);
  if (synced && local) {
    const syncAt = Number.isFinite(synced.updatedAt)
      ? (synced.updatedAt as number)
      : 0;
    const localAt = Number.isFinite(local.updatedAt)
      ? (local.updatedAt as number)
      : 0;
    return localAt > syncAt ? local : synced;
  }
  return (synced || local || {}) as StoredSettings;
}

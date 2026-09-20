export function clampCount(count, max = 20) {
  const n = Math.floor(count);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1;
}

export async function readStoredSettings(area) {
  try {
    const stored = await chrome.storage[area].get("settings");
    if (stored && stored.settings) return stored.settings;
  } catch (err) {
    console.debug(`[jari] Failed to get ${area} settings:`, err);
  }
  return null;
}

export async function getStoredSettings() {
  const [synced, local] = await Promise.all([
    readStoredSettings("sync"),
    readStoredSettings("local"),
  ]);
  if (synced && local) {
    const syncAt = Number.isFinite(synced.updatedAt) ? synced.updatedAt : 0;
    const localAt = Number.isFinite(local.updatedAt) ? local.updatedAt : 0;
    return localAt > syncAt ? local : synced;
  }
  return synced || local || {};
}

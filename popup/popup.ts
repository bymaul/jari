import {
  SHOW_HELP_ACTION,
  isSiteDisabled,
  parseTabSite,
  toggleSiteInList,
} from "./site.ts";
import type { TabSite } from "./site.ts";

const STORAGE_KEY = "settings";

/** Raw persisted settings blob (shape trusted; only updatedAt/disabledSites read). */
type StoredThing = { updatedAt?: unknown } & Record<string, unknown>;

const versionEl = document.querySelector<HTMLElement>("#version");
const dotEl = document.querySelector<HTMLElement>("#dot");
const statusTextEl = document.querySelector<HTMLElement>("#status-text");
const hostEl = document.querySelector<HTMLElement>("#host");
const toggleBtn = document.querySelector<HTMLButtonElement>("#toggle");
const settingsBtn = document.querySelector<HTMLButtonElement>("#settings");
const helpBtn = document.querySelector<HTMLButtonElement>("#help");

try {
  versionEl!.textContent = `v${chrome.runtime.getManifest().version}`;
} catch {}

function storedAt(data: StoredThing | null): number {
  return (data && Number.isFinite(data.updatedAt)
    ? (data.updatedAt as number)
    : 0);
}

async function readOne(
  area: "sync" | "local",
): Promise<StoredThing | null> {
  try {
    const stored = await chrome.storage[area].get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY])
      return stored[STORAGE_KEY] as StoredThing;
  } catch {}
  return null;
}

async function readSettings(): Promise<StoredThing | null> {
  const synced = await readOne("sync");
  const local = await readOne("local");
  if (synced && local) {
    return storedAt(local) > storedAt(synced) ? local : synced;
  }
  return local || synced || null;
}

function isQuotaError(err: unknown): boolean {
  return /quota/i.test(
    String(err && (err as { message?: unknown }).message || err || ""),
  );
}

async function writeSettings(data: StoredThing | null): Promise<void> {
  const payload = {
    [STORAGE_KEY]: { ...(data || {}), updatedAt: Date.now() },
  };
  try {
    await chrome.storage.sync.set(payload);
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    await chrome.storage.local.set(payload);
  }
}

function disabledListOf(stored: StoredThing | null): string[] {
  return stored && Array.isArray(stored.disabledSites)
    ? (stored.disabledSites as string[])
    : [];
}

function render(site: TabSite, list: string[]): void {
  if (!site.toggleable) {
    dotEl!.className = "dot na";
    statusTextEl!.textContent = "Can't run here";
    hostEl!.textContent = "Jari can't run on this page.";
    hostEl!.hidden = false;
    toggleBtn!.textContent = "Disable on this site";
    toggleBtn!.disabled = true;
    helpBtn!.disabled = true;
    return;
  }
  const disabled = isSiteDisabled(list, site.host, site.protocol);
  dotEl!.className = disabled ? "dot off" : "dot on";
  statusTextEl!.textContent = disabled
    ? "Disabled on this site"
    : "Enabled on this site";
  hostEl!.textContent = site.label;
  hostEl!.hidden = false;
  toggleBtn!.textContent = disabled
    ? "Enable on this site"
    : "Disable on this site";
  toggleBtn!.disabled = false;
  helpBtn!.disabled = false;
}

async function boot(): Promise<void> {
  let tab: chrome.tabs.Tab | null = null;
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tab = tabs && tabs[0] ? tabs[0] : null;
  } catch {}
  const site = parseTabSite(tab && tab.url);
  const stored = await readSettings();
  render(site, disabledListOf(stored));

  toggleBtn!.addEventListener("click", async () => {
    if (!site.toggleable) return;
    toggleBtn!.disabled = true;
    try {
      const latest = await readSettings();
      const next = toggleSiteInList(disabledListOf(latest), site.key);
      await writeSettings({ ...(latest || {}), disabledSites: next });
      render(site, next);
    } catch {
      render(site, disabledListOf(await readSettings()));
    }
  });

  settingsBtn!.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  helpBtn!.addEventListener("click", async () => {
    if (!site.toggleable || !tab || !Number.isInteger(tab.id)) return;
    try {
      await chrome.tabs.sendMessage(tab.id as number, {
        action: SHOW_HELP_ACTION,
      });
      window.close();
    } catch {
      hostEl!.textContent = "Press ? on the page for help.";
      hostEl!.hidden = false;
    }
  });

  const firstEnabled = !toggleBtn!.disabled ? toggleBtn! : settingsBtn!;
  firstEnabled.focus();
}

boot();

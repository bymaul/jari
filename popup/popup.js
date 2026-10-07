import {
  SHOW_HELP_ACTION,
  isSiteDisabled,
  parseTabSite,
  toggleSiteInList,
} from "./site.js";

const STORAGE_KEY = "settings";

const versionEl = document.querySelector("#version");
const dotEl = document.querySelector("#dot");
const statusTextEl = document.querySelector("#status-text");
const hostEl = document.querySelector("#host");
const toggleBtn = document.querySelector("#toggle");
const settingsBtn = document.querySelector("#settings");
const helpBtn = document.querySelector("#help");

try {
  versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
} catch {}

function storedAt(data) {
  return data && Number.isFinite(data.updatedAt) ? data.updatedAt : 0;
}

async function readSettings() {
  let synced = null;
  let local = null;
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) synced = stored[STORAGE_KEY];
  } catch {}
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) local = stored[STORAGE_KEY];
  } catch {}
  if (synced && local) {
    return storedAt(local) > storedAt(synced) ? local : synced;
  }
  return local || synced || null;
}

async function writeSettings(data) {
  const payload = {
    [STORAGE_KEY]: { ...(data || {}), updatedAt: Date.now() },
  };
  try {
    await chrome.storage.sync.set(payload);
  } catch (err) {
    if (!/quota/i.test(String((err && err.message) || err || ""))) throw err;
    await chrome.storage.local.set(payload);
  }
}

function disabledListOf(stored) {
  return stored && Array.isArray(stored.disabledSites)
    ? stored.disabledSites
    : [];
}

function render(site, list) {
  if (!site.toggleable) {
    dotEl.className = "dot na";
    statusTextEl.textContent = "Can't run here";
    hostEl.textContent = "Jari can't run on this page.";
    hostEl.hidden = false;
    toggleBtn.textContent = "Disable on this site";
    toggleBtn.disabled = true;
    helpBtn.disabled = true;
    return;
  }
  const disabled = isSiteDisabled(list, site.host, site.protocol);
  dotEl.className = disabled ? "dot off" : "dot on";
  statusTextEl.textContent = disabled
    ? "Disabled on this site"
    : "Enabled on this site";
  hostEl.textContent = site.label;
  hostEl.hidden = false;
  toggleBtn.textContent = disabled
    ? "Enable on this site"
    : "Disable on this site";
  toggleBtn.disabled = false;
  helpBtn.disabled = false;
}

async function boot() {
  let tab = null;
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

  toggleBtn.addEventListener("click", async () => {
    if (!site.toggleable) return;
    toggleBtn.disabled = true;
    try {
      const latest = await readSettings();
      const next = toggleSiteInList(disabledListOf(latest), site.key);
      await writeSettings({ ...(latest || {}), disabledSites: next });
      render(site, next);
    } catch {
      render(site, disabledListOf(await readSettings()));
    }
  });

  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  helpBtn.addEventListener("click", async () => {
    if (!site.toggleable || !tab || !Number.isInteger(tab.id)) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: SHOW_HELP_ACTION });
      window.close();
    } catch {
      hostEl.textContent = "Press ? on the page for help.";
      hostEl.hidden = false;
    }
  });

  const firstEnabled =
    !toggleBtn.disabled ? toggleBtn : settingsBtn;
  firstEnabled.focus();
}

boot();

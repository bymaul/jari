export async function focusWindow(windowId, context = "focusWindow") {
  try {
    const win = await chrome.windows.get(windowId);
    if (win && win.state === "minimized") {
      await chrome.windows.update(windowId, { focused: true, state: "normal" });
    } else {
      await chrome.windows.update(windowId, { focused: true });
    }
  } catch (err) {
    console.error(`[jari] ${context} window focus failed`, err);
  }
}

export async function maximizeWindow(windowId) {
  try {
    await chrome.windows.update(windowId, { state: "maximized" });
  } catch (err) {
    console.error("[jari] openInIncognito window maximize failed", err);
  }
}

export async function openInIncognito(url) {
  const windows = await chrome.windows.getAll({});
  const incognito = (windows || []).find((win) => win && win.incognito);
  if (incognito) {
    const tab = await chrome.tabs.create(
      url
        ? { windowId: incognito.id, url, active: true }
        : { windowId: incognito.id, active: true },
    );
    await focusWindow(incognito.id, "openInIncognito");
    await maximizeWindow(incognito.id);
    return tab ? { ok: true, id: tab.id } : { ok: false };
  }
  const win = await chrome.windows.create(
    url
      ? { url, incognito: true, state: "maximized" }
      : { incognito: true, state: "maximized" },
  );
  return win ? { ok: true, id: win.id } : { ok: false };
}

export async function moveTabIntoWindowAndFocus(tabId, targetWindowId, context) {
  await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 });
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const last = tabs[tabs.length - 1];
  if (last) {
    await focusWindow(targetWindowId, context);
    await chrome.tabs.update(last.id, { active: true });
  }
}

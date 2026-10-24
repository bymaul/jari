export async function focusWindow(
  windowId: number,
  context = "focusWindow",
): Promise<void> {
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

export async function maximizeWindow(windowId: number): Promise<void> {
  try {
    await chrome.windows.update(windowId, { state: "maximized" });
  } catch (err) {
    console.error("[jari] openInIncognito window maximize failed", err);
  }
}

export async function openInIncognito(
  url?: string,
): Promise<{ ok: true; id?: number } | { ok: false }> {
  const windows = await chrome.windows.getAll({});
  const incognito = (windows || []).find((win) => win && win.incognito);
  if (incognito) {
    const tab = await chrome.tabs.create(
      url
        ? { windowId: incognito.id as number, url, active: true }
        : { windowId: incognito.id as number, active: true },
    );
    await focusWindow(incognito.id as number, "openInIncognito");
    await maximizeWindow(incognito.id as number);
    return tab ? { ok: true, id: tab.id } : { ok: false };
  }
  const win = await chrome.windows.create(
    url
      ? { url, incognito: true, state: "maximized" }
      : { incognito: true, state: "maximized" },
  );
  return win ? { ok: true, id: win.id } : { ok: false };
}

export async function moveTabIntoWindowAndFocus(
  tabId: number | number[],
  targetWindowId: number,
  context: string,
): Promise<void> {
  await chrome.tabs.move(tabId as number, {
    windowId: targetWindowId,
    index: -1,
  });
  const tabs = await chrome.tabs.query({ windowId: targetWindowId });
  const last = tabs[tabs.length - 1];
  if (last) {
    await focusWindow(targetWindowId, context);
    await chrome.tabs.update(last.id as number, { active: true });
  }
}

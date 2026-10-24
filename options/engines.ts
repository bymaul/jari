import { settings } from "../content/settings.ts";
import {
  MAX_SEARCH_ENGINES,
  searchEngineDefaults,
  validateSearchEngine,
} from "../shared/search-engines.ts";
import type { SearchEngine } from "../shared/search-engines.ts";
import { settingsDefaults } from "../content/keymap.ts";
import type { Settings } from "../content/keymap.ts";

type EngineRowData = {
  kwEl: HTMLInputElement;
  urlEl: HTMLInputElement;
  keyword: string;
  url: string;
};

const engineListEl = document.querySelector<HTMLElement>("#engine-list");
const defaultEngineEl =
  document.querySelector<HTMLSelectElement>("#default-engine");
const addEngineBtn = document.querySelector<HTMLButtonElement>("#add-engine");
const resetEnginesBtn =
  document.querySelector<HTMLButtonElement>("#reset-engines");
const statusEl = document.querySelector<
  HTMLElement & { _timer?: ReturnType<typeof setTimeout> }
>("#status");
const saveStateEl = document.querySelector<HTMLElement>("#save-state");

function setSaveState(
  mode: "saving" | "failed" | "warn" | "saved",
  message?: string,
): void {
  if (!saveStateEl) return;
  saveStateEl.classList.remove("saving", "failed", "warn");
  if (mode === "saving") {
    saveStateEl.classList.add("saving");
    saveStateEl.textContent = message || "Saving...";
  } else if (mode === "failed") {
    saveStateEl.classList.add("failed");
    saveStateEl.textContent =
      message || "Save failed — will retry on next change";
  } else if (mode === "warn") {
    saveStateEl.classList.add("warn");
    saveStateEl.textContent = message || "Saved locally";
  } else {
    saveStateEl.textContent = message || "All changes saved";
  }
}

function savedState(): void {
  if (settings.isPersistedLocally()) {
    setSaveState("warn", "Saved on this device only — browser sync is full");
  } else {
    setSaveState("saved");
  }
}

async function savePatch(patch: Partial<Settings>): Promise<boolean> {
  setSaveState("saving");
  try {
    await settings.update(patch);
  } catch {
    setSaveState("failed");
    return false;
  }
  savedState();
  return true;
}

function status(message: string): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  clearTimeout(statusEl._timer ?? undefined);
  statusEl._timer = setTimeout(() => {
    statusEl.textContent = "";
  }, 2500);
}

function showFieldError(id: string, message: string): void {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = message;
  (el as HTMLElement).hidden = false;
}

function clearFieldError(id: string): void {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = "";
  (el as HTMLElement).hidden = true;
}

function markInvalid(el: Element | null, invalid: boolean): void {
  if (!el) return;
  if (invalid) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

function engineRow(keyword: string, url: string): HTMLLIElement {
  const li = document.createElement("li");
  const kwEl = document.createElement("input");
  kwEl.type = "text";
  kwEl.className = "engine-keyword";
  kwEl.value = keyword;
  kwEl.placeholder = "kw";
  kwEl.setAttribute("aria-label", "Search engine keyword");
  kwEl.setAttribute("autocomplete", "off");
  kwEl.setAttribute("spellcheck", "false");
  kwEl.addEventListener("change", commitEngines);
  const urlEl = document.createElement("input");
  urlEl.type = "text";
  urlEl.className = "engine-url";
  urlEl.value = url;
  urlEl.placeholder = "https://example.com/search?q=%s";
  urlEl.setAttribute(
    "aria-label",
    "Search engine URL (%s is replaced by the query)",
  );
  urlEl.setAttribute("autocomplete", "off");
  urlEl.setAttribute("spellcheck", "false");
  urlEl.addEventListener("change", commitEngines);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${keyword || "engine"}`);
  remove.addEventListener("click", () => removeEngine(li));
  li.appendChild(kwEl);
  li.appendChild(urlEl);
  li.appendChild(remove);
  return li;
}

function readEngineRows(): EngineRowData[] {
  const rows: EngineRowData[] = [];
  if (!engineListEl) return rows;
  for (const li of engineListEl.children) {
    const kwEl = li.querySelector<HTMLInputElement>(".engine-keyword");
    const urlEl = li.querySelector<HTMLInputElement>(".engine-url");
    if (!kwEl || !urlEl) continue;
    rows.push({
      kwEl,
      urlEl,
      keyword: kwEl.value.trim(),
      url: urlEl.value.trim(),
    });
  }
  return rows;
}

export function renderEngines(): void {
  if (!engineListEl) return;
  engineListEl.textContent = "";
  clearFieldError("error-engines");
  for (const engine of settings.getSearchEngines()) {
    engineListEl.appendChild(engineRow(engine.keyword, engine.url));
  }
  syncDefaultEngineOptions();
}

function syncDefaultEngineOptions(): void {
  if (!defaultEngineEl) return;
  const engines = settings.getSearchEngines();
  defaultEngineEl.textContent = "";
  for (const engine of engines) {
    const opt = document.createElement("option");
    opt.value = engine.keyword;
    opt.textContent = engine.keyword;
    defaultEngineEl.appendChild(opt);
  }
  defaultEngineEl.value = settings.getDefaultEngine();
}

function failEngines(message: string, badEls?: Element[]): void {
  for (const el of badEls || []) markInvalid(el, true);
  showFieldError("error-engines", `${message} (not saved)`);
  status(
    `Search engines: ${message.charAt(0).toLowerCase() + message.slice(1)}`,
  );
}

function commitEngines(): void {
  const rows = readEngineRows();
  for (const row of rows) {
    markInvalid(row.kwEl, false);
    markInvalid(row.urlEl, false);
  }
  clearFieldError("error-engines");
  const complete = rows.filter((r) => r.keyword !== "" && r.url !== "");
  const seen = new Set<string>();
  const list: SearchEngine[] = [];
  for (const row of complete) {
    const problem = validateSearchEngine({
      keyword: row.keyword,
      url: row.url,
    });
    if (problem) {
      failEngines(problem, [row.kwEl, row.urlEl]);
      return;
    }
    const keyword = row.keyword.toLowerCase();
    if (seen.has(keyword)) {
      failEngines(`Duplicate keyword "${keyword}"`, [row.kwEl]);
      return;
    }
    seen.add(keyword);
    list.push({ keyword, url: row.url });
  }
  if (list.length === 0) {
    if (rows.length === 0) {
      failEngines("At least one search engine is required", []);
      renderEngines();
    }
    return;
  }
  if (list.length > MAX_SEARCH_ENGINES) {
    failEngines(`At most ${MAX_SEARCH_ENGINES} search engines`, []);
    return;
  }
  const current = settings.getDefaultEngine();
  const def = list.some((e) => e.keyword === current)
    ? current
    : list[0].keyword;
  savePatch({ searchEngines: list, defaultEngine: def }).then((ok) => {
    if (!ok) return;
    for (let i = 0; i < list.length; i++) {
      const row = complete[i];
      if (!row) break;
      row.kwEl.value = list[i].keyword;
      row.urlEl.value = list[i].url;
    }
    syncDefaultEngineOptions();
  });
}

function removeEngine(li: HTMLLIElement): void {
  const rows = readEngineRows();
  if (rows.length <= 1) {
    failEngines("At least one search engine is required", []);
    return;
  }
  const remaining = rows.filter((row) => {
    try {
      return row.kwEl.closest("li") !== li;
    } catch {
      return true;
    }
  });
  if (!remaining.some((r) => r.keyword !== "" && r.url !== "")) {
    failEngines("At least one search engine is required", []);
    return;
  }
  li.remove();
  commitEngines();
}

function addEngine(): void {
  if (!engineListEl) return;
  clearFieldError("error-engines");
  if (engineListEl.children.length >= MAX_SEARCH_ENGINES) {
    showFieldError(
      "error-engines",
      `At most ${MAX_SEARCH_ENGINES} search engines (not saved)`,
    );
    return;
  }
  const li = engineRow("", "");
  engineListEl.appendChild(li);
  li.querySelector<HTMLInputElement>(".engine-keyword")!.focus();
}

function resetEngines(): void {
  savePatch({
    searchEngines: searchEngineDefaults(),
    defaultEngine: settingsDefaults.defaultEngine,
  }).then((ok) => {
    if (ok) {
      renderEngines();
      status("Search engines restored to defaults");
    }
  });
}

export function initEngines(): void {
  addEngineBtn?.addEventListener("click", addEngine);
  resetEnginesBtn?.addEventListener("click", resetEngines);
  defaultEngineEl?.addEventListener("change", () =>
    savePatch({ defaultEngine: defaultEngineEl!.value }).then(() => {
      syncDefaultEngineOptions();
    }),
  );
}

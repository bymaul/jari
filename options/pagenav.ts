import { settings } from "../content/settings.ts";
import {
  MAX_PAGE_NAV_TEXTS,
  PAGE_NAV_TEXT_MAX,
  pageNavTextDefaults,
} from "../shared/page-nav-texts.ts";

import type { Settings } from "../content/keymap.ts";

const pagenavNextEl = document.querySelector<HTMLInputElement>("#pagenav-next");
const pagenavPrevEl = document.querySelector<HTMLInputElement>("#pagenav-prev");
const resetPagenavBtn =
  document.querySelector<HTMLButtonElement>("#reset-pagenav");
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

export function renderPagenav(): void {
  if (pagenavNextEl)
    pagenavNextEl.value = settings.getPageNavTexts().next.join(", ");
  if (pagenavPrevEl)
    pagenavPrevEl.value = settings.getPageNavTexts().prev.join(", ");
  clearFieldError("error-pagenav");
}

function failPagenav(message: string, badEls?: Element[]): void {
  for (const el of badEls || []) markInvalid(el, true);
  showFieldError("error-pagenav", `${message} (not saved)`);
  status(`Page navigation: ${message.charAt(0).toLowerCase() + message.slice(1)}`);
}

function parsePagenavField(
  input: HTMLInputElement,
  label: string,
): { error?: string; bad?: Element[]; list?: string[] } {
  markInvalid(input, false);
  const seen = new Set();
  const list = [];
  for (const part of String(input.value || "").split(",")) {
    const text = part.trim();
    if (text === "") continue;
    if (text.length > PAGE_NAV_TEXT_MAX) {
      return {
        error: `Text must be ${PAGE_NAV_TEXT_MAX} characters or fewer`,
        bad: [input],
      };
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      return { error: `Duplicate text "${text}"`, bad: [input] };
    }
    seen.add(key);
    list.push(text);
  }
  if (list.length === 0) {
    return { error: `At least one ${label} text is required`, bad: [input] };
  }
  if (list.length > MAX_PAGE_NAV_TEXTS) {
    return { error: `At most ${MAX_PAGE_NAV_TEXTS} texts per field`, bad: [input] };
  }
  return { list };
}

function commitPagenav() {
  if (!pagenavNextEl || !pagenavPrevEl) return;
  clearFieldError("error-pagenav");
  const next = parsePagenavField(pagenavNextEl, "next page");
  if (next.error) {
    failPagenav(next.error, next.bad);
    return;
  }
  const prev = parsePagenavField(pagenavPrevEl, "previous page");
  if (prev.error) {
    failPagenav(prev.error, prev.bad);
    return;
  }
  savePatch({ pageNavTexts: { next: next.list!, prev: prev.list! } }).then(
    (ok) => {
      if (!ok) return;
      renderPagenav();
    },
  );
}

function resetPagenav(): void {
  savePatch({ pageNavTexts: pageNavTextDefaults() }).then((ok) => {
    if (ok) {
      renderPagenav();
      status("Page navigation texts restored to defaults");
    }
  });
}

export function initPagenav(): void {
  pagenavNextEl?.addEventListener("change", commitPagenav);
  pagenavPrevEl?.addEventListener("change", commitPagenav);
  resetPagenavBtn?.addEventListener("click", resetPagenav);
}

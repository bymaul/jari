import { fuzzyIndices, rankMatches, substringIndices } from "./rank.js";
import { parseEngineKeyword } from "../shared/search-engines.js";
import { normalizeUrl, Url } from "../shared/url.js";
import { settings } from "./settings.js";
import { createShadowHost, sendMessage, ui } from "./ui.js";
import { promptCss, renderText } from "./prompt/shared.js";
import { register, touch } from "./overlays.js";

const HOST_CLASS = "jari-tab-manager-host";
const GROUPED_NONE = -1;
const POLL_MS = 2000;

const FOOTER_MINIMAL =
  "Space mark | Enter switch | d close | / filter | Esc close | ? more";
const FOOTER_FULL = [
  "Space mark | v range | V all | Enter switch | d close | y duplicate | e edit | t new tab | ? less",
  "p pin | m mute | g group | a add to group | u ungroup | r rename | b bookmark | J/K reorder | Esc close",
];

const FIELDS = {
  open: {
    maxLength: 500,
    placeholder: "Open URL or search...",
    hint: "Enter opens in the background · Esc cancel",
    badge: "tab URL",
  },
  group: {
    maxLength: 100,
    placeholder: "Group name",
    hint: "Enter save · Esc cancel",
    badge: "renaming group",
  },
  url: {
    maxLength: 500,
    placeholder: "Tab URL",
    hint: "Enter save · Esc cancel",
    badge: "editing url",
  },
  filter: {
    maxLength: 200,
    placeholder: "Filter tabs",
    hint: "Enter done · Esc cancel",
    badge: "filtering",
  },
};

let active = false;
let host = null;
let overlay = null;
let headerEl = null;
let listEl = null;
let footerEl = null;
let restoreFocus = null;

let tabs = [];
let windowId = null;
let groupsById = new Map();
let filtered = [];
let selected = 0;
let marked = new Set();
let query = "";
let showHints = false;
let visualAnchor = null;
let visualPainted = new Set();
let visualBaseline = new Set();
let field = null;
let fieldEl = null;
let fieldFocusBefore = null;
let confirm = null;
let pollTimer = null;
let refreshing = false;

export function sortManagerTabs(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return (a.index || 0) - (b.index || 0);
  });
}

export function filterManagerTabs(list, text, fuzzy = true) {
  const q = String(text || "").trim();
  if (!q) return [...list];
  const ranked = rankMatches(q, list, fuzzy);
  return fuzzy ? ranked.map((entry) => entry.item) : ranked;
}

export function targetsForAction(list, markedIds, focusedId) {
  const rows = Array.isArray(list) ? list : [];
  const ids = [...(markedIds || [])];
  if (ids.length > 0) {
    const wanted = new Set(ids);
    return rows.filter((tab) => wanted.has(tab.id));
  }
  const focused = rows.find((tab) => tab.id === focusedId);
  return focused ? [focused] : [];
}

export function needsCloseConfirm(targets) {
  return Array.isArray(targets) && targets.length > 1;
}

export function decideSetState(targets, key) {
  return (targets || []).some((tab) => !tab[key]);
}

const GROUP_COLORS = {
  grey: "#878787",
  blue: "#6e94b2",
  red: "#d8647e",
  yellow: "#fdbe7c",
  green: "#7fa563",
  pink: "#ed9daf",
  purple: "#97519c",
  cyan: "#aeaed1",
  orange: "#e0a363",
};

export function groupColorHex(name) {
  return GROUP_COLORS[String(name || "").toLowerCase()] || "#888888";
}

export function stateTags(tab) {
  const out = [];
  if (!tab) return out;
  if (tab.pinned) out.push("pin");
  if (tab.muted) out.push("muted");
  else if (tab.audible) out.push("playing");
  if (tab.bookmarked) out.push("bookmarked");
  return out;
}

export function confirmKey(ids) {
  return [...(ids || [])].sort((a, b) => a - b).join(",");
}

function isActive() {
  return active;
}

async function ask(action, payload) {
  try {
    return await sendMessage(action, payload);
  } catch {
    return null;
  }
}

function focusedTab() {
  return filtered[selected] || null;
}

function focusedId() {
  const focused = focusedTab();
  return focused ? focused.id : null;
}

function currentTargets() {
  return targetsForAction(tabs, marked, focusedId());
}

function managerCss() {
  return (
    promptCss() +
    `
    .jari-prompt-footer {
      display: block;
      background: #252530;
      color: #cdcdcd;
      font-size: var(--jari-header-font-size, 9pt) !important;
      border-top: 1px solid #333738;
      padding: 0.25ex 0.5ex;
      margin: 0;
      white-space: normal;
      overflow: hidden;
      text-align: left !important;
    }
    .jari-prompt-footer.jari-manager-warn {
      color: #e0a363;
      font-weight: bold !important;
    }
    .jari-prompt-input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      color: #cdcdcd;
      background: #1c1c24;
      border: none !important;
      border-top: 1px solid #333738;
      outline: none !important;
      box-shadow: none !important;
      font-family: var(--jari-cmdl-font-family, monospace) !important;
      font-size: var(--jari-cmdl-font-size, 9pt) !important;
      line-height: var(--jari-cmdl-line-height, 1.5) !important;
      font-weight: normal !important;
      text-align: left !important;
      padding: 0.25ex 0.5ex;
      margin: 0;
    }
    .jari-prompt-list li.jari-mgr-row {
      display: grid !important;
      grid-template-columns: auto auto minmax(0, 1fr) auto minmax(0, 36%);
      column-gap: 1ex;
      align-items: baseline !important;
      height: auto !important;
      line-height: 1.7 !important;
      white-space: nowrap !important;
      padding: 0 1ex !important;
      margin: 0;
      overflow: hidden !important;
      cursor: pointer;
    }
    .jari-prompt-list li.jari-mgr-row .jari-mgr-loc,
    .jari-prompt-list li.jari-mgr-row .jari-mgr-tag {
      opacity: 0.7;
      white-space: nowrap;
    }
    .jari-prompt-list li.jari-mgr-row .jari-mgr-mark {
      color: var(--jari-accent, #e0a363);
      font-weight: bold !important;
    }
    .jari-prompt-list li.jari-mgr-row.marked {
      background: rgba(224, 163, 99, 0.16) !important;
    }
    .jari-prompt-list li.jari-mgr-row.selected {
      background: var(--jari-of-bg, #333738) !important;
    }
    .jari-prompt-list li.jari-mgr-row .jari-mgr-win {
      font-weight: bold !important;
    }
    .jari-prompt-list li.jari-mgr-row .jari-mgr-win.jari-mgr-cur {
      color: var(--jari-accent, #e0a363);
    }
    .jari-prompt-list li.jari-mgr-row .title,
    .jari-prompt-list li.jari-mgr-row .url {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .jari-prompt-list li.jari-mgr-row .url {
      margin-left: 0;
    }
    .jari-manager-backdrop {
      all: initial;
      display: block;
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.45) !important;
      z-index: 2147483645 !important;
      pointer-events: auto !important;
    }
    .jari-overlay {
      left: 50% !important;
      right: auto !important;
      bottom: auto !important;
      top: 12vh !important;
      transform: translateX(-50%) !important;
      width: min(1020px, calc(100vw - 48px)) !important;
      max-height: 76vh !important;
      display: flex !important;
      flex-direction: column !important;
      border: 1px solid #45454f !important;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55) !important;
      overflow: hidden !important;
    }
    .jari-prompt-list {
      max-height: 52vh !important;
    }
    .jari-prompt-header.jari-mgr-header {
      display: flex !important;
      align-items: baseline !important;
      gap: 0 1.5ex;
    }
    .jari-mgr-title {
      flex: none;
      font-weight: var(--jari-header-font-weight, bold) !important;
    }
    .jari-mgr-stats {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-mgr-badge {
      flex: none;
      opacity: 0.8;
      font-weight: normal !important;
    }
    .jari-mgr-pos {
      flex: none;
      opacity: 0.7;
      font-weight: normal !important;
    }
  `
  );
}

function windowLabels(rows) {
  const labels = new Map();
  let n = 0;
  for (const tab of rows) {
    if (!labels.has(tab.windowId)) labels.set(tab.windowId, ++n);
  }
  return labels;
}

function appendSpan(li, className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  li.appendChild(span);
  return span;
}

function highlightSpan(span, text, q) {
  if (!q) {
    span.textContent = text;
    return;
  }
  if (settings.isFuzzyMatching()) renderText(span, text, fuzzyIndices(q, text));
  else renderText(span, text, substringIndices(q, text));
}

function renderRow(tab, labels, currentWin) {
  const li = document.createElement("li");
  li.className = "jari-mgr-row";
  li.classList.toggle("marked", marked.has(tab.id));
  appendSpan(li, "jari-mgr-mark", marked.has(tab.id) ? "●" : "○");
  const info = groupsById.get(tab.groupId) || null;
  const loc = document.createElement("span");
  loc.className = "jari-mgr-loc";
  const win = document.createElement("span");
  win.className = "jari-mgr-win";
  win.textContent = `W${labels.get(tab.windowId) || "?"}`;
  win.classList.toggle("jari-mgr-cur", tab.windowId === currentWin);
  loc.appendChild(win);
  if (info) {
    const group = document.createElement("span");
    group.className = "jari-mgr-group";
    group.textContent = `/${info.title || "group"}`;
    if (info.color) {
      try {
        group.style.color = groupColorHex(info.color);
      } catch {}
    }
    loc.appendChild(group);
  }
  li.appendChild(loc);
  const title = document.createElement("span");
  title.className = "title";
  highlightSpan(title, tab.title || "(untitled)", query);
  li.appendChild(title);
  appendSpan(
    li,
    "jari-mgr-tag",
    stateTags(tab)
      .map((tag) => `[${tag}]`)
      .join(" "),
  );
  appendSpan(li, "url", tab.url || "");
  return li;
}

function renderHeader() {
  const wins = new Set(tabs.map((tab) => tab.windowId)).size;
  headerEl.textContent = "";
  headerEl.classList.add("jari-mgr-header");

  appendSpan(headerEl, "jari-mgr-title", "Tab manager");

  const stats = document.createElement("span");
  stats.className = "jari-mgr-stats";
  const labels = windowLabels(tabs);
  let summary = `${tabs.length} tabs · ${wins} windows`;
  if (windowId !== null) summary += ` · current W${labels.get(windowId) || "?"}`;
  summary += " · ";
  stats.textContent = summary;
  const marks = document.createElement("span");
  marks.className = "jari-mgr-marked";
  marks.textContent = `${marked.size} marked`;
  stats.appendChild(marks);
  headerEl.appendChild(stats);

  if (query) appendSpan(headerEl, "jari-mgr-badge", `/${query}`);
  if (visualAnchor !== null)
    appendSpan(headerEl, "jari-mgr-badge", "(visual)");
  if (field) appendSpan(headerEl, "jari-mgr-badge", `(${FIELDS[field.kind].badge})`);

  const total = filtered.length;
  appendSpan(headerEl, "jari-mgr-pos", total === 0 ? "0/0" : `${selected + 1}/${total}`);
}

function renderFooter() {
  if (field) {
    setFooterLines([FIELDS[field.kind].hint], false);
    return;
  }
  if (confirm) {
    setFooterLines([confirm.message], true);
  } else {
    setFooterLines(showHints ? FOOTER_FULL : [FOOTER_MINIMAL], false);
  }
}

function setFooterLines(lines, warn) {
  footerEl.classList.toggle("jari-manager-warn", !!warn);
  footerEl.textContent = "";
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    footerEl.appendChild(div);
  }
}

function renderList() {
  const labels = windowLabels(tabs);
  listEl.textContent = "";
  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.textContent = query ? "No matching tabs" : "No tabs";
    listEl.appendChild(li);
    return;
  }
  for (const tab of filtered)
    listEl.appendChild(renderRow(tab, labels, windowId));
  Array.from(listEl.children).forEach((li, i) =>
    li.classList.toggle("selected", i === selected),
  );
  const el = listEl.children[selected];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function renderAll() {
  if (!active) return;
  renderHeader();
  renderList();
  renderFooter();
}

function indexOfTab(id) {
  return filtered.findIndex((tab) => tab.id === id);
}

function applyFilter() {
  const focused = focusedId();
  filtered = filterManagerTabs(tabs, query, settings.isFuzzyMatching());
  const kept = focused === null ? -1 : indexOfTab(focused);
  selected = kept >= 0 ? kept : Math.min(selected, filtered.length - 1);
}

function adoptSnapshot(res) {
  tabs = sortManagerTabs(res.tabs);
  windowId = Number.isInteger(res.currentWindowId) ? res.currentWindowId : null;
  groupsById = new Map(
    (Array.isArray(res.groups) ? res.groups : []).map((group) => [
      group.id,
      { title: group.title || "", color: group.color || "" },
    ]),
  );
}

function pruneMarksAndConfirm() {
  const alive = new Set(tabs.map((tab) => tab.id));
  for (const id of [...marked]) {
    if (!alive.has(id)) marked.delete(id);
  }
  if (!confirm) return;
  const gone = confirm.ids.filter((id) => !alive.has(id));
  if (gone.length === 0) return;
  const kept = confirm.ids.filter((id) => alive.has(id));
  confirm = {
    ...confirm,
    ids: kept,
    message: `Some tabs are gone — press d again to close ${kept.length}`,
  };
}

async function refresh() {
  refreshing = true;
  let res;
  try {
    res = await sendMessage("managerList");
  } catch {
    res = null;
  } finally {
    refreshing = false;
  }
  if (!active) return;
  if (!res || !res.ok || !Array.isArray(res.tabs)) {
    ui.toast("Tab manager unavailable");
    close();
    return;
  }
  const focused = focusedId();
  adoptSnapshot(res);
  pruneMarksAndConfirm();
  applyFilter();
  const kept = focused === null ? -1 : indexOfTab(focused);
  if (kept >= 0) selected = kept;
  renderAll();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!active || refreshing || document.hidden) return;
    if (field) return;
    refresh();
  }, POLL_MS);
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function pollState() {
  return { active, polling: pollTimer !== null, refreshing };
}

async function open() {
  if (active) return;
  const res = await ask("managerList");
  if (!res || !res.ok || !Array.isArray(res.tabs)) {
    ui.toast("Tab manager unavailable");
    return;
  }
  adoptSnapshot(res);
  filtered = [];
  selected = 0;
  marked = new Set();
  query = "";
  field = null;
  confirm = null;
  endVisual();
  active = true;
  touch("tab-manager");

  const created = createShadowHost(HOST_CLASS, managerCss());
  host = created.host;
  overlay = document.createElement("div");
  overlay.className = "jari-overlay jari-prompt";

  headerEl = document.createElement("div");
  headerEl.className = "jari-prompt-header";

  listEl = document.createElement("ul");
  listEl.className = "jari-prompt-list";

  footerEl = document.createElement("div");
  footerEl.className = "jari-prompt-footer";

  const backdrop = document.createElement("div");
  backdrop.className = "jari-manager-backdrop";
  backdrop.addEventListener("click", () => close());

  overlay.appendChild(headerEl);
  overlay.appendChild(listEl);
  overlay.appendChild(footerEl);
  created.shadow.appendChild(backdrop);
  created.shadow.appendChild(overlay);

  restoreFocus = document.activeElement;
  applyFilter();
  const start =
    tabs.find((tab) => tab.windowId === windowId && tab.active) ||
    tabs.find((tab) => tab.windowId === windowId) ||
    tabs.find((tab) => tab.active);
  if (start) {
    const idx = indexOfTab(start.id);
    if (idx >= 0) selected = idx;
  }
  renderAll();
  overlay.tabIndex = -1;
  ui.safeFocus(overlay, { preventScroll: true });
  document.addEventListener("visibilitychange", onVisibility);
  startPolling();
}

function onVisibility() {
  if (!document.hidden && active) refresh();
}

function close() {
  stopPolling();
  refreshing = false;
  document.removeEventListener("visibilitychange", onVisibility);
  if (host) {
    try {
      host.remove();
    } catch {}
    host = null;
  }
  overlay = null;
  field = null;
  fieldEl = null;
  fieldFocusBefore = null;
  headerEl = null;
  listEl = null;
  footerEl = null;
  tabs = [];
  windowId = null;
  groupsById = new Map();
  filtered = [];
  selected = 0;
  marked = new Set();
  query = "";
  field = null;
  confirm = null;
  endVisual();
  active = false;

  if (
    restoreFocus &&
    restoreFocus.isConnected &&
    document.activeElement !== restoreFocus
  ) {
    try {
      restoreFocus.focus();
    } catch {}
  }
  restoreFocus = null;
}

function paintRange() {
  if (visualAnchor === null) return;
  const from = Math.min(visualAnchor, selected);
  const to = Math.max(visualAnchor, selected);
  const painted = new Set();
  for (let i = from; i <= to; i++) {
    const tab = filtered[i];
    if (!tab) continue;
    painted.add(tab.id);
    marked.add(tab.id);
  }
  for (const id of visualPainted) {
    if (painted.has(id) || visualBaseline.has(id)) continue;
    marked.delete(id);
  }
  visualPainted = painted;
}

function move(delta) {
  if (filtered.length === 0) return;
  confirm = null;
  endVisual();
  selected = (selected + delta + filtered.length) % filtered.length;
  renderAll();
}

function moveVisual(delta) {
  if (filtered.length === 0) return;
  confirm = null;
  selected = (selected + delta + filtered.length) % filtered.length;
  paintRange();
  renderAll();
}

function toggleMark() {
  const tab = focusedTab();
  if (!tab) return;
  confirm = null;
  if (marked.has(tab.id)) marked.delete(tab.id);
  else marked.add(tab.id);
  renderAll();
}

function endVisual() {
  visualAnchor = null;
  visualPainted = new Set();
  visualBaseline = new Set();
}

function startVisual() {
  if (filtered.length === 0) return;
  confirm = null;
  visualAnchor = selected;
  visualBaseline = new Set(marked);
  visualPainted = new Set();
  paintRange();
}

function markAllVisible() {
  confirm = null;
  endVisual();
  for (const tab of filtered) marked.add(tab.id);
  renderAll();
}

function consumeMarks() {
  marked = new Set();
  endVisual();
}

async function activateFocused() {
  const tab = focusedTab();
  if (!tab) return;
  close();
  await sendMessage("activateTab", { id: tab.id });
}

function armConfirm(kind, ids, message) {
  confirm = { kind, key: confirmKey(ids), ids: [...ids], message };
  renderAll();
}

function isConfirmed(kind, ids) {
  return (
    !!confirm &&
    confirm.kind === kind &&
    confirm.key === confirmKey(ids) &&
    confirm.ids.length === ids.length
  );
}

function failureMessage(res, outcome) {
  if (res && res.reason === "unsupported") {
    return "Tab groups not supported here";
  }
  return outcome.failed;
}

async function runOnTargets(action, payload, outcome, opts = {}) {
  const targets = currentTargets();
  if (targets.length === 0) return;
  confirm = null;
  const res = await ask(action, payload(targets));
  if (!active) return;
  if (!res || !res.ok) {
    ui.toast(failureMessage(res, outcome));
    renderAll();
    return;
  }
  if (outcome.done) outcome.done(res, targets);
  if (!opts.keepMarks) consumeMarks();
  await refresh();
}

async function closeTargets() {
  const targets = currentTargets();
  if (targets.length === 0) return;
  const ids = targets.map((tab) => tab.id);
  if (needsCloseConfirm(targets) && !isConfirmed("close", ids)) {
    const pinned = targets.filter((tab) => tab.pinned).length;
    armConfirm(
      "close",
      ids,
      `Press d again to close ${ids.length} tabs${pinned ? ` (${pinned} pinned)` : ""} · Esc cancels`,
    );
    return;
  }
  await runOnTargets(
    "closeManagerTabs",
    () => ({ ids }),
    { failed: "Close failed", done: (res) => ui.toast(`Closed ${res.closed}`) },
  );
}

const FLAGS = {
  pin: {
    label: "Pin",
    key: "pinned",
    action: "setTabsPinned",
    field: "pinned",
    on: "Pinned",
    off: "Unpinned",
  },
  mute: {
    label: "Mute",
    key: "muted",
    action: "setTabsMuted",
    field: "muted",
    on: "Muted",
    off: "Unmuted",
  },
};

function toggleFlag(kind) {
  const flag = FLAGS[kind];
  return runOnTargets(
    flag.action,
    (targets) => ({
      ids: targets.map((tab) => tab.id),
      [flag.field]: decideSetState(targets, flag.key),
    }),
    {
      failed: `${flag.label} failed`,
      done: (res, targets) => {
        const next = decideSetState(targets, flag.key);
        ui.toast(`${next ? flag.on : flag.off} ${res.updated}`);
      },
    },
  );
}

function groupTargets() {
  return runOnTargets(
    "groupManagerTabs",
    (targets) => ({ ids: targets.map((tab) => tab.id) }),
    {
      failed: "Group failed",
      done: (res, targets) => ui.toast(`Grouped ${targets.length} tabs`),
    },
  );
}

async function addToFocusedGroup() {
  const focused = focusedTab();
  const targets = currentTargets();
  if (!focused || targets.length === 0) return;
  confirm = null;
  let groupId = GROUPED_NONE;
  for (let dist = 0; dist < filtered.length; dist++) {
    const up = filtered[selected - dist];
    if (up && up.groupId !== GROUPED_NONE) {
      groupId = up.groupId;
      break;
    }
    const down = filtered[selected + dist];
    if (down && down.groupId !== GROUPED_NONE) {
      groupId = down.groupId;
      break;
    }
  }
  if (groupId === GROUPED_NONE) {
    ui.toast("No groups yet — g creates one");
    renderAll();
    return;
  }
  const outside = targets.filter((tab) => tab.groupId !== groupId);
  if (outside.length === 0) {
    ui.toast("Already in this group");
    renderAll();
    return;
  }
  const res = await ask("groupManagerTabs", {
    ids: outside.map((tab) => tab.id),
    groupId,
  });
  if (!active) return;
  if (!res || !res.ok) {
    ui.toast(failureMessage(res, { failed: "Move to group failed" }));
    renderAll();
    return;
  }
  ui.toast(`Moved ${outside.length} tabs to group`);
  consumeMarks();
  await refresh();
}

async function ungroupTargets() {
  const grouped = currentTargets().filter(
    (tab) => tab.groupId !== GROUPED_NONE,
  );
  if (grouped.length === 0) {
    ui.toast("No grouped tabs selected");
    renderAll();
    return;
  }
  await runOnTargets(
    "ungroupManagerTabs",
    () => ({ ids: grouped.map((tab) => tab.id) }),
    {
      failed: "Ungroup failed",
      done: () => ui.toast(`Ungrouped ${grouped.length} tabs`),
    },
  );
}

function startRename() {
  const focused = focusedTab();
  if (!focused) return;
  if (focused.groupId === GROUPED_NONE) {
    ui.toast("Focused tab is not in a group");
    renderAll();
    return;
  }
  openField("group", (groupsById.get(focused.groupId) || {}).title || "", {
    groupId: focused.groupId,
  });
}

function startEditUrl() {
  const focused = focusedTab();
  if (!focused) return;
  openField("url", focused.url || "", { tabId: focused.id });
}

async function commitRename() {
  if (!field || field.kind !== "group") return;
  const { groupId } = field;
  const title = fieldValue().trim();
  closeField();
  const res = await ask("renameGroup", { groupId, title });
  if (!active) return;
  if (!res || !res.ok) {
    ui.toast(failureMessage(res, { failed: "Rename failed" }));
    renderAll();
    return;
  }
  ui.toast("Renamed group");
  await refresh();
}

async function commitEditUrl() {
  if (!field || field.kind !== "url") return;
  const { tabId } = field;
  const value = fieldValue().trim();
  closeField();
  if (!value) return;
  const res = await ask("editManagerTab", { id: tabId, url: value });
  if (!active) return;
  if (!res || !res.ok) {
    ui.toast("Not a valid URL");
    renderAll();
    return;
  }
  ui.toast("URL updated");
  await refresh();
}

function duplicateTargets() {
  return runOnTargets(
    "duplicateManagerTabs",
    (targets) => ({ ids: targets.map((tab) => tab.id) }),
    {
      failed: "Duplicate failed",
      done: (res) => ui.toast(`Duplicated ${res.duplicated}`),
    },
  );
}

function bookmarkPayload(targets) {
  return { tabs: targets.map((tab) => ({ url: tab.url, title: tab.title })) };
}

function saveBookmarks() {
  return runOnTargets(
    "bookmarkManagerTabs",
    bookmarkPayload,
    {
      failed: "Bookmark failed",
      done: (res) =>
        ui.toast(
          res.saved > 0
            ? `Bookmarked ${res.saved}${res.skipped ? ` (${res.skipped} skipped)` : ""}`
            : "Already bookmarked",
        ),
    },
  );
}

function removeBookmarks() {
  return runOnTargets(
    "unbookmarkManagerTabs",
    bookmarkPayload,
    {
      failed: "Unbookmark failed",
      done: (res) => {
        const plural = res.removed === 1 ? "" : "s";
        ui.toast(`Removed ${res.removed} bookmark${plural}`);
      },
    },
  );
}

function bookmarkTargets() {
  return decideSetState(currentTargets(), "bookmarked")
    ? saveBookmarks()
    : removeBookmarks();
}

function focusOverlay() {
  if (!overlay) return;
  ui.safeFocus(overlay, { preventScroll: true });
}

function isOwnChrome(el) {
  try {
    if (!el) return false;
    if (el === host || el === overlay) return true;
    const cls = el.className;
    return typeof cls === "string" && cls.includes(HOST_CLASS);
  } catch {
    return false;
  }
}

function openField(kind, text, meta = {}) {
  if (field) return;
  confirm = null;
  const cfg = FIELDS[kind];
  const input = document.createElement("input");
  input.type = "text";
  input.className = "jari-prompt-input";
  input.placeholder = cfg.placeholder;
  input.value = text || "";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("maxlength", String(cfg.maxLength));
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("input", () => {
    if (!field || field.kind !== "filter") return;
    query = fieldEl.value;
    applyFilter();
    renderAll();
  });
  fieldEl = input;
  field = { kind, ...meta };
  overlay.insertBefore(input, footerEl);
  renderAll();
  const prev = document.activeElement;
  fieldFocusBefore = isOwnChrome(prev) ? null : prev;
  input.focus();
  try {
    input.select();
  } catch {}
}

function closeField() {
  if (!fieldEl) return;
  try {
    fieldEl.remove();
  } catch {}
  fieldEl = null;
  field = null;
  renderAll();
  const prev = fieldFocusBefore;
  fieldFocusBefore = null;
  if (prev && prev.isConnected) {
    if (document.activeElement !== prev) {
      try {
        prev.focus();
      } catch {
        focusOverlay();
      }
    }
    return;
  }
  focusOverlay();
}

function fieldValue() {
  return fieldEl ? fieldEl.value : "";
}

async function submitOpen() {
  const raw = fieldValue().trim();
  closeField();
  if (!raw) return;
  const kw = parseEngineKeyword(raw, settings.getSearchEngines());
  const url = kw
    ? kw.url
    : Url.looksLikeUrl(raw)
      ? normalizeUrl(raw) || raw
      : null;
  if (url) {
    await ask("openInBackgroundTab", { url });
  } else {
    await ask("search", {
      query: Url.suggestionTerm(raw),
      newTab: true,
      incognito: false,
      background: true,
    });
  }
  if (!active) return;
  renderAll();
  await refresh();
}

function moveTargets(delta) {
  return runOnTargets(
    "moveManagerTabs",
    (targets) => ({ ids: targets.map((tab) => tab.id), delta }),
    { failed: "Move failed", done: null },
    { keepMarks: true },
  );
}

function consume(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function isModifier(event) {
  return (
    event.key === "Control" ||
    event.key === "Alt" ||
    event.key === "Shift" ||
    event.key === "Meta"
  );
}

function onFieldKey(event) {
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key === "Escape") {
    consume(event);
    if (field.kind === "filter") {
      query = "";
      applyFilter();
    }
    closeField();
    return true;
  }
  if (event.key === "Enter") {
    consume(event);
    if (field.kind === "open") submitOpen();
    else if (field.kind === "group") commitRename();
    else if (field.kind === "url") commitEditUrl();
    else closeField();
    return true;
  }
  return false;
}

function onNormalKey(event) {
  if (isModifier(event)) return false;
  const hasMod = event.ctrlKey || event.altKey || event.metaKey;
  if (hasMod) return false;
  switch (event.key) {
    case "Escape":
      consume(event);
      if (confirm) {
        confirm = null;
        renderAll();
      } else if (visualAnchor !== null) {
        endVisual();
        renderAll();
      } else if (query) {
        query = "";
        applyFilter();
        renderAll();
      } else if (marked.size > 0) {
        marked = new Set();
        renderAll();
      } else {
        close();
      }
      return true;
    case "/":
      consume(event);
      openField("filter", query);
      return true;
    case "?":
      consume(event);
      showHints = !showHints;
      renderAll();
      return true;
    case "Enter":
      consume(event);
      activateFocused();
      return true;
    case "Tab":
      consume(event);
      move(event.shiftKey ? -1 : 1);
      return true;
    case " ":
      consume(event);
      toggleMark();
      return true;
    case "ArrowDown":
    case "j":
      consume(event);
      if (visualAnchor !== null) moveVisual(1);
      else move(1);
      return true;
    case "ArrowUp":
    case "k":
      consume(event);
      if (visualAnchor !== null) moveVisual(-1);
      else move(-1);
      return true;
    case "v":
      consume(event);
      if (visualAnchor !== null) endVisual();
      else startVisual();
      renderAll();
      return true;
    case "ArrowLeft":
      consume(event);
      moveTargets(-1);
      return true;
    case "ArrowRight":
      consume(event);
      moveTargets(1);
      return true;
    case "J":
      consume(event);
      moveTargets(1);
      return true;
    case "K":
      consume(event);
      moveTargets(-1);
      return true;
    case "V":
      consume(event);
      markAllVisible();
      return true;
    case "d":
      consume(event);
      closeTargets();
      return true;
    case "y":
      consume(event);
      duplicateTargets();
      return true;
    case "e":
      consume(event);
      startEditUrl();
      return true;
    case "p":
      consume(event);
      toggleFlag("pin");
      return true;
    case "m":
      consume(event);
      toggleFlag("mute");
      return true;
    case "g":
      consume(event);
      groupTargets();
      return true;
    case "a":
      consume(event);
      addToFocusedGroup();
      return true;
    case "u":
      consume(event);
      ungroupTargets();
      return true;
    case "r":
      consume(event);
      startRename();
      return true;
    case "b":
      consume(event);
      bookmarkTargets();
      return true;
    case "t":
      consume(event);
      openField("open", "");
      return true;
    default:
      return false;
  }
}

function onKeyDown(event) {
  if (!active) return false;
  if (field) return onFieldKey(event);
  return onNormalKey(event);
}

export function fieldState() {
  return field ? { kind: field.kind, text: fieldValue() } : null;
}

export const TabManager = {
  open,
  close,
  onKeyDown,
  isActive,
};

register("tab-manager", { close, onKeyDown, isActive });

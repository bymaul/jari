export interface TabSummary {
  id?: number;
  windowId?: number;
  title: string;
  url: string;
  active: boolean;
  lastAccessed: number;
  audible: boolean;
}

export interface ManagerTab {
  id?: number;
  windowId?: number;
  index: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  bookmarked: boolean;
  groupId: number;
  lastAccessed: number;
}

export interface GroupSummary {
  id: number;
  title: string;
  color: string;
  collapsed: boolean;
}

export interface WindowSummary {
  windowId?: number;
  title: string;
  url: string;
}

export interface HistoryTreeRow {
  id: number;
  url: string;
  title: string;
  ts: number;
  depth: number;
  seq: number;
  /** Undotree box-drawing prefix, composed by the recorder's linearizer. */
  prefix: string;
}

export interface Suggestion {
  title: string;
  url: string;
  source: "tab" | "history" | "bookmark";
  id?: number;
  lastAccessed?: number;
  audible?: boolean;
  visitCount?: number;
  typedCount?: number;
  typedVisits?: number;
  lastVisit?: number;
  dateAdded?: number;
  folderPath?: string;
}

type Ok = { ok: true };
type Fail = { ok: false; error?: string };

export interface Messages {
  createTab: {
    payload: { url?: string };
    response: { ok: true; id?: number } | Fail;
  };
  openIncognitoTab: {
    payload: { url?: string };
    response: { ok: true; id?: number } | Fail;
  };
  navigate: {
    payload: { url?: string };
    response: Ok | Fail;
  };
  closeTab: {
    payload: { count?: number };
    response: { ok: true; closed: number } | Fail;
  };
  restoreTab: {
    payload: { count?: number };
    response: Ok | Fail;
  };
  previousTab: {
    payload: { count?: number };
    response: Ok | Fail;
  };
  nextTab: {
    payload: { count?: number };
    response: Ok | Fail;
  };
  moveTabToWindow: {
    payload: Record<string, never>;
    response:
      | { ok: true; movedToNewWindow: true }
      | { ok: true; movedToWindow: true }
      | { ok: true; needWindowChoice: false }
      | {
          ok: true;
          needWindowChoice: true;
          ownTabId?: number;
          ownWindowId?: number;
          tabs: WindowSummary[];
        }
      | Fail;
  };
  moveTabIntoWindow: {
    payload: { targetWindowId?: number };
    response: Ok | Fail;
  };
  moveManagerTabsToWindow: {
    payload: { ids?: number[] };
    response:
      | { ok: true; movedToNewWindow: true; moved: number }
      | { ok: true; movedToWindow: true; moved: number }
      | { ok: true; needWindowChoice: false }
      | {
          ok: true;
          needWindowChoice: true;
          ownIds?: number[];
          tabs: WindowSummary[];
        }
      | { ok: false; reason?: "incognito"; error?: string };
  };
  moveManagerTabsIntoWindow: {
    payload: { ids?: number[]; targetWindowId?: number };
    response:
      | { ok: true; moved: number }
      | { ok: false; reason?: "incognito" | "no-target"; error?: string };
  };
  moveTabLeft: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  moveTabRight: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  goToFirstTab: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  goToLastTab: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  reloadTab: {
    payload: { bypassCache?: boolean };
    response: Ok | Fail;
  };
  goBack: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  goForward: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  historyTreeList: {
    payload: Record<string, never>;
    response: { ok: true; rows: HistoryTreeRow[]; currentId: number | null } | Fail;
  };
  historyTreeGo: {
    payload: { nodeId?: number };
    response: { ok: true; delta?: number } | Fail;
  };
  listTabs: {
    payload: Record<string, never>;
    response: TabSummary[] | Fail;
  };
  managerList: {
    payload: Record<string, never>;
    response:
      | {
          ok: true;
          tabs: ManagerTab[];
          groups: GroupSummary[];
          currentWindowId: number | null;
        }
      | Fail;
  };
  closeManagerTabs: {
    payload: { ids?: number[] };
    response: { ok: true; closed: number } | Fail;
  };
  setTabsPinned: {
    payload: { ids?: number[]; pinned?: boolean };
    response: { ok: true; updated: number; pinned: boolean } | Fail;
  };
  setTabsMuted: {
    payload: { ids?: number[]; muted?: boolean };
    response: { ok: true; updated: number; muted: boolean } | Fail;
  };
  moveManagerTabs: {
    payload: { ids?: number[]; delta?: number };
    response: { ok: true; moved: number } | Fail;
  };
  duplicateManagerTabs: {
    payload: { ids?: number[] };
    response: { ok: true; duplicated: number; ids?: number[] } | Fail;
  };
  editManagerTab: {
    payload: { id?: number; url?: unknown };
    response: { ok: true; url: string } | Fail;
  };
  groupManagerTabs: {
    payload: { ids?: number[]; groupId?: number };
    response: { ok: true; groupId?: number } | { ok: false; reason?: "unsupported"; error?: string };
  };
  ungroupManagerTabs: {
    payload: { ids?: number[] };
    response: { ok: true; ungrouped: number } | { ok: false; reason?: "unsupported"; error?: string };
  };
  renameGroup: {
    payload: { groupId?: number; title?: unknown };
    response: Ok | { ok: false; reason?: "unsupported"; error?: string };
  };
  bookmarkManagerTabs: {
    payload: { tabs?: { url?: string; title: string }[] };
    response:
      | { ok: true; saved: number; skipped: number }
      | { ok: false; saved?: number; skipped?: number; error?: string };
  };
  unbookmarkManagerTabs: {
    payload: { tabs?: { url?: string; title: string }[] };
    response:
      | { ok: true; removed: number; skipped: number }
      | { ok: false; removed?: number; skipped?: number; error?: string };
  };
  suggest: {
    payload: { query?: string };
    response: Suggestion[] | Fail;
  };
  search: {
    payload: { query?: string; newTab?: boolean; incognito?: boolean; background?: boolean };
    response: { ok: true; id?: number } | Fail;
  };
  activateTab: {
    payload: { id?: number };
    response: Ok | Fail;
  };
  zoomBy: {
    payload: { delta?: number };
    response: { ok: true; zoom: number } | Fail;
  };
  openInBackgroundTab: {
    payload: { url?: string };
    response: Ok | Fail;
  };
  openInForegroundTab: {
    payload: { url?: string };
    response: Ok | Fail;
  };
  captureScreenshot: {
    payload: Record<string, never>;
    response: { ok: true; dataUrl: string } | Fail;
  };
  openSettings: {
    payload: Record<string, never>;
    response: Ok | Fail;
  };
  openExtensions: {
    payload: Record<string, never>;
    response: Ok | { ok: false; reason?: "blocked"; error?: string };
  };
}

export type ShowHelpMessage = { action: "jari-show-help" };

export type Action = keyof Messages;
export type MessagePayload<A extends Action = Action> = Messages[A]["payload"];
export type MessageResponse<A extends Action = Action> = Messages[A]["response"];

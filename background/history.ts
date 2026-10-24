import { normalizeUrl } from "../shared/url.ts";
import type {
  HistoryTreeRow,
  MessagePayload,
  MessageResponse,
} from "../shared/protocol.ts";

type Sender = chrome.runtime.MessageSender;

export interface HistoryNode {
  id: number;
  url: string;
  title: string;
  ts: number;
  parent: number | null;
  children: number[];
}

export interface TabTree {
  nodes: Map<number, HistoryNode>;
  current: number | null;
  spine: number[];
  spineAt: number;
}

export interface PendingGoto {
  nodeId: number;
  url: string;
  until: number;
}

export interface TreeStore {
  seq: number;
  tabs: Map<number, TabTree>;
  pending: Map<number, PendingGoto>;
}

export interface CommitEvent {
  tabId: number;
  url: string;
  title?: string | null;
  isReload?: boolean;
  isHistoryTraversal?: boolean;
}

const SNAPSHOT_VERSION = 2;
const SAVE_DEBOUNCE_MS = 200;
const PENDING_MS = 5000;
const NODE_CAP = 400;
const SPINE_CAP = 60;
const TITLE_CAP = 200;
const DB_NAME = "jari-history";
const DB_STORE = "tree";
const DB_KEY = "main";

export function emptyStore(): TreeStore {
  return { seq: 0, tabs: new Map(), pending: new Map() };
}

export function ensureTab(store: TreeStore, tabId: number): TabTree {
  let tree = store.tabs.get(tabId);
  if (!tree) {
    tree = { nodes: new Map(), current: null, spine: [], spineAt: -1 };
    store.tabs.set(tabId, tree);
  }
  return tree;
}

function capTitle(title: unknown): string {
  return String(title ?? "").slice(0, TITLE_CAP);
}

function hashKey(url: string): string {
  const idx = url.indexOf("#");
  return idx === -1 ? url : url.slice(0, idx);
}

function findNodeByUrl(tree: TabTree, url: string): HistoryNode | null {
  for (const node of tree.nodes.values()) {
    if (node.url === url) return node;
  }
  const key = hashKey(url);
  for (const node of tree.nodes.values()) {
    if (node.url !== url && hashKey(node.url) === key) return node;
  }
  return null;
}

function reachableUrlNode(
  tree: TabTree,
  startId: number,
  url: string,
): HistoryNode | null {
  const key = hashKey(url);
  let exact: { node: HistoryNode; dist: number } | null = null;
  let hash: { node: HistoryNode; dist: number } | null = null;
  const seen = new Set<number>([startId]);
  const queue: Array<{ id: number; dist: number }> = [{ id: startId, dist: 0 }];
  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;
    const node = tree.nodes.get(id);
    if (!node) continue;
    if (id !== startId) {
      if (node.url === url) {
        if (!exact || dist < exact.dist) exact = { node, dist };
      } else if (key && hashKey(node.url) === key) {
        if (!hash || dist < hash.dist) hash = { node, dist };
      }
    }
    if (node.parent !== null && !seen.has(node.parent)) {
      seen.add(node.parent);
      queue.push({ id: node.parent, dist: dist + 1 });
    }
    for (const child of node.children) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push({ id: child, dist: dist + 1 });
      }
    }
  }
  if (exact) return exact.node;
  return hash ? hash.node : null;
}

function movePointer(
  tree: TabTree,
  nodeId: number,
  now: number,
  title?: string | null,
): boolean {
  const node = tree.nodes.get(nodeId);
  if (!node) return false;
  tree.current = node.id;
  node.ts = now;
  if (title) node.title = capTitle(title);
  return true;
}

function spinePush(tree: TabTree, nodeId: number): void {
  if (tree.spineAt >= 0 && tree.spineAt < tree.spine.length - 1) {
    tree.spine = tree.spine.slice(0, tree.spineAt + 1);
  }
  tree.spine.push(nodeId);
  if (tree.spine.length > SPINE_CAP) {
    tree.spine.splice(0, tree.spine.length - SPINE_CAP);
  }
  tree.spineAt = tree.spine.length - 1;
}

function spineReanchor(tree: TabTree, url: string, exactId?: number): void {
  if (exactId !== undefined) {
    const idx = tree.spine.indexOf(exactId);
    if (idx >= 0) {
      tree.spineAt = idx;
      return;
    }
  }
  let best = -1;
  let bestDist = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < tree.spine.length; i++) {
    const node = tree.nodes.get(tree.spine[i]);
    if (!node || node.url !== url) continue;
    const dist = Math.abs(i - tree.spineAt);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best >= 0) tree.spineAt = best;
}

function recordVisit(
  store: TreeStore,
  tree: TabTree,
  url: string,
  ev: CommitEvent,
  now: number,
): boolean {
  const parentId = tree.current;
  const parentNode = parentId === null ? null : tree.nodes.get(parentId);
  const node: HistoryNode = {
    id: ++store.seq,
    url,
    title: capTitle(ev.title),
    ts: now,
    parent: parentNode ? parentId : null,
    children: [],
  };
  if (parentNode) parentNode.children.push(node.id);
  tree.nodes.set(node.id, node);
  tree.current = node.id;
  pruneTab(tree, NODE_CAP);
  return true;
}

export function applyCommit(
  store: TreeStore,
  ev: CommitEvent,
  now: number,
): boolean {
  const url = normalizeUrl(ev.url);
  if (!url || !Number.isInteger(ev.tabId)) return false;
  const tree = ensureTab(store, ev.tabId);
  const traversal = !!ev.isHistoryTraversal || !!ev.isReload;

  const pending = store.pending.get(ev.tabId);
  if (pending) {
    store.pending.delete(ev.tabId);
    if (now <= pending.until) {
      const target =
        url === pending.url
          ? (tree.nodes.get(pending.nodeId) ?? null)
          : reachableUrlNode(tree, pending.nodeId, url);
      if (target && movePointer(tree, target.id, now, ev.title)) {
        if (traversal && target.id === pending.nodeId) {
          spineReanchor(tree, url, target.id);
        } else {
          spinePush(tree, target.id);
        }
        return true;
      }
    }
  }

  const currentId = tree.current;
  const current = currentId === null ? null : tree.nodes.get(currentId);
  if (current && current.url === url) {
    if (ev.title) current.title = capTitle(ev.title);
    current.ts = now;
    return true;
  }
  if (traversal && current) {
    const near = reachableUrlNode(tree, current.id, url);
    if (near) {
      movePointer(tree, near.id, now, ev.title);
      spineReanchor(tree, url);
      return true;
    }
    recordVisit(store, tree, url, ev, now);
    return true;
  }
  recordVisit(store, tree, url, ev, now);
  spinePush(tree, tree.current!);
  return true;
}

export function touchTitle(
  store: TreeStore,
  tabId: number,
  url: string,
  title: string,
): boolean {
  const tree = store.tabs.get(tabId);
  if (!tree) return false;
  const node = findNodeByUrl(tree, url);
  if (!node) return false;
  const text = capTitle(title);
  if (!text || node.title === text) return false;
  node.title = text;
  return true;
}

export function markGoto(
  store: TreeStore,
  tabId: number,
  nodeId: number,
  now: number,
): string | null {
  const tree = store.tabs.get(tabId);
  const node = tree ? tree.nodes.get(nodeId) : undefined;
  if (!node) return null;
  store.pending.set(tabId, { nodeId, url: node.url, until: now + PENDING_MS });
  return node.url;
}

export type GotoPlan =
  | { kind: "point"; node: HistoryNode }
  | { kind: "native"; node: HistoryNode; delta: number }
  | { kind: "load"; node: HistoryNode; url: string };

export function gotoPlan(
  store: TreeStore,
  tabId: number,
  nodeId: number,
  historyLength?: number,
): GotoPlan | null {
  const tree = store.tabs.get(tabId);
  const node = tree ? tree.nodes.get(nodeId) : undefined;
  if (!tree || !node) return null;
  const cursor = tree.current === null ? null : tree.nodes.get(tree.current);
  if (cursor && cursor.url === node.url) return { kind: "point", node };
  const idx = tree.spine.indexOf(node.id);
  if (idx < 0 || tree.spineAt < 0) return { kind: "load", node, url: node.url };
  const delta = idx - tree.spineAt;
  if (delta === 0) return { kind: "point", node };
  if (
    typeof historyLength === "number" &&
    historyLength >= 1 &&
    Math.abs(delta) >= historyLength
  ) {
    return { kind: "load", node, url: node.url };
  }
  return { kind: "native", node, delta };
}

export function linearizeTab(tree: TabTree): {
  rows: HistoryTreeRow[];
  currentId: number | null;
} {
  const rows: HistoryTreeRow[] = [];
  let seq = 0;
  const visit = (
    node: HistoryNode,
    depth: number,
    marks: string[],
    isLast: boolean,
  ): void => {
    const glyph = depth === 0 ? "" : `${isLast ? "└─" : "├─"} `;
    rows.push({
      id: node.id,
      url: node.url,
      title: node.title,
      ts: node.ts,
      depth,
      seq: ++seq,
      prefix: marks.join("") + glyph,
    });
    const childMarks = depth === 0 ? marks : [...marks, isLast ? "   " : "│  "];
    for (let i = 0; i < node.children.length; i++) {
      const child = tree.nodes.get(node.children[i]);
      if (!child) continue;
      visit(child, depth + 1, childMarks, i === node.children.length - 1);
    }
  };
  for (const node of tree.nodes.values()) {
    if (node.parent !== null) continue;
    visit(node, 0, [], true);
  }
  return { rows, currentId: tree.current };
}

export function pruneTab(tree: TabTree, cap: number): void {
  if (!Number.isInteger(cap) || cap <= 0) return;
  const path = new Set<number>();
  let cur = tree.current;
  while (cur !== null) {
    path.add(cur);
    cur = tree.nodes.get(cur)?.parent ?? null;
  }
  while (tree.nodes.size > cap) {
    let leaf: HistoryNode | null = null;
    for (const node of tree.nodes.values()) {
      if (path.has(node.id) || node.children.length > 0) continue;
      if (!leaf || node.ts < leaf.ts) leaf = node;
    }
    if (leaf) {
      const leafId = leaf.id;
      if (leaf.parent !== null) {
        const parent = tree.nodes.get(leaf.parent);
        if (parent) {
          parent.children = parent.children.filter((id) => id !== leafId);
        }
      }
      tree.nodes.delete(leaf.id);
      continue;
    }
    let root: HistoryNode | null = null;
    for (const node of tree.nodes.values()) {
      if (node.parent !== null || path.has(node.id)) continue;
      if (!root || node.ts < root.ts) root = node;
    }
    if (!root) break;
    dropSubtree(tree, root);
  }
  tree.spine = tree.spine.filter((id) => tree.nodes.has(id));
  if (tree.spine.length === 0) {
    tree.spineAt = -1;
    return;
  }
  const at = tree.current !== null ? tree.spine.indexOf(tree.current) : -1;
  tree.spineAt =
    at >= 0 ? at : Math.min(Math.max(tree.spineAt, 0), tree.spine.length - 1);
}

function dropSubtree(tree: TabTree, root: HistoryNode): void {
  const stack = [root.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = tree.nodes.get(id);
    if (!node) continue;
    for (const child of node.children) stack.push(child);
    tree.nodes.delete(id);
  }
}

export function serializeStore(store: TreeStore): unknown {
  return {
    v: SNAPSHOT_VERSION,
    seq: store.seq,
    tabs: [...store.tabs.entries()].map(([tabId, tree]) => [
      tabId,
      {
        current: tree.current,
        nodes: [...tree.nodes.values()],
        spine: tree.spine,
        spineAt: tree.spineAt,
      },
    ]),
    pending: [...store.pending.entries()],
  };
}

export function deserializeStore(raw: unknown): TreeStore | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as {
    v?: unknown;
    seq?: unknown;
    tabs?: unknown;
    pending?: unknown;
  };
  if (bag.v !== SNAPSHOT_VERSION) return null;
  const seq = Number(bag.seq);
  if (!Number.isInteger(seq) || seq < 0) return null;
  const store: TreeStore = { seq, tabs: new Map(), pending: new Map() };
  for (const entry of Array.isArray(bag.tabs) ? bag.tabs : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [tabId, treeRaw] = entry;
    if (!Number.isInteger(tabId)) continue;
    const tree = restoreTree(treeRaw);
    if (tree) store.tabs.set(tabId as number, tree);
  }

  for (const entry of Array.isArray(bag.pending) ? bag.pending : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [tabId, goRaw] = entry;
    if (!Number.isInteger(tabId) || !goRaw) continue;
    const go = goRaw as { nodeId?: unknown; url?: unknown; until?: unknown };
    if (
      !Number.isInteger(go.nodeId) ||
      typeof go.url !== "string" ||
      !Number.isInteger(go.until)
    ) {
      continue;
    }
    store.pending.set(tabId as number, go as unknown as PendingGoto);
  }
  return store;
}

function restoreTree(raw: unknown): TabTree | null {
  if (raw === null || typeof raw !== "object") return null;
  const bag = raw as {
    current?: unknown;
    nodes?: unknown;
    spine?: unknown;
    spineAt?: unknown;
  };
  const nodes = new Map<number, HistoryNode>();
  if (Array.isArray(bag.nodes)) {
    for (const item of bag.nodes) {
      if (!item || typeof item !== "object") continue;
      const node = item as {
        id?: unknown;
        url?: unknown;
        title?: unknown;
        ts?: unknown;
        parent?: unknown;
      };
      if (!Number.isInteger(node.id) || typeof node.url !== "string") continue;
      nodes.set(node.id as number, {
        id: node.id as number,
        url: node.url,
        title: node.title == null ? "" : String(node.title),
        ts: Number.isFinite(Number(node.ts)) ? Number(node.ts) : 0,
        parent: Number.isInteger(node.parent) ? (node.parent as number) : null,
        children: [],
      });
    }
    for (const node of nodes.values()) {
      if (node.parent === null) continue;
      const parent = nodes.get(node.parent);
      if (parent) parent.children.push(node.id);
      else node.parent = null;
    }
  }
  const current = bag.current;
  const spine = (Array.isArray(bag.spine) ? bag.spine : []).filter(
    (id) => Number.isInteger(id) && nodes.has(id as number),
  ) as number[];
  const spineAt = Number.isInteger(bag.spineAt) ? (bag.spineAt as number) : -1;
  const tree: TabTree = {
    nodes,
    current:
      Number.isInteger(current) && nodes.has(current as number)
        ? (current as number)
        : null,
    spine,
    spineAt:
      spine.length === 0
        ? -1
        : Math.min(Math.max(spineAt, 0), spine.length - 1),
  };
  return tree;
}

let store: TreeStore | null = null;
let loading: Promise<TreeStore> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let diskAnswered = false;

interface IdbRequestApi {
  result?: unknown;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onupgradeneeded: ((ev: unknown) => void) | null;
}
interface IdbObjectStoreApi {
  get: (key: string) => IdbRequestApi;
  put: (value: unknown, key: string) => IdbRequestApi;
  clear: () => IdbRequestApi;
}
interface IdbTransactionApi {
  objectStore: (name: string) => IdbObjectStoreApi;
  oncomplete: (() => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
}
interface IdbConnectionApi {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => unknown;
  transaction: (
    name: string,
    mode: "readonly" | "readwrite",
  ) => IdbTransactionApi;
}
interface IdbFactoryApi {
  open: (name: string, version?: number) => IdbRequestApi;
  deleteDatabase?: (name: string) => IdbRequestApi;
}

function idbFactory(): IdbFactoryApi | null {
  try {
    const holder = globalThis as unknown as { indexedDB?: IdbFactoryApi };
    if (holder.indexedDB && typeof holder.indexedDB.open === "function") {
      return holder.indexedDB;
    }
  } catch {}
  return null;
}

function idbOpen(): Promise<IdbConnectionApi | null> {
  const factory = idbFactory();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = (ev) => {
        const target = (ev as { target?: { result?: IdbConnectionApi } })
          .target;
        if (
          target &&
          target.result &&
          !target.result.objectStoreNames.contains(DB_STORE)
        ) {
          target.result.createObjectStore(DB_STORE);
        }
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => resolve((req.result as IdbConnectionApi) ?? null);
    } catch (err) {
      console.debug("[jari] history database open failed:", err);
      resolve(null);
    }
  });
}

async function idbRead(): Promise<TreeStore | null> {
  const conn = await idbOpen();
  if (!conn || !conn.objectStoreNames.contains(DB_STORE)) return null;
  return new Promise((resolve) => {
    try {
      const req = conn
        .transaction(DB_STORE, "readonly")
        .objectStore(DB_STORE)
        .get(DB_KEY);
      req.onsuccess = () => {
        diskAnswered = true;
        resolve(deserializeStore(req.result));
      };
      req.onerror = () => resolve(null);
    } catch (err) {
      console.debug("[jari] history database read failed:", err);
      resolve(null);
    }
  });
}

async function idbWrite(value: unknown): Promise<void> {
  const conn = await idbOpen();
  if (!conn || !conn.objectStoreNames.contains(DB_STORE)) return;
  try {
    const tx = conn.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, DB_KEY);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (err) {
    console.debug("[jari] history database save failed:", err);
  }
}

function idbClear(): void {
  void idbOpen().then((conn) => {
    if (!conn || !conn.objectStoreNames.contains(DB_STORE)) return;
    try {
      conn.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).clear();
    } catch (err) {
      console.debug("[jari] history database clear failed:", err);
    }
  });
}

async function ensureStore(): Promise<TreeStore> {
  if (store) return store;
  if (!loading) {
    loading = (async () => {
      store = (await idbRead()) ?? emptyStore();
      return store;
    })();
  }
  return loading;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, SAVE_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  const current = await ensureStore();
  if (current.tabs.size === 0 && !diskAnswered) return;
  await idbWrite(serializeStore(current));
}

export function unloadStoreForTest(): void {
  store = null;
  loading = null;
  diskAnswered = false;
}

export async function flushSavesForTest(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persistNow();
}

function senderTab(sender: Sender): number | null {
  const id = sender?.tab?.id;
  return Number.isInteger(id) ? (id as number) : null;
}

export async function historyTreeList(
  sender: Sender,
): Promise<MessageResponse<"historyTreeList">> {
  const tabId = senderTab(sender);
  if (tabId === null) return { ok: false };
  const current = await ensureStore();
  const tree = current.tabs.get(tabId);
  if (!tree) return { ok: true, rows: [], currentId: null };
  const { rows, currentId } = linearizeTab(tree);
  return { ok: true, rows, currentId };
}

export async function historyTreeGo(
  sender: Sender,
  { nodeId, historyLength }: MessagePayload<"historyTreeGo"> = {},
): Promise<MessageResponse<"historyTreeGo">> {
  const tabId = senderTab(sender);
  if (tabId === null) return { ok: false };
  const current = await ensureStore();
  if (!Number.isInteger(nodeId)) return { ok: false };
  const length =
    Number.isInteger(historyLength) && (historyLength as number) >= 1
      ? (historyLength as number)
      : undefined;
  const plan = gotoPlan(current, tabId, nodeId as number, length);
  if (!plan) return { ok: false };
  const now = Date.now();
  if (plan.kind === "point") {
    plan.node.ts = now;
    current.tabs.get(tabId)!.current = plan.node.id;
    scheduleSave();
    return { ok: true, delta: 0 };
  }
  if (plan.kind === "native") {
    markGoto(current, tabId, plan.node.id, now);
    return { ok: true, delta: plan.delta };
  }
  markGoto(current, tabId, plan.node.id, now);
  try {
    await chrome.tabs.update(tabId, { url: plan.url });
    return { ok: true };
  } catch (err) {
    current.pending.delete(tabId);
    console.debug("[jari] historyTreeGo failed:", err);
    return { ok: false };
  }
}

interface CommitDetails {
  frameId?: number;
  tabId?: number;
  url?: string;
  transitionType?: string;
  transitionQualifiers?: string[];
}

interface UpdateInfo {
  url?: string;
  title?: string;
}

export function initHistoryRecorder(): void {
  const bag = chrome as unknown as {
    runtime?: {
      onStartup?: { addListener: (fn: () => void) => void };
    };
    webNavigation?: {
      onCommitted?: {
        addListener: (fn: (details: CommitDetails) => void) => void;
      };
      onHistoryStateUpdated?: {
        addListener: (fn: (details: CommitDetails) => void) => void;
      };
    };
    tabs?: {
      onRemoved?: { addListener: (fn: (tabId: number) => void) => void };
      onUpdated?: {
        addListener: (
          fn: (tabId: number, info: UpdateInfo, tab: { url?: string }) => void,
        ) => void;
      };
    };
  };
  const onCommit =
    (isHistoryTraversal: boolean) =>
    (details: CommitDetails): void => {
      if (!details || (details.frameId ?? 0) !== 0) return;
      if (!Number.isInteger(details.tabId)) return;
      ensureStore()
        .then((current) => {
          const qualifiers = details.transitionQualifiers || [];
          const changed = applyCommit(
            current,
            {
              tabId: details.tabId as number,
              url: String(details.url || ""),
              isReload: details.transitionType === "reload",
              isHistoryTraversal:
                isHistoryTraversal || qualifiers.includes("forward_back"),
            },
            Date.now(),
          );
          if (changed) scheduleSave();
        })
        .catch((err: unknown) =>
          console.debug("[jari] history recorder failed:", err),
        );
    };
  if (bag.runtime?.onStartup) {
    bag.runtime.onStartup.addListener(() => idbClear());
  }
  if (bag.webNavigation?.onCommitted) {
    bag.webNavigation.onCommitted.addListener(onCommit(false));
  }
  if (bag.webNavigation?.onHistoryStateUpdated) {
    bag.webNavigation.onHistoryStateUpdated.addListener(onCommit(false));
  }
  if (bag.tabs?.onRemoved) {
    bag.tabs.onRemoved.addListener((tabId) => {
      void ensureStore()
        .then((current) => {
          if (!current.tabs.has(tabId) && !current.pending.has(tabId)) return;
          current.tabs.delete(tabId);
          current.pending.delete(tabId);
          scheduleSave();
        })
        .catch(() => {});
    });
  }
  if (bag.tabs?.onUpdated) {
    bag.tabs.onUpdated.addListener((tabId, info, tab) => {
      if (!info || typeof info.title !== "string" || !info.title) return;
      ensureStore()
        .then((current) => {
          const url = String(info.url || tab.url || "");
          if (touchTitle(current, tabId, url, info.title as string))
            scheduleSave();
        })
        .catch(() => {});
    });
  }
}

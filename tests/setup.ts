// Shared node:test stubs. Importing this module installs globalThis behavior
// fakes; suites monkeypatch their own chrome.* namespaces per test. Keeps
// casts to the declared global types so real DOM/Chrome lib types remain
// intact for other modules.
globalThis.window = {
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  innerHeight: 800,
  scrollX: 0,
  scrollY: 0,
} as unknown as typeof window;

globalThis.document = {
  addEventListener: () => {},
  fullscreenElement: null,
  activeElement: null,
  body: { appendChild: () => {} },
  documentElement: { style: {}, appendChild: () => {} },
  createElement: () => ({
    appendChild: () => {},
    remove: () => {},
    setAttribute: () => {},
  }),
  querySelector: () => null,
  execCommand: () => {},
} as unknown as typeof document;

globalThis.location = {
  hostname: "test.example",
  href: "https://current.example/page",
} as unknown as typeof location;

const messageListeners: unknown[] = [];
const storageListeners: unknown[] = [];

globalThis.chrome = {
  runtime: {
    onMessage: {
      _listeners: messageListeners,
      addListener: (fn: unknown) => {
        messageListeners.push(fn);
      },
    },
    sendMessage: () => {},
    lastError: null,
  },
  tabs: {
    onRemoved: { addListener: () => {} },
  },
  storage: {
    onChanged: {
      _listeners: storageListeners,
      addListener: (fn: unknown) => {
        storageListeners.push(fn);
      },
    },
    sync: {
      get: async () => ({}),
      set: async () => {},
    },
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
} as unknown as typeof chrome;

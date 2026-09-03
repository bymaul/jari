globalThis.window = {
  addEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  innerHeight: 800,
  scrollX: 0,
  scrollY: 0,
};
globalThis.document = {
  addEventListener: () => {},
  fullscreenElement: null,
  activeElement: null,
  body: { appendChild: () => {} },
  documentElement: { style: {}, appendChild: () => {} },
  createElement: () => ({ appendChild: () => {}, remove: () => {}, setAttribute: () => {} }),
  querySelector: () => null,
  execCommand: () => {},
};
globalThis.location = { hostname: "test.example" };
globalThis.chrome = {
  runtime: {
    onMessage: {
      _listeners: [],
      addListener(fn) {
        this._listeners.push(fn);
      },
    },
    sendMessage() {},
    lastError: null,
  },
  tabs: {
    onRemoved: { addListener() {} },
  },
  storage: {
    onChanged: { addListener() {} },
    sync: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};

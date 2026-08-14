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

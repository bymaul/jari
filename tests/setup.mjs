globalThis.chrome = {
  runtime: {
    onMessage: { addListener() {} },
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

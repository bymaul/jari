// Test setup: browser globals that content modules reference at import time.
// Imported before any ../content/*.js module so settings.js can register its
// storage listener on import. Call-time globals (document, location,
// navigator) are provided by the individual tests where needed.
globalThis.chrome = {
  runtime: {
    onMessage: { addListener() {} },
    sendMessage() {},
    lastError: null,
  },
  storage: {
    onChanged: { addListener() {} },
    sync: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};

// ESLint flat config for Jari.
// Content scripts, options page and the service worker all run as plain
// scripts (IIFEs) in either Chrome or Firefox, so `chrome` is the only
// extension-specific global.
import js from "@eslint/js";

export default [
  {
    ignores: ["**/node_modules/**", "dist/**"],
  },
  js.configs.recommended,
  {
    // build.js is a plain Node script, not a browser content script.
    files: ["build.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        console: "readonly",
        chrome: "readonly",
        Node: "readonly",
        NodeFilter: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        matchMedia: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Promise: "readonly",
      },
    },
    rules: {
      // Clipboard/textarea fallbacks intentionally swallow errors.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];

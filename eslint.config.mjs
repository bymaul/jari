// ESLint flat config for Jari.
// package.json sets "type": "module", so content scripts, options page,
// build script, tests and benchmarks are all ESM by default. The background
// service worker (background.js) is still a classic script and `chrome` is
// the only extension-specific global.
import js from "@eslint/js";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      // Generated bundles, rebuilt by npm run build:chrome.
      "content/bundle.js",
      "options/options.bundle.js",
      "background.js",
    ],
  },
  js.configs.recommended,
  {
    // build.js is a plain Node script, not a browser content script.
    files: ["build.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    // The node:test suites run under Node, not in a browser.
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
      },
    },
  },
  {
    // The benchmark scripts run under Node.
    files: ["benchmarks/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: "readonly",
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
        console: "readonly",
        chrome: "readonly",
        Node: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        URL: "readonly",
        Promise: "readonly",
        PointerEvent: "readonly",
        MouseEvent: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      // Clipboard/textarea fallbacks intentionally swallow errors.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];

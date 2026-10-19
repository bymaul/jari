// ESLint flat config for Jari.
// package.json sets "type": "module", so content scripts, options page,
// build script, benchmarks, tests and the docs demo are all ESM by default.
// The background service worker (background.js) is still a classic script and
// `chrome` is the only extension-specific global.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      // Generated bundles, rebuilt by npm run build:chrome.
      "content/bundle.js",
      "options/options.bundle.js",
      "popup/popup.bundle.js",
      "background.js",
    ],
  },
  js.configs.recommended,
  {
    // TypeScript modules (the JS->TS migration is done for source files;
    // the remaining .js are the stub-heavy test suites and the docs demo —
    // see the plain-JS override below).
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      // Clipboard/capture/screenshot fallbacks intentionally swallow errors.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // build.ts is a plain Node script, not a browser content script.
    files: ["build.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
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
    // Plain-JS files that live outside the TS migration: the node:test stub
    // suites (kept per TYPESCRIPT_MIGRATION.md's fixture-heavy policy) and
    // the docs/ demo script. They reference browser globals directly.
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
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        URL: "readonly",
        Promise: "readonly",
        PointerEvent: "readonly",
        MouseEvent: "readonly",
        MutationObserver: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      // Clipboard/textarea fallbacks intentionally swallow errors.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);

# TypeScript Migration Plan

Status: proposed (2026-10). Incremental JS -> TS rewrite with a DX layer.

## Codebase facts that shape the plan

- ~16k lines of real source (the ~34k total includes ~15k generated bundles and ~3k tests).
- Four esbuild IIFE entries: `content`, `options`, `popup`, `background/main` -> `background.js`.
- Bundles are **committed to the repo** and CI-verified via `git diff --exit-code` on
  `content/bundle.js`, `background.js`, `options/options.bundle.js`, `manifest.json`.
- All messaging is untyped: `sendMessage({action, ...})`. 40 background actions
  (dispatched via the `handlers` table in `background/handlers.js`) + 1 popup->content
  action (`jari-show-help`). Zero JSDoc typedefs anywhere.
- The settings shape is enumerated **6 times**: `content/keymap.js` (schema v12,
  `settingsDefaults`, `normalizeSettings`), `content/settings.js` (`state`,
  `merge`, `snapshot`, getters), `background/utils.js` `getStoredSettings`, plus
  popup/options readers. Background trusts the raw stored shape (LWW by
  `updatedAt`, no normalize).
- Chrome API usage is promise-style (94 awaits) with a few `lastError` callback
  fallbacks in `content/ui.js`. Namespaces: tabs (heaviest), windows, tabGroups
  (feature-detected, Chrome-only), bookmarks, history, sessions, storage,
  runtime. No ports anywhere.
- Node 24.22; tests are `node --test` with a shared stub in `tests/setup.mjs`
  (tests monkeypatch the global `chrome` object per suite, swapping/deleting whole
  namespaces).

## Key decisions

1. **Incremental migration, not big-bang.** JS and TS coexist; migrate
   file-by-file, rebuilt bundles committed per PR. A big-bang pass over 16k lines
   is an unreviewable diff and kills git bisect; the CI bundle-diff gate forces
   buildable state anyway.
2. **Erasable-syntax-only TS, no tsx/ts-node.** Node 24 strips types natively, so
   `node --test` keeps working with zero new test-runner dependencies if we avoid
   enums/namespaces/parameter properties. Enforced by `"erasableSyntaxOnly": true`
   so tsc errors mirror what Node accepts.
3. **Explicit `.ts` import specifiers** (`import { x } from "./settings.ts"`),
   matching the current explicit-`.js` style. Only style that works identically
   under Node's type stripper, esbuild, and tsc
   (`allowImportingTsExtensions: true` + `noEmit`).
4. **`@types/chrome` for API types.** The code uses the `chrome` namespace
   heavily and recent @types/chrome has Promise overloads. Beats
   @types/webextension-polyfill's `browser.*`, which would force a namespace
   migration we don't need.
5. **`tsc --noEmit` as the type gate; esbuild never checks types.** Editor hover
   and safe refactors fall out once the settings/protocol types land.

## Phases

### Phase 0 — tooling (1 PR, no source changes)

- devDeps: `typescript`, `@types/chrome`, `@types/node`, `typescript-eslint`.
- `tsconfig.json`: `strict`, `noEmit`, `verbatimModuleSyntax` (forces
  `import type` — Node's stripper requires it), `erasableSyntaxOnly`,
  `allowImportingTsExtensions`, `module: preserve`, `lib: ["ES2022", "DOM"]`.
- Scripts: `"check": "tsc --noEmit"`, `"dev"` (watch, see Phase 3). CI runs
  `npm run check` before lint.
- `eslint.config.mjs`: ts flat-config block with `typescript-eslint` recommended,
  non-type-aware (tsc already checks types; keep lint fast). The hand-maintained
  browser globals list collapses to DOM lib for TS files, stays for remaining JS.
- First PR goal (end-to-end validation of the whole loop): Phase 0 + migrate
  `shared/url.js` and `tests/url.test.js` — best-covered file, exercises tsconfig,
  eslint, node --test with stripped types, esbuild bundling, and the CI gate.

### Phase 1 — protocol + settings types (the two islands that pay for everything)

1. **`shared/protocol.ts`**: discriminated union of all 41 message types with a
   `Messages` map (`{ [A in Action]: { payload: P; response: R } }`).
   - `ui.sendMessage` -> `send<A>(action, Messages[A]["payload"]): Promise<Messages[A]["response"]>`.
   - `background/main.js` handlers table -> exhaustive router with a `never`
     check; adding an action without a handler is a compile error.
   - `openClipboardWith(action)` and the other computed-action sites need
     parameterized variants.
   - Expect to surface real handler/response inconsistencies (the point), which
     touches response handling at a few call sites.
2. **Settings as one interface**: derive `Settings` from the schema in
   `content/keymap.js`, then make the 6 duplicated enumerations consume the type
   + defaults object. Behavior-preserving; do it with tests green before the
   rename wave.
3. `tests/setup.mjs` -> `tests/setup.ts` early, with a typed chrome stub. Keep
   stub typing deliberately loose (namespace-swap tests are behavior fakes).

### Phase 2 — domain-by-domain renames (`.js` -> `.ts`)

One small PR each (1–3 files); `check + lint + test + build:chrome` green, built
bundles committed every time. Recommended order:

1. `content/keymap`, `content/settings`, `content/rank`, `shared/*` (pure logic, best-tested)
2. `background/*` (`tabs.js` is the biggest — 747 lines of Chrome APIs, plus
   `tabGroups` feature-detection typing)
3. content DOM layer: `ui`, `hint-layer`, `highlight`, `hints-elements`, `hints`,
   `find/*`, `scroll`, `clue`
4. Heavy UI state machines: `visual/*`, `prompt/*`, `palette`, `help`, `shot`,
   `scrollshot`, `screenshot`, `tab-manager`, `commands`, `content`
5. `options/*`, `popup/*`; `popup/site.js` last (shared popup+content module —
   verify bundle boundaries)
6. `build.js` -> `build.ts` (runs under Node directly, no bundling needed)

### Phase 3 — DX beyond types

- **`npm run dev`**: esbuild `context()` watch across all four entries +
  manifest regeneration, `sourcemap: true` in watch mode only (release builds
  stay byte-stable, unminified, map-free). Kills the edit-rebuild-reload loop,
  today's worst gap.
- Optional: `npm run dev:firefox` via web-ext (already a devDep) for auto-reload.
- Move the CI distFiles guard (docs/ demo not packaged) into `build.ts` as a real
  check — the CI step greps `build.js` source text and breaks on rename.
- Type the manifest object in build (JSON stays the committed source of truth;
  just a `Manifest` interface + `satisfies`).
- Progressively convert `tests/*.test.js` -> `.ts`. Verify `node --test`
  auto-discovers `.test.ts`; if not, point the script at
  `node --test "tests/*.test.ts"` explicitly.

### Phase 4 — cleanup

- Remove JS leftovers; drop the browser-globals eslint block.
- Update `AGENTS.md` (commands, layout, "tests import .ts" convention,
  erasable-syntax rule) and the README build/dev section if needed.

## Gotchas

- **`import type` everywhere**: Node's stripper doesn't analyze imports;
  type-only cross-imports must be syntactic type imports
  (`verbatimModuleSyntax` enforces it).
- **No enums/namespaces/parameter properties, ever.** Message actions become a
  `const` object + `type Action = keyof typeof ACTIONS`.
- **Bundles are committed**: every rename PR must include the rebuilt bundle
  diff or CI fails on the `git diff --exit-code` step.
- **Background trusts raw stored settings**: typing this honestly means
  `StoredSettings = Partial<Settings>` in background, not `Settings`.
- Handlers return heterogeneous shapes (arrays, `{ok, reason}`,
  `{ok:false, error}`) — the protocol map pins these down.
- `manifest.json` is generated per-target (Chrome-only `tabGroups` permission);
  keep the build manifest logic target-aware.
- Test fixtures currently simulate unsupported browsers by swapping/deleting
  whole `chrome` namespaces (`background.test.js`); the typed stub must not
  silently make those keys always-defined.
- Tests must stay behavior-identical through the rename; no assertion changes.

## Sizing

- Phase 0: hours.
- Phase 1: the real design work, ~1–2 focused days.
- Phase 2: mechanical, ~2–4h per domain cluster once protocol + settings types exist.
- Phase 3–4: ~1 day.
- Total ~<1 week part-time; every PR independently revertable.

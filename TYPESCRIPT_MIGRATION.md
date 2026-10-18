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

## Progress log

Branch `typescript`, one commit per logical unit, bundles rebuilt each time:

- Phase 0 + `shared/url.ts` + tooling: `2c302e8`.
- 40-action message contract (Phase 1 #1 complete: protocol typed `058a836` and
  since `dfc14e6` `background/main.ts` is an exhaustive per-action router —
  adding an action without a handler is a compile error): `058a836`.
- Phase 1 #2 settings schema: `shared/*` pure-logic modules `bd26f9a`, then
  `content/keymap.ts` + `content/settings.ts` + `tests/keymap.test.ts` `a9c298a`.
  `Settings`/`RawSettings` live in keymap.ts; RawSettings fields are plain
  (non-optional) because every access is guard-first; migrate helpers return
  `Record<string, string>` with a passthrough cast on the invalid-input guard.
- Phase 2 order so far: `content/scroll.ts` `a472293`, `content/rank.ts` +
  `tests/rank.test.ts` `11c1435` (rankMatches has a true/false overload split),
  `content/find/{matcher,collect}.ts` + matcher test `028117e`,
  `content/{highlight,hint-layer}.ts` `213b419`, `content/hints-elements.ts`
  `19e8051` (RectLike + JariElement expando types; `disabled`/`readOnly`
  needed `HTMLInputElement` duck casts — they are NOT on lib.dom's
  `HTMLElement`),
  `content/clue.ts` `634c659`,
  `background/{utils,windows,bookmarks,suggest,handlers}.ts` `dff18e1`
  (StoredSettings = Partial<RawSettings> & {updatedAt?}; handlers typed against
  protocol payloads; `background/tabs.ts` is the remaining blocker for the
  exhaustive router),
  `content/page-nav.ts` `b7109d0`, `popup/site.ts` `33cc9c7` (TabSite
  interface shared with settings.ts/content.ts), `content/content.ts`
  `7728f5c` (key dispatcher: run()/handleKeydown typed, pills map,
  `__jariOptionsRecording` window cast), `content/overlays.ts` `c97ec16`
  (OverlayApi contract; register keeps modal-defaults-true via destructuring),
  `content/commands.ts` + tsconfig gate repair `df238f2`,
  `content/screenshot.ts` `56e2ec3` (guard-first unknown payloads;
  isScreenshotDataUrl is a `value is string` predicate so cropDataUrl narrows
  dataUrl; keep non-optional defaulted params so emitted JS is unchanged),
  `background/tabs.ts` `c2da6a2` (all handlers typed per-action with
  MessagePayload/MessageResponse; @types/chrome models multi-id tab APIs as
  non-empty `[number, ...number[]]` tuples while the real browser takes plain
  arrays — one identity `asTabIds` cast helper covers group/ungroup/move;
  legacy Firefox-only `tabs.goBack`/`goForward` absent from @types go through
  a Record cast alias in goHistory; the one runtime-visible delta is that
  identity helper plus an alias — everything else erased; windows.ts
  `moveTabIntoWindowAndFocus` param widened to `number | number[]`),
  `background/main.ts` `dfc14e6` (Phase 1 #1 complete: handlers assigned to
  `{ [A in Action]: HandlerFor<A> }` built from Messages payload/response
  lookups — a missing action or drifting handler signature now fails tsc;
  runtime dispatch unchanged). `background/` is fully typed; no loose Handler
  seam remains.
- Phase 2 continued: `content/find.ts` `2f15bfd` (matches/Range[] state,
  ShadowRoot cast for fixed-ancestor traversal, `?? undefined` ×5,
  non-null asserts inside listeners — module-null-narrowing trap),
  `content/hints.ts` `88ddf30` (HintEntry over hint-layer's HintLink;
  JariElement/RectLike exported from hints-elements; Node-typed
  `hasJariClass` with Element casts; resize path makes
  `scheduleRegenerate(mutations?: ...)` optional — no-arg call preserved),
  `content/prompt/shared.ts` `dfbe639`, `content/prompt/list.ts` `972744c`
  (ListRow exported for prompt.ts; TabUrlMap models the mixed
  suggestion/TabSummary value through an all-optional `source?` prop;
  mode-arm union narrowing is casts at the two render sites),
  `content/prompt.ts` `ece7c57` (PromptRow all-optional duck for the
  heterogeneous filtered mix; rank.ts RankItem/RankMatch exported,
  RankItem gains `folderPath?`; OverlayApi key handlers honestly widen to
  `boolean | void` because prompt consumes without returning —
  handleKeydown return follows), `content/palette.ts` `3eb0e0c`
  (PaletteItem/CommandTable local types; filterCommands cast over
  rankMatches output).
- GATE BUG FIXED in `df238f2`: tsconfig `include` covered only
  `shared/**/*` + `tests/**/*.ts`, so all Phase-2 content/background TS files
  passed `tsc --noEmit` without being in the program (only keymap/rank/
  catalog/find-matcher were reachable through tests). Commands ranked 42
  implicit-any errors; 111 errors total across 12 files fixed with erased
  syntax alone (union casts at `Element | Window` scroll boundaries,
  `HTMLInputElement` duck casts for `disabled`/`readOnly`,
  getRootNode/host annotations, Suggestion type import, clampMaxResults
  optional param, `clearTimeout(timer ?? undefined)` emit). From this commit
  on, `npm run check` is real for every TS file; `.js` files pulled in via
  imports are not checked (checkJs false) but do enter type inference.
- Test-file policy: pure-logic suites migrate to `.test.ts`; fixture-heavy
  DOM/globalThis-stub suites (e.g. tests/find-collect.test.js) stay `.js` and
  import the `.ts` modules directly.

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

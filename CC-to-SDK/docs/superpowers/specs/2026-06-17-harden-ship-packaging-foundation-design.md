# Harden & Ship — Sub-project 1: Build & Packaging Foundation — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending spec review → implementation plan
**Track:** "Harden & ship the headless harness" (post-Phase-2 direction; Phase 3 TUI deferred — see
[[harden-and-ship-over-phase3]]). This is **sub-project 1 of 4**: packaging foundation → API polish → docs → CI.
**Working dir:** `CC-to-SDK/harness/`
**Distribution bar:** **publish-ready, not yet published** — do all the real packaging engineering; stop short
of an actual public `npm publish`.

---

## 1. Goal

Turn the harness from a tsx-run dev workspace into a real, buildable, installable npm package that a consumer
*could* install from a tarball and both **`import`** (library) and **run the `cc-harness` CLI** (service) —
without publishing to npm. The change is pure repackaging: **no `src/` logic changes** beyond one CLI shebang.

## 2. Current state (the gaps)

`package.json` is `private: true` with **no** `main`/`module`/`types`/`exports`/`files`/`engines`, and `bin`
points at `./src/cli.ts` with a `#!/usr/bin/env -S npx tsx` shebang. `tsconfig.json` is `noEmit: true` (+
`allowImportingTsExtensions: true`, `include: ["src","test"]`), so there is **no `dist/`, no compiled JS, no
`.d.ts`**. It runs locally only because `tsx` executes the TypeScript. An installer gets nothing runnable.

Already in place (no rework): `README.md`, a strict NodeNext `tsconfig`, `.js` import specifiers throughout
`src/` (so emitted ESM resolves), 44 test files, `package-lock.json`.

## 3. Scope

**In scope (sub-project 1):** a `tsc` build emitting `dist/` (JS + `.d.ts`); `package.json` packaging fields
(`main`/`types`/`exports`/`bin`/`files`/`engines` + build scripts); the CLI shebang fix; an automated
install-from-tarball verification harness.

**Out of scope (later sub-projects):** curating/expanding the public API surface — e.g. exposing
`src/proactive` or `src/bridge`, stable error types, boundary input validation (**sub-project 2**); README/
usage/API docs (**3**); CI workflow + coverage + live-test story (**4**); an actual `npm publish` (LICENSE,
name scoping, semver commitment, `publishConfig`); a networked/deployed service; dual CJS/ESM output.

## 4. Approach

Plain **`tsc` build**, **ESM-only**. Rejected alternatives: a bundler (tsup/esbuild) adds a build dep +
config for no benefit on a Node library and can fight the daemon's runtime bits; shipping `.ts` source +
requiring `tsx` is not a real package. `tsc` adds zero deps, emits fully-typed NodeNext ESM, and our `.js`
specifiers make the output resolve correctly — the same way the Agent SDK ships.

## 5. Design

### 5.1 Build pipeline — a tsconfig split

Keep `tsconfig.json` as the **dev/typecheck** config unchanged (drives `npm run typecheck`, `tsx`, and test
type-checking; keeps `noEmit` + `allowImportingTsExtensions` + `test` in `include`).

Add **`tsconfig.build.json`**:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "allowImportingTsExtensions": false, // incompatible with emit; source uses .js specifiers so unneeded
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["test", "node_modules", "dist"]
}
```

Notes:
- **No source maps / declaration maps.** `files: ["dist"]` ships `dist/` only (not `src/`), so maps pointing
  back at `src/*.ts` would be dangling. Emit `.d.ts` (declaration) but no `*.map`.
- `rootDir: "src"` + `include: ["src"]` → `dist/` mirrors `src/` (`dist/index.js`, `dist/cli.js`,
  `dist/daemon/*.js`, `dist/proactive/*.js`, …) with sibling `.d.ts`.
- **Precondition to verify in the plan:** no `src/` file imports a `.ts` extension (grep `from ".*\.ts"`);
  if any exist they must become `.js` (emit with `allowImportingTsExtensions:false` would otherwise error).

### 5.2 `package.json` changes

Add/repoint these fields (everything else — `name`, `version`, `private`, `type`, deps — unchanged):

```jsonc
{
  "private": true,                 // KEEP: the deliberate "not-yet-published" guard (blocks npm publish,
                                   //       allows npm pack + local tarball install for verification)
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "bin": { "cc-harness": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf dist",
    "prepack": "npm run build",        // npm pack/publish always builds fresh
    "verify:pack": "node scripts/verify-package.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:live": "vitest run test/live",
    "cli": "tsx src/cli.ts"            // dev flow unchanged
  }
}
```

The public API surface is **whatever `src/index.ts` already re-exports** (createHarness, resolveOptions,
config types, BUILTIN_AGENTS/OUTPUT_STYLES, TaskStore/createTaskMcpServer, SwarmRuntime/MessageBus/
createSwarmMcpServer/SwarmError, DaemonSupervisor/DaemonServer/SessionRegistry/daemonRequest/daemonSocketPath/
DaemonError). Single root `"."` export — no subpath exports (YAGNI; curation is sub-project 2).

### 5.3 CLI shebang fix

`src/cli.ts` line 1 is `#!/usr/bin/env -S npx tsx`. `tsc` preserves the shebang into `dist/cli.js`, which
would then be wrong. Change the **source** shebang to:

```
#!/usr/bin/env node
```

Dev is unaffected: `npm run cli` runs `tsx src/cli.ts` (the script invokes tsx directly, not via the
shebang). The compiled `dist/cli.js` now runs under plain node, and npm marks the `bin` executable on install.

### 5.4 Verification harness — `scripts/verify-package.mjs`

A Node script (`npm run verify:pack`) that proves the package works *when installed*, which no in-repo test
can:

1. `npm run build`, then `npm pack` → a `cc-harness-<version>.tgz`.
2. `npm init -y` in a fresh temp dir; `npm install <tarball>` there.
3. **Library smoke:** `node` a probe that `import * as m from "cc-harness"` and asserts the expected named
   exports are present (createHarness, DaemonSupervisor, DaemonServer, daemonRequest, SwarmRuntime, TaskStore).
4. **`files` smoke:** assert the installed package has `dist/` and **no** `src/` (proves `files:["dist"]`).
5. **Bin smoke:** assert `node_modules/cc-harness/dist/cli.js` exists, is non-empty, and its first line is
   exactly `#!/usr/bin/env node`.
6. Clean up the tarball + temp dir; exit non-zero on any failure.

**Why no `node --check` on the bin:** `--check` has historically not supported ES modules (and `dist/cli.js`
is ESM), so it would flake by Node version. It is also unnecessary — `tsc` already guarantees the emitted JS
is syntactically valid, and step 3's library import exercises runtime resolution of the daemon/swarm/tasks/
config/harness modules the CLI shares.

**Deliberate limitation:** the bin is verified by existence + shebang, not by executing `main()` — running it
would block on stdin / need an API key / a live daemon. The one CLI-only module not transitively covered by
step 3 is `cliArgs.js`. A fuller CLI runtime smoke (e.g. a `--version` flag + a `main()`-invocation guard so
the module is importable) is deferred to sub-project 2.

**Environment note:** step 2's `npm install <tarball>` pulls the harness's runtime deps (SDK + zod) from the
registry, so the verification needs network access; document it as such (it's a release-gate check, not a
per-commit unit test).

## 6. Verification / acceptance

- `npm run build` produces `dist/` with `index.js` + `index.d.ts`, `cli.js` (first line `#!/usr/bin/env node`),
  and the mirrored submodule `.js`/`.d.ts`.
- `npm run verify:pack` passes end-to-end (build → pack → temp install → library import + `files` + bin smokes).
- `npm run typecheck` clean; `npm test` green (all 222 unit tests; live unaffected) — packaging must not
  change behavior.
- `git status` clean after a build except `dist/` and `*.tgz`, which are **gitignored** (add `dist/` and
  `*.tgz` to `.gitignore`).

## 7. Success criteria

- A fresh `npm install <tarball>` yields a package that both `import`s (typed) and ships a runnable
  `cc-harness` bin under plain node.
- `private: true` still blocks an accidental `npm publish`; flipping it (+ LICENSE + name/publishConfig) is
  the only remaining step to go public.
- No `src/` behavior changed; the test suite and typecheck are unchanged-green.
- `dist/` and packed tarballs never land in git.
- The public API surface is unchanged from today's `src/index.ts` (curation deferred to sub-project 2).

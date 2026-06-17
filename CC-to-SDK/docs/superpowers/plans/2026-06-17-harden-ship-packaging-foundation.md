# Harden & Ship — Build & Packaging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the tsx-run dev workspace into a real, buildable, installable npm package — both `import`-able (library) and `cc-harness`-runnable (CLI) when installed — without publishing.

**Architecture:** Plain `tsc` build emits `dist/` (JS + `.d.ts`) from `src/` via a second `tsconfig.build.json`; `package.json` gains the packaging metadata pointing at `dist/`; the CLI shebang switches to node; an install-from-tarball script is the acceptance gate. Pure repackaging — no `src/` logic changes beyond one shebang line.

**Tech Stack:** TypeScript `tsc` (NodeNext ESM, already present), Node ≥18, npm. No new dependencies, no bundler.

**Spec:** `docs/superpowers/specs/2026-06-17-harden-ship-packaging-foundation-design.md`

## Global Constraints

- **Distribution bar:** publish-ready, **not** published. **Keep `package.json` `"private": true`** (the not-yet-published guard) — do NOT add LICENSE, publishConfig, or run `npm publish`.
- **No `src/` logic changes** beyond changing the `src/cli.ts` shebang line.
- **ESM-only, plain `tsc`** — no bundler, no new deps, no dual CJS/ESM.
- **Public API frozen** at the current `src/index.ts` (do not add new exports; proactive/bridge stay internal).
- **No Prettier** in this harness — never run it; match the existing compact hand-style.
- **`dist/` and `*.tgz` must be gitignored** and never committed.
- Run `npm`/`node` from `CC-to-SDK/harness/`; run `git` from the repo root `CC-to-SDK/`. Branch `main` (committing to main is authorized; never create a branch; **never push**). Commit messages: `chore(harness): …` / `build(harness): …` style; **no `Co-Authored-By`/attribution lines**.

---

## File Structure

- `harness/.gitignore` *(modify)* — ignore build/pack artifacts.
- `harness/src/cli.ts` *(modify, line 1 only)* — shebang for the compiled bin.
- `harness/tsconfig.build.json` *(create)* — the emitting build config (the dev `tsconfig.json` stays as-is).
- `harness/package.json` *(modify)* — packaging metadata + scripts.
- `harness/scripts/verify-package.mjs` *(create)* — the install-from-tarball acceptance harness.

---

## Task 1: Build pipeline + package.json packaging

Turn the repo into something that emits a correct `dist/` and declares itself installable against it.

**Files:**
- Modify: `harness/.gitignore`
- Modify: `harness/src/cli.ts` (line 1 only)
- Create: `harness/tsconfig.build.json`
- Modify: `harness/package.json`

**Interfaces:**
- Produces: `npm run build` → `dist/index.js`, `dist/index.d.ts`, `dist/cli.js` (first line `#!/usr/bin/env node`), and the mirrored submodule tree (`dist/daemon/*`, `dist/swarm/*`, `dist/proactive/*`, `dist/bridge/*`, `dist/tasks/*`, `dist/config/*`). The package's `bin` is `cc-harness` → `./dist/cli.js`; the library entry is `./dist/index.js` with types `./dist/index.d.ts`. Consumed by Task 2's verification harness.

- [ ] **Step 1: Ignore build/pack artifacts first (so the build never dirties git)**

Edit `harness/.gitignore` to read exactly:

```gitignore
node_modules/
dist/
*.tgz
```

- [ ] **Step 2: Fix the CLI shebang for the compiled bin**

In `harness/src/cli.ts`, replace line 1 only:

```
#!/usr/bin/env -S npx tsx
```

with:

```
#!/usr/bin/env node
```

Leave the rest of `cli.ts` untouched. (`tsc` preserves this shebang into `dist/cli.js`; the dev flow `npm run cli` invokes `tsx src/cli.ts` directly and is unaffected.)

- [ ] **Step 3: Create the emitting build config**

Create `harness/tsconfig.build.json`:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "allowImportingTsExtensions": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["test", "node_modules", "dist"]
}
```

(`allowImportingTsExtensions` must be off because it is incompatible with emit; the source uses `.js` import specifiers so it is unneeded. No source maps / declaration maps — `files:["dist"]` ships `dist/` only, so maps pointing back at `src/*.ts` would dangle.)

- [ ] **Step 4: Rewrite `package.json` with packaging metadata + scripts**

Replace `harness/package.json` in full with:

```json
{
  "name": "cc-harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": { "cc-harness": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf dist",
    "prepack": "npm run build",
    "verify:pack": "node scripts/verify-package.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "test:live": "vitest run test/live",
    "cli": "tsx src/cli.ts"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.178",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

(The `verify:pack` script references `scripts/verify-package.mjs`, created in Task 2 — do not run it in Task 1.)

- [ ] **Step 5: Build and verify the emitted dist**

Run: `cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && npm run build`
Expected: exits 0, no errors.

Then verify the output:

Run: `ls dist && echo "---" && head -1 dist/cli.js && echo "---" && test -f dist/index.d.ts && test -f dist/index.js && test -f dist/daemon/supervisor.js && echo "key files present"`
Expected: `dist` lists `index.js`, `index.d.ts`, `cli.js`, `cli.d.ts`, and subdirs `bridge config daemon proactive swarm tasks`; `head -1 dist/cli.js` prints exactly `#!/usr/bin/env node`; final line prints `key files present`.

- [ ] **Step 6: Confirm typecheck and tests are unchanged-green (behavior must not change)**

Run: `npm run typecheck`
Expected: exits 0, no errors.

Run: `npm run test:unit`
Expected: all unit tests pass (222 tests / 40 files).

- [ ] **Step 7: Confirm the pack manifest ships dist only**

Run: `npm pack --dry-run 2>&1 | grep -E "Tarball Contents|npm notice" | head -40`
Expected: the listed files are under `dist/` plus `package.json` and `README.md`; **no** `src/` or `test/` entries appear. (A leftover `*.tgz` is not produced by `--dry-run`.)

- [ ] **Step 8: Confirm git is clean (artifacts ignored)**

Run (from repo root): `cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK && git status --short`
Expected: only the four touched files appear as modified/added (`.gitignore`, `src/cli.ts`, `tsconfig.build.json`, `package.json`) — **no** `dist/` or `*.tgz` lines.

- [ ] **Step 9: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/.gitignore harness/src/cli.ts harness/tsconfig.build.json harness/package.json
git commit -m "build(harness): tsc dist build + package.json packaging metadata"
```

---

## Task 2: Install-from-tarball verification harness

A script that proves the package works *when installed* — the one thing no in-repo test can verify.

**Files:**
- Create: `harness/scripts/verify-package.mjs`

**Interfaces:**
- Consumes: Task 1's build + packaging (the `build` script, the `bin`/`exports`/`files` fields, the `cc-harness-<version>.tgz` that `npm pack` produces).
- Produces: `npm run verify:pack` → exits 0 on success, non-zero on any failure; the `verify:pack` script already exists in `package.json` from Task 1.

- [ ] **Step 1: Create the verification script**

Create `harness/scripts/verify-package.mjs`:

```js
// Release-gate acceptance: prove the package works WHEN INSTALLED (not just in-repo).
// build -> npm pack -> install the tarball into a throwaway project -> assert the library
// imports, files:["dist"] shipped no src/, and the bin carries the node shebang.
// Needs network access: the temp install pulls the SDK + zod from the registry.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// 1. build + pack (prepack also builds; the explicit build keeps the step legible)
run("npm run build");
run("npm pack");
const tarball = join(root, `${pkg.name}-${pkg.version}.tgz`);
assert(existsSync(tarball), `expected tarball ${pkg.name}-${pkg.version}.tgz not found`);

const dir = mkdtempSync(join(tmpdir(), "cc-harness-verify-"));
try {
  // 2. install the tarball into a throwaway project
  run("npm init -y", { cwd: dir, stdio: "ignore" });
  run(`npm install "${tarball}"`, { cwd: dir });
  const pkgDir = join(dir, "node_modules", pkg.name);

  // 3. library smoke: the public exports resolve at runtime
  const probe = join(dir, "probe.mjs");
  writeFileSync(probe, [
    'import * as m from "cc-harness";',
    'const need = ["createHarness","DaemonSupervisor","DaemonServer","daemonRequest","SwarmRuntime","TaskStore"];',
    'const missing = need.filter((k) => typeof m[k] === "undefined");',
    'if (missing.length) { console.error("MISSING exports: " + missing.join(", ")); process.exit(1); }',
    'console.log("library import OK (" + need.length + " exports present)");',
  ].join("\n"));
  run(`node "${probe}"`, { cwd: dir });

  // 4. files:["dist"] smoke: dist shipped, src did not
  assert(existsSync(join(pkgDir, "dist", "index.js")), "installed package missing dist/index.js");
  assert(!existsSync(join(pkgDir, "src")), "installed package leaked src/ (files:[dist] not honored)");

  // 5. bin smoke: exists, non-empty, node shebang
  const bin = join(pkgDir, "dist", "cli.js");
  assert(existsSync(bin), "installed bin dist/cli.js missing");
  const firstLine = readFileSync(bin, "utf8").split("\n", 1)[0];
  assert(firstLine === "#!/usr/bin/env node", `bin shebang wrong: ${JSON.stringify(firstLine)}`);

  console.log("verify-package: PASS");
} finally {
  rmSync(tarball, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the acceptance gate**

Run: `cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && npm run verify:pack`
Expected: builds, packs, installs into a temp dir, prints `library import OK (6 exports present)` then `verify-package: PASS`, exits 0. (Requires network to install the SDK + zod into the temp project.)

- [ ] **Step 3: Confirm git is still clean (the script removes its tarball; dist/*.tgz ignored)**

Run (from repo root): `cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK && git status --short`
Expected: only `harness/scripts/verify-package.mjs` appears as new — no `dist/`, no `*.tgz`.

- [ ] **Step 4: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/scripts/verify-package.mjs
git commit -m "build(harness): install-from-tarball package verification harness"
```

---

## Final verification (after both tasks)

- [ ] `cd harness && npm run build` — emits `dist/` with `index.js`/`index.d.ts`/`cli.js` (node shebang).
- [ ] `cd harness && npm run verify:pack` — PASS end-to-end.
- [ ] `cd harness && npm run typecheck && npm run test:unit` — clean + 222 green (behavior unchanged).
- [ ] `git status` clean; `git log --oneline -2` shows the two task commits; no `dist/`/`*.tgz`/secret staged.
- [ ] Dispatch the two-stage review (spec compliance, then code quality) per subagent-driven-development; codex via `/codex:rescue --model gpt-5.5 --effort high`, falling back to a Claude reviewer if codex is unavailable.

---

## Self-Review (plan ↔ spec)

**Spec coverage:**
- §5.1 build pipeline (tsconfig split, no maps, `.ts`-import precondition) → Task 1 Steps 3 (+ precondition already verified clean during planning). ✓
- §5.2 package.json fields (main/types/exports/bin/files/engines, keep `private`, scripts) → Task 1 Step 4. ✓
- §5.3 CLI shebang → Task 1 Step 2. ✓
- §5.4 verify harness (build→pack→install→library/files/bin smokes, network note) → Task 2. ✓
- §6 acceptance (build output, verify:pack, typecheck+tests green, gitignore dist/+*.tgz) → Task 1 Steps 5–8, Task 2, Step 1 gitignore, Final verification. ✓
- §7 success criteria (installable+importable, `private` blocks publish, no behavior change, no artifacts in git, API frozen) → covered across both tasks; API frozen by leaving `src/index.ts` untouched. ✓

**Placeholder scan:** every step has exact file content / exact commands with expected output; no TBD/"handle errors"/"similar to". ✓

**Type/name consistency:** `tsconfig.build.json`, the `build`/`clean`/`prepack`/`verify:pack` script names, `dist/cli.js`, `dist/index.js`, the `#!/usr/bin/env node` shebang string, and the six probed exports (createHarness, DaemonSupervisor, DaemonServer, daemonRequest, SwarmRuntime, TaskStore — all present in `src/index.ts`) are used identically across both tasks. ✓

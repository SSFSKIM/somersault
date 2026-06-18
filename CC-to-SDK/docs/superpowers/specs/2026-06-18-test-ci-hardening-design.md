# Test & CI Hardening — Design

> Sub-project 4 (final) of the **harden-and-ship** track (1 = packaging, 2 = public-API hardening, 3 = docs —
> all DONE; see memory `harden-and-ship-over-phase3`). Stand up **continuous integration** for `CC-to-SDK` so
> the guards the prior sub-projects built — the frozen 44-export surface, the README import-drift gate, config
> validation, teardown-liveness — are **enforced automatically** on every change, not just when someone
> remembers to run the suite. **CI automation only** (the 368-test suite is already strong; the gap is
> enforcement) and **lean** (keyless gate; no coverage gate, no paid live tests).

## §1 — Goal

Every change under `CC-to-SDK/` is automatically gated by the harness's keyless checks before it can merge.
Concretely: a GitHub Actions workflow runs, in `CC-to-SDK/harness/`, the chain `npm ci → typecheck → build →
test:unit → verify:pack` on Node **18 and 22**, on pull requests and on pushes to `main`, scoped so it only
fires on `CC-to-SDK/` changes (and never on the upstream Rust syncs the fork receives).

## §2 — Audit evidence (the grounding)

State as of 2026-06-18 (all verified live, not assumed):

- **CC-to-SDK has zero CI.** The repo (`SSFSKIM/codex_somersault`, a fork of OpenAI Codex) carries ~26
  workflows under `.github/workflows/`, all for `codex-rs` / Python / the SDK; **none reference `CC-to-SDK`
  or `cc-harness`** (`grep -rl "CC-to-SDK\|cc-harness" .github/` → empty). So nothing runs the 368 unit
  tests automatically today.
- **The harness is a standalone npm package.** It has a **committed** `package-lock.json` (so `npm ci` is
  usable), it is **not** part of any root pnpm workspace, and its scripts are `typecheck` (`tsc --noEmit`),
  `build` (`tsc -p tsconfig.build.json`), `test:unit` (`vitest run test/unit`), `test:live`
  (`vitest run test/live`), and `verify:pack` (`node scripts/verify-package.mjs`). `engines.node` is `>=18`.
- **`npm ci` passes against the committed lockfile as-is** — verified by running it. The lock's root entry
  lacks the `license`/`description` metadata Task 1 (sub-project 3) added to `package.json`, but `npm ci`
  validates *dependencies*, not root metadata, so it is **green without any lockfile refresh**. The
  anticipated "lockfile-wiring" step is therefore **not needed** — the deliverable is purely the workflow.
- **The gate is fully keyless.** All 15 `test/live/` files gate on `ANTHROPIC_API_KEY`
  (`process.env.ANTHROPIC_API_KEY ? describe : describe.skip`) and skip cleanly without it; `test:unit` never
  touches the network. `verify:pack` builds, runs `npm pack`, temp-installs the tarball, and asserts the
  library imports + the bin shebang + `files:["dist"]` — importing the package does **not** call the SDK, so
  it needs **no API key** either.
- **House CI conventions** (from `.github/workflows/ci.yml` + `sdk.yml`): triggers `pull_request: {}` +
  `push: { branches: [main] }`; `runs-on: ubuntu-latest`; `timeout-minutes: 10`; **SHA-pinned** actions —
  `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2` and
  `actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0`; checkout uses
  `persist-credentials: false` and the PR-head-sha ref pattern; Node 22 is the house default.
- **The CC reference snapshot does not help here.** `CC-to-SDK/Claude Code Src/` is the stale February
  research snapshot (bun-based, only a `typecheck` script, no test runner, no `.github/workflows`, no vitest
  config) — useful for replicating CC *behavior*, but it has no CI/test infrastructure to mirror. The repo's
  own `ci.yml`/`sdk.yml` are the authoritative house-style reference.

## §3 — Scope

**In:** one new GitHub Actions workflow, `.github/workflows/cc-to-sdk.yml`, implementing the keyless matrix
gate described in §4, plus its local verification (§5).

**Out (non-goals):**
1. **Coverage** — no `@vitest/coverage-v8` devDep, no coverage report or threshold (user choice: lean).
2. **Live tests in CI** — no repo secret, no paid live-smoke job (user choice). The live suite stays
   manual/gated, run locally with a key.
3. **Test-suite changes** — no new/edited tests, no coverage-gap audit (user choice: CI automation only).
   The suite is already strong (every shipped feature has unit + a gated live test).
4. **Touching the existing Rust/Python/SDK workflows** — the new file is additive and path-scoped; it does
   not modify, reorder, or depend on any upstream workflow.
5. **Lockfile changes** — `npm ci` is already green (§2); no `package-lock.json` refresh.
6. **Lint/format gate** — the project has no ESLint/Prettier setup (NO-Prettier is a deliberate house rule);
   `typecheck` is the static gate. No linter is added.
7. **Self-hosted runners** — uses GitHub-hosted `ubuntu-latest`, not the upstream `*-runners` group (which
   belongs to upstream's infra and is not guaranteed on this fork).

## §4 — Design

### 4.A — The workflow (`.github/workflows/cc-to-sdk.yml`)

```yaml
name: cc-to-sdk

on:
  pull_request:
    paths:
      - 'CC-to-SDK/**'
      - '.github/workflows/cc-to-sdk.yml'
  push:
    branches: [main]
    paths:
      - 'CC-to-SDK/**'
      - '.github/workflows/cc-to-sdk.yml'

# Cancel superseded runs on the same ref (cheap; avoids stacked runs on rapid pushes).
concurrency:
  group: cc-to-sdk-${{ github.ref }}
  cancel-in-progress: true

jobs:
  harness:
    name: harness (node ${{ matrix.node }})
    runs-on: ubuntu-latest
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        node: [18, 22]
    defaults:
      run:
        working-directory: CC-to-SDK/harness
    steps:
      - name: Checkout repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0
        with:
          node-version: ${{ matrix.node }}
          cache: npm
          cache-dependency-path: CC-to-SDK/harness/package-lock.json

      - name: Install (clean, from lockfile)
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Build
        run: npm run build

      - name: Unit tests (keyless)
        run: npm run test:unit

      - name: Verify package (release gate)
        run: npm run verify:pack
```

**Rationale for each non-obvious choice:**
- **`paths:` filter** includes both `CC-to-SDK/**` and the workflow's own path, so the gate fires on every
  CC-to-SDK change AND when the workflow itself is edited (so a workflow change is self-validated), but **not**
  on upstream Rust/Python syncs — keeping it disjoint from the merges the fork receives.
- **`defaults.run.working-directory: CC-to-SDK/harness`** so every `run:` step executes in the package dir
  without repeating `cd`. (Note: `working-directory` applies to `run:` steps; the `actions/*` steps are
  unaffected, which is correct — `cache-dependency-path` is repo-root-relative.)
- **`matrix: node: [18, 22]`** validates the package's `engines: >=18` floor (18) and house currency (22);
  `fail-fast: false` so one version's failure still reports the other.
- **`verify:pack` on both nodes** proves the packed tarball installs and imports cleanly on each — cheap and
  the strongest single signal that the package is consumable.
- **SHA-pinned actions** reuse the exact pins already in `ci.yml`/`sdk.yml` for consistency and supply-chain
  safety.
- **`concurrency`** cancels in-flight runs for the same ref on a new push.

### 4.B — No source/package changes

The deliverable is the single workflow file. `package.json`, `package-lock.json`, `vitest` config, and all
`src/`+`test/` files are untouched (§2 verified `npm ci` is already green; §3 non-goals 1/3/5).

## §5 — Verification (how we prove it before the first real run)

GitHub Actions cannot execute locally, so correctness is established in three layers:

1. **YAML + action validity:** run `actionlint` on the file if available; if not installed, fall back to a
   strict YAML parse (`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/cc-to-sdk.yml'))"`)
   plus a manual diff against `ci.yml`/`sdk.yml` to confirm the action SHAs, trigger shape, and step syntax
   match house style.
2. **Command-sequence reproduction:** run the exact CI chain locally in `CC-to-SDK/harness/` —
   `npm ci && npm run typecheck && npm run build && npm run test:unit && npm run verify:pack` — and confirm
   every step exits 0. This proves the *commands* the workflow runs are correct and green. (Local Node is one
   version; the [18, 22] matrix is confirmed by the first CI run — stated honestly, not hidden.)
3. **First-push confirmation:** the workflow's first run on `main`/a PR is the end-to-end proof. This is
   expected and acceptable; layers 1–2 make a green first run highly likely.

## §6 — Correctness & edge handling

- **Disjoint from upstream:** the `paths:` filter guarantees the job never runs on a pure Rust/Python sync, so
  it adds zero latency to upstream merges and cannot be broken by them (additive file, no shared edits).
- **`npm ci` strictness:** if a future `package.json` dependency edit forgets to update the lockfile, `npm ci`
  fails loudly — which is the desired behavior (it catches lockfile drift). Verified green for the current
  tree.
- **Keyless guarantee:** no step reads `ANTHROPIC_API_KEY`; live tests are not invoked (`test:unit` only).
  The job needs no secrets and has no token cost.
- **Timeout:** 10 minutes is ample (the full local chain is well under that) and matches house workflows.

## §7 — Testing

- **The workflow is the test infrastructure**, so "testing" here = the §5 verification (actionlint/parse +
  local reproduction of the chain, both green).
- No unit/live test is added (non-goal 3). The existing suite is what the workflow *runs*; its green status is
  re-confirmed by the local reproduction.
- **Controller manual gate:** confirm the file lives at `.github/workflows/cc-to-sdk.yml`, parses as valid
  YAML, pins the same action SHAs as `ci.yml`, and that the `paths:` filter excludes non-CC-to-SDK changes.

## §8 — Non-goals

See §3 "Out": no coverage, no live-in-CI, no test-suite/coverage-gap changes, no edits to existing workflows,
no lockfile change, no linter, no self-hosted runners. Beyond those: no release-publishing automation (the
package stays `private: true`; `verify:pack` only *proves* it is publishable), no branch-protection/required-
status configuration (a GitHub repo-settings action the user takes, outside the codebase), and no caching
beyond `setup-node`'s built-in npm cache.

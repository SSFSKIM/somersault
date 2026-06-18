# Test & CI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyless GitHub Actions workflow that gates every `CC-to-SDK/` change with the harness's `npm ci → typecheck → build → test:unit → verify:pack` chain on Node 18 and 22.

**Architecture:** One new additive file, `.github/workflows/cc-to-sdk.yml`, path-scoped to `CC-to-SDK/**` so it is disjoint from the upstream Rust/Python syncs the fork receives. No source, package, lockfile, or existing-workflow changes.

**Tech Stack:** GitHub Actions (SHA-pinned `actions/checkout` + `actions/setup-node`), npm (committed `package-lock.json`), Vitest, TypeScript.

## Global Constraints

Copy these verbatim into the task's working context:

- **One new file only:** `.github/workflows/cc-to-sdk.yml`. Do NOT modify `package.json`, `package-lock.json`, `vitest` config, any `src/`/`test/` file, or any existing workflow. (`npm ci` is already verified green against the committed lockfile — no lockfile refresh.)
- **SHA-pin actions to the exact pins house workflows use** (from `.github/workflows/ci.yml`/`sdk.yml`): `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2` and `actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6.3.0`. Do not use floating tags (`@v4`).
- **Keyless:** no step reads `ANTHROPIC_API_KEY`; `test:live` is NOT invoked; no secrets.
- **Path-scoped:** triggers fire only on `CC-to-SDK/**` and the workflow's own path — never on a pure upstream Rust/Python sync.
- **House style:** `runs-on: ubuntu-latest`, `timeout-minutes: 10`, `persist-credentials: false`, the PR-head-sha `ref:` pattern.
- **Commit to the current branch (`main`); no `Co-Authored-By`/attribution; do not push.**
- All `npm` commands run from `CC-to-SDK/harness/`.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-test-ci-hardening-design.md`

---

### Task 1: The `cc-to-sdk` CI workflow

**Files:**
- Create: `.github/workflows/cc-to-sdk.yml`

**Interfaces:**
- Consumes: the harness package scripts (`typecheck`/`build`/`test:unit`/`verify:pack`) and its committed `CC-to-SDK/harness/package-lock.json`.
- Produces: a CI gate (no code interface; the deliverable is the workflow).

- [ ] **Step 1: Establish the green baseline (the "test" the workflow will run)**

Before writing the workflow, prove the exact command chain it will execute is green on the current tree. Run from `CC-to-SDK/harness/`:
```bash
npm ci && npm run typecheck && npm run build && npm run test:unit && npm run verify:pack
```
Expected: every step exits 0 — `npm ci` installs from the lockfile, typecheck/build clean, `test:unit` all green (~368 tests, live tests skip without a key), `verify:pack` prints its success assertions (library imports + bin shebang + `files:[dist]`). If any step fails, STOP and report — the workflow must not codify a red chain.

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/cc-to-sdk.yml` with EXACTLY this content (SHA pins and the `paths:`/matrix/`defaults` shape are load-bearing — match verbatim):

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

# Cancel superseded runs on the same ref (avoids stacked runs on rapid pushes).
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

- [ ] **Step 3: Validate the YAML and the action pins**

Run an actionlint check if available, else a strict YAML parse:
```bash
cd /Users/new/Documents/GitHub/codex_somersault
actionlint .github/workflows/cc-to-sdk.yml 2>/dev/null && echo "actionlint OK" \
  || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cc-to-sdk.yml')); print('YAML parse OK')"
```
Expected: `actionlint OK` (no findings) or `YAML parse OK`. Then confirm the action SHAs match the house pins exactly:
```bash
grep -E "actions/(checkout|setup-node)@" .github/workflows/cc-to-sdk.yml
grep -E "actions/(checkout|setup-node)@" .github/workflows/ci.yml
```
Expected: the `checkout@de0fac2e…` and `setup-node@53b83947…` SHAs in the new file match those in `ci.yml`.

- [ ] **Step 4: Confirm the path filter excludes non-CC-to-SDK changes**

Sanity-check the trigger scope (a Rust-only change must NOT match the filter):
```bash
python3 -c "
import yaml
w = yaml.safe_load(open('.github/workflows/cc-to-sdk.yml'))
on = w['on'] if 'on' in w else w[True]   # YAML parses bare 'on:' key as boolean True
paths = on['pull_request']['paths']
assert 'CC-to-SDK/**' in paths and '.github/workflows/cc-to-sdk.yml' in paths, paths
# a path under codex-rs/ must not be covered by these globs
import fnmatch
assert not any(fnmatch.fnmatch('codex-rs/core/src/lib.rs', p) for p in paths), 'Rust path wrongly matched'
assert any(fnmatch.fnmatch('CC-to-SDK/harness/src/index.ts', p) for p in paths), 'CC-to-SDK path not matched'
print('path filter OK')
"
```
Expected: `path filter OK`. (Note: PyYAML parses a bare `on:` key as boolean `True`; the snippet handles that. The assertions are a local approximation of GitHub's `paths` semantics — exactness is confirmed by the first real run.)

- [ ] **Step 5: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault
git add .github/workflows/cc-to-sdk.yml
git commit -m "ci(CC-to-SDK): keyless harness gate (typecheck/build/test/pack) on node 18+22"
```

---

## Self-Review (controller, before dispatch)

**Spec coverage:** §4.A workflow → Task 1 Step 2 (verbatim). §5 verification → Steps 1 (chain reproduction), 3 (actionlint/parse + SHA match), 4 (path-filter check). §3 non-goals (one file, no lockfile/source/existing-workflow change) → Global Constraints + the create-only Files list. All spec sections map to a step.

**Placeholder scan:** every step has its exact command/content; no TBD/TODO; the full workflow YAML is inlined.

**Consistency:** the SHA pins, `paths:` globs, matrix `[18, 22]`, and `working-directory` in Step 2 match the spec §4.A and the Global Constraints exactly. Step 4 documents the PyYAML `on:`→`True` gotcha so the verification snippet doesn't spuriously fail.

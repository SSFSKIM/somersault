# Public-API Docs — Design

> Sub-project 3 of the **harden-and-ship** track (1 = packaging DONE, 2 = public-API hardening DONE; see
> memory `harden-and-ship-over-phase3`). Make the `cc-harness` README an accurate, complete front door for
> the now-frozen 44-export surface, and give `package.json` its publish metadata. **Lean scope** (the user
> declined per-surface guides and TSDoc/typedoc — those are deferred). Docs-only; no code change.

## §1 — Goal

A developer who finds `cc-harness` can understand what it is, install it, and use **every** core surface
from the README alone — with examples that are guaranteed to match the real public API. Concretely:
- `harness/README.md` is rewritten around the current frozen surface (current framing; a tour of each core
  surface with one working example; the complete refreshed `HarnessConfig` reference; CLI; testing; links to
  `API-STABILITY.md` + `docs/parity/coverage.md`);
- `harness/package.json` gains the publish-facing metadata (`description`/`keywords`/`repository`/
  `homepage`/`license`);
- a unit test guards the README against drift (every `cc-harness` import in the README is a real public export).

## §2 — Audit evidence (the grounding)

A read of the current README + `package.json` (2026-06-18):

**README is stale (wrong) —**
- Title "Phase 1 (Headless Harness Core)" and the whole "Phase 1/2/3" narrative (header, "16 Phase-1
  bridges", "Task tools (Phase 2 · A1)", "Where this fits") — the Phase framing was **abandoned** (the
  reframe: replicate CC's harness capability; harden-and-ship over Phase 3).
- `import { createHarness } from "cc-harness"; // from ./src/index.ts in-repo` — pre-packaging.
- "Requires Node ≥20" — **wrong**; `package.json` `engines` is `node >=18`.

**README is incomplete —** documents only the one-shot harness + task tools. **Missing ~80% of the frozen
surface:** the lib interactive `Session` (`openSession`/`resumeSession`), the daemon
(`DaemonSupervisor`/`DaemonServer`), session read+mutation+fork (`listSessions`/`getSessionMessages`/
`getSessionInfo`/`forkSession`/`renameSession`/`tagSession`/`deleteSession`), hooks
(`injectContext`/`guardTool`/`blockTool`/`observe`/`mergeHooks`), swarm (`SwarmRuntime`), context/compaction
tools (`createContextMcpServer`/`createCompactMcpServer`/`summarizeUsage`), Kairos (`KairosAssistant`),
introspection (`getContextUsage`/`accountInfo`/`usage`/`initializationResult`), turn controls
(`effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText`), and config
validation (`validateHarnessConfig`/`HarnessConfigError`).

**`package.json` lacks** `description`, `keywords`, `repository`, `homepage`, `license`.

**Confirmed facts to use:** root `LICENSE` is **Apache-2.0**; `engines.node` is **>=18**; scripts
`test:unit`/`test:live`/`typecheck`/`build`/`cli`/`verify:pack` all exist; `zod ^4.0.0` is now a direct
dependency; origin is `github.com/SSFSKIM/codex_somersault`; `docs/parity/{coverage,roadmap}.md` and
`harness/API-STABILITY.md` all exist (README links resolve).

## §3 — Scope

**In:** the README rewrite (§4.A), the `package.json` metadata (§4.B), and the README-drift test (§4.C).

**Out (non-goals):**
1. **Per-surface guides** (`docs/guides/*`) — declined; deferred.
2. **TSDoc doc-comments + typedoc** generated reference — declined; deferred (a larger 44-export sweep + new tooling).
3. **Rewriting `roadmap.md` or other `docs/parity/*`** — out of scope; the README links them as-is.
4. **Publishing** — stays `private:true`; this prepares the front door, it does not flip publish.
5. **Any `src/` change** — docs-only. (If a doc example reveals a real API bug, surface it; don't fix it here.)
6. **`author` field** — left for the user to set (identity choice), not added here.

## §4 — Design

### 4.A — README rewrite (`harness/README.md`)

Replace the file with this structure. **Preserve** the genuinely-useful existing technical content (the
CC-faithful "bridges", and the notes on `env`-replaces-subprocess / `bypassPermissions` contract /
`settingSources` default) — only de-Phase-frame and correct it. New outline:

1. **Title + tagline** — `# cc-harness`, one line: a headless TypeScript library wrapping the Claude Agent
   SDK with Claude Code-faithful defaults, exposing CC's harness capabilities (one-shot runs, interactive
   sessions, a multi-session daemon, hooks, swarm, durable tasks) as a library + CLI.
2. **What it is / why** — the SDK *is* CC's engine; the harness configures+verifies it CC-faithfully and
   surfaces capabilities the bare SDK doesn't expose as a library. Link `docs/parity/coverage.md` (the
   capability scorecard) and `API-STABILITY.md` (per-export stability tiers).
3. **Install** — in-repo today (`cd CC-to-SDK/harness && npm install && npm run build`); note it's
   `private:true` (not yet on npm). Node **≥18**. Auth via `ANTHROPIC_API_KEY` (or a provider flag); local
   key from `CC-to-SDK/.env`.
4. **Quickstart** — the minimal one-shot (`createHarness(...).run(...)`).
5. **Core surfaces (the tour)** — one subsection each, with ONE minimal, correct example using only public
   exports: (a) one-shot harness (`createHarness` run/stream); (b) interactive `Session`
   (`openSession`/`resumeSession` — multi-turn `submit`/`stream`, `compact`, `rewind`, `.sessionId`); (c)
   daemon (`DaemonSupervisor` + `DaemonServer` — long-lived multi-session, restart, boot-rehydration via
   `rehydrate`); (d) session read/fork/mutate (`listSessions`/`getSessionMessages`/`forkSession`/
   `renameSession`/`tagSession`/`deleteSession`); (e) hooks (`injectContext`/`guardTool`/`blockTool`/
   `observe`/`mergeHooks`); (f) swarm (`SwarmRuntime`); (g) durable tasks (`taskTools` + `harness.tasks`);
   (h) introspection (`getContextUsage`/`usage`/`initializationResult`/`accountInfo`); (i) config validation
   (`validateHarnessConfig`/`HarnessConfigError`).
6. **`HarnessConfig` reference** — the full refreshed table. Keep the existing rows; **add** the new fields:
   `effort`, `thinking`, `maxBudgetUsd`, `taskBudget`, `includePartialMessages`, `forwardSubagentText`,
   `resume`, `persistSession`, `sessionStore`, `autoCompactEnabled`, `autoCompactWindow`, `taskTools`,
   `swarm`, `contextTool`, `compactTool`, `hooks`; correct `permissionMode` to the 6 modes; mark the
   escape-hatch fields (`extraOptions`/`settings`/`managedSettings`/`customHeaders`) as un-validated.
7. **CLI** — the `cc-harness` bin + flags (refresh; the bin is `dist/cli.js`).
8. **CC-faithful defaults (the bridges)** — the preserved bridges content, de-Phase-framed ("The 16
   Phase-1 bridges" → "CC-faithful defaults"), plus the preserved `env`/`bypassPermissions`/`settingSources`
   notes.
9. **Stability & testing** — link `API-STABILITY.md`; the gate commands (`npm run test:unit` keyless,
   `npm run test:live` gated on `ANTHROPIC_API_KEY`, `npm run typecheck`, `npm run build`).
10. **Where this fits** — replace the Phase narrative with the current framing (the headless harness
    replicating CC's capability; harden-and-ship); link `docs/parity/coverage.md`.

Every code block uses only names from the frozen 44-export public surface (§4.C enforces this).

### 4.B — `package.json` metadata (`harness/package.json`)

Add (do not change existing fields):

```json
"description": "Headless TypeScript harness over the Claude Agent SDK with Claude Code-faithful defaults — one-shot runs, interactive sessions, a multi-session daemon, hooks, swarm, and durable tasks.",
"keywords": ["claude", "claude-code", "claude-agent-sdk", "anthropic", "agent", "llm", "ai", "harness", "headless"],
"license": "Apache-2.0",
"repository": { "type": "git", "url": "git+https://github.com/SSFSKIM/codex_somersault.git", "directory": "CC-to-SDK/harness" },
"homepage": "https://github.com/SSFSKIM/codex_somersault/tree/main/CC-to-SDK/harness#readme"
```

`license` matches the root `LICENSE` (Apache-2.0). No `author` (non-goal 6). `private: true` stays.

### 4.C — README-drift test (`test/unit/readme.test.ts`)

A keyless unit test that keeps the README honest: read `harness/README.md`, find every `import { … } from
"cc-harness"` statement in the fenced code blocks, extract the imported identifiers (handling `type`
imports and multi-name braces), and assert each is an actual export of `src/index.js`. Fails if the README
documents a renamed/removed/typo'd import. (The rewritten README uses the package name `cc-harness` in all
examples — never the in-repo `./src` path — so this single form is sufficient.) Pairs with Task 6's surface
freeze: that guards what's *exported*; this guards what's *documented*.

## §5 — Data flow

N/A (docs). The README's examples consume only the public package barrel (`cc-harness` → `src/index.ts`);
the drift test parses the README and cross-checks against `src/index.js`.

## §6 — Correctness handling

- **Examples must be real:** every documented import is a frozen public export (§4.C enforces); signatures
  match the current types (the author checks each example against `src/index.ts` + the type before writing).
- **No stale framing:** the rewritten README contains no "Phase 1/2/3" framing and no in-repo `./src` import
  in the install/usage path.
- **Facts match source:** Node version (`>=18`), license (`Apache-2.0`), scripts, and deps mirror
  `package.json` exactly.
- **Links resolve:** `API-STABILITY.md`, `docs/parity/coverage.md`, `docs/parity/roadmap.md` all exist.
- If writing an example surfaces a real API rough edge, **surface it** (non-goal 5) — do not patch `src/` in
  this docs sub-project.

## §7 — Testing

- **`test/unit/readme.test.ts`** (keyless): every `cc-harness` import in the README is a real public export
  (the drift gate). Red first against a deliberately-wrong import, then green.
- **`npm run typecheck` + `npm run build`** stay clean (no code change, but the test is TS).
- **`npm run test:unit`** all green (the new test joins the suite).
- **Manual gate (controller):** a `grep` that the README contains no `Phase 1`/`Phase 2`/`Phase 3` framing
  and DOES name each core surface; `package.json` is valid JSON.
- No live test (docs are keyless).

## §8 — Non-goals

See §3 "Out": no per-surface guides, no TSDoc/typedoc, no roadmap rewrite, no publishing, no `src/` change,
no `author` field. Beyond those: the README stays a single file (no split into `docs/`), and the drift test
checks import *names*, not full example execution (running every example would need the network — out of
scope; the type/name check is the pragmatic gate).

# Public-API Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cc-harness`'s README an accurate, complete front door for the frozen 44-export public surface, give `package.json` its publish metadata, and add a unit test that keeps the README's documented imports honest.

**Architecture:** Three independent docs deliverables: (1) `package.json` publish metadata; (2) a self-maintaining README-drift test that cross-checks every `cc-harness` import in the README against the real `src/index.ts` exports; (3) a full README rewrite around the current surface. The drift test (T2) lands before the rewrite (T3) so the gate guards the new content as it's written.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, zod-validated config (already shipped), Node ≥18.

## Global Constraints

Copy these verbatim into every task's working context:

- **Docs-only.** No `src/` change. If a documented example reveals a real API bug, surface it — do not patch `src/` in this sub-project.
- **NO Prettier / no reformat.** Match the surrounding dense hand-style. ESM import specifiers end in `.js` (e.g. `from "../../src/index.js"`).
- **Frozen public surface = the 44 value exports of `src/index.ts`.** Every `cc-harness` import shown in the README must be a real export of `src/index.ts`. The drift test (T2) enforces this.
- **No "Phase 1/2/3" framing anywhere in the rewritten README.** The Phase narrative was abandoned (the reframe: replicate CC's harness capability; harden-and-ship). Grep gate: `grep -niE "phase[ -][123]" harness/README.md` must return nothing.
- **Facts must match `package.json`/source exactly:** Node **`>=18`** (not "≥20"); license **`Apache-2.0`** (matches root `LICENSE`); scripts `test:unit`/`test:live`/`typecheck`/`build`/`cli`/`verify:pack` exist; `zod ^4.0.0` is a direct dependency; git origin is `github.com/SSFSKIM/codex_somersault`.
- **No `author` field** (identity choice, left for the user). **Stays `private: true`** (this prepares the front door; it does not publish).
- **Commit after each task.** No `Co-Authored-By` or attribution lines. Do not push.
- All commands run from `CC-to-SDK/harness/`.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-public-api-docs-design.md`

---

### Task 1: `package.json` publish metadata

**Files:**
- Modify: `CC-to-SDK/harness/package.json`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `license: "Apache-2.0"`, `repository`, `homepage`, `description`, `keywords` on the manifest — facts the README (T3) cites in its Install / Where-this-fits sections.

- [ ] **Step 1: Add the five metadata fields after `"version"`**

Insert this block immediately after the `"version": "0.1.0",` line (npm-conventional ordering: name, version, description, keywords, homepage, repository, license). Do not change any existing field; `private`, `type`, `main`, `bin`, `engines`, `scripts`, `dependencies` stay exactly as they are.

```json
  "description": "Headless TypeScript harness over the Claude Agent SDK with Claude Code-faithful defaults — one-shot runs, interactive sessions, a multi-session daemon, hooks, swarm, and durable tasks.",
  "keywords": ["claude", "claude-code", "claude-agent-sdk", "anthropic", "agent", "llm", "ai", "harness", "headless"],
  "homepage": "https://github.com/SSFSKIM/codex_somersault/tree/main/CC-to-SDK/harness#readme",
  "repository": { "type": "git", "url": "git+https://github.com/SSFSKIM/codex_somersault.git", "directory": "CC-to-SDK/harness" },
  "license": "Apache-2.0",
```

- [ ] **Step 2: Verify the manifest is valid JSON and has every field**

Run:
```bash
node -e "const p=require('./package.json'); for (const k of ['description','keywords','license','repository','homepage']) if (!(k in p)) throw new Error('missing '+k); if (p.license!=='Apache-2.0') throw new Error('license'); if (p.private!==true) throw new Error('private must stay true'); if ('author' in p) throw new Error('no author field'); console.log('package.json OK');"
```
Expected: `package.json OK` (a malformed JSON edit makes `require` throw; a missing field throws the named error).

- [ ] **Step 3: Confirm typecheck still clean (sanity — manifest change is build-neutral)**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/harness/package.json
git commit -m "docs(harness): add package.json publish metadata (license/repo/keywords)"
```

---

### Task 2: README-drift test

**Files:**
- Create: `CC-to-SDK/harness/test/unit/readme.test.ts`

**Interfaces:**
- Consumes: the public barrel `src/index.ts` (read both at runtime via `import * as api` and as source text for `export type {…}` names) and `README.md` (read as text).
- Produces: a keyless unit test that fails if the README documents any `cc-harness` import that is not a real public export. T3's rewrite relies on this gate.

**Why this shape:** value exports are discoverable at runtime (`Object.keys(import * as api)`), but type-only exports are erased at runtime — so the test also parses the `export type { … }` lines from `src/index.ts` *source text* to build the type-name set. Both sides derive from the same `index.ts`, so the gate is self-maintaining (no hand-kept allow-list to rot).

- [ ] **Step 1: Write the failing test**

Create `test/unit/readme.test.ts` exactly:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as api from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessRoot = join(here, "..", "..");           // test/unit -> harness/
const README = readFileSync(join(harnessRoot, "README.md"), "utf8");
const INDEX_SRC = readFileSync(join(harnessRoot, "src", "index.ts"), "utf8");

/** Names imported from a given module specifier, split into value vs type imports.
 *  Handles `import { a, b }`, inline `import { type T, c }`, and `import type { T, U }`. */
function importsFrom(source: string, spec: string): { value: string[]; type: string[] } {
  const value: string[] = []; const type: string[] = [];
  // Match `import [type] { ... } from "<spec>"` (single or multi-line braces).
  const re = new RegExp(`import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+["']${spec}["']`, "g");
  for (const m of source.matchAll(re)) {
    const stmtIsType = Boolean(m[1]);
    for (let raw of m[2].split(",")) {
      raw = raw.trim(); if (!raw) continue;
      raw = raw.split(/\s+as\s+/)[0].trim();           // `Foo as Bar` -> Foo
      let isType = stmtIsType;
      if (raw.startsWith("type ")) { isType = true; raw = raw.slice(5).trim(); }
      if (!raw) continue;
      (isType ? type : value).push(raw);
    }
  }
  return { value, type };
}

/** Type-export names from index.ts source (`export type { ... } from "..."`). */
function exportedTypeNames(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/export\s+type\s+\{([^}]*)\}/g))
    for (let raw of m[1].split(",")) { raw = raw.trim().split(/\s+as\s+/).pop()!.trim(); if (raw) out.add(raw); }
  return out;
}

const valueExports = new Set(Object.keys(api));
const typeExports = exportedTypeNames(INDEX_SRC);

describe("README import-drift gate", () => {
  it("has teeth: a bogus cc-harness import is detected as not-exported", () => {
    const fixture = `
      import { createHarness, totallyNotARealExport } from "cc-harness";
      import type { HarnessConfig } from "cc-harness";
    `;
    const { value, type } = importsFrom(fixture, "cc-harness");
    expect(value).toContain("createHarness");
    expect(value).toContain("totallyNotARealExport");
    expect(type).toContain("HarnessConfig");
    // the gate's verdict on the bogus name:
    expect(valueExports.has("totallyNotARealExport")).toBe(false);
    // the real ones resolve:
    expect(valueExports.has("createHarness")).toBe(true);
    expect(typeExports.has("HarnessConfig")).toBe(true);
  });

  it("every cc-harness import in README.md is a real public export", () => {
    const { value, type } = importsFrom(README, "cc-harness");
    expect(value.length).toBeGreaterThan(0);             // non-vacuous: README must actually use the package
    const allExports = new Set([...valueExports, ...typeExports]);
    const badValue = value.filter((n) => !valueExports.has(n));
    const badType = type.filter((n) => !allExports.has(n));
    expect(badValue, `README imports unknown value(s): ${badValue.join(", ")}`).toEqual([]);
    expect(badType, `README imports unknown type(s): ${badType.join(", ")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test — expect it to FAIL on the second case first time only if the current README has a bad import; otherwise both pass**

Run: `npx vitest run test/unit/readme.test.ts`
Expected: **both tests PASS.** The first test ("has teeth") proves the gate detects a deliberately-wrong import (`totallyNotARealExport`) — this is the durable red-proof the spec calls for. The second test passes because the current README's only `cc-harness` import (`import { createHarness } from "cc-harness"`) is a real export. If the second test instead fails with "README imports unknown value(s): …", the current README already has a stale import name — record it; T3 fixes it.

- [ ] **Step 3: Prove the live gate has teeth against the real file (temporary, not committed)**

Temporarily append a bogus import to `README.md` (e.g. a fenced block `import { notReal } from "cc-harness";`), then:
Run: `npx vitest run test/unit/readme.test.ts -t "every cc-harness import"`
Expected: **FAIL** with `README imports unknown value(s): notReal`.
Then revert the README change (`git checkout README.md`) and re-run — back to PASS. This confirms the gate guards the actual file, not just the fixture.

- [ ] **Step 4: Run the full unit suite to confirm no regression**

Run: `npm run test:unit`
Expected: all green (the new file joins the suite); `npm run typecheck` also clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/test/unit/readme.test.ts
git commit -m "test(harness): README import-drift gate (documented imports must be real exports)"
```

---

### Task 3: README rewrite

**Files:**
- Modify (full replace): `CC-to-SDK/harness/README.md`

**Interfaces:**
- Consumes: the drift gate from Task 2 (every `cc-harness` import below must pass it) and the `package.json` metadata from Task 1 (license/Node facts cited here).
- Produces: the public front door. No downstream task depends on it.

**Authoring rule:** every example below uses ONLY real exports and real signatures (verified against `src/index.ts` and each surface's source while writing this plan). The README is markdown (not compiled), but examples must be faithful so a reader can adapt them. Surfaces named but not given a full example (`guardTool`, `getSessionInfo`, `resumeHarness`, `summarizeUsage`, `createContextMcpServer`, `createCompactMcpServer`, `accountInfo`, `TaskStore`/`createTaskMcpServer`) appear in prose so the completeness gate (each core surface named) is satisfied without bloating the imports.

**Accuracy notes the implementer MUST respect (cross-task knowledge the brief can't carry):**
- `contextTool` is a `HarnessConfig` field; **`compactTool` is NOT** — it lives only on `openSession`'s `OpenSessionConfig`. The config table marks this.
- Introspection methods (`usage()`/`getContextUsage()`/`initializationResult()`/`accountInfo()`) need an **open transport** — they throw after a one-shot `run()` completes. The introspection example uses a live `Session` (transport stays open until `dispose()`), which is correct; do not show them after `harness.run()`.
- The daemon teardown is `await server.close()` then `await supervisor.shutdown()` (server has `.close()`, supervisor has `.shutdown()`).
- `forkSession`/`deleteSession` notes: fork mints a NEW id (original untouched); delete is destructive + irreversible.

- [ ] **Step 1: Replace `README.md` entirely with the content below**

````markdown
# cc-harness

A headless TypeScript library that wraps the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
with **Claude Code-faithful defaults**, exposing Claude Code's harness capabilities — one-shot runs,
interactive sessions, a long-lived multi-session daemon, programmatic hooks, a teammate swarm, and a
durable task list — as a library plus a thin `cc-harness` CLI.

The Agent SDK *is* Claude Code's engine (a bundled native binary), so most CC behavior already exists;
the harness's job is to **configure and verify** the SDK the way CC does by default, and to surface
capabilities the bare SDK doesn't expose as a library. See
[`../docs/parity/coverage.md`](../docs/parity/coverage.md) for the capability scorecard and
[`API-STABILITY.md`](./API-STABILITY.md) for per-export stability tiers.

## Install

```bash
cd CC-to-SDK/harness
npm install
npm run build
```

`cc-harness` is `private: true` — it is **not yet published to npm**; today you consume it in-repo (or via
`npm link`). Requires **Node ≥18**. Authentication uses `ANTHROPIC_API_KEY` (or a provider flag — see the
[`HarnessConfig` reference](#harnessconfig-reference)); for local runs the key is read from
`CC-to-SDK/.env` (gitignored): `set -a; source ../.env; set +a`.

## Quickstart

```ts
import { createHarness } from "cc-harness";

const harness = createHarness({ permissionMode: "bypassPermissions", maxTurns: 4 });
const { result, sessionId } = await harness.run("Explain this repo's layout.");
console.log(result);
```

## Core surfaces

cc-harness is a toolkit, not a single entry point. Each surface below is one import from `cc-harness`.

### One-shot harness — `createHarness`

`createHarness(config, deps?)` returns a `Harness` that drives a single `query()` turn. `run()` collects
the whole turn; `stream()` yields the SDK message stream.

```ts
import { createHarness } from "cc-harness";

const harness = createHarness({ outputStyle: "explanatory", maxTurns: 4 });

const { result, messages, sessionId } = await harness.run("List the open TODOs.");

for await (const message of harness.stream("Now summarize them.")) {
  // render each SDK message…
}
```

`resolveOptions(config)` is exported separately and is **pure** (config → SDK `Options`), so the
CC-faithful bridges are unit-testable without the network. `resumeHarness(sessionId, config?)` continues a
prior session by id.

### Interactive session — `openSession`

`openSession(config, deps?)` opens a long-lived multi-turn `Session`. Each `submit(prompt, onMessage?)`
runs one turn against the same session; `stream(prompt)` is the async-generator form. `.sessionId` is
captured from the first turn's init frame. Dispose when done.

```ts
import { openSession } from "cc-harness";

const session = openSession({ permissionMode: "bypassPermissions" });
await session.submit("Remember the codeword is BLUEBIRD.");
const { result } = await session.submit("What was the codeword?");
console.log(result, session.sessionId);
await session.dispose();
```

`resumeSession(id, config?)` reopens a persisted session by id (preserving its `session_id`). A live
`Session` also exposes `compact()`, `rewind(userMessageId)`, `setModel()`, `setPermissionMode()`, and the
introspection methods below.

### Multi-session daemon — `DaemonSupervisor` / `DaemonServer`

`DaemonSupervisor` owns an in-process pool of long-lived sessions with idle-reaping and crash-restart;
`DaemonServer` exposes it over a Unix-domain-socket NDJSON protocol for out-of-process clients.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor, DaemonServer, daemonSocketPath } from "cc-harness";

const supervisor = new DaemonSupervisor({ query }, { restart: "on-failure", rehydrate: true });
const id = supervisor.spawn({ model: "claude-opus-4-8" });
const { result } = await supervisor.submit(id, "Hello", () => {});

const server = new DaemonServer(supervisor, daemonSocketPath());
await server.listen();
// … out-of-process clients connect via daemonRequest(socketPath, op) …
await server.close();
await supervisor.shutdown();
```

`rehydrate: true` opts into **boot-rehydration**: a fresh supervisor adopts the prior process's
still-resumable sessions and revives each on first access (instead of reaping them). `DaemonOptions` also
cover `restart`/`maxRestarts`/`backoffMs`, `maxSessions`, `idleTimeoutMs`, `sharedTasks`, and
`contextTool`/`compactTool`. Client helpers `daemonRequest(socketPath, op)` and `daemonSocketPath(env?)`
speak the protocol from another process; `DaemonError` is the thrown error type.

### Session store: read, fork, mutate

The SDK persists every transcript under `~/.claude/projects`. These wrappers read and curate that store
(harness `cwd` → SDK `dir`).

```ts
import { listSessions, getSessionMessages, forkSession, renameSession, tagSession, deleteSession } from "cc-harness";

const sessions = await listSessions({ limit: 20 });
const messages = await getSessionMessages(sessions[0].sessionId);

const { sessionId: branch } = await forkSession(sessions[0].sessionId, { title: "experiment" });
await renameSession(branch, "Experiment A");
await tagSession(branch, "wip");
await deleteSession(branch);   // destructive + irreversible
```

`getSessionInfo(id, opts?)` fetches one session's metadata. `forkSession` mints a **new** id (the original
is untouched); reach the branch with `resumeSession(branch)`.

### Hooks — `injectContext` / `blockTool` / `observe`

Programmatic SDK hooks as composable builders. Fold them with `mergeHooks` and pass the result as
`config.hooks`.

```ts
import { createHarness, injectContext, blockTool, observe, mergeHooks } from "cc-harness";

const hooks = mergeHooks(
  injectContext(() => "The current sprint ends Friday."),
  blockTool("Bash", /rm -rf/, "no destructive shell"),
  blockTool("Write", /\.env\b/, "never write secrets"),
  observe("PostToolUse", (input) => console.error("hook:", input.hook_event_name)),
);

const harness = createHarness({ hooks, permissionMode: "default" });
```

`guardTool(matcher, decide)` is the lower-level gate `blockTool` builds on (return `{ block, reason }` to
deny). Only 8 of the SDK's 30 hook events fire headlessly; the builders cover the verified ones
(`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`).

### Swarm — `SwarmRuntime`

A coordinator-plus-teammates runtime over an in-process message bus, sharing one durable task store.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SwarmRuntime } from "cc-harness";

const swarm = new SwarmRuntime({ query }, { cwd: process.cwd() });
swarm.spawnTeammate({ name: "reviewer", teamId: "core", prompt: "Review the diff for bugs." });
// … coordinate via swarm.bus / swarm.tasks …
await swarm.disposeAll();
```

You can also enable it declaratively with `createHarness({ swarm: true })`, which registers the `cc-swarm`
MCP tools. `createSwarmMcpServer` and `SwarmError` are exported for embedding.

### Durable tasks — `taskTools` / `harness.tasks`

Claude Code's durable `Task*` list, which the bare SDK doesn't ship, reproduced as an in-process MCP
server.

```ts
import { createHarness } from "cc-harness";

const harness = createHarness({ taskTools: true });
await harness.run("Use TaskCreate to add 'ship docs', then TaskList.");
const tasks = await harness.tasks!.list();   // same store, programmatic
```

The store is file-backed JSON at `<cwd>/.cc-harness/tasks/<listId>.json`, written atomically and
serialized, with a `pending → in_progress → completed` machine and a `blockedBy` DAG. `TaskStore` and
`createTaskMcpServer` are exported for embedding; `TaskError` is the thrown error type.

### Introspection

A `Harness`, a `Session`, and the daemon expose live introspection. These are SDK **control requests** that
need an open transport — call them while a query/turn is active (they throw after a one-shot `run()`
completes), so the cleanest place is a live `Session`:

```ts
import { openSession } from "cc-harness";

const session = openSession();
await session.submit("Analyze the repo.");           // an active turn opens the transport
const usage = await session.usage();                 // session cost + token totals
const ctx = await session.getContextUsage();         // context-window occupancy
const init = await session.initializationResult();   // models / commands / agents available
await session.dispose();
```

`accountInfo()` returns plan/account metadata. `summarizeUsage(raw)` reduces raw context usage to a
compact summary; `createContextMcpServer` / `createCompactMcpServer` (with `CONTEXT_TOOL` / `COMPACT_TOOL`)
expose context and compaction to the model as MCP tools, wired via `config.contextTool` /
`compactTool`.

### Config validation — `validateHarnessConfig`

Every front door (`createHarness`, `openSession`, `DaemonSupervisor`) validates its config before any side
effect, throwing `HarnessConfigError` on a malformed value. Call it yourself to fail fast:

```ts
import { validateHarnessConfig, HarnessConfigError } from "cc-harness";

try {
  validateHarnessConfig({ maxTurns: -1 });
} catch (e) {
  if (e instanceof HarnessConfigError) console.error(e.message);
}
```

Validation guards constrained fields only (it never transforms); escape hatches
(`extraOptions`/`settings`/`managedSettings`/`customHeaders`) pass through untouched.

## `HarnessConfig` reference

`HarnessConfig` is the friendly config every surface accepts; `resolveOptions(config)` turns it into the
SDK `Options`. Validated fields throw `HarnessConfigError` on bad input; fields marked **un-validated**
pass straight through.

| field | meaning | default |
|---|---|---|
| `cwd`, `model`, `fallbackModel`, `maxTurns` | passthrough to SDK `Options` | SDK defaults |
| `effort` | reasoning effort: `low`/`medium`/`high`/`xhigh`/`max` | SDK default |
| `thinking` | extended-thinking config (`{type:'adaptive'\|'disabled'}` or `{type:'enabled',budgetTokens?}`) | SDK default |
| `maxBudgetUsd` | hard USD ceiling; **exceeding it hard-stops the run (throws or returns empty)** — wrap in try/catch | — |
| `taskBudget` | token-pacing hint `{ total }`; **opus-4-8 only** (sonnet/haiku return 400) | — |
| `includePartialMessages` | emit `stream_event` partial-assistant frames | `false` |
| `forwardSubagentText` | forward nested subagent text/thinking | `false` |
| `settingSources` | which settings layers load (`user`/`project`/`local`) | **all three** (CC-faithful; SDK default is *none*) |
| `settings`, `managedSettings` | inline settings objects (**un-validated**) | — |
| `disableProjectContext` | skip CLAUDE.md/project files → `settingSources: []` | `false` |
| `excludeDynamicSections` | drop git/date dynamic prompt blocks | `false` |
| `outputStyle` | persona; appended to the `claude_code` system prompt | — |
| `appendSystemPrompt` | extra text appended to the system prompt | — |
| `permissionMode` | `default`/`plan`/`acceptEdits`/`auto`/`bypassPermissions`/`dontAsk` | SDK default |
| `allowedTools`, `disallowedTools` | tool allow/deny lists | SDK defaults |
| `toolPreset` | `"claude_code"` (full pool) or `"none"` | `"claude_code"` |
| `toolAliases` | rename tools | — |
| `webFetchDomains` | `{ allow?, deny? }` → `WebFetch(domain:<host>)` rules | — |
| `sandbox` | `true` or `{ enabled?, network?, autoAllowBashIfSandboxed? }` (`network` is the SDK object, not a bool) | off |
| `provider` | `"anthropic"`/`"bedrock"`/`"vertex"`/`"foundry"` → env flag | `"anthropic"` |
| `baseUrl`, `customHeaders` | gateway base URL + headers via env (`customHeaders` **un-validated**) | — |
| `agents` | extra `AgentDefinition`s (override built-ins by key) | — |
| `includeBuiltinAgents` | register `general-purpose`/`Explore`/`Plan` | `true` |
| `enableFileCheckpointing` | enable file checkpoints (for `rewind`) | `true` |
| `resume` | SDK `session_id` to reload prior context | — |
| `persistSession` | persist transcript to disk; `false` = ephemeral | SDK-true |
| `sessionStore` | BYO transcript-mirror backend (advanced passthrough) | — |
| `autoCompactEnabled` | the SDK's native ~167k auto-compaction safety net | SDK-on |
| `autoCompactWindow` | tokens of headroom before auto-compaction | SDK default |
| `taskTools` | enable the durable `Task*` MCP server (`true` or `{ dir?, listId?, agentName? }`) | off |
| `swarm` | enable the teammate swarm (`true` or `{ team?, coordinatorPersona?, tools?, permissions? }`) | off |
| `contextTool` | expose the `cc-context` GetContextUsage tool to the model | off |
| `hooks` | programmatic SDK hooks (`HooksMap`; build with the hook builders + `mergeHooks`) | — |
| `mcpServers`, `plugins` | passthrough to SDK | — |
| `env` | extra environment variables (merged last, spread over `process.env`) | — |
| `extraOptions` | escape hatch merged last into SDK `Options` (**un-validated**) | — |

> `openSession` accepts one extra field beyond `HarnessConfig`: **`compactTool`** (boolean) — expose the
> `cc-compact` RequestCompaction tool to the model. It is session-level, not on the base `HarnessConfig`.

## CLI

```bash
npm run cli -- "Reply with exactly the word OK." --max-turns 1
echo "FILE CONTENT" | npm run cli -- "Summarize the piped text." --max-turns 1
```

The packaged bin is `cc-harness` (`dist/cli.js`). Flags: `--model`, `--output-style`,
`--permission-mode`, `--max-turns`, `--cwd`, `--no-project-context`, `--sandbox`. The CLI defaults to
`permissionMode: bypassPermissions` for headless runs; non-TTY stdin is appended to the prompt.

## CC-faithful defaults (the bridges)

These are the places where the SDK is *not* CC-faithful out of the box; the harness makes the CC choice
(all unit-tested via `resolveOptions`):

- **Settings:** `settingSources` defaults to **all three** (the SDK default is *none*, which would skip
  `CLAUDE.md`); `project` is required for project context.
- **Output style:** `outputStyle` is a **phantom SDK option** (not in `sdk.d.ts` v0.3.178); the harness
  reproduces personas by **appending** to the `claude_code` `systemPrompt` preset.
- **Sandbox:** friendly `sandbox` config → `Options.sandbox`.
- **Provider:** `provider`/`baseUrl`/`customHeaders` → `env` (Bedrock/Vertex/Foundry flags, base URL,
  custom headers).
- **Tools:** `claude_code` tool preset + WebFetch `domain:<host>` allow/deny rules.
- **Agents:** the SDK does **not** auto-ship CC's built-in agents; the harness registers
  `general-purpose`, plus read-only `Explore`/`Plan` (mutation tools disallowed).
- **Checkpointing/rewind:** `enableFileCheckpointing` on by default; `rewind()` → `Query.rewindFiles`.
- **Commands/skills:** loaded from disk via `settingSources` (no extra wiring).
- **CLI stdin:** non-TTY stdin is read and composed into the prompt.

A few SDK sharp edges the harness papers over:

- **`env` replaces the subprocess environment** when set (it is *not* merged with `process.env`). The
  harness spreads `process.env` first, so setting `provider`/`baseUrl`/`customHeaders`/`env` never erases
  `PATH`/`HOME`/`ANTHROPIC_API_KEY`.
- **`bypassPermissions`** requires `allowDangerouslySkipPermissions: true`; `resolveOptions` sets it
  automatically for that mode, so no caller can select the mode without satisfying its contract.
- **`settingSources` default:** `sdk.d.ts` v0.3.178 loads *all* sources when omitted; the harness sets
  `['user','project','local']` explicitly regardless, so it stays CC-faithful across SDK-default drift.

## Stability & testing

```bash
npm run test:unit    # fast, no network
npm run test:live    # real SDK calls; needs ANTHROPIC_API_KEY (auto-skips without it)
npm run typecheck    # tsc --noEmit
npm run build        # tsc -p tsconfig.build.json → dist/
```

Unit tests are deterministic and dependency-injected (a fake `query`, no network); live tests exercise the
real SDK and auto-skip without `ANTHROPIC_API_KEY`. See [`API-STABILITY.md`](./API-STABILITY.md) for
per-export tiers (`stable` / `experimental` / `advanced-seam`).

## Where this fits

cc-harness is the CC→SDK program's **headless harness**: it replicates Claude Code's harness capabilities
on top of the Agent SDK as a library + CLI. See [`../docs/parity/coverage.md`](../docs/parity/coverage.md)
for the capability scorecard (what's built vs. reachable vs. out-of-reach) and
[`../docs/parity/roadmap.md`](../docs/parity/roadmap.md) for direction. Licensed Apache-2.0.
````

- [ ] **Step 2: Run the drift gate against the new README**

Run: `npx vitest run test/unit/readme.test.ts`
Expected: **both tests PASS.** The "every cc-harness import" test now validates all the imports across the rewrite (createHarness, resolveOptions, openSession, resumeSession, DaemonSupervisor, DaemonServer, daemonSocketPath, listSessions, getSessionMessages, forkSession, renameSession, tagSession, deleteSession, injectContext, blockTool, observe, mergeHooks, SwarmRuntime, validateHarnessConfig, HarnessConfigError). If it fails with "README imports unknown value(s): X", X is a typo or a non-export — fix the README import, do not weaken the test.

- [ ] **Step 3: Run the no-Phase-framing grep gate**

Run: `grep -niE "phase[ -][123]" README.md`
Expected: **no output** (exit 1). If any line matches, de-Phase-frame it.

- [ ] **Step 4: Confirm each core surface is named (completeness gate)**

Run:
```bash
for s in createHarness openSession DaemonSupervisor listSessions injectContext SwarmRuntime taskTools getContextUsage validateHarnessConfig; do grep -q "$s" README.md && echo "ok $s" || echo "MISSING $s"; done
```
Expected: nine `ok …` lines, zero `MISSING`.

- [ ] **Step 5: Confirm links resolve**

Run:
```bash
for f in ../docs/parity/coverage.md ../docs/parity/roadmap.md API-STABILITY.md; do test -e "$f" && echo "ok $f" || echo "MISSING $f"; done
```
Expected: three `ok …` lines.

- [ ] **Step 6: Full keyless gates clean**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected: all green (no `src/` change, but the drift test is TS and the build proves the public `.d.ts` still resolve).

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/README.md
git commit -m "docs(harness): rewrite README around the frozen 44-export surface"
```

---

## Self-Review (controller, before dispatch)

**Spec coverage:** §4.A README rewrite → Task 3 (10-section outline, full table, bridges preserved + de-Phase-framed). §4.B package.json metadata → Task 1. §4.C drift test → Task 2. §7 testing (drift red→green, typecheck/build, grep gate, surface-named) → Task 2 Steps 2-3 + Task 3 Steps 2-6. All spec sections map to a task.

**Placeholder scan:** every code/markdown block is complete; no TBD/TODO; the full README is inlined.

**Type/name consistency:** every `cc-harness` import in the README (Task 3) is a real `src/index.ts` export, and the drift test (Task 2) enforces exactly that set. The accuracy notes (contextTool-yes/compactTool-no, introspection-needs-open-transport, server.close-then-supervisor.shutdown) match the source read while writing this plan.

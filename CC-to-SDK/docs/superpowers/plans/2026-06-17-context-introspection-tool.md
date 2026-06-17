# Context Introspection Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent (the model inside a `query()` session) a `GetContextUsage` MCP tool so it can check how full its own context window is and self-regulate.

**Architecture:** A new in-process `cc-context` MCP server (mirrors `kairos/brief.ts`: `buildContextTools(holder)` exported for testing + `createContextMcpServer(holder)`). A `QueryHolder` late-binding seam holds the active `Query`, set the moment `query()` returns. A single pure `withContextTool(options, holder)` helper merges the server + its allowlisted tool into SDK options; both consumers — `createHarness` (lib, `contextTool` flag) and `DaemonSession` (daemon, daemon-wide `contextTool` option) — use it. Read-only: the tool reports, it does not act.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178` (`createSdkMcpServer` + `tool`), Vitest, Zod v4 (not needed here — empty tool input).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-17-context-introspection-tool-design.md` is the source of truth. Read it before Task 1.
- **Working dir:** all paths are under `CC-to-SDK/harness/`. Run all commands from there.
- **No Prettier / no reformat.** Match the compact hand-style of the surrounding files (single-line guards, inline `format!`-style, dense imports). Do not reflow existing lines.
- **`contextTool` is a harness-config / daemon-option flag, NOT an SDK Option.** It must never reach `resolveOptions`'s output (which never spreads `config`, so it cannot leak) and must never be passed to `query()` as a top-level option.
- **The model-facing tool id is exactly `mcp__cc-context__GetContextUsage`** (server name `cc-context`, tool name `GetContextUsage`). Export it as `CONTEXT_TOOL`.
- **`withContextTool` never mutates its input** — it returns a copy. It is the single merge path for both consumers (DRY).
- **The tool handler never throws out of the callback** — on missing holder or a throwing `getContextUsage()`, it returns `{ content: [{ type: "text", text: "context usage unavailable" }] }`.
- **Status flag rule (verbatim from spec §3.1):** `approaching-limit` when `isAutoCompactEnabled && typeof autoCompactThreshold === "number" && tokensUsed >= autoCompactThreshold`, OR when `percentUsed >= 80`; otherwise `ok`. `percentUsed` is `Math.round(tokensUsed / maxTokens * 100)` (0 when `maxTokens <= 0`).
- **Commit after each task** to the current branch (`main`). **No `Co-Authored-By` / no attribution lines. Never push, never open a PR.**
- After Rust-free TS changes: `npx tsc --noEmit` (typecheck) must be clean, and `npx vitest run <file>` for the task's tests must pass. Ignore editor/LSP "cannot find module" diagnostics — trust `tsc --noEmit`.
- **Out of scope (do not build):** triggering compaction / exposing `autoCompactEnabled`/`autoCompactWindow` (that is Spec B); a daemon *control op* or control frame for context usage (the harness already has `getContextUsage()` directly via the observability read API — `cc-context` is model-facing only); per-spawn daemon granularity (daemon-wide only); write/mutation, hooks, `forkSession`.

---

## File Structure

**Create:**
- `src/context/server.ts` — the whole `cc-context` subsystem: `summarizeUsage` (pure), `buildContextTools`, `createContextMcpServer`, `withContextTool` merge helper, `CONTEXT_TOOL` constant, and the `RawContextUsage` / `ContextUsageSummary` / `QueryHolder` types.
- `src/context/index.ts` — module barrel re-exporting from `server.ts`.
- `test/unit/context-server.test.ts` — unit tests for the core (pure mapping + handler + server naming + merge helper).
- `test/live/context-tool.test.ts` — gated live end-to-end test.

**Modify:**
- `src/index.ts` — add the public exports (curated, like the `sessions` barrel).
- `src/config/types.ts` — add `contextTool?: boolean` to `HarnessConfig`.
- `src/harness.ts` — wire the lib path (`ctxHolder`, merge via `withContextTool`, late-bind in `start`).
- `src/daemon/session.ts` — add the 5th constructor param, merge, and late-bind.
- `src/daemon/types.ts` — add `contextTool?: boolean` to `DaemonOptions`.
- `src/daemon/supervisor.ts` — store the flag; pass it from `makeSession` to `DaemonSession`.
- `test/unit/harness.test.ts` — assert lib wiring.
- `test/unit/daemon-session.test.ts` — assert DaemonSession merge wiring.
- `test/unit/daemon-supervisor.test.ts` — assert the daemon-wide flag reaches every spawned session.
- `test/unit/index.test.ts` — assert the new public exports exist.

---

### Task 1: `cc-context` core module (pure mapping, tool, server, merge helper)

This is the self-contained heart: zero network, fully unit-testable. Everything else consumes it.

**Files:**
- Create: `src/context/server.ts`
- Create: `src/context/index.ts`
- Create: `test/unit/context-server.test.ts`
- Modify: `src/index.ts`
- Modify: `test/unit/index.test.ts:5-14` (extend the existing public-API assertion)

**Interfaces:**
- Consumes: `createSdkMcpServer`, `tool` from `@anthropic-ai/claude-agent-sdk`.
- Produces (later tasks rely on these exact names/types):
  - `const CONTEXT_TOOL = "mcp__cc-context__GetContextUsage"`
  - `interface RawContextUsage { totalTokens?: number; maxTokens?: number; autoCompactThreshold?: number; isAutoCompactEnabled?: boolean }`
  - `interface ContextUsageSummary { percentUsed: number; tokensUsed: number; maxTokens: number; tokensRemaining: number; status: "ok" | "approaching-limit" }`
  - `interface QueryHolder { query?: { getContextUsage(): Promise<RawContextUsage> } }`
  - `function summarizeUsage(raw: RawContextUsage): ContextUsageSummary`
  - `function buildContextTools(holder: QueryHolder)` — array of `{ name, handler }` tool objects
  - `function createContextMcpServer(holder: QueryHolder)` — SDK MCP server `{ type: "sdk", name: "cc-context", ... }`
  - `function withContextTool(options: Record<string, unknown>, holder: QueryHolder): Record<string, unknown>` — copy of `options` with `mcpServers["cc-context"]` + `allowedTools` (deduped) merged in; never mutates input.

- [ ] **Step 1: Write the failing unit test**

Create `test/unit/context-server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  summarizeUsage, buildContextTools, createContextMcpServer, withContextTool, CONTEXT_TOOL,
} from "../../src/context/server.js";

function tools(holder: any) { const m: Record<string, any> = {}; for (const t of buildContextTools(holder)) m[t.name] = t; return m; }

describe("summarizeUsage", () => {
  it("ok case: well under every threshold", () => {
    expect(summarizeUsage({ totalTokens: 40000, maxTokens: 200000 })).toEqual({
      percentUsed: 20, tokensUsed: 40000, maxTokens: 200000, tokensRemaining: 160000, status: "ok",
    });
  });
  it("approaching-limit via percentUsed >= 80", () => {
    expect(summarizeUsage({ totalTokens: 160000, maxTokens: 200000 }).status).toBe("approaching-limit");
  });
  it("approaching-limit via the autocompact trigger even when percentUsed < 80", () => {
    const s = summarizeUsage({ totalTokens: 167000, maxTokens: 1_000_000, autoCompactThreshold: 167000, isAutoCompactEnabled: true });
    expect(s.percentUsed).toBe(17);          // 16.7% rounded — well under 80
    expect(s.status).toBe("approaching-limit");
  });
  it("ok when autocompact is enabled but tokens are below the threshold", () => {
    expect(summarizeUsage({ totalTokens: 100000, maxTokens: 1_000_000, autoCompactThreshold: 167000, isAutoCompactEnabled: true }).status).toBe("ok");
  });
  it("maxTokens 0 → percentUsed 0, status ok (no divide-by-zero)", () => {
    expect(summarizeUsage({ totalTokens: 0, maxTokens: 0 })).toEqual({
      percentUsed: 0, tokensUsed: 0, maxTokens: 0, tokensRemaining: 0, status: "ok",
    });
  });
});

describe("buildContextTools", () => {
  it("exposes the GetContextUsage tool", () => {
    expect(Object.keys(tools({}))).toEqual(["GetContextUsage"]);
  });
  it("returns the summarized usage JSON from the holder's live query", async () => {
    const t = tools({ query: { getContextUsage: async () => ({ totalTokens: 26000, maxTokens: 200000 }) } });
    const res = await t.GetContextUsage.handler({}, {});
    expect(JSON.parse(res.content[0].text)).toEqual({
      percentUsed: 13, tokensUsed: 26000, maxTokens: 200000, tokensRemaining: 174000, status: "ok",
    });
  });
  it("returns 'context usage unavailable' when the holder has no query", async () => {
    const t = tools({});
    expect((await t.GetContextUsage.handler({}, {})).content[0].text).toBe("context usage unavailable");
  });
  it("returns 'context usage unavailable' when getContextUsage() throws", async () => {
    const t = tools({ query: { getContextUsage: async () => { throw new Error("boom"); } } });
    expect((await t.GetContextUsage.handler({}, {})).content[0].text).toBe("context usage unavailable");
  });
});

describe("createContextMcpServer", () => {
  it("returns an sdk server named cc-context", () => {
    const srv: any = createContextMcpServer({});
    expect(srv.type).toBe("sdk");
    expect(srv.name).toBe("cc-context");
  });
});

describe("withContextTool", () => {
  it("merges the server + allowed tool into empty options without mutating the input", () => {
    const input: Record<string, unknown> = {};
    const out = withContextTool(input, {});
    expect((out.mcpServers as any)["cc-context"]).toBeTruthy();
    expect(out.allowedTools).toEqual([CONTEXT_TOOL]);
    expect(input).toEqual({});                                  // input untouched
  });
  it("composes with existing mcpServers + allowedTools and dedupes", () => {
    const input: Record<string, unknown> = {
      mcpServers: { "cc-tasks": { type: "sdk" } },
      allowedTools: ["mcp__cc-tasks__TaskList", CONTEXT_TOOL],   // already present → must not duplicate
    };
    const out = withContextTool(input, {});
    expect(Object.keys(out.mcpServers as any).sort()).toEqual(["cc-context", "cc-tasks"]);
    expect(out.allowedTools).toEqual(["mcp__cc-tasks__TaskList", CONTEXT_TOOL]);
    expect((input.mcpServers as any)["cc-context"]).toBeUndefined(); // input untouched
  });
  it("exports the exact tool id", () => {
    expect(CONTEXT_TOOL).toBe("mcp__cc-context__GetContextUsage");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/context-server.test.ts`
Expected: FAIL — `Cannot find module '../../src/context/server.js'`.

- [ ] **Step 3: Implement the core module**

Create `src/context/server.ts`:

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/** The model-facing tool id the harness must allowlist for the agent to call it. */
export const CONTEXT_TOOL = "mcp__cc-context__GetContextUsage";

/** The subset of the SDK getContextUsage() payload this tool needs (it returns ~17 fields). */
export interface RawContextUsage { totalTokens?: number; maxTokens?: number; autoCompactThreshold?: number; isAutoCompactEnabled?: boolean }
export interface ContextUsageSummary { percentUsed: number; tokensUsed: number; maxTokens: number; tokensRemaining: number; status: "ok" | "approaching-limit" }
/** Late-binding seam: built before query() exists; `query` is set to the active Query the moment query() returns. */
export interface QueryHolder { query?: { getContextUsage(): Promise<RawContextUsage> } }

/** Pure mapping — the one piece of real logic. percentUsed is computed from totalTokens/maxTokens directly
 *  (robust; not the ambiguous SDK `percentage` field). `approaching-limit` honors the SDK's OWN autocompact trigger. */
export function summarizeUsage(raw: RawContextUsage): ContextUsageSummary {
  const tokensUsed = raw.totalTokens ?? 0;
  const maxTokens = raw.maxTokens ?? 0;
  const tokensRemaining = Math.max(0, maxTokens - tokensUsed);
  const percentUsed = maxTokens > 0 ? Math.round((tokensUsed / maxTokens) * 100) : 0;
  const nearAutoCompact = !!raw.isAutoCompactEnabled && typeof raw.autoCompactThreshold === "number" && tokensUsed >= raw.autoCompactThreshold;
  const status = nearAutoCompact || percentUsed >= 80 ? "approaching-limit" : "ok";
  return { percentUsed, tokensUsed, maxTokens, tokensRemaining, status };
}

/** Exported for direct handler testing (mirrors kairos/brief.ts buildBriefTools). */
export function buildContextTools(holder: QueryHolder) {
  return [
    tool("GetContextUsage",
      "Report how full your own context window is: tokens used vs max, percent, and a status flag. Use this to decide whether to wrap up, summarize, or hand off before running low.",
      {},
      async () => {
        try {
          const q = holder.query;
          if (!q) return { content: [{ type: "text" as const, text: "context usage unavailable" }] };
          return { content: [{ type: "text" as const, text: JSON.stringify(summarizeUsage(await q.getContextUsage())) }] };
        } catch { return { content: [{ type: "text" as const, text: "context usage unavailable" }] }; }
      }),
  ];
}

/** Wrap a QueryHolder as an in-process SDK MCP server exposing the GetContextUsage tool. */
export function createContextMcpServer(holder: QueryHolder) {
  return createSdkMcpServer({ name: "cc-context", version: "0.1.0", tools: buildContextTools(holder) });
}

/** Return a COPY of `options` with the cc-context server + its allowed tool merged in (deduped).
 *  Never mutates the input — the single merge path shared by createHarness (lib) and DaemonSession (daemon). */
export function withContextTool(options: Record<string, unknown>, holder: QueryHolder): Record<string, unknown> {
  const existing = (options.mcpServers as Record<string, unknown> | undefined) ?? {};
  const allowed = (options.allowedTools as string[] | undefined) ?? [];
  return {
    ...options,
    mcpServers: { ...existing, "cc-context": createContextMcpServer(holder) },
    allowedTools: [...new Set([...allowed, CONTEXT_TOOL])],
  };
}
```

Create `src/context/index.ts`:

```ts
export { summarizeUsage, buildContextTools, createContextMcpServer, withContextTool, CONTEXT_TOOL } from "./server.js";
export type { RawContextUsage, ContextUsageSummary, QueryHolder } from "./server.js";
```

- [ ] **Step 4: Add the curated public exports**

In `src/index.ts`, append after the `sessions` exports (line 17):

```ts
export { createContextMcpServer, summarizeUsage, CONTEXT_TOOL } from "./context/index.js";
export type { RawContextUsage, ContextUsageSummary, QueryHolder } from "./context/index.js";
```

In `test/unit/index.test.ts`, add two assertions inside the existing `it(...)` body (after line 13):

```ts
    expect(typeof api.createContextMcpServer).toBe("function");
    expect(typeof api.summarizeUsage).toBe("function");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/context-server.test.ts test/unit/index.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean). Ignore any editor "cannot find module" warnings — trust this.

- [ ] **Step 7: Commit**

```bash
git add src/context test/unit/context-server.test.ts src/index.ts test/unit/index.test.ts
git commit -m "feat(context): cc-context MCP server + summarizeUsage + withContextTool"
```

---

### Task 2: Lib wiring — `createHarness({ contextTool })`

Wire the `contextTool` flag through `HarnessConfig` → `createHarness` so the lib path mounts the server, allowlists the tool, and late-binds the holder to the active query.

**Files:**
- Modify: `src/config/types.ts:45` (add field after the `swarm` line)
- Modify: `src/harness.ts` (import, `ctxHolder` declaration, merge block, `start` late-bind)
- Modify: `test/unit/harness.test.ts`

**Interfaces:**
- Consumes (from Task 1): `withContextTool`, `CONTEXT_TOOL`, and the `QueryHolder` / `RawContextUsage` types from `./context/server.js`.
- Produces: `HarnessConfig.contextTool?: boolean`; a `createHarness` that, when the flag is set, has `options.mcpServers["cc-context"]` and `options.allowedTools` ∋ `CONTEXT_TOOL`.

- [ ] **Step 1: Write the failing test**

In `test/unit/harness.test.ts`, add these tests inside the `describe("createHarness", ...)` block (the existing `fakeQuery` already defines `getContextUsage`):

```ts
  it("contextTool mounts the cc-context server and allowlists its tool", () => {
    const h = createHarness({ contextTool: true }, { query: fakeQuery });
    expect((h.options as any).mcpServers["cc-context"]).toBeTruthy();
    expect((h.options as any).allowedTools).toContain("mcp__cc-context__GetContextUsage");
  });
  it("without contextTool there is no cc-context server", () => {
    const h = createHarness({}, { query: fakeQuery });
    expect((h.options as any).mcpServers?.["cc-context"]).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/harness.test.ts`
Expected: FAIL — `mcpServers` is undefined (no wiring yet) on the first new test.

- [ ] **Step 3: Add the config field**

In `src/config/types.ts`, immediately after the `swarm?: ...` line (line 45), add:

```ts
  // context introspection (domain 6, agent-facing): expose a GetContextUsage MCP tool to the model
  contextTool?: boolean;
```

- [ ] **Step 4: Wire `createHarness`**

In `src/harness.ts`:

(a) Add the import after the existing coordinator import (line 8):

```ts
import { withContextTool, type QueryHolder, type RawContextUsage } from "./context/server.js";
```

(b) Add a `ctxHolder` declaration alongside `let tasks` / `let swarm` (after line 33):

```ts
  let ctxHolder: QueryHolder | undefined;
```

(c) After the `if (config.taskTools) { ... }` block closes (after line 53), add:

```ts
  if (config.contextTool) {
    ctxHolder = {};
    const merged = withContextTool(options, ctxHolder);
    options.mcpServers = merged.mcpServers;
    options.allowedTools = merged.allowedTools;
  }
```

(d) Late-bind in `start` (replace the existing `start` body, lines 61-64):

```ts
  function start(prompt: string) {
    active = query({ prompt, options: options as any });
    if (ctxHolder) ctxHolder.query = active as { getContextUsage(): Promise<RawContextUsage> };
    return active;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/harness.test.ts`
Expected: PASS (including the two new tests and the existing `getContextUsage`/`run`/`stream` tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/harness.ts test/unit/harness.test.ts
git commit -m "feat(context): createHarness contextTool flag + late-bind"
```

---

### Task 3: Daemon wiring — daemon-wide `contextTool`

Add a 5th `DaemonSession` constructor param that merges the server + late-binds the holder to the session's underlying `Query`; expose it as a daemon-wide `DaemonOptions.contextTool` that the supervisor threads through `makeSession` to every spawned session (mirrors `sharedTasks`).

**Files:**
- Modify: `src/daemon/session.ts` (import, 5th param, merge, late-bind)
- Modify: `src/daemon/types.ts:32` (add `contextTool?: boolean` to `DaemonOptions`)
- Modify: `src/daemon/supervisor.ts` (field, constructor read, `makeSession` 5th arg)
- Modify: `test/unit/daemon-session.test.ts`
- Modify: `test/unit/daemon-supervisor.test.ts`

**Interfaces:**
- Consumes (from Task 1): `withContextTool`, `QueryHolder`, `RawContextUsage` from `../context/server.js`.
- Produces: `DaemonSession` constructor signature `(id, deps, options, now?, sessionOpts?: { contextTool?: boolean })`; `DaemonOptions.contextTool?: boolean`; a supervisor that wires `cc-context` into every spawned session when the flag is set.

- [ ] **Step 1: Write the failing tests**

In `test/unit/daemon-session.test.ts`, add a capturing query helper and two tests (the file's existing `fakeQuery` does not capture options):

```ts
function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
}
```

```ts
  it("contextTool (5th ctor arg) merges the cc-context server + allowed tool into options", async () => {
    const sink: any[] = [];
    const s = new DaemonSession("s-ctx", { query: captureQuery(sink) }, {}, Date.now, { contextTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect(sink[0].allowedTools).toContain("mcp__cc-context__GetContextUsage");
    await s.dispose();
  });
  it("no contextTool → options reach the query untouched (no cc-context)", async () => {
    const sink: any[] = [];
    const s = new DaemonSession("s-plain", { query: captureQuery(sink) }, {});
    expect(sink[0].mcpServers).toBeUndefined();
    await s.dispose();
  });
```

In `test/unit/daemon-supervisor.test.ts`, add one test inside `describe("DaemonSupervisor", ...)` (the file already defines `captureQuery(sink)` and `dir()`):

```ts
  it("contextTool option wires cc-context into every spawned session", async () => {
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(sink) }, { dir: dir(), contextTool: true });
    sup.spawn();
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect(sink[0].allowedTools).toContain("mcp__cc-context__GetContextUsage");
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/daemon-session.test.ts test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `mcpServers` undefined (no wiring); supervisor rejects/ignores `contextTool` (no such option).

- [ ] **Step 3: Wire `DaemonSession`**

In `src/daemon/session.ts`:

(a) Add the import after the existing `ControllableSession` import (line 4):

```ts
import { withContextTool, type QueryHolder, type RawContextUsage } from "../context/server.js";
```

(b) Replace the constructor (lines 24-30) with the 5th-param version:

```ts
  constructor(
    id: string,
    deps: DaemonSessionDeps,
    options: Record<string, unknown>,
    private now: () => number = Date.now,
    sessionOpts: { contextTool?: boolean } = {},
  ) {
    this.id = id;
    this.lastActiveAt = now();
    let opts = options;
    let ctxHolder: QueryHolder | undefined;
    if (sessionOpts.contextTool) { ctxHolder = {}; opts = withContextTool(options, ctxHolder); }
    this.q = deps.query({ prompt: this.input, options: opts });
    if (ctxHolder) ctxHolder.query = this.q as { getContextUsage(): Promise<RawContextUsage> };
    // A dead/errored query must not reject teardown (dispose awaits this).
    this.done = this.readLoop().catch(() => {});
  }
```

- [ ] **Step 4: Add the `DaemonOptions` field**

In `src/daemon/types.ts`, add to the `DaemonOptions` interface after the `sharedTasks` line (line 32):

```ts
  contextTool?: boolean;   // daemon-wide: expose the cc-context GetContextUsage tool to every session's agent (D6)
```

- [ ] **Step 5: Wire the supervisor**

In `src/daemon/supervisor.ts`:

(a) Add a field alongside the other private fields (after the `sessionOptions?` field, line 46):

```ts
  private contextTool: boolean;
```

(b) In the constructor, read it (add near the other `opts.*` reads, e.g. after line 53 `this.restartPolicy = ...`):

```ts
    this.contextTool = opts.contextTool ?? false;
```

(c) In `makeSession`, pass it as the 5th `DaemonSession` arg (replace line 209):

```ts
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now, { contextTool: this.contextTool });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/unit/daemon-session.test.ts test/unit/daemon-supervisor.test.ts`
Expected: PASS (new tests green; all existing daemon-session / supervisor tests still green).

- [ ] **Step 7: Typecheck + the touched-module test sweep**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run test/unit`
Expected: PASS (whole unit suite — confirms no regression from the shared `withContextTool` import or the constructor change).

- [ ] **Step 8: Commit**

```bash
git add src/daemon/session.ts src/daemon/types.ts src/daemon/supervisor.ts test/unit/daemon-session.test.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(context): daemon-wide contextTool option wires cc-context per session"
```

---

### Task 4: Live end-to-end test

Prove the whole path against the real SDK: a `createHarness({ contextTool: true })` run where the model calls `GetContextUsage`, and the tool result carries a numeric `percentUsed`. Gated on `ANTHROPIC_API_KEY` (skips cleanly without it), `try/finally` teardown — mirrors `test/live/observability.test.ts`.

**Files:**
- Create: `test/live/context-tool.test.ts`

**Interfaces:**
- Consumes: `createHarness` from `../../src/index.js`.

- [ ] **Step 1: Write the live test**

Create `test/live/context-tool.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live context introspection tool (real SDK)", () => {
  it("the model calls GetContextUsage and the tool returns a numeric percentUsed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-context-live-"));
    try {
      const h = createHarness({ model: MODEL, permissionMode: "auto", cwd, contextTool: true });
      let toolText: string | undefined;
      for await (const m of h.stream(
        "Call the GetContextUsage tool to check how full your context window is, then tell me the percentUsed value. Do not do anything else.",
      )) {
        const mm = m as any;
        // The cc-context tool result comes back as a user message carrying a tool_result block.
        if (mm.type === "user" && Array.isArray(mm.message?.content)) {
          for (const block of mm.message.content) {
            if (block?.type === "tool_result") {
              const c = block.content;
              const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => x?.text ?? "").join("") : "";
              if (text.includes("percentUsed")) toolText = text;
            }
          }
        }
      }
      expect(toolText).toBeTruthy();
      const parsed = JSON.parse(toolText!);
      expect(typeof parsed.percentUsed).toBe("number");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips without a key**

Run (no key in env): `npx vitest run test/live/context-tool.test.ts`
Expected: the suite is SKIPPED (0 failures) — confirms the gate.

- [ ] **Step 3: Run it live**

Load the key from the gitignored `CC-to-SDK/.env`, then run:

```bash
set -a; . ../.env; set +a
npx vitest run test/live/context-tool.test.ts
```

Expected: PASS — `toolText` captured, `parsed.percentUsed` is a number. (Never print or commit the key.)

> If the model phrases its call differently and the `tool_result` capture misses, widen the capture to also scan assistant `tool_use` echoes, but keep the assertion on a parsed numeric `percentUsed`. Do not weaken the assertion to a substring match.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add test/live/context-tool.test.ts
git commit -m "test(context): live GetContextUsage end-to-end (gated)"
```

---

## Self-Review (completed before handoff)

**Spec coverage** (against `2026-06-17-context-introspection-tool-design.md`):
- §3.1 `server.ts` (summarizeUsage / buildContextTools / createContextMcpServer / QueryHolder) → Task 1. The `withContextTool` merge helper is an added DRY seam (the spec described the merge inline in both §3.2 and §3.3); it is pure, never mutates, and unit-tested — it satisfies both consumers from one tested path.
- §3.2 lib wiring (`HarnessConfig.contextTool`, mcpServers + allowedTools merge, `start` late-bind) → Task 2.
- §3.3 daemon wiring (5th `DaemonSession` param, `DaemonOptions.contextTool`, supervisor `makeSession`) → Task 3.
- §5 error handling (handler never throws; "context usage unavailable") → Task 1 Step 1 (two negative tests).
- §6 testing (summarizeUsage cases, handler cases, createHarness wiring, DaemonSession wiring, gated live) → Tasks 1-4.
- §8 non-goals (no compaction, no daemon control op/frame for usage, report-only) → enforced by Global Constraints; no task touches `daemon/server.ts`, `bridge/`, or compaction config.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `CONTEXT_TOOL`, `QueryHolder`, `RawContextUsage`, `withContextTool`, `summarizeUsage` names are identical across Tasks 1-3. The `DaemonSession` 5th param `sessionOpts: { contextTool?: boolean }` matches the supervisor's `{ contextTool: this.contextTool }` call site.

**Scope:** single cohesive subsystem (one new module + thin wiring at two consumers + tests) — one plan.

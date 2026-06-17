# Self-Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the harness explicit/earlier compaction on top of the SDK's native auto-compaction: config knobs (all paths) + a daemon on-demand `compact()` + an opt-in agent-facing tool that fires `/compact` at the turn boundary.

**Architecture:** A new `cc-compact` MCP module mirrors the just-shipped `cc-context`. The core primitive `DaemonSession.compact()` injects `/compact` as a streaming-input turn (verified to terminate with `type:"result"`) through a shared `enqueueTurn` helper, then parses the `status`/`compact_boundary` frames into a `CompactOutcome`. On-demand compaction is **daemon-only** (one-shot `createHarness` has no input queue); the lib gets the config knobs only.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178` (`createSdkMcpServer` + `tool`), Vitest, Zod v4.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-17-self-compaction-design.md` is the source of truth. Read it before Task 1.
- **Working dir:** all paths are under `CC-to-SDK/harness/`. Run all `npm`/`npx`/`vitest`/`tsc` from there. `git` works anywhere in the repo.
- **No Prettier / no reformatting.** Match the compact hand-style of the surrounding files (`src/context/server.ts`, `src/daemon/session.ts`). Do not reflow existing lines.
- **The model-facing tool id is exactly `mcp__cc-compact__RequestCompaction`** (server `cc-compact`, tool `RequestCompaction`). Export it as `COMPACT_TOOL`.
- **`parseCompactOutcome` rule (verbatim):** scan frames; a `subtype:"status"` with a truthy `compact_result` sets `result` (+ `error` from `compact_error`); a `subtype:"compact_boundary"` sets `preTokens`/`postTokens` from `compact_metadata.pre_tokens`/`post_tokens`. Return `{ ok: result === "success", result, error, preTokens, postTokens }` (all five keys always present).
- **`withCompactTool` never mutates its input** — returns a copy; dedupes `allowedTools` (union, no duplicate `COMPACT_TOOL`).
- **`compact()` reuses the FIFO waiter machinery** via a shared private `enqueueTurn` — the injected `/compact` gets its own waiter so its `result` never mis-resolves a human turn's `submit()`.
- **The agent-tool auto-trigger is fire-and-forget** (`void this.compact().catch(() => {})`) so the requesting turn returns immediately; it fires only when the intent flag is set, and the flag is cleared on fire (exactly one `/compact` per request).
- **Daemon op response nests the outcome:** `{ ok: true, outcome: <CompactOutcome> }` — the outcome's own `ok` must NOT collide with the op-envelope `ok`.
- **On-demand compaction is daemon-only.** Do NOT attempt to wire `compact()` or the agent tool into one-shot `createHarness`. The lib gets only the config fields (which flow through `options.settings`).
- **`autoCompactEnabled`/`autoCompactWindow` are SDK `Settings` fields** → they belong in `options.settings`, merged so an explicit `config.settings` still composes; never top-level Options.
- Commit after each task to `main`. **NO `Co-Authored-By` / no attribution. Never push, never open a PR.**
- After each task: `npx tsc --noEmit` clean + the task's `npx vitest run <files>` green. Ignore editor/LSP "cannot find module"/"property does not exist" noise — trust the actual `tsc`/`vitest` output.

---

## File Structure

**Create:**
- `src/compaction/server.ts` — the whole `cc-compact` subsystem: `parseCompactOutcome` (pure), `buildCompactTools`, `createCompactMcpServer`, `withCompactTool`, `COMPACT_TOOL`, types `CompactHolder`/`CompactOutcome`.
- `src/compaction/index.ts` — module barrel.
- `test/unit/compaction-server.test.ts` — unit tests for the core.
- `test/live/compaction.test.ts` — gated deterministic live test (explicit `compact()`).

**Modify:**
- `src/index.ts` — curated public exports.
- `src/config/types.ts` — `autoCompactEnabled?`/`autoCompactWindow?`.
- `src/config/settings.ts` — `mergeAutoCompact` folds them into `options.settings`.
- `src/daemon/session.ts` — `enqueueTurn` refactor, `compact()`, intent flag + `readLoop` trigger, 5th-param `compactTool` wiring.
- `src/daemon/types.ts` — `compactOp` + `DaemonOptions.compactTool`.
- `src/daemon/supervisor.ts` — `compactTool` field, `makeSession` arg, `compact(id)`.
- `src/daemon/server.ts` — `compact` op dispatch.
- `test/unit/compaction-server.test.ts`, `test/unit/settings.test.ts`, `test/unit/daemon-session.test.ts`, `test/unit/daemon-supervisor.test.ts`, `test/unit/daemon-types.test.ts`, `test/unit/index.test.ts`.

---

### Task 1: `cc-compact` core module

Self-contained, zero-network. Everything else consumes it. Mirrors `src/context/server.ts`.

**Files:**
- Create: `src/compaction/server.ts`, `src/compaction/index.ts`, `test/unit/compaction-server.test.ts`
- Modify: `src/index.ts`, `test/unit/index.test.ts:5-15` (extend the public-API assertion)

**Interfaces:**
- Consumes: `createSdkMcpServer`, `tool` from `@anthropic-ai/claude-agent-sdk`.
- Produces (later tasks rely on these exact names):
  - `const COMPACT_TOOL = "mcp__cc-compact__RequestCompaction"`
  - `interface CompactHolder { request?: () => void }`
  - `interface CompactOutcome { ok: boolean; result?: "success" | "failed"; error?: string; preTokens?: number; postTokens?: number }`
  - `function parseCompactOutcome(frames: unknown[]): CompactOutcome`
  - `function buildCompactTools(holder: CompactHolder)` — array of `{ name, handler }`
  - `function createCompactMcpServer(holder: CompactHolder)` — `{ type:"sdk", name:"cc-compact", ... }`
  - `function withCompactTool(options: Record<string, unknown>, holder: CompactHolder): Record<string, unknown>`

- [ ] **Step 1: Write the failing unit test**

Create `test/unit/compaction-server.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCompactOutcome, buildCompactTools, createCompactMcpServer, withCompactTool, COMPACT_TOOL } from "../../src/compaction/server.js";

function tools(holder: any) { const m: Record<string, any> = {}; for (const t of buildCompactTools(holder)) m[t.name] = t; return m; }

describe("parseCompactOutcome", () => {
  it("success: status compact_result + boundary tokens", () => {
    expect(parseCompactOutcome([
      { type: "system", subtype: "status", status: "compacting" },
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 31590, post_tokens: 5664 } },
      { type: "system", subtype: "status", status: null, compact_result: "success" },
    ])).toEqual({ ok: true, result: "success", error: undefined, preTokens: 31590, postTokens: 5664 });
  });
  it("failed: status compact_result + error, no boundary", () => {
    expect(parseCompactOutcome([
      { type: "system", subtype: "status", status: null, compact_result: "failed", compact_error: "Not enough messages to compact." },
    ])).toEqual({ ok: false, result: "failed", error: "Not enough messages to compact.", preTokens: undefined, postTokens: undefined });
  });
  it("empty frames → ok false, nothing set", () => {
    expect(parseCompactOutcome([])).toEqual({ ok: false, result: undefined, error: undefined, preTokens: undefined, postTokens: undefined });
  });
});

describe("buildCompactTools", () => {
  it("exposes the RequestCompaction tool", () => { expect(Object.keys(tools({}))).toEqual(["RequestCompaction"]); });
  it("calls holder.request and returns the confirmation", async () => {
    let n = 0; const t = tools({ request: () => { n++; } });
    const res = await t.RequestCompaction.handler({}, {});
    expect(n).toBe(1);
    expect(res.content[0].text).toBe("compaction scheduled for the end of this turn");
  });
  it("is safe when holder.request is unset", async () => {
    const t = tools({});
    expect((await t.RequestCompaction.handler({}, {})).content[0].text).toBe("compaction scheduled for the end of this turn");
  });
});

describe("createCompactMcpServer", () => {
  it("returns an sdk server named cc-compact", () => {
    const srv: any = createCompactMcpServer({});
    expect(srv.type).toBe("sdk"); expect(srv.name).toBe("cc-compact");
  });
});

describe("withCompactTool", () => {
  it("merges server + allowed tool into empty options without mutating input", () => {
    const input: Record<string, unknown> = {};
    const out = withCompactTool(input, {});
    expect((out.mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(out.allowedTools).toEqual([COMPACT_TOOL]);
    expect(input).toEqual({});
  });
  it("composes with existing servers/tools and dedupes", () => {
    const input: Record<string, unknown> = { mcpServers: { "cc-context": { type: "sdk" } }, allowedTools: ["x", COMPACT_TOOL] };
    const out = withCompactTool(input, {});
    expect(Object.keys(out.mcpServers as any).sort()).toEqual(["cc-compact", "cc-context"]);
    expect(out.allowedTools).toEqual(["x", COMPACT_TOOL]);
    expect((input.mcpServers as any)["cc-compact"]).toBeUndefined();
  });
  it("exports the exact tool id", () => { expect(COMPACT_TOOL).toBe("mcp__cc-compact__RequestCompaction"); });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/compaction-server.test.ts`
Expected: FAIL — `Cannot find module '../../src/compaction/server.js'`.

- [ ] **Step 3: Implement the core module**

Create `src/compaction/server.ts`:

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/** The model-facing tool id the harness must allowlist for the agent to call it. */
export const COMPACT_TOOL = "mcp__cc-compact__RequestCompaction";

/** Late-binding seam: the daemon sets `request` to the session's requestCompaction() after query() starts. */
export interface CompactHolder { request?: () => void }
export interface CompactOutcome { ok: boolean; result?: "success" | "failed"; error?: string; preTokens?: number; postTokens?: number }

/** Pure — scan the collected `/compact` status/boundary frames into a structured outcome. */
export function parseCompactOutcome(frames: unknown[]): CompactOutcome {
  let result: "success" | "failed" | undefined, error: string | undefined, preTokens: number | undefined, postTokens: number | undefined;
  for (const f of frames as any[]) {
    if (f.subtype === "status" && f.compact_result) { result = f.compact_result; error = f.compact_error; }
    if (f.subtype === "compact_boundary") { preTokens = f.compact_metadata?.pre_tokens; postTokens = f.compact_metadata?.post_tokens; }
  }
  return { ok: result === "success", result, error, preTokens, postTokens };
}

/** Exported for direct handler testing (mirrors context/server.ts buildContextTools). */
export function buildCompactTools(holder: CompactHolder) {
  return [
    tool("RequestCompaction",
      "Schedule a context compaction to run at the end of THIS turn (after you finish responding). Call this when your context window is getting full and you want to free space before continuing.",
      {},
      async () => { holder.request?.(); return { content: [{ type: "text" as const, text: "compaction scheduled for the end of this turn" }] }; }),
  ];
}

/** Wrap a CompactHolder as an in-process SDK MCP server exposing the RequestCompaction tool. */
export function createCompactMcpServer(holder: CompactHolder) {
  return createSdkMcpServer({ name: "cc-compact", version: "0.1.0", tools: buildCompactTools(holder) });
}

/** COPY of options with the cc-compact server + its allowed tool merged in (deduped); never mutates input. */
export function withCompactTool(options: Record<string, unknown>, holder: CompactHolder): Record<string, unknown> {
  const existing = (options.mcpServers as Record<string, unknown> | undefined) ?? {};
  const allowed = (options.allowedTools as string[] | undefined) ?? [];
  return { ...options, mcpServers: { ...existing, "cc-compact": createCompactMcpServer(holder) }, allowedTools: [...new Set([...allowed, COMPACT_TOOL])] };
}
```

Create `src/compaction/index.ts`:

```ts
export { parseCompactOutcome, buildCompactTools, createCompactMcpServer, withCompactTool, COMPACT_TOOL } from "./server.js";
export type { CompactHolder, CompactOutcome } from "./server.js";
```

- [ ] **Step 4: Add the curated public exports**

In `src/index.ts`, append after the context exports (the `./context/index.js` lines):

```ts
export { createCompactMcpServer, parseCompactOutcome, COMPACT_TOOL } from "./compaction/index.js";
export type { CompactHolder, CompactOutcome } from "./compaction/index.js";
```

In `test/unit/index.test.ts`, add two assertions inside the existing `it(...)` body (after the `createContextMcpServer`/`summarizeUsage` lines):

```ts
    expect(typeof api.createCompactMcpServer).toBe("function");
    expect(typeof api.parseCompactOutcome).toBe("function");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/compaction-server.test.ts test/unit/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/compaction test/unit/compaction-server.test.ts src/index.ts test/unit/index.test.ts
git commit -m "feat(compaction): cc-compact MCP server + parseCompactOutcome + withCompactTool"
```

---

### Task 2: Config passthrough (`autoCompactEnabled` / `autoCompactWindow`)

Typed `HarnessConfig` fields folded into `options.settings`. Works on every path including one-shot `createHarness`.

**Files:**
- Modify: `src/config/types.ts:41` (add after the `sessionStore` line)
- Modify: `src/config/settings.ts`
- Modify: `test/unit/settings.test.ts`

**Interfaces:**
- Produces: `HarnessConfig.autoCompactEnabled?: boolean`, `HarnessConfig.autoCompactWindow?: number`; `resolveSettings(config).settings` includes them (merged over `config.settings`), or is `undefined` when nothing is set.

- [ ] **Step 1: Write the failing test**

In `test/unit/settings.test.ts`, add (import `resolveSettings` is already at the top of that file):

```ts
  it("folds autoCompactEnabled/autoCompactWindow into settings", () => {
    const s = resolveSettings({ autoCompactEnabled: false, autoCompactWindow: 20000 });
    expect(s.settings).toEqual({ autoCompactEnabled: false, autoCompactWindow: 20000 });
  });
  it("composes the autocompact fields with an explicit settings object", () => {
    const s = resolveSettings({ settings: { foo: 1 }, autoCompactEnabled: true });
    expect(s.settings).toEqual({ foo: 1, autoCompactEnabled: true });
  });
  it("leaves settings undefined when neither settings nor autocompact fields are set", () => {
    expect(resolveSettings({}).settings).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/settings.test.ts`
Expected: FAIL — `s.settings` is `undefined` (autocompact fields not merged yet).

- [ ] **Step 3: Add the config fields**

In `src/config/types.ts`, after the `sessionStore?: SessionStore;` line (line 41), add:

```ts
  // compaction (Spec B): tune/disable the SDK's native auto-compaction (these are SDK Settings fields)
  autoCompactEnabled?: boolean;            // false disables the native ~167k safety net
  autoCompactWindow?: number;              // tokens of headroom before auto-compaction
```

- [ ] **Step 4: Implement `mergeAutoCompact`**

In `src/config/settings.ts`, replace the `settings: config.settings,` line in the returned object with `settings: mergeAutoCompact(config),` and add the helper at the bottom of the file:

```ts
/** Fold the typed autocompact fields into the inline settings object (they are SDK Settings).
 *  Typed fields win on key collision; returns undefined when nothing is set (preserves prior behavior). */
function mergeAutoCompact(config: HarnessConfig): Record<string, unknown> | undefined {
  const base: Record<string, unknown> = config.settings ? { ...config.settings } : {};
  if (config.autoCompactEnabled !== undefined) base.autoCompactEnabled = config.autoCompactEnabled;
  if (config.autoCompactWindow !== undefined) base.autoCompactWindow = config.autoCompactWindow;
  return Object.keys(base).length ? base : undefined;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/settings.test.ts test/unit/resolveOptions.test.ts`
Expected: PASS (settings test green; resolveOptions still green — `options.settings` is set only when non-empty, unchanged for configs without these fields).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/settings.ts test/unit/settings.test.ts
git commit -m "feat(compaction): autoCompactEnabled/autoCompactWindow config passthrough"
```

---

### Task 3: `DaemonSession` — `compact()`, `enqueueTurn`, intent trigger, `compactTool` wiring

The core daemon work. Refactor `submit()` to share `enqueueTurn`; add the `compact()` primitive; add the per-session intent flag consumed at the `readLoop` turn boundary; extend the 5th constructor param with `compactTool`.

**Files:**
- Modify: `src/daemon/session.ts`
- Modify: `test/unit/daemon-session.test.ts`

**Interfaces:**
- Consumes (Task 1): `parseCompactOutcome`, `withCompactTool`, types `CompactHolder`/`CompactOutcome` from `../compaction/server.js`.
- Produces: `DaemonSession.compact(): Promise<CompactOutcome>`; `DaemonSession.requestCompaction(): void`; constructor 5th param `{ contextTool?: boolean; compactTool?: boolean }`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/daemon-session.test.ts`, add a fake query that handles `/compact` plus the new tests:

```ts
// records every turn's content; the "/compact" turn emits status+boundary then a result.
function compactQuery(seen: string[]) {
  return ({ prompt }: any) => (async function* () {
    for await (const t of prompt) {
      const text = t.message.content; seen.push(text);
      if (text === "/compact") {
        yield { type: "system", subtype: "status", status: "compacting" };
        yield { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 1000, post_tokens: 200 } };
        yield { type: "system", subtype: "status", status: null, compact_result: "success" };
        yield { type: "result", subtype: "success", result: "compacted" };
      } else yield { type: "result", subtype: "success", result: "did:" + text };
    }
  })();
}
function captureQuery2(sink: any[]) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })(); };
}
```

```ts
  it("compact() injects /compact and returns the parsed outcome", async () => {
    const seen: string[] = [];
    const s = new DaemonSession("s-c", { query: compactQuery(seen) }, {});
    const outcome = await s.compact();
    expect(outcome).toEqual({ ok: true, result: "success", error: undefined, preTokens: 1000, postTokens: 200 });
    expect(seen).toEqual(["/compact"]);
    await s.dispose();
  });
  it("requestCompaction fires exactly one /compact at the turn boundary; FIFO stays intact", async () => {
    const seen: string[] = [];
    const s = new DaemonSession("s-i", { query: compactQuery(seen) }, {});
    s.requestCompaction();                                  // tool sets intent before the turn
    const r1 = await s.submit("hello", () => {});
    expect(r1.result).toBe("did:hello");                   // human turn gets ITS OWN result, not "compacted"
    const r2 = await s.submit("world", () => {});
    expect(r2.result).toBe("did:world");                   // next human turn NOT mis-resolved by the /compact result
    await s.dispose();
    expect(seen).toEqual(["hello", "/compact", "world"]);  // exactly one /compact, ordered between the two human turns
  });
  it("contextTool + compactTool both merge their servers into the query options", async () => {
    const sink: any[] = [];
    const s = new DaemonSession("s-both", { query: captureQuery2(sink) }, {}, Date.now, { contextTool: true, compactTool: true });
    expect((sink[0].mcpServers as any)["cc-context"]).toBeTruthy();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].allowedTools).toEqual(expect.arrayContaining(["mcp__cc-context__GetContextUsage", "mcp__cc-compact__RequestCompaction"]));
    await s.dispose();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/daemon-session.test.ts`
Expected: FAIL — `s.compact`/`s.requestCompaction` are not functions; `compactTool` not wired.

- [ ] **Step 3: Add the import**

In `src/daemon/session.ts`, after the `withContextTool` import (line 5), add:

```ts
import { withCompactTool, parseCompactOutcome, type CompactHolder, type CompactOutcome } from "../compaction/server.js";
```

- [ ] **Step 4: Extend the constructor (5th param + compose both merges)**

Replace the constructor body region (lines 25-41) with:

```ts
  constructor(
    id: string,
    deps: DaemonSessionDeps,
    options: Record<string, unknown>,
    private now: () => number = Date.now,
    sessionOpts: { contextTool?: boolean; compactTool?: boolean } = {},
  ) {
    this.id = id;
    this.lastActiveAt = now();
    let opts = options;
    let ctxHolder: QueryHolder | undefined;
    let compactHolder: CompactHolder | undefined;
    if (sessionOpts.contextTool) { ctxHolder = {}; opts = withContextTool(opts, ctxHolder); }
    if (sessionOpts.compactTool) { compactHolder = {}; opts = withCompactTool(opts, compactHolder); }
    this.q = deps.query({ prompt: this.input, options: opts });
    if (ctxHolder) ctxHolder.query = this.q as unknown as { getContextUsage(): Promise<RawContextUsage> };
    if (compactHolder) compactHolder.request = () => this.requestCompaction();
    // A dead/errored query must not reject teardown (dispose awaits this).
    this.done = this.readLoop().catch(() => {});
  }
```

(The only change to the contextTool line is `withContextTool(options, …)` → `withContextTool(opts, …)` so the two merges chain; `opts` equals `options` at that point, so contextTool-only behavior is unchanged.)

- [ ] **Step 5: Refactor `submit` to share `enqueueTurn`; add `compact()` + intent**

Replace `submit` (lines 45-51) with the shared helper + thin `submit`, and add `compact()`/`requestCompaction()` right after:

```ts
  /** Push a turn + its waiter onto the FIFO. Shared by submit() and compact() so every injected
   *  turn gets its own waiter (its result resolves ITS waiter, never another turn's). */
  private enqueueTurn(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ onMessage, resolve, reject });
      this.input.push(userTurn(prompt));
    });
  }

  /** Run one turn; non-result messages stream to onMessage; resolves with the turn's result.
   * Rejects immediately if the underlying query has already ended (else the waiter would never drain). */
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    if (this.ended) return Promise.reject(new Error(`session ${this.id} is not running`));
    return this.enqueueTurn(prompt, onMessage);
  }

  /** Inject `/compact` as a turn (its own FIFO waiter) and return the structured outcome. */
  async compact(): Promise<CompactOutcome> {
    this.assertRunning();
    const frames: unknown[] = [];
    await this.enqueueTurn("/compact", (m) => {
      const mm = m as any;
      if (mm.type === "system" && (mm.subtype === "status" || mm.subtype === "compact_boundary")) frames.push(mm);
    });
    return parseCompactOutcome(frames);
  }

  /** Record intent (set by the cc-compact tool); consumed at the next turn boundary in readLoop. */
  requestCompaction(): void { this.compactRequested = true; }
```

Add the field next to `ended` (after line 23):

```ts
  private compactRequested = false; // set by the cc-compact tool; fires one /compact at the next turn boundary
```

- [ ] **Step 6: Add the `readLoop` turn-boundary trigger**

In `readLoop` (lines 88-94), replace the result/else branch with:

```ts
        if ((m as any).type === "result") {
          this.waiters.shift()?.resolve({ result: (m as any).result }); // consume a waiter only if present
          // turn boundary: if the agent requested compaction, fire ONE /compact (own waiter) before the next turn.
          if (this.compactRequested) { this.compactRequested = false; void this.compact().catch(() => {}); }
        } else this.waiters[0]?.onMessage(m);
```

(`compact()` is fire-and-forget: it synchronously enqueues `/compact` + its waiter, so FIFO order is `…human-turn, /compact, next-turn`; the requesting turn's `submit()` has already resolved.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/daemon-session.test.ts test/unit/daemon-session-control.test.ts`
Expected: PASS (new tests green; all existing session tests — submit/dispose/FIFO/contextTool — still green).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/session.ts test/unit/daemon-session.test.ts
git commit -m "feat(compaction): DaemonSession.compact() + turn-boundary self-compaction trigger"
```

---

### Task 4: Daemon op + supervisor + server

Expose `compact()` as a daemon op and the agent tool as a daemon-wide opt-in.

**Files:**
- Modify: `src/daemon/types.ts:45-47` (add `compactOp`; add `DaemonOptions.compactTool`)
- Modify: `src/daemon/supervisor.ts` (field + read + `makeSession` arg + `compact(id)`)
- Modify: `src/daemon/server.ts:71-89` (dispatch)
- Modify: `test/unit/daemon-types.test.ts`, `test/unit/daemon-supervisor.test.ts`

**Interfaces:**
- Consumes (Task 3): `DaemonSession.compact()`; (Task 1) `CompactOutcome`.
- Produces: op `{ op: "compact", id: string }`; `DaemonOptions.compactTool?: boolean`; `DaemonSupervisor.compact(id): Promise<CompactOutcome>`; server reply `{ ok: true, outcome: CompactOutcome }`.

- [ ] **Step 1: Write the failing tests**

In `test/unit/daemon-types.test.ts`, add:

```ts
  it("parses a compact op", () => {
    expect(daemonOp.parse({ op: "compact", id: "sess-1" })).toEqual({ op: "compact", id: "sess-1" });
  });
```

In `test/unit/daemon-supervisor.test.ts`, add (the file already defines `captureQuery`, `dir()`, and a `compactQuery`-style helper is not present — define one inline):

```ts
  it("compact(id) delegates to the session and rejects unknown ids", async () => {
    const seen: string[] = [];
    const cq = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) {
        const text = t.message.content; seen.push(text);
        if (text === "/compact") { yield { type: "system", subtype: "status", status: null, compact_result: "success" }; yield { type: "result", result: "c" }; }
        else yield { type: "result", result: "did:" + text };
      }
    })();
    const sup = new DaemonSupervisor({ query: cq }, { dir: dir() });
    const id = sup.spawn();
    expect(await sup.compact(id)).toEqual({ ok: true, result: "success", error: undefined, preTokens: undefined, postTokens: undefined });
    await expect(sup.compact("ghost")).rejects.toThrow(/unknown session/);
    await sup.shutdown();
  });
  it("compactTool option wires cc-compact into every spawned session", async () => {
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(sink) }, { dir: dir(), compactTool: true });
    sup.spawn();
    expect((sink[0].mcpServers as any)["cc-compact"]).toBeTruthy();
    expect(sink[0].allowedTools).toContain("mcp__cc-compact__RequestCompaction");
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `compact` op not in the union; `sup.compact` not a function; `compactTool` ignored.

- [ ] **Step 3: Add the op + option to `types.ts`**

In `src/daemon/types.ts`, add the op definition next to `messagesOp` (after line 45):

```ts
const compactOp = z.object({ op: z.literal("compact"), id: z.string() });
```

Add `compactOp` to the `daemonOp` discriminated union (line 47), e.g. append it to the array.

Add to `DaemonOptions` (after the `sharedTasks` line, near the `contextTool` added in Spec A):

```ts
  compactTool?: boolean;   // daemon-wide: expose the cc-compact RequestCompaction tool to every session's agent (Spec B)
```

- [ ] **Step 4: Wire the supervisor**

In `src/daemon/supervisor.ts`:

(a) Import the type at the top (near the other imports):

```ts
import type { CompactOutcome } from "../compaction/server.js";
```

(b) Add a field next to `private contextTool: boolean;`:

```ts
  private compactTool: boolean;
```

(c) In the constructor, next to `this.contextTool = opts.contextTool ?? false;`:

```ts
    this.compactTool = opts.compactTool ?? false;
```

(d) In `makeSession`, extend the 5th `DaemonSession` arg to pass both flags:

```ts
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now, { contextTool: this.contextTool, compactTool: this.compactTool });
```

(e) Add the `compact(id)` method next to `control(id, …)` (same guard shape):

```ts
  async compact(id: string): Promise<CompactOutcome> {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    return session.compact();
  }
```

- [ ] **Step 5: Dispatch the op in `server.ts`**

In `src/daemon/server.ts`, add a case in the `switch (op.op)` block (e.g. after the `control` case, line 75):

```ts
        case "compact": send({ ok: true, outcome: await this.supervisor.compact(op.id) }); sock.end(); break;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts test/unit/daemon-server.test.ts`
Expected: PASS.

- [ ] **Step 7: Full unit sweep + typecheck**

Run: `npx tsc --noEmit && npx vitest run test/unit`
Expected: clean typecheck; full unit suite green (confirms the session constructor change + new ops caused no daemon-test regressions).

- [ ] **Step 8: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts src/daemon/server.ts test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(compaction): daemon compact op + daemon-wide compactTool opt-in"
```

---

### Task 5: Live test (deterministic, gated)

Prove the real path: drive a `DaemonSession` past the compact minimum, then `compact()` and assert a real success with `postTokens < preTokens`. Mirrors `test/live/observability.test.ts` gating/teardown.

**Files:**
- Create: `test/live/compaction.test.ts`

**Interfaces:**
- Consumes: `DaemonSession` from `../../src/daemon/session.js`; the real SDK `query`.

- [ ] **Step 1: Write the live test**

Create `test/live/compaction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSession } from "../../src/daemon/session.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live self-compaction (real SDK)", () => {
  it("compact() performs a real manual compaction (postTokens < preTokens)", async () => {
    const s = new DaemonSession("live-compact", { query }, { model: MODEL, permissionMode: "auto" });
    try {
      // Build a transcript large enough to exceed the manual-compact minimum (~3 substantial turns).
      await s.submit("In ~400 words, explain how DNS resolution works end to end.", () => {});
      await s.submit("In ~400 words, explain how the TLS 1.3 handshake works.", () => {});
      await s.submit("In ~400 words, explain how TCP congestion control works.", () => {});
      const outcome = await s.compact();
      expect(outcome.result).toBe("success");
      expect(typeof outcome.preTokens).toBe("number");
      expect(typeof outcome.postTokens).toBe("number");
      expect(outcome.postTokens!).toBeLessThan(outcome.preTokens!);
    } finally {
      await s.dispose();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Verify it skips without a key**

Run (no key): `npx vitest run test/live/compaction.test.ts`
Expected: SKIPPED (0 failures) — confirms the gate.

- [ ] **Step 3: Run it live**

Load the key from the gitignored `CC-to-SDK/.env`, then run:

```bash
set -a; . ../.env; set +a
npx vitest run test/live/compaction.test.ts
```

Expected: PASS — `outcome.result === "success"` and `postTokens < preTokens` (the probe saw 31590 → 5664).
**Never print or commit the key; do not `git add` `.env`.**

> If 3 turns are still under the compact minimum ("Not enough messages to compact."), add one or two more `submit(...)` turns of similar length — do NOT weaken the assertion off `result: "success"`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add test/live/compaction.test.ts
git commit -m "test(compaction): live deterministic compact() success (gated)"
```

---

## Self-Review (completed before handoff)

**Spec coverage** (against `2026-06-17-self-compaction-design.md`):
- §4.1 config (`autoCompactEnabled`/`autoCompactWindow` → `options.settings`, composes with `config.settings`) → Task 2.
- §4.2 `compact()` + `enqueueTurn` refactor + intent flag + `readLoop` trigger + 5th-param `compactTool` → Task 3.
- §4.3 daemon op + supervisor `compact(id)` + nested-`outcome` server reply → Task 4.
- §4.4 `cc-compact` core (`parseCompactOutcome`/`buildCompactTools`/`createCompactMcpServer`/`withCompactTool`/`COMPACT_TOOL`) → Task 1; daemon opt-in → Tasks 3 (session) + 4 (supervisor/types).
- §6 error handling (failed compaction is a normal `{ok:false}` outcome, not a throw; fire-and-forget `.catch`) → Task 3 (`compact()` returns parseCompactOutcome; trigger uses `.catch(()=>{})`).
- §7 testing (parseCompactOutcome cases, tool, withCompactTool, config merge, compact() + one-shot trigger + FIFO, op parse + supervisor delegate + wiring, deterministic live) → Tasks 1-5.
- §8 non-goals — no one-shot/lib on-demand, no `Query.compact()` frame, no SDK Stop-hook registration, no threshold policy, no PreCompact/PostCompact: nothing in any task touches `harness.ts` on-demand, `bridge/`, or hooks.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `COMPACT_TOOL`, `CompactHolder`, `CompactOutcome`, `parseCompactOutcome`, `withCompactTool` names identical across Tasks 1/3/4. `DaemonSession` 5th param `{ contextTool?; compactTool? }` matches `makeSession`'s `{ contextTool, compactTool }` call site. `compact()` returns `CompactOutcome`; supervisor returns it; server nests it under `outcome`.

**Scope:** one cohesive subsystem (one new module + config + daemon wiring + tests) — one plan.

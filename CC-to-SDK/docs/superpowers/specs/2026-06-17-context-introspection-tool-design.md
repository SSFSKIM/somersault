# Self-Introspection Context Tool — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Parity:** domain 6 (introspection & observability), agent-facing — see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`
**Follows:** the observability read API (`specs/2026-06-17-observability-read-api-design.md`), which wired `getContextUsage()`.

## §1 Goal & context

Give the **agent** (the model inside a `query()` session) a tool to check how full its own context
window is, so it can self-regulate — wrap up, summarize, or hand off before running low. Built directly
on the just-shipped `getContextUsage()` (a `Query` control method the *harness* calls); this exposes
the same data to the *model* through an in-process MCP tool.

**Verified live 2026-06-17** (`probe-context-tool.mjs`): an in-process MCP tool handler CAN call
`holder.query.getContextUsage()` (a late-bound Query reference) from inside the tool callback — while
the model's turn is paused on that very tool — with **no re-entrancy deadlock**. The model called the
tool and reported its own context as "14%". The mechanism is sound.

## §2 Scope

**In:** a new `cc-context` MCP server (one tool, `GetContextUsage`) returning a **concise summary**,
available on the `createHarness` lib path and the daemon (opt-in). Read-only — the tool *reports*, it
does not act.

**Out (Spec B — self-compaction, separate):** triggering compaction. Verified-viable and queued, but a
distinct subsystem. Native auto-compaction already runs at ~167k tokens (`isAutoCompactEnabled: true`),
so the introspection tool's `approaching-limit` status reflects the native trigger.

## §3 Design

### 3.1 `src/context/server.ts` (NEW) — mirrors `kairos/brief.ts`

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

export interface RawContextUsage { totalTokens?: number; maxTokens?: number; autoCompactThreshold?: number; isAutoCompactEnabled?: boolean; }
export interface ContextUsageSummary { percentUsed: number; tokensUsed: number; maxTokens: number; tokensRemaining: number; status: "ok" | "approaching-limit"; }
export interface QueryHolder { query?: { getContextUsage(): Promise<RawContextUsage> }; }

// Pure mapping — the one piece of real logic. Computed from totalTokens/maxTokens directly (robust;
// not the ambiguous `percentage` field). `approaching-limit` honors the SDK's OWN autocompact trigger.
export function summarizeUsage(raw: RawContextUsage): ContextUsageSummary {
  const tokensUsed = raw.totalTokens ?? 0;
  const maxTokens = raw.maxTokens ?? 0;
  const tokensRemaining = Math.max(0, maxTokens - tokensUsed);
  const percentUsed = maxTokens > 0 ? Math.round((tokensUsed / maxTokens) * 100) : 0;
  const nearAutoCompact = !!raw.isAutoCompactEnabled && typeof raw.autoCompactThreshold === "number" && tokensUsed >= raw.autoCompactThreshold;
  const status = nearAutoCompact || percentUsed >= 80 ? "approaching-limit" : "ok";
  return { percentUsed, tokensUsed, maxTokens, tokensRemaining, status };
}

// Exported for direct handler testing (mirrors brief.ts buildBriefTools / tasks/server.ts).
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

export function createContextMcpServer(holder: QueryHolder) {
  return createSdkMcpServer({ name: "cc-context", version: "0.1.0", tools: buildContextTools(holder) });
}
```

`QueryHolder` is the **late-binding seam**: the handler is built before `query()` exists, so the
holder's `query` is set to the active Query the moment `query()` returns (verified-safe ordering —
binding precedes stream consumption, so any tool call sees a bound holder).

### 3.2 Lib wiring (`harness.ts` + `config/types.ts`)

- `HarnessConfig.contextTool?: boolean` (a new field; not an SDK Option — `resolveOptions` never spreads `config`, so it cannot leak).
- In `createHarness`, alongside the `taskTools`/`swarm` wiring: when `config.contextTool`, create a `ctxHolder: QueryHolder`, add `createContextMcpServer(ctxHolder)` to `options.mcpServers`, and add `"mcp__cc-context__GetContextUsage"` to `options.allowedTools` (deduped).
- In `start(prompt)`, after `active = query(...)`: `if (ctxHolder) ctxHolder.query = active as { getContextUsage(): Promise<RawContextUsage> };`.

### 3.3 Daemon wiring (`daemon/session.ts` + `daemon/types.ts` + `daemon/supervisor.ts`)

- `DaemonSession` gains a 5th optional constructor param `sessionOpts: { contextTool?: boolean } = {}`. When `contextTool`, it builds a `ctxHolder` + `cc-context` server, merges them into a copy of `options` (mcpServers + allowedTools) **before** `this.q = deps.query({ prompt, options })`, then sets `ctxHolder.query = this.q`. Backward-compatible (existing 3–4-arg callers unaffected).
- `DaemonOptions.contextTool?: boolean` (daemon-wide opt-in, like `sharedTasks`); the supervisor stores it and `makeSession` passes `{ contextTool: this.contextTool }` as the 5th `DaemonSession` arg.

## §4 Data flow

model calls `mcp__cc-context__GetContextUsage` → handler reads `holder.query` (late-bound to the active
Query) → `getContextUsage()` → `summarizeUsage()` → concise JSON in the tool result → model
self-regulates.

## §5 Error handling

The handler never throws out of the tool callback: if `holder.query` is unset (shouldn't happen —
binding precedes stream consumption) or `getContextUsage()` throws, it returns
`{ content: [{ type: "text", text: "context usage unavailable" }] }` (matches the probe's catch).

## §6 Testing

**Unit:**
- `summarizeUsage`: `ok` case; `approaching-limit` via `percentUsed >= 80`; `approaching-limit` via the
  `isAutoCompactEnabled && tokensUsed >= autoCompactThreshold` trigger; `maxTokens: 0` → `percentUsed 0`.
- `buildContextTools`: handler returns the summary JSON for a holder whose fake `query.getContextUsage`
  resolves a raw object; returns `"context usage unavailable"` when `holder.query` is unset and when
  `getContextUsage()` throws.
- `createHarness({ contextTool: true })`: `options.mcpServers["cc-context"]` exists and
  `options.allowedTools` includes `"mcp__cc-context__GetContextUsage"`; neither present when the flag is
  absent/false.
- `DaemonSession` with `{ contextTool: true }`: a fake `query` capturing its `options` shows the
  `cc-context` server + allowed tool merged in; absent without the flag.

**Live** (gated `ANTHROPIC_API_KEY ? describe : describe.skip`, `try/finally` teardown): a
`createHarness({ contextTool: true })` run prompting the model to call `GetContextUsage`; assert the
tool result carries a numeric `percentUsed` (mirrors the probe, where the model reported 14%).

## §7 Verification evidence

`probe-context-tool.mjs` (model `claude-haiku-4-5`, API key): the tool handler called
`holder.query.getContextUsage()` successfully (full 17-field object returned, `handlerError: null`),
`outcome: "done"` (no deadlock), and the model's own final answer was "The percentage value returned is
14%." No premise rests on the unverified Feb snapshot.

## §8 Non-goals (separate / later)

- ❌ **Compaction** (triggering `/compact`, exposing `autoCompactEnabled`/`autoCompactWindow`) — Spec B,
  the self-compaction sub-project. Native auto-compaction (≈167k threshold) already covers the safety net.
- ❌ The tool **acting** — it only reports; the agent decides what to do.
- ❌ The full 17-field raw payload (concise summary chosen) and an opt-in `detailed` arg.
- ❌ A daemon *control op* for context usage — the harness already has `getContextUsage()` directly
  (observability read API); `cc-context` is **model-facing only**.
- ❌ Write/mutation, hooks, `forkSession`.

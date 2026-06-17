# Self-Compaction — Design (Spec B)

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Parity:** domain 6/7 (context lifecycle) — see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`
**Follows:** the context-introspection tool (`specs/2026-06-17-context-introspection-tool-design.md`). Introspection is the *signal* (am I full?); compaction is the *act*.

## §1 Goal & context

Give the harness explicit/earlier compaction control on top of the SDK's native auto-compaction. Native
auto-compaction already runs near ~167k tokens (the safety net); the new capability is **earlier, deliberate**
compaction — the harness or the agent deciding "compact now, before continuing" rather than waiting for the
native trigger. Three surfaces, sharing one primitive:

1. **Config** (lib + daemon) — tune/disable the native safety net.
2. **Daemon on-demand `compact()`** — "compact session N now."
3. **Agent-facing self-compaction tool** — the model calls a tool mid-turn to request compaction; the daemon
   fires `/compact` at the turn boundary.

## §2 Verification evidence (probed live 2026-06-17, model `claude-haiku-4-5-20251001`)

Every load-bearing premise was verified live (no reliance on the Feb snapshot). See memory
`sdk-context-tool-and-compaction-verified`.

- **Settings placement:** `autoCompactEnabled?: boolean` and `autoCompactWindow?: number` are fields of the SDK
  **`Settings`** interface (`sdk.d.ts` 6026 / 5826), i.e. they belong in `options.settings`. `autoCompactThreshold`
  is read-only (it appears in the `getContextUsage` response, not as a setting).
- **No `Query.compact()` control method exists** — the Query control surface is `interrupt` / `setModel` /
  `setPermissionMode` / `setMaxThinkingTokens` / `applyFlagSettings` + read methods. So on-demand compaction can
  ONLY be triggered by injecting `/compact` as a streaming-input turn — which means it is a **daemon-only**
  capability (one-shot `createHarness` has a string prompt, no input queue, no "next turn").
- **`/compact` injected as a turn terminates with a `type:"result"`** (`probe-compact-seq`): the existing
  `DaemonSession` waiter/`readLoop` FIFO resolves on it exactly like a normal turn. The structured outcome rides
  on intervening `system`/`status` frames.
- **The full agent-tool chain works end-to-end** (`probe-stop-compact`): the model called an in-process
  `RequestCompaction` tool → it set a per-session intent flag → at the turn boundary the `Stop` hook fired and
  **saw the intent set earlier in that same turn** → injecting `/compact` produced a **real manual compaction**:
  `status: compacting` → `compact_result: "success"` → `compact_boundary { trigger: "manual", pre_tokens: 31590,
  post_tokens: 5664 }` (an 82% token drop). Safe because at the boundary the in-flight turn's result has already
  resolved its waiter — `/compact` is just the *next* turn, never compacting the context mid-thought.

**Message shapes (from `sdk.d.ts`):**
- `SDKStatusMessage` = `{ type:"system", subtype:"status", status: "compacting"|"requesting"|null, compact_result?: "success"|"failed", compact_error?: string, ... }`
- `SDKCompactBoundaryMessage` = `{ type:"system", subtype:"compact_boundary", compact_metadata: { trigger: "manual"|"auto", pre_tokens: number, post_tokens?: number, ... } }`

## §3 Scope

**In:** config passthrough for the two autocompact settings (lib + daemon); a `DaemonSession.compact()` primitive +
a daemon on-demand op; an opt-in agent-facing `cc-compact` tool whose intent fires `/compact` at the next turn
boundary.

**Out (§8):** any one-shot `createHarness` on-demand trigger (impossible — no input queue); a `Query.compact()`
control frame (no such method); registering the literal SDK `Stop` hook (we use the daemon's existing
turn-completion signal — same boundary, DRY); compaction policy/auto-injection at a token threshold (native
auto-compaction already covers that); hooks subsystem (PreCompact/PostCompact) — separate later spec.

## §4 Design

### 4.1 Config passthrough — `config/types.ts` + `config/settings.ts`

Two typed `HarnessConfig` fields (sugar over the existing `settings` passthrough, for discoverability + type
safety — mirrors the persistence spine's typed `persistSession`/`sessionStore`):

```ts
// config/types.ts — HarnessConfig, near the persistence block
autoCompactEnabled?: boolean;   // SDK Settings.autoCompactEnabled — false disables the native ~167k safety net
autoCompactWindow?: number;     // SDK Settings.autoCompactWindow — tokens of headroom before auto-compaction
```

`resolveSettings` merges them INTO the settings object so an explicit `config.settings` still composes (typed
fields win on key collision; result is `undefined` only when nothing is set, preserving current behavior):

```ts
// config/settings.ts — replace the `settings: config.settings` line
const settings = mergeAutoCompact(config);   // { ...config.settings, autoCompactEnabled?, autoCompactWindow? } or undefined
return { settingSources, settings, managedSettings, systemPromptExcludeDynamic };

function mergeAutoCompact(config: HarnessConfig): Record<string, unknown> | undefined {
  const base = config.settings ? { ...config.settings } : {};
  if (config.autoCompactEnabled !== undefined) base.autoCompactEnabled = config.autoCompactEnabled;
  if (config.autoCompactWindow !== undefined) base.autoCompactWindow = config.autoCompactWindow;
  return Object.keys(base).length ? base : undefined;
}
```

Reaches every path including one-shot `createHarness` (it's pure `options.settings`).

### 4.2 `DaemonSession.compact()` primitive + `enqueueTurn` refactor — `daemon/session.ts`

**Refactor (DRY):** extract the "push a waiter + push an input turn" body that `submit()` already performs into a
private `enqueueTurn(prompt, onMessage): Promise<{ result: unknown }>`. `submit()` becomes the
`assertRunning`-guarded public entry; `compact()` reuses the same machinery so the injected `/compact` gets a
proper FIFO waiter (its `result` resolves ITS waiter, never a human turn's).

```ts
private enqueueTurn(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
  return new Promise((resolve, reject) => { this.waiters.push({ onMessage, resolve, reject }); this.input.push(userTurn(prompt)); });
}
submit(prompt, onMessage) { if (this.ended) return Promise.reject(new Error(`session ${this.id} is not running`)); return this.enqueueTurn(prompt, onMessage); }

/** Inject `/compact` as a turn and return the structured outcome. Reuses the FIFO waiter machinery. */
async compact(): Promise<CompactOutcome> {
  this.assertRunning();
  const frames: unknown[] = [];
  await this.enqueueTurn("/compact", (m) => {
    const mm = m as any;
    if (mm.type === "system" && (mm.subtype === "status" || mm.subtype === "compact_boundary")) frames.push(mm);
  });
  return parseCompactOutcome(frames);   // pure (see §4.4)
}
```

**Intent flag + trigger:** a per-session `compactRequested` flag (set by the agent tool, §4.4) consumed at the
turn boundary in `readLoop`. The boundary is the `type:"result"` the loop already detects — the same point the
SDK `Stop` hook fires (verified). When set, the session fires `compact()` **fire-and-forget** so the just-resolved
human turn returns immediately, while the FIFO guarantees `/compact` runs before the next human turn:

```ts
private compactRequested = false;
requestCompaction(): void { this.compactRequested = true; }   // called by the cc-compact tool via a late-bound holder

// in readLoop, on a result message — AFTER resolving the human waiter:
if ((m as any).type === "result") {
  this.waiters.shift()?.resolve({ result: (m as any).result });
  if (this.compactRequested && !this.ended) { this.compactRequested = false; void this.compact().catch(() => {}); }
} else this.waiters[0]?.onMessage(m);
```

Calling `compact()` from inside `readLoop` is safe and non-re-entrant: it synchronously pushes the `/compact`
turn + its waiter (now `waiters[0]` after the shift) and returns a promise the loop does not await; the loop
keeps consuming and later resolves that waiter on the `/compact` result. (Honest limitation: if a human turn was
ALREADY queued behind the requesting turn, `/compact` runs after it — "at the next boundary," not strictly before
any conceivable next turn. Normal daemon usage awaits each `submit()`, so the queue is empty at the boundary.)

### 4.3 Daemon on-demand op — `daemon/types.ts` + `supervisor.ts` + `server.ts`

- `daemon/types.ts`: `compactOp = z.object({ op: z.literal("compact"), id: z.string() })` added to the `daemonOp`
  union.
- `supervisor.ts`: `compact(id)` — same guard shape as `control`/`startProactive` (pool-or-registry lookup,
  reject ended/unknown), then `return session.compact()`.
- `server.ts`: `case "compact": send({ ok: true, outcome: await this.supervisor.compact(op.id) }); sock.end(); break;`
  — the outcome is **nested** under `outcome` (NOT spread) so its own `ok` field (did compaction succeed) does
  not collide with the op-envelope `ok` (did the op succeed). Run/lookup errors surface as `{ ok: false, error }`
  via the existing try/catch.

### 4.4 Agent-facing tool — `src/compaction/server.ts` (NEW) + daemon opt-in

Mirrors `src/context/server.ts` exactly (the just-shipped pattern): a pure helper, a tool builder exported for
testing, a server factory, and a `withCompactTool(options, holder)` merge helper. **Daemon-only** (the intent
trigger lives in `DaemonSession.readLoop`).

```ts
export const COMPACT_TOOL = "mcp__cc-compact__RequestCompaction";
export interface CompactHolder { request?: () => void }                 // late-bound to the session
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

export function buildCompactTools(holder: CompactHolder) {
  return [ tool("RequestCompaction",
    "Schedule a context compaction to run at the end of THIS turn (after you finish responding). Call this when your context window is getting full and you want to free space before continuing.",
    {},
    async () => { holder.request?.(); return { content: [{ type: "text" as const, text: "compaction scheduled for the end of this turn" }] }; }) ];
}
export function createCompactMcpServer(holder: CompactHolder) { return createSdkMcpServer({ name: "cc-compact", version: "0.1.0", tools: buildCompactTools(holder) }); }

/** COPY of options with the cc-compact server + allowed tool merged in (deduped); never mutates input. */
export function withCompactTool(options: Record<string, unknown>, holder: CompactHolder): Record<string, unknown> {
  const existing = (options.mcpServers as Record<string, unknown> | undefined) ?? {};
  const allowed = (options.allowedTools as string[] | undefined) ?? [];
  return { ...options, mcpServers: { ...existing, "cc-compact": createCompactMcpServer(holder) }, allowedTools: [...new Set([...allowed, COMPACT_TOOL])] };
}
```

**Daemon wiring (mirrors `contextTool`):** extend the existing `DaemonSession` 5th param to
`{ contextTool?: boolean; compactTool?: boolean }`. When `compactTool`, build a `CompactHolder`, merge the server
via `withCompactTool` into the options COPY before `deps.query(...)`, then late-bind
`holder.request = () => this.requestCompaction()`. `DaemonOptions.compactTool?: boolean` (daemon-wide, like
`contextTool`); the supervisor stores it and `makeSession` passes it in the 5th arg alongside `contextTool`.

The explicit op (§4.3) needs no opt-in — it is an unconditional daemon capability. The `compactTool` flag only
gates whether the *agent* can self-trigger.

## §5 Data flow

- **Config:** `autoCompactEnabled`/`autoCompactWindow` → `resolveSettings` → `options.settings` → SDK.
- **On-demand op:** client `{op:"compact", id}` → `server` → `supervisor.compact(id)` → `session.compact()` →
  `enqueueTurn("/compact")` → status/boundary frames → `parseCompactOutcome` → `{ ok, result, error, preTokens, postTokens }`.
- **Agent tool:** model calls `RequestCompaction` → `holder.request()` → `session.requestCompaction()` sets the
  flag → turn ends (`result` in `readLoop`) → human waiter resolves (caller returns now) → `void session.compact()`
  enqueues `/compact` with its own waiter → compaction runs before the next human turn.

## §6 Error handling

- `compact()` is `assertRunning`-guarded; a `compact_result: "failed"` (e.g. "Not enough messages to compact.")
  is a normal `CompactOutcome` of `{ ok: false, result: "failed", error }`, NOT a thrown error — the op still
  replies `{ ok: true, outcome: { ok: false, result: "failed", error } }` (the op succeeded; compaction declined).
- The agent-tool trigger is fire-and-forget with `.catch(() => {})` — a failed/declined auto-compact never
  rejects the requesting turn or the read loop.
- The tool handler never throws (returns the confirmation string unconditionally).
- Config fields are pure passthrough; no validation (an out-of-range `autoCompactWindow` is the SDK's concern).

## §7 Testing

**Unit:**
- `parseCompactOutcome`: success (status `success` + boundary pre/post) → `{ ok:true, result:"success", preTokens, postTokens }`; `failed` + error → `{ ok:false, result:"failed", error }`; empty frames → `{ ok:false }`.
- `buildCompactTools`: handler calls `holder.request` and returns the confirmation; safe when `holder.request` is unset.
- `createCompactMcpServer` → `{ type:"sdk", name:"cc-compact" }`; `withCompactTool` merges server + `COMPACT_TOOL` (deduped), never mutates input (same assertions as `withContextTool`).
- `settings.ts`: `autoCompactEnabled`/`autoCompactWindow` land in `options.settings`; compose with an explicit `config.settings`; absent → `settings` undefined (unchanged behavior).
- `daemon/session.ts`: `compact()` injects `/compact` and returns the parsed outcome (fake query emitting status+boundary then result); `requestCompaction()` + a turn `result` triggers exactly one `/compact` injection (assert via a capturing fake query) and clears the flag; a human `submit()` queued after still resolves with ITS OWN result (FIFO not corrupted by the injected `/compact`).
- `daemon/types.ts`: `daemonOp` parses `{op:"compact", id}`.
- `daemon/supervisor.ts`: `compact(id)` delegates to the session and rejects unknown/ended ids; `compactTool: true` wires `cc-compact` into every spawned session's options (capturing fake query).
- `daemon/server.ts` (if covered there): the `compact` op dispatches to `supervisor.compact` and replies `{ ok:true, ... }`.

**Live** (gated `ANTHROPIC_API_KEY ? describe : describe.skip`, `try/finally` teardown) — kept deterministic by
testing the **explicit op**, not the model's tool-calling: drive a daemon `DaemonSession` through enough turns to
exceed the compact minimum (the probe needed ~3 substantial turns ≈ 31k tokens), then call `compact()` and assert
`result: "success"` with `postTokens < preTokens`. The **agent-tool auto-trigger** is covered deterministically
by the unit test (capturing fake query proves exactly one `/compact` injected after the flagged turn, FIFO
intact); its live end-to-end was already proven by `probe-stop-compact` (31590→5664, `trigger: "manual"`), so the
gated suite does not re-run the nondeterministic model-driven path.

## §8 Non-goals (separate / later)

- ❌ One-shot `createHarness` on-demand compaction (no input queue — impossible; lib gets config only).
- ❌ A `Query.compact()` control frame (no such SDK method).
- ❌ Registering the literal SDK `Stop` hook (we use the daemon's existing `readLoop` turn-completion — same
  boundary; verified the Stop hook is available if ever preferred).
- ❌ Threshold-policy auto-injection (redundant with native auto-compaction).
- ❌ The PreCompact/PostCompact hooks subsystem, `compact_summary` surfacing — part of the future hooks spec.
- ❌ Exposing `autoCompactThreshold` as a setting (it is read-only).

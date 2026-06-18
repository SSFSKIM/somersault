# SDK Capability Closeout — Design

> Combined spec for the P1–P4 "incremental frontiers": the remaining reachable Agent-SDK capability
> beyond the 🚫 bridge floor. Goal is **parity with Claude Code's harness capability** (not specifically a
> headless service). One spec, three parts, one plan, one subagent-driven run. Mirrors the hooks ship
> (typed surface → public re-exports → unit + gated live).

## §1 — Goal

Close the verified gap between the harness and the installed `@anthropic-ai/claude-agent-sdk@0.3.178` by
wiring the nine live-verified frontier surfaces into first-class harness capability, each on an existing
seam (no new architecture):

- **Part A — Turn controls:** `effort`, `thinking`, `maxBudgetUsd`, `taskBudget`, `includePartialMessages`,
  `forwardSubagentText` as `HarnessConfig` fields → `resolveOptions` passthrough.
- **Part B — Introspection methods:** `usage()`, `initializationResult()` on `Harness` + `Session`,
  `applyFlagSettings()` on `Session`, plus matching daemon control ops.
- **Part C — Session-store mutation:** `renameSession` / `tagSession` / `deleteSession` lib wrappers +
  daemon ops; document the verified `acceptEdits` / `dontAsk` permission-mode semantics.

## §2 — Verification evidence (live-probed 2026-06-18)

Every premise below was verified against the **runtime** SDK, headless, with an API key — not the `.d.ts`
(the A1 lesson: declared ≠ reachable). Probes `11`/`11b`/`11c`/`12`/`13`/`14`/`15` (commits `3012f69c15`,
`5847c68659`); full matrix in memory `sdk-turn-controls-and-store-mutation-verified`. *(Methodology note:
probes answer runtime reachability — the one thing docs cannot. The `ant` CLI / `/claude-api` skill
complement on the declared/REST layer, e.g. which models support a beta, but never replace a live probe.)*

| Surface | Verified behavior | Drives |
|---|---|---|
| `effort: 'low'…'max'` | accepted headless; thinking block emitted even at `effort:'low'` | A passthrough |
| `thinking: {type:'adaptive'\|'enabled',budgetTokens\|'disabled'}` | accepted (enabled + adaptive) | A passthrough |
| `maxBudgetUsd` | generous = normal; **exceeded → subprocess exits 1, NO result frame, iterator THROWS** (`error_max_budget_usd` never emitted) | A passthrough + §6 |
| `taskBudget: {total}` | **model-gated**: `opus-4-8` ✅; `sonnet-4-6` + `haiku` → `400 "does not support user-configurable task budgets"` | A passthrough + §6 |
| `includePartialMessages` | emits `SDKPartialAssistantMessage` (`type:'stream_event'`): `message_start / content_block_start / content_block_delta(text_delta) / content_block_stop / message_delta / message_stop`; **already flows through `Session.stream()`** (readLoop routes non-result frames to the consumer) | A passthrough (no engine change) |
| `forwardSubagentText` | nested subagent messages carry `parent_tool_use_id` | A passthrough |
| `Query.usage_EXPERIMENTAL_…()` | headless `{session:{total_cost_usd,total_*_duration_ms,total_lines_added/removed,model_usage},subscription_type,rate_limits_available:false,rate_limits:null,behaviors}` | B method |
| `Query.initializationResult()` | `{commands,agents,output_style,available_output_styles,models,account,pid}` | B method |
| `Query.applyFlagSettings(settings)` | resolves in **streaming-input mode** (empty merge confirmed) | B method |
| `renameSession` / `tagSession` / `deleteSession` | land headless on the default file store; rename writes `customTitle`; after delete the id is gone from `listSessions` and `getSessionMessages` → `[]` (graceful) | C wrappers |
| `permissionMode: 'acceptEdits'` / `'dontAsk'` | `acceptEdits` auto-accepts edits but still consults `canUseTool` for non-edits; `dontAsk` does **not** consult `canUseTool` at all (joins `auto`/`bypass` as broker-replacing) | C docs + test |

## §3 — Scope

**In:** the nine surfaces above, each on its existing seam, with typed config/method surfaces, public
re-exports, unit tests, and one gated live test per part.

**Out (non-goals — AND the documented next-step backlog; recorded here so they are not lost):**

1. **Daemon-process boot-rehydration** — surviving a full daemon restart by persisting the registry to
   disk and rehydrating sessions. Architectural, not a knob; its own heavier spec. *Next step.*
2. **`toolConfig` allowlist-shaping** — finer per-tool config beyond the allow/deny we already model.
   Marginal value; deferred. *Next step.*
3. **Surfacing `SDKRateLimitEvent` / `usage().rate_limits`** — both are `null`/absent for API-key sessions
   (only populated on claude.ai plan auth, which is bridge-coupled). Nothing to surface headless today;
   revisit if/when a subscription-auth path exists. *Next step.*

## §4 — Design

### 4.A — Turn controls (config passthrough)

**Files:** `config/types.ts` (add fields), `config/resolveOptions.ts` (add passthrough), tests.

Add to `HarnessConfig`, typed via SDK re-exports (`import type { EffortLevel, ThinkingConfig } from
"@anthropic-ai/claude-agent-sdk"`):

```ts
effort?: EffortLevel;                  // 'low'|'medium'|'high'|'xhigh'|'max'
thinking?: ThinkingConfig;             // {type:'adaptive'} | {type:'enabled',budgetTokens} | {type:'disabled'}
maxBudgetUsd?: number;                 // hard USD ceiling; EXCEEDED → throws (see §6)
taskBudget?: { total: number };        // opus-4-8-only token pacing (beta task-budgets-2026-03-13)
includePartialMessages?: boolean;      // emit SDKPartialAssistantMessage stream_event frames
forwardSubagentText?: boolean;         // forward nested subagent text/thinking with parent_tool_use_id
```

`resolveOptions` gains six conditional passthrough lines, mirroring the existing `if (config.x) options.x =
config.x` style (numeric `maxBudgetUsd` guarded with `!== undefined`; the rest truthy-guarded so absent →
no key). No control-flow change — partial frames already surface through `stream()` unchanged.

### 4.B — Introspection methods

**Files:** `harness.ts`, `session/session.ts`, `daemon/*`, tests.

`Harness` (mirror `getContextUsage`/`accountInfo`, harness.ts:92–107) — the wrapper insulates consumers
from the SDK's deliberately-unstable method name:

```ts
usage(): Promise<unknown>;                 // → call("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET")
initializationResult(): Promise<unknown>;  // → call("initializationResult")
```

`Session` (mirror session.ts:110–111 `callQValue` / 105–108 `callQ`):

```ts
async usage(): Promise<unknown>                  { this.assertRunning(); return this.callQValue("usage_EXPERIMENTAL_…"); }
async initializationResult(): Promise<unknown>   { this.assertRunning(); return this.callQValue("initializationResult"); }
async applyFlagSettings(settings: Record<string, unknown>): Promise<void> { this.assertRunning(); await this.callQ("applyFlagSettings", settings); }
```

**Daemon:** add `usage` + `init` control ops (and `apply_flag_settings`) mirroring the existing
`context_usage` / `account_info` frames across `supervisor` + `server` + protocol. Each reads the live
`Session` and returns the value; same shape as the context/account ops the plan will copy.

### 4.C — Session-store mutation

**Files:** new `sessions/mutate.ts`, `sessions/index.ts` + `index.ts` (re-export), `daemon/*` (ops), tests.

New `sessions/mutate.ts`, mirroring `fork.ts` exactly (cwd→dir rename + DI `deps`):

```ts
export interface MutateSessionOpts { cwd?: string; sessionStore?: SessionStore; }
export function renameSession(id: string, title: string, opts?: MutateSessionOpts, deps?): Promise<void>;
export function tagSession(id: string, tag: string | null, opts?: MutateSessionOpts, deps?): Promise<void>;
export function deleteSession(id: string, opts?: MutateSessionOpts, deps?): Promise<void>;   // destructive — see §6
```

Re-export through `sessions/index.ts` and the public `index.ts` (these shadow the same-named SDK exports by
intent, exactly as `forkSession` already does). **Daemon:** `rename` / `tag` / `delete` ops mirroring the
existing `fork` op (`supervisor.fork`).

`acceptEdits` / `dontAsk` need **no new code** — `permissionMode` already passes through `resolveOptions`.
This part adds a documented note of the verified semantics (§2) and a test exercising both modes.

## §5 — Data flow

Unchanged seams. **A:** `config → resolveOptions → SDK Options`. **B:** `Harness`/`Session` method →
SDK `Query` control method over the open streaming transport (same as `getContextUsage`). **C:** wrapper →
SDK store fn operating on `~/.claude/projects` (scoped by `dir`); daemon op → `supervisor` → wrapper.

## §6 — Error handling (probe-driven)

- **`maxBudgetUsd`-exceeded throws** `Error: Claude Code process exited with code 1` with **no result frame**.
  We **pass it through — do not swallow or translate it.** The same string also means credit-exhausted and
  taskBudget-400, so a translation layer would be a fragile lie; and those two emit an `is_error` result
  *first* whereas budget-exceeded emits none — that presence/absence is the only honest discriminator, left
  to the caller. Documented on the `maxBudgetUsd` field; the live test asserts the throw.
- **`taskBudget` on an unsupported model** returns an `is_error:true` result (`"…does not support
  user-configurable task budgets"`), then a teardown throw. Passthrough; documented as opus-class; its live
  test pins `claude-opus-4-8`.
- **`usage().rate_limits` is `null`** on API-key auth (not an error — documented; see non-goal 3).
- **`deleteSession` is destructive** and irreversible — documented on the wrapper and the daemon op; after
  deletion `getSessionMessages` returns `[]` gracefully (no throw).
- Mutation wrappers are pure passthrough: SDK errors surface to the caller (like `fork.ts`), not swallowed.

## §7 — Testing

- **Unit (keyless, DI fakes — the bulk):** `resolveOptions` passthrough for all six A fields (present →
  key set, absent → no key); `Harness`/`Session` method delegation for usage/init/applyFlagSettings (fake
  `Query` records the call); `sessions/mutate.ts` cwd→dir + DI delegation (fake SDK fn); daemon ops (the
  `captureQuery`/registry helpers). Mirror the hooks unit pattern; dense no-Prettier hand-style; ESM `.js`
  specifiers.
- **Gated live (`ANTHROPIC_API_KEY`, skips keyless), one per part:**
  - **A:** `effort`/`thinking` accepted (result `success`); tiny `maxBudgetUsd` **throws**; `taskBudget`
    accepted on `claude-opus-4-8`; `includePartialMessages` yields `stream_event` frames.
  - **B:** `usage()` returns a session-cost object; `initializationResult()` returns the keyed payload;
    `applyFlagSettings({})` resolves.
  - **C:** create → `tagSession` → `renameSession` → `deleteSession` round-trip, asserting each lands in
    `listSessions` and the id is gone after delete.

## §8 — Non-goals

See §3 "Out" — the three deferred items (boot-rehydration, `toolConfig`, rate-limit surfacing) are
non-goals for this spec **and** the recorded next-step backlog. Beyond those: no new architecture, no
translation/wrapping of the `maxBudgetUsd` throw, no streaming of rate-limit frames, no session
write ops beyond rename/tag/delete.

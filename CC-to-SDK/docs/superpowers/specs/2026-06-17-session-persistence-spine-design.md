# Session Persistence Spine — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Parity:** domain 5 (session lifecycle & persistence) — see `docs/parity/coverage.md` §4
**Working dir:** `CC-to-SDK/harness/`

## §1 Goal & context

Make `sessionId` a **durable, resumable handle** across the harness. The Agent SDK already
persists every session transcript to `~/.claude/projects` by default (`persistSession` defaults to
`true`; the harness never overrides it) and `resume` works headlessly — **verified live 2026-06-17**
(persist→resume round-trip recalled prior context; `docs/parity/coverage.md` §4, memory
`sdk-session-store-introspection-verified`). The gap is not that sessions are unsaved — it is that
**the harness exposes no way to resume or control that persistence.** Today there is zero
`resume`/`persistSession`/`sessionStore` plumbing anywhere in `src/`, and `HarnessConfig` has no
persistence fields.

This is the **first** of three persistence/observability sub-projects (the spine). The read-side
observability API and `forkSession` branch-and-explore are separate, later specs.

## §2 The two-layer distinction (load-bearing — do not conflate)

"Session state" spans two independent layers; this spec addresses only the first:

1. **The transcript** — the conversation messages. The SDK persists this to disk by default.
   `persistSession` toggles it; `sessionStore` mirrors its entries to a custom backend; `resume`
   reloads it. **This spec's subject.**
2. **The daemon's `SessionRecord` index** (`daemon/types.ts`) — in-memory bookkeeping of which
   sessions exist and their live `status`/`model`/`pid`/`restarts`. `sessionStore` does **not**
   mirror this (it mirrors transcript entries, not status). Persisting this index is a **different
   concern, explicitly out of scope** (§9).

## §3 Scope

**In:** thin passthrough of three SDK options + a resume helper + a CLI surface + a daemon spawn op.
The layer adds *capability and ergonomics, not a storage engine* — no harness-owned store, no new
persistence code. Default behavior is unchanged (SDK still writes to `~/.claude/projects`).

**Consumers covered:** the `createHarness` lib path, the CLI, and the daemon `spawn` op.

## §4 Design

### 4.1 Config passthrough (`config/types.ts`, `config/resolveOptions.ts`)

Add to `HarnessConfig`:

```ts
resume?: string;                 // SDK session_id to reload; → options.resume
persistSession?: boolean;        // default SDK-true; → options.persistSession (only emitted when defined)
sessionStore?: SessionStore;     // BYO transcript-mirror backend (imported type); → options.sessionStore
```

`SessionStore` is `import type { SessionStore } from "@anthropic-ai/claude-agent-sdk"`. In
`resolveOptions`, three guarded passthrough lines in the existing `if (config.x) options.x = …`
style:

```ts
if (config.resume) options.resume = config.resume;
if (config.persistSession !== undefined) options.persistSession = config.persistSession;
if (config.sessionStore) options.sessionStore = config.sessionStore;
```

`persistSession` uses `!== undefined` (not truthiness) so an explicit `false` is emitted; the
default (field absent) leaves the SDK's `true` intact. No `DEFAULTS` entry is added — absence is the
default.

### 4.2 Resume helper (`harness.ts`, exported via `index.ts`)

```ts
export function resumeHarness(sessionId: string, config: HarnessConfig = {}, deps?: HarnessDeps): Harness {
  return createHarness({ ...config, resume: sessionId }, deps);
}
```

`run()` already returns `{ result, messages, sessionId }` (harness.ts:78), so the caller threads the
id forward.

**Contract (must be documented in the helper's doc comment):** `createHarness` starts a *fresh*
`query()` per `run()` (harness.ts:59-62), and a resumed handle applies its configured `resume` id to
**every** `run()` it makes. Therefore the idiomatic unit is **one continuation run per resumed
handle**:

```ts
const r1 = await createHarness({ model }).run("start the task");   // sessionId: X
const r2 = await resumeHarness(r1.sessionId).run("now continue");  // reloads X, returns id Y
const r3 = await resumeHarness(r2.sessionId).run("and finish");    // thread the latest id
```

For linear multi-turn sessions, prefer the daemon's long-lived streaming session. This is the
"nothing implicit / caller owns the handle" stateless model — the harness holds no session state.

### 4.3 CLI (`cliArgs.ts`, `cli.ts`)

- `--resume <id>` → `config.resume = <id>`
- `--no-persist` → `config.persistSession = false`

Wired into the default run path (the same path that builds `HarnessConfig` from flags). The CC-like
user surface: `cc-harness --resume <id> "continue the task"` / `cc-harness --no-persist "throwaway"`.

### 4.4 Daemon `spawn({ resume })` (`daemon/types.ts`, `daemon/supervisor.ts`)

- Extend `spawnOp` (daemon/types.ts:36) with `resume: z.string().optional()`.
- `supervisor.spawn()` merges `resume` into the per-session options (alongside `model`, through the
  existing `sessionOptions(id)` composition), so the new `DaemonSession`'s `query()` continues
  transcript X.
- Note: a daemon session's internal `id` (daemon-generated) is distinct from the SDK transcript
  `session_id`; `resume` carries the **SDK** `session_id`, supplied by the client (from a prior
  `run()` or, later, from `listSessions`).

**Auto-restart is untouched.** The D2 restart path still re-spawns *fresh* — a resumed session that
crashes loses context on restart. This is a documented limitation; restart-with-resume is the next
spec (§9).

## §5 Data flow

`config.resume` → `resolveOptions` → `options.resume` → `query({ prompt, options })` → SDK reloads
the transcript from `~/.claude/projects` → the first turn continues prior context → `run()` returns
the (possibly new) `sessionId` → caller threads it forward.

## §6 Error handling

Pure passthrough; no pre-validation. A bad or missing `resume` id surfaces as a normal SDK query
error. The `persistSession:false` + `resume` combination (read the prior transcript but do not write
new turns) is left to SDK semantics. We do not guard combinations we cannot foresee the failure mode
of (YAGNI).

## §7 Testing

**Unit:**
- `resolveOptions`: emits `resume`/`sessionStore` when set, omits when absent; emits
  `persistSession` for both `true` and `false`, omits when undefined.
- `resumeHarness`: delegates to `createHarness` with `resume` merged (inject a fake `query`, assert
  `options.resume`).
- `cliArgs`: parses `--resume <id>` and `--no-persist` into the right config fields.
- daemon `spawnOp`: accepts `resume`; `supervisor.spawn` merges it into session options (fake-`query`
  spy asserts `options.resume`).

**Live** (gated on `ANTHROPIC_API_KEY ? describe : describe.skip`, `try/finally` teardown): codify the
persist→resume round-trip — `createHarness().run()` with a codeword, capture `sessionId`,
`resumeHarness(id).run()` asking for the codeword, assert it is recalled.

## §8 Verification evidence

The SDK behaviors this spec relies on were probed live 2026-06-17 (`probe-sessionstore.mjs`, model
`claude-haiku-4-5`): persist→resume recalled a codeword across two separate `query()` calls
(`B_resume_recalled_BANANA: true`); a custom `InMemorySessionStore` received the transcript mirror
(`size: 1`). No premise in this spec rests on the unverified Feb snapshot.

## §9 Non-goals (separate, later specs)

- ❌ Persisting the daemon's `SessionRecord` **index** so status/pid bookkeeping survives a daemon
  restart — different concern; `sessionStore` does not address it (§2).
- ❌ D2 **restart-with-resume** (auto-restart reattaching to the transcript instead of starting fresh).
- ❌ Read-side **observability API** (`listSessions` / `getSessionMessages` / `getContextUsage` /
  `accountInfo`).
- ❌ **`forkSession`** branch-and-explore.
- ❌ A harness-**owned storage backend** (file/SQLite). The `sessionStore` field is a BYO seam only;
  the default remains the SDK-native disk store.

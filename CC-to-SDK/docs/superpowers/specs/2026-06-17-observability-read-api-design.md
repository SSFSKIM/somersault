# Observability Read API — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Parity:** domain 6 (introspection & observability) — see `docs/parity/coverage.md` §4
**Working dir:** `CC-to-SDK/harness/`
**Follows:** the session persistence spine (`specs/2026-06-17-session-persistence-spine-design.md`)

## §1 Goal & context

Surface the Agent SDK's read-side introspection as harness capability the daemon — and a future
control plane — can serve. The SDK provides all of it natively and it is **verified working headlessly**
(2026-06-17 probe; `docs/parity/coverage.md` §4, memory `sdk-session-store-introspection-verified`).
This layer adds **thin glue + surfacing, not a storage or normalization engine**: all reads are pure
passthrough over the SDK.

There are two distinct access patterns, and the design keeps them separate:

1. **Standalone store readers** — `listSessions` / `getSessionMessages` / `getSessionInfo`: top-level
   SDK functions that read the on-disk transcript store. **No session needed.**
2. **Live-session introspection** — `getContextUsage` / `accountInfo`: `Query` control methods that
   require an **open streaming session** (same constraint as the existing `Harness.rewind` /
   `supported*`, which require an active query).

## §2 The `cwd` → `dir` finding (dissolves the prior caveat)

The earlier probe's "listSessions returned the global store (801 sessions)" was a **probe bug, not an
SDK limitation**: `ListSessionsOptions` filters by **`dir`**, not `cwd`. The probe passed `{ cwd }`,
which is not a field, so it was silently ignored. With `{ dir }` set, `listSessions` scopes to that
project directory (and its git worktrees by default, `includeWorktrees: true`);
`getSessionMessages`/`getSessionInfo` take the same `dir`. So **project-scoping is built in** — the
harness's only job is to map its own `cwd` convention onto the SDK's `dir`. Both readers also support
`limit`/`offset` pagination and a `sessionStore` override.

Verified SDK shapes (from `sdk.d.ts`):
- `listSessions(opts?: ListSessionsOptions): Promise<SDKSessionInfo[]>` — `{ dir?, limit?, offset?, includeWorktrees?, sessionStore? }`
- `getSessionMessages(id, opts?: GetSessionMessagesOptions): Promise<SessionMessage[]>` — `{ dir?, limit?, offset?, includeSystemMessages?, sessionStore? }`
- `getSessionInfo(id, opts?: GetSessionInfoOptions): Promise<SDKSessionInfo | undefined>`
- `SDKSessionInfo` = `{ sessionId, summary, lastModified, fileSize?, customTitle?, firstPrompt?, gitBranch?, cwd?, tag?, createdAt? }`
- `SessionMessage` = `{ type: 'user'|'assistant'|'system', uuid, session_id, message, parent_tool_use_id }`
- `Query.getContextUsage()` and `Query.accountInfo()` are control methods on the live `Query`.

## §3 Scope

**In:** the standalone reader module (cwd→dir glue), `Harness` live-introspection methods, and the
daemon-served read surface (persisted-store ops + live-introspection control frames). Read-only.

**Consumers covered:** the `createHarness` lib path (live methods) + the exported reader functions +
the daemon (ops + control frames).

## §4 Design

### 4.1 Standalone reader module — `src/sessions/reader.ts` (NEW)

Three thin wrappers over the SDK top-level functions. The only value-add is mapping the harness `cwd`
→ SDK `dir`; everything else passes through. Each accepts an injectable `deps` param defaulting to the
real SDK fn (mirroring `createHarness(deps.query)`), so the mapping is unit-testable with zero
filesystem access.

```ts
import { listSessions as sdkListSessions, getSessionMessages as sdkGetSessionMessages,
         getSessionInfo as sdkGetSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStore, SDKSessionInfo, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

export interface ListSessionsOpts { cwd?: string; limit?: number; offset?: number; includeWorktrees?: boolean; sessionStore?: SessionStore; }
export interface GetMessagesOpts { cwd?: string; limit?: number; offset?: number; includeSystemMessages?: boolean; sessionStore?: SessionStore; }
export interface GetInfoOpts { cwd?: string; sessionStore?: SessionStore; }

export function listSessions(opts: ListSessionsOpts = {}, deps = { listSessions: sdkListSessions }): Promise<SDKSessionInfo[]> {
  const { cwd, ...rest } = opts;
  return deps.listSessions({ ...rest, ...(cwd ? { dir: cwd } : {}) });
}
export function getSessionMessages(id: string, opts: GetMessagesOpts = {}, deps = { getSessionMessages: sdkGetSessionMessages }): Promise<SessionMessage[]> {
  const { cwd, ...rest } = opts;
  return deps.getSessionMessages(id, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
export function getSessionInfo(id: string, opts: GetInfoOpts = {}, deps = { getSessionInfo: sdkGetSessionInfo }): Promise<SDKSessionInfo | undefined> {
  const { cwd, ...rest } = opts;
  return deps.getSessionInfo(id, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
```

Re-exported via `src/sessions/index.ts` and `src/index.ts`. No session required.

### 4.2 Harness live introspection — `src/harness.ts`

Add `getContextUsage()` and `accountInfo()` to the `Harness` interface and object, using the existing
`call(name)` helper (which throws `"<name>() unavailable: start a query first"` when no query is
active). They join `rewind`/`supportedCommands`/`supportedModels`/`supportedAgents`:

```ts
getContextUsage: call("getContextUsage"),
accountInfo: call("accountInfo"),
```

These are meaningful only while a query streams — the same documented constraint already in the file
(harness.ts:52-57). The `fakeQuery` test helper gains the two methods.

### 4.3 Daemon read surface

**Persisted-store ops** (distinct from the existing `list`, which returns the live in-memory
`SessionRecord` registry):

- `daemon/types.ts`: add to the op union
  - `sessionsOp = { op: "sessions", cwd?: string, limit?: number, offset?: number }`
  - `messagesOp = { op: "messages", id: string, cwd?: string, limit?: number, offset?: number }`
- `daemon/supervisor.ts`: thin methods `listPersistedSessions(opts)` and `getPersistedMessages(id, opts)`
  that delegate to the **same `src/sessions/reader.ts`** (DRY — the cwd→dir logic lives in one place).
  Injectable reader deps for unit testing (default to the real reader fns).
- `daemon/server.ts`: dispatch the two ops →
  `send({ ok: true, sessions: await this.supervisor.listPersistedSessions(...) })` and
  `send({ ok: true, messages: await this.supervisor.getPersistedMessages(op.id, ...) })`.

**Live-introspection control frames** (modeled on the existing `initialize` frame that returns a payload):

- `bridge/types.ts`: extend `controlFrame` with `{ type: "context_usage" }` and `{ type: "account_info" }`;
  add `getContextUsage()` / `accountInfo()` to the `ControllableSession` interface.
- `bridge/control.ts`: `ControlBridge.apply` gains cases returning `{ ok: true, usage: await session.getContextUsage() }`
  and `{ ok: true, account: await session.accountInfo() }`, feature-detecting absence into
  `{ ok: false, error: "unsupported: …" }` exactly like the existing delegations.
- `daemon/session.ts`: `DaemonSession` gains `getContextUsage()` / `accountInfo()` that call the
  underlying `Query` via the existing `callQ` helper (guarded by `assertRunning`).

## §5 Data flow

- **Readers:** `cwd` → `dir` → SDK top-level fn → on-disk store → `SDKSessionInfo[]` / `SessionMessage[]`.
  The daemon `sessions`/`messages` ops route through the same reader module.
- **Live introspection:** `Harness.getContextUsage()` → active `Query.getContextUsage()`; daemon
  `control(id, { type: "context_usage" })` → `ControlBridge` → `DaemonSession.getContextUsage()` → that
  session's `Query`.

## §6 Error handling

Pure passthrough; no pre-validation. A missing `dir`/session id makes the SDK readers return `[]` /
`undefined`. The `Harness` live methods throw `"…unavailable: start a query first"` when no query is
active (existing `call()` behavior). Daemon control frames feature-detect a missing method into a
structured `{ ok: false, error }`. Daemon read ops surface store errors as `{ ok: false, error }`
through the server's existing try/catch.

## §7 Testing

**Unit:**
- `reader.ts`: each wrapper maps `cwd` → `dir` and passes through `limit`/`offset`/`includeWorktrees`/
  `includeSystemMessages`/`sessionStore`; omitting `cwd` omits `dir` (inject a fake SDK fn — no filesystem).
- `harness.ts`: `getContextUsage()` / `accountInfo()` delegate to the active query (fakeQuery gains both,
  returning sentinel values); both throw when no query is active.
- `bridge`: `controlFrame` parses `context_usage` / `account_info`; `ControlBridge` returns the payload
  for each and feature-detects a session missing the method into `{ ok:false, error }`.
- `daemon`: `daemonOp` parses `sessions` / `messages` (with and without optional fields); `supervisor`
  `listPersistedSessions` / `getPersistedMessages` delegate to an injected fake reader with cwd passed through;
  `DaemonSession.getContextUsage` / `accountInfo` call the underlying Query.

**Live** (gated `ANTHROPIC_API_KEY ? describe : describe.skip`, `try/finally` teardown):
- After a `createHarness({ cwd }).run(...)`, calling `getContextUsage()` mid-stream returns an object
  with a numeric `totalTokens`.
- `listSessions({ cwd })` returns a non-empty array containing the just-created session's `sessionId`,
  scoped to that `cwd` (proving the cwd→dir scoping works, not the global store).

## §8 Verification evidence

The SDK behaviors were probed live 2026-06-17 (`probe-sessionstore.mjs`): `getContextUsage()` returned
a 17-field breakdown incl. `totalTokens: 26191`; `accountInfo()` returned `{tokenSource, apiKeySource,
apiProvider}`; `listSessions()` returned rich `SDKSessionInfo` records; `getSessionMessages(id)`
returned a transcript array. The `cwd`→`dir` correction (§2) is read directly from the `sdk.d.ts`
`ListSessionsOptions` declaration and is exercised by the §7 live test.

## §9 Non-goals (separate / later specs)

- ❌ **Write/mutation** ops — `renameSession` / `tagSession` / `deleteSession`. Read-only this spec.
- ❌ `forkSession` branch-and-explore.
- ❌ Daemon `SessionRecord`-index persistence (the live registry surviving restart).
- ❌ Daemon restart-with-resume.
- ❌ The control-plane **transport** itself (HTTP/web/UI). This spec only makes the daemon *able to
  serve* the reads over the existing UDS NDJSON protocol.
- ❌ Normalized/unified observability types, search, or caching (the rejected `observe()` facade).

# Session Forking + Store Facade — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Session cluster:** sub-project **3 of 3**. Depends on **Spec 1** (`lib-session-primitive`) for
`openSession`/`resumeSession`/`Session.sessionId`. Independent of Spec 2 — build in either order after Spec 1.
**Parity:** domain 5 (persistence) — see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`

## §1 Goal & context

The read-side session-store family already exists: `listSessions` / `getSessionMessages` / `getSessionInfo`
(`src/sessions/reader.ts`, exported from `src/index.ts`) and the daemon's `listPersistedSessions` /
`getPersistedMessages` passthroughs. What's missing is the one **branch** operation — `forkSession` is wired
nowhere in the harness — and a coherent, documented **browse → fork → resume** workflow tying the read-side to the
live `Session` primitive.

`forkSession` is the natural counterpart to Spec 2's resume. The probe established the distinction precisely:
**resume preserves the session id** (continue the *same* conversation) — that is Spec 2; **fork mints a NEW id**
(branch the conversation for speculative/parallel exploration without disturbing the original) — that is this spec.

Goal: expose `forkSession` as a first-class library function and a daemon `fork` op, and curate the read-side +
fork + resume into a documented "session store" surface.

## §2 Verification evidence

- **`forkSession` SDK surface** (`sdk.d.ts:688`):
  `forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>`, where
  `ForkSessionOptions = SessionMutationOptions & { upToMessageId?: string; title?: string }` (`SessionMutationOptions`
  carries `dir?`), and `ForkSessionResult = { sessionId: string }` — *"New session UUID. Resumable via
  `query({ options: { resume: sessionId } })`."* So the fork mints a new id and the branch is reached by resuming
  that id — exactly the lib `Session` resume path.
- **`upToMessageId`** lets a fork truncate the source transcript at a message UUID (inclusive); omitted = full copy.
- **Fork mints a new id** (SDK doc, `sdk.d.ts:703-705`): `ForkSessionResult.sessionId` is documented as a *"New
  session UUID"* distinct from the source, so the original session is untouched. (`forkSession` itself was not in
  the `probe-lib-session` run — that probe verified the complementary fact that *resume preserves* the id; the live
  test in §7 confirms fork's new-id + branch-independence end-to-end before this spec is implemented.)
- **The read-side already works headlessly** (memory `sdk-session-store-introspection-verified`):
  `listSessions`/`getSessionMessages`/`getSessionInfo` return real data; `cwd→dir` scoping is handled by the
  existing wrappers.

## §3 Scope

**In:**
- `src/sessions/fork.ts` (NEW) — `forkSession(id, opts?, deps?)` wrapping the SDK fn with the same `cwd→dir`
  convention the existing readers use; returns the new session id.
- `src/sessions/index.ts` + `src/index.ts` — export `forkSession` and its options type alongside the readers (the
  "store facade" = a coherent barrel: list / getMessages / getInfo / fork, with resume living on the `Session`
  primitive).
- `src/daemon/types.ts` — `forkOp = { op:"fork", id }` in the `daemonOp` union.
- `src/daemon/supervisor.ts` — `fork(id)`: read the session's SDK id, mint a fork via the SDK, spawn a new daemon
  session resuming the fork id; return the new daemon handle + fork id.
- `src/daemon/server.ts` — `case "fork"`.
- Docs: a short browse → fork → resume workflow note (in the spec/README; not a new doc subsystem).

**Out (§8):** `deleteSession` and other session-mutation ops (only `forkSession` here); `upToMessageId` *resolution*
helpers (we pass it through; finding the right anchor UUID is the caller's job via `getSessionMessages`); any change
to the `Session` engine (Spec 1) or daemon persistence (Spec 2); a read-side that re-implements what
`listSessions`/`getSessionMessages` already provide.

## §4 Design

### 4.1 Lib `forkSession` wrapper — `src/sessions/fork.ts` (NEW)

Mirrors `reader.ts`'s structure exactly (the `cwd→dir` rename + a DI `deps` default for testability):

```ts
import { forkSession as sdkForkSession } from "@anthropic-ai/claude-agent-sdk";
import type { ForkSessionResult } from "@anthropic-ai/claude-agent-sdk";

export interface ForkSessionOpts { cwd?: string; upToMessageId?: string; title?: string; }

/** Branch a stored session into a NEW session id (the original is untouched). Reach the branch with
 *  resumeSession(newId) (Spec 1). `upToMessageId` truncates the copied transcript at that message (inclusive). */
export function forkSession(id: string, opts: ForkSessionOpts = {}, deps = { forkSession: sdkForkSession }): Promise<ForkSessionResult> {
  const { cwd, ...rest } = opts;
  return deps.forkSession(id, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
```

Returns the full `{ sessionId }` (not just a string) to stay faithful to the SDK shape and leave room for future
result fields. The documented workflow: `listSessions({cwd})` → pick an id → `forkSession(id, {cwd})` →
`resumeSession(result.sessionId, {cwd})` → take turns on the branch.

### 4.2 Store facade exports — `src/sessions/index.ts` + `src/index.ts`

`src/sessions/index.ts` adds `forkSession` + `ForkSessionOpts` next to the existing readers. `src/index.ts`
re-exports them. No new abstraction object — the "facade" is the coherent set
{`listSessions`, `getSessionMessages`, `getSessionInfo`, `forkSession`} (read/browse) + {`openSession`,
`resumeSession`} (live; Spec 1). This keeps the surface flat and matches how the harness already exports the
read-side.

### 4.3 Daemon `fork` op — `src/daemon/types.ts` + `supervisor.ts` + `server.ts`

- `daemon/types.ts`: `forkOp = z.object({ op: z.literal("fork"), id: z.string() })` added to the `daemonOp` union.
- `supervisor.ts`: a `fork(id)` method. Guard like `compact`/`control` (pool-or-registry lookup; reject
  ended/unknown). Read the live session's SDK id, mint a fork, spawn a resumed session:

```ts
async fork(id: string): Promise<{ id: string; sessionId: string }> {
  const session = this.pool.get(id);
  if (!session || session.isEnded()) {
    const rec = this.registry.get(id);
    throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
  }
  const sourceSdkId = session.sessionId;   // Spec 1 capture; the live session has it after its first turn
  if (!sourceSdkId) throw new DaemonError(`session ${id} has no session_id yet (take a turn first)`);
  const { sessionId } = await (this.deps.forkSession ?? forkSession)(sourceSdkId);  // DI like listSessions
  const handle = this.spawn({ model: this.configs.get(id)?.model, resume: sessionId }); // new daemon session on the branch
  return { id: handle, sessionId };
}
```

`fork` operates on a **live, pooled** session (the guard requires it), so it reads the SDK id straight off
`Session.sessionId` (Spec 1) — it does NOT depend on the Spec 2 record field, keeping Spec 3 build-order independent
of Spec 2. `spawn` already accepts `resume` (`supervisor.ts:82`) and applies it via `makeSession`. `forkSession` is
added to `DaemonDeps` as an optional injectable (defaulting to the real lib fn), matching the existing
`listSessions`/`getSessionMessages` DI on `DaemonDeps`.

- `server.ts`: `case "fork": send({ ok: true, ...await this.supervisor.fork(op.id) }); sock.end(); break;` — the
  fork result (`{id, sessionId}`) has no `ok` field, so spreading it under the envelope is safe (no collision, unlike
  the compact outcome which had to nest).

## §5 Data flow

- **Lib:** `forkSession(sourceId, {cwd, upToMessageId?})` → SDK `forkSession` → `{ sessionId: newId }` →
  `resumeSession(newId, {cwd})` opens a live branch; the source session/transcript is unchanged.
- **Daemon:** client `{op:"fork", id}` → `server` → `supervisor.fork(id)` → resolve source SDK id (live
  `.sessionId` or the Spec 2 record) → SDK `forkSession` → new id → `spawn({resume:newId})` → reply
  `{ ok:true, id:<new handle>, sessionId:<new SDK id> }`.

## §6 Error handling

- Forking a session that has not yet taken a turn (no SDK id) → `DaemonError("… no session_id yet …")` (lib callers
  similarly must pass a real stored id; the SDK rejects an unknown id with its own error, surfaced as `{ok:false,
  error}` via the existing try/catch).
- `forkSession` for an unknown/deleted source id → the SDK rejects → `{ ok:false, error }` (daemon) or a rejected
  promise (lib). No special-casing.
- The new daemon session is subject to the same `maxSessions` cap as any `spawn` (a full pool throws
  `DaemonError`).

## §7 Testing

**Unit:**
- `src/sessions/fork.ts` (`test/unit/sessions-reader.test.ts` or a sibling): `forkSession` delegates to the
  injected SDK fn, applies the `cwd→dir` rename, passes `upToMessageId`/`title` through, and returns the
  `{ sessionId }` result (fake `deps.forkSession`).
- `src/index.ts`: `forkSession` is exported from the public barrel (assert in `index.test.ts`).
- `daemon/types.ts`: `daemonOp` parses `{op:"fork", id}`.
- `daemon/supervisor.ts`: `fork(id)` resolves the source id, calls the injected `forkSession`, spawns a session
  with `resume=<fork id>` (assert via capturing fake query + fake `forkSession` dep), and returns the new handle +
  fork id; rejects unknown/ended ids and a source with no captured id.
- `daemon/server.ts` (if covered there): the `fork` op dispatches to `supervisor.fork` and replies `{ok:true, id,
  sessionId}`.

**Live** (`test/live/session.test.ts` or a `forking` sibling, gated, `try/finally`):
- `openSession` → set codeword ZEBRA → take a turn → read `.sessionId` → `forkSession(id)` → assert the returned id
  differs from the source → `resumeSession(forkId)` recalls ZEBRA (the branch carries the history) → a NEW turn on
  the ORIGINAL session (still open) sets a different codeword, and a fresh `resumeSession(forkId)` does NOT see it
  (the branch is independent). Dispose both.

## §8 Non-goals (separate / later)

- ❌ Other session-mutation ops (`deleteSession`, etc.) — only `forkSession` here.
- ❌ A helper that *finds* the `upToMessageId` anchor — we pass it through; callers locate it via
  `getSessionMessages` (the read-side already returns message UUIDs).
- ❌ Re-implementing or wrapping the existing readers beyond the flat barrel export (the read-side already works).
- ❌ Any `Session` engine change (Spec 1) or daemon persistence change (Spec 2).
- ❌ Boot-time rehydration / surviving a daemon process restart (Spec 2 non-goal).

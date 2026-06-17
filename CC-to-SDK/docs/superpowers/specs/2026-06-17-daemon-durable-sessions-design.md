# Daemon Durable Sessions — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Session cluster:** sub-project **2 of 3**. Depends on **Spec 1** (`lib-session-primitive`) — specifically
`Session.sessionId` (the captured SDK id). Build Spec 1 first.
**Parity:** domain 5 (persistence) — see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`

## §1 Goal & context

Today a daemon session's identity is a daemon-local handle `sess-N` (`supervisor.ts:84`); the SDK `session_id` is
**never captured or stored**. Two consequences:

1. **On-failure restart loses all context.** When an `on-failure` session's query dies, `restart()` re-creates it
   via `makeSession(id, cfg)` **without `resume`** — the comment at `supervisor.ts:248` is explicit: *"restart()
   omits it (stays fresh)."* The user gets a brand-new conversation with the same handle. The restart machinery
   (backoff, max-restarts, teardown-liveness guards) is sound; it just restarts the wrong thing — a fresh session
   instead of a continuation.
2. **No external resumability.** Because the record never holds the SDK id, no other client (a future CLI, the
   read-side `getPersistedMessages`) can tie a daemon handle to its on-disk transcript.

The goal: **capture the SDK `session_id` (now available via Spec 1's `Session.sessionId`), persist it on the
`SessionRecord`, and use it so on-failure restart RESUMES the conversation with context intact.** The SDK already
persists the transcript to `~/.claude/projects/` by default (probe-confirmed; memory
`sdk-session-store-introspection-verified`), so the registry only needs to store the *link* (handle → SDK id), not
the transcript itself.

Surviving a full daemon **process** restart (boot-time rehydration of prior sessions) is explicitly **out of
scope** here (§8) — chosen 2026-06-17 ("restart-resume + persist id"). This spec makes sessions *resumable by id*;
auto-rehydrating them on a new daemon boot is a follow-on.

## §2 Verification evidence

Relies entirely on facts already probed (no new probe needed):

- **Resume preserves the session_id** (probe `probe-lib-session`, G2b): resuming `id` yields a session whose
  `.sessionId` is the identical `id`. ⇒ persisting the id once is enough; it stays consistent across restarts.
- **Resume in streaming-input mode recalls context and is fully multi-turn** (G2): the restarted `DaemonSession`
  (streaming input) will recall the prior conversation and continue normally.
- **Default disk persistence is ON** (`persistSession` default-true; memory `sdk-session-store-introspection-verified`):
  the daemon must simply not disable it. `~/.claude/projects/` holds the transcript that `resume` reloads.
- **`Session.sessionId` capture** is delivered by Spec 1 (`.sessionId` getter, populated after the first turn).

## §3 Scope

**In:**
- `src/daemon/types.ts` — `SessionRecord` gains `sessionId?: string` (the SDK id).
- `src/daemon/supervisor.ts` —
  - persist `session.sessionId` into the record after a turn completes (once it is known);
  - `restart(id)` passes `resume = registry.get(id)?.sessionId` to `makeSession`, turning a fresh restart into a
    resumed continuation.
- Tests: unit (deterministic, fake query) for both edits; one gated live test for the persisted-id round-trip.

**Out (§8):** boot-time rehydration / surviving a daemon process restart; changing `reapStale` semantics; a new
persistence backend (default disk persistence suffices; `sessionStore` stays an advanced opt-in passthrough);
`forkSession` (Spec 3); any change to the `Session` engine (Spec 1 owns that).

## §4 Design

### 4.1 `SessionRecord.sessionId` — `src/daemon/types.ts`

```ts
export interface SessionRecord {
  id: string;                 // daemon handle (sess-N)
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  sessionId?: string;         // NEW: the SDK session_id (captured from Session.sessionId), for durable resume
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;
}
```

Optional because it is unknown until the session's first turn emits `init`. `register()` at spawn omits it; it is
filled in by the first `update` that sees it (4.2).

### 4.2 Persist the id after a turn — `src/daemon/supervisor.ts`

`submit()` already updates the record on every turn (`status` + `lastActiveAt`). Fold the id in: once
`session.sessionId` is known and not yet stored, persist it in the same `update`. (`runProactiveTurn` drives turns
too, but it does not currently touch the registry; the id is reliably captured on the first human `submit`, which is
sufficient. Persisting from proactive ticks as well is an optional plan refinement, not required.)

```ts
// supervisor.ts submit(), in the success branch (replaces the current update):
const r = await session.submit(prompt, onMessage);
this.registry.update(id, {
  status: "idle",
  lastActiveAt: session.lastActiveAt,
  ...(session.sessionId ? { sessionId: session.sessionId } : {}),
});
return r;
```

`registry.update` is a read-merge-write over the JSON record (`registry.ts:30`), so spreading the id in is a
one-field merge. Spreading conditionally (only when known) avoids ever writing `sessionId: undefined`.

### 4.3 Restart resumes instead of going fresh — `src/daemon/supervisor.ts`

`makeSession` already accepts an optional `resume` (`supervisor.ts:218`) and applies it to the session options. The
single change is in `restart()`: read the persisted SDK id and pass it.

```ts
private restart(id: string): void {
  this.restartCancels.delete(id);
  if (this.shuttingDown || this.stopping.has(id) || !this.configs.has(id)) return; // stopped during backoff
  const resume = this.registry.get(id)?.sessionId;          // NEW: continue the SAME SDK session, not a fresh one
  this.pool.set(id, this.makeSession(id, this.configs.get(id)!, resume));
  this.registry.update(id, { status: "idle", lastActiveAt: this.now() });
}
```

Because resume **preserves** the SDK id (probe G2b), the restarted session's `.sessionId` equals the persisted id —
the record stays internally consistent across any number of restarts, and the next `submit` re-persists the same id
harmlessly. If `sessionId` is absent (the session died before its first turn ever completed, so no id was ever
captured), `resume` is `undefined` and `restart` falls back to today's fresh-start behavior — the only honest option
when there is no transcript to resume.

**Teardown-liveness is unchanged.** This spec adds no new promise, timer, or await to the restart path — it only
changes the *options* `makeSession` receives. The existing guards (`stopping` set, `cancelRestart`, `shuttingDown`,
the synchronous-scheduler race handling at `supervisor.ts:239-242`) continue to govern, and the existing restart
tests still apply. The review must still confirm the restart→dispose race is intact (memory
`teardown-liveness-review-pattern`), but no guard logic moves.

## §5 Data flow

- **Capture + persist:** `submit(id, …)` → `session.submit` resolves → `session.sessionId` known →
  `registry.update(id, { …, sessionId })` writes it to `<dir>/<id>.json`.
- **Restart (on-failure):** query dies → `handleSessionEnd` (unchanged) schedules `restart` after backoff →
  `restart` reads `record.sessionId` → `makeSession(id, cfg, resume=sessionId)` → new `DaemonSession` with
  `options.resume = sessionId` → its first turn reloads the prior transcript; `.sessionId` re-equals the id.
- **External resume (enabled, not orchestrated here):** any client can now read `record.sessionId` and
  `resumeSession(record.sessionId)` (Spec 1) or `getPersistedMessages(record.sessionId)` (existing read-side).

## §6 Error handling

- Missing `sessionId` on the record (pre-first-turn death) → `resume` is `undefined` → fresh restart (graceful
  degradation, today's behavior).
- A `resume` whose transcript was deleted from disk: the SDK surfaces its own resume error when the restarted
  session takes its first turn; it does not crash the supervisor (the session's `done`/end-hook handles a dead
  query exactly as today). No special-casing — same failure path as any query that dies.
- Persisting the id is a single extra field in an `update` the code already performs → no new failure surface.

## §7 Testing

**Unit** (`test/unit/daemon-supervisor.test.ts`, extended; fake `QueryFn` that emits an `init` with a known
`session_id` then a `result`):
- After `submit`, the record gains `sessionId` equal to the fake init's id (and `status:"idle"`).
- `restart` (drive an `on-failure` session's query to end, advance the injected scheduler) calls `makeSession` with
  `resume` equal to the persisted `sessionId` — assert via a capturing fake query that the restarted session's
  options carry `resume: <sessionId>`.
- A session that dies BEFORE its first turn completes (no `sessionId` ever captured) restarts with `resume`
  undefined (fresh) — the graceful-degradation path.
- The existing restart/teardown tests (backoff, max-restarts, stop-during-backoff, shutdown) still pass unchanged.
- `daemon/types.ts`: a `SessionRecord` with `sessionId` round-trips through `register`/`get`.

**Live** (`test/live/persistence.test.ts` or `daemon.test.ts`, gated, `try/finally`) — kept deterministic by NOT
forcing an unexpected query death (hard to do reliably live). Instead prove the two halves that the unit test
mocks:
- spawn a daemon session, `submit` one turn, assert `supervisor.list()` shows a record whose `sessionId` is a
  non-empty UUID;
- `resumeSession(record.sessionId)` (Spec 1) in a fresh session recalls a codeword set in the daemon turn — proving
  the persisted id is the correct, resumable handle the restart path will use.
- The restart→resume *wiring* is covered deterministically by the unit test (capturing fake query proves
  `resume=sessionId` is threaded), so the gated suite does not attempt to crash a live query.

## §8 Non-goals (separate / later)

- ❌ Surviving a full daemon **process** restart (boot-time rehydration). `reapStale()` still drops records whose
  owning `daemonPid` is gone. Rehydrating prior sessions on a new daemon boot — re-opening them by their persisted
  `sessionId` and reconciling reap semantics + boot-time teardown-liveness — is a deliberate follow-on
  (chosen 2026-06-17).
- ❌ Persisting the id from proactive ticks (the first human `submit` captures it; proactive-only sessions are an
  edge case a plan refinement can cover if needed).
- ❌ A new persistence backend. Default disk persistence (`~/.claude/projects/`) is the substrate;
  `sessionStore`/`persistSession` remain advanced config passthroughs (Spec 1 / already plumbed).
- ❌ `forkSession` (Spec 3) and any `Session` engine change (Spec 1).

# Daemon Boot-Rehydration — Design

> The one architectural session item deferred from the SDK Capability Closeout (its §3 non-goal #1):
> surviving a full daemon **process** restart. The disk registry already persists session metadata across
> a crash; what dies is the in-memory pool of live `DaemonSession` objects, and the supervisor today
> actively *deletes* orphaned records at boot (`reapStale`). This spec replaces that one seam with
> **lazy rehydration**: a restarted daemon re-adopts its sessions' records and resumes each session's SDK
> context on first access. One spec, one plan, one subagent-driven run. Mirrors the existing daemon-op /
> resume seams (no new architecture, and — for lazy — no new protocol op).

## §1 — Goal

A daemon process that dies (crash, redeploy, OOM, `kill`) and restarts **transparently re-adopts the
sessions it owned**, with each session's SDK context intact, instead of forgetting them. Concretely: after a
restart, `list()` still shows the prior sessions as `idle`, and a `submit` (or any control op) on one of
them resumes its captured SDK `session_id` and continues the conversation — the first op pays the resume
latency, nothing else changes.

This rides the resume path Spec 2 (`daemon-durable-sessions`) already built for in-process crash-restart
(`makeSession(id, cfg, resume=sessionId)`), lifted from *session-crash* scope to *process-boot* scope.

## §2 — Verification evidence (live-probed 2026-06-18)

The premise this whole feature rests on — **a `session_id` persisted by one process resumes in a *different*
OS process that only knows the id from a file** — was verified live, not assumed (the A1 lesson: Spec 2 only
proved resume *within one supervisor instance*; a daemon restart is a genuinely new process). Probe `16`
(`16-boot-rehydration.ts` + `16-rehydrate-child.ts`, commit `db4e30bc23`):

| Premise | Probe method | Verified result |
|---|---|---|
| Cross-process disk-resume recalls context | Process A plants a codeword + captures `session_id`, then `execFile`s a **separate `tsx` OS process** that resumes by id alone and must echo the codeword | **PASS** — process B (which never created the session) recalled `REHYDRATE-CODEWORD-7741` |
| `resume` preserves the id (continue, not branch) | Compare child's init `session_id` to the parent's | **identical** (`2c43d134-…`) — unlike `forkSession`, which mints a new id; confirms boot-rehydration continues the same session |
| A dead pid reads as dead | existing `reapStale` already uses `process.kill(pid,0)` ESRCH in production | no new probe needed |

Cross-process resume working is what makes lazy rehydration viable: revival is just `makeSession(id, cfg,
resume=sessionId)` on the existing seam — the SDK loads the transcript from disk by id regardless of which
process asks.

## §3 — Scope

**In:**
- Replace the supervisor's boot-time `reapStale()` with `rehydrate()` **gated behind a new
  `DaemonOptions.rehydrate` flag** (default `false` → today's reap behavior is unchanged unless opted in).
- `SessionRegistry.rehydrate(pid)`: claim orphaned-but-rehydratable records (set `daemonPid=pid`, normalize
  status to `idle`, reset `restarts=0`), reap the rest, return the claimed records.
- Supervisor: reconstruct per-session `configs` + a `rehydratable` Set + advance `seq` past rehydrated ids
  at boot; a single `ensureLive(id)` seam that revives a claimed session on first access; route the
  guard-site lookups through it.
- Persist `restart` policy on `SessionRecord` (today it lives only in memory) so a rehydrated session keeps
  its restart posture.
- Unit tests (DI, keyless) for every branch + one gated live end-to-end (real restart → real resume).

**Out (non-goals — see §8):** eager boot-time revival; a client-facing `rehydrate` op; restoring proactive
heartbeats across a restart; multi-daemon registry coordination beyond the existing pid-aliveness check;
any change to the SDK's own transcript persistence.

## §4 — Design

Lazy revival, opt-in. The crux: **boot claims records but spawns no subprocess; revival happens
transparently inside the existing guard sites on first op.** Because `list()` already reads the disk
registry, rehydrated sessions are visible as `idle` immediately — so lazy needs **no new daemon op and no
`server.ts` change**.

### 4.1 — Persist `restart` policy (`daemon/types.ts`)

`SpawnConfig.restart` is currently in-memory only; rehydration must reconstruct it. Add one field:

```ts
export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  restart?: RestartPolicy;   // NEW: persisted spawn restart posture, for faithful rehydration
  sessionId?: string;
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;
}
```

Add `rehydrate?: boolean;` to `DaemonOptions` (`// adopt orphaned sessions on boot instead of reaping them (default false)`).

### 4.2 — `SessionRegistry.rehydrate(pid)` (`daemon/registry.ts`)

The registry owns file CRUD + `isAlive`, so the orphan-selection + claim/reap lives here (alongside
`reapStale`). Returns the claimed records for the supervisor to rebuild in-memory state from:

```ts
/** Boot adoption: claim orphaned-but-resumable records for `pid` (normalize to idle, fresh restart budget),
 *  reap the rest (errored / never-took-a-turn), and return the claimed records. Records owned by a still-
 *  live daemon are left untouched (shared registry dir). Counterpart to reapStale(). */
rehydrate(pid: number): SessionRecord[] {
  const claimed: SessionRecord[] = [];
  for (const r of this.list()) {
    if (this.isAlive(r.daemonPid)) continue;                              // a live daemon owns it
    const resumable = !!r.sessionId && (r.status === "idle" || r.status === "busy" || r.status === "restarting");
    if (!resumable) { this.remove(r.id); continue; }                     // errored or never resumable → reap
    const next: SessionRecord = { ...r, daemonPid: pid, status: "idle", restarts: 0 };
    this.register(next); claimed.push(next);
  }
  return claimed;
}
```

### 4.3 — Supervisor boot + the `ensureLive` seam (`daemon/supervisor.ts`)

**New field:** `private rehydratable = new Set<string>();` — ids claimed at boot but not yet revived.
This Set is what keeps boot-revival from racing the in-process restart machinery: an id is in it only
between boot-claim and first access; `restart()` / `handleSessionEnd` never consult it.

**Constructor** — replace the unconditional `this.registry.reapStale();` (line 69) with:

```ts
if (opts.rehydrate) {
  for (const rec of this.registry.rehydrate(process.pid)) {
    this.configs.set(rec.id, { model: rec.model, restart: rec.restart ?? this.restartPolicy });
    this.rehydratable.add(rec.id);
    const n = Number(rec.id.replace(/^sess-/, ""));
    if (Number.isFinite(n) && n > this.seq) this.seq = n;                // mint past rehydrated ids → no collision
  }
} else {
  this.registry.reapStale();                                            // unchanged default
}
```

**`spawn()`** — persist the restart policy so a future boot can reconstruct it:

```ts
this.registry.register({ id, daemonPid: process.pid, status: "idle", model: opts.model,
                         restart: cfg.restart, createdAt: t, lastActiveAt: t });
```

**The seam** — revive a claimed session on first access, exactly once:

```ts
/** Return the live session for `id`, reviving it from a boot-claimed record on first access (lazy
 *  rehydration). Returns the existing pool entry (even if ended — callers still check isEnded()), a freshly
 *  resumed session for a rehydratable id, or undefined when neither exists. */
private ensureLive(id: string): DaemonSession | undefined {
  const live = this.pool.get(id);
  if (live) return live;
  if (!this.rehydratable.has(id)) return undefined;
  this.rehydratable.delete(id);                                          // revive once
  const rec = this.registry.get(id);
  if (!rec?.sessionId) return undefined;                                 // defensive (rehydrate() guaranteed it)
  const cfg = this.configs.get(id) ?? { model: rec.model, restart: this.restartPolicy };
  const s = this.makeSession(id, cfg, rec.sessionId);                    // resume the captured sdk session
  this.pool.set(id, s);
  return s;
}
```

**Guard-site swap** — at the user-facing op guards (`submit`, `control`, `compact`, `usage`,
`initializationResult`, `applyFlagSettings`, `fork`, `startProactive`), replace `this.pool.get(id)` with
`this.ensureLive(id)`. The existing `if (!session …) { throw }` shape is preserved verbatim; only the lookup
changes. (`runProactiveTurn` stays on `pool.get` — it only fires under an already-revived proactive loop.)

**`stop()`** — must NOT revive a session just to dispose it; it only adds one line to clear the pending-
revival flag (the existing guard already passes for a claimed id, since `rehydrate()` left its record on
disk):

```ts
async stop(id: string): Promise<void> {
  const session = this.pool.get(id);                                     // NOT ensureLive — don't spawn to kill
  if (!session && !this.registry.get(id)) throw new DaemonError(`unknown session ${id}`);   // unchanged guard
  this.rehydratable.delete(id);                                          // NEW: drop the pending-revival flag
  // … unchanged: stop proactive loop, flag stopping, cancel restart, dispose if live, remove record …
}
```

### 4.4 — What is and isn't reconstructed

| State | Persisted? | On rehydrate |
|---|---|---|
| `model` | yes (record) | restored into `configs` |
| `restart` policy | **now yes** (§4.1) | restored into `configs` (falls back to daemon default if an old record lacks it) |
| SDK `session_id` | yes (record, Spec 2) | the resume anchor |
| `seq` counter | no (in-memory) | advanced past max rehydrated id at boot |
| live `Session` (subprocess) | no | recreated lazily on first op via `ensureLive` |
| proactive heartbeat | no | **not restored** (non-goal §8) |

## §5 — Data flow

**Boot:** `new DaemonSupervisor(deps, {rehydrate:true})` → `registry.rehydrate(pid)` claims orphaned records
on disk → supervisor rebuilds `configs` + `rehydratable` + `seq`. Pool stays empty; no subprocess.

**First op after boot:** `server` op (e.g. `submit`) → `supervisor.submit(id)` → `ensureLive(id)` →
`makeSession(id, cfg, resume=sessionId)` spawns the `claude` subprocess and the SDK loads the transcript
from `~/.claude/projects` by id → turn runs with full prior context → `registry.update` re-captures the
(same) `sessionId` and `idle` status. Subsequent ops hit the live pool entry directly.

**Subsequent death:** unchanged — `handleSessionEnd` → `restart()` with `resume = registry.sessionId`
(Spec 2). A rehydrated session has a fresh `restarts=0` budget.

## §6 — Error handling

- **Invalid / deleted transcript on resume:** degrades through existing machinery — `makeSession` starts the
  query, the resume fails inside the subprocess, `done` rejects → `handleSessionEnd` → marks `errored` (or
  restarts per policy). No new error path; the failure surfaces on the op that triggered revival.
- **Record claimed by a still-live daemon:** never touched — `rehydrate()` skips records whose `daemonPid`
  is alive (shared registry dir, single-daemon-per-socket invariant preserved by `server.ensureFreeSocket`).
- **Record orphaned but not resumable** (no `sessionId`, or `errored`): reaped at boot — there is nothing to
  restore (a never-turned session has no transcript; an errored one had no future).
- **`busy`/`restarting` at crash time:** normalized to `idle` on claim — the in-flight turn died with the
  process; the session is resumable at rest.
- **`stop` on a claimed-not-live id:** removes the record and clears the flag without spawning a subprocess.
- **`rehydrate:false` (default):** identical to today — `reapStale()` runs, orphaned records are deleted,
  an op on an orphaned id throws `unknown session`.

## §7 — Testing

- **Unit (keyless, DI fakes — the bulk):**
  - `registry.rehydrate(pid)` with injected `isAlive`: orphaned + `sessionId` + `idle` → claimed
    (`daemonPid` updated, `restarts` 0, returned); orphaned + `busy`/`restarting` → claimed **and
    normalized to `idle`**; orphaned + `errored` → reaped; orphaned + no `sessionId` → reaped; alive-pid
    record → untouched (not claimed, not reaped).
  - Supervisor `rehydrate:true` boot (fake `QueryFn`): `configs` reconstructed (incl. `restart` from the
    record); `rehydratable` populated; `seq` advanced so the next `spawn` does **not** collide with a
    rehydrated id (rehydrate `sess-3` + `sess-1` → next spawn is `sess-4`); `submit` on a rehydrated id
    revives it and the fake query receives `resume=<sessionId>` in its options; a second `submit` reuses the
    same live session (revive-once); `stop` on a claimed-not-live id removes the record without constructing
    a session.
  - `rehydrate:false` (default): `reapStale` path unchanged — orphaned records gone, `submit` on an orphaned
    id throws.
  - `spawn()` persists `restart` on the record.
- **Gated live (`ANTHROPIC_API_KEY`, skips keyless), one end-to-end:** supervisor #1 (real `query` dep)
  spawns a session, submits a turn planting a codeword, and persists the `sessionId`; rewrite that record's
  `daemonPid` to a guaranteed-dead pid (so it reads as orphaned); construct supervisor #2 on the same `dir`
  with `rehydrate:true`; `submit` "what was the codeword" and assert the reply recalls it — proving a real
  cross-instance boot-rehydration end to end against the live SDK.

## §8 — Non-goals

- **Eager boot revival** — rejected for the resource spike (up to `maxSessions` subprocesses at boot, most
  never used again); lazy revives only sessions actually touched.
- **A client-facing `rehydrate` op** — unnecessary; lazy delivers transparent survival on the existing ops,
  so no protocol-surface change.
- **Restoring proactive heartbeats** — ephemeral control state; silently resuming autonomous turns after a
  crash would be surprising. The session *context* survives; the operator re-arms the heartbeat. (Documented.)
- **Multi-daemon registry coordination** beyond the existing `daemonPid`-aliveness check.
- **Changing the SDK's transcript persistence** — we rely on it (probe 16); we don't touch it.

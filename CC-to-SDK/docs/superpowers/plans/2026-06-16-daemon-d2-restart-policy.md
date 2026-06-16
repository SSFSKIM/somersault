# Daemon D2 — Session Restart Policy (Crash Recovery) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a session's `query()` dies unexpectedly, the `DaemonSupervisor` auto-restarts it per a policy (`"no" | "on-failure"`) with exponential backoff + a max-restarts cap — never restarting on an intentional `stop`/`shutdown`/idle-reap.

**Architecture:** The supervisor watches each session's `done` promise (read-loop end) and discriminates intentional vs unexpected end via a `stopping` set + a `shuttingDown` flag. Unexpected end → `handleSessionEnd` → (on-failure) schedule a `restart` after backoff → swap a fresh `DaemonSession` (same id + config) into the pool. Backoff is injected (`scheduleRestart` returns a canceller) so tests are deterministic.

**Tech Stack:** TypeScript, vitest, zod/v4. Builds on D1 (`src/daemon/`).

**Reference spec:** `docs/superpowers/specs/2026-06-16-daemon-d2-restart-policy-design.md`

**The one invariant to protect:** a deliberate dispose must never trigger a restart (else `stop()` loops forever). Tests must pin it.

Run all commands from `CC-to-SDK/harness/`. Per task: `npx vitest run <file>` then `npm run typecheck` before committing. Commit to `main` (no branch), no `Co-Authored-By`/attribution.

---

### Task 1: Types — restart policy, restarting status, restarts count, spawn op

**Files:**
- Modify: `src/daemon/types.ts`
- Test: `test/unit/daemon-types.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("daemon protocol", …)`:

```ts
  it("spawn op accepts a restart policy and rejects an invalid one", () => {
    const ok = daemonOp.parse({ op: "spawn", restart: "on-failure" });
    if (ok.op === "spawn") expect(ok.restart).toBe("on-failure");
    expect(daemonOp.parse({ op: "spawn" }).op).toBe("spawn"); // restart optional
    expect(() => daemonOp.parse({ op: "spawn", restart: "sometimes" })).toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-types.test.ts`
Expected: FAIL — `restart` not on the spawn op (invalid value is currently accepted / property missing).

- [ ] **Step 3: Implement in `src/daemon/types.ts`**

Change `SessionStatus` (line 5) and add the policy type:

```ts
export type SessionStatus = "idle" | "busy" | "errored" | "restarting";
export type RestartPolicy = "no" | "on-failure";
```

Add `restarts?` to `SessionRecord`:

```ts
export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;       // count of automatic restarts (D2)
}
```

Extend `DaemonOptions`:

```ts
export interface DaemonOptions {
  dir?: string;            // registry dir (default ~/.claude/cc-daemon/sessions)
  maxSessions?: number;    // default 32
  idleTimeoutMs?: number;  // default 30 min; 0 disables idle reaping
  reapEvery?: number;      // reaper interval ms; default 30_000
  now?: () => number;      // injectable clock (testing)
  restart?: RestartPolicy; // daemon-wide default restart policy (default "no")
  maxRestarts?: number;    // cumulative cap before giving up; default 5
  backoffMs?: number;      // base restart backoff; default 500
  maxBackoffMs?: number;   // backoff cap; default 30_000
  scheduleRestart?: (fn: () => void, ms: number) => () => void; // returns a canceller (testing seam)
}
```

Add `restart` to the spawn op:

```ts
const spawnOp = z.object({ op: z.literal("spawn"), model: z.string().optional(), restart: z.enum(["no", "on-failure"]).optional() });
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-types.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts CC-to-SDK/harness/test/unit/daemon-types.test.ts
git commit -m "feat(harness): daemon D2 types — restart policy, restarting status, restarts count"
```

---

### Task 2: Expose `DaemonSession.done` for the supervisor's end hook

**Files:**
- Modify: `src/daemon/session.ts`
- Test: `test/unit/daemon-session.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("DaemonSession", …)`:

```ts
  it("exposes a public done promise that resolves when the query ends", async () => {
    const s = new DaemonSession("sess-1", { query: fakeQuery }, {});
    let ended = false;
    s.done.then(() => { ended = true; });
    await s.dispose();
    await Promise.resolve();          // flush the done.then microtask
    expect(ended).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/daemon-session.test.ts`
Expected: FAIL — `Property 'done' is private` (TS) / `s.done` undefined.

- [ ] **Step 3: Implement in `src/daemon/session.ts`** — change the `done` field from private to public readonly:

```ts
  readonly done: Promise<void>;
```

(It is still assigned in the constructor as `this.done = this.readLoop().catch(() => {});` — no behavior change, only visibility.)

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/unit/daemon-session.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/session.ts CC-to-SDK/harness/test/unit/daemon-session.test.ts
git commit -m "feat(harness): expose DaemonSession.done (public readonly) for the restart end-hook"
```

---

### Task 3: DaemonSupervisor — restart machinery

**Files:**
- Modify: `src/daemon/supervisor.ts`
- Test: `test/unit/daemon-supervisor.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside `describe("DaemonSupervisor", …)`. These use a fake query that *ends* to simulate a crash and a **capturing** `scheduleRestart` so backoff is deterministic:

```ts
  // flush pending microtasks/macrotasks so a dead session's done.then(handleSessionEnd) runs
  const flush = () => new Promise((r) => setTimeout(r, 0));
  // a query that dies immediately (yields nothing, returns) — simulates a crash
  const dyingQuery = () => (async function* () { /* ends at once */ })();
  // a query that works (one result per turn), ends only on dispose
  const healthyQuery = ({ prompt }: any) => (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })();

  it("on-failure restarts a dead session into a working one (restarting → idle, count tracked)", async () => {
    let calls = 0;
    const fq = (a: any) => { calls++; return calls === 1 ? dyingQuery() : healthyQuery(a); };
    let pending: (() => void) | undefined;
    const scheduleRestart = (fn: () => void) => { pending = fn; return () => { pending = undefined; }; };
    const sup = new DaemonSupervisor({ query: fq }, { dir: dir(), restart: "on-failure", scheduleRestart });
    const id = sup.spawn();
    await flush();                                   // session 1 dies → handleSessionEnd schedules a restart
    expect(sup.list()[0]).toMatchObject({ status: "restarting", restarts: 1 });
    pending!();                                      // fire the restart
    expect(sup.list()[0].status).toBe("idle");
    expect(calls).toBe(2);
    expect((await sup.submit(id, "hi", () => {})).result).toBe("ok:hi"); // restarted session works
    await sup.shutdown();
  });
  it("gives up (errored) once maxRestarts is exceeded", async () => {
    let pending: (() => void) | undefined;
    const scheduleRestart = (fn: () => void) => { pending = fn; return () => {}; };
    const sup = new DaemonSupervisor({ query: dyingQuery }, { dir: dir(), restart: "on-failure", maxRestarts: 1, scheduleRestart });
    const id = sup.spawn();
    await flush();                                   // death 1 → restarts 1, restarting
    expect(sup.list()[0]).toMatchObject({ status: "restarting", restarts: 1 });
    pending!(); await flush();                       // restart → dies again → restarts 2 > 1 → errored
    expect(sup.list()[0]).toMatchObject({ status: "errored", restarts: 2 });
    await sup.shutdown();
  });
  it("default policy 'no' leaves a dead session errored and never schedules a restart", async () => {
    let sched = 0;
    const sup = new DaemonSupervisor({ query: dyingQuery }, { dir: dir(), scheduleRestart: (fn) => { sched++; return () => {}; } });
    sup.spawn();
    await flush();
    expect(sup.list()[0].status).toBe("errored");
    expect(sched).toBe(0);
    await sup.shutdown();
  });
  it("INVARIANT: an intentional stop never triggers a restart", async () => {
    let sched = 0;
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), restart: "on-failure", scheduleRestart: (fn) => { sched++; return () => {}; } });
    const id = sup.spawn();
    await sup.stop(id);                              // dispose → end hook fires but id is in `stopping`
    await flush();
    expect(sched).toBe(0);
    expect(sup.list()).toEqual([]);
    await sup.shutdown();
  });
  it("INVARIANT: shutdown never triggers a restart", async () => {
    let sched = 0;
    const sup = new DaemonSupervisor({ query: healthyQuery }, { dir: dir(), restart: "on-failure", scheduleRestart: (fn) => { sched++; return () => {}; } });
    sup.spawn(); sup.spawn();
    await sup.shutdown();
    await flush();
    expect(sched).toBe(0);
  });
  it("a stop during the restarting window cancels the pending restart", async () => {
    let pending: (() => void) | undefined;
    const scheduleRestart = (fn: () => void) => { pending = fn; return () => {}; };
    const sup = new DaemonSupervisor({ query: dyingQuery }, { dir: dir(), restart: "on-failure", scheduleRestart });
    const id = sup.spawn();
    await flush();                                   // restarting, pending set
    expect(sup.list()[0].status).toBe("restarting");
    await sup.stop(id);                              // removes the record + config
    if (pending) pending();                          // firing it now is a no-op (config gone)
    expect(sup.list()).toEqual([]);
    await sup.shutdown();
  });
  it("submit during the restarting window reports the status", async () => {
    const scheduleRestart = () => () => {};          // never actually restarts
    const sup = new DaemonSupervisor({ query: dyingQuery }, { dir: dir(), restart: "on-failure", scheduleRestart });
    const id = sup.spawn();
    await flush();
    await expect(sup.submit(id, "x", () => {})).rejects.toThrow(/is restarting/);
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — no restart behavior yet (sessions stay `errored`; `scheduleRestart` never called; no `restarting` status).

- [ ] **Step 3: Replace `src/daemon/supervisor.ts` with the restart-capable version**

```ts
import { SessionRegistry } from "./registry.js";
import { DaemonSession } from "./session.js";
import { DaemonError } from "./types.js";
import type { DaemonOptions, RestartPolicy, SessionRecord } from "./types.js";
import type { QueryFn } from "../swarm/types.js";

export interface DaemonDeps { query: QueryFn; }

interface SpawnConfig { model?: string; restart: RestartPolicy; }

/** Owns the in-process session pool + the registry + an idle reaper + crash-recovery restarts. */
export class DaemonSupervisor {
  private pool = new Map<string, DaemonSession>();
  private configs = new Map<string, SpawnConfig>();   // per-session config, for re-creation on restart
  private registry: SessionRegistry;
  private seq = 0;
  private maxSessions: number;
  private idleTimeoutMs: number;
  private now: () => number;
  private reaper?: ReturnType<typeof setInterval>;
  // restart machinery
  private restartPolicy: RestartPolicy;
  private maxRestarts: number;
  private backoffMs: number;
  private maxBackoffMs: number;
  private scheduleRestart: (fn: () => void, ms: number) => () => void;
  private restartCancels = new Map<string, () => void>(); // pending restart cancellers, by id
  private stopping = new Set<string>();                   // ids being intentionally torn down
  private shuttingDown = false;

  constructor(private deps: DaemonDeps, opts: DaemonOptions = {}) {
    this.registry = new SessionRegistry({ dir: opts.dir });
    this.maxSessions = opts.maxSessions ?? 32;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 30 * 60_000;
    this.now = opts.now ?? Date.now;
    this.restartPolicy = opts.restart ?? "no";
    this.maxRestarts = opts.maxRestarts ?? 5;
    this.backoffMs = opts.backoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.scheduleRestart = opts.scheduleRestart ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as any).unref?.(); return () => clearTimeout(t); });
    this.registry.reapStale(); // clear records orphaned by a prior crash
    if (this.idleTimeoutMs > 0) {
      this.reaper = setInterval(() => { void this.reapIdle(); }, opts.reapEvery ?? 30_000);
      this.reaper.unref?.();
    }
  }

  spawn(opts: { model?: string; restart?: RestartPolicy } = {}): string {
    if (this.pool.size >= this.maxSessions) throw new DaemonError(`max sessions (${this.maxSessions}) reached`);
    const id = `sess-${++this.seq}`;
    const cfg: SpawnConfig = { model: opts.model, restart: opts.restart ?? this.restartPolicy };
    this.configs.set(id, cfg);
    this.pool.set(id, this.makeSession(id, cfg));
    const t = this.now();
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model: opts.model, createdAt: t, lastActiveAt: t });
    return id;
  }

  async submit(id: string, prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    const session = this.pool.get(id);
    if (!session) {
      const rec = this.registry.get(id);
      throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
    }
    this.registry.update(id, { status: "busy" });
    try {
      const r = await session.submit(prompt, onMessage);
      this.registry.update(id, { status: "idle", lastActiveAt: session.lastActiveAt });
      return r;
    } catch (e) {
      this.registry.update(id, { status: "errored" });
      throw e;
    }
  }

  list(): SessionRecord[] { return this.registry.list(); }

  async stop(id: string): Promise<void> {
    const session = this.pool.get(id);
    if (!session && !this.registry.get(id)) throw new DaemonError(`unknown session ${id}`);
    this.stopping.add(id);                       // flag BEFORE dispose so the end hook won't restart
    this.cancelRestart(id);
    if (session) await session.dispose();
    this.pool.delete(id);
    this.configs.delete(id);
    this.registry.remove(id);
    this.stopping.delete(id);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;                    // end hooks early-return from here on
    if (this.reaper) clearInterval(this.reaper);
    for (const cancel of this.restartCancels.values()) cancel();
    this.restartCancels.clear();
    await Promise.all([...this.pool].map(async ([id, s]) => { await s.dispose(); this.registry.remove(id); }));
    this.pool.clear();
    this.configs.clear();
  }

  /** Stop sessions whose last activity is older than the idle timeout. */
  async reapIdle(): Promise<void> {
    const cutoff = this.now() - this.idleTimeoutMs;
    const stale = [...this.pool].filter(([, s]) => s.lastActiveAt < cutoff).map(([id]) => id);
    await Promise.all(stale.map((id) => this.stop(id)));
  }

  // ---- restart machinery ----

  private makeSession(id: string, cfg: SpawnConfig): DaemonSession {
    const session = new DaemonSession(id, { query: this.deps.query }, cfg.model ? { model: cfg.model } : {}, this.now);
    session.done.then(() => this.handleSessionEnd(id)).catch(() => {}); // end hook
    return session;
  }

  /** Fires when a session's query ends. Restart only on an UNEXPECTED death (the core invariant). */
  private handleSessionEnd(id: string): void {
    if (this.shuttingDown || this.stopping.has(id)) return;     // intentional end — never restart
    const cfg = this.configs.get(id);
    if (!cfg || cfg.restart !== "on-failure") { this.registry.update(id, { status: "errored" }); return; }
    const restarts = (this.registry.get(id)?.restarts ?? 0) + 1;
    if (restarts > this.maxRestarts) { this.registry.update(id, { status: "errored", restarts }); return; }
    this.pool.delete(id);                                       // not submittable during the backoff window
    this.registry.update(id, { status: "restarting", restarts });
    const delay = Math.min(this.backoffMs * 2 ** (restarts - 1), this.maxBackoffMs);
    this.restartCancels.set(id, this.scheduleRestart(() => this.restart(id), delay));
  }

  private restart(id: string): void {
    this.restartCancels.delete(id);
    if (this.shuttingDown || this.stopping.has(id) || !this.configs.has(id)) return; // stopped during backoff
    this.pool.set(id, this.makeSession(id, this.configs.get(id)!));
    this.registry.update(id, { status: "idle", lastActiveAt: this.now() });
  }

  private cancelRestart(id: string): void {
    const cancel = this.restartCancels.get(id);
    if (cancel) { cancel(); this.restartCancels.delete(id); }
  }
}
```

- [ ] **Step 4: Run tests + the prior supervisor suite + typecheck**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS — all new restart tests plus the prior D1 supervisor tests (the `submit`-not-in-pool error message change still says `unknown session` for ghosts; `stop`/`shutdown` unchanged for the no-restart default).

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): DaemonSupervisor — auto-restart on unexpected session death (policy + backoff + cap)"
```

---

### Task 4: Forward the restart policy through the spawn op + final verification

**Files:**
- Modify: `src/daemon/server.ts`

- [ ] **Step 1: Forward `restart` in the spawn handler** — in `src/daemon/server.ts`, the `spawn` case currently passes only `model`. Update it to forward `restart`:

```ts
        case "spawn": send({ ok: true, id: this.supervisor.spawn({ model: op.model, restart: op.restart }) }); sock.end(); break;
```

- [ ] **Step 2: Full unit suite + typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: PASS — all prior 164 + the new D2 tests; tsc clean. (The D1 live test is unchanged and still covers the real-SDK happy path; D2 adds no live test.)

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/server.ts
git commit -m "feat(harness): forward restart policy through the daemon spawn op"
```

---

### Final verification (after all tasks)

- [ ] Full unit suite: `npm run test:unit` — all green.
- [ ] `npm run typecheck` — clean.
- [ ] `git status` — clean tree, no scratch files, no `.env`.
- [ ] Then invoke **superpowers:finishing-a-development-branch**.

**Spec-coverage check:** Task 1 ⇒ §4 types/protocol + §5 policy fields; Task 2 ⇒ §3 end-hook seam; Task 3 ⇒ §3 detection/restart + §5 backoff/cap + §6 backoff-window submit + §7 teardown guards (the invariant); Task 4 ⇒ §4 spawn-op forwarding. Success criteria §9 are exercised by Task 3's restart + invariant tests.

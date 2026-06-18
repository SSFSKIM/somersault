# Daemon Boot-Rehydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restarted daemon transparently re-adopts the sessions it owned — `list()` still shows them and the first op on one resumes its SDK context — instead of reaping them at boot.

**Architecture:** Lazy, opt-in rehydration. The disk registry already persists `SessionRecord`s across a process death; this plan (1) persists the `restart` policy on the record, (2) adds `SessionRegistry.rehydrate(pid)` to claim orphaned-but-resumable records and reap the rest, and (3) wires the supervisor to call it behind a `DaemonOptions.rehydrate` flag, reconstruct per-session config, and revive a claimed session on first access through one `ensureLive(id)` seam (a `rehydratable` Set keeps boot-revival from racing the in-process restart machinery). Lazy means **no subprocess at boot, no new daemon op, no `server.ts` change**.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, `@anthropic-ai/claude-agent-sdk@0.3.178`, DI-by-deps fakes for keyless unit tests.

## Global Constraints

- **Spec:** `CC-to-SDK/docs/superpowers/specs/2026-06-18-daemon-boot-rehydration-design.md`. Probe evidence: `probes/probes/16-boot-rehydration.ts` (cross-process resume PASS, commit `db4e30bc23`).
- **Working dir:** `CC-to-SDK/harness/`. All commands run from there.
- **Dense hand-style, NO Prettier** — match the surrounding compact code; do not reformat existing lines.
- **ESM:** every import specifier ends in `.js` (e.g. `from "./registry.js"`) even though sources are `.ts`.
- **`rehydrate` defaults to `false`** — with it off, behavior is identical to today (`reapStale()` runs). Never change the default.
- **Lazy invariant:** boot claims records but spawns **no** subprocess; revival happens on first op. No new daemon op; do **not** touch `daemon/server.ts` or the `daemonOp` zod union.
- **Proactive heartbeats are NOT restored** across a restart (non-goal) — do not add code for it.
- **TDD:** failing test → run red → minimal impl → run green → `npm run typecheck` → commit. Every new behavior gets a test.
- **Commits:** to the current branch (`main`); **no `Co-Authored-By`** lines or any attribution.
- **Unit tests are keyless** (DI fakes, `npm run test:unit`). The **one live test is gated** on `ANTHROPIC_API_KEY` and is run by the controller, not the implementer — implementers stop at the clean keyless skip.
- After a subagent edit, phantom LSP "cannot find module / property does not exist" diagnostics are stale — trust a clean `npm run typecheck` + green vitest.

---

### Task 1: Persist the `restart` policy on `SessionRecord`

The supervisor's per-session `restart` posture lives only in memory (`SpawnConfig.restart`); rehydration must reconstruct it after a process restart. Persist it on the record at `spawn()` time.

**Files:**
- Modify: `src/daemon/types.ts` (add one field to `SessionRecord`)
- Modify: `src/daemon/supervisor.ts` (the `spawn()` `registry.register(...)` call)
- Test: `test/unit/daemon-supervisor.test.ts` (add one test)

**Interfaces:**
- Consumes: existing `RestartPolicy = "no" | "on-failure"`, `SpawnConfig { model?: string; restart: RestartPolicy }`.
- Produces: `SessionRecord.restart?: RestartPolicy` — written by `spawn()`, read by Task 2/3.

- [ ] **Step 1: Write the failing test**

In `test/unit/daemon-supervisor.test.ts`, add this test inside the `describe("DaemonSupervisor", …)` block (e.g. right after the `"spawn registers an idle record…"` test):

```ts
  it("spawn persists the restart policy onto the record (for boot-rehydration)", async () => {
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: dir(), restart: "on-failure" });
    const a = sup.spawn();                          // inherits the daemon-wide default
    const b = sup.spawn({ restart: "no" });         // explicit per-session override
    const byId = Object.fromEntries(sup.list().map((r) => [r.id, r.restart]));
    expect(byId[a]).toBe("on-failure");
    expect(byId[b]).toBe("no");
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "persists the restart policy"`
Expected: FAIL — `byId[a]` is `undefined` (record has no `restart` field yet).

- [ ] **Step 3: Add the field to `SessionRecord`**

In `src/daemon/types.ts`, add the `restart?` line to the `SessionRecord` interface (after `model?`):

```ts
export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  restart?: RestartPolicy;   // persisted spawn restart posture, for faithful boot-rehydration
  sessionId?: string;      // the SDK session_id (captured from Session.sessionId), for durable resume (Spec 2)
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;       // count of automatic restarts (D2)
}
```

- [ ] **Step 4: Persist it in `spawn()`**

In `src/daemon/supervisor.ts`, in `spawn()`, add `restart: cfg.restart,` to the `registry.register(...)` call. The line currently reads:

```ts
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model: opts.model, createdAt: t, lastActiveAt: t });
```

Change it to:

```ts
    this.registry.register({ id, daemonPid: process.pid, status: "idle", model: opts.model, restart: cfg.restart, createdAt: t, lastActiveAt: t });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "persists the restart policy"`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): persist restart policy on SessionRecord (boot-rehydration T1)"
```

---

### Task 2: `SessionRegistry.rehydrate(pid)` — claim orphans, reap the rest

A pure registry method (counterpart to `reapStale()`): claim orphaned-but-resumable records for `pid`, reap the unresumable ones, leave records owned by a still-live daemon untouched, and return the claimed records for the supervisor to rebuild in-memory state from.

**Files:**
- Modify: `src/daemon/registry.ts` (add the `rehydrate` method)
- Test: `test/unit/daemon-registry.test.ts` (add one test)

**Interfaces:**
- Consumes: `SessionRecord` (now with `restart?`, Task 1), the registry's injected `isAlive`.
- Produces: `rehydrate(pid: number): SessionRecord[]` — returns the claimed (now `daemonPid=pid`, `status:"idle"`, `restarts:0`) records; mutates the on-disk store (claims/reaps) as a side effect.

- [ ] **Step 1: Write the failing test**

In `test/unit/daemon-registry.test.ts`, add this test inside `describe("SessionRegistry", …)`:

```ts
  it("rehydrate claims orphaned resumable records, reaps the rest, leaves live ones untouched", () => {
    const r = new SessionRegistry({ dir: dir(), isAlive: (pid) => pid === 100 });   // only pid 100 is alive
    r.register({ ...rec("live", 100), sessionId: "s-live" });                                // alive daemon → untouched
    r.register({ ...rec("idle-ok", 999), sessionId: "s1" });                                 // orphaned + resumable → claim
    r.register({ ...rec("busy-ok", 999), status: "busy", sessionId: "s2" });                 // orphaned busy → claim + normalize
    r.register({ ...rec("restarting-ok", 999), status: "restarting", sessionId: "s3" });     // orphaned restarting → claim
    r.register({ ...rec("no-sid", 999) });                                                   // orphaned, no sessionId → reap
    r.register({ ...rec("errored", 999), status: "errored", sessionId: "s4" });              // orphaned errored → reap
    const claimed = r.rehydrate(200).map((x) => x.id).sort();
    expect(claimed).toEqual(["busy-ok", "idle-ok", "restarting-ok"]);
    for (const id of claimed) expect(r.get(id)).toMatchObject({ daemonPid: 200, status: "idle", restarts: 0 });
    expect(r.list().map((x) => x.id).sort()).toEqual(["busy-ok", "idle-ok", "live", "restarting-ok"]); // reaped gone
    expect(r.get("live")).toMatchObject({ daemonPid: 100, sessionId: "s-live" });            // live record untouched
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/daemon-registry.test.ts -t "rehydrate"`
Expected: FAIL — `r.rehydrate` is not a function.

- [ ] **Step 3: Implement `rehydrate`**

In `src/daemon/registry.ts`, add this method to the `SessionRegistry` class, immediately after `reapStale()` (and before the private `path()` method):

```ts
  /** Boot adoption: claim orphaned-but-resumable records for `pid` (normalize status to idle, reset the
   *  restart budget), reap the rest (errored / never-took-a-turn), and return the claimed records. Records
   *  owned by a still-live daemon are left untouched (shared registry dir). Counterpart to reapStale(). */
  rehydrate(pid: number): SessionRecord[] {
    const claimed: SessionRecord[] = [];
    for (const r of this.list()) {
      if (this.isAlive(r.daemonPid)) continue;                                                  // a live daemon owns it
      const resumable = !!r.sessionId && (r.status === "idle" || r.status === "busy" || r.status === "restarting");
      if (!resumable) { this.remove(r.id); continue; }                                          // errored / no transcript → reap
      const next: SessionRecord = { ...r, daemonPid: pid, status: "idle", restarts: 0 };
      this.register(next); claimed.push(next);
    }
    return claimed;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/daemon-registry.test.ts -t "rehydrate"`
Expected: PASS.

- [ ] **Step 5: Run the full registry suite (no regression in reapStale/list/etc.)**

Run: `npx vitest run test/unit/daemon-registry.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/registry.ts test/unit/daemon-registry.test.ts
git commit -m "feat(harness): SessionRegistry.rehydrate — claim orphans, reap the rest (boot-rehydration T2)"
```

---

### Task 3: Supervisor lazy rehydration — flag, `ensureLive` seam, guard swaps

Wire it together: a `DaemonOptions.rehydrate` flag (default off) and an `isAlive` injection seam; a boot branch that calls `registry.rehydrate`, reconstructs `configs`, populates a `rehydratable` Set, and advances `seq`; an `ensureLive(id)` helper that revives a claimed session on first access; and routing the user-facing op guards through it. `stop()` clears the flag without reviving.

**Files:**
- Modify: `src/daemon/types.ts` (add `rehydrate?` + `isAlive?` to `DaemonOptions`)
- Modify: `src/daemon/supervisor.ts` (field, constructor, `ensureLive`, 8 guard swaps, `stop()`)
- Test: `test/unit/daemon-supervisor.test.ts` (add the boot-rehydration tests + imports)

**Interfaces:**
- Consumes: `SessionRegistry.rehydrate(pid)` (Task 2), `SessionRecord.restart` (Task 1), existing `makeSession(id, cfg, resume?)`, `SpawnConfig { model?; restart }`, `this.restartPolicy`, `this.seq`, `this.configs`, `this.pool`.
- Produces: `DaemonOptions.rehydrate?: boolean`, `DaemonOptions.isAlive?: (pid: number) => boolean`; private `ensureLive(id): DaemonSession | undefined`; private field `rehydratable: Set<string>`.

- [ ] **Step 1: Add the test-double helper + imports, then write the failing tests**

In `test/unit/daemon-supervisor.test.ts`, add two imports near the existing ones at the top:

```ts
import { SessionRegistry } from "../../src/daemon/registry.js";
import type { SessionRecord } from "../../src/daemon/types.js";
```

Add this seed helper next to the other top-level helpers (after `captureInitQuery`):

```ts
// seed a registry dir with a record as if a prior (dead) daemon had owned it
function seed(d: string, rec: Partial<SessionRecord> & { id: string }) {
  new SessionRegistry({ dir: d }).register(
    { daemonPid: 999999, status: "idle", createdAt: 1, lastActiveAt: 1, ...rec } as SessionRecord,
  );
}
```

Then add this `describe` block inside the outer `describe("DaemonSupervisor", …)` (e.g. at the end, before its closing `});`):

```ts
  // ---- boot-rehydration (lazy, opt-in) ----
  it("rehydrate:true boot claims orphaned records (configs + seq advance) WITHOUT spawning", async () => {
    const d = dir();
    seed(d, { id: "sess-1", sessionId: "sdk-1", model: "m1", restart: "on-failure" });
    seed(d, { id: "sess-3", sessionId: "sdk-3", model: "m3" });
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-x") }, { dir: d, rehydrate: true, isAlive: () => false });
    expect(sink).toHaveLength(0);                                  // LAZY: no subprocess at boot
    expect(sup.list().map((r) => r.id).sort()).toEqual(["sess-1", "sess-3"]);
    expect(sup.spawn()).toBe("sess-4");                           // seq advanced past sess-3 → no id collision
    await sup.shutdown();
  });
  it("submit on a rehydrated id lazily resumes the captured session_id; revive-once reuses it", async () => {
    const d = dir();
    seed(d, { id: "sess-1", sessionId: "sdk-1", model: "m1" });
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-1") }, { dir: d, rehydrate: true, isAlive: () => false });
    expect((await sup.submit("sess-1", "hi", () => {})).result).toBe("did:hi");
    expect(sink).toHaveLength(1);                                 // revived once
    expect(sink[0].resume).toBe("sdk-1");                         // resumed the captured id
    expect(sink[0].model).toBe("m1");                            // reconstructed model
    await sup.submit("sess-1", "again", () => {});                // reuses the live session
    expect(sink).toHaveLength(1);                                 // NOT revived again
    await sup.shutdown();
  });
  it("a rehydrated session keeps its PERSISTED restart policy (crash → resume, not fresh)", async () => {
    const d = dir();
    seed(d, { id: "sess-1", sessionId: "sdk-1", model: "m1", restart: "on-failure" });   // record says on-failure
    const cap: any[] = [];
    let calls = 0;
    const fq = ({ prompt, options }: any) => {
      cap.push(options); calls++;
      if (calls === 1) return (async function* () {                // revived life: init + one turn, then crash
        yield { type: "system", subtype: "init", session_id: "sdk-1" };
        for await (const t of prompt) { yield { type: "result", result: "did:" + t.message.content }; return; }
      })();
      return (async function* () {                                 // restart life: healthy
        yield { type: "system", subtype: "init", session_id: "sdk-1" };
        for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content };
      })();
    };
    let pending: (() => void) | undefined;
    const sup = new DaemonSupervisor({ query: fq }, {              // daemon default restart is "no" — only the RECORD says on-failure
      dir: d, rehydrate: true, isAlive: () => false, scheduleRestart: (fn) => { pending = fn; return () => {}; },
    });
    await sup.submit("sess-1", "hi", () => {});                    // revive → turn → crash
    await flush();
    expect(sup.list()[0].status).toBe("restarting");              // restart scheduled ⇒ the record's policy survived
    pending!();
    expect(cap[1].resume).toBe("sdk-1");                         // restart RESUMES the captured id
    await sup.shutdown();
  });
  it("stop on a claimed-not-live session removes it WITHOUT spawning a subprocess", async () => {
    const d = dir();
    seed(d, { id: "sess-1", sessionId: "sdk-1", model: "m1" });
    const sink: any[] = [];
    const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-1") }, { dir: d, rehydrate: true, isAlive: () => false });
    await sup.stop("sess-1");
    expect(sink).toHaveLength(0);                                 // never revived → no query()
    expect(sup.list()).toEqual([]);                              // record removed
    await sup.shutdown();
  });
  it("rehydrate:false (default) reaps orphaned records; an op on them throws unknown", async () => {
    const d = dir();
    seed(d, { id: "sess-1", sessionId: "sdk-1", model: "m1" });
    const sup = new DaemonSupervisor({ query: fakeQuery }, { dir: d, isAlive: () => false });   // no rehydrate flag
    expect(sup.list()).toEqual([]);                              // reapStale removed the orphan
    await expect(sup.submit("sess-1", "x", () => {})).rejects.toThrow(/unknown session/);
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "rehydrat"`
Expected: FAIL — `rehydrate`/`isAlive` options are not wired; `submit` on a seeded id throws `unknown session`.

- [ ] **Step 3: Add the two `DaemonOptions` fields**

In `src/daemon/types.ts`, add to the `DaemonOptions` interface (e.g. after the `backoffMs`/`maxBackoffMs` lines, or anywhere in the interface):

```ts
  rehydrate?: boolean;     // adopt orphaned sessions on boot (resume on first access) instead of reaping them; default false
  isAlive?: (pid: number) => boolean; // override the daemonPid-liveness check (testing seam; default process.kill(pid,0))
```

- [ ] **Step 4: Add the `rehydratable` field**

In `src/daemon/supervisor.ts`, add the field next to the other private maps/sets (immediately after `private configs = new Map<string, SpawnConfig>();`):

```ts
  private rehydratable = new Set<string>();           // ids claimed at boot, awaiting first-access revival (boot-rehydration)
```

- [ ] **Step 5: Thread `isAlive` into the registry and add the boot branch**

In `src/daemon/supervisor.ts`, in the constructor, change the registry construction line:

```ts
    this.registry = new SessionRegistry({ dir: opts.dir });
```

to:

```ts
    this.registry = new SessionRegistry({ dir: opts.dir, isAlive: opts.isAlive });
```

Then replace this single line:

```ts
    this.registry.reapStale(); // clear records orphaned by a prior crash
```

with the boot branch:

```ts
    if (opts.rehydrate) {                              // adopt the prior process's sessions (lazy: no subprocess here)
      for (const rec of this.registry.rehydrate(process.pid)) {
        this.configs.set(rec.id, { model: rec.model, restart: rec.restart ?? this.restartPolicy });
        this.rehydratable.add(rec.id);
        const n = Number(rec.id.replace(/^sess-/, ""));
        if (Number.isFinite(n) && n > this.seq) this.seq = n;    // mint new ids past rehydrated ones → no collision
      }
    } else {
      this.registry.reapStale();                      // default: clear records orphaned by a prior crash
    }
```

- [ ] **Step 6: Add the `ensureLive` seam**

In `src/daemon/supervisor.ts`, add this private method immediately before `private makeSession(`:

```ts
  /** Return the live session for `id`, reviving it from a boot-claimed record on first access (lazy
   *  rehydration). Returns the pool entry (even if ended — callers still check isEnded()), a freshly
   *  resumed session for a rehydratable id, or undefined when neither exists. */
  private ensureLive(id: string): DaemonSession | undefined {
    const live = this.pool.get(id);
    if (live) return live;
    if (!this.rehydratable.has(id)) return undefined;
    this.rehydratable.delete(id);                                  // revive once
    const rec = this.registry.get(id);
    if (!rec?.sessionId) return undefined;                         // defensive — rehydrate() guaranteed a sessionId
    const cfg = this.configs.get(id) ?? { model: rec.model, restart: this.restartPolicy };
    const s = this.makeSession(id, cfg, rec.sessionId);            // resume the captured sdk session
    this.pool.set(id, s);
    return s;
  }
```

- [ ] **Step 7: Route the 8 user-facing op guards through `ensureLive`**

In `src/daemon/supervisor.ts`, in **each** of the following 8 methods, change the lookup line `const session = this.pool.get(id);` to `const session = this.ensureLive(id);`. Anchor each edit on the method's signature line directly above it so you edit the right one (do **NOT** change `runProactiveTurn` or `stop`).

`submit`:
```ts
  async submit(id: string, prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }> {
    const session = this.ensureLive(id);
```
`control`:
```ts
  async control(id: string, frame: ControlFrame): Promise<ControlResponse> {
    const session = this.ensureLive(id);
```
`compact`:
```ts
  async compact(id: string): Promise<CompactOutcome> {
    const session = this.ensureLive(id);
```
`usage`:
```ts
  async usage(id: string): Promise<unknown> {
    const session = this.ensureLive(id);
```
`initializationResult`:
```ts
  async initializationResult(id: string): Promise<unknown> {
    const session = this.ensureLive(id);
```
`applyFlagSettings`:
```ts
  async applyFlagSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    const session = this.ensureLive(id);
```
`fork`:
```ts
  async fork(id: string): Promise<{ id: string; sessionId: string }> {
    const session = this.ensureLive(id);
```
`startProactive`:
```ts
  startProactive(id: string, config?: ProactiveConfigInput): ProactiveStatus {
    const session = this.ensureLive(id);
```

- [ ] **Step 8: Clear the flag in `stop()` (without reviving)**

In `src/daemon/supervisor.ts`, in `stop()`, add a single line to drop the pending-revival flag. The method begins:

```ts
  async stop(id: string): Promise<void> {
    const session = this.pool.get(id);                       // NOT ensureLive — never spawn just to dispose
    if (!session && !this.registry.get(id)) throw new DaemonError(`unknown session ${id}`);
```

Add `this.rehydratable.delete(id);` immediately after the guard line (keep the rest of `stop()` unchanged):

```ts
  async stop(id: string): Promise<void> {
    const session = this.pool.get(id);                       // NOT ensureLive — never spawn just to dispose
    if (!session && !this.registry.get(id)) throw new DaemonError(`unknown session ${id}`);
    this.rehydratable.delete(id);                            // drop any pending boot-revival flag
```

(Also add the `// NOT ensureLive …` comment to the existing `this.pool.get(id)` line as shown, to document why it is not routed through `ensureLive`.)

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "rehydrat"`
Expected: PASS (all 5 boot-rehydration tests).

- [ ] **Step 10: Run the FULL supervisor suite (the guard swaps must not regress)**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts`
Expected: all PASS — the existing control/compact/usage/fork/proactive tests exercise the swapped guards on normally-spawned (pooled) sessions and confirm `ensureLive` returns the pool entry unchanged.

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): lazy boot-rehydration via ensureLive seam + rehydrate flag (boot-rehydration T3)"
```

---

### Task 4: Gated live end-to-end (real cross-instance rehydration)

Prove the whole path against the real SDK: plant a codeword in a real session, hand the registry a **dead-pid** record pointing at that session, then boot a fresh supervisor with `rehydrate:true` and confirm a `submit` recalls the codeword.

**Files:**
- Create: `test/live/daemon-boot-rehydration.test.ts`

**Interfaces:**
- Consumes: real `query` from the SDK; `SessionRegistry` (Task 2 record shape); `DaemonSupervisor` with `{ rehydrate: true }` (Task 3).
- Produces: nothing (test only).

- [ ] **Step 1: Write the gated live test**

Create `test/live/daemon-boot-rehydration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SessionRegistry } from "../../src/daemon/registry.js";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live daemon boot-rehydration (real SDK)", () => {
  it("a restarted daemon rehydrates an orphaned record and resumes its context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-rehydrate-live-"));   // shared cwd → same transcript location
    const regDir = mkdtempSync(join(tmpdir(), "cc-daemon-"));
    // 1) Plant a codeword in a real session; capture its real session_id (the "prior daemon's" session).
    let sessionId: string | undefined;
    for await (const m of query({
      prompt: "Remember this codeword: HERON9. Reply with just OK.",
      options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1, cwd },
    })) {
      if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
      if ("result" in m) break;
    }
    expect(sessionId).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // 2) Seed the registry as a DEAD prior daemon's orphan (pid 999999 is unused on darwin → reads as dead).
    new SessionRegistry({ dir: regDir }).register({
      id: "sess-1", daemonPid: 999999, status: "idle", sessionId, model: MODEL, createdAt: 1, lastActiveAt: 1,
    });
    // 3) A fresh daemon boots with rehydrate:true → claims the orphan; the first submit resumes it.
    const sup = new DaemonSupervisor({ query }, {
      dir: regDir, rehydrate: true,
      sessionOptions: () => ({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true, cwd }),
    });
    try {
      expect(sup.list()[0]).toMatchObject({ id: "sess-1", daemonPid: process.pid, status: "idle" }); // claimed
      const r = await sup.submit("sess-1", "What codeword did I give you earlier? Reply with just the word.", () => {});
      expect(String(r.result)).toMatch(/HERON9/);
    } finally {
      await sup.shutdown();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(regDir, { recursive: true, force: true });
    }
  }, 90_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key (implementer stops here)**

Run: `npm run test:unit` (the unit suite must stay green) and confirm the live file is **not** picked up by the unit runner. Without `ANTHROPIC_API_KEY`, `describe.skip` makes the live test a clean skip.
Expected: unit suite all PASS; no attempt to call the network.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add test/live/daemon-boot-rehydration.test.ts
git commit -m "test(harness): gated live boot-rehydration e2e (real cross-instance resume) (boot-rehydration T4)"
```

> **Controller note (not an implementer step):** after Task 4, run the live test keyed to confirm the real path:
> `set -a; . ../.env; set +a; npx vitest run test/live/daemon-boot-rehydration.test.ts`

---

## Post-implementation (controller)

After all four tasks pass review:
- Run the full unit suite: `npm run test:unit` (expect all green, +~7 tests).
- Run the gated live test keyed (controller only), per the note above.
- Refresh `docs/parity/coverage.md` (domain 5 session — boot-rehydration now CLOSED; update the "Remaining session deferrals" note) and the `harden-and-ship-over-phase3` + `sdk-session-store-introspection-verified` memories.

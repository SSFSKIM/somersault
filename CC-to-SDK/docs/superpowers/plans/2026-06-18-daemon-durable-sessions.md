# Daemon Durable Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon capture the SDK `session_id` onto each session's registry record and use it so an on-failure `restart()` **resumes the conversation with context intact** instead of starting fresh (the bug at `supervisor.ts:248`).

**Architecture:** Three edit sites in the daemon, all leaning on Spec 1's already-shipped `Session.sessionId` getter. (1) `SessionRecord` gains an optional `sessionId`. (2) `supervisor.submit()` persists `session.sessionId` onto the record once a turn completes. (3) `supervisor.restart()` reads `record.sessionId` and passes it as `resume` to `makeSession` (which already accepts a `resume` param). This is a **link, not a swap** — the registry stays the operational/liveness store; the SDK keeps owning the transcript (default disk persistence).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178`, Vitest. Reuses `Session.sessionId` (`src/session/session.ts`, Spec 1 — populated after the first turn's `init` frame), the daemon `SessionRegistry` (`src/daemon/registry.ts`), and the existing `makeSession(id, cfg, resume?)` seam.

## Global Constraints

- **Working dir:** `CC-to-SDK/harness/`. Every `npx`/`npm`/`git` command runs from there.
- **ESM specifiers:** every relative import ends in `.js`. **No Prettier** — match the dense one-line-method house style of `src/daemon/supervisor.ts`.
- **DI by deps:** production takes `{ query }`; unit tests inject a fake `QueryFn` (an async generator over the `prompt` async-iterable). For Spec 2, the fake MUST emit a `system/init` frame carrying a `session_id` for the id to be captured. Unit tests NEVER hit the network.
- **`Session.sessionId` (Spec 1, shipped):** `get sessionId(): string | undefined` — captured capture-once from the FIRST `system/init` frame, `undefined` until the first turn produces one. `DaemonSession` inherits it. The supervisor reads `session.sessionId` AFTER `await session.submit(...)` resolves (by then the init frame, which precedes the result, has been processed).
- **Restart resumes the CAPTURED id, not the spawn-time hint:** `restart()` resumes `record.sessionId` (the SDK's real id from a prior turn). If none was captured (session died before its first turn completed), `resume` is `undefined` and restart stays fresh — graceful degradation, the only honest option with no transcript to resume.
- **Link, not swap (spec §1/§8):** do NOT replace/slim the `SessionRegistry`, do NOT change `reapStale`, do NOT add a new persistence substrate, do NOT set `persistSession:false` (default disk persistence is the substrate). Only ADD `sessionId` and use it.
- **Teardown-liveness:** add no new promise/timer/await to the restart path — only change the options `makeSession` receives. The existing restart guards (`stopping`, `cancelRestart`, `shuttingDown`, the synchronous-scheduler race handling) stay exactly as they are.
- **Out of scope (spec §8):** surviving a full daemon *process* restart (boot rehydration); persisting the id from proactive ticks; `forkSession` (Spec 3); any `Session` engine change (Spec 1 owns that).
- **Commits:** to the current branch `main`, **no `Co-Authored-By` / attribution lines**, **never push**.
- **Commands:** unit test a file → `npx vitest run test/unit/<file>` (add `-t "<name>"` to filter); typecheck → `npm run typecheck`. Live tests gate on `ANTHROPIC_API_KEY` and SKIP without it (the implementer sees them skipped — expected green; the controller runs the keyed pass).

---

### Task 1: Persist the captured `session_id` onto the record

`SessionRecord` gains `sessionId`; `supervisor.submit()` writes `session.sessionId` into the record after a turn completes.

**Files:**
- Modify: `src/daemon/types.ts` (add one field to `SessionRecord`)
- Modify: `src/daemon/supervisor.ts` (the `submit()` success-branch `registry.update`)
- Modify: `test/unit/daemon-supervisor.test.ts` (add one helper + one test)

**Interfaces:**
- Consumes: `Session.sessionId` (Spec 1, inherited by `DaemonSession`); `SessionRegistry.update(id, patch)` (read-merge-write).
- Produces: `SessionRecord.sessionId?: string` — read by Task 2's `restart()`.

- [ ] **Step 1: Write the failing test**

Add this helper near the other fake-query helpers at the top of `test/unit/daemon-supervisor.test.ts` (after `controllableQuery`, before `describe`):

```ts
// emits a system/init frame (carrying session_id) then a result, per turn — so Session captures sessionId
function initQuery(sid: string) {
  return ({ prompt }: any) => (async function* () {
    for await (const t of prompt) {
      yield { type: "system", subtype: "init", session_id: sid };
      yield { type: "result", result: "did:" + t.message.content };
    }
  })();
}
```

Add this test inside the `describe("DaemonSupervisor", …)` block (place it just before the existing `"spawn({resume}) threads resume…"` test):

```ts
it("submit persists the captured SDK session_id onto the record", async () => {
  const sup = new DaemonSupervisor({ query: initQuery("sdk-abc") }, { dir: dir() });
  const id = sup.spawn();
  expect(sup.list()[0].sessionId).toBeUndefined();   // unknown before the first turn
  await sup.submit(id, "hi", () => {});
  expect(sup.list()[0].sessionId).toBe("sdk-abc");   // captured from the turn's init frame + persisted
  await sup.shutdown();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "persists the captured"`
Expected: FAIL — `expected undefined to be "sdk-abc"` (the record never stores `sessionId` yet).

- [ ] **Step 3: Add the `sessionId` field to `SessionRecord`**

In `src/daemon/types.ts`, add the field after `model?: string;`:

```ts
export interface SessionRecord {
  id: string;
  daemonPid: number;
  status: SessionStatus;
  model?: string;
  sessionId?: string;      // the SDK session_id (captured from Session.sessionId), for durable resume (Spec 2)
  createdAt: number;
  lastActiveAt: number;
  restarts?: number;       // count of automatic restarts (D2)
}
```

- [ ] **Step 4: Persist the id in `submit()`**

In `src/daemon/supervisor.ts`, the `submit()` method's success branch currently reads:

```ts
      const r = await session.submit(prompt, onMessage);
      this.registry.update(id, { status: "idle", lastActiveAt: session.lastActiveAt });
      return r;
```

Replace the `registry.update` line with (spread the id ONLY when known, so we never write `sessionId: undefined`):

```ts
      const r = await session.submit(prompt, onMessage);
      this.registry.update(id, { status: "idle", lastActiveAt: session.lastActiveAt, ...(session.sessionId ? { sessionId: session.sessionId } : {}) });
      return r;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS (the new test + all existing supervisor tests still green); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): persist captured SDK session_id onto SessionRecord (spec 2 task 1)"
```

---

### Task 2: Restart resumes the persisted session instead of going fresh

`restart()` reads `record.sessionId` and threads it as `resume`. Reframe the existing "stays fresh" test to the graceful-degradation path it actually exercises, and add the resume-path test.

**Files:**
- Modify: `src/daemon/supervisor.ts` (the `restart()` method)
- Modify: `test/unit/daemon-supervisor.test.ts` (add the resume-path test; reframe the existing fresh-restart test)

**Interfaces:**
- Consumes: `SessionRecord.sessionId` (Task 1); `makeSession(id, cfg, resume?)` (existing — already applies `resume` via `base.resume`); the `initQuery` helper (Task 1).
- Produces: on-failure restart now resumes the captured SDK session.

- [ ] **Step 1: Write the failing resume-path test**

Add this test inside the `describe("DaemonSupervisor", …)` block, directly after the `"submit persists the captured SDK session_id…"` test (Task 1):

```ts
it("auto-restart RESUMES the captured session_id (context intact, not fresh)", async () => {
  const cap: any[] = [];
  let calls = 0;
  const fq = ({ prompt, options }: any) => {
    cap.push(options); calls++;
    if (calls === 1) return (async function* () {            // life 1: capture an id, take one turn, then crash
      yield { type: "system", subtype: "init", session_id: "sdk-X" };
      for await (const t of prompt) { yield { type: "result", result: "did:" + t.message.content }; return; }
    })();
    return (async function* () {                             // life 2 (restart): healthy
      yield { type: "system", subtype: "init", session_id: "sdk-X" };
      for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content };
    })();
  };
  let pending: (() => void) | undefined;
  const scheduleRestart = (fn: () => void) => { pending = fn; return () => {}; };
  const sup = new DaemonSupervisor({ query: fq }, { dir: dir(), restart: "on-failure", scheduleRestart });
  const id = sup.spawn();
  expect((await sup.submit(id, "hi", () => {})).result).toBe("did:hi");
  expect(sup.list()[0].sessionId).toBe("sdk-X");             // persisted from the turn (Task 1)
  await flush();                                             // life-1 query returned → handleSessionEnd schedules restart
  expect(sup.list()[0].status).toBe("restarting");
  pending!();                                                // fire the restart
  expect(cap[1].resume).toBe("sdk-X");                       // restart RESUMES the captured id, not fresh
  expect(sup.list()[0].status).toBe("idle");
  await sup.shutdown();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "RESUMES the captured"`
Expected: FAIL — `expected undefined to be "sdk-X"` (`cap[1].resume` is undefined because `restart()` still omits `resume`).

- [ ] **Step 3: Make `restart()` resume the captured id**

In `src/daemon/supervisor.ts`, the `restart()` method currently reads:

```ts
  private restart(id: string): void {
    this.restartCancels.delete(id);
    if (this.shuttingDown || this.stopping.has(id) || !this.configs.has(id)) return; // stopped during backoff
    this.pool.set(id, this.makeSession(id, this.configs.get(id)!));
    this.registry.update(id, { status: "idle", lastActiveAt: this.now() });
  }
```

Replace it with (only the `makeSession` call gains a `resume` argument — no new promise/timer/await, guards unchanged):

```ts
  private restart(id: string): void {
    this.restartCancels.delete(id);
    if (this.shuttingDown || this.stopping.has(id) || !this.configs.has(id)) return; // stopped during backoff
    const resume = this.registry.get(id)?.sessionId;       // resume the CAPTURED sdk session (context intact); fresh if none
    this.pool.set(id, this.makeSession(id, this.configs.get(id)!, resume));
    this.registry.update(id, { status: "idle", lastActiveAt: this.now() });
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "RESUMES the captured"`
Expected: PASS.

- [ ] **Step 5: Reframe the existing fresh-restart test to the graceful-degradation path**

The existing test still passes (its dying query emits no `init`, so nothing is captured → restart is correctly fresh), but its name now describes only that path. Replace the existing test — find:

```ts
  it("auto-restart re-creates the session WITHOUT resume (stays fresh)", async () => {
    const sink: any[] = [];
    const dying = ({ options }: any) => { sink.push(options); return (async function* () {})(); };
    const sup = new DaemonSupervisor({ query: dying }, {
      dir: dir(), restart: "on-failure", maxRestarts: 1,
      scheduleRestart: (fn) => { fn(); return () => {}; },
    });
    sup.spawn({ resume: "sess-prior", restart: "on-failure" });
    await new Promise((r) => setTimeout(r, 20)); // let the death→restart cascade drain
    expect(sink[0].resume).toBe("sess-prior");                        // initial spawn carried resume
    expect(sink.length).toBeGreaterThanOrEqual(2);                   // it restarted at least once
    expect(sink.slice(1).every((o) => o.resume === undefined)).toBe(true); // restarts are fresh
    await sup.shutdown();
  });
```

Replace it with (same body, reframed name + comments — it now documents that fresh-restart is the *no-id-captured* path, and that restart resumes the CAPTURED id, not the spawn-time hint):

```ts
  it("auto-restart is fresh ONLY when no session_id was captured (graceful degradation)", async () => {
    // dies before emitting any init frame → no sessionId captured → no transcript to resume → fresh.
    // (Restart resumes the CAPTURED sdk id, NOT the spawn-time resume hint — so the prior 'sess-prior'
    // hint is intentionally not carried into the restart.)
    const sink: any[] = [];
    const dying = ({ options }: any) => { sink.push(options); return (async function* () {})(); };
    const sup = new DaemonSupervisor({ query: dying }, {
      dir: dir(), restart: "on-failure", maxRestarts: 1,
      scheduleRestart: (fn) => { fn(); return () => {}; },
    });
    sup.spawn({ resume: "sess-prior", restart: "on-failure" });
    await new Promise((r) => setTimeout(r, 20)); // let the death→restart cascade drain
    expect(sink[0].resume).toBe("sess-prior");                        // initial spawn carried the resume hint
    expect(sink.length).toBeGreaterThanOrEqual(2);                   // it restarted at least once
    expect(sink.slice(1).every((o) => o.resume === undefined)).toBe(true); // no captured id → fresh restart
    await sup.shutdown();
  });
```

- [ ] **Step 6: Run the full supervisor suite + typecheck**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS (all supervisor tests, including the reframed and new ones); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/supervisor.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): on-failure restart resumes the captured session_id (spec 2 task 2)"
```

---

### Task 3: Live test (gated)

Prove against the real SDK that a daemon turn captures a real (UUID) `session_id` onto the record, and that id is genuinely resumable.

**Files:**
- Create: `test/live/daemon-durable-sessions.test.ts`

**Interfaces:**
- Consumes: `DaemonSupervisor` (`src/daemon/supervisor.js`), `resumeSession` (public barrel, Spec 1), the real SDK `query`.

- [ ] **Step 1: Write the gated live test**

Create `test/live/daemon-durable-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DaemonSupervisor } from "../../src/daemon/supervisor.js";
import { resumeSession } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live daemon durable sessions (real SDK)", () => {
  it("submit persists a real session_id; that id resumes and recalls context", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-durable-live-"));
    // The daemon passes session options through verbatim (it bypasses resolveOptions), so set the
    // bypass flag explicitly; share `cwd` so the resumed session resolves to the same transcript.
    const sup = new DaemonSupervisor(
      { query },
      { dir: mkdtempSync(join(tmpdir(), "cc-daemon-")), sessionOptions: () => ({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true, cwd }) },
    );
    let sessionId: string | undefined;
    try {
      const id = sup.spawn({ model: MODEL });
      await sup.submit(id, "Remember this codeword: FALCON3. Reply OK only.", () => {});
      sessionId = sup.list()[0].sessionId;
      expect(sessionId).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); // a real UUID
    } finally { await sup.shutdown(); }

    const s = resumeSession(sessionId!, { model: MODEL, permissionMode: "bypassPermissions", cwd });
    try {
      const r = await s.submit("What codeword did I give you earlier? Reply with just the word.");
      expect(String(r.result)).toMatch(/FALCON3/);
    } finally { await s.dispose(); rmSync(cwd, { recursive: true, force: true }); }
  }, 90_000);
});
```

- [ ] **Step 2: Run to verify it skips cleanly (no API key in the implementer env)**

Run: `npx vitest run test/live/daemon-durable-sessions.test.ts && npm run typecheck`
Expected: the `live(...)` suite is SKIPPED (0 failures); typecheck clean. (The keyed pass is run by the controller, who loads `../.env`.)

- [ ] **Step 3: Commit**

```bash
git add test/live/daemon-durable-sessions.test.ts
git commit -m "test(harness): gated live test for daemon durable sessions (spec 2 task 3)"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-17-daemon-durable-sessions-design.md`):
- §4.1 `SessionRecord.sessionId?` → Task 1 Step 3. ✓
- §4.2 persist the id after a turn (in `submit()`, conditional spread, not from proactive ticks) → Task 1 Step 4. ✓
- §4.3 `restart()` resumes `record.sessionId` (graceful fallback when absent); teardown-liveness unchanged → Task 2 Steps 3 + 5. ✓
- §6 error handling (missing id → fresh; deleted transcript → SDK's own resume error, no special-casing) → covered by the graceful-degradation test (Task 2 Step 5) and by NOT adding special-casing. ✓
- §7 unit (submit persists id; restart threads `resume=sessionId`; no-id → fresh; existing teardown tests unchanged) → Task 1 + Task 2. Live (record shows a UUID `sessionId`; that id resumes and recalls) → Task 3. ✓
- §8 non-goals (no boot rehydration, no `reapStale` change, no new substrate, no proactive-tick persistence, no `forkSession`, no `Session` engine change) → respected; no task touches them. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to". Every code step shows the exact before/after; every run step shows the command + expected result. ✓

**3. Type consistency:** `SessionRecord.sessionId?: string` (Task 1) is the field `restart()` reads (Task 2) and the live test asserts (Task 3). `session.sessionId` (Spec 1 getter, `string | undefined`) is read in `submit()` and gated by `session.sessionId ?`. `makeSession(id, cfg, resume?)` signature is unchanged (Task 2 only passes the third arg). The `initQuery(sid)` helper (Task 1 Step 1) is reused by Task 2 Step 1's inline fakes (same `{ type:"system", subtype:"init", session_id }` shape). ✓

**Cross-task note for the implementer:** Tasks 1 and 2 both edit `test/unit/daemon-supervisor.test.ts` and `src/daemon/supervisor.ts`; apply each task's edits in order. The `initQuery` helper is added once in Task 1 and reused (not redefined) thereafter.

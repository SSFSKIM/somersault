# Session Forking + Store Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the SDK's `forkSession` as a first-class library function and a daemon `fork` op, so a stored/live session can be branched into a NEW session id for speculative/parallel exploration (the original untouched).

**Architecture:** A thin `src/sessions/fork.ts` wrapper mirrors `sessions/reader.ts` (the `cwd`→`dir` rename + a DI `deps` default) over the SDK `forkSession(id, opts)`. A daemon `fork(id)` op reads the live session's `Session.sessionId` (Spec 1), mints a fork via the (injectable) lib `forkSession`, and spawns a new daemon session resuming the fork id. The "store facade" is just a flat barrel export — `{listSessions, getSessionMessages, getSessionInfo, forkSession}` (browse) + `{openSession, resumeSession}` (live, Spec 1).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178` (`forkSession`, `ForkSessionResult`), Vitest. Reuses `Session.sessionId` (Spec 1, shipped), `openSession`/`resumeSession` (Spec 1), the daemon `spawn({resume})` seam, and the `DaemonDeps` DI pattern.

## Global Constraints

- **Working dir:** `CC-to-SDK/harness/`. Every `npx`/`npm`/`git` command runs from there.
- **ESM specifiers:** every relative import ends in `.js`. **No Prettier** — match the dense house style of `src/sessions/reader.ts` and `src/daemon/supervisor.ts`.
- **DI by deps:** the lib wrapper takes a `deps = { forkSession: sdkForkSession }` default and tests inject a fake. The daemon takes `DaemonDeps.forkSession?` (defaults to the lib fn). Unit tests NEVER hit the network.
- **`forkSession` mints a NEW id (SDK doc, `sdk.d.ts:703-705`):** `ForkSessionResult = { sessionId: string }` is a new UUID distinct from the source; the original session is untouched. Reach the branch via `resumeSession(result.sessionId)`. This is the explicit branch op — distinct from `resume`, which PRESERVES the id.
- **`cwd`→`dir` rename:** the harness convention is `cwd`; the SDK fork fn filters by `dir`. The wrapper's only job is that rename + passthrough of `upToMessageId`/`title` (mirrors `reader.ts`).
- **Daemon fork reads the LIVE session's `Session.sessionId` (Spec 1), NOT the registry record.** `fork(id)` requires a live, pooled, non-ended session (guard like `compact`/`control`). This keeps Spec 3 build-order-independent of Spec 2 (which is the only thing that adds `record.sessionId`).
- **Server reply:** the `fork` op reply SPREADS `{id, sessionId}` under `{ ok: true }` — safe because the fork result has no `ok` field (unlike the compact outcome, which had to nest). `id` is the NEW daemon handle.
- **Out of scope (spec §8):** other session-mutation ops (`deleteSession`/`renameSession`/`tagSession`); an `upToMessageId`-anchor *resolution* helper (we pass it through); any `Session` engine change (Spec 1) or daemon persistence change (Spec 2); boot rehydration.
- **Commits:** to the current branch `main`, **no `Co-Authored-By` / attribution lines**, **never push**.
- **Commands:** unit test a file → `npx vitest run test/unit/<file>` (add `-t "<name>"` to filter); typecheck → `npm run typecheck`. Live tests gate on `ANTHROPIC_API_KEY` and SKIP without it (the implementer sees them skipped — expected green; the controller runs the keyed pass).

---

### Task 1: Lib `forkSession` wrapper + store-facade exports

A `cwd`→`dir` wrapper over the SDK `forkSession`, exported from the sessions barrel and the public API.

**Files:**
- Create: `src/sessions/fork.ts`
- Create: `test/unit/sessions-fork.test.ts`
- Modify: `src/sessions/index.ts` (add fork exports)
- Modify: `src/index.ts:16-17` (add fork to the sessions export lines)
- Modify: `test/unit/index.test.ts` (assert the new export)

**Interfaces:**
- Consumes: SDK `forkSession`/`ForkSessionResult` (`@anthropic-ai/claude-agent-sdk`).
- Produces:
  - `interface ForkSessionOpts { cwd?: string; upToMessageId?: string; title?: string }`
  - `function forkSession(id: string, opts?: ForkSessionOpts, deps?: { forkSession: typeof sdkForkSession }): Promise<ForkSessionResult>` — returns `{ sessionId: string }` (the new id). Consumed by Task 2's daemon `fork`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/sessions-fork.test.ts` (mirrors `sessions-reader.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { forkSession } from "../../src/sessions/fork.js";

describe("forkSession (cwd→dir glue)", () => {
  it("maps cwd→dir and passes id + fork options through", async () => {
    const calls: any[] = [];
    const deps = { forkSession: async (id: string, o: any) => { calls.push([id, o]); return { sessionId: "fork-1" }; } };
    const r = await forkSession("src-9", { cwd: "/proj", upToMessageId: "u5", title: "branch" }, deps as any);
    expect(r).toEqual({ sessionId: "fork-1" });
    expect(calls[0]).toEqual(["src-9", { dir: "/proj", upToMessageId: "u5", title: "branch" }]);
    expect(calls[0][1]).not.toHaveProperty("cwd");
  });
  it("omits dir when no cwd is given", async () => {
    const calls: any[] = [];
    const deps = { forkSession: async (id: string, o: any) => { calls.push([id, o]); return { sessionId: "fork-2" }; } };
    await forkSession("src-9", {}, deps as any);
    expect(calls[0]).toEqual(["src-9", {}]);
    expect(calls[0][1]).not.toHaveProperty("dir");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/sessions-fork.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/sessions/fork.js"`.

- [ ] **Step 3: Create the wrapper**

Create `src/sessions/fork.ts`:

```ts
import { forkSession as sdkForkSession } from "@anthropic-ai/claude-agent-sdk";
import type { ForkSessionResult } from "@anthropic-ai/claude-agent-sdk";

// Harness convention is `cwd`; the SDK fork fn filters by `dir`. This wrapper does that rename + passthrough
// (plus a DI `deps` default for testability), mirroring sessions/reader.ts. `forkSession` mints a NEW session id
// (the original is untouched); reach the branch with resumeSession(result.sessionId). `upToMessageId` truncates
// the copied transcript at that message (inclusive); omitted = full copy.
export interface ForkSessionOpts { cwd?: string; upToMessageId?: string; title?: string; }

export function forkSession(id: string, opts: ForkSessionOpts = {}, deps = { forkSession: sdkForkSession }): Promise<ForkSessionResult> {
  const { cwd, ...rest } = opts;
  return deps.forkSession(id, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run test/unit/sessions-fork.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the barrel + public exports**

In `src/sessions/index.ts`, add the two fork lines after the existing reader exports:

```ts
export { listSessions, getSessionMessages, getSessionInfo } from "./reader.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts } from "./reader.js";
export { forkSession } from "./fork.js";
export type { ForkSessionOpts } from "./fork.js";
```

In `src/index.ts`, the sessions exports are currently two lines (line 16-17):

```ts
export { listSessions, getSessionMessages, getSessionInfo } from "./sessions/index.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts } from "./sessions/index.js";
```

Replace them with (add `forkSession` and `ForkSessionOpts`):

```ts
export { listSessions, getSessionMessages, getSessionInfo, forkSession } from "./sessions/index.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts, ForkSessionOpts } from "./sessions/index.js";
```

- [ ] **Step 6: Assert the public export**

In `test/unit/index.test.ts`, add this line inside the `it(...)` body (after the `api.Session` assertion added by Spec 1):

```ts
    expect(typeof api.forkSession).toBe("function");
```

- [ ] **Step 7: Run the export + wrapper tests + typecheck**

Run: `npx vitest run test/unit/sessions-fork.test.ts test/unit/index.test.ts && npm run typecheck`
Expected: PASS (sessions-fork 2 + index 1); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/sessions/fork.ts test/unit/sessions-fork.test.ts src/sessions/index.ts src/index.ts test/unit/index.test.ts
git commit -m "feat(harness): forkSession lib wrapper + store-facade exports (spec 3 task 1)"
```

---

### Task 2: Daemon `fork` op

A daemon op that branches a live pooled session: resolve its `Session.sessionId`, mint a fork, spawn a new session resuming the fork id.

**Files:**
- Modify: `src/daemon/types.ts` (add `forkOp` to the `daemonOp` union)
- Modify: `src/daemon/supervisor.ts` (import `forkSession`; add `DaemonDeps.forkSession?`; add the `fork(id)` method)
- Modify: `src/daemon/server.ts` (add `case "fork"`)
- Modify: `test/unit/daemon-supervisor.test.ts` (add a `daemonOp` parse assertion + a `fork` test)
- Modify: `test/unit/daemon-server.test.ts` (add a `fork`-over-UDS dispatch test)

**Interfaces:**
- Consumes: `forkSession`/`ForkSessionOpts` (Task 1); `Session.sessionId` (Spec 1, inherited by `DaemonSession`); `this.spawn({ model, resume })` (existing); `DaemonError` (existing).
- Produces: `DaemonSupervisor.fork(id: string): Promise<{ id: string; sessionId: string }>` (`id` = new daemon handle, `sessionId` = the fork's SDK id); a `{ op: "fork", id }` member of `daemonOp`; a server `fork` op replying `{ ok: true, id, sessionId }`.

- [ ] **Step 1: Write the failing supervisor test**

Add this fake-query helper near the other helpers at the top of `test/unit/daemon-supervisor.test.ts` (after `initQuery`):

```ts
// captures each session's options into `sink` AND emits an init frame so Session captures sessionId
function captureInitQuery(sink: any[], sid: string) {
  return ({ prompt, options }: any) => { sink.push(options); return (async function* () {
    for await (const t of prompt) { yield { type: "system", subtype: "init", session_id: sid }; yield { type: "result", result: "did:" + t.message.content }; }
  })(); };
}
```

Add these two tests inside the `describe("DaemonSupervisor", …)` block (place them just after the `"compact(id) delegates…"` / `"compactTool option…"` tests):

```ts
it("daemonOp accepts a fork op", () => {
  expect(daemonOp.safeParse({ op: "fork", id: "s1" }).success).toBe(true);
  expect(daemonOp.safeParse({ op: "fork" }).success).toBe(false);
});
it("fork mints a new session resuming the fork id; rejects pre-turn and unknown ids", async () => {
  const sink: any[] = [];
  const forked: string[] = [];
  const fakeFork = async (sourceId: string) => { forked.push(sourceId); return { sessionId: "fork-of-" + sourceId }; };
  const sup = new DaemonSupervisor({ query: captureInitQuery(sink, "sdk-src"), forkSession: fakeFork }, { dir: dir() });
  const id = sup.spawn({ model: "m1" });
  await expect(sup.fork(id)).rejects.toThrow(/no session_id yet/);   // no turn taken → nothing to fork
  await sup.submit(id, "hi", () => {});                              // captures "sdk-src"
  const res = await sup.fork(id);
  expect(forked).toEqual(["sdk-src"]);                                // forked from the captured id, not a hint
  expect(res.sessionId).toBe("fork-of-sdk-src");
  expect(res.id).not.toBe(id);                                       // a fresh daemon handle
  expect(sink[sink.length - 1].resume).toBe("fork-of-sdk-src");      // new session resumes the fork id
  expect(sink[sink.length - 1].model).toBe("m1");                    // inherits the source's model
  await expect(sup.fork("ghost")).rejects.toThrow(/unknown session/);
  await sup.shutdown();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts -t "fork"`
Expected: FAIL — `daemonOp` rejects `{op:"fork"}` (not in the union yet) and/or `sup.fork is not a function`.

- [ ] **Step 3: Add `forkOp` to the `daemonOp` union**

In `src/daemon/types.ts`, the compact op + union currently read:

```ts
const compactOp = z.object({ op: z.literal("compact"), id: z.string() });

export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp]);
```

Replace them with (add `forkOp` definition + put it in the union):

```ts
const compactOp = z.object({ op: z.literal("compact"), id: z.string() });
const forkOp = z.object({ op: z.literal("fork"), id: z.string() });

export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp, forkOp]);
```

- [ ] **Step 4: Add the `forkSession` dep + the `fork(id)` method**

In `src/daemon/supervisor.ts`, add the import next to the existing reader import (`import { listSessions, getSessionMessages } from "../sessions/reader.js";`):

```ts
import { forkSession } from "../sessions/fork.js";
```

In the `DaemonDeps` interface, add the `forkSession?` field after `getSessionMessages?`:

```ts
export interface DaemonDeps {
  query: QueryFn;
  listSessions?: (opts?: Parameters<typeof listSessions>[0]) => Promise<unknown[]>;
  getSessionMessages?: (id: string, opts?: Parameters<typeof getSessionMessages>[1]) => Promise<unknown[]>;
  forkSession?: (id: string, opts?: Parameters<typeof forkSession>[1]) => Promise<{ sessionId: string }>;
}
```

Add the `fork(id)` method directly after the existing `compact(id)` method (same guard shape):

```ts
async fork(id: string): Promise<{ id: string; sessionId: string }> {
  const session = this.pool.get(id);
  if (!session || session.isEnded()) {
    const rec = this.registry.get(id);
    throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`);
  }
  const sourceSdkId = session.sessionId;   // Spec 1 capture; a live session has it after its first turn
  if (!sourceSdkId) throw new DaemonError(`session ${id} has no session_id yet (take a turn first)`);
  const { sessionId } = await (this.deps.forkSession ?? forkSession)(sourceSdkId);
  const handle = this.spawn({ model: this.configs.get(id)?.model, resume: sessionId }); // new daemon session on the branch
  return { id: handle, sessionId };
}
```

- [ ] **Step 5: Run the supervisor test to verify it passes**

Run: `npx vitest run test/unit/daemon-supervisor.test.ts && npm run typecheck`
Expected: PASS (the two new tests + all existing supervisor tests); typecheck clean.

- [ ] **Step 6: Add the server `case "fork"`**

In `src/daemon/server.ts`, add the `fork` case directly after the `compact` case (`case "compact": …`):

```ts
        case "fork": send({ ok: true, ...await this.supervisor.fork(op.id) }); sock.end(); break;
```

- [ ] **Step 7: Write + run the server dispatch test**

Add this test inside the `describe("DaemonServer over a real UDS", …)` block in `test/unit/daemon-server.test.ts`:

```ts
  it("fork op over UDS: captures sessionId on a turn, forks, replies { ok, id, sessionId }", async () => {
    const d = tmp();
    const sock = join(d, "sock");
    const initFakeQuery = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) { yield { type: "system", subtype: "init", session_id: "sdk-src" }; yield { type: "result", result: "did:" + t.message.content }; }
    })();
    const sup = new DaemonSupervisor({ query: initFakeQuery, forkSession: async (sid: string) => ({ sessionId: "fork-" + sid }) }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    const id = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    await daemonRequest(sock, { op: "submit", id, prompt: "hi" }, () => {});   // capture sessionId
    const fork = await daemonRequest(sock, { op: "fork", id });
    expect(fork[0].ok).toBe(true);
    expect(fork[0].sessionId).toBe("fork-sdk-src");
    expect(fork[0].id).not.toBe(id);
    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
```

Run: `npx vitest run test/unit/daemon-server.test.ts && npm run typecheck`
Expected: PASS (the new fork test + the existing round-trip tests); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts src/daemon/server.ts test/unit/daemon-supervisor.test.ts test/unit/daemon-server.test.ts
git commit -m "feat(harness): daemon fork op — branch a live session into a resumed fork (spec 3 task 2)"
```

---

### Task 3: Live test (gated)

Prove against the real SDK that a fork branches a session: the fork recalls history up to the fork point, and the original's later turns do NOT leak into it.

**Files:**
- Create: `test/live/session-forking.test.ts`

**Interfaces:**
- Consumes: `openSession`, `resumeSession`, `forkSession` (public barrel — Spec 1 + Task 1).

- [ ] **Step 1: Write the gated live test**

Create `test/live/session-forking.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, resumeSession, forkSession } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live session forking (real SDK)", () => {
  it("fork branches a session: the fork recalls history; the original's later turns don't leak in", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-fork-live-"));
    const orig = openSession({ model: MODEL, permissionMode: "bypassPermissions", cwd });
    let srcId: string | undefined;
    let forkId: string | undefined;
    try {
      await orig.submit("Remember this codeword: ZEBRA. Reply OK only.");
      srcId = orig.sessionId;
      expect(srcId).toBeTruthy();
      const res = await forkSession(srcId!, { cwd });          // fork AFTER ZEBRA, BEFORE MANGO
      forkId = res.sessionId;
      expect(forkId).toBeTruthy();
      expect(forkId).not.toBe(srcId);                          // fork mints a NEW id
      await orig.submit("Also remember a second codeword: MANGO. Reply OK only."); // original-only, post-fork
    } finally { await orig.dispose(); }

    const branch = resumeSession(forkId!, { model: MODEL, permissionMode: "bypassPermissions", cwd });
    try {
      const r = await branch.submit("List every codeword I gave you. Reply with just the words.");
      expect(String(r.result)).toMatch(/ZEBRA/);              // the fork carries history up to the fork point
      expect(String(r.result)).not.toMatch(/MANGO/);          // the original's later turn did NOT leak into the branch
    } finally { await branch.dispose(); rmSync(cwd, { recursive: true, force: true }); }
  }, 120_000);
});
```

- [ ] **Step 2: Run to verify it skips cleanly (no API key in the implementer env)**

Run: `npx vitest run test/live/session-forking.test.ts && npm run typecheck`
Expected: the `live(...)` suite is SKIPPED (0 failures); typecheck clean. (The keyed pass is run by the controller, who loads `../.env`.)

- [ ] **Step 3: Commit**

```bash
git add test/live/session-forking.test.ts
git commit -m "test(harness): gated live test for session forking (spec 3 task 3)"
```

---

## Self-Review

**1. Spec coverage** (against `2026-06-17-session-forking-design.md`):
- §4.1 `src/sessions/fork.ts` `forkSession(id, opts?, deps?)` with `cwd`→`dir` + DI default, returns `{ sessionId }` → Task 1 Step 3. ✓
- §4.2 store-facade exports (`sessions/index.ts` + `src/index.ts`, flat barrel) → Task 1 Step 5. ✓
- §4.3 daemon `fork` op — `types.ts` `forkOp`, `supervisor.fork(id)` (reads `session.sessionId`, guards like `compact`, spawns resuming the fork id, returns `{id, sessionId}`), `DaemonDeps.forkSession?` DI, `server.ts` `case "fork"` spreading `{id, sessionId}` → Task 2 Steps 3/4/6. ✓
- §6 error handling (pre-turn → `no session_id yet`; unknown/ended → guard; SDK rejects unknown source → `{ok:false,error}` via existing try/catch; `maxSessions` cap via `spawn`) → Task 2 (the `fork` guards + reusing `spawn`). ✓
- §7 unit (wrapper delegates + `cwd`→`dir`; `daemonOp` parses fork; `supervisor.fork` delegates/spawns/rejects; server dispatch) → Tasks 1 & 2. Live (fork new-id + branch-recall + branch-independence) → Task 3. ✓
- §8 non-goals (no other mutation ops, no anchor-resolution helper, no reader rewrap, no Session/persistence change, no boot rehydration) → respected; no task touches them. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to". Every code step shows complete code; every run step shows the command + expected result. ✓

**3. Type consistency:** `forkSession(id, opts?, deps?) → Promise<ForkSessionResult>` (`{ sessionId: string }`) is defined in Task 1 and consumed by Task 2's `(this.deps.forkSession ?? forkSession)(sourceSdkId)` (destructuring `{ sessionId }`). `DaemonSupervisor.fork(id): Promise<{ id: string; sessionId: string }>` matches the server's `send({ ok: true, ...await this.supervisor.fork(op.id) })` and the server/supervisor tests' `{ id, sessionId }` assertions. `ForkSessionOpts` (`{ cwd?, upToMessageId?, title? }`) is the wrapper's option type and `Parameters<typeof forkSession>[1]` in `DaemonDeps`. `session.sessionId` is Spec 1's getter (`string | undefined`), gated by the `no session_id yet` check. ✓

**Cross-task note for the implementer:** Task 1 adds `forkSession` to BOTH `src/sessions/index.ts` and `src/index.ts`, and the `api.forkSession` assertion to `index.test.ts`. Task 2's `captureInitQuery` helper is added once in `daemon-supervisor.test.ts`. The daemon fork reads `session.sessionId` (live, Spec 1) — it does NOT read the Spec 2 `record.sessionId`, so this plan is independent of Spec 2.

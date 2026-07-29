# Agent app-server M2a — spine + controls + session library (waves 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Waves 0–2 of the M2 spec ([`docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`](../specs/2026-07-30-agent-appserver-m2-design.md)): the carried-debt spine (fan-out, threadView, cursors, error codes, shutdown hygiene), the settings mirror + frame router with the four setters and five introspection reads, and the session library (store-merged list, fork/rename/tag/delete, compact-as-turn, reinitialize).

**Architecture:** Every task re-projects an existing lib `Session` capability onto the JSON-RPC wire — no new engine capability. Handler modules stay small (`settings.ts`, `introspect.ts`, `sessionLib.ts`, `router.ts`, `fanout.ts`); `server.ts` stays dispatcher + lifecycle. Zod schemas move to `appserver/schema/` (the schema IS the validator). One frame-router per thread replaces the two existing single-purpose `onFrame` watchers.

**Tech Stack:** TypeScript (ESM, NodeNext), zod v4 (`zod/v4`), vitest, `ws`. All commands run from `CC-to-SDK/harness/`.

## Global Constraints

- Spec: `CC-to-SDK/docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`. Parent protocol spec `2026-07-28-...-protocol-design.md` §5/§7/§8 govern wire shapes.
- **Engine-faithful fakes** (spec Testing, verbatim): "fakes model the engine's awkward timing — `sessionId` undefined until the first init frame, `dispose()` awaiting parked decisions, frames arriving between turns, setters resolving after a delay. Every guard test is proven by reverting its guard."
- Error codes (spec Wave 0, verbatim): mint `-33007 shuttingDown`; `-33005 engineGone` fires via `isEnded()` (never message-matching); `-33006` stays defined-unemitted; `-32001 overloaded` becomes N/A-deferred.
- `thread/read` limit: **`limit ≤ 500` (clamped, not rejected)**, clamp emits a `warning` notification.
- Notification envelope: every notification carries `emittedAtMs` (existing `Peer.notify` behavior — do not bypass `Peer.notify`).
- Settings-changed shape (spec Wave 1, verbatim): `thread/settings/changed {threadId, model, permissionMode, thinkingTokens, source: "client" | "engine"}` — one shape, all three knobs.
- No `Co-Authored-By` or attribution lines in commit messages.
- Commit prefix: `feat(as2a):` / `fix(as2a):` / `test(as2a):`.
- Keyed live tests (`test/live/`) are **controller-run** — implementers run unit tests only. Probe 6 (Task 1, file `probes/probes/70-usermessage-uuid.ts`) is likewise controller-run.
- Unit test commands: `npm run test:unit -- test/unit/appserver/<file>.test.ts` (single file) / `npm run test:unit` (all unit) / `npm run typecheck`. From `CC-to-SDK/harness/`.

## File Structure (whole plan)

```
harness/src/appserver/
  schema/
    core.ts        # initialize/server-status/common shapes (threadId param, cursor param)
    threads.ts     # thread/* params (start, resume, list, read, close, name/set, tag/set, delete, fork, compact, reinitialize)
    turns.ts       # turn/* params (start, interrupt)
    decisions.ts   # decision/* params (outcome union, respond)
    settings.ts    # thread/model|permissionMode|thinking/set + settings/apply params
    index.ts       # methodSchemas: Record<method, {params: ZodType}> — Wave 4's generation walks this
  fanout.ts        # server-scoped watcher fan-out (watchThreads) + notification opt-out filtering
  router.ts        # per-thread frame router (absorbs latchSessionId + planUpgrade consult)
  settings.ts      # the four setter handlers + settings mirror write-back
  introspect.ts    # the five read handlers
  sessionLib.ts    # store-merged list, fork, rename, tag, delete
  lifecycle.ts     # thread/compact/start + thread/reinitialize (compact-as-turn)
```

`registry.ts` gains fields + widened `EngineSession`; `server.ts` sheds its inline schemas and gains the new handler table entries; `turns.ts` exports its turn-spine pieces for compact-as-turn; `subscribe.ts` gains row-paging; `serveMain.ts` gains run-file cleanup.

---

### Task 1: Probe 6 — caller-supplied `SDKUserMessage.uuid` passthrough (spike, controller-run)

The Wave-0 dependency: Task 6's userMessage item id branches on this verdict.

**Files:**
- Create: `CC-to-SDK/probes/probes/70-usermessage-uuid.ts` (probe workspace has its own `package.json` + SDK dep; run from `CC-to-SDK/probes`)

**Question:** does a caller-supplied `uuid` on the `SDKUserMessage` pushed into `query()`'s prompt stream survive into the persisted transcript row for that prompt?

**Spec criteria (verbatim):** "**Alive** → named lib seam (`Session.submit` gains an options bag carrying `uuid`), the server mints it, live id = persisted id, the D10 stitch holds. **Dead** → gap 6 ships *degraded*: userMessage is emitted live-only with id `user_<turnId>`, excluded from the replay buffer, and documented as the one item kind where live id ≠ persisted id."

- [ ] **Step 1: Write the probe**

```typescript
// probes/70-usermessage-uuid.ts — does a caller-supplied SDKUserMessage.uuid survive into the
// persisted transcript? (M2 spec probe 6; decides the gap-6 userMessage item id.)
// Run (controller, keyed): npx tsx probes/70-usermessage-uuid.ts
import { randomUUID } from "node:crypto";
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const suppliedUuid = randomUUID();
async function* prompts(): AsyncGenerator<any> {
  yield {
    type: "user",
    uuid: suppliedUuid, // the field under test — sdk.d.ts declares uuid?: string on SDKUserMessage
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: "Reply with exactly: ok" },
  };
}

let sessionId = "";
const q = query({ prompt: prompts(), options: { settingSources: [], permissionMode: "bypassPermissions", model: "claude-haiku-4-5-20251001" } });
for await (const m of q as AsyncIterable<any>) {
  if (m.type === "system" && m.subtype === "init") sessionId = m.session_id;
  if (m.type === "result") break;
}
await new Promise((r) => setTimeout(r, 1500)); // transcript is written at/after turn end (probe 62)
const rows = await getSessionMessages(sessionId);
const userRows = rows.filter((r: any) => r.type === "user");
const match = userRows.find((r: any) => r.uuid === suppliedUuid);
console.log(JSON.stringify({
  sessionId,
  suppliedUuid,
  persistedUserUuids: userRows.map((r: any) => r.uuid),
  verdict: match ? "ALIVE — supplied uuid persisted" : "DEAD — CLI re-minted the uuid",
}, null, 2));
```

- [ ] **Step 2: Run it (controller, keyed)**

Run: `cd CC-to-SDK/probes && set -a && source ../.env && set +a && npx tsx probes/70-usermessage-uuid.ts`
Expected: JSON with a one-word `verdict` — either `ALIVE` or `DEAD`. Either answer is a success; the deliverable is the knowledge.

- [ ] **Step 3: Record the verdict**

Append to the spec's `## Surprises & Discoveries` (`docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`) one entry: probe file name, verdict, and the branch it selects for Task 6 (uuid seam vs degraded `user_<turnId>`).

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/probes/probes/70-usermessage-uuid.ts CC-to-SDK/docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md
git commit -m "probe(as2a): probe 70 — SDKUserMessage.uuid passthrough verdict for the live userMessage item"
```

---

### Task 2: Schema plant scaffold — M1's inline schemas move to `appserver/schema/`

Pure migration, zero behavior change: the schema modules become the single import source; `server.ts`/`turns.ts`/`subscribe.ts` drop their inline zod.

**Files:**
- Create: `src/appserver/schema/core.ts`, `src/appserver/schema/threads.ts`, `src/appserver/schema/turns.ts`, `src/appserver/schema/decisions.ts`, `src/appserver/schema/index.ts`
- Modify: `src/appserver/server.ts:24-39` (delete inline schemas, import), `src/appserver/turns.ts:14-15`, `src/appserver/subscribe.ts:13-17`
- Test: `test/unit/appserver/schema.test.ts`

**Interfaces:**
- Produces: `schema/core.ts` exports `threadIdParams`; `schema/threads.ts` exports `threadStartParams`, `threadResumeParams`, `threadReadParams`; `schema/turns.ts` exports `turnStartParams`, `turnInterruptParams`; `schema/decisions.ts` exports `decisionOutcomeParams`, `decisionRespondParams`; `schema/index.ts` exports `methodSchemas: Record<string, { params: z.ZodType }>`.
- Later tasks add their schemas here and register in `methodSchemas`. **Rule for all tasks: a new method's params schema lives in `schema/`, is registered in `methodSchemas`, and the handler imports it from there.**

- [ ] **Step 1: Write the failing test**

```typescript
// test/unit/appserver/schema.test.ts
import { describe, it, expect } from "vitest";
import { methodSchemas } from "../../../src/appserver/schema/index.js";

describe("appserver schema registry", () => {
  it("registers every M1 method with a params schema", () => {
    const m1 = ["initialize", "server/status", "thread/start", "thread/resume", "thread/list",
      "thread/close", "thread/subscribe", "thread/unsubscribe", "thread/read",
      "turn/start", "turn/interrupt", "decision/list", "decision/respond"];
    for (const method of m1) {
      expect(methodSchemas[method], `${method} missing from methodSchemas`).toBeDefined();
    }
  });
  it("thread/start params round-trip through the registry entry", () => {
    const parsed = methodSchemas["thread/start"].params.safeParse({ config: { model: "x" }, unattended: "deny" });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit -- test/unit/appserver/schema.test.ts` — FAIL (module not found).

- [ ] **Step 3: Create the schema modules**

`src/appserver/schema/core.ts`:
```typescript
// appserver/schema/core.ts — shared shapes (spec §9: zod is the single source of truth; the schema IS
// the validator — handlers import from here, never declare inline).
import { z } from "zod/v4";
export const threadIdParams = z.object({ threadId: z.string().min(1) });
export const initializeParams = z.object({
  clientInfo: z.object({ name: z.string() }),
  authorization: z.string().optional(),
});
export const serverStatusParams = z.object({});
```

`src/appserver/schema/threads.ts`:
```typescript
// appserver/schema/threads.ts — thread lifecycle params (M1 set; Waves 1-2 extend this file).
import { z } from "zod/v4";
export const threadStartParams = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadResumeParams = z.object({
  sessionId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  unattended: z.enum(["park", "deny"]).default("park"),
});
export const threadReadParams = z.object({
  threadId: z.string().min(1),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
```

`src/appserver/schema/turns.ts`:
```typescript
// appserver/schema/turns.ts — turn lifecycle params (M1 set; M2b's queue flag lands here).
import { z } from "zod/v4";
export const turnStartParams = z.object({ threadId: z.string().min(1), input: z.string() });
export const turnInterruptParams = z.object({ threadId: z.string().min(1), cancelQueued: z.boolean().optional() });
```

`src/appserver/schema/decisions.ts`:
```typescript
// appserver/schema/decisions.ts — decision params. Mirrors DecisionOutcome (src/permissions/types.ts)
// and the host wire (host/ops.ts) — never trust a client-supplied `by` (spec §6, server-stamped only).
import { z } from "zod/v4";
export const decisionOutcomeParams = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allow_once") }),
  z.object({ kind: z.literal("allow_always") }),
  z.object({ kind: z.literal("deny") }),
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  z.object({ kind: z.literal("plan_approve"), acceptEdits: z.boolean() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
export const decisionRespondParams = z.object({
  threadId: z.string().min(1),
  toolUseId: z.string().min(1),
  answer: decisionOutcomeParams,
  abortTurn: z.boolean().optional(),
});
```

`src/appserver/schema/index.ts`:
```typescript
// appserver/schema/index.ts — the method→schema registry. Wave 4's generator and drift gate walk THIS
// record: a shipped method missing here is a build failure, so wire and artifact cannot drift (spec §9).
import type { z } from "zod/v4";
import { threadIdParams, initializeParams, serverStatusParams } from "./core.js";
import { threadStartParams, threadResumeParams, threadReadParams } from "./threads.js";
import { turnStartParams, turnInterruptParams } from "./turns.js";
import { decisionRespondParams } from "./decisions.js";

export interface MethodSchema { params: z.ZodType }
export const methodSchemas: Record<string, MethodSchema> = {
  "initialize": { params: initializeParams },
  "server/status": { params: serverStatusParams },
  "thread/start": { params: threadStartParams },
  "thread/resume": { params: threadResumeParams },
  "thread/list": { params: serverStatusParams }, // no params today; Wave 2 replaces with cursor/filter shape
  "thread/close": { params: threadIdParams },
  "thread/subscribe": { params: threadIdParams },
  "thread/unsubscribe": { params: threadIdParams },
  "thread/read": { params: threadReadParams },
  "turn/start": { params: turnStartParams },
  "turn/interrupt": { params: turnInterruptParams },
  "decision/list": { params: threadIdParams },
  "decision/respond": { params: decisionRespondParams },
};
```

- [ ] **Step 4: Re-point the three consumer files**

In `server.ts`: delete the inline `initializeParams`/`threadStartParams`/`threadResumeParams`/`threadIdParams`/`decisionOutcomeParams`/`decisionRespondParams` declarations (lines 24-39) and import them:
```typescript
import { initializeParams, threadIdParams } from "./schema/core.js";
import { threadStartParams, threadResumeParams } from "./schema/threads.js";
import { decisionRespondParams } from "./schema/decisions.js";
```
In `turns.ts`: delete inline `turnStartParams`/`turnInterruptParams` (lines 14-15), `import { turnStartParams, turnInterruptParams } from "./schema/turns.js";`.
In `subscribe.ts`: delete inline `threadIdParams`/`threadReadParams` (lines 13-17), `import { threadIdParams } from "./schema/core.js"; import { threadReadParams } from "./schema/threads.js";`.

- [ ] **Step 5: Run tests** — `npm run test:unit -- test/unit/appserver/schema.test.ts` PASS, then `npm run test:unit && npm run typecheck` — all green (pure migration; any failure means the move changed behavior).

- [ ] **Step 6: Commit**

```bash
git add src/appserver/schema/ src/appserver/server.ts src/appserver/turns.ts src/appserver/subscribe.ts test/unit/appserver/schema.test.ts
git commit -m "feat(as2a): schema plant — appserver zod schemas move to schema/ with a method registry"
```

---

### Task 3: Error codes + engine-gone + shutdown-through-chain

**Files:**
- Modify: `src/appserver/rpc.ts:3` (add `SHUTTING_DOWN: -33007`), `src/appserver/registry.ts` (widen `EngineSession` with `isEnded?()`), `src/appserver/server.ts` (shutdown refusal code, dispatch engine-gone mapping, shutdown through chain)
- Test: `test/unit/appserver/server.test.ts` (extend), `test/unit/appserver/lifecycle.test.ts` (extend)

**Interfaces:**
- Produces: `ERR.SHUTTING_DOWN = -33007`; `EngineSession.isEnded?(): boolean`; `AppServer.engineGuard(record): boolean` is NOT a thing — instead dispatch-level mapping (below). Every later handler gets engine-gone answers for free.

- [ ] **Step 1: Write the failing tests** (extend `test/unit/appserver/server.test.ts`)

```typescript
describe("M2 error codes", () => {
  it("thread/start during shutdown answers -33007 shuttingDown, not -32001", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const { peer, feed } = connect(srv); // the file's existing helper: init'd connection + captured frames
    void srv.shutdown();
    feed(req(1, "thread/start", {}));
    const err = await replyFor(peer, 1);
    expect(err.error.code).toBe(-33007);
  });

  it("a method call against a dead engine answers -33005 engineGone", async () => {
    const session = fakeSession();
    (session as any).isEnded = () => true; // engine died (read loop ended) — the lib's real signal
    const srv = new AppServer({}, { sessionFactory: () => session });
    const { peer, feed } = connect(srv);
    feed(req(1, "thread/start", {}));
    await replyFor(peer, 1);
    const threadId = threadIdOf(peer, 1);
    feed(req(2, "turn/start", { threadId, input: "hi" }));
    const err = await replyFor(peer, 2);
    expect(err.error.code).toBe(-33005);
  });

  it("shutdown() waits for a queued thread/close on the same record instead of racing it", async () => {
    // gap 7: shutdown used to bypass record.chain. Engine-faithful fake: dispose resolves on a
    // controllable promise, and counts calls — the race made dispose run twice concurrently.
    let release!: () => void;
    let disposeCalls = 0;
    const session = fakeSession({ dispose: async () => { disposeCalls++; await new Promise<void>((r) => { release = r; }); } });
    const srv = new AppServer({}, { sessionFactory: () => session });
    const { peer, feed } = connect(srv);
    feed(req(1, "thread/start", {}));
    await replyFor(peer, 1);
    const threadId = threadIdOf(peer, 1);
    feed(req(2, "thread/close", { threadId }));   // queues closeRecord on record.chain
    const done = srv.shutdown();                   // must chain AFTER the queued close, not race it
    await Promise.resolve();
    release();
    await done;
    expect(disposeCalls).toBe(1); // memoized-by-ordering, not by luck: the second closer awaited the first
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:unit -- test/unit/appserver/server.test.ts` — the three new cases FAIL (`-32001` observed; `-32603` observed; `disposeCalls === 2`).

- [ ] **Step 3: Implement**

`rpc.ts:3` — add to `ERR`: `SHUTTING_DOWN: -33007,` and update the comment naming `-32001` as backpressure-only.

`registry.ts` — widen `EngineSession` (after `setPermissionMode?`):
```typescript
  /** Optional (the real lib Session has it): true once the read loop has ended — the engine is gone.
   *  The ONLY dead-engine signal handlers may use (spec Wave 0: no message-matching, ever). */
  isEnded?(): boolean;
```

`server.ts` — three changes:

(a) both `if (srv.shuttingDown)` refusals (`thread/start`, `thread/resume`) become:
```typescript
      if (srv.shuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
```

(b) `dispatch()` — before invoking a thread-scoped handler, and when a handler throws, map dead engines. Add a helper and use it in the catch:
```typescript
  /** -33005 mapping (spec Wave 0): a dead read-loop is real on inProcess threads (probe 38). Checked
   *  via isEnded() ONLY — the lib's errors are untyped strings and message-matching misses half the
   *  class ("not running" vs "disposed"). `threadId` comes from the request params when present. */
  private engineGoneCode(params: Record<string, unknown>): number | undefined {
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    if (!threadId) return undefined;
    const record = this.registry.get(threadId);
    return record?.session.isEnded?.() ? ERR.ENGINE_GONE : undefined;
  }
```
In `dispatch()`'s `catch (e)` arm:
```typescript
    } catch (e) {
      const gone = this.engineGoneCode(params);
      if (gone !== undefined) ctx.peer.replyError(id, gone, "Engine is gone (session ended)");
      else ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    }
```
And immediately before `await handler(...)`:
```typescript
    const goneBefore = this.engineGoneCode(params);
    if (goneBefore !== undefined && method !== "thread/close" && method !== "thread/read" && method !== "thread/subscribe" && method !== "thread/unsubscribe" && method !== "decision/list") {
      // close/read/subscribe/list stay answerable on a dead engine — closing and reading history are
      // exactly what a client does with a dead thread. Everything else needs a live engine.
      ctx.peer.replyError(id, goneBefore, "Engine is gone (session ended)"); return;
    }
```

(c) `shutdown()` — through each record's chain (gap 7):
```typescript
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    // Through each record's chain (gap 7): a thread/close already queued for this record runs first and
    // closeRecord's registry-delete makes this pass's own close a no-op — ordered, never concurrent.
    await Promise.all(this.registry.list().map((r) => {
      r.chain = r.chain.then(async () => { if (this.registry.get(r.id)) await this.closeRecord(r); });
      return r.chain.catch(() => {});
    }));
  }
```

- [ ] **Step 4: Run tests** — `npm run test:unit -- test/unit/appserver/server.test.ts` PASS; `npm run test:unit` green.

- [ ] **Step 5: Sabotage-verify the chain guard** — temporarily revert `shutdown()` to the old body; the `disposeCalls` test must FAIL; restore. (State the observed failure in the task report.)

- [ ] **Step 6: Commit**

```bash
git add src/appserver/rpc.ts src/appserver/registry.ts src/appserver/server.ts test/unit/appserver/server.test.ts
git commit -m "feat(as2a): -33007 shuttingDown + -33005 engineGone via isEnded() + shutdown through record.chain"
```

---

### Task 4: Transport hygiene — ws maxPayload + run-file cleanup

**Files:**
- Modify: `src/appserver/transport/ws.ts` (maxPayload), `src/cli/serveMain.ts` (run-file removal on stop)
- Test: `test/unit/appserver/wsTransport.test.ts` (extend), `test/unit/cli/serveArgs.test.ts` (extend if the run-file helper is exported there; otherwise new `test/unit/cli/serveRunfile.test.ts`)

- [ ] **Step 1: Failing test — ws refuses an oversized frame at the transport** (extend `wsTransport.test.ts`)

```typescript
it("caps ws payloads at the protocol's own inbound bound (gap 8)", async () => {
  const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
  const { port, close } = await listenWs(srv, {});
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.once("open", r));
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
  ws.send("x".repeat(300 * 1024)); // > 256 KiB + slack — ws kills the connection below the app layer
  const code = await closed;
  expect(code).toBe(1009); // ws's "message too big" close code
  await close();
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test:unit -- test/unit/appserver/wsTransport.test.ts` — FAIL (default 100 MiB accepts the frame; the connection stays open and the test times out on `closed` — use vitest timeout 5000 on this test).

- [ ] **Step 3: Implement** — in `listenWs`, the `WebSocketServer` options gain:
```typescript
      maxPayload: 272 * 1024, // gap 8: the protocol's own inbound cap is 256 KiB (peer.ts MAX_IN) —
      // the library default (100 MiB) let a pre-initialize client buffer huge frames below the app
      // layer. 16 KiB of slack covers JSON framing overhead so a legal 256 KiB frame still passes
      // peer.ts's own check (which remains the byte-exact authority).
```

- [ ] **Step 4: Run-file cleanup (gap 9).** In `serveMain.ts`, locate where the run-file is written (`runServe`, after `listenWs` — the file records port + tokenFile path). Wrap the stop path: where `onStopSignals(stop)` is wired, the `stop` closure must `rmSync(runFile, { force: true })` after `close()` resolves (and before the process exits). Extract the pure piece for the test:
```typescript
/** Remove the serve run-file. `force` — a missing file is not an error (a crashed previous serve, or
 *  an operator's manual cleanup, must not turn shutdown into a throw). Exported for the unit suite. */
export function removeRunFile(path: string): void { rmSync(path, { force: true }); }
```
Unit test (fs only, tmp dir): write a file, `removeRunFile(path)`, `existsSync` false; and `removeRunFile` on a missing path does not throw. Then call it from the stop closure.

- [ ] **Step 5: Run tests** — targeted files PASS, `npm run test:unit` green, `npm run typecheck` green.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/transport/ws.ts src/cli/serveMain.ts test/unit/appserver/wsTransport.test.ts test/unit/cli/
git commit -m "feat(as2a): ws maxPayload at the protocol cap + serve run-file removed on shutdown"
```

---

### Task 5: Server-scoped fan-out — `watchThreads`, `optOutNotificationMethods`, `warning`, `thread/started`

**Files:**
- Create: `src/appserver/fanout.ts`
- Modify: `src/appserver/schema/core.ts` (initialize params), `src/appserver/server.ts` (ConnCtx fields, initialize handling, emit points), `src/appserver/peer.ts` (opt-out filter)
- Test: `test/unit/appserver/fanout.test.ts`

**Interfaces:**
- Produces: `ConnCtx` gains `watchThreads: boolean` and `optOut: Set<string>`; `AppServer.watchers(): ConnCtx[]`; `AppServer.broadcastServer(method, params)` (to watchers); `AppServer.warn(peer, code: string, message: string)` (emits `warning {code, message}` to ONE peer). `thread/started` fires on start/resume; `thread/closed` additionally reaches watchers; `thread/deleted` emit point lands in Task 10.
- Consumes: Task 2's schema modules.

- [ ] **Step 1: Failing tests**

```typescript
// test/unit/appserver/fanout.test.ts
import { describe, it, expect } from "vitest";
// helpers: memPeer() returns {sink, frames} capturing writes; init(srv, {watchThreads}) performs initialize.

describe("server-scoped fan-out (spec Wave 0)", () => {
  it("a watchThreads connection receives thread/started for a thread it never subscribed to", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const watcher = connect(srv);
    await init(watcher, { watchThreads: true });
    const starter = connect(srv);
    await init(starter, {});
    starter.feed(req(1, "thread/start", {}));
    await replyFor(starter.peer, 1);
    const started = watcher.frames.find((f) => f.method === "thread/started");
    expect(started, "watcher missed thread/started").toBeDefined();
    expect(started.params.thread.id).toMatch(/^thr_/);
  });
  it("a non-watching connection does NOT receive thread/started", async () => {
    // same setup, watchThreads omitted on the watcher — expect no thread/started frame
  });
  it("optOutNotificationMethods filters exactly the named methods", async () => {
    // init with { optOutNotificationMethods: ["thread/status/changed"] }, subscribe to a thread,
    // run a fake turn — expect turn/started present and thread/status/changed ABSENT.
  });
  it("thread/closed reaches watchers as well as subscribers", async () => {
    // watcher (watchThreads, NOT subscribed) + thread/close → watcher sees thread/closed
  });
  it("warning is a per-peer notification with {code, message}", async () => {
    // srv.warn(ctx.peer, "limitClamped", "...") → exactly that one peer got warning
  });
});
```

- [ ] **Step 2: Run to verify failure** — module/params don't exist yet.

- [ ] **Step 3: Implement**

`schema/core.ts` — initialize gains both knobs (spec Wave 0):
```typescript
export const initializeParams = z.object({
  clientInfo: z.object({ name: z.string() }),
  authorization: z.string().optional(),
  watchThreads: z.boolean().optional(),
  optOutNotificationMethods: z.array(z.string()).optional(),
});
```

`peer.ts` — `Peer.notify` honors an opt-out set (constructor opts gain `optOut?: Set<string>`):
```typescript
  notify(method: string, params: Record<string, unknown>): void {
    if (this.opts.optOut?.has(method)) return; // initialize's optOutNotificationMethods — filtered at
    // the LAST hop so every emit path (broadcast, replay, direct) honors it without knowing about it
    this.send({ method, params, emittedAtMs: Date.now() });
  }
```
(`Peer` is constructed before `initialize` arrives, so the set is mutable-in-place: `AppServer.handleInitialize` fills the same `Set` instance the Peer was built with.)

`fanout.ts`:
```typescript
// appserver/fanout.ts — server-scoped notification fan-out (spec Wave 0, D-M2-5): thread-EXISTENCE
// events go to connections that opted in via initialize{watchThreads:true}. Orthogonal to
// record.subscribers (thread-scoped). Broadcast-to-all would leak thread existence to clients that
// never asked; per-thread subscribers structurally cannot receive thread/started.
import type { ConnCtx } from "./server.js";

export function broadcastToWatchers(conns: Iterable<ConnCtx>, method: string, params: Record<string, unknown>): void {
  for (const ctx of conns) {
    if (!ctx.watchThreads) continue;
    try { ctx.peer.notify(method, params); } catch { /* one watcher's failure is not another's */ }
  }
}
```

`server.ts` — `ConnCtx` gains `watchThreads: boolean; optOut: Set<string>` (init `false` / `new Set()` in `connect()`; the Peer is constructed with that same set: `new Peer(sink, { optOut })`). `handleInitialize` copies `parsed.data.watchThreads ?? false` and fills `ctx.optOut` from `optOutNotificationMethods ?? []`. Add:
```typescript
  broadcastServer(method: string, params: Record<string, unknown>): void {
    broadcastToWatchers(this.conns.values(), method, params);
  }
  warn(peer: Peer, code: string, message: string): void {
    peer.notify("warning", { code, message });
  }
```
Emit points: at the end of the `thread/start` and `thread/resume` handlers (after `ctx.peer.reply`): `srv.broadcastServer("thread/started", { thread: threadView(record) });`. In `closeRecord`, after the existing subscriber broadcast: `this.broadcastServer("thread/closed", { threadId: record.id });`.

- [ ] **Step 4: Run tests** — fanout tests PASS; whole unit suite green.

- [ ] **Step 5: Sabotage-verify** — revert the `handleInitialize` copy of `watchThreads` (leave it always false); the first fanout test must FAIL; restore.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/fanout.ts src/appserver/schema/core.ts src/appserver/server.ts src/appserver/peer.ts test/unit/appserver/fanout.test.ts
git commit -m "feat(as2a): watchThreads server-scoped fan-out + optOutNotificationMethods + warning (gap 1)"
```

---

### Task 6: Live `userMessage` item (gap 6 — branch per Task 1's verdict)

**Files:**
- Modify: `src/appserver/turns.ts` (emit in `turnStart`'s chain callback, right after the `turn/started` broadcast), `src/appserver/items/mapper.ts` (only to confirm `userItem(text, id)` export — it exists), and **iff Task 1 = ALIVE:** `src/session/session.ts` (`submit` options bag) + `src/appserver/registry.ts` (EngineSession.submit signature)
- Test: `test/unit/appserver/turns.test.ts` (extend)

**Branch ALIVE** (probe persisted the supplied uuid):
- `session.ts`: `submit(prompt, onMessage, opts?: { uuid?: string })` threading `opts.uuid` into `userTurn` → the pushed `SDKUserMessage.uuid`. `enqueueTurn` gains the same pass-through param. Named seam, doc-commented as appserver-only.
- `turns.ts`, in the chain callback after `record.turnStartedBroadcast = true;`:
```typescript
    const userUuid = randomUUID(); // live id = persisted id (probe 70 ALIVE): the server mints the
    // transcript uuid itself, so the D10 stitch (dedup by id across read + replay) holds for prompts too
    emitItems(srv, record, turnId, [{ kind: "completed", item: userItem(parsed.data.input, userUuid) }]);
```
and the `submit` call passes `{ uuid: userUuid }`.

**Branch DEAD** (CLI re-mints):
- `turns.ts`, same location — emitted to live subscribers only, **never buffered** (spec Wave 0: excluded from the replay buffer, the one stitch-exempt kind):
```typescript
    { // gap 6 degraded branch (probe 70 DEAD): live-only, deterministic id, NOT pushed into
      // record.buffer — a mid-turn joiner reads the prompt from thread/read after persistence instead,
      // and the stitch dedup explicitly does not apply to userMessage (spec Wave 0).
      const ev = { kind: "completed" as const, item: userItem(parsed.data.input, `user_${turnId}`) };
      const { method, params: p } = itemEventNotification(record.id, turnId, ev);
      srv.broadcast(record.id, method, p);
    }
```

- [ ] **Step 1: Failing test** (both branches assert the same observable):

```typescript
it("turn/start emits a live userMessage item to subscribers (gap 6)", async () => {
  // subscriber attached BEFORE turn/start; run a fake turn; expect an item/completed whose
  // item.type === "userMessage" and item.text === the submitted input, before the first agent item.
});
// DEAD branch only:
it("the live userMessage is not replayed to a mid-turn joiner", async () => {
  // start turn, THEN subscribe: replay must contain no userMessage item event.
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** implement the branch Task 1 recorded. **Step 4:** run — PASS; full unit suite green. **Step 5 (ALIVE branch only):** `npm run typecheck` confirms the widened `submit` stays optional-compatible for every existing caller.

- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): live userMessage item on turn/start (gap 6, probe-70 branch)"` (with the touched files).

---

### Task 7: `threadView` completes + status shape + list cursors (gaps 2, 3)

**Files:**
- Modify: `src/appserver/registry.ts` (record fields), `src/appserver/server.ts` (threadView, thread/list cursor, decision/list cursor), `src/appserver/schema/threads.ts` + `schema/core.ts` (list params), `src/appserver/subscribe.ts` + `src/appserver/turns.ts` (status payloads)
- Test: `test/unit/appserver/server.test.ts`, `test/unit/appserver/subscribe.test.ts` (extend)

**Interfaces:**
- Produces (parent §5's Thread fields, projected): `threadView(r)` returns `{ id, sessionId, title, tags, cwd, model, permissionMode, thinking: { maxTokens }, status: { state: "idle"|"active", waitingOn?: "decision" }, origin, createdAt, updatedAt, preview }`. Registry-only values for `title`/`tags`/`preview` are `undefined` until Wave 2's store merge fills them on the list path. `ThreadRecord` gains `cwd?: string; updatedAt: number; settings: { model?: string; permissionMode?: string; thinkingTokens?: number }` (settings seeded from the start config here; written by Task 8's router/setters).
- **One busy predicate + one epoch, both exported from `registry.ts` (spec D-M2-8).** `ThreadRecord` additionally gains `closing?: boolean`, `swapInFlight?: boolean` (declared here, set by later tasks — M2b's queue and rewind) and `epoch: number` (initialized to `0` at thread creation; bumped only by M2b's rewind engine swap). Every later gate — queue drain, close, rewind, compact — calls the predicate instead of re-assembling its terms:
```typescript
/** The ONE answer to "is this thread busy?" (spec D-M2-8). Gates never re-assemble these terms. */
export function threadBusyReason(r: ThreadRecord): "turn" | "closing" | "swapping" | null {
  if (r.closing) return "closing";
  if (r.swapInFlight) return "swapping";
  return r.busy ? "turn" : null;
}

export function threadStatus(r: ThreadRecord, waitingOn: boolean): { state: "idle" | "active"; waitingOn?: "decision" } {
  if (!threadBusyReason(r)) return { state: "idle" };
  return waitingOn ? { state: "active", waitingOn: "decision" } : { state: "active" };
}
```
(If the record's live-turn flag is named something other than `busy`, use the real field — `threadBusyReason` is the only place that reads it.)
- **`cursorParam` is extracted into `schema/core.ts`** in this task and reused by `thread/read`, `thread/list`, and `decision/list` — Task 2's review flagged that the cursor shape stayed inlined in `threadReadParams` while the plan's file structure assigns common shapes to `core.ts`. Task 13 changes its regex when the cursor becomes epoch-qualified; one definition means one change.
- **Every `thread/status/changed` payload site changes shape** from `status: "active"|"idle"` to the object above — `turns.ts:statusChanged`, `subscribe.ts:55`. `statusChanged` moves to taking `srv` so it can ask the decisions map: `waitingOn = srv.pendingDecisions(record.id).length > 0`.
- `thread/list` params: `{ cursor?: string, limit?: number }` → reply `{ data, nextCursor }` (registry-only in this task; offset-into-array cursor, same decimal-string convention as thread/read). `decision/list` reply gains `nextCursor: null` (a parked set is small and unpaged, but the envelope becomes uniform — spec gap 2).

- [ ] **Step 1: Failing tests** — threadView field assertions (all 13 keys present; `status` is an object; a parked fake turn yields `waitingOn: "decision"`); thread/list with `limit: 1` on two threads returns `nextCursor` that fetches the second; `threadBusyReason` returns `"closing"` when `closing` is set even while a turn is active (the precedence order is the point — a closing thread is not merely "busy with a turn"), `"swapping"` for `swapInFlight`, `"turn"` for an active turn, `null` for an idle record.
- [ ] **Step 2:** Run — FAIL. **Step 3:** implement. **Step 4:** run — PASS; whole suite green (existing tests asserting the old flat `status` string get updated in the same commit — they are asserting the old shape on purpose).
- [ ] **Step 5: Commit** — `git commit -m "feat(as2a): threadView 13 fields + status{state,waitingOn} + cursors on every list (gaps 2,3)"`.

---

### Task 8a: Frame router skeleton — absorb the two existing watchers, behavior-invariant

The load-bearing Wave-1 mechanism lands in two halves so a reviewer can judge "is the absorption really harmless?" separately from "are the new routes right?" (external review, 2026-07-30). **Task 8a changes no observable behavior**: it introduces `router.ts` with exactly two routes — the init latch and the planUpgrade status-consult — replacing the two single-purpose `onFrame` watchers that exist today. Task 8b then adds the eight new routes and the settings mirror.

**Files:**
- Create: `src/appserver/router.ts`
- Modify: `src/appserver/server.ts` (install the router in start/resume instead of `latchSessionId`; delete `latchSessionId`), `src/appserver/registry.ts` (record gains `routerOff?: () => void`), `src/appserver/planUpgrade.ts` (drop its own watcher: `armPlanUpgrade` only sets the flag)
- Test: `test/unit/appserver/router.test.ts`

**Interfaces:**
- Produces: `installRouter(srv: AppServer, record: ThreadRecord): void` — subscribes ONE `record.session.onFrame` callback, stores the unsubscribe in `record.routerOff` (called by `closeRecord` before dispose). Each route runs in its own try/catch so one throwing route cannot starve the others on the same frame.
- **Epoch guard (spec D-M2-8), built in from the first line** — the callback captures `record.epoch` at install time and drops any frame whose captured epoch no longer matches:
```typescript
export function installRouter(srv: AppServer, record: ThreadRecord): void {
  const epoch = record.epoch; // frames from an engine superseded by a rewind swap must never land
  record.routerOff = record.session.onFrame((frame: any) => {
    if (record.epoch !== epoch) return;
    // …routes…
  });
}
```
- Routes in 8a (both are the existing behavior, moved):

| frame | action |
|---|---|
| `system/init` | latch `record.sessionId` (the exact logic of the deleted `latchSessionId`, incl. reading `session_id` off the frame itself) |
| `system/status` | `if (record.planUpgradePending) void applyPlanUpgrade(record)` |

- `armPlanUpgrade(record)` shrinks to:
```typescript
export function armPlanUpgrade(record: ThreadRecord): void {
  record.planUpgradePending = true; // the router's status route applies it (one watcher per thread — D-M2-6)
}
```
`applyPlanUpgrade` unchanged except it no longer touches `planUpgradeOff` (field deleted from the record).

- [ ] **Step 1: Failing tests** (engine-faithful fake: `onFrame` returns an unsubscribe, frames pushed manually between turns):

```typescript
describe("frame router skeleton (spec D-M2-6, D-M2-8)", () => {
  it("latches sessionId from the init frame (absorbed latchSessionId)", ...);
  it("a status frame while planUpgradePending calls the setter exactly once", ...);
  it("a status frame with planUpgradePending false calls nothing", ...);
  it("uninstalling the router (routerOff) stops all routing", ...);
  it("a frame arriving after record.epoch changed is dropped (stale-engine guard)", ...);
  it("one route throwing does not starve the others on the same frame", ...);
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** implement. `server.ts`: `latchSessionId(record)` call sites become `installRouter(srv, record)`; delete the function (grep proves it is gone). `closeRecord` calls `record.routerOff?.()` before dispose.
- [ ] **Step 4:** Run — PASS; whole suite green (planUpgrade tests updated: arming no longer installs a watcher — they now push a status frame through the router's fake and assert the setter fired).
- [ ] **Step 5: Sabotage-verify** the epoch guard: remove the `record.epoch !== epoch` line; the stale-frame test FAILS; restore. Put the observed failure output in the report.
- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): per-thread frame router skeleton — absorbs latchSessionId + planUpgrade consult, epoch-guarded (D-M2-6, D-M2-8)"`.

---

### Task 8b: Frame router — the eight new routes + settings mirror

Builds on 8a's skeleton. Every route here is new behavior.

**Files:**
- Modify: `src/appserver/router.ts` (8a's skeleton gains the routes below)
- Test: `test/unit/appserver/router.test.ts` (extend)

**Interfaces:**
- The routes added to 8a's single `onFrame` callback (the epoch guard and the two absorbed routes stay exactly as 8a left them):

| frame | action |
|---|---|
| `system/status` with `permissionMode` | mirror + echo-dedup → maybe `thread/settings/changed{source:"engine"}` (8a's planUpgrade consult on this same frame stays, and runs regardless of dedup) |
| `system/status` with `model` (empirical: may not exist — route written, harmless if never hit) | mirror + echo-dedup, same broadcast |
| `system/compact_boundary` | `srv.broadcast(record.id, "thread/compacted", { threadId: record.id, turnId: record.currentTurnId, outcome: frame })` (Task 11 consumes) |
| `result` frames carrying `usage`/`modelUsage` | `thread/tokenUsage/updated {threadId, usage}` |
| `rate_limit_event` / `result` with limit fields | `thread/limits/updated {threadId, limits}` (sparse merge is the CLIENT's job; server relays the frame's fields) |
| `background_tasks_changed` | `task/changed {threadId, tasks}` (snapshot-replace) |
| `task_notification` | `task/event {threadId, event: frame}` |
| `system` frames carrying `commands`/`slash_commands` list push | `thread/capabilities/changed {threadId}` (payload is a ping; clients re-read `thread/capabilities/read` — replace, never merge) |
| assistant frame whose `message.content` has a `tool_use` block with `name === "TodoWrite"` | `turn/todo/updated {threadId, turnId: record.currentTurnId, todos: block.input.todos}` (the spec routes todo through the router; the block's `input.todos` is the full snapshot — replace, never merge) |

- Echo-dedup rule (spec Wave 1, verbatim in a doc comment): "the engine-frame leg suppresses its broadcast when the frame's value equals the mirror".

- [ ] **Step 1: Failing tests** (same engine-faithful fake as 8a):

```typescript
describe("frame router routes (spec Wave 1, D-M2-6)", () => {
  it("a status frame with a NEW permissionMode updates the mirror and broadcasts source:'engine'", ...);
  it("a status frame echoing the mirror's value broadcasts NOTHING (echo-dedup)", ...);
  it("an echo-deduped status frame STILL applies a pending plan upgrade (8a's route is not gated by dedup)", ...);
  it("compact_boundary → thread/compacted with the current turnId", ...);
  it("a result frame with usage → thread/tokenUsage/updated", ...);
  it("background_tasks_changed → task/changed with the full snapshot", ...);
  it("an assistant frame carrying a TodoWrite tool_use → turn/todo/updated with the todos snapshot", ...);
});
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** implement the routes (dispatch over `frame.type`/`subtype`, each route in its own try/catch).
- [ ] **Step 4:** Run — PASS; whole suite green.
- [ ] **Step 5: Sabotage-verify** the echo-dedup test: make the route broadcast unconditionally; test FAILS; restore. Report the observed failure output.
- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): frame router routes — settings mirror, usage/limits, tasks, capabilities, todos, compact boundary (Wave 1)"`.

---

### Task 8c: Early keyed live smoke of the router + mirror (controller-run, spec D-M2-9)

Not an implementer task. Seven tasks build on the router, and the M1 postmortem's three Criticals were all fakes agreeing with their author — so one thin keyed run lands here, before that stack exists.

**Files:**
- Create: `test/live/appserver-m2-router-smoke.test.ts` (keyed; the controller writes and runs it, following `test/live/appserver-m1.test.ts`'s pattern with `settingSources: []`)

- [ ] **Step 1:** Write the smoke: `initialize` → `thread/start` → `thread/model/set` → assert a `thread/settings/changed` arrives with `source: "client"` and the new model → `thread/permissionMode/set "auto"` → assert the mirror/notification agree with the self-heal → run one trivial turn → assert at least one router-sourced notification fires against the REAL engine (`thread/tokenUsage/updated` from the result frame) → `thread/close`.
- [ ] **Step 2 (controller, keyed):** `cd CC-to-SDK/harness && set -a && source ../.env && set +a && npm run test:live -- test/live/appserver-m2-router-smoke.test.ts` — PASS.
- [ ] **Step 3:** Any mismatch between what the fakes assumed and what the engine sent is recorded in the spec's `## Surprises & Discoveries` and fixed before Task 9 — that is the entire point of running it here.
- [ ] **Step 4: Commit** — `git commit -m "test(as2a): keyed live smoke — router/mirror against the real engine (D-M2-9)"`.

---

### Task 9: The four setters (`settings.ts`)

**Files:**
- Create: `src/appserver/settings.ts`, `src/appserver/schema/settings.ts`
- Modify: `src/appserver/registry.ts` (EngineSession widening), `src/appserver/server.ts` (handler table), `src/appserver/schema/index.ts` (register)
- Test: `test/unit/appserver/settings.test.ts`

**Interfaces:**
- `EngineSession` gains (all optional-structural, real `Session` satisfies them — `src/session/session.ts:125-159`):
```typescript
  setModel?(model?: string): Promise<void>;
  setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>;
```
- `schema/settings.ts`:
```typescript
import { z } from "zod/v4";
export const modelSetParams = z.object({ threadId: z.string().min(1), model: z.string().min(1).nullable() });
export const permissionModeSetParams = z.object({ threadId: z.string().min(1), mode: z.string().min(1) });
export const thinkingSetParams = z.object({ threadId: z.string().min(1) })
  .and(z.union([z.object({ level: z.string().min(1) }), z.object({ maxTokens: z.number().int().nonnegative().nullable() })]));
export const settingsApplyParams = z.object({ threadId: z.string().min(1), settings: z.record(z.string(), z.unknown()) });
```
- Handlers (each: parse → record lookup → chain-scoped engine call → mirror write-back → `thread/settings/changed {…, source: "client"}` broadcast → reply `{ok: true}`; a rejected setter replies the dispatch-level error and does NOT write the mirror):
  - `thread/model/set` — `model: null` → `session.setModel(undefined)` (SDK: reset to default; mirror stores `undefined`).
  - `thread/permissionMode/set` — before the engine call, run the auto self-heal exactly as `resolveOptions` does (`src/config/resolveOptions.ts:62`): `if (mode === "auto") { const healed = resolveAutoModel(record.settings.model); if (healed !== record.settings.model) { await session.setModel(healed); record.settings.model = healed; } }` — import `resolveAutoModel` from `../config/autoModel.js`. Then `session.setPermissionMode(mode)`.
  - `thread/thinking/set` — `level` resolves through `thinkBudget` (`src/tui/thinkLevels.ts`); `maxTokens` passes raw; `0`/`"off"` → `setMaxThinkingTokens(0)`; mirror stores the resolved number.
  - `thread/settings/apply` — `session.applyFlagSettings(settings)`; no mirror field, no settings-changed broadcast (flag settings are not one of the three mirrored knobs), reply `{ok: true}`. **inProcess-only by nature in M2 (every thread is inProcess) — no origin check needed yet; a comment marks where M3's `-33006` lands.**
- All four go through `record.chain` (`record.chain = record.chain.then(async () => { ... })`) so a setter never interleaves a turn's submit.

- [ ] **Step 1: Failing tests** — per setter: engine method called with the right arg; mirror updated; one `thread/settings/changed` with `source: "client"` reaches a subscriber; second client sees the first client's change (two peers subscribed, one sets — spec acceptance 5's unit-level shadow); a REJECTING fake setter → error reply, mirror unchanged, no broadcast; auto-heal: fake with `settings.model = "claude-haiku-4-5-20251001"` + `permissionMode/set "auto"` → `setModel` called with the healed model first, **and the resulting `thread/settings/changed` carries the healed model with `source: "client"`, never `"engine"`** — the client's request caused the model change, so a unit test pins the label here rather than leaving it to the keyed acceptance (spec Wave 1; a rule only a live run can catch dies silently at the first regression).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + suite green. **Step 5: Sabotage-verify** the mirror-unchanged-on-reject guard (make the handler write the mirror before awaiting; test fails; restore).
- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): the four setters — model/permissionMode(auto-heal)/thinking/settings-apply with write-back (Wave 1)"`.

---

### Task 10: The five introspection reads (`introspect.ts`)

**Files:**
- Create: `src/appserver/introspect.ts`
- Modify: `src/appserver/registry.ts` (EngineSession widening), `src/appserver/server.ts` (handler table), `src/appserver/schema/index.ts` + `schema/core.ts` (threadId-param registrations)
- Test: `test/unit/appserver/introspect.test.ts`

**Interfaces:**
- `EngineSession` gains:
```typescript
  capabilities?(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
  getContextUsage?(): Promise<unknown>;
  usage?(): Promise<unknown>;
  initializationResult?(): Promise<unknown>;
  accountInfo?(): Promise<unknown>;
```
- Methods (each `threadIdParams`, replies the engine value verbatim under one named key — a missing optional method replies `-32601` METHOD_NOT_FOUND with message `"unsupported by this engine"`):
  - `thread/capabilities/read` → `{ capabilities }` (also the payload a `thread/capabilities/changed` ping tells clients to re-read)
  - `thread/contextUsage/read` → `{ contextUsage }`
  - `thread/usage/read` → `{ usage }`
  - `thread/init/read` → `{ init }`
  - `account/read` → `{ account }` — **server-scoped**: params `{ threadId }` still (the account is read through a thread's engine; a comment records this is deliberate — there is no engine off-thread).
- Reads do NOT go through `record.chain` (read-only; blocking a read behind a long turn would make dashboards useless) — doc-comment this.

- [ ] **Step 1: Failing tests** — each method returns the fake's value under the right key; dead-engine (isEnded true) answers `-33005` (via Task 3's dispatch guard — assert it holds for one of these to prove the guard covers new methods); missing optional (fake without `usage`) answers `-32601`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + suite + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(as2a): five introspection reads — capabilities/contextUsage/usage/init/account (Wave 1)"`.

---

### Task 11: Compact-as-turn + reinitialize (`lifecycle.ts`)

**Files:**
- Create: `src/appserver/lifecycle.ts`
- Modify: `src/appserver/turns.ts` (export the turn spine), `src/appserver/registry.ts` (EngineSession gains `compact?()`, `reinitialize?()`), `src/appserver/server.ts` (handler table), `src/appserver/schema/threads.ts` + `index.ts`
- Test: `test/unit/appserver/lifecycle2.test.ts` (new file — `lifecycle.test.ts` already owns close/shutdown)

**The refactor (spec Wave 2: compact "claims the full turn machinery"):** extract from `turnStart` the busy-gate + mint + chain-callback spine into an exported helper both callers use:

```typescript
// turns.ts — the spine turnStart and thread/compact/start share (spec Wave 2: "compaction is a turn,
// not a side call"). `runner` is what actually drives the engine once the turn owns the thread:
// turnStart passes session.submit; compact passes session.compact. Returns false when the busy gate
// refused (caller already got its -33001 reply).
export function beginTurn(
  srv: AppServer, ctx: ConnCtx, id: RequestId, record: ThreadRecord,
  runner: (turnId: string, mapper: TurnMapper) => Promise<void>,
  presetTurnId?: string, // M2b's queue drain passes the id minted at enqueue; otherwise mintTurnId()
): boolean
```
- **Turn ids are minted in exactly one function** (spec Wave 4, external review): extract the id
  expression out of `turnStart` into `export function mintTurnId(record: ThreadRecord): string` in
  `turns.ts`, and let `beginTurn` be its only caller. All three start paths — `turn/start`, compact,
  and M2b's queue drain — then produce identical id formats; format drift between them surfaces far
  downstream in replay and the D10 stitch.
`beginTurn` contains, verbatim-moved from `turnStart`: the busy check (now `threadBusyReason(record)` from Task 7 — never a re-assembled condition) + `-33001` reply, the synchronous `busy = true` / `buffer = []` / `interruptRequested = false` / turnId mint block (turns.ts:104-127 today), and the chain callback with reply/broadcasts/onSuccess/onFailure/reportFailed — with `runner(turnId, mapper)` in place of the direct `session.submit(...)` call. `turnStart` becomes a thin wrapper whose runner is:
```typescript
(turnId, mapper) => record.session.submit(parsed.data.input, (m) => emitItems(srv, record, turnId, mapper.ingest(m)))
```
(the Task 6 userMessage emit stays inside `turnStart`'s runner setup — compact has no user prompt).

`lifecycle.ts`:
- `thread/compact/start` — `beginTurn` with runner `(turnId, mapper) => record.session.compact!()` mapped through the same emitItems pattern for any frames compact streams (compact's waiter consumes frames internally; item events during compaction flow through the router's compact_boundary route → Task 8's `thread/compacted`). A fake-driven unit proves: busy during compact (`turn/start` while compacting → `-33001`), `turn/started`/`turn/completed` broadcast pair observed, `thread/compacted` observed when the fake pushes a compact_boundary frame mid-compact.
- `thread/reinitialize` — chain-scoped `session.reinitialize()`, reply `{ init: <fresh payload> }`, then `srv.broadcast(record.id, "thread/capabilities/changed", { threadId: record.id })` (spec: "fresh init payload → also refreshes the capabilities mirror" — the ping tells clients to re-read).
- EngineSession widening: `compact?(): Promise<unknown>; reinitialize?(): Promise<unknown>;`.

- [ ] **Step 1: Failing tests** (the three compact assertions above + reinitialize: fake's `reinitialize` called, reply carries its payload, capabilities-changed ping observed).
- [ ] **Step 2:** FAIL. **Step 3:** implement (extraction first — run the FULL turns.test.ts after the extraction alone, before lifecycle.ts exists: the refactor must be behavior-neutral). **Step 4:** PASS + whole suite green.
- [ ] **Step 5: Sabotage-verify** the busy claim: make compact bypass `beginTurn` (call `session.compact()` bare); the `-33001`-during-compact test FAILS; restore.
- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): compact claims the turn machinery via extracted beginTurn + thread/reinitialize (Wave 2)"`.

---

### Task 12: Session library (`sessionLib.ts`) — store-merged list, fork, rename, tag, delete

**Files:**
- Create: `src/appserver/sessionLib.ts`
- Modify: `src/appserver/server.ts` (AppServerDeps + handler table + thread/list replacement), `src/appserver/schema/threads.ts` + `index.ts`
- Test: `test/unit/appserver/sessionLib.test.ts`

**Interfaces:**
- `AppServerDeps` gains (all DI-defaulted to the real `src/sessions/index.js` exports):
```typescript
  listSessions?: (opts: { cwd?: string; limit?: number; offset?: number }) => Promise<unknown[]>;
  forkSession?: (id: string, opts: { cwd?: string; upToMessageId?: string; title?: string }) => Promise<{ sessionId: string }>;
  renameSession?: (id: string, title: string) => Promise<void>;
  tagSession?: (id: string, tag: string | null) => Promise<void>;
  deleteSession?: (id: string) => Promise<void>;
```
- Schemas (`schema/threads.ts` additions):
```typescript
export const threadListParams = z.object({ cursor: z.string().regex(/^\d+$/).optional(), limit: z.number().int().positive().optional(), cwd: z.string().optional() });
export const threadForkParams = z.object({ threadId: z.string().min(1), upToMessageId: z.string().optional(), title: z.string().optional(), unattended: z.enum(["park", "deny"]).default("park") });
export const threadNameSetParams = z.object({ threadId: z.string().min(1), title: z.string().min(1) });
export const threadTagSetParams = z.object({ threadId: z.string().min(1), tag: z.string().nullable() });
export const threadDeleteParams = z.object({ threadId: z.string().min(1) });
```
- **Id resolution rule (doc-commented once, used by all four CRUD methods):** `threadId` accepts EITHER a registry id (`thr_…` → resolves to `record.sessionId`, refusing `-33005`-style if none yet) OR a bare store `sessionId` (anything else — passed through). This is what lets a client operate on cold sessions the registry never saw.
- `thread/list` (replaces the registry-only handler): merge live registry + `deps.listSessions({cwd})`, **dedup on `sessionId`, live-wins** (spec gap 4). Store-only rows project to the same threadView shape with `origin: "store"`... **No** — parent §5 has no "store" origin; use `id: sessionId` (no `thr_` id exists), `status: { state: "idle" }`, and `title`/`tags`/`preview`/`updatedAt` from `SDKSessionInfo`. Live rows fill `title`/`tags` from a store match when present. Cursor pages the MERGED array (offset cursor, Task 7's convention).
- `thread/fork` — resolve id → `deps.forkSession(sid, {upToMessageId, title})` → then **start a new thread in this server resuming the fork** (the same code path as `thread/resume` — extract `server.ts`'s resume-handler body into an internal `startThread(srv, ctx, id, {resume: sessionId, config, unattended})` shared by `thread/resume` and fork) → reply `{ thread }` of the new record.
- `thread/delete` — if the resolved sessionId belongs to a LIVE record in the registry → `-33001` `"Thread is live in this server — close it first"` (spec D-M2-7). Else `deps.deleteSession(sid)` → reply `{ok: true}` → `srv.broadcastServer("thread/deleted", { sessionId: sid })`.
- `thread/name/set` / `thread/tag/set` — pass-through (safe live, spec D-M2-7); after success, if a live record matches, patch its `title`/`tags` and `srv.broadcast(record.id, "thread/name/updated", { threadId: record.id, title })` (name only — tag has no notification in parent §8; a comment says so).

- [ ] **Step 1: Failing tests** — merged list dedups on sessionId with live-wins (fake store returns a row whose sessionId equals a live record's; expect ONE row, `thr_` id, store title filled in); store-only rows page with cursor; fork calls deps + yields a NEW live thread whose config carried `resume: <forkedId>`; delete on a live session's id → `-33001`; delete cold → deps called + `thread/deleted` to watchers; rename patches a live record's title + `thread/name/updated` to subscribers.
- [ ] **Step 2:** FAIL. **Step 3:** implement (incl. the `startThread` extraction — run the existing server.test.ts after the extraction alone). **Step 4:** PASS + whole suite green.
- [ ] **Step 5: Sabotage-verify** the delete-live guard (remove the registry check; test fails; restore).
- [ ] **Step 6: Commit** — `git commit -m "feat(as2a): session library — store-merged thread/list, fork, rename, tag, delete with live-guard (Wave 2, gap 4)"`.

---

### Task 13: `thread/read` row-paged cursor (gap 12) + limit clamp (gap 10)

**Files:**
- Modify: `src/appserver/subscribe.ts` (threadRead), `src/appserver/server.ts` (AppServerDeps.getSessionMessages gains opts)
- Test: `test/unit/appserver/subscribe.test.ts` (extend)

**Interfaces:**
- `AppServerDeps.getSessionMessages` signature becomes `(sessionId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown[]>` (default impl passes opts through to `src/sessions/index.js`'s `getSessionMessages`, which forwards to the SDK's `limit`/`offset`).
- New cursor semantics (spec Wave 0, verbatim): "the cursor encodes an **absolute row offset from file start**", **epoch-qualified as `"<epoch>:<rowOffset>"`** — M2b's rewind truncates rows, so a bare offset would silently address different content after a rewind (spec Wave 0, external review). Update `cursorParam` in `schema/core.ts` (Task 7 extracted it) to `/^\d+:\d+$/`. On read: split the cursor; if its epoch `!== record.epoch`, reply `-32602` with message `"cursor invalidated by a rewind; re-read from the start"` (the client was already told to rebuild by `thread/rewound`). `nextCursor` is always minted with the record's current epoch. A thread that never rewinds keeps epoch `0` and behaves exactly as the unqualified design did.
- Page algorithm:
  1. `limit = min(requested ?? 200, 500)`; if clamped, `srv.warn(ctx.peer, "limitClamped", "thread/read limit clamped to 500")`.
  2. First page (`cursor` absent): fetch ALL rows once (`getMessages(sid)`), map items, return the NEWEST `limit` items, `nextCursor` = the absolute row index where the returned window BEGAN (so the next page reads older rows `[max(0, begin - windowRows), begin)`).
  3. Subsequent pages: fetch rows `[from, cursorRow)` with `offset: from, limit: cursorRow - from` where `from = max(0, cursorRow - 4 * limit)` (the 4× row-per-item lookahead — rows and items are not 1:1), map through `itemsFromTranscript`, return the newest `limit` items of that window, recurse the window start into `nextCursor` (`"0"` boundary → `nextCursor: null`).
  4. To make item↔row accounting possible, `itemsFromTranscript` is NOT modified; instead the row window is chosen so every item in it COMPLETES in it — tool_use/tool_result straddles resolve as `inProgress`-status items exactly as live finalize does, which is acceptable for history paging and doc-commented ("a straddling tool call renders inProgress on an older page; the newer page carried its completed form — the id-dedup stitch keeps one").
- The mapping cost per page is now `O(window)`, not `O(file)` — the gap-12 fix.

- [ ] **Step 1: Failing tests** — DI fake `getSessionMessages` records `{limit, offset}` per call: second page must NOT fetch the whole file (assert `opts.offset`/`opts.limit` bound the window); limit 9999 → clamped to 500 + `warning` frame observed; paging a 3-page fake transcript returns every item exactly once across pages (dedup by id over the union); a cursor minted at epoch 0 replayed after `record.epoch` is bumped to 1 replies `-32602` instead of returning rows.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat(as2a): thread/read pages by row window with absolute cursor + 500 clamp (gaps 10,12)"`.

---

### Task 14: Console panels for waves 0–2 (`tools/appserver-console.html`)

**Files:**
- Create: `tools/appserver-console.html`

Single file, raw WebSocket + DOM, zero dependencies, opened via `file://` (spec: explicitly disposable, no tests — its job is to be a foreign consumer). Build three panels:
1. **Connect/threads**: url+token inputs → `initialize {watchThreads: true}`; live thread list from `thread/list` + `thread/started`/`thread/closed`/`thread/deleted`/`thread/status/changed`; per-thread subscribe button streaming raw notifications into a log pane.
2. **Settings + meters**: model input + set button, permission-mode select (ladder: default/acceptEdits/auto/plan + bypassPermissions/dontAsk), thinking select (off/low/medium/high/xhigh/max → `{level}`); a "settings" readout updated ONLY from `thread/settings/changed` (never from the reply — that asymmetry is the foreign-consumer test of acceptance 5); usage/contextUsage/capabilities read buttons dumping JSON.
3. **Session library**: store-merged list with cursor "more" button; rename/tag/delete/fork buttons; compact + reinitialize buttons.

No test cycle (spec). Manual check: `node -e "require('node:fs').accessSync('tools/appserver-console.html')"` + the controller's live smoke in Task 15.

- [ ] **Step 1:** Write the file (~300 lines; plain `const ws = new WebSocket(url)`, one `send(method, params)` helper with incrementing ids and a pending-reply map, one `render()` per panel).
- [ ] **Step 2: Commit** — `git commit -m "feat(as2a): appserver console — connect/settings/library panels (waves 0-2 foreign consumer)"`.

---

### Task 15: M2a verification — full gates + live control-plane script (part 1) + scorecard

**Files:**
- Create: `test/live/appserver-m2.test.ts`
- Modify: `docs/parity/appserver.md` (rows shipped in this plan), the spec's `## Surprises & Discoveries` (anything learned)

- [ ] **Step 1: Full local gates**

Run: `npm run typecheck && npm run test:unit` — green. Then `node ../scripts/drift-check.mjs --json` (from `harness/`; the appserver pass must list zero missing rows).

- [ ] **Step 2: Write the live test** — spec acceptance 2's first half (through the reads), plus acceptance 5, as ONE keyed vitest file following `test/live/appserver-m1.test.ts`'s client-helper pattern (`settingSources: []`, `cwd` in a tmp dir, model `claude-sonnet-4-6`):

initialize A `{watchThreads:true}` → initialize B → A `thread/start` → A observes `thread/started` → B `thread/subscribe` → A `thread/model/set {model:"claude-sonnet-4-6"}` → **B** observes `thread/settings/changed {model, source:"client"}` (acceptance 5) → A `thread/thinking/set {level:"low"}` → A `thread/capabilities/read` returns non-empty `models` + `commands` → A `turn/start` (file-write prompt, M1's) → A observes `decision/requested` and `thread/status/changed` with `status.waitingOn === "decision"` → respond allow_once → `turn/completed` → `thread/usage/read` + `thread/contextUsage/read` return objects → `thread/compact/start` → `turn/completed` + `thread/compacted` observed → `thread/fork` yields a distinct thread whose `thread/read` shares ≥1 item id with the parent's `thread/read` → `thread/close` both.

- [ ] **Step 3 (controller): run the live test** — `set -a && source ../.env && set +a && npm run test:live -- test/live/appserver-m2.test.ts` — PASS.

- [ ] **Step 4: Scorecard** — flip this plan's rows in `docs/parity/appserver.md` from `planned(M2)` to `shipped(M2)` (settings 4, introspection 5, session wrappers 6, compact, reinitialize, and the bridge/host duplicate seams they cover), each pointing at its handler file. Re-run `node ../scripts/drift-check.mjs` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add test/live/appserver-m2.test.ts ../docs/parity/appserver.md ../docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md
git commit -m "test(as2a): live control-plane acceptance (waves 0-2) + scorecard flip"
```

---

## Execution notes for the controller

- Task order is the dependency order; nothing parallelizes safely except Task 4 (independent of 3) and Task 14 (independent of 12–13). Task 8 is split into **8a** (absorption, behavior-invariant), **8b** (new routes), **8c** (controller-run keyed smoke) — 8c gates Task 9.
- Tasks 1 and 8c and every `test/live` run are controller-executed (keyed). Never let an implementer source `.env`.
- After Task 8a lands, `latchSessionId` must be GONE (grep for it) — the D-M2-6 absorption is the review lens for that task, and 8a is deliberately behavior-invariant so that lens is the whole review.
- Plan 2 (`2026-07-30-agent-appserver-m2b-rewind-queue.md`) starts only after Task 15 is green.

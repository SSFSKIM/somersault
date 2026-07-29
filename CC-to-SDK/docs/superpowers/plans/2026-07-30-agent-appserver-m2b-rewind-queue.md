# Agent app-server M2b — rewind + MCP + tasks + queue + probes + consumability (waves 3–4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Waves 3–4 of the M2 spec ([`docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`](../specs/2026-07-30-agent-appserver-m2-design.md)): the rewind trio, the MCP quintet, background tasks, the turn queue with its closing latch, the five remaining probes, schema generation + `--emit-schema` + the `cc-harness/appserver` subpath export, the finished console, and the spec's full acceptance.

**Architecture:** Continues Plan 1's (`2026-07-30-agent-appserver-m2a-spine-controls.md`) module pattern: one handler module per cluster (`rewind.ts`, `mcp.ts`, `tasks.ts`, `queue.ts`), schemas in `appserver/schema/`, notifications through `Peer.notify` only. **Prerequisite: every M2a task is merged and green** — this plan consumes `beginTurn`, the frame router, `fanout.ts`, the schema registry, and the widened `EngineSession` without re-explaining them.

**Tech Stack:** TypeScript (ESM, NodeNext), zod v4, vitest, `ws`, `zod-to-json-schema` (draft-7 output — the ONE new dependency, Task 6). All commands run from `CC-to-SDK/harness/`.

## Global Constraints

- Spec: `CC-to-SDK/docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`; parent `2026-07-28-...-protocol-design.md` §5/§7/§8/§9.
- Queue rules (spec Wave 4, verbatim): "**Ids are minted at enqueue time**"; "`thread/close` and `shutdown()` set a **`record.closing` latch synchronously at request arrival** … and flush the queue then and there, broadcasting `turn/completed {status: "cancelled"}` for each"; "drain checks the latch before starting the next queued turn"; "Queued turns are never silently dropped, and no engine call starts after close."
- Probe discipline (spec Wave 4): promote-or-discard criteria are fixed in the probe table BEFORE running; a dead probe's method answers `-32601`; steer is **never faked via interrupt+resubmit**.
- Rewind mirrors `host/host.ts:459-500` ORDER: validation first, file restore on the LIVE engine, then the conversation swap; busy-gated `-33001`; parked decisions block rewind.
- Schema artifacts are **draft-7** ("the CLI-ajv gotcha from Wave 4" — zod's default 2020-12 output is rejected by the CLI's ajv).
- Engine-faithful fakes + sabotage-verify every guard test (M2a Global Constraints carry over verbatim).
- No `Co-Authored-By` lines. Commit prefix `feat(as2b):` / `probe(as2b):` / `test(as2b):`.
- Keyed live tests and all five probes are **controller-run**.
- Test commands: `npm run test:unit -- test/unit/appserver/<file>.test.ts` / `npm run test:unit` / `npm run typecheck`, from `CC-to-SDK/harness/`.

## File Structure (whole plan)

```
harness/src/appserver/
  rewind.ts        # thread/rewind/anchors, /dryRun, /rewind (engine-swap path)
  mcp.ts           # mcpServer/status/list, reconnect, toggle, set, permissionModeOverride/set
  tasks.ts         # task/list, task/stop, turn/background
  queue.ts         # QueuedTurn type + enqueue/flush/drain (state machine, one module)
  schema/mcp.ts    # mcp params · schema/rewind.ts · schema/tasks.ts (registered in schema/index.ts)
harness/scripts/emit-appserver-schema.mjs   # generator (also invoked by `ccx serve --emit-schema`)
harness/schema/json/{stable,experimental}/  # vendored artifacts (generated, committed)
CC-to-SDK/probes/probes/71..74-*.ts           # the five spike files
harness/tools/appserver-console.html        # panels 4-5 added
```

---

### Task 1: Rewind trio (`rewind.ts`)

**Files:**
- Create: `src/appserver/rewind.ts`, `src/appserver/schema/rewind.ts`
- Modify: `src/appserver/registry.ts` (EngineSession gains `rewind?`; record gains `swapInFlight`), `src/appserver/server.ts` (handler table + a `sessionFactory` reuse for the swap), `src/appserver/schema/index.ts`
- Test: `test/unit/appserver/rewind.test.ts`

**Interfaces:**
- `EngineSession` gains `rewind?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>;` (real: `src/session/session.ts:184`).
- `ThreadRecord` gains `swapInFlight?: boolean` — true across dryRun + file restore + engine swap; `turn/start` and `thread/compact/start`'s busy gate treats `swapInFlight` as busy (extend `beginTurn`'s gate: `if (record.busy || record.swapInFlight) { -33001 }`).
- `AppServerDeps` gains `resumeAtFactory?: (sessionId: string, resumeAt: string, config: Record<string, unknown>) => EngineSession` (default: `(sid, at, c) => openSession({ ...c, resume: sid, resumeAt: at } as OpenSessionConfig)` — the same primitive `rewindSession` uses, `src/session/index.ts:30-34`).
- Schemas:
```typescript
import { z } from "zod/v4";
export const rewindAnchorsParams = z.object({ threadId: z.string().min(1) });
export const rewindDryRunParams = z.object({ threadId: z.string().min(1), uuid: z.string().min(1) });
export const rewindParams = z.object({ threadId: z.string().min(1), uuid: z.string().min(1), prevUuid: z.string().min(1).nullable(), scope: z.enum(["both", "conversation", "code"]) });
```
- Handlers (mirroring `host/host.ts:442-500` exactly — that code is the proven order):
  - `thread/rewind/anchors` — `getMessages(record.sessionId)` → `rewindAnchorsFrom(rows)` (`src/sessions/rows.ts`) → `{ data: anchors, nextCursor: null }`. No sessionId yet → `{ data: [] }`.
  - `thread/rewind/dryRun` — normalize throw-vs-return like `host.rewindDryRun`: missing `session.rewind` → `{ canRewind: false, error: "rewind unsupported by this engine" }`; a throw → `{ canRewind: false, error }`; else the engine's own result. Read-only, un-chained.
  - `thread/rewind` — chain-scoped, and in order: (1) busy/park gates: `record.busy || record.swapInFlight` → `-33001`; `srv.pendingDecisions(record.id).length` → `-33001` `"a decision is pending — answer it first"`; no `record.sessionId` → `-33005`. (2) `scope !== "code" && !prevUuid` → `-32602` `"no conversation anchor before the first prompt — code-only rewind is available"`. (3) `record.swapInFlight = true` in a try/finally. (4) `scope !== "conversation"`: dryRun first, refuse on `!canRewind`, then real `session.rewind(uuid)`. (5) `scope !== "code"`: **engine swap** — `record.routerOff?.()`, `await record.session.dispose()` — **wait**: the old engine may hold parked decisions; there are none (gate 1 refused if any) and no turn is in flight (busy gate), so dispose is safe — then `record.session = deps.resumeAtFactory(sessionId, prevUuid, originalConfig)`, `installRouter(srv, record)`, `record.sessionId = undefined` + the router's init latch re-learns it, `record.turnSeq` keeps counting (turn ids stay unique). Store the thread's ORIGINAL config on the record at start/resume time (`ThreadRecord` gains `config?: Record<string, unknown>` — set it in `startThread`) so the swap can rebuild. (6) Broadcast `thread/rewound { threadId, sessionId }` to subscribers AND watchers; reply `{ ok: true, sessionId }`.
- `thread/rewound` is a NEW notification — add to the parent §8 list via its Revision Notes (one line, flagged — the host's `rewound` event is the precedent).

- [ ] **Step 1: Failing tests** — anchors maps a fake transcript through `rewindAnchorsFrom` (one prompt row + one phantom row → one anchor); dryRun normalizes a THROWING fake to `{canRewind:false}`; rewind refuses while busy (`-33001`), while parked (`-33001`), and `both`-scope with null prevUuid (`-32602`) — each BEFORE the fake's `rewind` was called (assert call count 0); happy-path `both`: fake's rewind called with (uuid, {dryRun:true}) then (uuid), old session disposed, factory called with (sessionId, prevUuid, config), router reinstalled (new fake's onFrame subscribed), `thread/rewound` observed; `turn/start` during a hung swap (factory returns a pending promise — engine-faithful) → `-33001`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** implement. **Step 4:** PASS + whole suite green.
- [ ] **Step 5: Sabotage-verify** the validation-before-side-effects guard: move the prevUuid check after the file restore; the "call count 0" test FAILS; restore.
- [ ] **Step 6: Commit** — `git commit -m "feat(as2b): rewind trio — anchors/dryRun/rewind with engine swap, host-order validation (Wave 3)"`.

---

### Task 2: MCP quintet (`mcp.ts`)

**Files:**
- Create: `src/appserver/mcp.ts`, `src/appserver/schema/mcp.ts`
- Modify: `src/appserver/registry.ts` (EngineSession widening), `src/appserver/server.ts` (handler table), `src/appserver/schema/index.ts`
- Test: `test/unit/appserver/mcp.test.ts`

**Interfaces:**
- `EngineSession` gains (real: `src/session/session.ts:160-183`):
```typescript
  mcpServerStatus?(): Promise<unknown[]>;
  reconnectMcpServer?(serverName: string): Promise<void>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers?(servers: Record<string, unknown>): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>;
  setMcpPermissionModeOverride?(serverName: string, mode: string | null): Promise<unknown>;
```
- Schemas:
```typescript
import { z } from "zod/v4";
export const mcpStatusParams = z.object({ threadId: z.string().min(1) });
export const mcpNameParams = z.object({ threadId: z.string().min(1), name: z.string().min(1) });
export const mcpToggleParams = z.object({ threadId: z.string().min(1), name: z.string().min(1), enabled: z.boolean() });
export const mcpSetParams = z.object({ threadId: z.string().min(1), servers: z.record(z.string(), z.unknown()) });
export const mcpOverrideParams = z.object({ threadId: z.string().min(1), name: z.string().min(1), mode: z.string().nullable() });
```
- Handlers (mutations chain-scoped; status read un-chained):
  - `mcpServer/status/list` → `{ data: await session.mcpServerStatus() , nextCursor: null }`.
  - `mcpServer/reconnect` — the SDK THROWS for SDK-type servers ("SDK servers should be handled in print.ts", session.ts doc); catch and reply `-32602` with the engine's message (spec Wave 3: "surface as `-32602`-class method error with the SDK's message"). Success → `{ok: true}`.
  - `mcpServer/toggle` — same throw mapping for SDK-type; success `{ok: true}`. The schema description string carries the spec's advisory warning verbatim: `"advisory, not a security boundary — a model tool call resurrects a disabled server; gate with permissions instead"`.
  - `mcpServer/set` → replies the engine's `{added, removed, errors}` receipt verbatim.
  - `mcpServer/permissionModeOverride/set` → `{ok: true}` (rules-layer only — doc-comment probe 49's caveat).
- All five register in `methodSchemas`.

- [ ] **Step 1: Failing tests** — status returns the fake's array; reconnect on a THROWING fake (message `"SDK servers should be handled in print.ts"`) replies code `-32602` carrying that message; toggle passes `(name, enabled)` through; set replies the receipt object; override passes `null` through (clear-pin).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + suite + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(as2b): MCP quintet — status/reconnect/toggle/set/permissionModeOverride (Wave 3)"`.

---

### Task 3: Background tasks (`tasks.ts`)

**Files:**
- Create: `src/appserver/tasks.ts`, `src/appserver/schema/tasks.ts`
- Modify: `src/appserver/registry.ts` (EngineSession widening), `src/appserver/server.ts` (handler table), `src/appserver/schema/index.ts`
- Test: `test/unit/appserver/tasks.test.ts`

**Interfaces:**
- `EngineSession` gains (real: `src/session/session.ts:137-142`):
```typescript
  stopTask?(taskId: string): Promise<void>;
  backgroundAll?(toolUseId?: string): Promise<boolean>;
  listBackgroundTasks?(): Promise<Array<{ task_id: string; task_type: string; description: string }>>;
```
- Schemas:
```typescript
import { z } from "zod/v4";
export const taskListParams = z.object({ threadId: z.string().min(1) });
export const taskStopParams = z.object({ threadId: z.string().min(1), taskId: z.string().min(1) });
export const turnBackgroundParams = z.object({ threadId: z.string().min(1), toolUseId: z.string().optional() });
```
- Handlers: `task/list` → `{ data, nextCursor: null }`; `task/stop` → `{ok: true}` (the CLI's own `task_notification{stopped}` + changed frame arrive via M2a's router as `task/event` + `task/changed` — nothing more to emit here, doc-comment it); `turn/background` → `{ backgrounded: <the boolean receipt> }`.

- [ ] **Step 1: Failing tests** — list returns the fake's snapshot; stop passes taskId; background passes optional toolUseId and returns the receipt; the ROUTER (already shipped) turns a `background_tasks_changed` frame into `task/changed` — one integration-style assertion wiring a real router over the tasks fake to prove the cluster is complete without new notification code.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat(as2b): background tasks — task/list, task/stop, turn/background (Wave 3)"`.

---

### Task 4: Turn queue + closing latch (`queue.ts`)

The concurrency-shaped task — states and transitions fixed here, per the spec's pinned mechanism.

**States** (per queued entry): `queued` → `started` (drain) | `cancelled` (flush). Record-level: `closing: boolean` latch, set synchronously by `thread/close`/`shutdown()` at request arrival, never cleared.

**Linearization points:** (1) enqueue mints the id inside `turn/start`'s synchronous section (same tick as the busy check); (2) flush runs inside `thread/close`'s synchronous section (before its chain hop) and inside `shutdown()` before awaiting chains; (3) drain runs in `settleTurn` and checks `closing` + queue non-empty synchronously before re-entering `beginTurn`'s spine.

**Files:**
- Create: `src/appserver/queue.ts`
- Modify: `src/appserver/registry.ts` (record gains `closing: boolean; queue: QueuedTurn[]`), `src/appserver/schema/turns.ts` (turnStart gains `queue`), `src/appserver/turns.ts` (enqueue arm in `turnStart`; drain in `settleTurn`; `turn/interrupt` flush arm), `src/appserver/server.ts` (`thread/close` + `shutdown` set latch + flush)
- Test: `test/unit/appserver/queue.test.ts`

**Interfaces:**
- `schema/turns.ts`: `turnStartParams` gains `queue: z.boolean().optional()`; `turnInterruptParams` unchanged (`cancelQueued` already there).
- `queue.ts`:
```typescript
// appserver/queue.ts — the server-side turn queue (spec Wave 4, X-gated). State machine, one module:
// enqueue (id minted HERE — the enqueue reply, cancel receipts, and the eventual turn/started must all
// carry one correlatable id) / flushQueue (close/interrupt path: broadcast turn/completed cancelled for
// each, NEVER silently drop) / drainNext (settleTurn path: checks the closing latch — a settle racing a
// close finds the latch up and the queue empty, and starts nothing).
import type { AppServer } from "./server.js";
import type { ThreadRecord } from "./registry.js";

export interface QueuedTurn { id: string; input: string }

export function enqueueTurn(record: ThreadRecord, input: string): { id: string; position: number } {
  const id = `turn_${record.id}_${++record.turnSeq}`; // same mint as beginTurn — FIFO drain preserves seq order
  record.queue.push({ id, input });
  return { id, position: record.queue.length };
}

export function flushQueue(srv: AppServer, record: ThreadRecord): string[] {
  const cancelled = record.queue.splice(0);
  for (const q of cancelled) {
    srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: q.id, status: "cancelled" } });
  }
  return cancelled.map((q) => q.id);
}

/** Returns the next queued turn to start, or undefined. The closing check is THE latch rule (spec):
 *  drain must never start an engine call after close began. */
export function takeNext(record: ThreadRecord): QueuedTurn | undefined {
  if (record.closing) return undefined;
  return record.queue.shift();
}
```
- `turns.ts` changes:
  - `turnStart`'s busy refusal becomes: `if (record.busy || record.swapInFlight) { if (parsed.data.queue) { const q = enqueueTurn(record, parsed.data.input); ctx.peer.reply(id, { queued: true, turn: { id: q.id, status: "queued" }, position: q.position }); } else { ctx.peer.replyError(id, ERR.BUSY, "Thread is busy"); } return; }`.
  - `beginTurn` gains an optional `presetTurnId?: string` — when present, uses it instead of minting (the drain path's pre-minted id); the mint line becomes `const turnId = presetTurnId ?? \`turn_${record.id}_${++record.turnSeq}\`;`.
  - `settleTurn(record)` gains a `srv` param and, after `applyPlanUpgrade`: `const next = takeNext(record); if (next) startQueuedTurn(srv, record, next);` where `startQueuedTurn` re-enters the spine with `presetTurnId: next.id` and a null peer-reply (the enqueue already replied — the chain callback's `ctx.peer.reply` is skipped via an optional ctx; make `beginTurn`'s ctx/id params optional and guard the reply).
  - `turn/interrupt` with `cancelQueued: true`: `const cancelledQueued = flushQueue(srv, record);` BEFORE `requestInterrupt`, reply `{ interrupted: true, cancelledQueued }`.
- `server.ts` changes: `thread/close` handler sets `record.closing = true; flushQueue(srv, record);` synchronously before the chain hop. `shutdown()` does the same per record before awaiting chains.

- [ ] **Step 1: Failing tests** (the spec's transition table, one test per transition):

```typescript
describe("turn queue (spec Wave 4)", () => {
  it("turn/start{queue:true} on a busy thread replies {queued, turn.id, position} with a pre-minted id", ...);
  it("without the flag a busy thread still answers -33001", ...);
  it("drain starts the queued turn after settle: its turn/started carries the ENQUEUE-time id", ...);
  it("FIFO: two queued turns drain in order, one at a time", ...);
  it("interrupt{cancelQueued:true} flushes first: receipt lists the ids, each got turn/completed cancelled", ...);
  it("thread/close cancels queued turns synchronously and no engine call starts after close", async () => {
    // Engine-faithful: submit resolves on command; queue one turn; issue thread/close while the first
    // turn is in flight; release the first turn. Assert: queued turn got turn/completed cancelled,
    // fake.submitCalls === 1 (the drained turn NEVER submitted), close replied ok.
  });
  it("the drain-vs-close race: a settle racing a close finds the latch up and starts nothing", ...);
  it("shutdown cancels queued turns on every record", ...);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + whole suite green.
- [ ] **Step 5: Sabotage-verify BOTH latch guards** — (a) remove `record.closing = true` from thread/close: the no-engine-call-after-close test FAILS; (b) remove the `closing` check in `takeNext`: the race test FAILS. Restore both; report both observed failures.
- [ ] **Step 6: Commit** — `git commit -m "feat(as2b): turn queue — enqueue-minted ids, FIFO drain, closing latch, cancelQueued flush (Wave 4)"`.

---

### Task 5: Probes 1–5 = files 71–74 (spikes, controller-run)

**Files:**
- Create: `probes/probes/71-streaminput-steer.ts`, `probes/probes/72-readfile.ts`, `probes/probes/73-reload-plugins-skills.ts` (probes 3+4 share a file — same shape), `probes/probes/74-register-repo-root.ts`
- Modify (verdict-dependent): spec `## Surprises & Discoveries`

Each probe: build → controller runs keyed → record verdict in the spec → apply the spec's promote-or-discard row. Probe shapes (all follow the 69-transcript-at-park skeleton — `query()` with `settingSources: []`, haiku, `bypassPermissions`):

1. **probe-71 (steer):** start a turn with a long multi-step prompt ("count to 30 slowly, one number per line"); 2s in, call `q.streamInput({ type: "user", message: { role: "user", content: "STOP COUNTING and instead reply exactly: steered" }, ... })` if the method exists (log `typeof q.streamInput`); observe whether the assistant's subsequent output reflects the injection. Verdict ALIVE requires: method exists AND the injected text influenced the same turn.
2. **probe-72 (readFile):** write a tmp file; call `q.readFile(path)` (log existence + result/throw).
3. **probe-73 (reloads):** call `q.reloadPlugins()` then `q.reloadSkills()` (log existence + result/throw each).
4. **probe-74 (register_repo_root):** locate the control-request surface on Query (`sdk.d.ts` names it — log `typeof q.registerRepoRoot` and any request-shaped escape hatch); attempt with a second tmp git dir; verdict by result + any `DirectoryAdded` hook frame observed.

**Promotion tasks (write only the ALIVE ones, per recorded verdicts):**
- Steer ALIVE → lib seam `Session.steer(text: string): void` (push a user message into `this.input` WITHOUT a waiter — doc-comment why: `enqueueTurn` pairs every push with a waiter and a steer must not desync the FIFO), `EngineSession.steer?`, method `turn/steer {threadId, input}` (X) — busy-REQUIRED (`-33001` inverse: steering an idle thread is `-32602 "no turn in flight"`), schema + registry + unit tests (fake asserts no waiter added).
- reloadPlugins/reloadSkills ALIVE → `plugin/reload` / `skill/reload` thin chain-scoped handlers `{ok: true}` + schemas + tests.
- register_repo_root ALIVE → `thread/directory/add {threadId, path}` (X) + schema + test.
- Any DEAD → the method is NOT added; `methodSchemas` untouched; scorecard row N/A-dead citing the probe file (Task 9 flips it).
- readFile — **no method either way** (spec: M3 `fs/read` backing knowledge only).

- [ ] **Step 1:** Write the four probe files. **Step 2 (controller):** run each keyed, capture JSON verdicts. **Step 3:** record all verdicts in the spec's Surprises section. **Step 4:** implement the ALIVE promotions (unit-tested, no live). **Step 5:** `npm run test:unit` green. **Step 6: Commit** — `git commit -m "probe(as2b): probes 71-74 verdicts + alive-surface promotions (steer/reloads/directory-add per verdict)"`.

---

### Task 6: Schema generation + `--emit-schema` + round-trip gate

**Files:**
- Create: `scripts/emit-appserver-schema.mjs`, `schema/json/stable/appserver.json`, `schema/json/experimental/appserver.json` (generated, committed)
- Modify: `src/appserver/schema/index.ts` (entries gain `experimental?: true` on X methods: `turn/steer`, `thread/directory/add` if alive; queue-flagged turnStart stays stable — the FLAG is experimental but the method is stable; doc-comment), `src/cli/serveMain.ts` + `src/cli/args.ts` (`--emit-schema DIR`), `package.json` (add `zod-to-json-schema` dep + `"emit-schema": "node scripts/emit-appserver-schema.mjs"` script), `../scripts/drift-check.mjs` (round-trip entry)
- Test: `test/unit/appserver/schemaGen.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// Round-trip: regenerating must reproduce the vendored artifacts byte-for-byte, and every registered
// method must appear in exactly one artifact (stable XOR experimental).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
it("vendored schema artifacts match a fresh generation", () => {
  const fresh = execFileSync("node", ["scripts/emit-appserver-schema.mjs", "--stdout"], { encoding: "utf8" });
  const vendored = JSON.stringify({
    stable: JSON.parse(readFileSync("schema/json/stable/appserver.json", "utf8")),
    experimental: JSON.parse(readFileSync("schema/json/experimental/appserver.json", "utf8")),
  });
  expect(JSON.parse(fresh)).toEqual(JSON.parse(vendored));
});
it("every methodSchemas entry lands in exactly one artifact and every artifact is draft-7", ...);
```

- [ ] **Step 2:** FAIL. **Step 3:** implement the generator — walks `methodSchemas` (dynamic-import of the built TS via tsx), converts each params schema via `zod-to-json-schema` with `{ target: "jsonSchema7" }` (the draft-7 constraint), writes `{ $schema: "http://json-schema.org/draft-07/schema#", methods: { <name>: {...} } }` per artifact set, `--stdout` mode for the test. `--emit-schema DIR` in serveMain: before binding, if the flag is present, run the same generation into DIR and exit 0. Add a drift-check entry: the appserver pass additionally fails when a `methodSchemas` key has no scorecard row or a shipped scorecard row has no `methodSchemas` key (the "zero schema-less methods" acceptance gate).
- [ ] **Step 4:** Generate + commit artifacts; tests PASS; `node ../scripts/drift-check.mjs --json` exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat(as2b): schema generation — draft-7 artifacts, --emit-schema, round-trip drift gate (§9)"`.

---

### Task 7: `cc-harness/appserver` subpath export

**Files:**
- Modify: `package.json` (`exports` gains `"./appserver"`), `src/appserver/index.ts` (create: the public surface), `scripts/verify-package.mjs` consumers if the verify script asserts export maps
- Test: `test/unit/appserver/exports.test.ts`

- [ ] **Step 1: Failing test** — dynamic-import the subpath through the package name (vitest alias or relative dist check; simplest: import `src/appserver/index.js` and assert the exact export set `{ AppServer, listenWs, methodSchemas }` plus type-only re-exports compile via typecheck).
- [ ] **Step 2:** FAIL. **Step 3:** create `src/appserver/index.ts` exporting `AppServer`, `listenWs`, `methodSchemas`, and types (`ThreadRecord`, `EngineSession`, `WsListenOpts`); add `"./appserver": { "types": "./dist/appserver/index.d.ts", "import": "./dist/appserver/index.js" }` to `package.json` exports. Run `npm run build && npm run verify:pack` — green.
- [ ] **Step 4:** PASS. **Step 5: Commit** — `git commit -m "feat(as2b): cc-harness/appserver subpath export (gap 11 — shapes settled)"`.

---

### Task 8: Console panels 4–5

**Files:**
- Modify: `tools/appserver-console.html`

Panel 4 (rewind/MCP/tasks): anchors list with per-anchor dryRun + rewind buttons (scope select both/conversation/code); MCP status table with reconnect/toggle buttons; task list with stop + background-all buttons. Panel 5 (queue): prompt input with a "queue" checkbox, queued-turn list updating from `turn/started`/`turn/completed` (including `cancelled`), stop button sending `turn/interrupt {cancelQueued: true}`. No tests (spec).

- [ ] **Step 1:** Implement. **Step 2: Commit** — `git commit -m "feat(as2b): console panels — rewind/MCP/tasks + queue (waves 3-4)"`.

---

### Task 9: M2 final verification — the spec's acceptance, verbatim

**Files:**
- Modify: `test/live/appserver-m2.test.ts` (extend with waves 3–4), `docs/parity/appserver.md`, `docs/parity/coverage.md`, spec `## Outcomes & Retrospective`

The spec's `## Acceptance (behavior-phrased)` section, executed as written:

- [ ] **Step 1 (acceptance 1):** Run `npm test (from CC-to-SDK/harness)` — green — and `node scripts/drift-check.mjs --json` (repo `CC-to-SDK/`) — "exits 0 with the appserver pass listing zero missing rows and zero schema-less methods."
- [ ] **Step 2 (acceptance 2, controller):** extend the live script with the waves 3–4 legs so the one keyed run performs the spec's full sequence: "`initialize{watchThreads:true}` → `thread/start` → observe `thread/started` → `thread/model/set` → observe `thread/settings/changed` with `source:"client"` → `thread/thinking/set` → `thread/capabilities/read` returns non-empty models + commands → turn with a file write → decision park shows `status.waitingOn === "decision"` → respond → `thread/usage/read` + `thread/contextUsage/read` return numbers → `thread/rewind/dryRun` against the turn's anchor succeeds → `mcpServer/status/list` returns → `turn/start{queue:true}` while busy returns `{queued: true, turn}` whose id later appears in `turn/started` when it drains → `thread/compact/start` completes and `thread/compacted` carries an outcome → `thread/fork` yields a distinct thread whose `thread/read` shares item ids with the parent → `thread/close`. Each observation is an assertion, not a log line." Run keyed — PASS.
- [ ] **Step 3 (acceptance 5, controller):** already asserted inside the live script (second client observes the first's model/set as settings/changed) — confirm the assertion exists and passed.
- [ ] **Step 4 (acceptance 3):** scorecard sweep — "every non-fleet row reads shipped or N/A-with-evidence; the six probe rows cite their probe file by name." Flip the waves 3–4 rows (rewind trio, MCP 5, tasks 3, queue, steer/reloads/directory-add per verdict, probe N/A rows). `node scripts/drift-check.mjs` exit 0.
- [ ] **Step 5 (acceptance 4, controller):** console smoke — every panel of `tools/appserver-console.html` performs its wave's operations against a live `ccx serve` (manual; record the outcome in the task report).
- [ ] **Step 6:** refresh `docs/parity/coverage.md` domain 10; write the spec's `## Outcomes & Retrospective`; final commit:

```bash
git add -A
git commit -m "test(as2b): M2 acceptance — full live control-plane run, scorecard at shipped-or-N/A, retrospective"
```

---

## Execution notes for the controller

- Task order: 1 → 2 → 3 → 4 are independent of each other EXCEPT 4 (queue) touches `turns.ts`/`server.ts` shared with 1's busy-gate change — run 1 before 4; 2 and 3 can interleave anywhere before 9. Task 5's probes can run (controller) any time; its promotions before 6. 6 → 7 → 8 → 9 strictly ordered.
- Probes and every keyed live run are controller-executed. Implementers never source `.env`.
- Task 4's review lens: the two sabotage-verified latch guards — demand the observed failure output in the report.
- After Task 9, run the finishing-a-development-branch flow (external `codex exec review` on the merge commit is the standing final ritual).

# Observability Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the SDK's read-side introspection — `listSessions`/`getSessionMessages`/`getSessionInfo` (standalone store readers) and `getContextUsage`/`accountInfo` (live-session control methods) — as harness capability on the lib, the `Harness` object, and the daemon.

**Architecture:** Thin glue + surfacing, no storage/normalization engine. A new `src/sessions/reader.ts` wraps the SDK readers with a `cwd`→`dir` mapping (DI-friendly). `Harness` gains two control-method delegations via the existing `call()` pattern. The daemon gains persisted-store read ops (`sessions`/`messages`, distinct from the live-registry `list`) and two live-introspection control frames (`context_usage`/`account_info`).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, Zod v4 (`zod/v4`), `@anthropic-ai/claude-agent-sdk` 0.3.178.

**Spec:** `docs/superpowers/specs/2026-06-17-observability-read-api-design.md`

## Global Constraints

- **Read-only.** No write/mutation ops (`renameSession`/`tagSession`/`deleteSession`), no `forkSession`, no daemon `SessionRecord`-index persistence, no control-plane transport (HTTP/UI). The daemon only becomes *able to serve* reads over the existing UDS NDJSON protocol.
- **Thin passthrough** — no storage or normalization engine. The reader's only logic is mapping the harness `cwd` → SDK `dir`; everything else passes through. Reader functions take an injectable `deps` param defaulting to the real SDK fn (mirrors `createHarness(deps.query)`).
- **Daemon read ops are DISTINCT from the existing `list`** — `list` returns the live in-memory `SessionRecord` registry; `sessions`/`messages` read the persisted on-disk store (`SDKSessionInfo`/`SessionMessage`). Do not conflate them, and route the daemon ops through the same `src/sessions/reader.ts` (DRY).
- **Control frames model the existing `initialize` frame** — return `{ ok: true, <payload> }`, and feature-detect a missing method into `{ ok: false, error: "unsupported: <name>" }` exactly like the existing `ControlBridge.call`.
- **`ControllableSession` additions are optional** (`getContextUsage?`/`accountInfo?`) so the bridge feature-detects.
- **No Prettier.** Match the surrounding compact hand-style (single-line guards, inline `case`).
- **Commit to `main`. Never push. No `Co-Authored-By` lines or attribution.**
- Working dir: `CC-to-SDK/harness/`. Tests: `npx vitest run <path>` (one file), `npm run test:unit`, `npm run test:live`, `npm run typecheck`.

---

### Task 1: Standalone reader module (`cwd`→`dir` glue)

**Files:**
- Create: `src/sessions/reader.ts`
- Create: `src/sessions/index.ts`
- Modify: `src/index.ts` (add exports)
- Test: `test/unit/sessions-reader.test.ts` (create), `test/unit/index.test.ts`

**Interfaces:**
- Consumes: SDK `listSessions`/`getSessionMessages`/`getSessionInfo` + types `SessionStore`/`SDKSessionInfo`/`SessionMessage` from `@anthropic-ai/claude-agent-sdk`.
- Produces: `listSessions(opts?: ListSessionsOpts, deps?)`, `getSessionMessages(id, opts?: GetMessagesOpts, deps?)`, `getSessionInfo(id, opts?: GetInfoOpts, deps?)`. Each maps `opts.cwd` → SDK `dir`. Task 4 (daemon) reuses these.

- [ ] **Step 1: Write the failing tests** — create `test/unit/sessions-reader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { listSessions, getSessionMessages, getSessionInfo } from "../../src/sessions/reader.js";

describe("sessions reader (cwd→dir glue)", () => {
  it("maps cwd to dir and passes through list options", async () => {
    const calls: any[] = [];
    const deps = { listSessions: async (o: any) => { calls.push(o); return [{ sessionId: "s1" }]; } };
    const r = await listSessions({ cwd: "/proj", limit: 5, offset: 2, includeWorktrees: false }, deps as any);
    expect(r).toEqual([{ sessionId: "s1" }]);
    expect(calls[0]).toEqual({ dir: "/proj", limit: 5, offset: 2, includeWorktrees: false });
    expect(calls[0]).not.toHaveProperty("cwd");
  });
  it("omits dir when no cwd is given", async () => {
    const calls: any[] = [];
    const deps = { listSessions: async (o: any) => { calls.push(o); return []; } };
    await listSessions({ limit: 1 }, deps as any);
    expect(calls[0]).toEqual({ limit: 1 });
    expect(calls[0]).not.toHaveProperty("dir");
  });
  it("getSessionMessages maps cwd→dir and passes id + options", async () => {
    const calls: any[] = [];
    const deps = { getSessionMessages: async (id: string, o: any) => { calls.push([id, o]); return [{ uuid: "u1" }]; } };
    const r = await getSessionMessages("sess-9", { cwd: "/p", includeSystemMessages: true }, deps as any);
    expect(r).toEqual([{ uuid: "u1" }]);
    expect(calls[0]).toEqual(["sess-9", { dir: "/p", includeSystemMessages: true }]);
  });
  it("getSessionInfo maps cwd→dir and passes id", async () => {
    const calls: any[] = [];
    const deps = { getSessionInfo: async (id: string, o: any) => { calls.push([id, o]); return { sessionId: id }; } };
    const r = await getSessionInfo("sess-9", { cwd: "/p" }, deps as any);
    expect(r).toEqual({ sessionId: "sess-9" });
    expect(calls[0]).toEqual(["sess-9", { dir: "/p" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/sessions-reader.test.ts`
Expected: FAIL — cannot import from `../../src/sessions/reader.js` (module does not exist).

- [ ] **Step 3: Create the reader module** — create `src/sessions/reader.ts`:

```ts
import { listSessions as sdkListSessions, getSessionMessages as sdkGetSessionMessages,
         getSessionInfo as sdkGetSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStore, SDKSessionInfo, SessionMessage } from "@anthropic-ai/claude-agent-sdk";

// Harness convention is `cwd`; the SDK readers filter by `dir`. These wrappers' only job is that
// rename (plus passthrough). The SDK persists transcripts to ~/.claude/projects; `dir` scopes to a
// project (and its git worktrees by default). DI `deps` defaults to the real SDK fn for testability.
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

- [ ] **Step 4: Create the module index** — create `src/sessions/index.ts`:

```ts
export { listSessions, getSessionMessages, getSessionInfo } from "./reader.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts } from "./reader.js";
```

- [ ] **Step 5: Export from the public API** — in `src/index.ts`, append:

```ts
export { listSessions, getSessionMessages, getSessionInfo } from "./sessions/index.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts } from "./sessions/index.js";
```

- [ ] **Step 6: Add the public-API export assertion** — in `test/unit/index.test.ts`, inside the `it("exports …")` block (before its closing `});`):

```ts
    expect(typeof api.listSessions).toBe("function");
    expect(typeof api.getSessionMessages).toBe("function");
    expect(typeof api.getSessionInfo).toBe("function");
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/sessions-reader.test.ts test/unit/index.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add CC-to-SDK/harness/src/sessions CC-to-SDK/harness/src/index.ts CC-to-SDK/harness/test/unit/sessions-reader.test.ts CC-to-SDK/harness/test/unit/index.test.ts
git commit -m "feat(harness): session reader module (listSessions/getSessionMessages/getSessionInfo, cwd→dir)"
```

---

### Task 2: Harness live introspection (`getContextUsage` / `accountInfo`)

**Files:**
- Modify: `src/harness.ts` (interface + returned object)
- Test: `test/unit/harness.test.ts`

**Interfaces:**
- Consumes: the existing `call(name)` helper in `src/harness.ts` (throws `"<name>() unavailable: start a query first"` when no query is active) and the `fakeQuery` test helper.
- Produces: `Harness.getContextUsage(): Promise<unknown>` and `Harness.accountInfo(): Promise<unknown>`.

- [ ] **Step 1: Write the failing tests** — in `test/unit/harness.test.ts`, add two methods to the `fakeQuery` helper (after the existing `q.supportedCommands = …` line):

```ts
  q.getContextUsage = async () => ({ totalTokens: 42 });
  q.accountInfo = async () => ({ apiProvider: "anthropic" });
```

Then append inside the `describe("createHarness", …)` block (before its closing `});`):

```ts
  it("getContextUsage()/accountInfo() delegate to the active query", async () => {
    const h = createHarness({}, { query: fakeQuery });
    const it = h.stream("ping"); await it.next(); // start a query
    expect(await h.getContextUsage()).toEqual({ totalTokens: 42 });
    expect(await h.accountInfo()).toEqual({ apiProvider: "anthropic" });
  });
  it("getContextUsage() throws before a query starts", async () => {
    const h = createHarness({}, { query: fakeQuery });
    await expect(h.getContextUsage()).rejects.toThrow(/start a query first/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/harness.test.ts`
Expected: FAIL — `h.getContextUsage` is not a function.

- [ ] **Step 3: Add to the `Harness` interface** — in `src/harness.ts`, in the `Harness` interface, after the `supportedAgents(): Promise<unknown>;` line:

```ts
  getContextUsage(): Promise<unknown>;
  accountInfo(): Promise<unknown>;
```

- [ ] **Step 4: Wire the delegations** — in `src/harness.ts`, in the returned object, after the `supportedAgents: call("supportedAgents"),` line:

```ts
    getContextUsage: call("getContextUsage"),
    accountInfo: call("accountInfo"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/harness.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/harness.ts CC-to-SDK/harness/test/unit/harness.test.ts
git commit -m "feat(harness): Harness.getContextUsage()/accountInfo() (active-query delegation)"
```

---

### Task 3: Bridge control frames + DaemonSession introspection

**Files:**
- Modify: `src/bridge/types.ts` (`ControllableSession` + `controlFrame`)
- Modify: `src/bridge/control.ts` (`ControlBridge` cases + payload helper)
- Modify: `src/daemon/session.ts` (`DaemonSession` methods)
- Test: `test/unit/bridge.test.ts`, `test/unit/daemon-session-control.test.ts`

**Interfaces:**
- Consumes: existing `ControlBridge.apply`, `ControllableSession`, the `controlFrame` discriminated union; `DaemonSession`'s `assertRunning()` guard and `this.q` Query handle.
- Produces: control frames `{ type: "context_usage" }` / `{ type: "account_info" }`; `ControlBridge` returns `{ ok: true, usage }` / `{ ok: true, account }`; `DaemonSession.getContextUsage()` / `accountInfo()`.

- [ ] **Step 1: Write the failing bridge tests** — in `test/unit/bridge.test.ts`:

Add the two frame-parse assertions inside the `it("controlFrame rejects an unknown frame type …")` test (after the existing `expect(controlFrame.safeParse({ type: "set_model", model: "x" }).success).toBe(true);` line):

```ts
    expect(controlFrame.safeParse({ type: "context_usage" }).success).toBe(true);
    expect(controlFrame.safeParse({ type: "account_info" }).success).toBe(true);
```

Then append two tests inside the `describe("ControlBridge", …)` block (before its closing `});`):

```ts
  it("context_usage / account_info return their payloads", async () => {
    const s = fakeSession([], { getContextUsage: async () => ({ totalTokens: 7 }), accountInfo: async () => ({ apiProvider: "anthropic" }) });
    expect(await ControlBridge.apply(s, { type: "context_usage" })).toEqual({ ok: true, usage: { totalTokens: 7 } });
    expect(await ControlBridge.apply(s, { type: "account_info" })).toEqual({ ok: true, account: { apiProvider: "anthropic" } });
  });
  it("reports unsupported when context_usage method is absent", async () => {
    expect(await ControlBridge.apply(fakeSession([]), { type: "context_usage" })).toEqual({ ok: false, error: "unsupported: getContextUsage" });
  });
```

- [ ] **Step 2: Write the failing DaemonSession test** — in `test/unit/daemon-session-control.test.ts`, add two methods to the `controllableQuery` helper's `Object.assign(gen, { … })` block (after the existing `mcpServerStatus: async () => …` line):

```ts
      getContextUsage: async () => ({ totalTokens: 11 }),
      accountInfo: async () => ({ apiProvider: "anthropic" }),
```

Then append inside the `describe("DaemonSession control surface", …)` block (before its closing `});`):

```ts
  it("getContextUsage/accountInfo delegate to the Query and reject once ended", async () => {
    const s = new DaemonSession("s4", { query: controllableQuery([]) }, {});
    expect(await s.getContextUsage()).toEqual({ totalTokens: 11 });
    expect(await s.accountInfo()).toEqual({ apiProvider: "anthropic" });
    await s.dispose();
    await expect(s.getContextUsage()).rejects.toThrow(/not running/);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/bridge.test.ts test/unit/daemon-session-control.test.ts`
Expected: FAIL — `controlFrame` rejects `context_usage`; `s.getContextUsage` is not a function.

- [ ] **Step 4: Extend `ControllableSession` and `controlFrame`** — in `src/bridge/types.ts`:

Add to the `ControllableSession` interface (after the `interrupt?(): Promise<void>;` line):

```ts
  getContextUsage?(): Promise<unknown>;
  accountInfo?(): Promise<unknown>;
```

Add to the `controlFrame` discriminated union (after the `z.object({ type: z.literal("interrupt") }),` line):

```ts
  z.object({ type: z.literal("context_usage") }),
  z.object({ type: z.literal("account_info") }),
```

- [ ] **Step 5: Add the `ControlBridge` cases + payload helper** — in `src/bridge/control.ts`:

Add two cases to the `switch (frame.type)` in `apply` (after the `case "interrupt":` block):

```ts
      case "context_usage":
        return ControlBridge.payload(session.getContextUsage, "getContextUsage", session, "usage");
      case "account_info":
        return ControlBridge.payload(session.accountInfo, "accountInfo", session, "account");
```

Add this static helper to the `ControlBridge` class (after the existing private `call` method):

```ts
  // Like call(), but the method returns a value surfaced under `key` (mirrors the initialize payload).
  private static async payload(
    method: (() => Promise<unknown>) | undefined,
    name: string,
    self: ControllableSession,
    key: string,
  ): Promise<ControlResponse> {
    if (typeof method !== "function") return { ok: false, error: `unsupported: ${name}` };
    try { return { ok: true, [key]: await method.apply(self) }; }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: message };
    }
  }
```

- [ ] **Step 6: Add the `DaemonSession` methods** — in `src/daemon/session.ts`:

Add a value-returning Query delegate alongside the existing `callQ` (after the `callQ` method):

```ts
  private callQValue(name: string): Promise<unknown> {
    const fn = (this.q as any)[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`unsupported: ${name}`));
    return fn.apply(this.q);
  }
```

Add the two control methods (after the existing `capabilities()` method):

```ts
  async getContextUsage(): Promise<unknown> { this.assertRunning(); return this.callQValue("getContextUsage"); }
  async accountInfo(): Promise<unknown> { this.assertRunning(); return this.callQValue("accountInfo"); }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/bridge.test.ts test/unit/daemon-session-control.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add CC-to-SDK/harness/src/bridge/types.ts CC-to-SDK/harness/src/bridge/control.ts CC-to-SDK/harness/src/daemon/session.ts CC-to-SDK/harness/test/unit/bridge.test.ts CC-to-SDK/harness/test/unit/daemon-session-control.test.ts
git commit -m "feat(harness): context_usage/account_info control frames + DaemonSession delegates"
```

---

### Task 4: Daemon persisted-store read ops (`sessions` / `messages`)

**Files:**
- Modify: `src/daemon/types.ts` (two ops + union)
- Modify: `src/daemon/supervisor.ts` (DI deps + two methods)
- Modify: `src/daemon/server.ts` (dispatch)
- Test: `test/unit/daemon-types.test.ts`, `test/unit/daemon-supervisor.test.ts`

**Interfaces:**
- Consumes: `listSessions`/`getSessionMessages` from `src/sessions/reader.js` (Task 1); the existing `DaemonDeps`, `DaemonSupervisor`, `daemonOp` discriminated union, server `handle` switch.
- Produces: ops `{ op: "sessions", cwd?, limit?, offset? }` and `{ op: "messages", id, cwd?, limit?, offset? }`; `DaemonSupervisor.listPersistedSessions(opts)` and `getPersistedMessages(id, opts)` (delegating to the reader, distinct from `list`).

- [ ] **Step 1: Write the failing op-schema test** — in `test/unit/daemon-types.test.ts`, append inside the `describe("daemon protocol", …)` block (before its closing `});`):

```ts
  it("sessions and messages ops parse with optional scope/pagination", () => {
    expect(daemonOp.parse({ op: "sessions" }).op).toBe("sessions");
    expect(daemonOp.parse({ op: "sessions", cwd: "/p", limit: 10, offset: 5 }).op).toBe("sessions");
    const m = daemonOp.parse({ op: "messages", id: "sess-1", cwd: "/p" });
    if (m.op === "messages") expect(m.id).toBe("sess-1");
    expect(() => daemonOp.parse({ op: "messages" })).toThrow(); // id required
  });
```

- [ ] **Step 2: Write the failing supervisor test** — in `test/unit/daemon-supervisor.test.ts`, append inside the `describe("DaemonSupervisor", …)` block (before its closing `});`):

```ts
  it("listPersistedSessions / getPersistedMessages delegate to the injected reader", async () => {
    const calls: any[] = [];
    const sup = new DaemonSupervisor({
      query: fakeQuery,
      listSessions: async (o: any) => { calls.push(["list", o]); return [{ sessionId: "s1" }]; },
      getSessionMessages: async (id: string, o: any) => { calls.push(["msgs", id, o]); return [{ uuid: "u1" }]; },
    }, { dir: dir() });
    expect(await sup.listPersistedSessions({ cwd: "/p", limit: 3 })).toEqual([{ sessionId: "s1" }]);
    expect(await sup.getPersistedMessages("sess-9", { cwd: "/p" })).toEqual([{ uuid: "u1" }]);
    expect(calls).toEqual([["list", { cwd: "/p", limit: 3 }], ["msgs", "sess-9", { cwd: "/p" }]]);
    await sup.shutdown();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `daemonOp` rejects `sessions`; `sup.listPersistedSessions` is not a function.

- [ ] **Step 4: Add the ops** — in `src/daemon/types.ts`, add two op schemas after the `stopProactiveOp` line:

```ts
const sessionsOp = z.object({ op: z.literal("sessions"), cwd: z.string().optional(), limit: z.number().optional(), offset: z.number().optional() });
const messagesOp = z.object({ op: z.literal("messages"), id: z.string(), cwd: z.string().optional(), limit: z.number().optional(), offset: z.number().optional() });
```

Then add them to the union (replace the existing `daemonOp` line):

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp]);
```

- [ ] **Step 5: Add the supervisor DI deps + methods** — in `src/daemon/supervisor.ts`:

Add the reader import (with the other imports near the top):

```ts
import { listSessions, getSessionMessages } from "../sessions/reader.js";
```

Extend the `DaemonDeps` interface:

```ts
export interface DaemonDeps { query: QueryFn; listSessions?: typeof listSessions; getSessionMessages?: typeof getSessionMessages; }
```

Add two public methods to the `DaemonSupervisor` class (next to `list()`):

```ts
  // Persisted on-disk transcripts (SDKSessionInfo / SessionMessage) — DISTINCT from list() (live registry).
  listPersistedSessions(opts: { cwd?: string; limit?: number; offset?: number } = {}): Promise<unknown[]> {
    return (this.deps.listSessions ?? listSessions)(opts);
  }
  getPersistedMessages(id: string, opts: { cwd?: string; limit?: number; offset?: number } = {}): Promise<unknown[]> {
    return (this.deps.getSessionMessages ?? getSessionMessages)(id, opts);
  }
```

- [ ] **Step 6: Dispatch the ops in the server** — in `src/daemon/server.ts`, add two cases to the `switch (op.op)` in `handle` (after the `case "list":` line):

```ts
        case "sessions": send({ ok: true, sessions: await this.supervisor.listPersistedSessions({ cwd: op.cwd, limit: op.limit, offset: op.offset }) }); sock.end(); break;
        case "messages": send({ ok: true, messages: await this.supervisor.getPersistedMessages(op.id, { cwd: op.cwd, limit: op.limit, offset: op.offset }) }); sock.end(); break;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/daemon-types.test.ts test/unit/daemon-supervisor.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/src/daemon/server.ts CC-to-SDK/harness/test/unit/daemon-types.test.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): daemon sessions/messages read ops (persisted store, distinct from live list)"
```

---

### Task 5: Live observability round-trip test

**Files:**
- Create: `test/live/observability.test.ts`

**Interfaces:**
- Consumes: `createHarness` + `listSessions` from `src/index.js` (Tasks 1–2); `Harness.getContextUsage()`; `RunResult.sessionId`.
- Produces: nothing (verification only).

- [ ] **Step 1: Write the live test** — create `test/live/observability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, listSessions } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live observability read API (real SDK)", () => {
  it("getContextUsage() reports tokens; listSessions({cwd}) finds the session scoped to its dir", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-observe-live-"));
    try {
      const h = createHarness({ model: MODEL, permissionMode: "auto", cwd });
      let usage: any;
      let sessionId: string | undefined;
      for await (const m of h.stream("Reply OK and nothing else.")) {
        const mm = m as any;
        if (mm.type === "system" && mm.subtype === "init") {
          sessionId = mm.session_id;
          usage = await h.getContextUsage(); // requires the active query (still streaming)
        }
      }
      expect(typeof usage?.totalTokens).toBe("number");
      expect(sessionId).toBeTruthy();
      // listSessions scoped to the project dir (cwd→dir) finds the just-created session.
      const sessions = await listSessions({ cwd });
      expect(sessions.some((s) => s.sessionId === sessionId)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run the live test (requires `ANTHROPIC_API_KEY`)**

Run: `set -a; . /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/.env; set +a; npx vitest run test/live/observability.test.ts`
Expected: PASS when `ANTHROPIC_API_KEY` is set (`getContextUsage()` returns a numeric `totalTokens`; `listSessions({cwd})` finds the session); SKIPPED otherwise. Never print or commit the key.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/harness/test/live/observability.test.ts
git commit -m "test(harness): live observability round-trip (getContextUsage + cwd-scoped listSessions)"
```

---

## Final verification (after all tasks)

- [ ] `npm run test:unit` — full unit suite green (existing + new).
- [ ] `npm run typecheck` — clean.
- [ ] `npm run build` — clean (the package compiles with the new public exports).
- [ ] `npx vitest run test/live/observability.test.ts` — green with `ANTHROPIC_API_KEY` set.

# SDK Capability Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the nine live-verified P1–P4 SDK frontier surfaces into first-class harness capability, each on an existing seam.

**Architecture:** Three parts on existing seams, no new architecture. Part A = config fields + `resolveOptions` passthrough. Part B = `usage()`/`initializationResult()`/`applyFlagSettings()` on `Harness`/`Session` (the existing `call()`/`callQValue` delegation pattern) + matching daemon ops. Part C = `renameSession`/`tagSession`/`deleteSession` lib wrappers mirroring `sessions/fork.ts` + daemon ops. Mirrors the hooks ship (typed surface → public re-exports → unit + gated live).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk@0.3.178`, vitest, zod/v4 (daemon op schemas).

## Global Constraints

- **Dense hand-style, NO Prettier.** Match surrounding code; multi-statement lines where the file already does so. ESM import specifiers end in `.js`.
- **DI-by-deps + TDD.** Inject SDK fns via a `deps` default param so unit tests run keyless; failing test → red → minimal impl → green → `npm run typecheck`.
- **`maxBudgetUsd` is pass-through-don't-swallow.** When exceeded the SDK subprocess throws `Error: Claude Code process exited with code 1` with no result frame; do NOT catch, translate, or wrap it (the same string also means credit-exhausted / taskBudget-400). Document the behavior; the live test asserts the throw.
- **`taskBudget` is opus-4-8-only** (sonnet/haiku return a 400 `is_error` result); its live assertion pins `claude-opus-4-8`.
- **`usage()` wraps the deliberately-unstable SDK method name** `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` behind a stable `usage()`.
- **Public re-exports shadow the same-named SDK exports by intent**, exactly as `forkSession` already does.
- Commands run from `CC-to-SDK/harness/`: `npm run typecheck`, `npx vitest run test/unit/<file>`, `npm run build`. Live tests gate on `ANTHROPIC_API_KEY` and skip cleanly keyless.
- Spec: `docs/superpowers/specs/2026-06-18-sdk-capability-closeout-design.md`. Evidence: probes `11`–`15` (commits `3012f69c15`, `5847c68659`).

---

### Task 1: Part A — turn-control config fields + `resolveOptions` passthrough

**Files:**
- Modify: `src/config/types.ts` (add SDK type imports + 6 fields + a `permissionMode` doc note)
- Modify: `src/config/resolveOptions.ts:37` (add 6 passthrough lines after the `maxTurns` line)
- Test: `test/unit/resolveOptions.test.ts`

**Interfaces:**
- Produces: six new `HarnessConfig` fields — `effort?: EffortLevel`, `thinking?: ThinkingConfig`, `maxBudgetUsd?: number`, `taskBudget?: { total: number }`, `includePartialMessages?: boolean`, `forwardSubagentText?: boolean`. `resolveOptions` copies each onto the SDK `Options` (numeric `maxBudgetUsd` guarded `!== undefined`; the rest truthy-guarded so absent → no key). Consumed by `createHarness` + `openSession`/`resumeSession` (both call `resolveOptions`) and by the Task 6 live test.

- [ ] **Step 1: Write the failing tests** — append inside the `describe("resolveOptions", …)` block in `test/unit/resolveOptions.test.ts`:

```ts
  it("threads the turn-control fields through, omits them when absent", () => {
    const o: any = resolveOptions({
      effort: "high",
      thinking: { type: "enabled", budgetTokens: 1024 },
      maxBudgetUsd: 0.5,
      taskBudget: { total: 60000 },
      includePartialMessages: true,
      forwardSubagentText: true,
    });
    expect(o.effort).toBe("high");
    expect(o.thinking).toEqual({ type: "enabled", budgetTokens: 1024 });
    expect(o.maxBudgetUsd).toBe(0.5);
    expect(o.taskBudget).toEqual({ total: 60000 });
    expect(o.includePartialMessages).toBe(true);
    expect(o.forwardSubagentText).toBe(true);
    const bare: any = resolveOptions({});
    for (const k of ["effort", "thinking", "maxBudgetUsd", "taskBudget", "includePartialMessages", "forwardSubagentText"])
      expect(bare).not.toHaveProperty(k);
  });
  it("emits maxBudgetUsd:0 (guards on !== undefined, not truthiness)", () => {
    expect((resolveOptions({ maxBudgetUsd: 0 }) as any).maxBudgetUsd).toBe(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/resolveOptions.test.ts`
Expected: FAIL — the new fields are not on `HarnessConfig` (tsc error) / not copied (assertions fail).

- [ ] **Step 3: Add the config fields** — in `src/config/types.ts`, extend the SDK import on line 1 to add `EffortLevel, ThinkingConfig`:

```ts
import type { AgentDefinition, McpServerConfig, PermissionMode, SdkPluginConfig, SessionStore, EffortLevel, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk";
```

Replace the existing `permissionMode?: PermissionMode;` line with a documented version:

```ts
  // permissionMode: 6 SDK modes. acceptEdits auto-accepts edits but still routes non-edit tools to
  // canUseTool; dontAsk replaces canUseTool entirely (joins auto/bypass as broker-replacing) — verified.
  permissionMode?: PermissionMode;
```

Add the six fields immediately after the existing `maxTurns?: number;` line:

```ts
  // turn controls (verified live 2026-06-18; specs/2026-06-18-sdk-capability-closeout-design.md)
  effort?: EffortLevel;                    // 'low'|'medium'|'high'|'xhigh'|'max' — reasoning effort
  thinking?: ThinkingConfig;               // {type:'adaptive'|'disabled'} | {type:'enabled',budgetTokens}
  maxBudgetUsd?: number;                   // hard USD ceiling; EXCEEDED → the query THROWS (no graceful result)
  taskBudget?: { total: number };          // token-pacing hint; opus-4-8-only (sonnet/haiku return 400)
  includePartialMessages?: boolean;        // emit SDKPartialAssistantMessage stream_event frames
  forwardSubagentText?: boolean;           // forward nested subagent text/thinking (parent_tool_use_id set)
```

- [ ] **Step 4: Add the passthrough** — in `src/config/resolveOptions.ts`, immediately after `if (config.maxTurns !== undefined) options.maxTurns = config.maxTurns;`:

```ts
  if (config.effort) options.effort = config.effort;
  if (config.thinking) options.thinking = config.thinking;
  if (config.maxBudgetUsd !== undefined) options.maxBudgetUsd = config.maxBudgetUsd;
  if (config.taskBudget) options.taskBudget = config.taskBudget;
  if (config.includePartialMessages) options.includePartialMessages = config.includePartialMessages;
  if (config.forwardSubagentText) options.forwardSubagentText = config.forwardSubagentText;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/unit/resolveOptions.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/resolveOptions.ts test/unit/resolveOptions.test.ts
git commit -m "feat(harness): turn-control config (effort/thinking/budget/partial-stream) via resolveOptions passthrough"
```

---

### Task 2: Part B (lib) — `usage()` / `initializationResult()` / `applyFlagSettings()` on Harness + Session

**Files:**
- Modify: `src/harness.ts` (interface + return object)
- Modify: `src/session/session.ts` (3 methods after `accountInfo`, line 111)
- Test: `test/unit/harness.test.ts`, `test/unit/session.test.ts`

**Interfaces:**
- Produces: `Harness.usage(): Promise<unknown>`, `Harness.initializationResult(): Promise<unknown>` (delegate to the active query via the existing `call()` helper, throwing `… start a query first` before one starts). `Session.usage(): Promise<unknown>`, `Session.initializationResult(): Promise<unknown>`, `Session.applyFlagSettings(settings: Record<string, unknown>): Promise<void>` (via `callQValue`/`callQ`, gated by `assertRunning`). `DaemonSession` inherits all three (it `extends Session`). Consumed by Task 3 (daemon ops) and Task 6 (live).

- [ ] **Step 1: Write the failing Harness test** — in `test/unit/harness.test.ts`, extend `fakeQuery` by adding these two lines just before `return q;`:

```ts
  q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({ session: { total_cost_usd: 1 } });
  q.initializationResult = async () => ({ models: ["m"], account: { apiProvider: "anthropic" } });
```

Then append inside `describe("createHarness", …)`:

```ts
  it("usage()/initializationResult() delegate to the active query", async () => {
    const h = createHarness({}, { query: fakeQuery });
    const it = h.stream("ping"); await it.next(); // start a query
    expect(await h.usage()).toEqual({ session: { total_cost_usd: 1 } });
    expect(await h.initializationResult()).toEqual({ models: ["m"], account: { apiProvider: "anthropic" } });
  });
  it("usage() throws before a query starts", async () => {
    const h = createHarness({}, { query: fakeQuery });
    await expect(h.usage()).rejects.toThrow(/start a query first/);
  });
```

- [ ] **Step 2: Write the failing Session test** — in `test/unit/session.test.ts`, add this fake-query factory after the existing `initQuery` definition (before `describe("Session", …)`):

```ts
// returns a generator-object carrying the introspection control methods
function methodQuery(rec: any) {
  return ({ prompt }: any) => {
    const it: any = (async function* () { for await (const t of prompt) yield { type: "result", subtype: "success", result: "did:" + t.message.content }; })();
    it.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({ session: { total_cost_usd: 2 } });
    it.initializationResult = async () => ({ models: ["m"], account: {} });
    it.applyFlagSettings = async (s: any) => { rec.applied = s; };
    return it;
  };
}
```

Then append inside `describe("Session", …)`:

```ts
  it("usage()/initializationResult() delegate; applyFlagSettings forwards its arg", async () => {
    const rec: any = {};
    const s = new Session({ query: methodQuery(rec) }, {});
    expect(await s.usage()).toEqual({ session: { total_cost_usd: 2 } });
    expect(await s.initializationResult()).toEqual({ models: ["m"], account: {} });
    await s.applyFlagSettings({ outputStyle: "explanatory" });
    expect(rec.applied).toEqual({ outputStyle: "explanatory" });
    await s.dispose();
  });
  it("usage() rejects once the session has ended", async () => {
    const s = new Session({ query: methodQuery({}) }, {}, { label: "lib-sess" });
    await s.dispose();
    await expect(s.usage()).rejects.toThrow(/lib-sess is not running/);
  });
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx vitest run test/unit/harness.test.ts test/unit/session.test.ts`
Expected: FAIL — `usage`/`initializationResult`/`applyFlagSettings` are not defined on `Harness`/`Session`.

- [ ] **Step 4: Implement on Harness** — in `src/harness.ts`, add to the `Harness` interface after `accountInfo(): Promise<unknown>;`:

```ts
  usage(): Promise<unknown>;
  initializationResult(): Promise<unknown>;
```

And in the returned object literal, after `accountInfo: call("accountInfo"),`:

```ts
    usage: call("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"),
    initializationResult: call("initializationResult"),
```

- [ ] **Step 5: Implement on Session** — in `src/session/session.ts`, after the `accountInfo()` method (line 111):

```ts
  // Experimental SDK method name (it warns it will change); the wrapper insulates callers behind usage().
  async usage(): Promise<unknown> { this.assertRunning(); return this.callQValue("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"); }
  async initializationResult(): Promise<unknown> { this.assertRunning(); return this.callQValue("initializationResult"); }
  async applyFlagSettings(settings: Record<string, unknown>): Promise<void> { this.assertRunning(); await this.callQ("applyFlagSettings", settings); }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/unit/harness.test.ts test/unit/session.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/harness.ts src/session/session.ts test/unit/harness.test.ts test/unit/session.test.ts
git commit -m "feat(harness): usage()/initializationResult() on Harness+Session, applyFlagSettings() on Session"
```

---

### Task 3: Part B (daemon) — `usage` / `init` / `apply_flag_settings` ops

**Files:**
- Modify: `src/daemon/types.ts` (3 zod ops + union)
- Modify: `src/daemon/supervisor.ts` (3 methods after `compact`, line 142)
- Modify: `src/daemon/server.ts` (3 `case`s after the `fork` case, line 77)
- Test: `test/unit/daemon-server.test.ts`

**Interfaces:**
- Consumes: `Session.usage()`/`initializationResult()`/`applyFlagSettings()` from Task 2 (inherited by `DaemonSession`).
- Produces: daemon ops `{op:"usage",id}` → `{ok:true,usage}`, `{op:"init",id}` → `{ok:true,init}`, `{op:"apply_flag_settings",id,settings}` → `{ok:true}`. Supervisor methods `usage(id)`, `initializationResult(id)`, `applyFlagSettings(id,settings)` (look up the live pool session, mirror `compact(id)`).

- [ ] **Step 1: Write the failing test** — append inside `describe("DaemonServer over a real UDS", …)` in `test/unit/daemon-server.test.ts`:

```ts
  it("usage/init/apply_flag_settings ops delegate to the live session", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const methodFakeQuery = ({ prompt }: any) => {
      const it: any = (async function* () { for await (const t of prompt) { yield { type: "system", subtype: "init", session_id: "sdk-1" }; yield { type: "result", result: "did:" + t.message.content }; } })();
      it.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = async () => ({ session: { total_cost_usd: 3 } });
      it.initializationResult = async () => ({ models: ["x"] });
      it.applyFlagSettings = async () => {};
      return it;
    };
    const sup = new DaemonSupervisor({ query: methodFakeQuery }, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    const id = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    await daemonRequest(sock, { op: "submit", id, prompt: "hi" }, () => {}); // open transport
    expect((await daemonRequest(sock, { op: "usage", id }))[0]).toEqual({ ok: true, usage: { session: { total_cost_usd: 3 } } });
    expect((await daemonRequest(sock, { op: "init", id }))[0]).toEqual({ ok: true, init: { models: ["x"] } });
    expect((await daemonRequest(sock, { op: "apply_flag_settings", id, settings: { a: 1 } }))[0]).toEqual({ ok: true });
    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/daemon-server.test.ts`
Expected: FAIL — `daemonOp.parse` rejects the unknown `usage`/`init`/`apply_flag_settings` ops (`bad request`).

- [ ] **Step 3: Add the op schemas** — in `src/daemon/types.ts`, after `const forkOp = …;` (line 50):

```ts
const usageOp = z.object({ op: z.literal("usage"), id: z.string() });
const initOp = z.object({ op: z.literal("init"), id: z.string() });
const applyFlagSettingsOp = z.object({ op: z.literal("apply_flag_settings"), id: z.string(), settings: z.record(z.string(), z.unknown()) });
```

Extend the union to include them:

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp, forkOp, usageOp, initOp, applyFlagSettingsOp]);
```

- [ ] **Step 4: Add the supervisor methods** — in `src/daemon/supervisor.ts`, after the `compact(id)` method (ends line 142):

```ts
  async usage(id: string): Promise<unknown> {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) { const rec = this.registry.get(id); throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`); }
    return session.usage();
  }
  async initializationResult(id: string): Promise<unknown> {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) { const rec = this.registry.get(id); throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`); }
    return session.initializationResult();
  }
  async applyFlagSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    const session = this.pool.get(id);
    if (!session || session.isEnded()) { const rec = this.registry.get(id); throw new DaemonError(rec ? `session ${id} is ${rec.status}` : `unknown session ${id}`); }
    await session.applyFlagSettings(settings);
  }
```

(The lookup-or-throw block is repeated verbatim from `compact`/`fork`/`control` — match the established per-op style; do not refactor it into a helper in this task.)

- [ ] **Step 5: Add the server cases** — in `src/daemon/server.ts`, after the `case "fork": …` line (line 77):

```ts
        case "usage": send({ ok: true, usage: await this.supervisor.usage(op.id) }); sock.end(); break;
        case "init": send({ ok: true, init: await this.supervisor.initializationResult(op.id) }); sock.end(); break;
        case "apply_flag_settings": await this.supervisor.applyFlagSettings(op.id, op.settings); send({ ok: true }); sock.end(); break;
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/unit/daemon-server.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts src/daemon/server.ts test/unit/daemon-server.test.ts
git commit -m "feat(daemon): usage/init/apply_flag_settings ops over the live session"
```

---

### Task 4: Part C (lib) — `renameSession` / `tagSession` / `deleteSession` wrappers + public re-exports

**Files:**
- Create: `src/sessions/mutate.ts`
- Modify: `src/sessions/index.ts` (re-export)
- Modify: `src/index.ts:16-17` (re-export + type)
- Test: `test/unit/sessions-mutate.test.ts` (new), `test/unit/index.test.ts`

**Interfaces:**
- Produces: `renameSession(id: string, title: string, opts?: MutateSessionOpts, deps?): Promise<void>`, `tagSession(id: string, tag: string | null, opts?: MutateSessionOpts, deps?): Promise<void>`, `deleteSession(id: string, opts?: MutateSessionOpts, deps?): Promise<void>` — thin `cwd→dir` wrappers over the SDK store fns (mirror `sessions/fork.ts`). `interface MutateSessionOpts { cwd?: string; sessionStore?: SessionStore }`. Re-exported from `src/index.ts`. Consumed by Task 5 (daemon ops) and Task 6 (live).

- [ ] **Step 1: Write the failing wrapper test** — create `test/unit/sessions-mutate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renameSession, tagSession, deleteSession } from "../../src/sessions/mutate.js";

describe("session-store mutation wrappers (cwd→dir glue)", () => {
  it("renameSession maps cwd→dir and passes id + title through", async () => {
    const calls: any[] = [];
    const deps = { renameSession: async (id: string, title: string, o: any) => { calls.push([id, title, o]); } };
    await renameSession("s1", "New Title", { cwd: "/proj" }, deps as any);
    expect(calls[0]).toEqual(["s1", "New Title", { dir: "/proj" }]);
    expect(calls[0][2]).not.toHaveProperty("cwd");
  });
  it("tagSession passes a null tag through and omits dir without cwd", async () => {
    const calls: any[] = [];
    const deps = { tagSession: async (id: string, tag: string | null, o: any) => { calls.push([id, tag, o]); } };
    await tagSession("s1", null, {}, deps as any);
    expect(calls[0]).toEqual(["s1", null, {}]);
    expect(calls[0][2]).not.toHaveProperty("dir");
  });
  it("deleteSession maps cwd→dir and passes the id", async () => {
    const calls: any[] = [];
    const deps = { deleteSession: async (id: string, o: any) => { calls.push([id, o]); } };
    await deleteSession("s1", { cwd: "/proj" }, deps as any);
    expect(calls[0]).toEqual(["s1", { dir: "/proj" }]);
  });
});
```

- [ ] **Step 2: Add the index pin** — append inside `describe("public API", …)` in `test/unit/index.test.ts`:

```ts
  it("exports the session-store mutation wrappers", () => {
    expect(typeof api.renameSession).toBe("function");
    expect(typeof api.tagSession).toBe("function");
    expect(typeof api.deleteSession).toBe("function");
  });
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx vitest run test/unit/sessions-mutate.test.ts test/unit/index.test.ts`
Expected: FAIL — `src/sessions/mutate.js` does not exist / `api.renameSession` is undefined.

- [ ] **Step 4: Create the wrappers** — `src/sessions/mutate.ts`:

```ts
import { renameSession as sdkRenameSession, tagSession as sdkTagSession, deleteSession as sdkDeleteSession } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStore } from "@anthropic-ai/claude-agent-sdk";

// Harness convention is `cwd`; the SDK mutation fns filter by `dir`. These wrappers do that rename +
// passthrough (plus DI `deps`), mirroring sessions/fork.ts + reader.ts. They mutate the PERSISTED
// transcript store (~/.claude/projects), not a live session. renameSession sets the displayed title
// (a `customTitle` field). deleteSession is DESTRUCTIVE and irreversible — afterward the id is gone
// from listSessions and getSessionMessages returns [].
export interface MutateSessionOpts { cwd?: string; sessionStore?: SessionStore; }

export function renameSession(id: string, title: string, opts: MutateSessionOpts = {}, deps = { renameSession: sdkRenameSession }): Promise<void> {
  const { cwd, ...rest } = opts;
  return deps.renameSession(id, title, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
export function tagSession(id: string, tag: string | null, opts: MutateSessionOpts = {}, deps = { tagSession: sdkTagSession }): Promise<void> {
  const { cwd, ...rest } = opts;
  return deps.tagSession(id, tag, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
export function deleteSession(id: string, opts: MutateSessionOpts = {}, deps = { deleteSession: sdkDeleteSession }): Promise<void> {
  const { cwd, ...rest } = opts;
  return deps.deleteSession(id, { ...rest, ...(cwd ? { dir: cwd } : {}) });
}
```

- [ ] **Step 5: Re-export** — in `src/sessions/index.ts`, append:

```ts
export { renameSession, tagSession, deleteSession } from "./mutate.js";
export type { MutateSessionOpts } from "./mutate.js";
```

In `src/index.ts`, replace lines 16–17 with:

```ts
export { listSessions, getSessionMessages, getSessionInfo, forkSession, renameSession, tagSession, deleteSession } from "./sessions/index.js";
export type { ListSessionsOpts, GetMessagesOpts, GetInfoOpts, ForkSessionOpts, MutateSessionOpts } from "./sessions/index.js";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/unit/sessions-mutate.test.ts test/unit/index.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/sessions/mutate.ts src/sessions/index.ts src/index.ts test/unit/sessions-mutate.test.ts test/unit/index.test.ts
git commit -m "feat(harness): renameSession/tagSession/deleteSession store wrappers + public re-exports"
```

---

### Task 5: Part C (daemon) — `rename` / `tag` / `delete` ops

**Files:**
- Modify: `src/daemon/supervisor.ts` (`DaemonDeps` fields + import + 3 methods after `getPersistedMessages`, line 124)
- Modify: `src/daemon/types.ts` (3 zod ops + union)
- Modify: `src/daemon/server.ts` (3 `case`s)
- Test: `test/unit/daemon-server.test.ts`

**Interfaces:**
- Consumes: `renameSession`/`tagSession`/`deleteSession` from Task 4.
- Produces: daemon ops `{op:"rename",id,title,cwd?}`, `{op:"tag",id,tag,cwd?}`, `{op:"delete",id,cwd?}` → `{ok:true}`. Supervisor methods `renamePersisted`/`tagPersisted`/`deletePersisted` (operate on the persisted store via injected/real fns, mirror `listPersistedSessions`). `DaemonDeps` gains optional `renameSession`/`tagSession`/`deleteSession` for testability.

- [ ] **Step 1: Write the failing test** — append inside `describe("DaemonServer over a real UDS", …)` in `test/unit/daemon-server.test.ts`:

```ts
  it("rename/tag/delete ops delegate to the persisted-store wrappers", async () => {
    const d = tmp(); const sock = join(d, "sock");
    const calls: any[] = [];
    const sup = new DaemonSupervisor({
      query: fakeQuery,
      renameSession: async (id: string, title: string) => { calls.push(["rename", id, title]); },
      tagSession: async (id: string, tag: string | null) => { calls.push(["tag", id, tag]); },
      deleteSession: async (id: string) => { calls.push(["delete", id]); },
    } as any, { dir: join(d, "sessions") });
    const server = new DaemonServer(sup, sock);
    await server.listen();
    expect((await daemonRequest(sock, { op: "rename", id: "sdk-1", title: "T" }))[0]).toEqual({ ok: true });
    expect((await daemonRequest(sock, { op: "tag", id: "sdk-1", tag: "blue" }))[0]).toEqual({ ok: true });
    expect((await daemonRequest(sock, { op: "delete", id: "sdk-1" }))[0]).toEqual({ ok: true });
    expect(calls).toEqual([["rename", "sdk-1", "T"], ["tag", "sdk-1", "blue"], ["delete", "sdk-1"]]);
    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/daemon-server.test.ts`
Expected: FAIL — `daemonOp.parse` rejects the unknown `rename`/`tag`/`delete` ops.

- [ ] **Step 3: Add the op schemas** — in `src/daemon/types.ts`, after the `applyFlagSettingsOp` added in Task 3:

```ts
const renameSessionOp = z.object({ op: z.literal("rename"), id: z.string(), title: z.string(), cwd: z.string().optional() });
const tagSessionOp = z.object({ op: z.literal("tag"), id: z.string(), tag: z.string().nullable(), cwd: z.string().optional() });
const deleteSessionOp = z.object({ op: z.literal("delete"), id: z.string(), cwd: z.string().optional() });
```

Extend the union (append the three new entries):

```ts
export const daemonOp = z.discriminatedUnion("op", [spawnOp, submitOp, listOp, stopOp, shutdownOp, controlOp, startProactiveOp, stopProactiveOp, sessionsOp, messagesOp, compactOp, forkOp, usageOp, initOp, applyFlagSettingsOp, renameSessionOp, tagSessionOp, deleteSessionOp]);
```

- [ ] **Step 4: Wire the supervisor** — in `src/daemon/supervisor.ts`, add to the `import { forkSession } …` area a new import:

```ts
import { renameSession, tagSession, deleteSession } from "../sessions/mutate.js";
```

Extend `DaemonDeps` with three optional fields (after the existing `forkSession?` field):

```ts
  renameSession?: (id: string, title: string, opts?: { cwd?: string }) => Promise<void>;
  tagSession?: (id: string, tag: string | null, opts?: { cwd?: string }) => Promise<void>;
  deleteSession?: (id: string, opts?: { cwd?: string }) => Promise<void>;
```

Add the methods after `getPersistedMessages(…)` (line 124), mirroring its `deps ?? real` shape:

```ts
  renamePersisted(id: string, title: string, opts: { cwd?: string } = {}): Promise<void> {
    return (this.deps.renameSession ?? renameSession)(id, title, opts);
  }
  tagPersisted(id: string, tag: string | null, opts: { cwd?: string } = {}): Promise<void> {
    return (this.deps.tagSession ?? tagSession)(id, tag, opts);
  }
  deletePersisted(id: string, opts: { cwd?: string } = {}): Promise<void> {
    return (this.deps.deleteSession ?? deleteSession)(id, opts);
  }
```

- [ ] **Step 5: Add the server cases** — in `src/daemon/server.ts`, after the `case "apply_flag_settings": …` line added in Task 3:

```ts
        case "rename": await this.supervisor.renamePersisted(op.id, op.title, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
        case "tag": await this.supervisor.tagPersisted(op.id, op.tag, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
        case "delete": await this.supervisor.deletePersisted(op.id, { cwd: op.cwd }); send({ ok: true }); sock.end(); break;
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/unit/daemon-server.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/types.ts src/daemon/supervisor.ts src/daemon/server.ts test/unit/daemon-server.test.ts
git commit -m "feat(daemon): rename/tag/delete persisted-session ops"
```

---

### Task 6: Gated live e2e — turn controls, introspection, session mutation

**Files:**
- Create: `test/live/sdk-closeout.test.ts`

**Interfaces:**
- Consumes: `openSession` (Task 1 config fields + Task 2 Session methods), `listSessions`/`getSessionMessages` (existing), `renameSession`/`tagSession`/`deleteSession` (Task 4). No new production code — this task only adds the gated live suite.

- [ ] **Step 1: Write the live test** — create `test/live/sdk-closeout.test.ts`:

```ts
// test/live/sdk-closeout.test.ts
import { describe, it, expect } from "vitest";
import { openSession, listSessions, getSessionMessages, renameSession, tagSession, deleteSession } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-4-8";

live("SDK capability closeout (real SDK)", () => {
  // Part A — turn controls
  it("effort + thinking are accepted and complete a turn", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions", effort: "low", thinking: { type: "enabled", budgetTokens: 1024 } });
    try { expect(String((await s.submit("Reply with the single word OK.")).result).length).toBeGreaterThan(0); }
    finally { await s.dispose(); }
  }, 60_000);

  it("maxBudgetUsd, when exceeded, throws (pass-through, no graceful result)", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions", maxBudgetUsd: 0.0001 });
    try { await expect(s.submit("Run three bash commands one at a time: echo a; echo b; echo c, then summarize.")).rejects.toThrow(); }
    finally { await s.dispose(); }
  }, 60_000);

  it("taskBudget is accepted on opus-4-8", async () => {
    const s = openSession({ model: OPUS, permissionMode: "bypassPermissions", taskBudget: { total: 60000 } });
    try { expect(String((await s.submit("Reply with the single word OK.")).result)).toMatch(/OK/i); }
    finally { await s.dispose(); }
  }, 90_000);

  it("includePartialMessages yields stream_event frames", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions", includePartialMessages: true });
    try {
      const types: string[] = [];
      for await (const m of s.stream("In one short sentence, say hello.")) types.push((m as any).type);
      expect(types).toContain("stream_event");
    } finally { await s.dispose(); }
  }, 60_000);

  // Part B — introspection methods
  it("usage()/initializationResult() return structured data; applyFlagSettings resolves", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions" });
    try {
      await s.submit("Reply OK."); // open the transport
      expect((await s.usage() as any)?.session).toBeTruthy();
      expect((await s.initializationResult() as any)?.models).toBeTruthy();
      await s.applyFlagSettings({});
    } finally { await s.dispose(); }
  }, 60_000);

  // Part C — session-store mutation
  it("tag → rename → delete round-trips on the default store", async () => {
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions" });
    let sid: string | undefined;
    try { await s.submit("Reply OK."); sid = s.sessionId; } finally { await s.dispose(); }
    expect(sid).toBeTruthy();
    await tagSession(sid!, "closeout-test");
    await renameSession(sid!, "Closeout Renamed");
    const listed = (await listSessions()).find((x: any) => x.sessionId === sid);
    expect(JSON.stringify(listed)).toContain("Closeout Renamed");
    await deleteSession(sid!);
    expect((await listSessions()).find((x: any) => x.sessionId === sid)).toBeUndefined();
    expect(await getSessionMessages(sid!)).toEqual([]);
  }, 90_000);
});
```

- [ ] **Step 2: Run keyless to verify it skips cleanly**

Run: `npx vitest run test/live/sdk-closeout.test.ts`
Expected: the suite is SKIPPED (no `ANTHROPIC_API_KEY`); 0 failures. (The controller runs the keyed pass separately — see Step 3.)

- [ ] **Step 3: Controller-only keyed run**

Run: `set -a; . ../.env; set +a; npx vitest run test/live/sdk-closeout.test.ts`
Expected: 6/6 PASS — effort/thinking complete; tiny `maxBudgetUsd` throws; `taskBudget`@opus completes; `stream_event` frames seen; `usage`/`init`/`applyFlagSettings` work; tag→rename→delete round-trips.

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add test/live/sdk-closeout.test.ts
git commit -m "test(harness): gated live e2e for SDK capability closeout (A/B/C)"
```

---

## Self-Review

**1. Spec coverage:**
- §4.A (turn controls) → Task 1 (all six fields + passthrough; `permissionMode` doc note covers the `acceptEdits`/`dontAsk` documentation requirement). ✓
- §4.B (introspection methods) → Task 2 (lib Harness+Session) + Task 3 (daemon ops, incl. `apply_flag_settings`). ✓ `includePartialMessages` surfacing needs no engine change (readLoop already routes non-result frames) → covered by Task 1 config + Task 6 live assertion. ✓
- §4.C (session mutation) → Task 4 (wrappers + re-exports) + Task 5 (daemon ops). `acceptEdits`/`dontAsk` documented in Task 1's `permissionMode` comment; exercised by Task 6's `bypassPermissions` runs (no dedicated mode-toggle live test — the verified semantics live in §2/the doc comment, and a behavior test would duplicate probe 15 without adding harness coverage). ✓
- §6 error handling → Task 1 field docs (budget throw, taskBudget gating), Task 4 wrapper docs (delete destructive), Task 6 live assertions (throw + opus pin). ✓
- §7 testing → unit in Tasks 1–5, gated live in Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows full assertions; commands have expected output. ✓

**3. Type consistency:** `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` is spelled identically in Tasks 2 (Harness `call` + Session `callQValue`) and 3 (fake query). `MutateSessionOpts` defined in Task 4, consumed in Task 4 re-exports. Op names (`usage`/`init`/`apply_flag_settings`/`rename`/`tag`/`delete`) match between `types.ts` schemas, `server.ts` cases, and the tests. Supervisor method names (`usage`/`initializationResult`/`applyFlagSettings`/`renamePersisted`/`tagPersisted`/`deletePersisted`) match their `server.ts` callers. ✓

**Note for the executor:** Tasks are linear — T3 depends on T2 (Session methods), T5 depends on T4 (mutate wrappers) and on T3 (shared `daemonOp` union edit — apply T3's union line before T5's). Execute in order 1→6.

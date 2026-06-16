# Daemon D3 — Shared In-Process Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sessions hosted by one `DaemonSupervisor` collaborate through a shared `cc-tasks` task store, via a per-session options-factory seam.

**Architecture:** Add a `sessionOptions?: (sessionId) => Record<string, unknown>` factory to `DaemonOptions`, merged over each session's base `{ model? }` options inside the single `makeSession` construction point (so spawn *and* restart get it). A built-in `sharedTasks?` convenience creates one shared `TaskStore` (public `supervisor.tasks`) and a default factory that hands every session a **fresh** `cc-tasks` MCP server over that one store, with native task tools disabled and the four `mcp__cc-tasks__*` tools allowlisted. Two live spikes forced this shape: a shared server instance breaks under concurrency (→ fresh-per-session over shared state), and injecting `mcpServers` alone is insufficient (native `TaskCreate` shadows the MCP tool, and MCP tools need explicit permission).

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk` (`createSdkMcpServer`), `vitest`, reuses `src/tasks/{store,server}.ts` and `src/swarm/coordinator.ts#NATIVE_TASK_TOOLS`.

**Spec:** `docs/superpowers/specs/2026-06-16-daemon-d3-shared-services-design.md`

---

## File Structure

- **Modify** `src/daemon/types.ts` — add `sessionOptions` + `sharedTasks` to `DaemonOptions`.
- **Modify** `src/daemon/supervisor.ts` — public `tasks?: TaskStore`, private `sessionOptions?`, constructor `sharedTasks` resolution, `makeSession` merge.
- **Modify** `test/unit/daemon-supervisor.test.ts` — D3 unit tests (generic seam + sharedTasks built-in).
- **Modify** `test/live/daemon.test.ts` — one live cross-session collaboration test.

No new files. `DaemonSession`/`server.ts`/`client.ts`/`cli.ts` are unchanged.

---

### Task 1: Extend `DaemonOptions`

**Files:**
- Modify: `src/daemon/types.ts:18-29`

- [ ] **Step 1: Add the two optional fields to `DaemonOptions`**

In `src/daemon/types.ts`, inside `export interface DaemonOptions`, after the `scheduleRestart?` line (line 28), add:

```ts
  sessionOptions?: (sessionId: string) => Record<string, unknown>; // per-session options merged over { model } (D3)
  sharedTasks?: boolean | { dir?: string; listId?: string };       // wire a shared cc-tasks store into every session (D3)
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `cd CC-to-SDK/harness && npx tsc --noEmit`
Expected: PASS (no errors). The new optional fields are additive; existing code is unaffected.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/types.ts
git commit -m "feat(harness): DaemonOptions sessionOptions + sharedTasks (D3 types)"
```

---

### Task 2: Generic `sessionOptions` seam in the supervisor

**Files:**
- Modify: `src/daemon/supervisor.ts` (add field, read in constructor, merge in `makeSession`)
- Test: `test/unit/daemon-supervisor.test.ts`

- [ ] **Step 1: Add the capturing fake-query helper (top of the test file)**

In `test/unit/daemon-supervisor.test.ts`, after the existing `fakeQuery` function (line 9-11), add a helper that records the `options` each session is constructed with:

```ts
function captureQuery(sink: any[]) {
  return ({ prompt, options }: any) => {
    sink.push(options);
    return (async function* () { for await (const t of prompt) yield { type: "result", result: "did:" + t.message.content }; })();
  };
}
```

- [ ] **Step 2: Write the failing tests for the generic seam**

Append these two tests at the **end** of the `describe("DaemonSupervisor", ...)` block (after the last D2 test, so the `flush` const is in scope):

```ts
  // ---- D3 generic sessionOptions seam ----
  it("merges a sessionOptions factory into each session's options (model preserved)", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, {
      dir: dir(),
      sessionOptions: (id) => ({ mcpServers: { probe: {} }, marker: id }),
    });
    const id = sup.spawn({ model: "m1" });
    expect(cap).toHaveLength(1);
    expect(cap[0]).toMatchObject({ model: "m1", marker: id });
    expect(cap[0].mcpServers).toHaveProperty("probe");
    await sup.shutdown();
  });
  it("a restarted session receives fresh factory options too (compose with D2)", async () => {
    const cap: any[] = [];
    let calls = 0;
    const fq = ({ prompt, options }: any) => {
      cap.push(options); calls++;
      if (calls === 1) return (async function* () { /* dies at once */ })();
      return (async function* () { for await (const t of prompt) yield { type: "result", result: "ok:" + t.message.content }; })();
    };
    let pending: (() => void) | undefined;
    const scheduleRestart = (fn: () => void) => { pending = fn; return () => {}; };
    const sup = new DaemonSupervisor({ query: fq }, {
      dir: dir(), restart: "on-failure", scheduleRestart,
      sessionOptions: () => ({ mcpServers: { "cc-tasks": {} } }),
    });
    sup.spawn();
    await flush();                 // session 1 dies → restart scheduled
    pending!();                    // fire restart → session 2 constructed
    expect(cap).toHaveLength(2);
    expect(cap[0].mcpServers).toHaveProperty("cc-tasks");
    expect(cap[1].mcpServers).toHaveProperty("cc-tasks");
    expect(cap[1].mcpServers).not.toBe(cap[0].mcpServers); // fresh object per session
    await sup.shutdown();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `cap[0]` lacks `marker`/`probe` because `makeSession` does not yet apply `sessionOptions`.

- [ ] **Step 4: Add the `sessionOptions` field and read it in the constructor**

In `src/daemon/supervisor.ts`, add the field to the class (next to the other restart-machinery fields, after `private shuttingDown = false;` on line 29):

```ts
  private sessionOptions?: (sessionId: string) => Record<string, unknown>; // per-session options factory (D3)
```

At the end of the constructor (after the reaper `if` block, around line 45), read it from opts:

```ts
    this.sessionOptions = opts.sessionOptions;
```

- [ ] **Step 5: Merge the factory output in `makeSession`**

Replace the body of `makeSession` (lines 109-113) with:

```ts
  private makeSession(id: string, cfg: SpawnConfig): DaemonSession {
    const base = cfg.model ? { model: cfg.model } : {};
    const extra = this.sessionOptions?.(id);                 // fresh servers + tool posture for THIS session
    const options = extra ? { ...base, ...extra } : base;    // factory keys win; never sets model
    const session = new DaemonSession(id, { query: this.deps.query }, options, this.now);
    session.done.then(() => this.handleSessionEnd(id)).catch(() => {}); // end hook
    return session;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts`
Expected: PASS (all prior D1/D2 tests + the two new ones).

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): per-session sessionOptions seam in DaemonSupervisor (D3)"
```

---

### Task 3: `sharedTasks` built-in (shared cc-tasks store)

**Files:**
- Modify: `src/daemon/supervisor.ts` (imports, public `tasks?`, constructor resolution)
- Test: `test/unit/daemon-supervisor.test.ts`

- [ ] **Step 1: Write the failing tests for `sharedTasks`**

At the top of `test/unit/daemon-supervisor.test.ts`, add the import and a shared constant (place the import beside the existing imports, the const beside the `dir`/`fakeQuery` helpers):

```ts
import { NATIVE_TASK_TOOLS } from "../../src/swarm/coordinator.js";
const CC_TASKS = ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"].map((t) => `mcp__cc-tasks__${t}`);
```

Append these four tests at the **end** of the `describe` block:

```ts
  // ---- D3 sharedTasks built-in ----
  it("sharedTasks wires a cc-tasks server + native-off + allowlist into every session", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: dir(), sharedTasks: { dir: dir() } });
    expect(sup.tasks).toBeDefined();
    sup.spawn(); sup.spawn();
    for (const opts of cap) {
      expect(opts.mcpServers).toHaveProperty("cc-tasks");
      expect(opts.disallowedTools).toEqual(expect.arrayContaining([...NATIVE_TASK_TOOLS]));
      expect(opts.allowedTools).toEqual(CC_TASKS);
    }
    expect(cap[0].mcpServers["cc-tasks"]).not.toBe(cap[1].mcpServers["cc-tasks"]); // fresh instance per session
    await sup.shutdown();
  });
  it("all sessions share ONE task store (writes to supervisor.tasks are visible through it)", async () => {
    const sup = new DaemonSupervisor({ query: captureQuery([]) }, { dir: dir(), sharedTasks: { dir: dir() } });
    sup.spawn(); sup.spawn();
    await sup.tasks!.create({ subject: "SHARED_OK" });
    const items = await sup.tasks!.list();
    expect(items.map((t) => t.subject)).toEqual(["SHARED_OK"]);
    await sup.shutdown();
  });
  it("an explicit sessionOptions overrides the sharedTasks default factory (tasks still created)", async () => {
    const cap: any[] = [];
    const sup = new DaemonSupervisor({ query: captureQuery(cap) }, {
      dir: dir(), sharedTasks: { dir: dir() },
      sessionOptions: () => ({ mcpServers: { custom: {} } }),
    });
    sup.spawn();
    expect(cap[0].mcpServers).toHaveProperty("custom");
    expect(cap[0].mcpServers).not.toHaveProperty("cc-tasks");
    expect(cap[0].allowedTools).toBeUndefined();
    expect(sup.tasks).toBeDefined();           // still created for inspection
    await sup.shutdown();
  });
  it("sharedTasks: true normalizes to TaskStore defaults", async () => {
    const cap: any[] = [];
    const cwd = process.cwd();
    process.chdir(dir());                       // keep TaskStore's default write inside a tmp dir
    try {
      const sup = new DaemonSupervisor({ query: captureQuery(cap) }, { dir: dir(), sharedTasks: true });
      expect(sup.tasks).toBeDefined();
      sup.spawn();
      expect(cap[0].allowedTools).toEqual(CC_TASKS);
      await sup.shutdown();
    } finally { process.chdir(cwd); }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts`
Expected: FAIL — `sup.tasks` is `undefined` and no `cc-tasks`/`disallowedTools`/`allowedTools` appear in captured options (`sharedTasks` is not yet resolved).

- [ ] **Step 3: Add the imports to the supervisor**

In `src/daemon/supervisor.ts`, add beside the existing imports (after line 5):

```ts
import { TaskStore } from "../tasks/store.js";
import { createTaskMcpServer } from "../tasks/server.js";
import { NATIVE_TASK_TOOLS } from "../swarm/coordinator.js";
```

- [ ] **Step 4: Add the public `tasks` field**

In `src/daemon/supervisor.ts`, add as the first member of the class (above `private pool = ...` on line 13):

```ts
  tasks?: TaskStore; // shared cc-tasks store when `sharedTasks` is set (D3); public for inspection
```

- [ ] **Step 5: Resolve `sharedTasks` in the constructor**

In the constructor, replace the line added in Task 2 Step 4 (`this.sessionOptions = opts.sessionOptions;`) with the full resolution:

```ts
    const CC_TASKS_TOOLS = ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"].map((t) => `mcp__cc-tasks__${t}`);
    if (opts.sharedTasks) {
      const t = opts.sharedTasks === true ? {} : opts.sharedTasks;
      this.tasks = new TaskStore({ dir: t.dir, listId: t.listId }); // TaskStore defaults the rest
      this.sessionOptions = opts.sessionOptions ?? (() => ({
        mcpServers: { "cc-tasks": createTaskMcpServer(this.tasks!) }, // FRESH instance per call
        disallowedTools: [...NATIVE_TASK_TOOLS],                      // native task tools off → cc-tasks authoritative
        allowedTools: CC_TASKS_TOOLS,                                // auto-approve the cc-tasks tools
      }));
    } else {
      this.sessionOptions = opts.sessionOptions;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit/daemon-supervisor.test.ts`
Expected: PASS (all D1/D2 + the six D3 tests).

- [ ] **Step 7: Verify the whole project type-checks**

Run: `cd CC-to-SDK/harness && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add CC-to-SDK/harness/src/daemon/supervisor.ts CC-to-SDK/harness/test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): sharedTasks built-in (shared cc-tasks store) in DaemonSupervisor (D3)"
```

---

### Task 4: Live cross-session collaboration test

**Files:**
- Modify: `test/live/daemon.test.ts`

- [ ] **Step 1: Add the live test**

In `test/live/daemon.test.ts`, inside the `live("live daemon (real SDK)", ...)` block, after the existing `it(...)` test (before the closing `});` on line 33), add:

```ts
  it("two sessions collaborate through one shared task store (sharedTasks)", async () => {
    const d = mkdtempSync(join(tmpdir(), "cc-daemon-shared-"));
    const sock = join(d, "sock");
    const sup = new DaemonSupervisor({ query }, { dir: join(d, "sessions"), sharedTasks: { dir: join(d, "tasks") } });
    const server = new DaemonServer(sup, sock);
    await server.listen();

    const a = (await daemonRequest(sock, { op: "spawn" }))[0].id;
    const b = (await daemonRequest(sock, { op: "spawn" }))[0].id;

    // Session A creates a task via the cc-tasks MCP tool...
    await daemonRequest(sock, { op: "submit", id: a,
      prompt: "Use the TaskCreate tool to create a task with subject SHARED_OK. Then stop. Do not ask me anything." });
    // ...and it lands in the one shared store.
    const direct = await sup.tasks!.list();
    expect(direct.map((t) => t.subject)).toContain("SHARED_OK");

    // Session B sees it through its own fresh cc-tasks server over the same store.
    const lines: any[] = [];
    await daemonRequest(sock, { op: "submit", id: b,
      prompt: "Call the TaskList tool and report the subjects of all tasks. Do not ask me anything." },
      (o) => lines.push(o));
    const done = lines.find((l) => l.type === "done");
    expect(String(done?.result)).toMatch(/SHARED_OK/i);

    await daemonRequest(sock, { op: "shutdown" });
    await server.closed;
  }, 120_000);
```

- [ ] **Step 2: Run the live test**

Run: `cd CC-to-SDK/harness && node --env-file=../.env node_modules/.bin/vitest run test/live/daemon.test.ts`
Expected: PASS — `direct` contains `SHARED_OK` (A's tool wrote to `supervisor.tasks`) and B's streamed result matches `/SHARED_OK/i`. (Skips automatically if `ANTHROPIC_API_KEY` is unset.)

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/test/live/daemon.test.ts
git commit -m "test(harness): live cross-session shared-task collaboration (D3)"
```

---

### Task 5: Format + full daemon suite green

**Files:** none (verification only)

- [ ] **Step 1: Format**

Run: `cd CC-to-SDK/harness && npx prettier --write src/daemon/ test/unit/daemon-supervisor.test.ts test/live/daemon.test.ts`
Expected: files formatted (or unchanged).

- [ ] **Step 2: Run the full unit suite to confirm no regressions**

Run: `cd CC-to-SDK/harness && node node_modules/.bin/vitest run test/unit`
Expected: PASS — all unit files green (D1/D2 + the six new D3 tests; ~179 tests).

- [ ] **Step 3: Final type-check**

Run: `cd CC-to-SDK/harness && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A CC-to-SDK/harness
git commit -m "chore(harness): format D3 daemon changes" || echo "nothing to format-commit"
```

---

## Self-Review

**Spec coverage:**
- §4 `DaemonOptions += sessionOptions, sharedTasks` → Task 1.
- §5 factory seam merged in `makeSession` (spawn + restart) → Task 2 (restart covered by the compose-with-D2 test).
- §5 `sharedTasks` resolution (store + default trio factory; explicit factory wins; `tasks` still created) → Task 3.
- §2/§3 fresh-instance-per-session → asserted in Task 2 (`not.toBe`) and Task 3 (`cc-tasks` `not.toBe`).
- §7 unit verification (factory merged, restart, trio shape, one shared store, explicit override) → Task 3 tests.
- §7 live test (two sessions, A writes SHARED_OK, B lists) → Task 4.
- §8 native-off + allowlist + model preserved + D1/D2 unchanged + tsc clean → asserted across Tasks 2/3 and verified in Task 5.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** field name `sessionOptions` (factory) and `tasks` (public `TaskStore`) are used identically in types.ts, supervisor.ts, and tests. The allowlist constant is `mcp__cc-tasks__{TaskCreate,TaskUpdate,TaskGet,TaskList}` in both the supervisor (`CC_TASKS_TOOLS`) and the test (`CC_TASKS`). `TaskStore.create({ subject })` / `.list()` match `src/tasks/store.ts`. `createTaskMcpServer` registers under name `"cc-tasks"`, so MCP tool names resolve to `mcp__cc-tasks__*` (confirmed by spike).

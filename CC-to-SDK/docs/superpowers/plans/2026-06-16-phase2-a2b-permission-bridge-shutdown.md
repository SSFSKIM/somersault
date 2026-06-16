# Phase 2 · A2b — Permission Bridge + Shutdown Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize every teammate's `canUseTool` through a runtime `PermissionBroker` (allow / deny / escalate-to-coordinator) and add a graceful shutdown handshake, both over a shared bus-RPC correlation layer.

**Architecture:** A `RequestRegistry` (id → pending promise → resolve) is the reusable RPC primitive. The `PermissionBroker` decides each teammate tool call via an allowlist policy, escalating non-allowlisted calls (when enabled) to the coordinator inbox to be answered by a `RespondPermission` tool. The runtime wires `canUseTool` into every teammate's query options and exposes `requestShutdown` (ack envelope + dispose). New `cc-swarm` tools `RespondPermission` / `ShutdownTeammate` let the coordinator drive both.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` specifiers), `@anthropic-ai/claude-agent-sdk` (`PermissionResult`, `canUseTool`, `tool`), `zod/v4`, vitest.

**Conventions:**
- All paths under `CC-to-SDK/harness/`; run commands from there. Single-file test: `npx vitest run test/unit/<file>.test.ts`. Typecheck: `npm run typecheck`.
- Commits `feat(harness):` / `test(harness):`. **No `Co-Authored-By` / attribution lines.**
- MCP handlers return `CallToolResult` and turn domain errors into `isError` results (never throw) — like `src/swarm/server.ts`.
- Spec: `docs/superpowers/specs/2026-06-16-phase2-a2b-permission-bridge-shutdown-design.md`.

---

### Task 1: `RequestRegistry` — bus-RPC correlation primitive

**Files:**
- Create: `src/swarm/requests.ts`
- Test: `test/unit/swarm-requests.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-requests.test.ts
import { describe, it, expect } from "vitest";
import { RequestRegistry } from "../../src/swarm/requests.js";

describe("RequestRegistry", () => {
  it("create() returns an id + a promise that resolve() settles", async () => {
    const r = new RequestRegistry<{ decision: string }>();
    const { id, promise } = r.create();
    expect(typeof id).toBe("string");
    expect(r.resolve(id, { decision: "allow" })).toBe(true);
    expect(await promise).toEqual({ decision: "allow" });
  });
  it("resolve() on an unknown id returns false", () => {
    expect(new RequestRegistry().resolve("nope", {})).toBe(false);
  });
  it("resolve() twice on the same id returns false the second time", () => {
    const r = new RequestRegistry();
    const { id } = r.create();
    expect(r.resolve(id, {})).toBe(true);
    expect(r.resolve(id, {})).toBe(false);
  });
  it("ids are unique", () => {
    const r = new RequestRegistry();
    expect(r.create().id).not.toBe(r.create().id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-requests.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/requests.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/requests.ts
/** Correlates an async request id with a pending promise the holder resolves later (bus-RPC). */
export class RequestRegistry<T = unknown> {
  private pending = new Map<string, (value: T) => void>();
  private seq = 0;

  create(): { id: string; promise: Promise<T> } {
    const id = `req-${++this.seq}`;
    const promise = new Promise<T>((resolve) => this.pending.set(id, resolve));
    return { id, promise };
  }

  resolve(id: string, value: T): boolean {
    const resolve = this.pending.get(id);
    if (!resolve) return false;
    this.pending.delete(id);
    resolve(value);
    return true;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-requests.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/requests.ts test/unit/swarm-requests.test.ts
git commit -m "feat(harness): RequestRegistry (bus-RPC correlation primitive)"
```

---

### Task 2: Types — message kinds, `data`, permission shapes

**Files:**
- Modify: `src/swarm/types.ts`
- Test: `test/unit/swarm-types.test.ts` (extend)

- [ ] **Step 1: Add failing assertions to the existing test**

Append these tests inside the `describe("swarm types", ...)` block in `test/unit/swarm-types.test.ts`:

```ts
  it("respondPermissionShape requires requestId + a decision enum", () => {
    const ok = z.object(respondPermissionShape).parse({ requestId: "req-1", decision: "allow", message: "ok" });
    expect(ok.decision).toBe("allow");
    expect(() => z.object(respondPermissionShape).parse({ requestId: "req-1", decision: "maybe" })).toThrow();
  });
  it("shutdownTeammateShape requires a name", () => {
    expect(z.object(shutdownTeammateShape).parse({ name: "w1" }).name).toBe("w1");
    expect(() => z.object(shutdownTeammateShape).parse({})).toThrow();
  });
```

And extend the import at the top of that file:

```ts
import {
  SwarmError,
  teamCreateShape, teamDeleteShape, spawnTeammateShape, sendMessageShape, checkMessagesShape,
  respondPermissionShape, shutdownTeammateShape,
} from "../../src/swarm/types.js";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-types.test.ts`
Expected: FAIL — `respondPermissionShape` / `shutdownTeammateShape` are not exported.

- [ ] **Step 3: Modify `src/swarm/types.ts`**

Change the `MessageKind` union (add `permission` and `shutdown`):

```ts
export type MessageKind = "text" | "task" | "result" | "idle" | "permission" | "shutdown";
```

Add an optional `data` field to `Message` (after `body`):

```ts
export interface Message {
  from: string;
  to: string;
  kind: MessageKind;
  body: string;
  data?: Record<string, unknown>; // structured payload (e.g. permission requestId/tool/input)
  ts: string;
}
```

Add to `SwarmOptions`:

```ts
export interface SwarmOptions {
  cwd?: string;
  taskOptions?: { dir?: string; listId?: string; agentName?: string };
  permissions?: { allow?: string[]; escalateToCoordinator?: boolean };
}
```

Add the permission decision type and the two new zod shapes (after the existing shapes, before the inferred types):

```ts
export interface PermissionDecision { decision: "allow" | "deny"; message?: string; }

const DECISION = z.enum(["allow", "deny"]);
export const respondPermissionShape = {
  requestId: z.string(),
  decision: DECISION,
  message: z.string().optional(),
};
export const shutdownTeammateShape = { name: z.string() };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-types.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/types.ts test/unit/swarm-types.test.ts
git commit -m "feat(harness): swarm types for permission bridge + shutdown (kinds, data, shapes)"
```

---

### Task 3: `PermissionBroker` — central canUseTool decision

**Files:**
- Create: `src/swarm/permissions.ts`
- Test: `test/unit/swarm-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/swarm-permissions.test.ts
import { describe, it, expect } from "vitest";
import { PermissionBroker, DEFAULT_ALLOW } from "../../src/swarm/permissions.js";

describe("PermissionBroker", () => {
  it("allows read-only + cc-tasks tools by default", async () => {
    const b = new PermissionBroker({});
    expect((await b.decide("w1", "Read", {})).behavior).toBe("allow");
    expect((await b.decide("w1", "mcp__cc-tasks__TaskUpdate", {})).behavior).toBe("allow");
    expect(DEFAULT_ALLOW).toContain("Read");
  });
  it("denies non-allowlisted tools when escalation is off (default)", async () => {
    const r = await new PermissionBroker({}).decide("w1", "Bash", { command: "rm" });
    expect(r.behavior).toBe("deny");
  });
  it("escalates when enabled and resolves allow via respond()", async () => {
    const pushed: any[] = [];
    const b = new PermissionBroker({ escalate: true, onEscalate: (teammate, tool, input, id) => pushed.push({ teammate, tool, id }) });
    const p = b.decide("w1", "Bash", { command: "ls" });
    expect(pushed).toHaveLength(1);
    expect(b.respond(pushed[0].id, "allow")).toBe(true);
    expect((await p).behavior).toBe("allow");
  });
  it("escalation resolved as deny carries the message", async () => {
    const ids: string[] = [];
    const b = new PermissionBroker({ escalate: true, onEscalate: (t, tool, i, id) => ids.push(id) });
    const p = b.decide("w1", "Write", {});
    b.respond(ids[0], "deny", "no writes");
    const r = await p;
    expect(r.behavior).toBe("deny");
    expect((r as any).message).toBe("no writes");
  });
  it("respond() on an unknown id returns false", () => {
    expect(new PermissionBroker({}).respond("nope", "allow")).toBe(false);
  });
  it("fires the onRequest observer before deciding", async () => {
    const seen: any[] = [];
    const b = new PermissionBroker({ onRequest: (t, req) => seen.push({ t, tool: req.tool }) });
    await b.decide("w1", "Read", {});
    expect(seen).toEqual([{ t: "w1", tool: "Read" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-permissions.test.ts`
Expected: FAIL — `Cannot find module '../../src/swarm/permissions.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/swarm/permissions.ts
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { RequestRegistry } from "./requests.js";
import type { PermissionDecision } from "./types.js";

/** Tools every teammate may use without asking: read-only inspection + the shared cc-tasks tools. */
export const DEFAULT_ALLOW = ["Read", "Grep", "Glob", "LS", "mcp__cc-tasks__*"];

export interface PermissionBrokerOptions {
  allow?: string[];
  escalate?: boolean;
  onRequest?: (teammate: string, req: { tool: string; input: Record<string, unknown> }) => void;
  onEscalate?: (teammate: string, tool: string, input: Record<string, unknown>, requestId: string) => void;
}

/** Central canUseTool policy for all teammates: allow / deny / escalate-to-coordinator. */
export class PermissionBroker {
  private allow: string[];
  private escalate: boolean;
  private onRequest?: PermissionBrokerOptions["onRequest"];
  private onEscalate?: PermissionBrokerOptions["onEscalate"];
  private requests = new RequestRegistry<PermissionDecision>();

  constructor(opts: PermissionBrokerOptions = {}) {
    this.allow = opts.allow ?? DEFAULT_ALLOW;
    this.escalate = opts.escalate ?? false;
    this.onRequest = opts.onRequest;
    this.onEscalate = opts.onEscalate;
  }

  private isAllowed(tool: string): boolean {
    return this.allow.some((p) => (p.endsWith("*") ? tool.startsWith(p.slice(0, -1)) : p === tool));
  }

  decide(teammate: string, tool: string, input: Record<string, unknown>): Promise<PermissionResult> {
    this.onRequest?.(teammate, { tool, input });
    if (this.isAllowed(tool)) return Promise.resolve({ behavior: "allow" });
    if (!this.escalate) return Promise.resolve({ behavior: "deny", message: `not permitted: ${tool}` });
    const { id, promise } = this.requests.create();
    this.onEscalate?.(teammate, tool, input, id);
    return promise.then((d) =>
      d.decision === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: d.message ?? `denied: ${tool}` },
    );
  }

  respond(requestId: string, decision: "allow" | "deny", message?: string): boolean {
    return this.requests.resolve(requestId, { decision, message });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-permissions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/permissions.ts test/unit/swarm-permissions.test.ts
git commit -m "feat(harness): PermissionBroker (allow/deny/escalate canUseTool policy)"
```

---

### Task 4: TeammateSession — shutdown envelope + `shutdown()`

**Files:**
- Modify: `src/swarm/teammate.ts`
- Test: `test/unit/swarm-teammate.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append inside `describe("TeammateSession", ...)` in `test/unit/swarm-teammate.test.ts`:

```ts
  it("maps a worker_shutting_down system message to a shutdown envelope", async () => {
    const bus = new MessageBus();
    const fq = ({ prompt }: any) => (async function* () {
      for await (const t of prompt) { void t; yield { type: "system", subtype: "worker_shutting_down", reason: "host_exit" }; yield { type: "result", result: "x" }; }
    })();
    const s = new TeammateSession({ name: "w1", teamId: "t1", prompt: "go" }, bus, { query: fq });
    await s.settled();
    expect(bus.drain("coordinator").map((m) => m.kind)).toContain("shutdown");
    await s.dispose();
  });
  it("shutdown() emits a shutdown ack and ends the query", async () => {
    const bus = new MessageBus();
    let ended = false;
    const fq = ({ prompt }: any) => (async function* () {
      try { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } } finally { ended = true; }
    })();
    const s = new TeammateSession({ name: "w1", teamId: "t1", prompt: "go" }, bus, { query: fq });
    await s.settled();
    bus.drain("coordinator");
    await s.shutdown();
    expect(bus.drain("coordinator").some((m) => m.kind === "shutdown")).toBe(true);
    expect(ended).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: FAIL — no `shutdown` envelope / `s.shutdown` is not a function.

- [ ] **Step 3: Modify `src/swarm/teammate.ts`**

Add a `shutdown()` method (after `dispose()`):

```ts
  /** Graceful shutdown handshake: ack the coordinator, then end the query (current turn finishes first). */
  async shutdown(): Promise<void> {
    this.emit("shutdown", "");
    await this.dispose();
  }
```

In `readLoop`, add a `worker_shutting_down` branch (inside the `for await`, before the `result` check):

```ts
  private async readLoop(): Promise<void> {
    try {
      for await (const m of this.q) {
        const mm = m as any;
        if (mm.type === "system" && mm.subtype === "worker_shutting_down") this.emit("shutdown", String(mm.reason ?? ""));
        if (mm.type === "result") {
          this.emit("result", String(mm.result ?? ""));
          if (this.input.pending === 0) this.emit("idle", "");
          this.settle();
        }
      }
    } finally {
      this.settle();
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/teammate.ts test/unit/swarm-teammate.test.ts
git commit -m "feat(harness): teammate shutdown envelope + graceful shutdown()"
```

---

### Task 5: SwarmRuntime — broker wiring, canUseTool, respondPermission, requestShutdown

**Files:**
- Modify: `src/swarm/runtime.ts`
- Test: `test/unit/swarm-runtime.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append inside `describe("SwarmRuntime", ...)` in `test/unit/swarm-runtime.test.ts`:

```ts
  it("wires canUseTool into teammate options; the broker allows/denies by policy", async () => {
    let seen: any;
    const fq = ({ prompt, options }: any) => { seen = options; return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })(); };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() } });
    const team = rt.createTeam("a");
    rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "x" });
    expect(typeof seen.canUseTool).toBe("function");
    expect((await seen.canUseTool("Read", {})).behavior).toBe("allow");
    expect((await seen.canUseTool("Bash", {})).behavior).toBe("deny");
    return rt.disposeAll();
  });
  it("escalates a teammate permission to the coordinator inbox, resolved by respondPermission", async () => {
    let cut: any;
    const fq = ({ prompt, options }: any) => { cut = options.canUseTool; return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })(); };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() }, permissions: { escalateToCoordinator: true } });
    const team = rt.createTeam("a");
    rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "x" });
    const decision = cut("Bash", { command: "ls" }); // teammate asks
    const perm = rt.checkMessages().find((m) => m.kind === "permission");
    expect(perm).toBeTruthy();
    const requestId = (perm!.data as any).requestId;
    expect(rt.respondPermission(requestId, "allow")).toBe(true);
    expect((await decision).behavior).toBe("allow");
    return rt.disposeAll();
  });
  it("requestShutdown emits a shutdown ack and unregisters the teammate", async () => {
    const fq = ({ prompt }: any) => (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })();
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() } });
    const team = rt.createTeam("a");
    rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "x" });
    await rt.requestShutdown("w1");
    expect(rt.checkMessages().some((m) => m.kind === "shutdown")).toBe(true);
    expect(() => rt.sendMessage("w1", "hi")).toThrow(/unknown recipient/);
    await expect(rt.requestShutdown("ghost")).rejects.toThrow(/unknown teammate/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: FAIL — `seen.canUseTool` undefined / `rt.respondPermission` / `rt.requestShutdown` not functions.

- [ ] **Step 3: Modify `src/swarm/runtime.ts`**

Add the import (after the `NATIVE_TASK_TOOLS` import):

```ts
import { PermissionBroker } from "./permissions.js";
```

Add a `broker` field (after the `private sessions` line):

```ts
  private broker: PermissionBroker;
```

In the constructor, build the broker (after the `this.tasks = ...` assignment):

```ts
    this.broker = new PermissionBroker({
      allow: opts.permissions?.allow,
      escalate: opts.permissions?.escalateToCoordinator,
      onRequest: (teammate, req) => this.onPermissionRequest?.(teammate, req),
      onEscalate: (teammate, tool, input, requestId) => {
        this.bus.send("coordinator", {
          from: teammate, to: "coordinator", kind: "permission",
          body: `${teammate} requests ${tool}`,
          data: { requestId, teammate, tool, input },
          ts: new Date().toISOString(),
        });
      },
    });
```

In `spawnTeammate`, add `canUseTool` to the teammate `options` object:

```ts
    const options: Record<string, unknown> = {
      mcpServers: { "cc-tasks": createTaskMcpServer(teammateStore) },
      disallowedTools: [...NATIVE_TASK_TOOLS],
      canUseTool: (tool: string, input: Record<string, unknown>) => this.broker.decide(spec.name, tool, input),
    };
```

Add two methods (after `checkMessages()`):

```ts
  respondPermission(requestId: string, decision: "allow" | "deny", message?: string): boolean {
    return this.broker.respond(requestId, decision, message);
  }

  async requestShutdown(name: string): Promise<void> {
    const s = this.sessions.get(name);
    if (!s) throw new SwarmError(`unknown teammate ${name}`);
    this.onHandshake?.("shutdown", { name });
    await s.shutdown();
    this.sessions.delete(name);
    this.bus.unregister(name);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/runtime.ts test/unit/swarm-runtime.test.ts
git commit -m "feat(harness): runtime permission broker + canUseTool + requestShutdown"
```

---

### Task 6: cc-swarm tools — RespondPermission, ShutdownTeammate

**Files:**
- Modify: `src/swarm/server.ts`
- Test: `test/unit/swarm-server.test.ts` (extend + update the tool-count assertion)

- [ ] **Step 1: Update the count assertion + add failing tests**

In `test/unit/swarm-server.test.ts`, change the "exposes the five tools" test to seven:

```ts
  it("exposes the seven tools", () => {
    expect(Object.keys(toolMap(newRuntime())).sort())
      .toEqual(["CheckMessages", "RespondPermission", "SendMessage", "ShutdownTeammate", "TeamCreate", "TeamDelete", "spawnTeammate"]);
  });
```

Add (inside the describe block):

```ts
  it("RespondPermission errors on an unknown request id; ShutdownTeammate on an unknown teammate", async () => {
    const t = toolMap(newRuntime());
    const bad = await t.RespondPermission.handler({ requestId: "nope", decision: "allow" }, {});
    expect(bad.isError).toBe(true);
    const badS = await t.ShutdownTeammate.handler({ name: "ghost" }, {});
    expect(badS.isError).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: FAIL — only five tools; `RespondPermission`/`ShutdownTeammate` undefined.

- [ ] **Step 3: Modify `src/swarm/server.ts`**

Extend the import of shapes:

```ts
import {
  teamCreateShape, teamDeleteShape, spawnTeammateShape, sendMessageShape, checkMessagesShape,
  respondPermissionShape, shutdownTeammateShape,
} from "./types.js";
```

Add two tools to the array returned by `buildSwarmTools` (after the `CheckMessages` tool):

```ts
    tool("RespondPermission", "Resolve a teammate's escalated permission request by id (allow/deny).", respondPermissionShape, async (a) => {
      return runtime.respondPermission(a.requestId, a.decision, a.message)
        ? ok({ resolved: a.requestId, decision: a.decision })
        : fail(`unknown request ${a.requestId}`);
    }),
    tool("ShutdownTeammate", "Gracefully shut down a teammate (finish current turn, then stop).", shutdownTeammateShape, async (a) => {
      try { await runtime.requestShutdown(a.name); return ok({ shutdown: a.name }); }
      catch (e) { return fail((e as Error).message); }
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/server.ts test/unit/swarm-server.test.ts
git commit -m "feat(harness): RespondPermission + ShutdownTeammate cc-swarm tools"
```

---

### Task 7: Coordinator persona + whitelist

**Files:**
- Modify: `src/swarm/coordinator.ts`
- Test: `test/unit/swarm-coordinator.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append inside `describe("coordinator persona", ...)` in `test/unit/swarm-coordinator.test.ts`:

```ts
  it("whitelist includes the permission + shutdown tools", () => {
    expect(coordinatorTools()).toEqual(expect.arrayContaining([
      "mcp__cc-swarm__RespondPermission", "mcp__cc-swarm__ShutdownTeammate",
    ]));
  });
  it("persona tells the coordinator to poll and answer permission requests", () => {
    expect(COORDINATOR_PROMPT).toMatch(/CheckMessages/);
    expect(COORDINATOR_PROMPT).toMatch(/permission/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: FAIL — the two tools/persona text are absent.

- [ ] **Step 3: Modify `src/swarm/coordinator.ts`**

Add the two tools to the array in `coordinatorTools()` (after the `mcp__cc-swarm__CheckMessages` entry):

```ts
    "mcp__cc-swarm__RespondPermission", "mcp__cc-swarm__ShutdownTeammate",
```

Append a sentence to `COORDINATOR_PROMPT` (add to the joined array, before the closing `].join(" ")`):

```ts
  "Poll CheckMessages regularly; answer any permission requests with RespondPermission, and stop a teammate with ShutdownTeammate when its work is done.",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/swarm/coordinator.ts test/unit/swarm-coordinator.test.ts
git commit -m "feat(harness): coordinator whitelist + persona for permission/shutdown tools"
```

---

### Task 8: Config + harness wiring (permissions → runtime)

**Files:**
- Modify: `src/config/types.ts` (add `permissions` to the `swarm` object type)
- Modify: `src/harness.ts` (pass `permissions` into the runtime)
- Test: `test/unit/swarm-integration.test.ts` (extend)

- [ ] **Step 1: Add a failing test**

Append inside `describe("swarm harness wiring", ...)` in `test/unit/swarm-integration.test.ts`:

```ts
  it("passes permissions config into the runtime broker", async () => {
    let cut: any;
    const fq = ({ prompt, options }: any) => {
      if (options?.canUseTool) cut = options.canUseTool;
      return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "ok" }; } })();
    };
    const h = createHarness({ swarm: { permissions: { escalateToCoordinator: false } }, cwd: dir() }, { query: fq as any });
    const team = h.swarm!.createTeam("a");
    h.swarm!.spawnTeammate({ teamId: team.id, name: "w1", prompt: "x" });
    expect(typeof cut).toBe("function");
    expect((await cut("Bash", {})).behavior).toBe("deny");
    expect((await cut("Read", {})).behavior).toBe("allow");
    await h.swarm!.disposeAll();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/swarm-integration.test.ts`
Expected: FAIL — `permissions` not accepted on the `swarm` config type (typecheck) / broker not wired.

- [ ] **Step 3a: Modify `src/config/types.ts`**

Change the `swarm?` line to add `permissions`:

```ts
  swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[]; permissions?: { allow?: string[]; escalateToCoordinator?: boolean } };
```

- [ ] **Step 3b: Modify `src/harness.ts`**

In the `if (config.swarm) {` block, pass `permissions` into the runtime:

```ts
    swarm = new SwarmRuntime({ query }, { cwd: config.cwd, taskOptions: to, permissions: so.permissions });
```

- [ ] **Step 4: Run the test + full suite + typecheck**

Run: `npx vitest run test/unit/swarm-integration.test.ts`
Expected: PASS.

Run: `npm run test:unit`
Expected: all prior + new swarm unit tests pass, no regressions.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts src/harness.ts test/unit/swarm-integration.test.ts
git commit -m "feat(harness): wire swarm permissions config into the runtime"
```

---

### Task 9: Live smoke test — bridge allow path (real SDK)

**Files:**
- Modify: `test/live/swarm.test.ts` (add a test)

- [ ] **Step 1: Add the test**

Append inside `live("live swarm substrate (real SDK)", ...)` in `test/live/swarm.test.ts`:

```ts
  it("a teammate's cc-tasks tool passes the permission bridge and reaches the shared store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swarm-perm-live-"));
    const h = createHarness({ swarm: true, cwd: dir, permissionMode: "bypassPermissions", maxTurns: 6 });
    const rt = h.swarm!;
    const team = rt.createTeam("alpha");
    const s = rt.spawnTeammate({
      teamId: team.id,
      name: "w1",
      prompt: "Create a task with subject exactly 'BRIDGE_OK' using the TaskCreate tool from the cc-tasks server. Then stop. Do not ask me anything.",
    });
    await s.settled();
    const tasks = await rt.tasks.list();
    expect(tasks.some((t) => /BRIDGE_OK/i.test(t.subject))).toBe(true);
    await rt.disposeAll();
  }, 60_000);
```

- [ ] **Step 2: Run the live test**

Run (env must carry `ANTHROPIC_API_KEY`; from `CC-to-SDK/harness/`): `set -a; . ../.env; set +a; npx vitest run test/live/swarm.test.ts`
Expected: PASS if the key is set — the teammate's `mcp__cc-tasks__TaskCreate` call is allowed by the broker (default allowlist) and the shared store shows `BRIDGE_OK`. Auto-skips without the key. (A credit/balance error is environmental — note it and rely on the unit suite.)

- [ ] **Step 3: Commit**

```bash
git add test/live/swarm.test.ts
git commit -m "test(harness): live smoke test for the permission bridge allow path"
```

---

## Final verification (after all tasks)

- [ ] `npm run test:unit` → all green (Phase-1/A1/A2 + the new A2b tests).
- [ ] `npm run typecheck` → clean.
- [ ] `npx vitest run test/live/swarm.test.ts` → passes (or auto-skips / notes a credit error).
- [ ] `git status` clean; no `.env`/secret staged.
- [ ] Two-stage review (Spec Compliance, then Code Quality) via `/codex:rescue --model gpt-5.5 --effort high`; fall back to a Claude `feature-dev:code-reviewer` if codex spawning fails.

## Notes for the implementer

- **DI everywhere:** unit tests capture `canUseTool` via a fake `query` (the `seen`/`cut` pattern) — never call a real `query` in unit tests.
- **escalateToCoordinator default off:** a denied non-allowlisted tool returns immediately (`{behavior:'deny'}`); escalation only happens when the config opts in, and then the teammate's `canUseTool` promise stays pending until `RespondPermission` resolves it.
- **`PermissionResult` shape:** `{behavior:'allow', updatedInput?}` | `{behavior:'deny', message}` — return these exactly (the SDK type).
- **Shutdown is already graceful:** `dispose()` lets the in-flight turn finish before the query ends; `shutdown()` just adds the ack envelope. Do not add an `interrupt()`.
- **`requestShutdown` is async** — tests use `await expect(...).rejects.toThrow(...)` for the unknown-teammate case.

# Phase 2 · A2c — Plan-Approval Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teammate be spawned in plan mode; when it calls `ExitPlanMode`, escalate its plan to the coordinator, who approves (teammate exits plan mode → implements) or rejects with feedback (teammate revises).

**Architecture:** A new `PlanApprovalBroker` (sibling of A2b's `PermissionBroker`, sharing the `RequestRegistry` bus-RPC layer) intercepts `ExitPlanMode` inside the teammate's `canUseTool`. It always escalates a `plan` envelope to the coordinator inbox and parks on a `requestId`. The coordinator answers with a new `ApprovePlan` cc-swarm tool; on approve the runtime transitions the teammate via the query's `setPermissionMode` to a configurable post-approval mode, then resolves the parked `ExitPlanMode` call to `allow`.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk`, vitest, zod/v4. All units take an injected `query` (DI) so the substrate is unit-tested with zero network.

**Reference spec:** `docs/superpowers/specs/2026-06-16-phase2-a2c-plan-approval-design.md`

**Verified SDK facts (live spikes, not the Feb snapshot):** under `permissionMode:"plan"`, `ExitPlanMode` routes through `canUseTool` with the plan in `input.plan`; the query object exposes `setPermissionMode`; `permissionMode:"auto"` bypasses `canUseTool` entirely (hence post-approval mode is a *governance-source choice*, default `"default"`).

**Conventions to match (from the existing swarm code):**
- `PermissionResult` `allow` MUST carry `updatedInput` (the SDK rejects a bare `{behavior:"allow"}` with a ZodError — the A2b live-test discovery).
- Tools return `ok(data)` / `fail(msg)` (the `server.ts` helpers); domain errors surface as `isError`, never throws.
- Mirror A2b naming: broker + `RequestRegistry`, `respondPlan` ≈ `respondPermission`, `ApprovePlan` ≈ `RespondPermission`.

Run all commands from `CC-to-SDK/harness/`. Per-task: `npx vitest run <file>` to check, `npm run typecheck` before committing. Commit to `main` (no branch), no `Co-Authored-By`/attribution.

---

### Task 1: Types & config — plan kind, plan flag, plan shapes, post-approval mode

**Files:**
- Modify: `src/swarm/types.ts`
- Modify: `src/config/types.ts`
- Test: `test/unit/swarm-types.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the `describe("swarm types", …)` block in `test/unit/swarm-types.test.ts`, and extend the import:

```ts
// add to the import from "../../src/swarm/types.js":
//   approvePlanShape
```

```ts
  it("spawnTeammateShape accepts an optional plan flag", () => {
    const ok = z.object(spawnTeammateShape).parse({ teamId: "team-1", name: "w1", prompt: "go", plan: true });
    expect(ok.plan).toBe(true);
    expect(z.object(spawnTeammateShape).parse({ teamId: "team-1", name: "w1", prompt: "go" }).plan).toBeUndefined();
    expect(() => z.object(spawnTeammateShape).parse({ teamId: "team-1", name: "w1", prompt: "go", plan: "yes" })).toThrow();
  });
  it("approvePlanShape requires requestId + an approve/reject decision", () => {
    const ok = z.object(approvePlanShape).parse({ requestId: "req-1", decision: "approve", feedback: "lgtm" });
    expect(ok.decision).toBe("approve");
    expect(() => z.object(approvePlanShape).parse({ requestId: "req-1", decision: "allow" })).toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-types.test.ts`
Expected: FAIL — `approvePlanShape` is not exported (import error) / undefined.

- [ ] **Step 3: Implement in `src/swarm/types.ts`**

Change the `MessageKind` union (line 3) to add `"plan"`:

```ts
export type MessageKind = "text" | "task" | "result" | "idle" | "permission" | "shutdown" | "plan";
```

Add `plan?: boolean` to `TeammateSpec`:

```ts
export interface TeammateSpec {
  name: string;            // unique within the runtime
  teamId: string;
  agent?: string;          // per-teammate model hint (30.9); forwarded to the teammate query as options.model
  prompt: string;          // seed turn
  plan?: boolean;          // spawn in plan mode → ExitPlanMode escalates to the coordinator (A2c)
}
```

Add the post-approval mode type and extend `SwarmOptions.permissions`:

```ts
export type PostApprovalMode = "default" | "acceptEdits" | "auto" | "bypassPermissions";

export interface SwarmOptions {
  cwd?: string;
  taskOptions?: { dir?: string; listId?: string; agentName?: string };
  permissions?: { allow?: string[]; escalateToCoordinator?: boolean; onPlanApproval?: PostApprovalMode };
}
```

Add `plan` to `spawnTeammateShape`:

```ts
export const spawnTeammateShape = {
  teamId: z.string(),
  name: z.string(),
  agent: z.string().optional(),
  prompt: z.string(),
  plan: z.boolean().optional(),
};
```

Add the plan-decision type and tool shape next to the existing permission ones (after `shutdownTeammateShape`):

```ts
export interface PlanDecision { decision: "approve" | "reject"; feedback?: string; }

const PLAN_DECISION = z.enum(["approve", "reject"]);
export const approvePlanShape = {
  requestId: z.string(),
  decision: PLAN_DECISION,
  feedback: z.string().optional(),
};
```

- [ ] **Step 4: Implement in `src/config/types.ts`** — extend the `swarm` config (line 41) to surface `onPlanApproval`:

```ts
  swarm?: boolean | { team?: string; coordinatorPersona?: boolean; tools?: string[]; permissions?: { allow?: string[]; escalateToCoordinator?: boolean; onPlanApproval?: "default" | "acceptEdits" | "auto" | "bypassPermissions" } };
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run test/unit/swarm-types.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. (`harness.ts` already forwards `so.permissions` wholesale, so `onPlanApproval` flows to the runtime with no `harness.ts` change.)

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/types.ts CC-to-SDK/harness/src/config/types.ts CC-to-SDK/harness/test/unit/swarm-types.test.ts
git commit -m "feat(harness): A2c types — plan kind, plan flag, approvePlan shape, post-approval mode"
```

---

### Task 2: PlanApprovalBroker (the handshake unit)

**Files:**
- Create: `src/swarm/planApproval.ts`
- Test: `test/unit/swarm-plan-approval.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/unit/swarm-plan-approval.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PlanApprovalBroker } from "../../src/swarm/planApproval.js";

const input = { plan: "# Plan\nDo the thing", planFilePath: "/tmp/p.md" };

describe("PlanApprovalBroker", () => {
  it("always escalates (never resolves immediately) and surfaces the plan text", () => {
    const esc: any[] = [];
    const b = new PlanApprovalBroker({ onEscalate: (name, plan, id) => esc.push({ name, plan, id }) });
    const p = b.requestApproval("w1", input);
    expect(esc).toHaveLength(1);
    expect(esc[0].name).toBe("w1");
    expect(esc[0].plan).toContain("Do the thing");
    expect(typeof esc[0].id).toBe("string");
    let settled = false;
    void p.then(() => { settled = true; });
    expect(settled).toBe(false); // parked until respond()
  });
  it("approve resolves to allow and echoes the FULL ExitPlanMode input", async () => {
    const ids: string[] = [];
    const approved: string[] = [];
    const b = new PlanApprovalBroker({ onEscalate: (n, p, id) => ids.push(id), onApprove: (n) => { approved.push(n); } });
    const p = b.requestApproval("w1", input);
    expect(await b.respond(ids[0], "approve")).toBe(true);
    expect(approved).toEqual(["w1"]);            // onApprove fired for the right teammate
    const r = await p;
    expect(r.behavior).toBe("allow");
    expect((r as any).updatedInput).toEqual(input); // full echo (SDK-required)
  });
  it("reject resolves to deny carrying the feedback", async () => {
    const ids: string[] = [];
    const b = new PlanApprovalBroker({ onEscalate: (n, p, id) => ids.push(id) });
    const p = b.requestApproval("w1", input);
    await b.respond(ids[0], "reject", "tighten scope");
    const r = await p;
    expect(r.behavior).toBe("deny");
    expect((r as any).message).toBe("tighten scope");
  });
  it("awaits onApprove BEFORE resolving (mode transition lands first)", async () => {
    const order: string[] = [];
    const ids: string[] = [];
    const b = new PlanApprovalBroker({
      onEscalate: (n, p, id) => ids.push(id),
      onApprove: async () => { await Promise.resolve(); order.push("setMode"); },
    });
    const p = b.requestApproval("w1", input).then(() => order.push("resolved"));
    await b.respond(ids[0], "approve");
    await p;
    expect(order).toEqual(["setMode", "resolved"]);
  });
  it("respond on an unknown id returns false and fires nothing", async () => {
    const approved: string[] = [];
    const b = new PlanApprovalBroker({ onApprove: (n) => approved.push(n) });
    expect(await b.respond("nope", "approve")).toBe(false);
    expect(approved).toEqual([]);
  });
  it("fires onRequest with the plan before escalating", () => {
    const seen: any[] = [];
    const b = new PlanApprovalBroker({ onRequest: (n, req) => seen.push({ n, plan: req.plan }) });
    b.requestApproval("w1", input);
    expect(seen).toEqual([{ n: "w1", plan: input.plan }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-plan-approval.test.ts`
Expected: FAIL — `planApproval.js` does not exist.

- [ ] **Step 3: Implement `src/swarm/planApproval.ts`**

```ts
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { RequestRegistry } from "./requests.js";
import type { PlanDecision } from "./types.js";

export interface PlanApprovalBrokerOptions {
  onRequest?: (teammate: string, req: { plan: string }) => void;
  onEscalate?: (teammate: string, plan: string, requestId: string) => void;
  onApprove?: (teammate: string) => void | Promise<void>;
}

/** Worker→leader plan-approval RPC: every plan-mode teammate's ExitPlanMode escalates here and parks
 * until the coordinator answers via respond(). Shares the bus-RPC RequestRegistry with PermissionBroker. */
export class PlanApprovalBroker {
  private onRequest?: PlanApprovalBrokerOptions["onRequest"];
  private onEscalate?: PlanApprovalBrokerOptions["onEscalate"];
  private onApprove?: PlanApprovalBrokerOptions["onApprove"];
  private requests = new RequestRegistry<PlanDecision>();
  private owners = new Map<string, string>(); // requestId → teammate (for onApprove on respond)

  constructor(opts: PlanApprovalBrokerOptions = {}) {
    this.onRequest = opts.onRequest;
    this.onEscalate = opts.onEscalate;
    this.onApprove = opts.onApprove;
  }

  /** `input` is the full ExitPlanMode tool input (keys: plan, planFilePath); echoed whole on approve. */
  requestApproval(teammate: string, input: Record<string, unknown>): Promise<PermissionResult> {
    const plan = String(input.plan ?? "");
    this.onRequest?.(teammate, { plan });
    const { id, promise } = this.requests.create();
    this.owners.set(id, teammate);
    this.onEscalate?.(teammate, plan, id);
    return promise.then((d) =>
      d.decision === "approve"
        ? { behavior: "allow", updatedInput: input }      // SDK requires updatedInput on allow
        : { behavior: "deny", message: d.feedback ?? "plan rejected" },
    );
  }

  /** Resolve a parked plan request. On approve, fire (and await) onApprove BEFORE resolving so the
   * teammate's mode transition lands before ExitPlanMode is allowed. Unknown id → false. */
  async respond(requestId: string, decision: "approve" | "reject", feedback?: string): Promise<boolean> {
    const teammate = this.owners.get(requestId);
    if (teammate === undefined) return false;
    if (decision === "approve") await this.onApprove?.(teammate);
    const ok = this.requests.resolve(requestId, { decision, feedback });
    this.owners.delete(requestId);
    return ok;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/swarm-plan-approval.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/planApproval.ts CC-to-SDK/harness/test/unit/swarm-plan-approval.test.ts
git commit -m "feat(harness): PlanApprovalBroker — worker→leader plan-approval RPC"
```

---

### Task 3: TeammateSession.setMode (the mode-transition lever)

**Files:**
- Modify: `src/swarm/teammate.ts`
- Test: `test/unit/swarm-teammate.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("TeammateSession", …)`:

```ts
  it("setMode calls the query's setPermissionMode when present, and no-ops when absent", async () => {
    const bus = new MessageBus();
    const calls: string[] = [];
    const fqWithMode = ({ prompt }: any) => {
      const gen: any = (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })();
      gen.setPermissionMode = async (m: string) => { calls.push(m); };
      return gen;
    };
    const s = new TeammateSession({ name: "w1", teamId: "t1", prompt: "x" }, bus, { query: fqWithMode });
    await s.setMode("acceptEdits");
    expect(calls).toEqual(["acceptEdits"]);
    await s.dispose();

    // fake query without setPermissionMode → setMode resolves without throwing
    const plain = new TeammateSession({ name: "w2", teamId: "t1", prompt: "x" }, bus, { query: fakeQuery });
    await expect(plain.setMode("default")).resolves.toBeUndefined();
    await plain.dispose();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: FAIL — `s.setMode is not a function`.

- [ ] **Step 3: Implement in `src/swarm/teammate.ts`** — add the method after `dispose()`:

```ts
  /** Transition the underlying query's permission mode (e.g. out of plan mode after approval).
   * Guarded so the DI fake — which has no setPermissionMode — is a safe no-op. */
  async setMode(mode: string): Promise<void> {
    const q = this.q as any;
    if (typeof q.setPermissionMode === "function") await q.setPermissionMode(mode);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/swarm-teammate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/teammate.ts CC-to-SDK/harness/test/unit/swarm-teammate.test.ts
git commit -m "feat(harness): TeammateSession.setMode — guarded setPermissionMode passthrough"
```

---

### Task 4: Runtime wiring — plan mode, ExitPlanMode routing, respondPlan, onApprove→setMode

**Files:**
- Modify: `src/swarm/runtime.ts`
- Test: `test/unit/swarm-runtime.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("SwarmRuntime", …)`. The fake query captures `options` (incl. `canUseTool`) and exposes a `setPermissionMode` spy:

```ts
  it("spawns a plan-mode teammate, escalates its ExitPlanMode plan, and approves it (mode transition + allow)", async () => {
    const modes: string[] = [];
    let cut: any;
    const fq = ({ prompt, options }: any) => {
      cut = options.canUseTool;
      const gen: any = (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })();
      gen.setPermissionMode = async (m: string) => { modes.push(m); };
      return gen;
    };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() }, permissions: { onPlanApproval: "acceptEdits" } });
    const team = rt.createTeam("a");
    rt.spawnTeammate({ teamId: team.id, name: "w1", prompt: "x", plan: true });

    const decision = cut("ExitPlanMode", { plan: "# Plan\nship it", planFilePath: "/tmp/p.md" }); // teammate presents plan
    const env = rt.checkMessages().find((m) => m.kind === "plan");
    expect(env).toBeTruthy();
    expect((env!.data as any).plan).toContain("ship it");
    const requestId = (env!.data as any).requestId;

    expect(await rt.respondPlan(requestId, "approve")).toBe(true);
    expect(modes).toEqual(["acceptEdits"]);                 // transitioned to the configured post-approval mode
    const r = await decision;
    expect(r.behavior).toBe("allow");
    expect((r as any).updatedInput).toEqual({ plan: "# Plan\nship it", planFilePath: "/tmp/p.md" });
    await rt.disposeAll();
  });
  it("sets permissionMode:'plan' only for plan-mode teammates; respondPlan on an unknown id is false", async () => {
    const seen: any[] = [];
    const fq = ({ prompt, options }: any) => { seen.push(options); return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })(); };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() } });
    const t = rt.createTeam("a");
    rt.spawnTeammate({ teamId: t.id, name: "p1", prompt: "x", plan: true });
    rt.spawnTeammate({ teamId: t.id, name: "n1", prompt: "x" });
    expect(seen[0].permissionMode).toBe("plan");
    expect(seen[1].permissionMode).toBeUndefined();
    expect(await rt.respondPlan("req-nope", "approve")).toBe(false);
    await rt.disposeAll();
  });
  it("a reject resolves the teammate's ExitPlanMode to deny with feedback", async () => {
    let cut: any;
    const fq = ({ prompt, options }: any) => { cut = options.canUseTool; return (async function* () { for await (const t of prompt) { void t; yield { type: "result", result: "r" }; } })(); };
    const rt = new SwarmRuntime({ query: fq }, { taskOptions: { dir: dir() } });
    const t = rt.createTeam("a");
    rt.spawnTeammate({ teamId: t.id, name: "w1", prompt: "x", plan: true });
    const decision = cut("ExitPlanMode", { plan: "bad plan" });
    const id = (rt.checkMessages().find((m) => m.kind === "plan")!.data as any).requestId;
    await rt.respondPlan(id, "reject", "needs tests");
    const r = await decision;
    expect(r.behavior).toBe("deny");
    expect((r as any).message).toBe("needs tests");
    await rt.disposeAll();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: FAIL — `rt.respondPlan is not a function` / no `plan` envelope.

- [ ] **Step 3: Implement in `src/swarm/runtime.ts`**

Add imports near the top (after the `PermissionBroker` import):

```ts
import { PlanApprovalBroker } from "./planApproval.js";
import type { Message, MessageKind, PostApprovalMode, QueryFn, SwarmOptions, TeammateSpec } from "./types.js";
```
(extend the existing `types.js` import to include `PostApprovalMode`.)

Add fields next to `private broker: PermissionBroker;`:

```ts
  private planBroker: PlanApprovalBroker;
  private postApprovalMode: PostApprovalMode;
```

In the constructor, after the `this.broker = new PermissionBroker({…})` block, build the plan broker:

```ts
    this.postApprovalMode = opts.permissions?.onPlanApproval ?? "default";
    this.planBroker = new PlanApprovalBroker({
      onRequest: (teammate, req) => this.onPermissionRequest?.(teammate, req),
      onEscalate: (teammate, plan, requestId) => {
        this.bus.send("coordinator", {
          from: teammate, to: "coordinator", kind: "plan",
          body: plan,
          data: { requestId, teammate, plan },
          ts: new Date().toISOString(),
        });
      },
      onApprove: async (name) => { await this.sessions.get(name)?.setMode(this.postApprovalMode); },
    });
```

In `spawnTeammate`, set plan mode and route `ExitPlanMode`. Replace the `const options` block:

```ts
    const options: Record<string, unknown> = {
      mcpServers: { "cc-tasks": createTaskMcpServer(teammateStore) },
      disallowedTools: [...NATIVE_TASK_TOOLS], // shared cc-tasks store is authoritative, not native per-session tasks
      canUseTool: (tool: string, input: Record<string, unknown>) =>
        spec.plan && tool === "ExitPlanMode"
          ? this.planBroker.requestApproval(spec.name, input)
          : this.broker.decide(spec.name, tool, input),
    };
    if (spec.plan) options.permissionMode = "plan"; // teammate plans first; ExitPlanMode → coordinator approval (A2c)
    if (spec.agent) options.model = spec.agent; // per-teammate model (30.9)
```

Add `respondPlan` next to `respondPermission`:

```ts
  async respondPlan(requestId: string, decision: "approve" | "reject", feedback?: string): Promise<boolean> {
    return this.planBroker.respond(requestId, decision, feedback);
  }
```

- [ ] **Step 4: Run test + the existing runtime suite to verify no regressions**

Run: `npx vitest run test/unit/swarm-runtime.test.ts`
Expected: PASS (new + all prior runtime tests).

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/runtime.ts CC-to-SDK/harness/test/unit/swarm-runtime.test.ts
git commit -m "feat(harness): wire plan-mode teammates + ExitPlanMode escalation + respondPlan into the runtime"
```

---

### Task 5: ApprovePlan cc-swarm tool

**Files:**
- Modify: `src/swarm/server.ts`
- Test: `test/unit/swarm-server.test.ts`

- [ ] **Step 1: Update the failing tests** — in `test/unit/swarm-server.test.ts`, change the tool-count test and add an `ApprovePlan` case:

```ts
  it("exposes the eight tools", () => {
    expect(Object.keys(toolMap(newRuntime())).sort())
      .toEqual(["ApprovePlan", "CheckMessages", "RespondPermission", "SendMessage", "ShutdownTeammate", "TeamCreate", "TeamDelete", "spawnTeammate"]);
  });
  it("ApprovePlan errors on an unknown request id", async () => {
    const t = toolMap(newRuntime());
    const bad = await t.ApprovePlan.handler({ requestId: "nope", decision: "approve" }, {});
    expect(bad.isError).toBe(true);
  });
```
(Replace the existing `"exposes the seven tools"` test with the eight-tools version above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: FAIL — only seven tools; `ApprovePlan` undefined.

- [ ] **Step 3: Implement in `src/swarm/server.ts`**

Extend the imports from `./types.js` to include `approvePlanShape`:

```ts
import {
  teamCreateShape, teamDeleteShape, spawnTeammateShape, sendMessageShape, checkMessagesShape,
  respondPermissionShape, shutdownTeammateShape, approvePlanShape,
} from "./types.js";
```

Add the tool to the array returned by `buildSwarmTools` (after `ShutdownTeammate`):

```ts
    tool("ApprovePlan", "Approve or reject a teammate's escalated plan by id (approve → it implements; reject → it revises with your feedback).", approvePlanShape, async (a) => {
      return (await runtime.respondPlan(a.requestId, a.decision, a.feedback))
        ? ok({ resolved: a.requestId, decision: a.decision })
        : fail(`unknown request ${a.requestId}`);
    }),
```

Update the docstring on `buildSwarmTools`/`createSwarmMcpServer` if it says "five"/"seven" tools — set it to "eight".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/swarm-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/server.ts CC-to-SDK/harness/test/unit/swarm-server.test.ts
git commit -m "feat(harness): ApprovePlan cc-swarm tool"
```

---

### Task 6: Coordinator whitelist + persona

**Files:**
- Modify: `src/swarm/coordinator.ts`
- Test: `test/unit/swarm-coordinator.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("coordinator persona", …)`:

```ts
  it("whitelist includes ApprovePlan and the persona explains plan review", () => {
    expect(coordinatorTools()).toContain("mcp__cc-swarm__ApprovePlan");
    expect(COORDINATOR_PROMPT).toMatch(/plan/i);
    expect(COORDINATOR_PROMPT).toMatch(/ApprovePlan/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: FAIL — `ApprovePlan` not in whitelist; persona lacks the text.

- [ ] **Step 3: Implement in `src/swarm/coordinator.ts`**

Add the tool to `coordinatorTools()` (in the `cc-swarm` group):

```ts
    "mcp__cc-swarm__RespondPermission", "mcp__cc-swarm__ShutdownTeammate", "mcp__cc-swarm__ApprovePlan",
```

Append a sentence to `COORDINATOR_PROMPT` (add as a new array element before `.join(" ")`):

```ts
  "When a teammate sends a plan (kind 'plan'), review it and respond with ApprovePlan — approve to let it",
  "implement, or reject with feedback so it revises.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/swarm-coordinator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/harness/src/swarm/coordinator.ts CC-to-SDK/harness/test/unit/swarm-coordinator.test.ts
git commit -m "feat(harness): coordinator whitelist + persona for plan approval"
```

---

### Task 7: Live end-to-end test (real SDK, gated on ANTHROPIC_API_KEY)

**Files:**
- Modify: `test/live/swarm.test.ts`

- [ ] **Step 1: Write the live test** — append inside the `live("live swarm substrate (real SDK)", …)` block. It drives the full handshake: the teammate parks on `ExitPlanMode` (so we poll the inbox rather than awaiting `settled()` first), we approve as coordinator, then it executes.

```ts
  it("a plan-mode teammate's plan is approved by the coordinator, then it executes (full handshake)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swarm-plan-live-"));
    const h = createHarness({ swarm: true, cwd: dir, maxTurns: 8 }); // post-approval default "default"; cc-tasks is allowlisted
    const rt = h.swarm!;
    const team = rt.createTeam("alpha");
    const s = rt.spawnTeammate({
      teamId: team.id,
      name: "w1",
      plan: true,
      prompt:
        "You are in plan mode. Produce a one-line plan: 'Plan: create the PLAN_OK task'. " +
        "Call the ExitPlanMode tool to present it. After it is approved, create a task with subject " +
        "exactly 'PLAN_OK' using the TaskCreate tool from the cc-tasks server. Then stop.",
    });

    // The teammate parks inside ExitPlanMode → canUseTool, so its plan lands in the coordinator inbox
    // before its turn settles. Poll for it.
    const deadline = Date.now() + 45_000;
    let plan: any;
    while (Date.now() < deadline && !plan) {
      plan = rt.checkMessages().find((m) => m.kind === "plan");
      if (!plan) await new Promise((r) => setTimeout(r, 300));
    }
    expect(plan, "no plan envelope arrived").toBeTruthy();
    expect(String((plan.data as any).plan)).toMatch(/PLAN_OK|Plan/i);

    expect(await rt.respondPlan((plan.data as any).requestId, "approve")).toBe(true);
    await s.settled(); // turn resumes after approval → teammate creates the task

    const tasks = await rt.tasks.list();
    expect(tasks.some((t) => /PLAN_OK/i.test(t.subject))).toBe(true);
    await rt.disposeAll();
  }, 90_000);
```

- [ ] **Step 2: Run the live test**

Run: `node --env-file=../.env node_modules/.bin/vitest run test/live/swarm.test.ts` (or `npm run test:live` with the key exported)
Expected: PASS — proves ExitPlanMode interception → escalation → approval → mode transition → execution against the real SDK. If the teammate fails to call ExitPlanMode or to create the task within `maxTurns`, treat as a real finding (inspect, adjust the prompt/mode), not a flake to silence.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/harness/test/live/swarm.test.ts
git commit -m "test(harness): live end-to-end plan-approval handshake"
```

---

### Final verification (after all tasks)

- [ ] Run the full unit suite: `npm run test:unit` — expect all green (prior 128 + the new A2c tests).
- [ ] `npm run typecheck` — clean.
- [ ] `git status` — clean tree, no scratch files, no `.env`.
- [ ] Then invoke **superpowers:finishing-a-development-branch**.

**Spec-coverage check:** Task 1 ⇒ §4 types/config + §8 surface; Task 2 ⇒ §5 broker; Task 3 ⇒ §6 mode lever; Task 4 ⇒ §3 data flow + §4 runtime + §6 governance; Task 5 ⇒ §7 tool; Task 6 ⇒ §7 whitelist/persona; Task 7 ⇒ §9 live. Success criteria §10 are exercised by Tasks 4 (escalate/approve/reject + configurable mode) and 7 (end-to-end).

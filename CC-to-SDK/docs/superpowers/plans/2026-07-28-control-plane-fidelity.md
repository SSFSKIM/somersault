# Control-Plane Fidelity (Goal B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One decision park with three kinds (`permission | question | plan`) over the shipped A2b machinery, plus the background-task surface — so `AskUserQuestion`, `ExitPlanMode`, Ctrl+B/background shells, and subagent attribution all work in the foreground REPL **and** over `ccx attach`.

**Architecture:** Generalize `PendingPermissions` → `PendingDecisions` (kind-discriminated), make the gate route `AskUserQuestion`/`ExitPlanMode` to their kinds and map structured answers back to the SDK (`updatedInput.answers`/`response`; plan deny-with-feedback), grow the host wire (`decision`/`decision_settled`/`tasks_changed`/`task` events; structured `answer`; `tasks`/`background`/`stop_task` ops), give the `Session` a persistent frame listener so the host sees system frames between turns (mode sync + tasks), and add two dialogs + one panel to the REPL. Spec: `CC-to-SDK/docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md` (rev 2).

**Tech Stack:** TypeScript ESM, zod/v4 (wire schemas), Ink + ink-testing-library (TUI), vitest, the Claude Agent SDK 0.3.211.

## Global Constraints

(verbatim from the spec — every task's requirements include these)

- **We never fabricate an answer** — no AFK auto-resolve, no default option, in any mode.
- Parking policy unchanged: detached hosts park every kind indefinitely; a non-detached host at `connectionCount() === 0` denies. Kind-specific bare-deny copy is composed in the **gate**: permission → `` `User denied ${toolName}` `` · question → `"No user is available to answer."` · plan → `"User rejected the plan. Continue planning."`
- Wire rename with a **read-side alias**: the client ingests legacy `permission`/`permission_settled` frames as `decision(kind:"permission")`; the `permission` answer keeps the **flat legacy field shape** (`{op:"answer", toolUseID, decision, by}`). Old client × new host is unsupported (accepted).
- The `approve_accept_edits` upgrade triggers on **observing the CLI's post-approval `status` frame**, never on answer release; turn-end is the belt. Host mode = ONE field, last-write-wins between status frames and own-setter resolutions; every write emits `state`.
- New panel names: `BgTasksPanel.tsx`, state field `bgTasks`, command **`/bg`** — `/tasks` is deliberately NOT used (collides conceptually with the existing `TaskPanel.tsx` checklist).
- `waitingFor` becomes `` `${kind}:${toolName}` `` (doperpowers scripts verified display-only on this string).
- Multi-select answers join with `", "`. Free-text "Other" goes to `response` (probe 65E's proven channel); that question gets no `answers` entry.
- The interrupt/abort-path `decision_settled(by:"system")` emit is **new wiring** (today `pending.ts` abort-settles silently).
- Daemon (`src/daemon/*`) files untouched — **but** the daemon routes through the shared `createPermissionGate` (`supervisor.ts:397`), so its deny copy and the AskUserQuestion/ExitPlanMode never-allowlist rule drift with the gate rewrite. That drift is **accepted, not a freeze violation** (plan-review I3). Swarm untouched.
- Harness conventions: dense hand-style (no Prettier), ESM imports end in `.js`, DI-by-deps, TDD, keyless live-gating (`const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip`). All commands run from `CC-to-SDK/harness/`. Commit per task, no Co-Authored-By lines.
- `test/tui/` discipline: await a tick (or `waitFor`/`pressUntil` from `test/tui/helpers`) BEFORE writing keys.
- The public barrel `src/index.ts` is pinned by `test/unit/index.test.ts` — new public exports must be added to both.

## File Structure (locked decomposition)

```
src/permissions/types.ts      MODIFY  DecisionKind, DecisionOutcome, kind+attribution on PermissionRequest
src/permissions/pending.ts    MODIFY  PendingDecisions (renamed class; PendingDecision entry; onAutoSettle hook; legacy aliases)
src/permissions/gate.ts       MODIFY  kind routing + outcome→PermissionResult mapping (answers/response/feedback)
src/host/wire.ts              MODIFY  decision/decision_settled/tasks_changed/task events
src/host/ops.ts               MODIFY  structured answer op; tasks/background/stop_task ops; HostStatus.permissionMode
src/host/server.ts            MODIFY  dispatch for the new ops; answer outcome assembly
src/host/host.ts              MODIFY  answer kind-validation; frame subscription; bg tasks; mode sync; plan upgrade; attribution
src/session/session.ts        MODIFY  onFrame(cb) persistent listener (the ONE session-layer change)
src/session/chatSession.ts    MODIFY  DecisionFeed (renames PermissionFeed) + BgTasks mixin + guards
src/config/resolveOptions.ts  MODIFY  export resolvedPermissionMode(config)
src/client/remote.ts          MODIFY  answerDecision + tasksOp/backgroundOp/stopTaskOp
src/client/chatAdapter.ts     MODIFY  decision routing (with legacy alias), DecisionFeed + BgTasks impl
src/tui/useChat.ts            MODIFY  PendingDecision queue, resolveDecision, mode sync, ladder+plan, bgTasks, task notices
src/tui/ChatApp.tsx           MODIFY  dialog dispatcher, Ctrl+B, BgTasksPanel mount
src/tui/QuestionDialog.tsx    CREATE  AskUserQuestion dialog (sequential, multiSelect, Other)
src/tui/PlanDialog.tsx        CREATE  ExitPlanMode dialog (markdown plan, 3 choices, feedback input)
src/tui/BgTasksPanel.tsx      CREATE  background-task list panel
src/tui/ChatStatusBar.tsx     MODIFY  ⚙ N bg count (replaces subagentActive boolean)
src/tui/commands.ts           MODIFY  /bg entry
src/index.ts                  MODIFY  new public exports
```

Dependency order: T1 (types+store) → T2 (gate) → T3 (host answer/events) → T4 (session frames + bg surface) → T5 (mode sync + attribution) → T6 (client) → T7 (useChat) → T8/T9/T10 (dialogs/panel — independent of each other, sequential for worktree safety) → T11 (docs) → T12 (verification).

---

### Task 1: Decision types + `PendingDecisions` generalization

**Files:**
- Modify: `src/permissions/types.ts`
- Modify: `src/permissions/pending.ts`
- Modify: `src/index.ts` (+ its pin test `test/unit/index.test.ts`)
- Test: `test/unit/permissions-decisions.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these EXACT names):
  - `type DecisionKind = "permission" | "question" | "plan"`
  - `type DecisionOutcome = PermissionDecision | { kind: "question_answer"; answers: Record<string, string>; response?: string } | { kind: "plan_approve"; acceptEdits: boolean } | { kind: "plan_reject"; feedback?: string }`
  - `PermissionRequest` gains `kind?: DecisionKind; parentToolUseID?: string; subagentType?: string`
  - `PermissionBroker.request(req): Promise<DecisionOutcome>` (widened return — existing 3-way implementers still satisfy it)
  - `interface PendingDecision` (the old `PendingEntry` + `kind: DecisionKind` + `parentToolUseID?`/`subagentType?`)
  - `class PendingDecisions` with the old lifecycle (`brokerFor/respond/list/denyAllForSession/denyAll`) where `respond(toolUseID, outcome: DecisionOutcome): boolean`, plus a new constructor opt `onAutoSettle?: (entry: PendingDecision) => void` fired when the **timer or abort** settles (NOT respond/denyAll)
  - Back-compat aliases so the frozen daemon keeps compiling untouched: `export type PendingEntry = PendingDecision;` `export const PendingPermissions = PendingDecisions;` (+ `export type PendingPermissions = PendingDecisions;`)

- [ ] **Step 1: Write the failing tests**

`test/unit/permissions-decisions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PendingDecisions } from "../../src/permissions/pending.js";
import type { DecisionOutcome } from "../../src/permissions/types.js";

const req = (id: string, kind?: "permission" | "question" | "plan", extra: Record<string, unknown> = {}) => ({
  toolName: kind === "question" ? "AskUserQuestion" : kind === "plan" ? "ExitPlanMode" : "Bash",
  input: {}, toolUseID: id, signal: new AbortController().signal, kind, ...extra,
} as any);

describe("PendingDecisions", () => {
  it("defaults kind to permission and carries attribution fields onto the entry", async () => {
    const p = new PendingDecisions({ expireAfterMs: "never" });
    void p.brokerFor("s").request(req("t1", undefined, { parentToolUseID: "agent-1", subagentType: "code-reviewer" }));
    await Promise.resolve();
    const [e] = p.list();
    expect(e.kind).toBe("permission");
    expect(e.parentToolUseID).toBe("agent-1");
    expect(e.subagentType).toBe("code-reviewer");
  });

  it("parks a question and resolves it with a question_answer outcome", async () => {
    const p = new PendingDecisions({ expireAfterMs: "never" });
    const d = p.brokerFor("s").request(req("q1", "question"));
    await Promise.resolve();
    expect(p.list()[0].kind).toBe("question");
    const out: DecisionOutcome = { kind: "question_answer", answers: { "red or blue?": "blue" } };
    expect(p.respond("q1", out)).toBe(true);
    await expect(d).resolves.toEqual(out);
  });

  it("parks a plan and resolves plan_approve / plan_reject", async () => {
    const p = new PendingDecisions({ expireAfterMs: "never" });
    const d1 = p.brokerFor("s").request(req("p1", "plan"));
    await Promise.resolve();
    p.respond("p1", { kind: "plan_approve", acceptEdits: true });
    await expect(d1).resolves.toEqual({ kind: "plan_approve", acceptEdits: true });
    const d2 = p.brokerFor("s").request(req("p2", "plan"));
    await Promise.resolve();
    p.respond("p2", { kind: "plan_reject", feedback: "add tests" });
    await expect(d2).resolves.toEqual({ kind: "plan_reject", feedback: "add tests" });
  });

  it("fires onAutoSettle on ABORT settle (with the entry), not on respond/denyAll", async () => {
    const auto = vi.fn();
    const p = new PendingDecisions({ expireAfterMs: "never", onAutoSettle: auto });
    const ac = new AbortController();
    const d = p.brokerFor("s").request(req("a1", "question", { signal: ac.signal }));
    await Promise.resolve();
    ac.abort();
    await expect(d).resolves.toEqual({ kind: "deny" });
    expect(auto).toHaveBeenCalledTimes(1);
    expect(auto.mock.calls[0][0].toolUseID).toBe("a1");
    // respond path must NOT fire it
    void p.brokerFor("s").request(req("a2"));
    await Promise.resolve();
    p.respond("a2", { kind: "deny" });
    // denyAll path must NOT fire it (teardown emits are the host's job, spec: settleParkedForSystem)
    void p.brokerFor("s").request(req("a3"));
    await Promise.resolve();
    p.denyAll();
    expect(auto).toHaveBeenCalledTimes(1);
  });

  it("fires onAutoSettle on TIMER expiry settle", async () => {
    const auto = vi.fn();
    let fire: () => void = () => {};
    const p = new PendingDecisions({ expireAfterMs: 10, onAutoSettle: auto, schedule: (fn) => { fire = fn; return () => {}; } });
    const d = p.brokerFor("s").request(req("t1"));
    await Promise.resolve();
    fire();
    await expect(d).resolves.toEqual({ kind: "deny" });
    expect(auto).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy aliases importable (frozen daemon compiles unchanged)", async () => {
    const mod = await import("../../src/permissions/pending.js");
    expect(mod.PendingPermissions).toBe(mod.PendingDecisions);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/permissions-decisions.test.ts`
Expected: FAIL — `PendingDecisions` is not exported.

- [ ] **Step 3: Implement the types**

`src/permissions/types.ts` — replace the whole file body below the header comment:

```ts
// harness/src/permissions/types.ts
export type PermissionDecision =
  | { kind: "allow_once" }
  | { kind: "allow_always" }   // remembered for the session, by tool name
  | { kind: "deny" };

/** Which dialog a parked decision needs (spec Goal B): permission = 3-way, question = AskUserQuestion,
 *  plan = ExitPlanMode. The gate routes by toolName; everything else in the park lifecycle is kind-blind. */
export type DecisionKind = "permission" | "question" | "plan";

/** Everything a human (or system teardown) can answer a parked decision with. The 3-way
 *  PermissionDecision is the `permission` family AND the universal system deny — teardown settles every
 *  kind with {kind:"deny"}, and the gate composes the kind-specific message. */
export type DecisionOutcome =
  | PermissionDecision
  | { kind: "question_answer"; answers: Record<string, string>; response?: string }  // response = free-text "Other" (probe 65E)
  | { kind: "plan_approve"; acceptEdits: boolean }
  | { kind: "plan_reject"; feedback?: string };

/** What the broker is asked to decide. UI hints (title/displayName/description) are often ABSENT headlessly
 *  (the bridge that renders them is claude.ai-coupled) — consumers MUST render from toolName + input alone. */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  /** Absent = "permission" (every pre-Goal-B caller). Set by the gate's toolName routing. */
  kind?: DecisionKind;
  /** Subagent attribution, stamped by the host's correlation map (best-effort; absent = unattributed). */
  parentToolUseID?: string;
  subagentType?: string;
  title?: string;
  displayName?: string;
  description?: string;
  signal: AbortSignal;
}

export interface PermissionBroker {
  request(req: PermissionRequest): Promise<DecisionOutcome>;
}
```

- [ ] **Step 4: Implement the store**

`src/permissions/pending.ts` — the class generalizes in place. Exact changes:

1. Rename the interface and add the new fields:

```ts
/** A parked decision on the wire — the serializable view of a PermissionRequest (no AbortSignal). */
export interface PendingDecision {
  sessionId: string;
  toolUseID: string;
  toolName: string;
  kind: DecisionKind;
  input: Record<string, unknown>;
  parentToolUseID?: string;
  subagentType?: string;
  title?: string;
  displayName?: string;
  description?: string;
  createdAt: number;
}
```

2. Opts gain the hook (doc why: spec — the abort/timer paths settle straight into the map, and the host must still tell followers the decision is gone):

```ts
export interface PendingDecisionsOpts {
  expireAfterMs: ExpiryPolicy;                           // REQUIRED — no default, deliberately
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Fired when the TIMER or the request's ABORT signal settles a park (always with {kind:"deny"}) —
   *  never on respond()/denyAll(): those callers own their own emits. This is how the host learns to
   *  emit decision_settled(by:"system") for an SDK-side abort (spec: "new wiring, not inherited"). */
  onAutoSettle?: (entry: PendingDecision) => void;
}
```

3. Rename the class `PendingPermissions` → `PendingDecisions`; the map value type's `resolve` becomes `(d: DecisionOutcome) => void`; `park` builds the entry with `kind: req.kind ?? "permission"` and copies `parentToolUseID`/`subagentType`; the timer and abort arms route through a private `autoSettle`:

```ts
private autoSettle(toolUseID: string): void {
  const entry = this.pending.get(toolUseID)?.entry;
  if (this.settle(toolUseID, { kind: "deny" }) && entry) this.onAutoSettle?.(entry);
}
```

with `const cancelTimer = … this.schedule(() => this.autoSettle(req.toolUseID), …)` and `const onAbort = () => this.autoSettle(req.toolUseID);`. `settle`'s signature becomes `settle(toolUseID: string, decision: DecisionOutcome)`; `respond(toolUseID: string, decision: DecisionOutcome): boolean` likewise.

4. Bottom-of-file legacy aliases (the frozen daemon and every existing import keep compiling — spec: daemon import-alias touches only, and here they are zero-touch):

```ts
/** Legacy names (pre-Goal-B): the daemon and older tests import these — same class, same entry. */
export type PendingEntry = PendingDecision;
export const PendingPermissions = PendingDecisions;
export type PendingPermissions = PendingDecisions;
export type PendingPermissionsOpts = PendingDecisionsOpts;
```

5. Update the imports at the top: `import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest } from "./types.js";` (drop `PermissionDecision` if now unused).

- [ ] **Step 5: Public barrel**

In `src/index.ts`, next to the existing `PermissionDecision` export, add `DecisionKind`, `DecisionOutcome`, `PendingDecision`, `PendingDecisions` to the exported surface, and add the same names to the pinned list in `test/unit/index.test.ts`.

- [ ] **Step 6: Sweep the now-required `kind` into typed entry literals**

`PendingDecision.kind` is required and `PendingEntry` aliases it, so existing typed literals without `kind` fail `npm run typecheck` (tsconfig includes `test/`). Add `kind: "permission"` to every `PendingEntry` object literal in: `test/tui/useChat.test.tsx` (6 literals), `test/tui/chat.test.tsx`, `test/unit/index.test.ts` — mechanical, no behavior change (plan-review C1a).

- [ ] **Step 7: Run the suite green**

Run: `npx vitest run test/unit/permissions-decisions.test.ts test/unit/index.test.ts test/unit/host-park.test.ts test/unit/daemon-permissions.test.ts && npm run typecheck`
Expected: PASS (the park/daemon suites prove the aliases really are zero-touch on daemon files).

- [ ] **Step 8: Commit**

```bash
git add src/permissions test/unit/permissions-decisions.test.ts test/unit/index.test.ts src/index.ts test/tui/useChat.test.tsx test/tui/chat.test.tsx
git commit -m "feat(gb1): decision kinds + PendingDecisions generalization with onAutoSettle hook"
```

---

### Task 2: Gate — kind routing + outcome resolution

**Files:**
- Modify: `src/permissions/gate.ts`
- Test: `test/unit/permission-gate-decisions.test.ts` (create)

**Interfaces:**
- Consumes: `DecisionKind`, `DecisionOutcome`, widened `PermissionBroker` (Task 1).
- Produces: `export function routeDecisionKind(toolName: string): DecisionKind` and the gate behavior below. `createPermissionGate(broker)` signature unchanged (resolveOptions keeps working untouched).

- [ ] **Step 1: Write the failing tests**

`test/unit/permission-gate-decisions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPermissionGate, routeDecisionKind } from "../../src/permissions/gate.js";
import type { DecisionOutcome, PermissionRequest } from "../../src/permissions/types.js";

const gateWith = (outcome: DecisionOutcome, seen: PermissionRequest[] = []) =>
  createPermissionGate({ request: async (req) => { seen.push(req); return outcome; } });
const opts = { signal: new AbortController().signal, toolUseID: "t1" };

describe("routeDecisionKind", () => {
  it("routes the two special tools and defaults the rest", () => {
    expect(routeDecisionKind("AskUserQuestion")).toBe("question");
    expect(routeDecisionKind("ExitPlanMode")).toBe("plan");
    expect(routeDecisionKind("Bash")).toBe("permission");
  });
});

describe("gate outcome mapping", () => {
  it("stamps kind on the broker request", async () => {
    const seen: PermissionRequest[] = [];
    await gateWith({ kind: "question_answer", answers: {} }, seen)("AskUserQuestion", { questions: [] }, opts);
    expect(seen[0].kind).toBe("question");
  });

  it("question_answer → allow with answers (+response) merged into updatedInput (probe 65)", async () => {
    const input = { questions: [{ question: "red or blue?" }] };
    const r = await gateWith({ kind: "question_answer", answers: { "red or blue?": "blue" }, response: "green actually" })("AskUserQuestion", input, opts);
    expect(r).toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "red or blue?": "blue" }, response: "green actually" } });
  });

  it("question_answer without response omits the response key entirely", async () => {
    const r = await gateWith({ kind: "question_answer", answers: { q: "a" } })("AskUserQuestion", {}, opts) as any;
    expect("response" in r.updatedInput).toBe(false);
  });

  it("plan_approve → allow with input unchanged (the CLI flips the mode itself, probe 66)", async () => {
    const input = { plan: "# The plan" };
    const r = await gateWith({ kind: "plan_approve", acceptEdits: true })("ExitPlanMode", input, opts);
    expect(r).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("plan_reject → deny carrying the feedback verbatim; empty feedback gets the default copy", async () => {
    const r1 = await gateWith({ kind: "plan_reject", feedback: "also plan a README" })("ExitPlanMode", {}, opts);
    expect(r1).toEqual({ behavior: "deny", message: "also plan a README", interrupt: undefined });
    const r2 = await gateWith({ kind: "plan_reject", feedback: "  " })("ExitPlanMode", {}, opts) as any;
    expect(r2.message).toBe("User rejected the plan. Continue planning.");
  });

  it("bare deny gets kind-specific copy (spec: composed in the gate)", async () => {
    expect(((await gateWith({ kind: "deny" })("AskUserQuestion", {}, opts)) as any).message).toBe("No user is available to answer.");
    expect(((await gateWith({ kind: "deny" })("ExitPlanMode", {}, opts)) as any).message).toBe("User rejected the plan. Continue planning.");
    expect(((await gateWith({ kind: "deny" })("Bash", {}, opts)) as any).message).toBe("User denied Bash");
  });

  it("allow_always allowlists ONLY the permission kind — a question is asked every time", async () => {
    const seen: PermissionRequest[] = [];
    const gate = createPermissionGate({ request: async (req) => { seen.push(req); return req.kind === "question" ? { kind: "question_answer", answers: {} } : { kind: "allow_always" }; } });
    await gate("Bash", { command: "ls" }, opts);
    await gate("Bash", { command: "ls" }, { ...opts, toolUseID: "t2" });      // allowlisted → no re-consult
    await gate("AskUserQuestion", {}, { ...opts, toolUseID: "t3" });
    await gate("AskUserQuestion", {}, { ...opts, toolUseID: "t4" });          // question NEVER allowlists
    expect(seen.map((r) => r.toolUseID)).toEqual(["t1", "t3", "t4"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/permission-gate-decisions.test.ts`
Expected: FAIL — `routeDecisionKind` not exported.

- [ ] **Step 3: Implement**

`src/permissions/gate.ts` — full new body (keeps the existing header comment style):

```ts
// harness/src/permissions/gate.ts
import type { DecisionKind, DecisionOutcome, PermissionBroker, PermissionRequest } from "./types.js";

// The SDK CanUseTool shape (sdk.d.ts): (toolName, input, options) => Promise<PermissionResult>.
type CanUseToolOptions = { signal: AbortSignal; toolUseID: string; title?: string; displayName?: string; description?: string; [k: string]: unknown };
type PermissionResult = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string; interrupt?: boolean };
export type CanUseTool = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;

/** Which dialog a tool call needs. AskUserQuestion is ALWAYS routed (probe 65: it consults canUseTool in
 *  every mode, no ask rules needed); ExitPlanMode arrives under plan mode (probe 66). Everything else is
 *  the classic 3-way permission. */
export function routeDecisionKind(toolName: string): DecisionKind {
  return toolName === "AskUserQuestion" ? "question" : toolName === "ExitPlanMode" ? "plan" : "permission";
}

/** Kind-specific copy for a bare {kind:"deny"} (system teardown, zero-connection rule, broker failure).
 *  Composed HERE because the gate owns the deny message and knows the routing (spec, error-handling §). */
function denyMessage(kind: DecisionKind, toolName: string): string {
  return kind === "question" ? "No user is available to answer."
    : kind === "plan" ? "User rejected the plan. Continue planning."
    : `User denied ${toolName}`;
}

// Resolve the broker, but lose the race to an abort (turn interrupted) → deny. Pre-aborted → deny immediately.
function requestOrAbort(broker: PermissionBroker, req: PermissionRequest, signal: AbortSignal): Promise<DecisionOutcome> {
  if (signal?.aborted) return Promise.resolve({ kind: "deny" });
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve({ kind: "deny" }), { once: true });
    broker.request(req).then((d) => resolve(d), () => resolve({ kind: "deny" }));
  });
}

/** Build the SDK canUseTool from an interactive broker. Owns the per-session "always" allowlist —
 *  PERMISSION kind only: a question must be asked every time, a plan approved every time. */
export function createPermissionGate(broker: PermissionBroker): CanUseTool {
  const allowed = new Set<string>();
  return async (toolName, input, options) => {
    const kind = routeDecisionKind(toolName);
    if (kind === "permission" && allowed.has(toolName)) return { behavior: "allow", updatedInput: input };
    const req: PermissionRequest = { toolName, input, toolUseID: options.toolUseID, kind, title: options.title, displayName: options.displayName, description: options.description, signal: options.signal };
    const d = await requestOrAbort(broker, req, options.signal);
    if (d.kind === "deny") return { behavior: "deny", message: denyMessage(kind, toolName), interrupt: options.signal?.aborted || undefined };
    if (d.kind === "question_answer") return { behavior: "allow", updatedInput: { ...input, answers: d.answers, ...(d.response ? { response: d.response } : {}) } };
    if (d.kind === "plan_reject") return { behavior: "deny", message: d.feedback?.trim() || "User rejected the plan. Continue planning.", interrupt: options.signal?.aborted || undefined };
    if (d.kind === "plan_approve") return { behavior: "allow", updatedInput: input };
    if (d.kind === "allow_always") allowed.add(toolName);
    return { behavior: "allow", updatedInput: input };
  };
}
```

- [ ] **Step 4: Run green**

Run: `npx vitest run test/unit/permission-gate-decisions.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/permissions/gate.ts test/unit/permission-gate-decisions.test.ts
git commit -m "feat(gb2): gate routes AskUserQuestion/ExitPlanMode kinds and maps structured outcomes"
```

---

### Task 3: Host — decision events, answer validation, system-settle emits

**Files:**
- Modify: `src/host/wire.ts`, `src/host/ops.ts`, `src/host/server.ts`, `src/host/host.ts`
- Test: `test/unit/host-park.test.ts` (extend), `test/unit/host-ops.test.ts` (extend), `test/unit/host-teardown-quartet.test.ts` (create — the parameterized quartet)

**Interfaces:**
- Consumes: `PendingDecision`, `DecisionOutcome`, `PendingDecisions` + `onAutoSettle` (T1); gate stamps `kind` on requests (T2).
- Produces (client + TUI tasks rely on):
  - `HostEvent` variants: `{ kind: "decision"; entry: PendingDecision }` · `{ kind: "decision_settled"; toolUseID: string; by: string; decision: string }` (the `permission`/`permission_settled` variants are REMOVED host-side — the read alias lives in the client, Task 6)
  - `answer` wire op: `{ op: "answer", toolUseID, by, decision?: "allow_once"|"allow_always"|"deny", answer?: StructuredAnswer }` where `StructuredAnswer = { kind: "question_answer", answers, response? } | { kind: "plan_approve", acceptEdits } | { kind: "plan_reject", feedback? }` — exactly one of `decision`/`answer` must be present
  - `SessionHost.answer(toolUseID, outcome: DecisionOutcome, by)` — kind-validated; mismatch → `{ ok: false, error: "kind mismatch: <entryKind> park cannot take <outcomeKind>" }` with the park intact
  - `status().waitingFor === \`${kind}:${toolName}\``
  - `SessionHost.onPlanApprove` internal flag `planUpgradePending` set when a `plan_approve` with `acceptEdits: true` settles (consumed in Task 5 — this task only sets it)

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/host-park.test.ts` (it already builds hosts with fake `HostSession`s and a broker-driving pattern — follow the file's existing fixtures; new cases):

```ts
it("parks a question with waitingFor question:AskUserQuestion and settles via a structured answer", async () => {
  // Drive host.broker().request({... toolName: "AskUserQuestion", kind: "question" ...}) on a detached host.
  // Assert: status().waitingFor === "question:AskUserQuestion"; followers got {kind:"decision", entry:{kind:"question"}}.
  // Then host.answer(id, { kind: "question_answer", answers: { q: "a" } }, "me") → { ok: true };
  // the broker promise resolves to that outcome; followers got {kind:"decision_settled", decision:"question_answer", by:"me"}.
});

it("refuses a kind-mismatched answer and keeps the park", async () => {
  // Park kind:"question"; answer with { kind: "allow_once" } → { ok: false, error: /kind mismatch/ };
  // pending() still lists the entry; the broker promise is still unsettled.
  // Then a correct question_answer still lands → ok:true.
});

it("plan_approve with acceptEdits sets planUpgradePending (consumed by the status-frame handler, Task 5)", async () => {
  // Park kind:"plan"; answer { kind: "plan_approve", acceptEdits: true } → ok. Assert the host exposes the
  // pending flag (make it internal but readable for tests via (host as any).planUpgradePending === true).
  // acceptEdits:false must NOT set it.
});

it("an SDK-side abort emits decision_settled by:system (the onAutoSettle wiring — NEW, was silent)", async () => {
  // Park via broker with a controllable AbortController; abort it (do NOT call host.interrupt()).
  // Assert a follower received {kind:"decision_settled", toolUseID, by:"system", decision:"deny"}.
});
```

Write them as real tests using the file's existing helpers (fake sessions, `collect(host)` follower pattern — mirror the adjacent cases' structure exactly).

Create `test/unit/host-teardown-quartet.test.ts` — the quartet parameterized over kinds (spec: "written before the wire lands"):

```ts
import { describe, expect, it } from "vitest";
// Build a detached SessionHost with a fake HostSession whose submit hangs until its broker request is
// settled (copy the minimal fixture shape from test/unit/host-park.test.ts).
const KINDS = [
  { kind: "permission" as const, toolName: "Bash", answer: { kind: "allow_once" as const }, settledAs: "allow_once" },
  { kind: "question" as const, toolName: "AskUserQuestion", answer: { kind: "question_answer" as const, answers: { q: "a" } }, settledAs: "question_answer" },
  { kind: "plan" as const, toolName: "ExitPlanMode", answer: { kind: "plan_approve" as const, acceptEdits: false }, settledAs: "plan_approve" },
];
describe.each(KINDS)("teardown quartet [$kind]", ({ kind, toolName, answer, settledAs }) => {
  it("1. stop() settles the park with deny and emits decision_settled by:system", async () => { /* park → host.stop("stopped") → broker promise resolved {kind:"deny"}; follower saw decision_settled by:"system" decision:"deny"; stop() returned (no hang) */ });
  it("2. interrupt() settles the park and emits, before the session interrupt", async () => { /* park → host.interrupt() → same asserts; fake session records interrupt() was called AFTER the settle */ });
  it("3. first answer wins; the second answerer is told who", async () => { /* park → answer(ok) → answer again → { ok: true, alreadyAnsweredBy } */ });
  it("4. answering after settle reports no parked request (stale id ≠ silent ok)", async () => { /* answer a never-parked id → { ok: false, error: /no parked request/ } */ });
});
```

Fill the bodies with the real fixture code (each ~10 lines using the host-park helpers).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/host-park.test.ts test/unit/host-teardown-quartet.test.ts`
Expected: FAIL — no `decision` events, `answer()` takes `PermissionDecision`.

- [ ] **Step 3: Implement the wire + ops**

`src/host/wire.ts` — event union becomes (import `PendingDecision` and `BackgroundTaskInfo`):

```ts
import type { PendingDecision } from "../permissions/pending.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { HostStatus } from "./ops.js";

export type HostEvent =
  | { kind: "message"; data: unknown }
  | { kind: "decision"; entry: PendingDecision }                              // a decision just parked (any kind)
  | { kind: "decision_settled"; toolUseID: string; by: string; decision: string }
  | { kind: "tasks_changed"; tasks: BackgroundTaskInfo[] }                    // REPLACE snapshot (Task 4 emits)
  | { kind: "task"; data: unknown }                                           // raw task lifecycle frame (Task 4 emits)
  | { kind: "state"; status: HostStatus }
  | { kind: "turn"; phase: "start" | "end"; seq?: number; error?: string; truncated?: boolean };
```

(The old `permission`/`permission_settled` variants are deleted HERE; the legacy read alias is client-side only — spec Decision Log.)

`src/host/ops.ts` — replace the `answer` object and add the T4 ops now (schema-only; T4 wires handlers):

```ts
const structuredAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question_answer"), answers: z.record(z.string(), z.string()), response: z.string().optional() }),
  z.object({ kind: z.literal("plan_approve"), acceptEdits: z.boolean() }),
  z.object({ kind: z.literal("plan_reject"), feedback: z.string().optional() }),
]);
// answer: `decision` is the FLAT legacy permission shape (an old host reading a new client's permission
// answer sees exactly the A2b fields — spec's upgrade-compat rule); `answer` carries the structured kinds.
z.object({ op: z.literal("answer"), toolUseID: z.string().min(1), by: z.string().min(1), decision: decisionKind.optional(), answer: structuredAnswer.optional(), ...withId }),
z.object({ op: z.literal("tasks"), ...withId }),
z.object({ op: z.literal("background"), ...withId }),
z.object({ op: z.literal("stop_task"), taskId: z.string().min(1), ...withId }),
```

and `HostStatus` gains `permissionMode?: string` (populated in Task 5).

`src/host/server.ts` — the `answer` dispatch arm assembles the outcome (and refuses ambiguity):

```ts
case "answer": {
  const d = op.data;
  const outcome = d.answer ?? (d.decision ? ({ kind: d.decision } as const) : undefined);
  if (!outcome || (d.answer && d.decision)) return { ok: false, error: "answer needs exactly one of decision|answer" };
  return { ...this.handlers.answer(d.toolUseID, outcome, d.by) };
}
```

`HostHandlers.answer` signature: `answer(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: boolean; alreadyAnsweredBy?: string; error?: string }`. Add `tasks`/`background`/`stop_task` arms returning `{ ok: false, error: "unsupported" }` for now (Task 4 replaces them — the schema must not be ahead of a crashing dispatch).

- [ ] **Step 4: Implement the host**

`src/host/host.ts` changes:

1. Imports: `PendingDecisions`, `PendingDecision`, `DecisionOutcome`, `DecisionKind` (drop `PermissionDecision`, `PendingEntry` names).
2. The store gains the auto-settle emit (constructor site):

```ts
private parked = new PendingDecisions({ expireAfterMs: "never", onAutoSettle: (e) => {
  // An SDK-side abort (NOT our interrupt/stop, which settle via settleParkedForSystem below) used to
  // vanish silently — the client dialog stayed up forever (spec: interrupt-path emit is new wiring).
  this.settledBy.set(e.toolUseID, "system");
  this.emit({ kind: "decision_settled", toolUseID: e.toolUseID, by: "system", decision: "deny" });
  this.emit({ kind: "state", status: this.status() });
} });
```

3. `broker()`'s park emit becomes `this.emit({ kind: "decision", entry })` (same shape lookup as today). The zero-connection deny is unchanged (`{ kind: "deny" }` — the gate composes the kind copy).
4. `answer()` becomes kind-validated:

```ts
private static readonly KIND_ANSWERS: Record<DecisionKind, ReadonlySet<string>> = {
  permission: new Set(["allow_once", "allow_always", "deny"]),
  question: new Set(["question_answer", "deny"]),
  plan: new Set(["plan_approve", "plan_reject", "deny"]),
};

answer(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: true; alreadyAnsweredBy?: string } | { ok: false; error: string } {
  const entry = this.parked.list().find((e) => e.toolUseID === toolUseID);
  // Validated BEFORE settling so a mismatch leaves the park intact (spec: op error reply; the park stays).
  if (entry && !SessionHost.KIND_ANSWERS[entry.kind].has(outcome.kind)) {
    return { ok: false, error: `kind mismatch: ${entry.kind} park cannot take ${outcome.kind}` };
  }
  if (!this.parked.respond(toolUseID, outcome)) {
    const who = this.settledBy.get(toolUseID);
    return who ? { ok: true, alreadyAnsweredBy: who } : { ok: false, error: `no parked request ${toolUseID}` };
  }
  if (outcome.kind === "plan_approve" && outcome.acceptEdits) this.planUpgradePending = true;   // consumed in Task 5
  this.settledBy.set(toolUseID, by);
  this.emit({ kind: "decision_settled", toolUseID, by, decision: outcome.kind });
  this.emit({ kind: "state", status: this.status() });
  return { ok: true };
}
```

with `private planUpgradePending = false;` declared by the other private fields.
5. `settleParkedForSystem()` emits `decision_settled` (same fields, renamed kind). `follow()`'s pending replay emits `{ kind: "decision", entry }`. `status()`'s waitingFor: `` waitingFor: `${first.kind}:${first.toolName}` ``. `pending(): PendingDecision[]`.

- [ ] **Step 5: The rename is ATOMIC — land the client read alias HERE and sweep the full blast radius**

The wire union change makes every `ev.kind === "permission"` comparison a TS2367 error, and tsconfig type-checks `test/**` too — so this task must leave the whole tree compiling (plan-review C1b). Two parts:

**(a) The chatAdapter read alias (this IS Task 6's alias deliverable, landed here because the rename cannot be split; T6's tests still pin it).** In `src/client/chatAdapter.ts`'s `route()`, replace the `permission`/`permission_settled` arms with:

```ts
// READ ALIAS (spec Decision Log): a pre-Goal-B host still emits permission/permission_settled — ingest
// them as decisions so an upgraded `ccx attach` reads a long-lived old host. kind defaults to
// "permission" (old entries carry none); a new host's own kind wins the spread.
const k = (ev as { kind: string }).kind;
if (k === "decision" || k === "permission") {
  const entry = { kind: "permission", ...(ev as any).entry } as PendingDecision;
  pendingList.push(entry); for (const cb of [...permCbs]) { try { cb(entry); } catch {} }
} else if (k === "decision_settled" || k === "permission_settled") {
  const s = ev as any;
  const i = pendingList.findIndex((e) => e.toolUseID === s.toolUseID);
  if (i >= 0) pendingList.splice(i, 1);
  for (const cb of [...settledCbs]) { try { cb({ toolUseID: s.toolUseID, by: s.by, decision: s.decision }); } catch {} }
}
```

(Keep the surrounding `message`/`state`/`turn` arms and the callback-set names as they are — T6 renames the public methods; typing note: the legacy frames are no longer `HostEvent` variants, hence the `as any` reads.) `pendingList` becomes `PendingDecision[]`; `onPermission`'s replay cast follows.

**(b) The mechanical sweep.** `grep -rn '"permission"\|"permission_settled"' src test | grep -v daemon` and fix every host-path site — known list: `test/unit/host-follow.test.ts`, `test/unit/host-server.test.ts`, `test/unit/host-park.test.ts`, `test/tui/helpers/fakeRemote.ts` (its route arms and `parkPermission`/`settlePermission` push `HostEvent` literals — they become `decision`/`decision_settled` with `kind:"permission"` entries), `test/tui/useChat.test.tsx`, `test/integration/host-client.test.ts` (the `e.kind === "permission"` filters). `src/cli/attach.ts` consumes NO event kinds (disk replay only) — do not touch it.

Run: `npx vitest run test/unit test/tui test/integration && npm run typecheck`
Expected: PASS (this task's gate is deliberately the widest — the rename's blast radius ends here).

- [ ] **Step 6: Commit**

```bash
git add -A src test
git commit -m "feat(gb3): host decision park — kind-validated structured answers, decision events, system-settle emits, atomic wire rename"
```

---

### Task 4: `Session.onFrame` + the host background-task surface

**Files:**
- Modify: `src/session/session.ts` (the ONE session-layer change), `src/host/host.ts`, `src/host/server.ts`
- Test: `test/unit/session-frames.test.ts` (create), `test/unit/host-frames.test.ts` (create), `test/unit/host-ops.test.ts` (extend)

**Interfaces:**
- Consumes: `tasks_changed`/`task` event variants + `tasks`/`background`/`stop_task` op schemas (T3 already landed them).
- Produces:
  - `Session.onFrame(cb: (m: unknown) => void): () => void` — persistent, fires for EVERY frame the read-loop sees (waiter or not), before waiter dispatch; multiple subscribers; a throwing subscriber is swallowed.
  - `HostSession` optional members: `onFrame?(cb: (m: unknown) => void): () => void; listBackgroundTasks?(): Promise<BackgroundTaskInfo[]>; backgroundAll?(toolUseId?: string): Promise<boolean>; stopTask?(taskId: string): Promise<void>` (all optional — existing fakes stay valid).
  - Host: `bgTasks: BackgroundTaskInfo[]` snapshot; emits `{kind:"tasks_changed", tasks}` on every `background_tasks_changed` frame; emits `{kind:"task", data}` for task lifecycle frames; `follow()` replays a non-empty snapshot (after the pending replay, before the final `state`).
  - `HostHandlers`/server dispatch: `tasks` → `{ ok: true, tasks }` · `background` → `{ ok: true, backgrounded }` · `stop_task {taskId}` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

`test/unit/session-frames.test.ts` (use the existing fake-`QueryFn` pattern from `test/unit/harness.test.ts`/session tests — an async generator you push frames through):

```ts
import { describe, expect, it } from "vitest";
import { Session } from "../../src/session/session.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";

function fakeQuery() {
  const frames = new AsyncQueue<unknown>();
  const query = (() => ({ [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() })) as any;
  return { frames, query };
}

describe("Session.onFrame", () => {
  it("fires for BETWEEN-TURN system frames (no waiter — the old path dropped them)", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "t1", task_type: "bash", description: "sleep" }] });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    expect(s.backgroundTasks).toEqual([{ task_id: "t1", task_type: "bash", description: "sleep" }]);
    frames.close(); await s.done;
  });

  it("unsubscribe stops delivery; a throwing subscriber does not break the loop", async () => {
    const { frames, query } = fakeQuery();
    const s = new Session({ query }, {});
    const seen: unknown[] = [];
    s.onFrame(() => { throw new Error("boom"); });
    const off = s.onFrame((m) => seen.push(m));
    frames.push({ type: "system", subtype: "status", permissionMode: "default" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    off();
    frames.push({ type: "system", subtype: "status", permissionMode: "plan" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    frames.close(); await s.done;
  });
});
```

`test/unit/host-frames.test.ts` — a fake `HostSession` whose `onFrame` the test drives by hand:

```ts
import { describe, expect, it } from "vitest";
// Fixture: fakeSession with onFrame(cb) { this.cb = cb; return () => {}; } and a drive(m) helper; build a
// detached SessionHost around it (copy the minimal host fixture from test/unit/host-park.test.ts), follow()
// with a collector, then:
describe("host frame plumbing", () => {
  it("re-emits background_tasks_changed as tasks_changed and snapshots it", async () => {
    // drive({type:"system",subtype:"background_tasks_changed",tasks:[{task_id:"t1",task_type:"bash",description:"x"}]})
    // → follower got {kind:"tasks_changed", tasks:[…]}; a SECOND follower's follow() replay includes the snapshot.
  });
  it("re-emits task lifecycle frames as {kind:'task'} (both bare and system-subtype tags)", async () => {
    // drive({type:"task_started", task_id:"t", tool_use_id:"tu", subagent_type:"reviewer"}) → {kind:"task", data}
    // drive({type:"system", subtype:"task_notification", task_id:"t", status:"completed", summary:"done"}) → {kind:"task", data}
  });
  it("does NOT re-emit ordinary assistant frames as task events", async () => { /* drive({type:"assistant",…}) → no task/tasks_changed event */ });
});
```

Fill with real fixture code, plus one more `host-frames` case (plan-review I1): **"frames still plumb after resumeSession"** — drive a frame through the FIRST fake session, `resumeSession("sid2")` (the fixture's `openSession` returns a second fake), drive a frame through the SECOND session's `onFrame` → the follower still receives the `tasks_changed`; and the swap itself emitted an empty `tasks_changed`. In `test/unit/host-ops.test.ts` add dispatch cases: `tasks` returns the host's snapshot (always works — it never touches the session); `background` calls the session's `backgroundAll` and returns its boolean; `stop_task` calls `stopTask(taskId)`; `background`/`stop_task` (only — not `tasks`) reply `{ ok: false, error: "…unsupported…" }` when the session lacks the member.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/session-frames.test.ts test/unit/host-frames.test.ts`
Expected: FAIL — `onFrame` does not exist.

- [ ] **Step 3: Implement `Session.onFrame`**

In `src/session/session.ts`: add by the other private fields

```ts
private frameCbs = new Set<(m: unknown) => void>();
```

public method (next to `listBackgroundTasks`):

```ts
/** Persistent frame listener — fires for EVERY frame the read-loop sees, waiter or not. This is the one
 *  session-layer change of Goal B: between turns there is no waiter, so system frames (task changes,
 *  status/mode) previously vanished (spec §session-layer). Subscribers are independent; one throwing
 *  does not starve another. */
onFrame(cb: (m: unknown) => void): () => void { this.frameCbs.add(cb); return () => { this.frameCbs.delete(cb); }; }
```

and in `readLoop()`, first line inside the `for await` body after `this.lastActiveAt = …`:

```ts
for (const cb of [...this.frameCbs]) { try { cb(m); } catch { /* one subscriber's failure is not another's */ } }
```

- [ ] **Step 4: Implement the host side**

`src/host/host.ts`:

1. `HostSession` gains the four optional members (exact signatures from the Interfaces block; same comment style as the existing optional block).
2. Fields: `private bgTasks: BackgroundTaskInfo[] = [];` and `private offFrame?: () => void;`
3. In `start()`, right after `this.session = this.deps.openSession(…)`:

```ts
this.offFrame = this.session.onFrame?.((m) => this.onSessionFrame(m));
```

in `teardown()`'s `try` block (before `settleParkedForSystem`): `this.offFrame?.();` — **and in
`resumeSession()`**, right after the session swap (plan-review I1: the swap replaces `this.session`
with a fresh `Session` whose subscriber set is empty — without this, mode sync, the tasks panel, and
attribution all silently die after a `/resume`, a shipped surface):

```ts
this.offFrame?.();
this.offFrame = this.session.onFrame?.((m) => this.onSessionFrame(m));
this.bgTasks = []; this.emit({ kind: "tasks_changed", tasks: [] });   // the old session's tasks are gone
this.planUpgradePending = false;                                       // (field exists from T3)
```

(T5's attribution maps get cleared here too once they exist — T5 adds the two `.clear()` lines.)
4. The frame handler (Task 5 extends it — keep the marked seam):

```ts
/** Every session frame, waiter or not (Session.onFrame). Task events and the tasks snapshot are emitted
 *  from HERE, not from runTask's onMessage: between turns there is no waiter, and a bg task finishing
 *  while the host idles must still reach an attached client (spec §background). */
private onSessionFrame(m: unknown): void {
  const mm = m as any;
  if (mm?.type === "system" && mm.subtype === "background_tasks_changed") {
    this.bgTasks = mm.tasks ?? [];                                     // REPLACE, never merge (probe 39)
    this.emit({ kind: "tasks_changed", tasks: this.bgTasks });
    return;
  }
  // Task lifecycle frames arrive with either a bare type tag or as a system subtype depending on SDK
  // path — match both, deterministically (spec §attribution note; acceptance ③ pins the live shape).
  const sub = mm?.type === "system" ? mm.subtype : mm?.type;
  if (sub === "task_started" || sub === "task_notification" || sub === "task_progress" || sub === "task_updated") {
    this.emit({ kind: "task", data: m });
    return;
  }
}
```

5. `follow()` replay — after the parked-decision loop, before the final `state` frame:

```ts
if (this.bgTasks.length) this.deliver(cb, { kind: "tasks_changed", tasks: this.bgTasks });
```

6. New handler methods + server wiring (`HostServer` handlers object in `start()`):

```ts
tasks: () => this.bgTasks,
background: (toolUseId) => this.background(toolUseId),
stopTask: (taskId) => this.stopBgTask(taskId),
```

```ts
async background(toolUseId?: string): Promise<boolean> {
  const fn = this.session?.backgroundAll?.bind(this.session);
  if (!fn) throw new Error("background unsupported by this host");
  return fn(toolUseId);
}
async stopBgTask(taskId: string): Promise<void> {
  const fn = this.session?.stopTask?.bind(this.session);
  if (!fn) throw new Error("stop_task unsupported by this host");
  await fn(taskId);
}
```

`src/host/server.ts` — replace the three placeholder arms:

```ts
case "tasks": return { ok: true, tasks: this.handlers.tasks() };
case "background": return { ok: true, backgrounded: await this.handlers.background() };
case "stop_task": await this.handlers.stopTask(op.data.taskId); return { ok: true };
```

with the matching `HostHandlers` members (`tasks(): BackgroundTaskInfo[]; background(toolUseId?: string): Promise<boolean>; stopTask(taskId: string): Promise<void>`).

- [ ] **Step 5: Run green**

Run: `npx vitest run test/unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/host test/unit/session-frames.test.ts test/unit/host-frames.test.ts test/unit/host-ops.test.ts
git commit -m "feat(gb4): Session.onFrame + host bg-task surface (tasks_changed/task events, tasks/background/stop_task ops)"
```

---

### Task 5: Host mode-sync, plan upgrade, and attribution stamping

**Files:**
- Modify: `src/host/host.ts`, `src/config/resolveOptions.ts`
- Test: `test/unit/host-mode-sync.test.ts` (create), `test/unit/host-frames.test.ts` (extend: attribution)

**Interfaces:**
- Consumes: `onSessionFrame` seam + `planUpgradePending` flag (T3/T4); `HostStatus.permissionMode?` (T3 schema).
- Produces:
  - `resolvedPermissionMode(config: HarnessConfig): string` exported from `src/config/resolveOptions.ts` — the mode the engine will actually start in (`resolveOptions(config).permissionMode ?? "default"` as a string).
  - Host mode field: ONE `private mode: string`, initialized from `resolvedPermissionMode(opts.config)` in `start()`; last-write-wins between (a) intercepted `status` frames and (b) successful `set_permission_mode` control ops / the plan upgrade; every write emits `state`; `status()` carries `permissionMode: this.mode`.
  - The `approve_accept_edits` sequence (spec's deterministic ordering): `planUpgradePending` → CLI `status` frame observed → `setPermissionMode("acceptEdits")` → mode write → `state` emit. Turn-end belt in `runTask`.
  - Attribution maps: `parentOf: Map<toolUseID, parentToolUseID>` (from nested assistant frames), `subagentOf: Map<agentToolUseID, subagent_type>` (from `task_started` frames); cleared at turn start; `broker()` stamps both onto the request before parking.

- [ ] **Step 1: Write the failing tests**

`test/unit/host-mode-sync.test.ts` (same fake-session + collector fixture as host-frames):

```ts
describe("host mode sync (one source of truth, last-write-wins)", () => {
  it("initializes mode from resolvedPermissionMode and reports it in status()", async () => { /* config {permissionMode:"plan"} → status().permissionMode === "plan" */ });
  it("a status frame overwrites the mode and emits state", async () => { /* drive({type:"system",subtype:"status",status:null,permissionMode:"acceptEdits"}) → status().permissionMode==="acceptEdits"; follower saw {kind:"state"} with it */ });
  it("set_permission_mode control op writes the mode AFTER the session call succeeds and emits state", async () => { /* control({op:"set_permission_mode",mode:"default"}) with a fake setPermissionMode that resolves → mode "default" + state emit; a REJECTING setPermissionMode leaves mode untouched */ });
  it("plan upgrade fires on the status frame, not on answer release (the ordering rule)", async () => {
    // Park kind:"plan"; answer {kind:"plan_approve",acceptEdits:true} → fake session.setPermissionMode NOT yet called;
    // drive the CLI's post-approval frame {type:"system",subtype:"status",status:null,permissionMode:"default"}
    // → setPermissionMode("acceptEdits") called once; mode ends "acceptEdits"; state emitted; flag cleared.
  });
  it("turn-end belt: a pending upgrade with no status frame is applied when the turn ends", async () => { /* submit resolves with planUpgradePending still true → setPermissionMode("acceptEdits") called from runTask's path */ });
});
```

Extend `test/unit/host-frames.test.ts`:

```ts
it("stamps parentToolUseID + subagentType onto a parked decision via the correlation maps", async () => {
  // drive({type:"task_started", task_id:"bg1", tool_use_id:"agent-tu", subagent_type:"code-reviewer"});
  // drive({type:"assistant", parent_tool_use_id:"agent-tu", message:{content:[{type:"tool_use", id:"inner-tu", name:"Bash", input:{}}]}});
  // then broker().request({toolUseID:"inner-tu", toolName:"Bash", kind:"permission", …}) on a detached host
  // → pending()[0].parentToolUseID === "agent-tu" && subagentType === "code-reviewer".
  // A toolUseID with no map hit parks WITHOUT the fields (never blocks).
});
it("clears the attribution maps at turn start", async () => { /* stamp maps, run a (fake, resolving) runTask, park again with the same ids → unattributed */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/host-mode-sync.test.ts test/unit/host-frames.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/config/resolveOptions.ts`:

```ts
/** The permission mode the engine will ACTUALLY start in for this config — the host's initial mode
 *  truth (spec: one mode field, seeded here so a fresh client's status bar never shows a placeholder). */
export function resolvedPermissionMode(config: HarnessConfig): string {
  return String((resolveOptions(config) as { permissionMode?: string }).permissionMode ?? "default");
}
```

`src/host/host.ts`:

1. Fields:

```ts
private mode = "default";                       // ONE source of truth; last-write-wins (spec §mode-sync)
private parentOf = new Map<string, string>();   // nested tool_use id → parent Agent tool_use id
private subagentOf = new Map<string, string>(); // Agent tool_use id → subagent_type (task_started frames)
```

2. `start()`: `this.mode = resolvedPermissionMode(this.opts.config);` before opening the session (import from `../config/resolveOptions.js`). NOTE (plan-review M8): this makes every host unit test actually execute `resolveOptions` against its fixture config (previously only the faked `openSession` saw it) — run the host suites and confirm no minimal fixture config throws; if one does, fix the fixture, not the helper.
3. `status()` carries it: add `permissionMode: this.mode` to BOTH return branches.
4. `onSessionFrame` grows two arms (before the task-lifecycle arm; the `task_started` match must ALSO feed `subagentOf` — order the arms so attribution capture happens first). **NOTE: T4's body already declares `const sub` — hoist that ONE declaration above these new arms and reuse it; do not redeclare (plan-review M1):**

```ts
if (mm?.type === "assistant" && mm.parent_tool_use_id) {
  for (const b of mm.message?.content ?? []) if (b?.type === "tool_use" && b.id) this.parentOf.set(String(b.id), String(mm.parent_tool_use_id));
}
if (sub === "task_started" && mm.tool_use_id && mm.subagent_type) this.subagentOf.set(String(mm.tool_use_id), String(mm.subagent_type));
if (mm?.type === "system" && mm.subtype === "status" && typeof mm.permissionMode === "string") {
  this.mode = mm.permissionMode;
  // The upgrade is triggered by OBSERVING this frame, never by answer release — the CLI's own flip
  // rides the message stream and an eager setter would race it (spec §mode-sync ordering).
  if (this.planUpgradePending) { this.planUpgradePending = false; void this.applyPlanUpgrade(); }
  else this.emit({ kind: "state", status: this.status() });
  return;
}
```

```ts
private async applyPlanUpgrade(): Promise<void> {
  try { await this.session?.setPermissionMode?.("acceptEdits"); this.mode = "acceptEdits"; }
  catch { /* the CLI's own flip stands; mode stays what the status frame wrote */ }
  this.emit({ kind: "state", status: this.status() });
}
```

5. `runTask`: at the top (with the buffer reset): `this.parentOf.clear(); this.subagentOf.clear();` (and add the same two `.clear()` lines to `resumeSession()`'s reset block from T4) — the belt, after `await this.session!.submit(…)` resolves (inside the try, before the state assignment):

```ts
if (this.planUpgradePending) { this.planUpgradePending = false; await this.applyPlanUpgrade(); }
```

and in the CATCH arm, first line: `this.planUpgradePending = false;` — a failed/interrupted turn must not leave a stale approved-upgrade that fires at the NEXT turn's status frame (plan-review M2; add a test case for it in `host-mode-sync.test.ts`).

6. `control()` `set_permission_mode` arm becomes:

```ts
case "set_permission_mode": {
  await need(s?.setPermissionMode?.bind(s), "set_permission_mode")(op.mode);
  this.mode = op.mode;                                      // our own successful set is the second writer
  this.emit({ kind: "state", status: this.status() });
  return { ok: true };
}
```

7. `broker()` stamps attribution before parking:

```ts
const parentToolUseID = this.parentOf.get(req.toolUseID);
const subagentType = parentToolUseID ? this.subagentOf.get(parentToolUseID) : undefined;
const decision = this.parked.brokerFor(this.short).request({ ...req, ...(parentToolUseID ? { parentToolUseID } : {}), ...(subagentType ? { subagentType } : {}) });
```

- [ ] **Step 4: Run green**

Run: `npx vitest run test/unit && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/host.ts src/config/resolveOptions.ts test/unit/host-mode-sync.test.ts test/unit/host-frames.test.ts
git commit -m "feat(gb5): host mode sync (status frames, one source of truth), plan acceptEdits upgrade ordering, attribution stamping"
```

---

### Task 6: Client — remote ops, decision feed (with legacy alias), bg tasks

**Files:**
- Modify: `src/client/remote.ts`, `src/client/chatAdapter.ts`, `src/session/chatSession.ts`, `src/index.ts` (+ pin test)
- Test: `test/unit/client-remote.test.ts` (extend), `test/unit/client-chat-adapter.test.ts` (extend)

**Interfaces:**
- Consumes: wire events + ops (T3/T4), `PendingDecision`/`DecisionOutcome` (T1).
- Produces (the REPL relies on):
  - `src/session/chatSession.ts`: `PermissionFeed` renamed to **`DecisionFeed`** — `onDecision(cb: (entry: PendingDecision) => void)`, `onDecisionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void)`, `answerDecision(toolUseID: string, outcome: DecisionOutcome): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>` — guard `hasDecisionFeed`. New mixin `interface BgTasks { listBgTasks(): Promise<BackgroundTaskInfo[]>; background(): Promise<boolean>; stopBgTask(taskId: string): Promise<void> }` — guard `hasBgTasks`.
  - `RemoteChatSession`: `answerDecision(toolUseID, outcome)` (sends flat `decision` for the 3-way kinds, `answer` for structured — the compat rule), `tasksOp()`, `backgroundOp()`, `stopTaskOp(taskId)`.
  - `remoteChatSession(...)`: implements `ChatSession & DecisionFeed & SessionEvents & BgTasks`; its `route()` ingests legacy `permission`/`permission_settled` frames as `decision`/`decision_settled` with `kind:"permission"` defaulted onto the entry (the read alias — an upgraded `ccx attach` against a still-running old host).

- [ ] **Step 1: Write the failing tests**

Extend `test/unit/client-remote.test.ts` (it has a fake-server harness — follow its pattern):

```ts
it("answerDecision sends the FLAT legacy shape for permission kinds and `answer` for structured", async () => {
  // answerDecision("t1", { kind: "allow_once" }) → frame {op:"answer",toolUseID:"t1",decision:"allow_once",by:label} with NO `answer` key
  // answerDecision("t2", { kind: "question_answer", answers: { q: "a" } }) → frame {op:"answer",toolUseID:"t2",answer:{kind:"question_answer",…},by:label} with NO `decision` key
});
it("tasksOp/backgroundOp/stopTaskOp round-trip", async () => { /* echo-server asserts op names + taskId */ });
```

Extend `test/unit/client-chat-adapter.test.ts`:

```ts
it("routes decision/decision_settled events into the feed", async () => { /* push {t:"event",kind:"decision",entry:{kind:"question",toolUseID:"q1",…}} → onDecision fired with the entry; pendingNow() lists it; then decision_settled removes it + fires onDecisionSettled */ });
it("READ ALIAS: legacy permission/permission_settled frames from an old host arrive as decisions with kind permission", async () => {
  // push {t:"event",kind:"permission",entry:{toolUseID:"p1",toolName:"Bash",input:{},sessionId:"s",createdAt:1}}   // NOTE: no kind field — old hosts don't send one
  // → onDecision fired with entry.kind === "permission"; {t:"event",kind:"permission_settled",…} → settled fired.
});
it("exposes bg tasks: listBgTasks/background/stopBgTask call the ops; hasBgTasks guards true", async () => {});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/client-remote.test.ts test/unit/client-chat-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/session/chatSession.ts` — replace `PermissionFeed` with (imports move to the new type names):

```ts
/** Decision surface a REMOTE session exposes: parked entries (any kind) + settlement + answering. */
export interface DecisionFeed {
  onDecision(cb: (entry: PendingDecision) => void): () => void;
  onDecisionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void): () => void;
  answerDecision(toolUseID: string, outcome: DecisionOutcome): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
}
/** Background-task surface (host path only — the lib Session exposes the SDK levers under other names). */
export interface BgTasks {
  listBgTasks(): Promise<BackgroundTaskInfo[]>;
  background(): Promise<boolean>;
  stopBgTask(taskId: string): Promise<void>;
}
export function hasDecisionFeed(s: ChatSession): s is ChatSession & DecisionFeed {
  return typeof (s as Partial<DecisionFeed>).answerDecision === "function";
}
export function hasBgTasks(s: ChatSession): s is ChatSession & BgTasks {
  return typeof (s as Partial<BgTasks>).listBgTasks === "function";
}
```

**Deprecated delegates until T7 (plan-review C1c — `useChat.ts`, `test/tui/helpers/fakeRemote.ts`, and the integration tests still use the old names, and they are NOT this task's files):** keep `PermissionFeed` and `hasPermissionFeed` as thin aliases —

```ts
/** @deprecated Goal B renames this surface to DecisionFeed — deleted in the same branch (T7). */
export type PermissionFeed = DecisionFeed;
export const hasPermissionFeed = hasDecisionFeed;
```

and the adapter keeps `onPermission`/`onPermissionSettled`/`answerPermission` as one-line delegates onto the new methods. T7 deletes all five.

`src/client/remote.ts` — replace `answer(...)` with:

```ts
/** Structured kinds travel under `answer`; the 3-way kinds keep the FLAT legacy fields so an old host's
 *  schema still parses a new client's permission answer (spec: upgrade compat, read-side only). */
answerDecision(toolUseID: string, outcome: DecisionOutcome): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }> {
  const flat = outcome.kind === "allow_once" || outcome.kind === "allow_always" || outcome.kind === "deny";
  return this.send(flat ? { op: "answer", toolUseID, decision: outcome.kind, by: this.label }
                        : { op: "answer", toolUseID, answer: outcome, by: this.label });
}
tasksOp() { return this.send<{ ok: boolean; error?: string; tasks?: BackgroundTaskInfo[] }>({ op: "tasks" }); }
backgroundOp() { return this.send<{ ok: boolean; error?: string; backgrounded?: boolean }>({ op: "background" }); }
stopTaskOp(taskId: string) { return this.send<{ ok: boolean; error?: string }>({ op: "stop_task", taskId }); }
```

`src/client/chatAdapter.ts` — the `route()` read-alias arms **already landed in T3 step 5(a)** (the wire rename was atomic); this task's test in step 1 pins them. Here: rename the sets (`permCbs` → `decisionCbs`, `settledCbs` stays), add the NEW public methods `onDecision`/`onDecisionSettled`/`answerDecision` (calling `raw.answerDecision`), keep the old three as `@deprecated` one-line delegates (C1c above), and add:

```ts
async listBgTasks() { return orFail(await (await ready).tasksOp()).tasks ?? []; },
async background() { return orFail(await (await ready).backgroundOp()).backgrounded ?? false; },
async stopBgTask(taskId) { orFail(await (await ready).stopTaskOp(taskId)); },
```

`src/index.ts`: export `DecisionFeed`, `BgTasks`, `hasDecisionFeed`, `hasBgTasks` alongside the (deprecated, T7-removed) `PermissionFeed`/`hasPermissionFeed`; update the pin test.

- [ ] **Step 4: Run green**

Run: `npx vitest run test/unit && npm run typecheck`
Expected: PASS (adapter/remote suites + no stragglers on the renamed guards).

- [ ] **Step 5: Commit**

```bash
git add src/client src/session/chatSession.ts src/index.ts test/unit/client-remote.test.ts test/unit/client-chat-adapter.test.ts test/unit/index.test.ts
git commit -m "feat(gb6): client decision feed with legacy read alias, structured answers, bg-task ops"
```

---

### Task 7: `useChat` — decision queue, mode sync, plan ladder, /bg state, task notices

**Files:**
- Modify: `src/tui/useChat.ts`, `src/tui/commands.ts`
- Test: `test/tui/useChat.test.tsx` (extend), `test/tui/commands.test.ts` (extend)

**Interfaces:**
- Consumes: `DecisionFeed`/`BgTasks` guards + `PendingDecision`/`DecisionOutcome` (T6).
- Produces (ChatApp/dialog tasks rely on):
  - `ChatState` changes: `pending: PendingDecision | null` · new `bgTasks: BackgroundTaskInfo[]` · new `bgPanelOpen: boolean` · `subagentActive` REMOVED (T10 replaces its status-bar use with the count).
  - Hook returns: `resolveDecision(outcome: DecisionOutcome)` (renames `resolvePermission`) · `openBgPanel()` · `closeBgPanel()` · `stopBgTask(id: string)` · `backgroundNow()`.
  - `LADDER = ["default", "acceptEdits", "plan", "auto"]`.
  - `/bg` in `COMMANDS`: `{ name: "bg", summary: "list background tasks (k/x stops one)" }`.

- [ ] **Step 1: Write the failing tests**

Extend `test/tui/useChat.test.tsx` (its harness drives a fake `ChatSession & DecisionFeed & SessionEvents` — extend the fake with the new members):

```ts
it("Tab ladder cycles default → acceptEdits → plan → auto → default", async () => { /* cycleMode 4× asserts the sequence via state.mode + session.setPermissionMode calls */ });
it("a state event carrying permissionMode overwrites the local mode (host truth wins)", async () => { /* push {kind:"state",status:{state:"working",status:"idle",permissionMode:"acceptEdits"}} → state.mode==="acceptEdits" */ });
it("a question decision parks into pending with its kind intact", async () => { /* feed onDecision({kind:"question",…}) → state.pending.kind === "question" */ });
it("resolveDecision answers via answerDecision and clears only on the settle event", async () => { /* resolveDecision({kind:"question_answer",answers:{}}) → session.answerDecision called; pending stays until onDecisionSettled fires */ });
it("tasks_changed updates bgTasks; task frames render notices honoring skip_transcript", async () => {
  // push {kind:"tasks_changed",tasks:[{task_id:"t1",task_type:"bash",description:"sleep 99"}]} → state.bgTasks length 1
  // push {kind:"task",data:{type:"task_started",description:"reviewing",task_id:"t2"}} → a "⚙ task started: reviewing" line appended
  // push {kind:"task",data:{type:"task_notification",status:"completed",summary:"done",task_id:"t2"}} → "✓ task done: done"
  // push {kind:"task",data:{type:"task_started",description:"hidden",skip_transcript:true}} → NO line appended
});
it("/bg opens the panel; stopBgTask calls the session; settled decision notices name the kind action", async () => {});
```

Extend `test/tui/commands.test.ts`: `/bg` is in `LOCAL_NAMES` and the palette entries.

Known existing tests this task UPDATES rather than works around (plan-review M4/M5): `test/tui/useChat.test.tsx:608`-area asserts the exact ladder sequence `["acceptEdits","auto","default"]` — becomes `["acceptEdits","plan","auto","default"]`; `test/tui/chat.test.tsx:82`-area Tab-cycle assertion likewise; `test/tui/components.test.tsx` pins `ChatStatusBar`'s `subagentActive` prop (~lines 94–107) — delete those two cases here (T10 adds the `⚙ N bg` replacements).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tui/useChat.test.tsx test/tui/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/tui/useChat.ts` — the changes, in file order:

1. Imports: `hasDecisionFeed`, `hasBgTasks` (replacing `hasPermissionFeed`), `PendingDecision`, `DecisionOutcome`, `BackgroundTaskInfo`.
2. `LADDER = ["default", "acceptEdits", "plan", "auto"] as const;` (comment: Tab cycles these; bypassPermissions stays off-cycle (/yolo)).
3. State: `pending`/`pendingRef`/`pendingQueue` typed `PendingDecision`; add

```ts
const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
const [bgPanelOpen, setBgPanelOpen] = useState(false);
const modeRef = useRef(mode); modeRef.current = mode;
```

4. The event effect gains three arms (inside the existing `onSessionEvent` callback, after the `turn`/`message` arms):

```ts
else if (ev.kind === "tasks_changed") setBgTasks(ev.tasks);
else if (ev.kind === "task") {
  const t = ev.data as any;
  const sub = t?.type === "system" ? t.subtype : t?.type;
  if (!t?.skip_transcript) {
    if (sub === "task_started") notice(`⚙ task started: ${t.description ?? t.task_id}`);
    else if (sub === "task_notification") notice(t.status === "failed" ? `✗ task failed: ${t.summary ?? t.task_id}` : `${t.status === "stopped" ? "◼ task stopped" : "✓ task done"}: ${t.summary ?? t.task_id}`);
  }
}
else if (ev.kind === "state" && ev.status.permissionMode && ev.status.permissionMode !== modeRef.current) setMode(ev.status.permissionMode);
```

5. The feed subscription lines swap guards/names: `hasDecisionFeed(session) ? session.onDecision(…)` / `session.onDecisionSettled(…)`.
6. `dropPending`'s notice maps the settle label:

```ts
const verb = decision === "deny" ? "denied" : decision === "question_answer" ? "answered" : decision === "plan_approve" ? "approved" : decision === "plan_reject" ? "sent back" : "allowed";
if (!wasMine) notice(`↳ ${pendingRef.current.toolName} ${verb} by ${by}`);
```

7. `resolvePermission` renames to `resolveDecision(outcome: DecisionOutcome)` calling `session.answerDecision(entry.toolUseID, outcome)` (same answeredIds + `.catch` F1 body — do not touch the catch).
8. Bg helpers + `/bg` command:

```ts
function openBgPanel() { if (!disposed.current) setBgPanelOpen(true); }
function closeBgPanel() { if (!disposed.current) setBgPanelOpen(false); }
function stopBgTask(id: string) { if (hasBgTasks(session)) void session.stopBgTask(id).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: "red" }])); }
function backgroundNow() {
  if (!hasBgTasks(session)) { notice("background unsupported on this session"); return; }
  void session.background().then((b) => { if (!b) notice("nothing to background"); }).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: "red" }]));
}
```

`handleCommand` case `"bg"`: `openBgPanel(); break;`. `commands.ts` COMMANDS gains the `/bg` entry (exact line from Interfaces).
9. Drop `subagentActive` from state/`setSubagentActive` calls (T10 removes the consumer; keep `l.subagentActive` unused rather than churning liveTurn).
9b. Delete the five deprecated delegates T6 left (`PermissionFeed`, `hasPermissionFeed` in `chatSession.ts`/`index.ts` + the three adapter methods) and switch every remaining consumer (`useChat.ts` itself, `test/tui/helpers/fakeRemote.ts`, `test/integration/attach.test.ts`, `test/integration/loopback.test.ts`) to the Decision names — this task ends the rename.
10. Return: `{ state: { …, pending, bgTasks, bgPanelOpen, … }, …, resolveDecision, openBgPanel, closeBgPanel, stopBgTask, backgroundNow, … }`.

- [ ] **Step 4: Fix `ChatApp.tsx` compile only**

`ChatApp` still references `resolvePermission`/`subagentActive` — minimally rename to `resolveDecision` (its `PermissionDialog` call passes `(d) => resolveDecision(d)` — the 3-way decisions are valid `DecisionOutcome`s) and drop the `subagentActive` prop from `ChatStatusBar` (remove the prop there too, keeping the bar compiling; T10 adds the count). The full dispatcher lands in T8.

- [ ] **Step 5: Run green**

Run: `npx vitest run test/tui test/unit test/integration && npm run typecheck`
Expected: PASS (integration included — step 9b touched its files).

- [ ] **Step 6: Commit**

```bash
git add -A src test
git commit -m "feat(gb7): useChat decision queue, host-truth mode sync, plan ladder rung, /bg state, task notices; rename complete"
```

---

### Task 8: `QuestionDialog` + the dialog dispatcher

**Files:**
- Create: `src/tui/QuestionDialog.tsx`
- Modify: `src/tui/ChatApp.tsx`
- Test: `test/tui/questionDialog.test.tsx` (create), `test/tui/chat.test.tsx` (extend: dispatcher)

**Interfaces:**
- Consumes: `state.pending: PendingDecision`, `resolveDecision` (T7).
- Produces: `QuestionDialog({ req, onAnswer, onDeny })` where `req: { input: Record<string, unknown>; subagentType?: string }`, `onAnswer(answers: Record<string, string>, response?: string)`, `onDeny()`. Exported helper `parseQuestions(input): QuestionSpec[]`.

- [ ] **Step 1: Write the failing tests**

`test/tui/questionDialog.test.tsx` (ink-testing-library; remember the await-a-tick discipline — use `pressUntil`/`waitFor` from `test/tui/helpers`):

```tsx
const INPUT = { questions: [
  { question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red", description: "warm" }, { label: "blue", description: "cool" }] },
  { question: "Which meals?", header: "Meals", multiSelect: true, options: [{ label: "breakfast", description: "" }, { label: "dinner", description: "" }] },
] };
it("renders the header chip, progress marker, options with descriptions, and the Other row", …);
it("number key on a single-select answers and ADVANCES to question 2 of 2", …);
it("multiSelect: space toggles, enter commits the checked labels joined with ', ' and fires onAnswer with BOTH answers", …);
  // final call: onAnswer({ "Red or blue?": "blue", "Which meals?": "breakfast, dinner" }, undefined)
it("Other: selecting it opens a text line; typed text lands in `response`, the question gets NO answers entry", …);
it("Esc fires onDeny (the model is told no answer is available — never a fabricated one)", …);
it("attribution: subagentType renders 'Subagent (code-reviewer) asks:'", …);
it("malformed input (no questions array) auto-denies on mount", …);
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/tui/questionDialog.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the component**

`src/tui/QuestionDialog.tsx`:

```tsx
// tui/src/QuestionDialog.tsx — the AskUserQuestion dialog (spec Goal B): sequential per-question flow,
// [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row → `response`
// (probe 65E's proven channel; that question gets NO answers entry). Esc = deny — we never fabricate.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ACCENT } from "./theme.js";

export interface QuestionSpec { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect: boolean }

export function parseQuestions(input: Record<string, unknown>): QuestionSpec[] {
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((q: any) => ({
    question: String(q?.question ?? ""), header: q?.header ? String(q.header) : undefined,
    options: Array.isArray(q?.options) ? q.options.map((o: any) => ({ label: String(o?.label ?? ""), description: o?.description ? String(o.description) : undefined })) : [],
    multiSelect: !!q?.multiSelect,
  }));
}

export function QuestionDialog({ req, onAnswer, onDeny }: {
  req: { input: Record<string, unknown>; subagentType?: string };
  onAnswer: (answers: Record<string, string>, response?: string) => void;
  onDeny: () => void;
}) {
  const questions = parseQuestions(req.input);
  const [qi, setQi] = useState(0);
  const [idx, setIdx] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<string[]>([]);
  const [other, setOther] = useState<string | null>(null);          // null = list mode; string = typing
  const q = questions[qi];
  const otherIdx = q ? q.options.length : 0;                        // the "Other" row sits after the options

  // Advance with this question's contribution; finish after the last one. `response` is ONE string on the
  // SDK output — multiple Other answers join as labeled lines.
  const advance = (value?: string, freeText?: string) => {
    const a = value !== undefined && q ? { ...answers, [q.question]: value } : answers;
    const r = freeText !== undefined && q ? [...responses, questions.length > 1 ? `${q.header ?? q.question}: ${freeText}` : freeText] : responses;
    if (qi + 1 < questions.length) { setAnswers(a); setResponses(r); setQi(qi + 1); setIdx(0); setChecked(new Set()); setOther(null); return; }
    onAnswer(a, r.length ? r.join("\n") : undefined);
  };

  // Malformed/empty questions: auto-deny ON MOUNT (plan-review M7) — rendering null while `pending` is
  // non-null would be an invisible dialog eating the next keypress.
  React.useEffect(() => { if (!q) onDeny(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (!q) return;                                                 // auto-deny (above) is settling this
    if (other !== null) {                                           // free-text mode
      if (key.return) { const t = other.trim(); t ? advance(undefined, t) : setOther(null); return; }
      if (key.escape) { setOther(null); return; }
      if (key.backspace || key.delete) { setOther(other.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setOther(other + input);
      return;
    }
    if (key.escape) { onDeny(); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(otherIdx, i + 1)); return; }
    const num = /^[1-9]$/.test(input) ? Number(input) - 1 : undefined;
    const at = num !== undefined && num <= otherIdx ? num : undefined;
    if (input === " " && q.multiSelect && idx < otherIdx) {         // space toggles (multiSelect only)
      const next = new Set(checked); next.has(idx) ? next.delete(idx) : next.add(idx); setChecked(next); return;
    }
    if (key.return || at !== undefined) {
      const target = at ?? idx;
      if (target === otherIdx) { setOther(""); return; }
      if (q.multiSelect) {
        if (at !== undefined) { const next = new Set(checked); next.has(at) ? next.delete(at) : next.add(at); setChecked(next); return; }
        const picked = [...checked].sort((a, b) => a - b).map((i) => q.options[i].label);
        if (picked.length) advance(picked.join(", "));              // ", " — the SDK's declared join
        return;
      }
      advance(q.options[target].label);
    }
  });

  if (!q) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>{q.header ? <Text color={ACCENT}>[{q.header}] </Text> : null}{q.question}{questions.length > 1 ? <Text dimColor>  [{qi + 1}/{questions.length}]</Text> : null}</Text>
      <Text> </Text>
      {q.options.map((o, i) => (
        <Text key={i} color={i === idx ? ACCENT : undefined}>
          {i === idx ? "❯ " : "  "}{q.multiSelect ? (checked.has(i) ? "[x] " : "[ ] ") : ""}{i + 1}. {o.label}{o.description ? <Text dimColor>  {o.description}</Text> : null}
        </Text>
      ))}
      {other !== null
        ? <Text color={ACCENT}>❯ Other: {other}<Text inverse> </Text></Text>
        : <Text color={idx === otherIdx ? ACCENT : undefined}>{idx === otherIdx ? "❯ " : "  "}{otherIdx + 1}. Other…</Text>}
      <Text dimColor>{q.multiSelect ? "space toggle · enter submit · esc decline" : "↑↓ · number · enter · esc decline"}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: The dispatcher in `ChatApp.tsx`**

Replace the single `state.pending ? <PermissionDialog …>` arm with a kind switch (PlanDialog arrives in T9 — until then `plan` temporarily falls through to `PermissionDialog`, removed next task):

```tsx
{state.pending
  ? state.pending.kind === "question"
    ? <QuestionDialog req={state.pending}
        onAnswer={(answers, response) => resolveDecision({ kind: "question_answer", answers, ...(response ? { response } : {}) })}
        onDeny={() => resolveDecision({ kind: "deny" })} />
    : <PermissionDialog req={state.pending} onDecision={(d) => resolveDecision(d)} />
  : …composer as today…}
```

and give `PermissionDialog`'s title the attribution line (one added `<Text dimColor>` when `req.subagentType` is set — pass the whole `PendingDecision` through; its props type widens by the two optional fields).

- [ ] **Step 5: Run green** — `npx vitest run test/tui && npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/QuestionDialog.tsx src/tui/ChatApp.tsx src/tui/PermissionDialog.tsx test/tui
git commit -m "feat(gb8): QuestionDialog (sequential, multiSelect, Other→response) + kind dispatcher + dialog attribution"
```

---

### Task 9: `PlanDialog`

**Files:**
- Create: `src/tui/PlanDialog.tsx`
- Modify: `src/tui/ChatApp.tsx` (dispatcher arm)
- Test: `test/tui/planDialog.test.tsx` (create)

**Interfaces:**
- Consumes: `resolveDecision` (T7), dispatcher (T8).
- Produces: `PlanDialog({ req, onDecision })` — `req: { input: Record<string, unknown>; subagentType?: string }`, `onDecision(o: { kind: "plan_approve"; acceptEdits: boolean } | { kind: "plan_reject"; feedback?: string })`.

- [ ] **Step 1: Write the failing tests**

`test/tui/planDialog.test.tsx`:

```tsx
const REQ = { input: { plan: "# Build it\n\n- step one\n- step two" } };
it("renders the plan body (markdown-rendered) and the three CC choices", …);
it("1 fires plan_approve acceptEdits:true; 2 fires plan_approve acceptEdits:false", …);
it("3 opens the feedback line; enter sends plan_reject with the typed feedback", …);
it("esc opens the feedback line too (esc = keep planning, CC shape); enter on EMPTY feedback sends plan_reject with no feedback (the gate supplies the default copy)", …);
it("↑/↓ scroll a long plan (first visible line changes; the choices stay put)", …);
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/tui/planDialog.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/tui/PlanDialog.tsx`:

```tsx
// tui/src/PlanDialog.tsx — the ExitPlanMode approval dialog (spec Goal B, probe 66): the plan rendered
// as markdown in a scrollable window, then CC's three choices. Approval releases the park; the CLI flips
// the mode itself and the HOST layers the acceptEdits upgrade on its status frame — this component only
// reports the human's choice. Reject opens a one-line feedback input (deny message the model sees).
import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { renderMarkdown } from "./markdown.js";
import { ACCENT } from "./theme.js";

const WINDOW = 14;   // visible plan lines; ↑/↓ scrolls when longer

export function PlanDialog({ req, onDecision }: {
  req: { input: Record<string, unknown>; subagentType?: string };
  onDecision: (o: { kind: "plan_approve"; acceptEdits: boolean } | { kind: "plan_reject"; feedback?: string }) => void;
}) {
  const lines = useMemo(() => renderMarkdown(String((req.input as { plan?: unknown }).plan ?? "")), [req.input]);
  const [top, setTop] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);    // null = choosing; string = typing
  const maxTop = Math.max(0, lines.length - WINDOW);
  useInput((input, key) => {
    if (feedback !== null) {
      if (key.return) { const t = feedback.trim(); onDecision({ kind: "plan_reject", ...(t ? { feedback: t } : {}) }); return; }
      if (key.escape) { setFeedback(null); return; }
      if (key.backspace || key.delete) { setFeedback(feedback.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setFeedback(feedback + input);
      return;
    }
    if (key.upArrow) { setTop((t) => Math.max(0, t - 1)); return; }
    if (key.downArrow) { setTop((t) => Math.min(maxTop, t + 1)); return; }
    if (input === "1") { onDecision({ kind: "plan_approve", acceptEdits: true }); return; }
    if (input === "2") { onDecision({ kind: "plan_approve", acceptEdits: false }); return; }
    if (input === "3" || key.escape) setFeedback("");
  });
  const visible = lines.slice(top, top + WINDOW);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>Claude has finished planning. <Text color={ACCENT}>Approve this plan?</Text></Text>
      {top > 0 ? <Text dimColor>… ↑ {top} more</Text> : null}
      {visible.map((l, i) => <Text key={top + i} dimColor={l.dim} color={l.color}>{l.text}</Text>)}
      {top < maxTop ? <Text dimColor>… ↓ {maxTop - top} more</Text> : null}
      <Text> </Text>
      {feedback !== null
        ? <Text color={ACCENT}>❯ What should Claude do differently? {feedback}<Text inverse> </Text></Text>
        : (<>
            <Text>1. Yes, and auto-accept edits</Text>
            <Text>2. Yes, and manually approve edits</Text>
            <Text>3. No, keep planning (esc)</Text>
            <Text dimColor>↑↓ scroll · 1/2/3 · esc</Text>
          </>)}
    </Box>
  );
}
```

(If `renderMarkdown`'s return shape differs from `{ text, dim?, color? }[]`, follow its actual `RenderLine` type — check `src/tui/render.ts` before writing the map line.)

- [ ] **Step 4: Dispatcher arm in `ChatApp.tsx`** — insert between the question and permission arms:

```tsx
: state.pending.kind === "plan"
  ? <PlanDialog req={state.pending} onDecision={(o) => resolveDecision(o)} />
```

- [ ] **Step 5: Run green** — `npx vitest run test/tui && npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/PlanDialog.tsx src/tui/ChatApp.tsx test/tui/planDialog.test.tsx
git commit -m "feat(gb9): PlanDialog — markdown plan window, CC's three choices, reject-with-feedback"
```

---

### Task 10: `BgTasksPanel`, Ctrl+B, status-bar count

**Files:**
- Create: `src/tui/BgTasksPanel.tsx`
- Modify: `src/tui/ChatApp.tsx`, `src/tui/ChatStatusBar.tsx`
- Test: `test/tui/bgTasksPanel.test.tsx` (create), `test/tui/chat.test.tsx` (extend: Ctrl+B routing)

**Interfaces:**
- Consumes: `state.bgTasks`/`state.bgPanelOpen`, `openBgPanel`/`closeBgPanel`/`stopBgTask`/`backgroundNow` (T7).
- Produces: `BgTasksPanel({ tasks, onStop, onClose })` — `tasks: BackgroundTaskInfo[]`, `onStop(task_id)`, `onClose()`.

- [ ] **Step 1: Write the failing tests**

`test/tui/bgTasksPanel.test.tsx`:

```tsx
const TASKS = [{ task_id: "abc12345xyz", task_type: "local_bash", description: "sleep 999" }, { task_id: "def", task_type: "agent", description: "reviewing" }];
it("renders one row per task (short id · type · description) and an empty-state line when none", …);
it("↑/↓ move the selection; k stops the SELECTED task (x too); esc closes", …);
```

`test/tui/chat.test.tsx` additions: Ctrl+B while `busy` calls `backgroundNow` (fake session records `background()`); Ctrl+B while idle opens the panel; the status bar shows `⚙ 2 bg` when `bgTasks` has two entries and nothing when empty. `test/tui/components.test.tsx`: add the `bgCount` cases replacing the `subagentActive` ones T7 deleted (M4).

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/tui/bgTasksPanel.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

`src/tui/BgTasksPanel.tsx`:

```tsx
// tui/src/BgTasksPanel.tsx — background work (shells, subagents, workflow tasks — ONE stream, spec Goal
// B). Named against the one-letter trap: TaskPanel.tsx is the model's todo checklist, a different thing.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { BackgroundTaskInfo } from "../session/session.js";
import { ACCENT } from "./theme.js";

export function BgTasksPanel({ tasks, onStop, onClose }: { tasks: BackgroundTaskInfo[]; onStop: (taskId: string) => void; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const sel = Math.min(idx, Math.max(0, tasks.length - 1));
  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(tasks.length - 1, i + 1)); return; }
    if ((input === "k" || input === "x") && tasks[sel]) onStop(tasks[sel].task_id);
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Background tasks</Text>
      {tasks.length === 0 ? <Text dimColor>none running</Text> : tasks.map((t, i) => (
        <Text key={t.task_id} color={i === sel ? ACCENT : undefined}>{i === sel ? "❯ " : "  "}{t.task_id.slice(0, 8)} · {t.task_type} · {t.description}</Text>
      ))}
      <Text dimColor>↑↓ · k/x stop · esc close</Text>
    </Box>
  );
}
```

`src/tui/ChatApp.tsx`:
- Ctrl+B in the top-level `useInput` (with Ctrl-L/Z/C — it conflicts with nothing):

```tsx
if (key.ctrl && input === "b") { state.busy ? backgroundNow() : openBgPanel(); disarm(); return; }
```

- Mount the panel with the pickers (it takes input focus like them — insert as the first popup arm so an open panel wins):

```tsx
{state.bgPanelOpen
  ? <BgTasksPanel tasks={state.bgTasks} onStop={stopBgTask} onClose={closeBgPanel} />
  : …existing modelPicker/picker/pending/composer chain…}
```

`src/tui/ChatStatusBar.tsx` — replace the `subagentActive` prop with `bgCount?: number`:

```tsx
<Text>{bgCount ? `  ⚙ ${bgCount} bg` : ""}</Text>
```

and `ChatApp` passes `bgCount={state.bgTasks.length}`.

- [ ] **Step 4: Run green** — `npx vitest run test/tui test/unit && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui test/tui
git commit -m "feat(gb10): BgTasksPanel + Ctrl+B (background mid-turn / panel when idle) + status-bar bg count"
```

---

### Task 11: Docs close-out

**Files:**
- Modify: `../docs/parity/tui-ux.md` (control-plane axis), `../docs/parity/coverage.md`, `../docs/superpowers/specs/2026-07-26-clone-process-surface-spine-design.md` (Goal-boundary table), `../docs/parity/full-use-checklist.md` + `.ko.md` (new walkthrough steps)

(paths relative to `harness/`; these live under `CC-to-SDK/docs/`)

- [ ] **Step 1:** `tui-ux.md`: add a new section "§8 Control plane" scoring rows for: AskUserQuestion dialog · plan-mode approval dialog (move the existing ❌ row from §4 into it, now ✅) · plan on the Tab ladder · Ctrl+B background · /bg panel · task lifecycle notices · subagent attribution on dialogs · status-bar mode truth. Score each honestly against real CC; recompute the affected totals; note the accepted divergences (sequential questions, /bg not /tasks).
- [ ] **Step 2:** `coverage.md`: update the affected domain rows (permissions/dialog surface, background tasks, subagent view) with one-line pointers to the shipped surfaces and probes 65/66.
- [ ] **Step 3:** Spine spec: flip the Goal-boundary table's Goal B row to ✅ with a pointer to the Goal B spec.
- [ ] **Step 4:** `full-use-checklist.md` (+ `.ko.md`): append three walkthrough steps with exact commands: the question park→attach→answer flow, the plan-mode loop, Ctrl+B + /bg. Verify every command against the source before writing it.
- [ ] **Step 5: Commit**

```bash
git add ../docs
git commit -m "docs(gb11): control-plane axis in tui-ux, coverage + spine + checklist close-out"
```

---

### Task 12: Final verification — full gate + the spec's acceptance, live

**Files:**
- Create: live drivers under `$CLAUDE_JOB_DIR/tmp/` (NOT committed): `acc-q.mjs` (acceptance ①), `acc-plan.mjs` (②), `acc-bg.mjs` (③), `acc-attr.mjs` (④) — pty-driven via the existing `ptyrun.py` relay pattern (python `pty.fork`; BSD `script` cannot do this).

The keyless halves and the live halves of the spec's Acceptance section, executed as written. **The controller runs the live halves** (implementers stop at the clean keyless skip). Auth: `set -a; . ../.env; set +a` from `harness/`; never print the token.

- [ ] **Step 1: The full keyless gate — integration INCLUDED**

Run: `npm run typecheck && npx vitest run test/unit test/tui test/contract test/integration && npm run build`
Expected: PASS everywhere; live suites skip cleanly keyless. (`test/integration` exercises the real UDS park/answer wire this branch renamed end-to-end — the suite that caught both prior stages' worst defects; plan-review I2.) Also confirm `test/integration/host-client.test.ts` gained one keyless **question round-trip over a real socket** (park `kind:"question"` → structured `answer` op → broker resolves `question_answer` → `decision_settled` observed by a second client) — if no earlier task added it, add it now.

- [ ] **Step 2: Acceptance ⑤ keyless refusals (spec verbatim)**

Unit-level checks already cover: `answer` op kind-mismatch rejected with the park intact (T3 test); ladder cycles through `plan` (T7 test); `/bg` opens on an idle keyless host with an empty list (T7/T10 tests). Confirm each test exists and names the acceptance item in a comment; add any missing one now.

- [ ] **Step 3: Acceptance ① — question round-trip, detached (live, scripted pty)**

Driver `acc-q.mjs` (model the structure on A2b's `acc56.mjs` — isolated `CCX_FLEET_ROOT` mkdtemp, `agents --json --all` polling, `ptyrun.py` ptys):

1. `node dist/cli/bin.js --bg --permission-mode default -n accq "Use the AskUserQuestion tool to ask me ONE question: whether I prefer red or blue (options red and blue). After my answer, reply with exactly CHOSE:<label>."` — NO ask-rule settings needed (probe 65: always-ask).
2. Poll until `state:"blocked"` AND `waitingFor` starts `question:` (assert the prefix — this is the spec's `waitingFor` check).
3. pty `attach accq` → waitFor `/Red or blue|red or blue/i` and `/blue/` (the dialog with both options). Send `\x1a` (Ctrl+Z) → assert detach notice; roster still `blocked` (park intact — A2b acceptance-6 shape).
4. Re-attach → waitFor the dialog → send `"2"` (selects blue) → poll roster `done`; assert the transcript tail (`agents` row sessionId → disk transcript, or a follow-up `attach` render) contains `CHOSE:blue`.
5. **Second run (the Other channel through the full UI):** same spawn with `-n accq2`; attach; navigate to Other (`↓↓` + enter, or press `3`), type `green actually` + enter; poll `done`; assert the model's output reflects the free text (grep `green`).

Expected: both runs PASS end-to-end.

- [ ] **Step 4: Acceptance ② — plan loop (live)**

Driver `acc-plan.mjs`: foreground pty `node dist/cli/bin.js -n accplan --permission-mode plan` in a mkdtemp cwd:
1. waitFor the banner; submit `Plan how to create hello.txt containing exactly 'hi'. Keep it to 2 steps, then exit plan mode.`
2. waitFor the PlanDialog (`/Approve this plan/`). Press `3`, type `hello.txt must contain 'hello world' instead` + enter.
3. waitFor a SECOND PlanDialog (the model revised and re-called — probe 66's loop). Press `1` (approve & auto-accept).
4. Assert the status bar reaches `mode acceptEdits` (the pushed state event — the spec's visible-mode check) and the subsequent Write runs with NO further dialog; the file lands with `hello world`.

Known small race, pre-armed (plan-review M6): the `acceptEdits` setter is issued on the observed status frame while the CLI is already executing — a very fast first Write under the interim `default` mode can park one permission dialog. If that happens: answer it once (`1`), record it as a Surprise in the spec (it is the spec-mandated ordering's accepted window), and the run still PASSES on the remaining asserts.

Expected: PASS.

- [ ] **Step 5: Acceptance ③ — background shell (live, scripted pty)**

Driver `acc-bg.mjs`: foreground pty `node dist/cli/bin.js -n accbg`:
1. Submit `Run the bash command: sleep 60 && echo BG-DONE. Use the Bash tool.` (add `--settings '{"permissions":{"allow":["Bash(*)"]}}'` at spawn so no permission dialog interferes).
2. While the turn runs (spinner visible), send `\x02` (Ctrl+B) → assert the turn CONTINUES and a `tasks_changed`-driven `⚙ 1 bg` appears in the status bar.
3. Send `/bg\r` → the panel lists the task; press `k` → assert the stopped notice renders (`◼ task stopped` or the CLI's equivalent summary) and the count clears.

Expected: PASS.

- [ ] **Step 6: Acceptance ④ — attribution (live)**

Driver `acc-attr.mjs`: `--bg` spawn with `--settings '{"permissions":{"ask":["Bash(*)"]}}'` and a prompt that dispatches a subagent which MUST run a bash command (e.g. `Use the Agent tool with a general-purpose subagent to run the bash command 'echo ATTR-OK' and report its output.`). Poll `blocked`; attach; assert the dialog title contains `Subagent (` — **or**, if nested calls turn out not to consult the broker (the spec's carried premise), record the negative: assert instead that task started/done notices and the panel row appeared, and update the spec's premise note + Surprises (the recorded fallback). Either outcome closes the acceptance; a stall/timeout does not.

- [ ] **Step 7: Acceptance ⑥ + ledger**

Confirm Task 11's docs landed (tui-ux axis, coverage, spine table, checklist). Append the acceptance verdict table (①–⑤ with evidence one-liners) to the spec's `## Outcomes & Retrospective`, and record any Surprises found during acceptance. Commit:

```bash
git add ../docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md
git commit -m "docs(gb12): Goal B acceptance executed — outcomes recorded"
```

---

## Plan self-review notes (author-run)

- **Spec coverage:** decision park+kinds (T1–T3) · gate answer channels (T2, probes 65/65E/66 mapped) · wire ops/events + compat alias (T3/T6) · session onFrame + between-turn frames (T4) · mode sync + upgrade ordering + attribution (T5) · REPL dialogs/ladder/panel/notices/status-bar (T7–T10) · quartet parameterized (T3) · docs axis (T11) · acceptance ①–⑥ verbatim (T12). Non-goals honored: no daemon changes (T1 aliases are zero-touch), no swarm changes, no drill-in view, no auto-answer anywhere.
- **Type consistency spot-checks:** `DecisionOutcome` kinds are `allow_once|allow_always|deny|question_answer|plan_approve|plan_reject` everywhere (ops schema T3, host validation T3, remote flat/structured split T6, useChat notices T7, dialogs T8/T9). `PendingDecision.kind` defaulted `"permission"` in exactly two places by design: the store's park (T1) and the client's read alias (T6).
- **Known-risk notes for implementers:** the T3 rename's blast radius is deliberately absorbed there (full unit suite in its gate); `renderMarkdown`'s exact `RenderLine` shape must be checked before T9's map line; ink `useInput` tests must await a tick before keys (harness/CLAUDE.md).



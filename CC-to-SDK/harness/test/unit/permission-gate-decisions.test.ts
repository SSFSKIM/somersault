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

  // --- F6 Task 3: the widened wire. sdk.d.ts's CanUseTool options carry the engine's own suggestion
  // payload; PermissionResult's allow arm carries `updatedPermissions` back. Probe 78 proved the round
  // trip; these pin that the gate neither drops nor reshapes either direction.
  it("forwards suggestions/decisionReason/blockedPath/agentID from the SDK options into the broker request", async () => {
    const seen: PermissionRequest[] = [];
    const suggestions = [{ type: "addRules", rules: [{ toolName: "Read", ruleContent: "//tmp/out/**" }], behavior: "allow", destination: "session" }];
    await gateWith({ kind: "allow_once" }, seen)("Read", { file_path: "/tmp/out/a.txt" }, {
      ...opts, suggestions, decisionReason: "Path is outside allowed working directories", blockedPath: "/tmp/out/a.txt", agentID: "agent_7",
    });
    expect(seen[0].suggestions).toBe(suggestions);       // the SAME array — verbatim, not copied-and-reshaped
    expect(seen[0].decisionReason).toBe("Path is outside allowed working directories");
    expect(seen[0].blockedPath).toBe("/tmp/out/a.txt");
    expect(seen[0].agentID).toBe("agent_7");
  });

  it("omits the four fields when the engine sends none (no undefined-shaped noise beyond the optional keys)", async () => {
    const seen: PermissionRequest[] = [];
    await gateWith({ kind: "allow_once" }, seen)("Read", {}, opts);
    expect(seen[0].suggestions).toBeUndefined();
    expect(seen[0].decisionReason).toBeUndefined();
    expect(seen[0].blockedPath).toBeUndefined();
    expect(seen[0].agentID).toBeUndefined();
  });

  it("allow_with_updates → allow echoing updatedPermissions VERBATIM (probe 78's don't-ask-again)", async () => {
    const updatedPermissions = [{ type: "addRules", rules: [{ toolName: "Read", ruleContent: "//tmp/out/**" }], behavior: "allow", destination: "localSettings" }];
    const input = { file_path: "/tmp/out/a.txt" };
    const r = await gateWith({ kind: "allow_with_updates", updatedPermissions })("Read", input, opts) as any;
    expect(r).toEqual({ behavior: "allow", updatedInput: input, updatedPermissions });
    expect(r.updatedPermissions).toBe(updatedPermissions);   // same reference: nothing in the pipeline rebuilt it
  });

  it("allow_with_updates does NOT also populate the in-memory allowlist — the rule replaces it", async () => {
    const seen: PermissionRequest[] = [];
    const gate = gateWith({ kind: "allow_with_updates", updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] }, seen);
    await gate("Edit", {}, opts);
    await gate("Edit", {}, { ...opts, toolUseID: "t2" });
    expect(seen.map((r) => r.toolUseID)).toEqual(["t1", "t2"]);   // consulted BOTH times
  });

  it("allow_once carries an edited updatedInput through, and falls back to the original input without one", async () => {
    const edited = { command: "ls -a" };
    expect(await gateWith({ kind: "allow_once", updatedInput: edited })("Bash", { command: "ls" }, opts))
      .toEqual({ behavior: "allow", updatedInput: edited });
    expect(await gateWith({ kind: "allow_once" })("Bash", { command: "ls" }, opts))
      .toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });

  it("deny feedback becomes the deny MESSAGE (the only channel to the model — allow has no message field)", async () => {
    expect(await gateWith({ kind: "deny", feedback: "use rg instead" })("Bash", {}, opts))
      .toEqual({ behavior: "deny", message: "use rg instead", interrupt: undefined });
    // whitespace-only feedback is not feedback: fall back to the kind-specific copy
    expect(((await gateWith({ kind: "deny", feedback: "   " })("Bash", {}, opts)) as any).message).toBe("User denied Bash");
  });

  it("plan_approve echoes updatedPermissions when present and omits the key entirely when absent", async () => {
    const updatedPermissions = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
    expect(await gateWith({ kind: "plan_approve", acceptEdits: true, updatedPermissions })("ExitPlanMode", { plan: "p" }, opts))
      .toEqual({ behavior: "allow", updatedInput: { plan: "p" }, updatedPermissions });
    const plain = await gateWith({ kind: "plan_approve", acceptEdits: true })("ExitPlanMode", { plan: "p" }, opts) as any;
    expect("updatedPermissions" in plain).toBe(false);
  });

  // F6 T9 / DG34: the human edited the plan in $EDITOR from the dialog, so the text THEY left is what the
  // tool runs on. Upstream is `updatedInput: planEditedLocally ? {plan: currentPlan} : {}` (`lYf` L500722);
  // ours merges so an unrelated argument survives the edit.
  it("plan_approve carrying an edited plan overrides only that key, and an absent one changes nothing", async () => {
    const input = { plan: "# The plan", extra: 1 };
    expect(await gateWith({ kind: "plan_approve", acceptEdits: false, plan: "# Edited" })("ExitPlanMode", input, opts))
      .toEqual({ behavior: "allow", updatedInput: { plan: "# Edited", extra: 1 } });
    expect(await gateWith({ kind: "plan_approve", acceptEdits: false })("ExitPlanMode", input, opts))
      .toEqual({ behavior: "allow", updatedInput: input });
    // an EMPTY edited plan is still an edit — the human deleted it on purpose, and "" is not "absent"
    expect((await gateWith({ kind: "plan_approve", acceptEdits: false, plan: "" })("ExitPlanMode", input, opts) as any).updatedInput.plan).toBe("");
  });

  it("a pre-aborted signal still denies with the kind-specific copy, ahead of any widened arm", async () => {
    const seen: PermissionRequest[] = [];
    const ac = new AbortController(); ac.abort();
    const r = await gateWith({ kind: "allow_with_updates", updatedPermissions: [{ type: "setMode" }] }, seen)("Bash", {}, { ...opts, signal: ac.signal });
    expect(r).toEqual({ behavior: "deny", message: "User denied Bash", interrupt: true });
    expect(seen).toHaveLength(0);
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

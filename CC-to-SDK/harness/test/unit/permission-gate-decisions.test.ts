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

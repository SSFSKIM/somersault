// test/unit/gate-plan-kind.test.ts — Wave T t11 (e): the ONE literal that turns a tool consult into a plan
// dialog, pinned against the engine's own spelling.
//
// probe 97 (`probes/probes/97-plan-decision-wire-shape.ts`, answer A3) settled the classification question the
// negative way. Of the ten fields the engine puts on `canUseTool`'s third argument, an ExitPlanMode consult
// defines only FOUR — `signal`, `toolUseID`, `requestId` and `displayName:"ExitPlanMode"` (the raw tool name,
// not a human phrase) — while `suggestions`, `blockedPath`, `decisionReason`, `title`, `description` and
// `agentID` are all undefined. There is no flag, no reason type, no kind marker. The literal `"ExitPlanMode"`
// in `gate.ts`'s `routeDecisionKind` is therefore the entire signal.
//
// WHY THIS FILE EXISTS. If upstream renames the tool, NOTHING in this repo throws. `routeDecisionKind` falls
// through to its default, every plan consult is routed to the generic 3-way permission dialog — no plan body,
// no markdown, none of the approve-with-mode arms, just "allow / deny ExitPlanModeV3" over a raw JSON input —
// and the whole suite stays green, because every other test feeds the literal in itself. That is a SILENT
// degradation of the single highest-stakes consult ccx renders. This test makes the rename a red test.
import { describe, expect, it } from "vitest";
import { createPermissionGate, routeDecisionKind } from "../../src/permissions/gate.js";
import type { PermissionRequest } from "../../src/permissions/types.js";

const opts = { signal: new AbortController().signal, toolUseID: "t1" };
const gateSeeing = (seen: PermissionRequest[]) =>
  createPermissionGate({ request: async (req) => { seen.push(req); return { kind: "deny" as const }; } });

describe("routeDecisionKind — the plan literal (probe 97 A3: name is the only signal)", () => {
  it("classifies EXACTLY `ExitPlanMode`, character for character", () => {
    expect(routeDecisionKind("ExitPlanMode")).toBe("plan");
    // Every near miss is a generic permission — which is precisely the silent degradation being guarded.
    for (const name of ["exitplanmode", "ExitPlanmode", "ExitPlanModeV2", "ExitPlanMode ", "EnterPlanMode", "mcp__x__ExitPlanMode", "Plan"]) {
      expect(routeDecisionKind(name)).toBe("permission");
    }
  });

  it("keeps the other name-driven route intact (AskUserQuestion, probe 65)", () => {
    expect(routeDecisionKind("AskUserQuestion")).toBe("question");
    expect(routeDecisionKind("Bash")).toBe("permission");
  });
});

describe("the gate's plan routing end to end", () => {
  it("stamps kind:'plan' on the broker request, so the client mounts PlanDialog and not the 3-way", async () => {
    const seen: PermissionRequest[] = [];
    await gateSeeing(seen)("ExitPlanMode", { plan: "# ship it", planFilePath: "/tmp/p.md" }, opts);
    expect(seen[0]!.kind).toBe("plan");
    expect(seen[0]!.input).toEqual({ plan: "# ship it", planFilePath: "/tmp/p.md" });   // forwarded verbatim
  });

  it("SHOWS the degradation a rename would cause: the deny copy stops being the plan family's", async () => {
    const plan = await createPermissionGate({ request: async () => ({ kind: "deny" }) })("ExitPlanMode", {}, opts) as { message: string };
    expect(plan.message).toBe("User rejected the plan. Continue planning.");
    const renamed = await createPermissionGate({ request: async () => ({ kind: "deny" }) })("ExitPlanModeV3", {}, opts) as { message: string };
    expect(renamed.message).toBe("User denied ExitPlanModeV3");                          // the generic copy
  });
});

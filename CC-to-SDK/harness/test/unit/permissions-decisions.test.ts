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

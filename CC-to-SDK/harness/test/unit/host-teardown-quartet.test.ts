// harness/test/unit/host-teardown-quartet.test.ts — the teardown quartet, parameterized over all three
// decision kinds (spec: "written before the wire lands"). Mirrors host-park.test.ts's fixture shape.
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-quartet-"));
const fakeSession = (order?: string[]) => ({
  sessionId: "sid", submit: async () => undefined, dispose: async () => {},
  interrupt: async () => { order?.push("session-interrupt"); },
});

function hostFor(order?: string[]) {
  const env = { CCX_FLEET_ROOT: tmpFleet() };
  const host = new SessionHost({ short: "cccccccc", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env },
    { openSession: () => fakeSession(order), procStartOf: async () => "start" });
  return { host };
}

const KINDS = [
  { kind: "permission" as const, toolName: "Bash", answer: { kind: "allow_once" as const }, settledAs: "allow_once" },
  { kind: "question" as const, toolName: "AskUserQuestion", answer: { kind: "question_answer" as const, answers: { q: "a" } }, settledAs: "question_answer" },
  { kind: "plan" as const, toolName: "ExitPlanMode", answer: { kind: "plan_approve" as const, mode: "default" as const }, settledAs: "plan_approve" },
];

describe.each(KINDS)("teardown quartet [$kind]", ({ kind, toolName, answer }) => {
  it("1. stop() settles the park with deny and emits decision_settled by:system", async () => {
    const { host } = hostFor(); await host.start();
    const seen: any[] = [];
    host.follow((e) => seen.push(e));
    const decision = host.broker().request({ toolName, input: {}, toolUseID: "t1", kind, signal: new AbortController().signal });
    await host.stop();
    await expect(decision).resolves.toEqual({ kind: "deny" });
    expect(seen).toContainEqual({ kind: "decision_settled", toolUseID: "t1", by: "system", decision: "deny" });
  });

  it("2. interrupt() settles the park and emits, before the session interrupt", async () => {
    const order: string[] = [];
    const { host } = hostFor(order); await host.start();
    host.follow((e) => { if (e.kind === "decision_settled") order.push("decision_settled"); });
    const decision = host.broker().request({ toolName, input: {}, toolUseID: "t2", kind, signal: new AbortController().signal });
    await host.interrupt();
    await expect(decision).resolves.toEqual({ kind: "deny" });
    expect(order).toEqual(["decision_settled", "session-interrupt"]);
    await host.stop();
  });

  it("3. first answer wins; the second answerer is told who", async () => {
    const { host } = hostFor(); await host.start();
    const decision = host.broker().request({ toolName, input: {}, toolUseID: "t3", kind, signal: new AbortController().signal });
    const first = host.answer("t3", answer, "alice");
    expect(first).toEqual({ ok: true });
    const second = host.answer("t3", answer, "bob");
    expect(second).toEqual({ ok: true, alreadyAnsweredBy: "alice" });
    await decision;
    await host.stop();
  });

  it("4. answering after settle reports no parked request (stale id ≠ silent ok)", async () => {
    const { host } = hostFor(); await host.start();
    const reply = host.answer("never-parked-" + kind, answer, "x");
    expect(reply).toEqual({ ok: false, error: `no parked request never-parked-${kind}` });
    await host.stop();
  });
});

// BL6 Fix B, the host half. The REPL's question dialog now answers Esc with a declined deny AND an interrupt,
// which is native's "one Esc, turn over": what makes that safe is that `interrupt()` settles the SIBLING parks
// too, so the queued questions' dialogs cannot outlive the turn they belonged to.
//
// WHAT THE SIBLINGS TELL THE MODEL IS NOT DECIDED HERE, and cannot be pinned keyless. Probe 109 arm D measured
// it live: an interrupt over parked calls never reaches `denyMessage()` at all — the CLI's own cancellation
// wins the race and the engine sends its canonical rejection text (the same sentence `TOOL_DECLINED` quotes).
// So the bare deny below is the outcome the PARK resolves with, not the copy the model reads.
describe("BL6: declining one question sweeps its siblings", () => {
  it("interrupt() settles every remaining question park, and the answered one keeps its own outcome", async () => {
    const { host } = hostFor(); await host.start();
    const ac = new AbortController();
    const req = (id: string) => host.broker().request({ toolName: "AskUserQuestion", input: {}, toolUseID: id, kind: "question", signal: ac.signal });
    const [head, sib1, sib2] = [req("q1"), req("q2"), req("q3")];
    expect(host.answer("q1", { kind: "deny", reason: "declined" }, "human")).toEqual({ ok: true });
    await expect(head).resolves.toEqual({ kind: "deny", reason: "declined" });
    expect(host.pending().map((e) => e.toolUseID)).toEqual(["q2", "q3"]);
    await host.interrupt();
    await expect(sib1).resolves.toEqual({ kind: "deny" });      // bare: the SYSTEM settled these, not a human
    await expect(sib2).resolves.toEqual({ kind: "deny" });
    expect(host.pending()).toEqual([]);
    await host.stop();
  });
});

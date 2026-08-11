import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { SessionHost } from "../../src/host/host.js";
import { hostSocketPath } from "../../src/fleet/paths.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-park-"));
const fakeSession = () => ({ sessionId: "sid", submit: async () => undefined, dispose: async () => {} });

/** `detached` mirrors the real spawn contract: a bg host is ALWAYS detached (that is the entire point of
 *  a worker that outlives its terminal), so it defaults true; an interactive host defaults false (an
 *  in-process host whose UI is gone) unless a test is specifically about the --detachable case, which
 *  passes `true` explicitly. */
function hostFor(kind: "bg" | "interactive", detached: boolean = kind === "bg") {
  const env = { CCX_FLEET_ROOT: tmpFleet() };
  const host = new SessionHost({ short: "bbbbbbbb", name: "t", cwd: "/tmp", kind, detached, config: {} as never, env },
    { openSession: () => fakeSession(), procStartOf: async () => "start" });
  return { host, env };
}

const ask = (host: SessionHost, toolUseID = "t1") =>
  host.broker().request({ toolName: "Bash", input: { command: "ls" }, toolUseID, signal: new AbortController().signal });

/** Opens a bare client socket to the host's UDS and nothing more — no `follow()`. Proves the deny rule
 *  counts live CONNECTIONS, not `follow()` subscriptions: this client is present but never follows. */
function connectClient(env: NodeJS.ProcessEnv) {
  const s = connect({ path: hostSocketPath(process.pid, env) });
  s.on("error", () => {});
  return { ready: new Promise<void>((r) => s.once("connect", () => r())), close: () => s.destroy() };
}

describe("host park policy", () => {
  it("a bg host parks with no follower attached, and reports blocked", async () => {
    const { host } = hostFor("bg"); await host.start();
    const decision = ask(host);
    expect(host.pending()).toHaveLength(1);
    expect(host.status()).toMatchObject({ state: "blocked", status: "idle", waitingFor: "permission:Bash" });
    host.answer("t1", { kind: "allow_once" }, "test");
    await expect(decision).resolves.toEqual({ kind: "allow_once" });
    expect(host.status().state).not.toBe("blocked");
    await host.stop();
  });

  it("an interactive host with NO follower denies immediately instead of hanging", async () => {
    const { host } = hostFor("interactive"); await host.start();
    await expect(ask(host)).resolves.toEqual({ kind: "deny" });
    expect(host.pending()).toHaveLength(0);
    await host.stop();
  });

  it("an interactive host WITH a connected, following client parks", async () => {
    const { host, env } = hostFor("interactive");
    await host.start();
    const c = connectClient(env); await c.ready;
    await vi.waitFor(() => expect((host as unknown as { server: { connectionCount(): number } }).server.connectionCount()).toBe(1));
    host.follow(() => {});
    const decision = ask(host);
    expect(host.pending()).toHaveLength(1);
    host.answer("t1", { kind: "deny" }, "test"); await decision;
    c.close();
    await host.stop();
  });

  it("detaching every follower does NOT deny an already-parked request", async () => {
    // A --detachable interactive host: parking survives every human walking away (Ctrl+Z), because
    // detaching is what a human does in order to go and think about it (spec acceptance 6).
    const { host } = hostFor("interactive", true); await host.start();
    const off = host.follow(() => {});
    const decision = ask(host);
    off();                                        // Ctrl+Z: the human walked away to think
    expect(host.pending()).toHaveLength(1);       // still parked, per acceptance 6
    let settled = false; void decision.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    host.answer("t1", { kind: "allow_once" }, "returned"); await decision;
    await host.stop();
  });

  it("parking emits a decision event to followers", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: string[] = [];
    host.follow((e) => seen.push(e.kind));
    void ask(host);
    expect(seen).toContain("decision");
    host.answer("t1", { kind: "deny" }, "test");
    await host.stop();
  });

  it("stop() settles every parked request so nothing is left awaited", async () => {
    const { host } = hostFor("bg"); await host.start();
    const decision = ask(host);
    await host.stop();
    await expect(decision).resolves.toEqual({ kind: "deny" });
  });

  it("answer() on a toolUseID that was never parked reports the specific error, not a generic failure", async () => {
    const { host } = hostFor("bg"); await host.start();
    expect(host.answer("never-parked", { kind: "deny" }, "x")).toEqual({ ok: false, error: "no parked request never-parked" });
    await host.stop();
  });

  // Minor whole-branch finding: denyAll() (interrupt()/teardown()'s settling path) bypasses answer()'s
  // `decision_settled` emit entirely, so a follower watching a parked request is never told the
  // decision is gone — it can only infer that later from a `turn end` frame, and a client's dialog is
  // stuck showing a request nobody will ever answer.
  it("stop() settling a park via denyAll tells a follower the decision is gone", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: any[] = [];
    host.follow((e) => seen.push(e));
    const decision = ask(host);
    await host.stop();
    await decision;
    const settled = seen.filter((e) => e.kind === "decision_settled");
    expect(settled).toEqual([{ kind: "decision_settled", toolUseID: "t1", by: "system", decision: "deny" }]);
  });

  it("interrupt() settling a park via denyAll ALSO tells a follower, and a late answer is told 'system' got there first", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: any[] = [];
    host.follow((e) => seen.push(e));
    const decision = ask(host);
    await host.interrupt();
    await decision;
    expect(seen.filter((e) => e.kind === "decision_settled"))
      .toEqual([{ kind: "decision_settled", toolUseID: "t1", by: "system", decision: "deny" }]);
    // Consistent with answer()'s own "who got there first" contract (see the settledBy map above) — a
    // human answering the same request after the system already denied it is told so, not given the
    // generic "never parked" error a request the system silently dropped would produce.
    expect(host.answer("t1", { kind: "allow_once" }, "late-human")).toEqual({ ok: true, alreadyAnsweredBy: "system" });
    await host.stop();
  });

  // The scope change itself (spec A2b §4): DETACHEDNESS decides, not kind — a detached host's purpose is
  // surviving unattended (park); an in-process host whose UI is gone has nobody left to answer (deny).
  // And the deny rule counts CONNECTIONS, not `follow()` subscriptions.
  describe("park scope: detachedness, not kind — deny counts connections, not followers", () => {
    it("kind:interactive detached:true with ZERO connections PARKS — the --detachable case", async () => {
      const { host } = hostFor("interactive", true); await host.start();
      const decision = ask(host);
      expect(host.pending()).toHaveLength(1);
      host.answer("t1", { kind: "deny" }, "test"); await decision;
      await host.stop();
    });

    it("kind:interactive detached:false with ZERO connections DENIES", async () => {
      const { host } = hostFor("interactive", false); await host.start();
      await expect(ask(host)).resolves.toEqual({ kind: "deny" });
      expect(host.pending()).toHaveLength(0);
      await host.stop();
    });

    it("a client connected but NOT following still parks a detached:false host — connections, not followers", async () => {
      const { host, env } = hostFor("interactive", false); await host.start();
      const c = connectClient(env); await c.ready;
      await vi.waitFor(() => expect((host as unknown as { server: { connectionCount(): number } }).server.connectionCount()).toBe(1));
      const decision = ask(host);      // no host.follow() at all — present, but not following
      expect(host.pending()).toHaveLength(1);
      host.answer("t1", { kind: "deny" }, "test"); await decision;
      c.close();
      await host.stop();
    });

    it("kind:bg is always spawned detached — pinned parking with detached:true", async () => {
      const { host } = hostFor("bg", true); await host.start();
      const decision = ask(host);
      expect(host.pending()).toHaveLength(1);
      host.answer("t1", { kind: "deny" }, "test"); await decision;
      await host.stop();
    });
  });

  describe("decision kinds: question/plan routing and structured answers (GB T3)", () => {
    it("parks a question with waitingFor question:AskUserQuestion and settles via a structured answer", async () => {
      const { host } = hostFor("bg"); await host.start();
      const seen: any[] = [];
      host.follow((e) => seen.push(e));
      const decision = host.broker().request({
        toolName: "AskUserQuestion", input: { question: "red or blue?" }, toolUseID: "q1", kind: "question",
        signal: new AbortController().signal,
      });
      expect(host.status().waitingFor).toBe("question:AskUserQuestion");
      const parked = seen.find((e) => e.kind === "decision");
      expect(parked?.entry).toMatchObject({ kind: "question", toolUseID: "q1" });
      const reply = host.answer("q1", { kind: "question_answer", answers: { "red or blue?": "blue" } }, "me");
      expect(reply).toEqual({ ok: true });
      await expect(decision).resolves.toEqual({ kind: "question_answer", answers: { "red or blue?": "blue" } });
      // M3 §1a-e: the settlement carries the WHOLE outcome alongside the legacy kind string. This test is
      // the illustration of why — `decision: "question_answer"` alone says a question was answered and
      // loses the answers themselves, which is all a client that did not win the race would ever learn.
      expect(seen).toContainEqual({ kind: "decision_settled", toolUseID: "q1", by: "me", decision: "question_answer",
        answer: { kind: "question_answer", answers: { "red or blue?": "blue" } } });
      await host.stop();
    });

    // Goal B acceptance ⑤ evidence (spec: docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md).
    it("refuses a kind-mismatched answer and keeps the park", async () => {
      const { host } = hostFor("bg"); await host.start();
      const decision = host.broker().request({
        toolName: "AskUserQuestion", input: {}, toolUseID: "q2", kind: "question", signal: new AbortController().signal,
      });
      expect(host.answer("q2", { kind: "allow_once" }, "test")).toEqual({ ok: false, error: "kind mismatch: question park cannot take allow_once" });
      expect(host.pending()).toHaveLength(1);
      let settled = false; void decision.then(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);
      expect(host.answer("q2", { kind: "question_answer", answers: { a: "b" } }, "test")).toEqual({ ok: true });
      await expect(decision).resolves.toEqual({ kind: "question_answer", answers: { a: "b" } });
      await host.stop();
    });

    it("plan_approve arms the mode it GRANTED (consumed by the status-frame handler, Task 5)", async () => {
      const { host } = hostFor("bg"); await host.start();
      const d1 = host.broker().request({ toolName: "ExitPlanMode", input: {}, toolUseID: "p1", kind: "plan", signal: new AbortController().signal });
      expect((host as any).planUpgradeMode).toBeUndefined();
      host.answer("p1", { kind: "plan_approve", mode: "default" }, "test");
      await d1;
      expect((host as any).planUpgradeMode).toBeUndefined();   // the engine reaches `default` on its own

      const d2 = host.broker().request({ toolName: "ExitPlanMode", input: {}, toolUseID: "p2", kind: "plan", signal: new AbortController().signal });
      host.answer("p2", { kind: "plan_approve", mode: "bypassPermissions" }, "test");
      await d2;
      expect((host as any).planUpgradeMode).toBe("bypassPermissions");
      await host.stop();
    });

    it("an SDK-side abort emits decision_settled by:system (the onAutoSettle wiring — NEW, was silent)", async () => {
      const { host } = hostFor("bg"); await host.start();
      const seen: any[] = [];
      host.follow((e) => seen.push(e));
      const ac = new AbortController();
      const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "a1", signal: ac.signal });
      expect(host.pending()).toHaveLength(1);
      ac.abort();   // an SDK-side abort — NOT host.interrupt()/stop()
      await expect(decision).resolves.toEqual({ kind: "deny" });
      expect(seen).toContainEqual({ kind: "decision_settled", toolUseID: "a1", by: "system", decision: "deny" });
      await host.stop();
    });
  });
});

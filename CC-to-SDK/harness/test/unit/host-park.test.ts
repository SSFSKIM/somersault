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

  it("parking emits a permission event to followers", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: string[] = [];
    host.follow((e) => seen.push(e.kind));
    void ask(host);
    expect(seen).toContain("permission");
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
  // `permission_settled` emit entirely, so a follower watching a parked request is never told the
  // decision is gone — it can only infer that later from a `turn end` frame, and a client's dialog is
  // stuck showing a request nobody will ever answer.
  it("stop() settling a park via denyAll tells a follower the decision is gone", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: any[] = [];
    host.follow((e) => seen.push(e));
    const decision = ask(host);
    await host.stop();
    await decision;
    const settled = seen.filter((e) => e.kind === "permission_settled");
    expect(settled).toEqual([{ kind: "permission_settled", toolUseID: "t1", by: "system", decision: "deny" }]);
  });

  it("interrupt() settling a park via denyAll ALSO tells a follower, and a late answer is told 'system' got there first", async () => {
    const { host } = hostFor("bg"); await host.start();
    const seen: any[] = [];
    host.follow((e) => seen.push(e));
    const decision = ask(host);
    await host.interrupt();
    await decision;
    expect(seen.filter((e) => e.kind === "permission_settled"))
      .toEqual([{ kind: "permission_settled", toolUseID: "t1", by: "system", decision: "deny" }]);
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
});

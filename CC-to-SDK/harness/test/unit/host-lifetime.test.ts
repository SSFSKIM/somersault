import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";
import { hostSocketPath } from "../../src/fleet/paths.js";

const tmpFleet = () => ({ CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-lifetime-")) } as NodeJS.ProcessEnv);
/** A turn that resolves on its own — for the plain multi-turn/status assertions. */
const instantSession = () => ({ submit: async () => ({ result: {} }), sessionId: "sid-1", dispose: async () => {} });
/** A turn driven by hand — for the idle-reaper tests, so a "turn in flight" can be held open across a
 *  real-time wait without racing the test. */
function drivable() {
  let resolveTurn!: () => void;
  const turn = new Promise<void>((r) => { resolveTurn = r; });
  return { sessionId: "sid-1", submit: async () => { await turn; return { result: {} }; }, dispose: async () => {}, finish: () => resolveTurn() };
}

function hostFor(kind: "bg" | "interactive", opts: { detached?: boolean; idleTimeoutMs?: number } = {},
  session: () => ReturnType<typeof instantSession> | ReturnType<typeof drivable> = instantSession) {
  const env = tmpFleet();
  const detached = opts.detached ?? kind === "bg";
  const host = new SessionHost(
    { short: "d1d1d1d1", name: "t", cwd: "/tmp", kind, detached, config: {} as never, env,
      ...(opts.idleTimeoutMs ? { idleTimeoutMs: opts.idleTimeoutMs } : {}) },
    { openSession: () => session() as any, procStartOf: async () => "start" },
  );
  return { host, env };
}

/** Opens a bare client socket to the host's UDS — the reaper must defer while a live connection holds. */
function connectClient(env: NodeJS.ProcessEnv) {
  const s = connect({ path: hostSocketPath(process.pid, env) });
  s.on("error", () => {});
  return { ready: new Promise<void>((r) => s.once("connect", () => r())), close: () => s.destroy() };
}
const connectionCountOf = (host: SessionHost) =>
  (host as unknown as { server: { connectionCount(): number } }).server.connectionCount();

describe("SessionHost multi-turn state (A2b)", () => {
  it("after a successful turn, an interactive host reads 'working' (not 'done'); a bg host stays 'done'", async () => {
    const { host: ih } = hostFor("interactive");
    await ih.start(); await ih.runTask("one");
    expect(ih.status()).toMatchObject({ state: "working", status: "idle" });
    await ih.stop();

    const { host: bh } = hostFor("bg");
    await bh.start(); await bh.runTask("one");
    expect(bh.status()).toMatchObject({ state: "done", status: "idle" });
    await bh.stop();
  });

  it("a second runTask succeeds after the first on an interactive host; the roster stays non-terminal until stop()", async () => {
    const { host, env } = hostFor("interactive");
    await host.start();
    await host.runTask("one");
    expect(readRoster("d1d1d1d1", env)!.state).toBe("working");   // non-terminal between turns
    await expect(host.runTask("two")).resolves.toBeUndefined();    // multi-turn: accepted after the first
    expect(readRoster("d1d1d1d1", env)!.state).toBe("working");
    await host.stop("done");
    expect(readRoster("d1d1d1d1", env)!.state).toBe("done");
  });
});

describe("SessionHost.finished", () => {
  it("resolves only once stop() completes, not before", async () => {
    const { host } = hostFor("interactive");
    await host.start();
    let settled = false;
    void host.finished.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 30));   // idle, nothing running — a raced sentinel
    expect(settled).toBe(false);
    await host.stop();
    expect(settled).toBe(true);
  });
});

describe("SessionHost idle reaper", () => {
  it("stops an interactive host with no turn shortly after start()", async () => {
    const { host, env } = hostFor("interactive", { idleTimeoutMs: 100, detached: true });
    await host.start();
    await host.finished;
    expect(readRoster("d1d1d1d1", env)!.state).toBe("done");
  }, 2_000);

  it("a runTask resets the idle timer", async () => {
    const { host, env } = hostFor("interactive", { idleTimeoutMs: 150, detached: true });
    await host.start();
    await new Promise((r) => setTimeout(r, 100));       // most of the way to the original deadline
    await host.runTask("one");                          // resets it
    await new Promise((r) => setTimeout(r, 100));        // would have fired by now without the reset
    expect(readRoster("d1d1d1d1", env)!.state).not.toBe("done");
    await host.stop();
  }, 2_000);

  it("a PARKED turn does not idle out", async () => {
    const s = drivable();
    const { host, env } = hostFor("interactive", { idleTimeoutMs: 100, detached: true }, () => s);
    await host.start();
    const turn = host.runTask("go");
    const decision = host.broker().request({ toolName: "Bash", input: {}, toolUseID: "t1", signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 250));
    expect(readRoster("d1d1d1d1", env)!.state).not.toBe("done");   // the in-flight turn kept it alive
    host.answer("t1", { kind: "deny" }, "test");
    await decision;
    s.finish();
    await turn;
    await host.stop();
  }, 2_000);

  it("a host with a live connection does not idle out; it reaps once that connection drops", async () => {
    const { host, env } = hostFor("interactive", { idleTimeoutMs: 100, detached: true });
    await host.start();
    const c = connectClient(env); await c.ready;
    await vi.waitFor(() => expect(connectionCountOf(host)).toBe(1));
    await new Promise((r) => setTimeout(r, 250));
    expect(readRoster("d1d1d1d1", env)!.state).not.toBe("done");   // the connection kept it alive
    c.close();
    await host.finished;
    expect(readRoster("d1d1d1d1", env)!.state).toBe("done");
  }, 2_000);
});

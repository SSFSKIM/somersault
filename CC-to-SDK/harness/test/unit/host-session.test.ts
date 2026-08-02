import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { Session } from "../../src/session/session.js";
import { AsyncQueue } from "../../src/swarm/asyncQueue.js";
import { readRoster } from "../../src/fleet/roster.js";
import { rosterPath } from "../../src/fleet/paths.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-host-")), HOME: "/home/u" }; });

const opts = () => ({ short: "a1b2c3d4", name: "w1", cwd: "/w", kind: "bg" as const, detached: true, config: {}, env });
/** Always inject procStartOf: a unit test must not spawn `ps`. */
const deps = (openSession: any) => ({ openSession, procStartOf: async () => "Sat Jul 25 02:55:52 2026" });
/** A fake session: resolves the turn only when we let it, so we can observe `working` mid-flight.
 *  `emitInit()` delivers a frame to the turn's onMessage the way the real Session does — it sets
 *  .sessionId from the engine's init frame BEFORE dispatching it — so the mid-turn stamp is observable. */
function fakeSession() {
  let finish!: () => void;
  let onMessage: ((m: unknown) => void) | undefined;
  const turn = new Promise<void>((r) => (finish = r));
  return {
    finish,
    emitInit: () => onMessage?.({ type: "system", subtype: "init", session_id: "sid-1" }),
    session: { submit: async (_p: string, om: (m: unknown) => void) => { onMessage = om; await turn; return { result: {} }; },
      sessionId: "sid-1", dispose: async () => {} },
  };
}
/** A session whose turns resolve on their own — for the multi-turn edges, where a latch would deadlock. */
const instantSession = () => ({ submit: async () => ({ result: {} }), sessionId: "sid-1", dispose: async () => {} });
function framedSession() {
  const frames = new AsyncQueue<unknown>();
  const session = new Session({ query: () => ({ [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator]() }) }, {});
  return { frames, session };
}
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SessionHost", () => {
  it("writes a working roster row at start, before any session id exists", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ short: "a1b2c3d4", name: "w1", state: "working", kind: "bg" });
    // toMatchObject ignores extra keys, and the fake reports a sessionId from construction (the real
    // getter stays undefined until the engine's first init frame) — so pin the absence explicitly.
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBeUndefined();
    await h.stop();
  });
  it("records its own procStart, so a crashed host can later be told apart from a live one", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.procStart).toBe("Sat Jul 25 02:55:52 2026");
    await h.stop();
  });
  it("warns when procStartOf cannot run at all — a silently missing procStart reads live forever", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = new SessionHost(opts(), { openSession: () => fakeSession().session as any, procStartOf: async () => { throw new Error("spawn ps ENOENT"); } });
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.procStart).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("procStart"));
    warn.mockRestore();
    await h.stop();
  });
  it("reports busy while a turn runs and idle/done after it finishes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start();
    const running = h.runTask("do it");
    expect(h.status()).toMatchObject({ state: "working", status: "busy" });
    f.finish(); await running;
    expect(h.status()).toMatchObject({ state: "done", status: "idle" });
    await h.stop();
  });
  it("stays busy and emits no turn end for a task-origin result until the human result", async () => {
    const { frames, session } = framedSession();
    const h = new SessionHost(opts(), deps(() => session));
    const events: any[] = [];
    await h.start(); h.follow((e) => events.push(e));
    const running = h.runTask("do it");
    frames.push({ type: "result", result: "background", origin: { kind: "task-notification" } });
    await nextTick();
    expect(h.busy()).toBe(true);
    expect(h.status()).toMatchObject({ state: "working", status: "busy" });
    expect(events.filter((e) => e.kind === "turn" && e.phase === "end")).toHaveLength(0);
    frames.push({ type: "result", result: "done", origin: { kind: "human" } });
    await running;
    expect(h.busy()).toBe(false);
    expect(events.filter((e) => e.kind === "turn" && e.phase === "end")).toHaveLength(1);
    frames.close(); await h.stop();
  });
  it("finalizes the roster to done when the task completes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(typeof r.endedAt).toBe("number");
  });
  it("finalizes to error when the turn throws", async () => {
    const h = new SessionHost(opts(), deps(() => ({ submit: async () => { throw new Error("boom"); }, sessionId: "s", dispose: async () => {} }) as any));
    await h.start(); await h.runTask("x").catch(() => {}); await h.stop();
    expect(readRoster("a1b2c3d4", env)!.state).toBe("error");
  });
  it("stop() finalizes to stopped, not done — daemon-finalize.sh routes it down the error arm", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start(); await h.stop("stopped");
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("records the sessionId into the roster once the engine reports one", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBe("sid-1");
  });
  it("stamps the sessionId MID-TURN, while the session is still running", async () => {
    // The engine reports its id in the init frame, near the START of the turn. Stamping only at the end
    // left `agents` printing sessionId "" for the session's whole life, and the consumer's uuid poller
    // gives up after 30 × 2s — so every turn longer than a minute was unresumable while running fine.
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start();
    const running = h.runTask("x");
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBeUndefined();   // nothing to stamp before the frame
    f.emitInit();
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBe("sid-1");     // …and the turn has NOT finished
    f.finish(); await running; await h.stop();
  });
  it("stamps ONCE — a later frame must not resurrect the row a concurrent `rm` unlinked", async () => {
    // The stamp is read-then-write, so repeating it per message keeps re-opening the window in which an
    // `rm` that unlinked the row between our read and our write has its deletion undone.
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start();
    const running = h.runTask("x");
    f.emitInit();
    rmSync(rosterPath("a1b2c3d4", env));                              // `ccx rm` races the running turn
    f.emitInit(); f.emitInit();
    expect(readRoster("a1b2c3d4", env)).toBeUndefined();
    f.finish(); await running; await h.stop();
    expect(readRoster("a1b2c3d4", env)).toBeUndefined();              // and the end-of-turn sync is gated too
  });
  it("stop() with no final state writes nothing down — a working row stamped endedAt strands the poller", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start(); await h.stop();
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("working"); expect(r.endedAt).toBeUndefined();
  });
  it("a second stop() neither throws nor re-stamps the row it already finalized", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start(); await h.stop("stopped");
    const first = readRoster("a1b2c3d4", env)!;
    await h.stop();
    const second = readRoster("a1b2c3d4", env)!;
    expect(second.state).toBe("stopped"); expect(second.endedAt).toBe(first.endedAt);
  });
  it("a bg host records done at turn completion, before stop() — it may die before ever reaching stop()", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running;
    expect(readRoster("a1b2c3d4", env)!.state).toBe("done");
    await h.stop();
  });
  it("an interactive host is not frozen at done by its first turn — it stays live and finalizes at stop()", async () => {
    const h = new SessionHost({ ...opts(), kind: "interactive", detached: false }, deps(() => instantSession() as any));
    await h.start(); await h.runTask("one");
    const mid = readRoster("a1b2c3d4", env)!;
    expect(mid.state).toBe("working"); expect(mid.endedAt).toBeUndefined();
    await h.runTask("two");
    // Multi-turn (A2b): an interactive host's success arm sets `working`, not `done` — it stays live for
    // the NEXT turn instead of freezing terminal after the first. Only stop() records a terminal state.
    expect(h.status()).toMatchObject({ state: "working", status: "idle" });
    await h.stop("stopped");
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("finalizes to error when openSession throws, rather than leaving a permanent working row", async () => {
    const h = new SessionHost(opts(), deps(() => { throw new Error("no session"); }));
    await expect(h.start()).rejects.toThrow("no session");
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("error"); expect(typeof r.endedAt).toBe("number");
  });
  it("disposes the session it opened and finalizes to error when listen() fails", async () => {
    mkdirSync(join(env.CCX_FLEET_ROOT!, "run", `${process.pid}.sock`), { recursive: true });  // listen()'s rm cannot remove a directory
    let disposed = false;
    const h = new SessionHost(opts(), deps(() => ({ ...instantSession(), dispose: async () => { disposed = true; } }) as any));
    await expect(h.start()).rejects.toThrow();
    expect(disposed).toBe(true);
    expect(readRoster("a1b2c3d4", env)!.state).toBe("error");
  });
});

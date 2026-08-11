import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";

const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-control-"));

/** A fake HostSession exercising every optional control member, per the brief's fixture. `calls`
 *  records each control passthrough so a test can assert the underlying session member actually fired
 *  (not just that `control()` returned {ok:true}). */
function fakeSession(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fake = {
    submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); return { result: {} }; },
    sessionId: "sid-123", dispose: async () => { calls.push("disposed"); },
    setModel: async (m?: string) => { calls.push(`setModel:${m}`); },
    setPermissionMode: async (m: string) => { calls.push(`mode:${m}`); },
    setMaxThinkingTokens: async (t: number | null) => { calls.push(`think:${t}`); },
    capabilities: async () => ({ models: [1], commands: [2], mcpServers: [3] }),
    compact: async () => ({ ok: true, result: "success" }),
    usage: async () => ({ cost: 1 }), getContextUsage: async () => ({ totalTokens: 5 }),
    mcpServerStatus: async () => [{ name: "linear" }],
    reconnectMcpServer: async (n: string) => { calls.push(`rec:${n}`); },
    toggleMcpServer: async (n: string, e: boolean) => { calls.push(`tog:${n}:${e}`); },
    ...over,
  };
  return { calls, fake };
}

const hostFor = (session: unknown, opens?: unknown[]) =>
  new SessionHost(
    { short: "c0c0c0c0", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
    { openSession: (c: unknown) => { opens?.push(c); return session as any; }, procStartOf: async () => "start" },
  );

describe("SessionHost.control", () => {
  it("capabilities round-trips the session's capabilities()", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(await host.control({ op: "capabilities" })).toEqual({ ok: true, models: [1], commands: [2], mcpServers: [3] });
    await host.stop();
  });

  it("set_model calls through to the session and reports ok", async () => {
    const { calls, fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(await host.control({ op: "set_model", model: "m" })).toEqual({ ok: true });
    expect(calls).toContain("setModel:m");
    await host.stop();
  });

  it("throws a named error when the session lacks the member (no compact)", async () => {
    const { fake } = fakeSession({ compact: undefined });
    const host = hostFor(fake);
    await host.start();
    await expect(host.control({ op: "compact" })).rejects.toThrow("compact unsupported by this host");
    await host.stop();
  });

  it("status() carries the session's sessionId", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(host.status().sessionId).toBe("sid-123");
    await host.stop();
  });

  it("stamps turn seq into start/end frames, incrementing once per turn", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    const seen: HostEvent[] = [];
    host.follow((e) => seen.push(e));
    await host.runTask("x");
    // `result` on the end frames is M3 §1a-f: this fixture's submit resolves `{result:{}}`, and the turn's
    // result now ships on turn-end (the only frame that can carry it). These stay EXACT-equality checks —
    // the point of this case is the full frame shape, so a future field has to be admitted here on purpose.
    expect(seen.filter((e) => e.kind === "turn")).toEqual([
      { kind: "turn", phase: "start", seq: 1 },
      { kind: "turn", phase: "end", seq: 1, result: {} },
    ]);
    await host.runTask("y");
    const turns = seen.filter((e) => e.kind === "turn");
    expect(turns[turns.length - 2]).toEqual({ kind: "turn", phase: "start", seq: 2 });
    expect(turns[turns.length - 1]).toEqual({ kind: "turn", phase: "end", seq: 2, result: {} });
    await host.stop();
  });

  it("turnSeq() reports the seq of the last started turn", async () => {
    const { fake } = fakeSession();
    const host = hostFor(fake);
    await host.start();
    expect(host.turnSeq()).toBe(0);
    await host.runTask("x");
    expect(host.turnSeq()).toBe(1);
    await host.runTask("y");
    expect(host.turnSeq()).toBe(2);
    await host.stop();
  });

  it("resumeSession swaps the underlying session (openSession called again with resume:id) and disposes the old one", async () => {
    const { calls, fake } = fakeSession();
    const opens: any[] = [];
    const host = hostFor(fake, opens);
    await host.start();
    await host.resumeSession("resume-id-1");
    expect(opens).toHaveLength(2);
    expect(opens[1]).toMatchObject({ resume: "resume-id-1" });
    expect(calls).toContain("disposed");
    await host.stop();
  });

  it("resumeSession is refused while a turn is in flight, same as a second prompt", async () => {
    let resolveSubmit!: () => void;
    const fake = {
      submit: async (_p: string, _on: (m: unknown) => void) => new Promise((r) => { resolveSubmit = () => r({ result: {} }); }),
      sessionId: "sid-123", dispose: async () => {},
    };
    const host = hostFor(fake);
    await host.start();
    const running = host.runTask("x");
    await expect(host.resumeSession("id")).rejects.toThrow(/busy/);
    resolveSubmit();
    await running;
    await host.stop();
  });

  // Mirrors host-teardown.test.ts's `wedged()` + short `disposeGraceMs` pattern: a fake whose dispose()
  // NEVER settles must not hang resumeSession — it is bounded by the SAME grace/deadline race
  // `teardown()` uses, and the new session must already be live once resumeSession returns.
  it("resumeSession does not hang when the old session's dispose() never resolves", async () => {
    const opens: any[] = [];
    let calls = 0;
    const host = new SessionHost(
      { short: "c0c0c0c2", name: "t", cwd: "/tmp", kind: "bg", detached: true, config: {} as never, env: { CCX_FLEET_ROOT: tmpFleet() } },
      {
        openSession: (c: unknown) => {
          opens.push(c);
          calls++;
          return calls === 1
            ? { sessionId: "sid-old", submit: async () => ({ result: {} }), dispose: () => new Promise<void>(() => {}) } as any
            : { sessionId: "sid-new", submit: async () => ({ result: {} }), dispose: async () => {} } as any;
        },
        procStartOf: async () => "start",
        disposeGraceMs: 50,
      },
    );
    await host.start();
    await expect(host.resumeSession("sid-x")).resolves.toBeUndefined();   // must not hang on the wedged dispose
    expect(opens).toHaveLength(2);
    expect(opens[1]).toMatchObject({ resume: "sid-x" });
    expect(host.status().sessionId).toBe("sid-new");                      // the new session is already live
    await host.stop();
  }, 3_000);
});

/** A session whose turn is driven by hand — `emit`/`finish` are separate from `submit`'s auto-fire in
 *  `fakeSession()` above, so a test can call `follow()` at an exact moment mid-turn or after the turn
 *  has fully ended. Exactly the pattern host-follow.test.ts uses for the same reason. */
function drivable() {
  let emit: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  return {
    sessionId: "sid-123",
    submit(_p: string, onMessage: (m: unknown) => void) {
      emit = onMessage;
      return new Promise<unknown>((r) => { finish = () => r({ result: {} }); });
    },
    dispose: async () => {},
    emit: (m: unknown) => emit(m),
    finish: () => finish(),
  };
}

// Step 5-(4b)'s plan-review-mandated regression: `follow()`'s replay must tell a LATE joiner whether it
// is joining a live turn or the tail of a finished one — a follower attaching mid-turn otherwise has no
// LiveTurn to render its replayed/live messages into, and one attaching idle must NOT be told a turn is
// open (the disk replay already covers the last completed turn; see probe 62's dedup reasoning).
describe("SessionHost.follow — A2b mid-turn replay (Step 5-(4b))", () => {
  it("a follower joining MID-TURN is replayed {kind:turn,phase:start,seq} FIRST, before the buffered messages", async () => {
    const s = drivable();
    const host = hostFor(s);
    await host.start();
    const turn = host.runTask("go");                 // turn started BEFORE follow() below — a late join
    s.emit({ type: "assistant", n: 1 });
    s.emit({ type: "assistant", n: 2 });
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));                 // joins mid-flight
    expect(late[0]).toEqual({ kind: "turn", phase: "start", seq: 1 });   // FIRST frame in the replay
    expect(late.filter((e) => e.kind === "turn")).toHaveLength(1);        // exactly one, not per message
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1, 2]);
    s.finish(); await turn; await host.stop();
  });

  it("a follower joining IDLE (turn already ended, buffer non-empty, untruncated) gets NO turn-start frame", async () => {
    const s = drivable();
    const host = hostFor(s);
    await host.start();
    const turn = host.runTask("go");
    s.emit({ type: "assistant", n: 1 });
    s.finish(); await turn;                            // the turn is over; the buffer still holds it
    const late: HostEvent[] = [];
    host.follow((e) => late.push(e));                  // joins idle
    expect(late.filter((e) => e.kind === "turn")).toEqual([]);            // no start frame at all
    expect(late.filter((e) => e.kind === "message").map((e: any) => e.data.n)).toEqual([1]);
    await host.stop();
  });
});

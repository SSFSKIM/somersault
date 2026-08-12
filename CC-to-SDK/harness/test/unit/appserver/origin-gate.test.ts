// test/unit/appserver/origin-gate.test.ts — M3 Task 3: the `ThreadOrigin` widening and the -33006
// origin gate that rides it (spec §1b/§1c).
//
// Every case here drives a HAND-BUILT `origin:"fleet"` record with a fake engine behind it. That began as
// a necessity (nothing produced a fleet record until Task 7's `thread/attach`) and stays one by choice: the
// gate is a property of the RECORD's origin, not of the engine build behind it or of the path that
// admitted it — fleet-adoption.test.ts owns the real-socket half. Everything is driven WIRE-LEVEL (srv.connect + feed), never by calling the
// helper directly: the load-bearing claim is about dispatch ordering, and only the real dispatch can
// prove where the gate sits relative to the handlers' own refusals.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer, threadView } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { FLEET_UNSUPPORTED, emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);

/** A bare engine: the four required EngineSession members and nothing else. Optional members are added
 *  per-test, so "the engine does not have this method" is a deliberate statement rather than an oversight
 *  — which is exactly what the precedence cases below need. */
function fakeSession(extra: Record<string, unknown> = {}) {
  return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", isEnded: () => false, ...extra };
}

function boot(deps: Record<string, unknown> = {}) {
  const srv = new AppServer({}, deps as never);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" } } });
  s.lines.length = 0;
  return { srv, conn, lines: s.lines };
}

/** Registers a record directly — the only way to get an `origin:"fleet"` record before thread/attach. */
function addRecord(srv: AppServer, origin: "inProcess" | "fleet", session: Record<string, unknown>, over: Partial<ThreadRecord> = {}): string {
  const id = srv.registry.mint();
  const now = Math.floor(Date.now() / 1000);
  const record = {
    id, origin, session, unattended: "park", busy: false, turnSeq: 0, interruptRequested: false,
    buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(),
    sessionId: session.sessionId as string | undefined, createdAt: now, updatedAt: now,
    settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0, ...over,
  } as unknown as ThreadRecord;
  srv.registry.add(record);
  return id;
}

/** One valid param object per gated method — valid on purpose: a -33006 that only happened because the
 *  params were junk would prove nothing about the gate. */
const GATED_CALLS: Array<[string, (threadId: string) => Record<string, unknown>]> = [
  ["turn/steer", (threadId) => ({ threadId, input: "go" })],
  ["thread/settings/apply", (threadId) => ({ threadId, settings: { model: "opus" } })],
  ["mcpServer/set", (threadId) => ({ threadId, servers: {} })],
  ["mcpServer/permissionModeOverride/set", (threadId) => ({ threadId, name: "srv", mode: null })],
  ["plugin/reload", (threadId) => ({ threadId })],
  ["skill/reload", (threadId) => ({ threadId })],
  ["thread/reinitialize", (threadId) => ({ threadId })],
  ["account/read", (threadId) => ({ threadId })],
  ["thread/init/read", (threadId) => ({ threadId })],
];

describe("appserver origin gate (M3 Task 3)", () => {
  it("the gate's method set is exactly the table this file drives, and every name is a REGISTERED method", () => {
    // Two tripwires in one: a typo in the gate set would refuse nothing (the method it means to gate keeps
    // its old answer), and a name that is not a methodSchemas key cannot ever be dispatched at all.
    expect([...FLEET_UNSUPPORTED].sort()).toEqual(GATED_CALLS.map(([m]) => m).sort());
    for (const m of FLEET_UNSUPPORTED) expect(Object.keys(methodSchemas)).toContain(m);
    // thread/reopen joins the set in Task 14, WITH its schema — never before (the subset rule above).
    expect(FLEET_UNSUPPORTED.has("thread/reopen")).toBe(false);
  });

  for (const [method, mkParams] of GATED_CALLS) {
    it(`${method} on a fleet-origin thread answers -33006`, async () => {
      const { srv, conn, lines } = boot();
      // A FULLY-EQUIPPED engine: every optional member the gated methods reach is present, so the refusal
      // can only come from the origin gate — not from an absent member.
      const threadId = addRecord(srv, "fleet", fakeSession({
        steer: () => {}, applyFlagSettings: async () => {}, setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        setMcpPermissionModeOverride: async () => ({}), reloadPlugins: async () => ({}), reloadSkills: async () => ({}),
        reinitialize: async () => ({}), accountInfo: async () => ({}), initializationResult: async () => ({}),
      }), { busy: method === "turn/steer", turnStartedBroadcast: method === "turn/steer" });

      send(conn, { id: 2, method, params: mkParams(threadId) });
      await tick();

      expect(frame(lines, 2).error).toMatchObject({ code: ERR.UNSUPPORTED_FOR_ORIGIN, message: "unsupported for fleet-origin threads" });
    });
  }

  it("the same methods on an inProcess thread never see the gate (spot-check: settings/apply, account/read, mcpServer/set)", async () => {
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession({
      applyFlagSettings: async () => {}, accountInfo: async () => ({ id: "acct" }), setMcpServers: async () => ({ added: ["a"], removed: [], errors: {} }),
    }));

    send(conn, { id: 2, method: "thread/settings/apply", params: { threadId, settings: { model: "opus" } } });
    send(conn, { id: 3, method: "account/read", params: { threadId } });
    send(conn, { id: 4, method: "mcpServer/set", params: { threadId, servers: {} } });
    await tick();

    expect(frame(lines, 2).result).toEqual({ ok: true });
    expect(frame(lines, 3).result).toEqual({ account: { id: "acct" } });
    expect(frame(lines, 4).result).toEqual({ added: ["a"], removed: [], errors: {} });
  });

  it("refusal precedence: a GATED method on a fleet thread whose engine also lacks the member answers -33006, not -32601", async () => {
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "fleet", fakeSession()); // no accountInfo — the handler's own -32601 path

    send(conn, { id: 2, method: "account/read", params: { threadId } });
    await tick();

    expect(frame(lines, 2).error.code).toBe(ERR.UNSUPPORTED_FOR_ORIGIN);
  });

  it("precedence inverts ONLY for gated methods: a NON-gated method on a fleet thread whose engine lacks the member still answers -32601", async () => {
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "fleet", fakeSession()); // no capabilities()

    send(conn, { id: 2, method: "thread/capabilities/read", params: { threadId } });
    await tick();

    expect(frame(lines, 2).error).toMatchObject({ code: ERR.METHOD_NOT_FOUND, message: "unsupported by this engine" });
  });

  it("an inProcess thread whose engine lacks the member keeps answering -32601 for a gated method — the gate is origin-scoped, not method-scoped", async () => {
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "inProcess", fakeSession()); // no accountInfo

    send(conn, { id: 2, method: "account/read", params: { threadId } });
    await tick();

    expect(frame(lines, 2).error.code).toBe(ERR.METHOD_NOT_FOUND);
  });

  it("a DEAD fleet engine answers -33005 for a gated method — engine-gone is a fact about this thread now, and outranks the structural refusal", async () => {
    // The other half of the dispatch ordering: the gate sits after the -33005 check, which is what spec
    // §1f's death sequence expects ("subsequent methods answer -33005"; recovery is close + re-attach).
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "fleet", fakeSession({ isEnded: () => true }));

    send(conn, { id: 2, method: "plugin/reload", params: { threadId } });
    await tick();

    expect(frame(lines, 2).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("turn/start {queue:true} on a fleet thread answers -33006 — the method stays allowed, only the flag refuses", async () => {
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "fleet", fakeSession());

    send(conn, { id: 2, method: "turn/start", params: { threadId, input: "hi", queue: true } });
    await tick();

    expect(frame(lines, 2).error).toMatchObject({ code: ERR.UNSUPPORTED_FOR_ORIGIN });
  });

  it("turn/start WITHOUT the queue flag on a fleet thread is not origin-gated: it reaches the engine, and a busy one answers -33001", async () => {
    // `busy` is set from the RECORD here, not by running a turn: since Task 7 a fleet turn's lifecycle
    // rides the host's own turn events (spec §1b — the fleet event layer is the sole owner), so a turn a
    // bare DI engine cannot report never claims the thread. What this case is about is unchanged: the
    // METHOD is allowed for this origin, only its `queue` flag refuses, and the busy refusal still names
    // its reason.
    const { srv, conn, lines } = boot();
    const submitted: unknown[] = [];
    const threadId = addRecord(srv, "fleet", fakeSession({
      submit: (_input: string, _onMessage: unknown, opts: unknown) => { submitted.push(opts); return new Promise(() => {}); },
    }));

    send(conn, { id: 2, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    expect(submitted).toHaveLength(1); // reached the engine: turn/start itself is not gated

    srv.registry.get(threadId)!.busy = true;
    send(conn, { id: 3, method: "turn/start", params: { threadId, input: "two" } });
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();

    expect(frame(lines, 3).error.code).toBe(ERR.BUSY);
    expect(frame(lines, 4).error.code).toBe(ERR.UNSUPPORTED_FOR_ORIGIN); // busy + queue is still the flag's refusal
  });

  it("turn/steer on a BUSY fleet thread answers -33006 even though the handler's own gates would have answered differently", async () => {
    // The sabotage case, pinned: this thread is busy with a broadcast turn (so turn/steer's -32602 'no turn
    // in flight' cannot fire) and its engine has no `steer` (so the handler's -32601 would fire if the gate
    // ran after handler entry). Only dispatch-level ordering produces -33006 here.
    const { srv, conn, lines } = boot();
    const threadId = addRecord(srv, "fleet", fakeSession(), { busy: true, turnStartedBroadcast: true });

    send(conn, { id: 3, method: "turn/steer", params: { threadId, input: "go" } });
    await tick();

    expect(frame(lines, 3).error.code).toBe(ERR.UNSUPPORTED_FOR_ORIGIN);
  });
});

describe("thread/resume live-session guard (M3 Task 3)", () => {
  const dirs: string[] = [];
  const saved = process.env.CCX_FLEET_ROOT;
  const useTmpRoster = () => { const d = mkdtempSync(join(tmpdir(), "ccx-origin-gate-")); dirs.push(d); process.env.CCX_FLEET_ROOT = d; return d; };
  afterEach(() => {
    if (saved === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = saved;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("refuses -32602 when the sessionId belongs to a fleet record this server has already attached", async () => {
    useTmpRoster();
    const { srv, conn, lines } = boot({ sessionFactory: () => fakeSession() });
    addRecord(srv, "fleet", fakeSession({ sessionId: "sess-live" }));

    send(conn, { id: 2, method: "thread/resume", params: { sessionId: "sess-live" } });
    await tick();

    expect(frame(lines, 2).error).toMatchObject({ code: ERR.INVALID_PARAMS, message: "sessionId belongs to a running fleet session; use thread/attach" });
  });

  it("refuses -32602 when a LIVE roster row carries the sessionId, even with nothing attached here", async () => {
    useTmpRoster();
    writeRoster({ short: "aaaaaaaa", sessionId: "sess-roster", pid: process.pid, cwd: "/tmp", kind: "bg", name: "one", state: "working", startedAt: Date.now() });
    const { srv, conn, lines } = boot({ sessionFactory: () => fakeSession() });

    send(conn, { id: 2, method: "thread/resume", params: { sessionId: "sess-roster" } });
    await tick();

    expect(frame(lines, 2).error).toMatchObject({ code: ERR.INVALID_PARAMS, message: "sessionId belongs to a running fleet session; use thread/attach" });
    expect(srv.registry.list()).toHaveLength(0); // refused BEFORE spawning — no engine, no record
  });

  it("a TERMINAL roster row is not a live session: the resume proceeds", async () => {
    useTmpRoster();
    writeRoster({ short: "bbbbbbbb", sessionId: "sess-done", pid: process.pid, cwd: "/tmp", kind: "bg", name: "two", state: "done", startedAt: Date.now(), endedAt: Date.now() });
    const { srv, conn, lines } = boot({ sessionFactory: () => fakeSession() });

    send(conn, { id: 2, method: "thread/resume", params: { sessionId: "sess-done" } });
    await tick();

    expect(frame(lines, 2).result.thread.sessionId).toBe("sess-done");
  });

  it("with no roster row to probe, the guard settles SYNCHRONOUSLY — the resume still admits its thread in its own dispatch tick", () => {
    // Regression pin (found by the full suite, not by this file): the guard's first draft awaited on every
    // call, which pushed admission past the same-tick `thread/delete` reservation and silently flipped the
    // delete/resume race sessionLib.ts pins. No `await tick()` here on purpose — the record must exist the
    // instant `feed` returns.
    useTmpRoster();
    const { srv, conn } = boot({ sessionFactory: () => fakeSession() });

    send(conn, { id: 2, method: "thread/resume", params: { sessionId: "sess-sync" } });

    expect(srv.registry.list().map((r) => r.sessionId)).toEqual(["sess-sync"]);
  });

  it("an unrelated sessionId resumes normally with a live roster row present", async () => {
    useTmpRoster();
    writeRoster({ short: "cccccccc", sessionId: "sess-other", pid: process.pid, cwd: "/tmp", kind: "bg", name: "three", state: "working", startedAt: Date.now() });
    const { srv, conn, lines } = boot({ sessionFactory: () => fakeSession() });

    send(conn, { id: 2, method: "thread/resume", params: { sessionId: "sess-mine" } });
    await tick();

    expect(frame(lines, 2).result.thread.sessionId).toBe("sess-mine");
  });
});

describe("threadView origin fields (M3 Task 3)", () => {
  it("inProcess cwd falls back to the server process cwd when the start config named none", () => {
    const srv = new AppServer({}, {});
    const id = addRecord(srv, "inProcess", fakeSession());
    expect(threadView(srv, srv.registry.get(id)!).cwd).toBe(process.cwd());
  });

  it("inProcess cwd is the config's cwd when it named one", () => {
    const srv = new AppServer({}, {});
    const id = addRecord(srv, "inProcess", fakeSession(), { cwd: "/work/here" });
    expect(threadView(srv, srv.registry.get(id)!).cwd).toBe("/work/here");
  });

  it("a fleet thread carries short/name and its own cwd; an inProcess thread carries neither key", () => {
    const srv = new AppServer({}, {});
    const fleet = addRecord(srv, "fleet", fakeSession(), { cwd: "/fleet/cwd", short: "deadbeef", name: "worker-1" });
    const local = addRecord(srv, "inProcess", fakeSession());

    const fleetView = threadView(srv, srv.registry.get(fleet)!);
    expect(fleetView).toMatchObject({ origin: "fleet", cwd: "/fleet/cwd", short: "deadbeef", name: "worker-1" });
    const localView = threadView(srv, srv.registry.get(local)!);
    expect("short" in localView).toBe(false);
    expect("name" in localView).toBe(false);
  });

  it("a fleet thread with no roster cwd yet does NOT borrow the server's cwd — that would be a lie about where it runs", () => {
    const srv = new AppServer({}, {});
    const id = addRecord(srv, "fleet", fakeSession());
    expect(threadView(srv, srv.registry.get(id)!).cwd).toBeUndefined();
  });
});

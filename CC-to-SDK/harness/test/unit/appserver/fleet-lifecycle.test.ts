// test/unit/appserver/fleet-lifecycle.test.ts — M3 Task 9: how a fleet thread ENDS. Three mechanisms,
// one file, because each is the others' negative space:
//
//  1. `thread/stop` ends the HOST. EOF is the contract, not a receipt (spec §1e): `SessionHost.stop`
//     destroys every open socket before its handler could reply, so the fake here stays silent too
//     (fakeHost.ts's `stop`) and the method finalizes on the ROSTER ROW turning terminal.
//  2. `thread/close` on a fleet thread is a DETACH (§1f). The host lives on — which is exactly why its
//     parked decisions must drop SILENTLY: this server never settled them and nobody else did either.
//  3. Socket death is the sequence neither of the two asked for, and the `thread/stop` case above is what
//     proves the expected-death latch keeps it from firing for a death a client requested.
//
// Every case drives a REAL fake host over a REAL unix socket and a REAL roster on disk, wire-level through
// `srv.connect`/`feed` — the properties under test are ordering and notification-absence properties, and
// only the real dispatch can prove them. Each case gets its OWN `CCX_FLEET_ROOT` (a roster row written by
// one case would otherwise be in the next case's listing).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls, FakeHostOpts } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** A short poll so a case that must WAIT OUT the cap costs milliseconds rather than the production five
 *  seconds. Injected through the same `deps` slot every other DI seam here uses. */
const FAST_POLL = { stopPoll: { stepMs: 5, capMs: 40 } };

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-lifecycle-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

function boot(deps: Record<string, unknown> = {}) {
  const srv = new AppServer({}, deps as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  s.lines.length = 0;
  return { srv, conn, lines: s.lines };
}

async function host(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}): Promise<{ fh: FakeHostControls; row: RosterRow }> {
  const { row: over, ...rest } = opts;
  const fh = await startFakeHost(rest);
  hosts.push(fh);
  const row: RosterRow = { ...fh.row, ...over };
  writeRoster(row);
  return { fh, row };
}

/** attach + subscribe — every fleet case below watches one thread's own notification stream. */
async function attached(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}, deps: Record<string, unknown> = {}) {
  const { fh, row } = await host(opts);
  const { srv, conn, lines } = boot(deps);
  send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
  await waitFor(() => expect(frame(lines, 2)).toBeTruthy());
  const threadId = frame(lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(lines, 3)).toBeTruthy());
  lines.length = 0;
  return { fh, row, srv, conn, lines, threadId, record: srv.registry.get(threadId)! };
}

/** An inProcess thread with a broker in hand — the local-park half of the close comparison. */
async function local(lines: string[], srv: AppServer, conn: { feed(ch: string): void }, id: number) {
  send(conn, { id, method: "thread/start", params: {} });
  await waitFor(() => expect(frame(lines, id)).toBeTruthy());
  const threadId = frame(lines, id).result.thread.id as string;
  send(conn, { id: id + 100, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(lines, id + 100)).toBeTruthy());
  void srv;
  return threadId;
}

describe("thread/stop on a fleet thread (M3 §1e)", () => {
  it("completes on EOF alone — no receipt — and finalizes once the roster row turns terminal", async () => {
    const { fh, row, srv, conn, lines, threadId, record } = await attached({}, { stopPoll: { stepMs: 5, capMs: 2000 } });

    send(conn, { id: 5, method: "thread/stop", params: { threadId } });
    // The op reached the host, which closed every socket WITHOUT writing a reply (fakeHost's `stop`,
    // production-faithful) — so the only evidence this method ever gets is the EOF that follows.
    await waitFor(() => expect(fh.ops).toContain("stop"));
    await waitFor(() => expect(record.session.isEnded!()).toBe(true));
    // …and it has NOT finished: the roster row still reads `working`, so the session is not accounted for.
    expect(frame(lines, 5)).toBeUndefined();

    writeRoster({ ...row, state: "stopped", endedAt: Date.now() });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());

    expect(frame(lines, 5).result).toEqual({ ok: true });
    expect(notifs(lines, "thread/closed")[0].params).toEqual({ threadId, reason: "stopped" });
    expect(srv.registry.get(threadId)).toBeUndefined();
    // THE EXPECTED-DEATH LATCH: none of §1f's sequence fired for a death this client asked for.
    expect(notifs(lines, "warning")).toEqual([]);
    expect(notifs(lines, "turn/completed")).toEqual([]);
  });

  it("a roster row that never turns terminal errors -33008 and leaves the record STANDING", async () => {
    const { srv, conn, lines, threadId } = await attached({}, FAST_POLL);

    send(conn, { id: 5, method: "thread/stop", params: { threadId } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());

    expect(frame(lines, 5).error.code).toBe(ERR.ATTACH_FAILED);
    expect(frame(lines, 5).error.message).toContain("working"); // names the state it is stuck in
    // The record is the client's only handle on a session that may still be running — dropping it here
    // would leave the session unaddressable, which is why the close is NOT shared with the failure path.
    expect(srv.registry.get(threadId)).toBeTruthy();
    expect(notifs(lines, "thread/closed")).toEqual([]);
  });

  it("a timeout with the host STILL ALIVE gives the death latch back — the later real death still runs §1f", async () => {
    // The OTHER stuck reason (the case above is the roster one): this host takes the `stop` op and never
    // closes the socket, so the engine is still live when the cap runs out. `expectDeath()` was armed
    // before the op went out; leaving it armed makes the death that comes LATER — the one nobody asked
    // for — announce nothing at all, and the thread becomes a silent -33005 zombie.
    const { fh, srv, conn, lines, threadId, record } = await attached({ stopHangs: true }, FAST_POLL);

    send(conn, { id: 5, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(fh.promptCalls).toHaveLength(1));
    fh.park({ toolUseID: "tu-1", toolName: "Bash", input: { command: "ls" } });
    await waitFor(() => expect(srv.pendingDecisions(threadId)).toHaveLength(1));

    send(conn, { id: 6, method: "thread/stop", params: { threadId } });
    await waitFor(() => expect(frame(lines, 6)).toBeTruthy());
    expect(frame(lines, 6).error.code).toBe(ERR.ATTACH_FAILED);
    expect(frame(lines, 6).error.message).toContain("has not closed the connection");
    expect(record.session.isEnded!()).toBe(false);            // the host really is still on the other end
    expect(srv.registry.get(threadId)).toBeTruthy();
    lines.length = 0;

    await fh.close();                                         // …and NOW it dies, unasked
    await waitFor(() => expect(notifs(lines, "warning")).toHaveLength(1));

    // The FULL sequence, in §1f's pinned order — nothing about the failed stop may cost a client any of it.
    const order = parsed(lines).map((f) => f.method).filter((m) => m === "turn/completed" || m === "warning" || m === "thread/status/changed");
    expect(order).toEqual(["turn/completed", "warning", "thread/status/changed"]);
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "failed", error: "fleet host connection lost" });
    expect(notifs(lines, "warning")[0].params).toMatchObject({ threadId, code: "fleetConnectionLost" });
    expect(record.busy).toBe(false);
    expect(srv.pendingDecisions(threadId)).toEqual([]);
    expect(notifs(lines, "decision/resolved")).toEqual([]);   // dropped silently, as every death drops them

    send(conn, { id: 7, method: "thread/usage/read", params: { threadId } });
    await waitFor(() => expect(frame(lines, 7)).toBeTruthy());
    expect(frame(lines, 7).error.code).toBe(ERR.ENGINE_GONE);
  });
});

describe("thread/stop on an inProcess thread (M3 §1e)", () => {
  it("is thread/close's own behavior, announced with reason:\"stopped\"", async () => {
    let disposed = 0;
    const session = { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => { disposed++; }, onFrame: () => () => {}, sessionId: "sess-1" };
    const { srv, conn, lines } = boot({ sessionFactory: () => session });
    const threadId = await local(lines, srv, conn, 2);
    lines.length = 0;

    send(conn, { id: 4, method: "thread/stop", params: { threadId } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());

    expect(frame(lines, 4).result).toEqual({ ok: true });
    expect(disposed).toBe(1);                                   // our engine, our call to end it
    expect(notifs(lines, "thread/closed")[0].params).toEqual({ threadId, reason: "stopped" });
    expect(srv.registry.get(threadId)).toBeUndefined();
  });
});

describe("thread/close on a fleet thread is a DETACH (M3 §1f)", () => {
  it("unfollows, never stops, and drops a parked view with NO settlement notification", async () => {
    const { fh, srv, conn, lines, threadId } = await attached();
    fh.park({ toolUseID: "tu-1", toolName: "Bash", input: { command: "ls" } });
    await waitFor(() => expect(srv.pendingDecisions(threadId)).toHaveLength(1));
    lines.length = 0;

    send(conn, { id: 5, method: "thread/close", params: { threadId } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());

    expect(frame(lines, 5).result).toEqual({ ok: true });
    // THE SILENT DROP. The host is still holding tu-1 and still blocked on it; a `decision/resolved
    // {by:"system", answer:{kind:"deny"}}` here would tell every watcher a denial happened that nobody
    // made — and an audit-logging client would record it as fact.
    expect(notifs(lines, "decision/resolved")).toEqual([]);
    expect(notifs(lines, "thread/closed")).toHaveLength(1);
    expect(notifs(lines, "thread/closed")[0].params).toEqual({ threadId });   // no `reason`: this is a detach
    // …and the host was released, not ended (fakeHost records `unfollow` from the unregister callback,
    // which the socket close fires too — hence toContain rather than an index).
    expect(fh.ops).toContain("unfollow");
    expect(fh.ops).not.toContain("stop");
  });

  it("REGRESSION GUARD: the same close on an inProcess thread still settles its local parks", async () => {
    let broker: { request: (r: Record<string, unknown>) => Promise<unknown> } | undefined;
    const session = { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" };
    const { srv, conn, lines } = boot({ sessionFactory: (cfg: Record<string, unknown>) => { broker = cfg.permissionBroker as typeof broker; return session; } });
    const threadId = await local(lines, srv, conn, 2);

    const parkedPromise = broker!.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "tu-local", signal: new AbortController().signal });
    await waitFor(() => expect(srv.pendingDecisions(threadId)).toHaveLength(1));
    lines.length = 0;

    send(conn, { id: 4, method: "thread/close", params: { threadId } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());

    // A LOCAL park is a promise the read loop is blocked inside — teardown settling it is what keeps
    // dispose() from deadlocking, and the notification is the client's only word that it is gone.
    expect(await parkedPromise).toEqual({ kind: "deny" });
    expect(notifs(lines, "decision/resolved")).toHaveLength(1);
    expect(notifs(lines, "decision/resolved")[0].params).toEqual({ threadId, toolUseId: "tu-local", by: "system", answer: { kind: "deny" } });
  });
});

describe("socket death on a fleet thread (M3 §1f)", () => {
  it("runs the specified sequence in order and leaves a -33005 zombie until thread/close", async () => {
    const { fh, srv, conn, lines, threadId, record } = await attached();

    send(conn, { id: 5, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(fh.promptCalls).toHaveLength(1));
    fh.emitMessage({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "half a thought" }] } });
    fh.park({ toolUseID: "tu-1", toolName: "Bash", input: { command: "ls" } });
    await waitFor(() => expect(srv.pendingDecisions(threadId)).toHaveLength(1));
    lines.length = 0;

    await fh.close();                                  // the host dies under an open turn
    await waitFor(() => expect(notifs(lines, "warning")).toHaveLength(1));

    // ORDER IS THE CONTRACT (§1f): the in-flight turn settles FIRST — a client must never learn the
    // connection is gone before the turn it was watching has a terminal event.
    const order = parsed(lines).map((f) => f.method).filter((m) => m === "turn/completed" || m === "warning" || m === "thread/status/changed");
    expect(order).toEqual(["turn/completed", "warning", "thread/status/changed"]);
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "failed", error: "fleet host connection lost" });
    expect(notifs(lines, "warning")[0].params).toMatchObject({ threadId, code: "fleetConnectionLost" });
    expect(notifs(lines, "thread/status/changed").at(-1)!.params.status).toEqual({ state: "idle" });
    expect(record.busy).toBe(false);
    // The views are GONE — and silently: the host may be dead or alive, and this server cannot know which,
    // so it must not claim a settlement either way.
    expect(srv.pendingDecisions(threadId)).toEqual([]);
    expect(notifs(lines, "decision/resolved")).toEqual([]);

    send(conn, { id: 6, method: "thread/usage/read", params: { threadId } });
    await waitFor(() => expect(frame(lines, 6)).toBeTruthy());
    expect(frame(lines, 6).error.code).toBe(ERR.ENGINE_GONE);

    send(conn, { id: 7, method: "thread/close", params: { threadId } });
    await waitFor(() => expect(frame(lines, 7)).toBeTruthy());
    expect(frame(lines, 7).result).toEqual({ ok: true });
    expect(srv.registry.get(threadId)).toBeUndefined();
  });
});

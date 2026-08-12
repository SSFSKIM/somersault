// test/unit/appserver/fleet-adoption.test.ts — M3 Task 7: `thread/attach` + `fleet/list`, the adoption
// core (spec §1e). Every case drives a REAL fake host over a REAL unix socket (test/helpers/fakeHost.ts)
// and a REAL roster on disk, wire-level through `srv.connect`/`feed`: the properties under test are
// ordering properties (the activation barrier, the attach reservation, who owns a turn's lifecycle), and
// only the real dispatch + the real socket can prove them.
//
// Each case gets its OWN `CCX_FLEET_ROOT` (the per-file default from test/setup/fleetRoot.ts is shared by
// every case in a file, and a roster row written by one case would then be in the next case's listing).
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

// The "no mint for a fleet turn" case (spec §1b: fleet turn ids are DERIVED from the host seq) needs to
// see the call site itself, not only its side effect — so the registry module is loaded with a spy over
// `mintTurnId` and everything else passed through untouched.
vi.mock("../../../src/appserver/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/appserver/registry.js")>();
  return { ...actual, mintTurnId: vi.fn(actual.mintTurnId) };
});
import { mintTurnId } from "../../../src/appserver/registry.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-attach-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
  vi.mocked(mintTurnId).mockClear();
});

function boot(deps: Record<string, unknown> = {}) {
  const srv = new AppServer({}, deps as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  // watchThreads: thread/started is server-scoped fan-out (fanout.ts), so a watcher is the only
  // connection that can observe an attach it did not itself make.
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  s.lines.length = 0;
  return { srv, conn, lines: s.lines };
}

/** A live fake host WITH its roster row on disk — the pair `thread/attach` resolves against. */
async function host(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}): Promise<{ fh: FakeHostControls; row: RosterRow }> {
  const { row: over, ...rest } = opts;
  const fh = await startFakeHost(rest);
  hosts.push(fh);
  const row: RosterRow = { ...fh.row, ...over };
  writeRoster(row);
  return { fh, row };
}

/** A roster row with NO host behind it. No `procStart`, so its pid reads live (RosterRow's doc) — which
 *  is exactly the `unresponsive` shape: a live process whose socket is silent. */
function orphanRow(over: Partial<RosterRow> = {}): RosterRow {
  const row: RosterRow = { short: "0badbeef", pid: 999001, cwd: "/gone", kind: "bg", name: "ghost", state: "working", startedAt: 1_700_000_000_000, ...over };
  writeRoster(row);
  return row;
}

async function attach(conn: { feed(ch: string): void }, lines: string[], id: number, target: string) {
  send(conn, { id, method: "thread/attach", params: { target } });
  await waitFor(() => expect(frame(lines, id)).toBeTruthy());
  return frame(lines, id);
}

describe("fleet/list (M3 Task 7)", () => {
  it("joins the roster with live state, flags an unresponsive row, and marks threadId once attached", async () => {
    const { fh, row } = await host({ status: { sessionId: "sess-live" }, cwd: "/work/live", name: "live-one" });
    orphanRow({ short: "0badbeef", name: "ghost" });
    writeRoster({ short: "0ddddddd", pid: 999002, cwd: "/done", kind: "bg", name: "finished", state: "done", startedAt: 1_700_000_000_000, endedAt: 1_700_000_009_000, sessionId: "sess-done" });
    const { conn, lines } = boot();

    send(conn, { id: 2, method: "fleet/list", params: {} });
    await waitFor(() => expect(frame(lines, 2)).toBeTruthy());
    const rows = frame(lines, 2).result.data as Array<Record<string, unknown>>;
    const byShort = new Map(rows.map((r) => [r.short as string, r]));

    expect(rows).toHaveLength(3);
    // the live one: the host's own status answered, so `state` is the LIVE state, not the roster's copy
    expect(byShort.get(row.short)).toMatchObject({ short: row.short, name: "live-one", kind: "interactive", state: "working", pid: row.pid, cwd: "/work/live", startedAt: row.startedAt });
    expect(byShort.get(row.short)!.threadId).toBeUndefined();       // nothing attached yet
    expect(byShort.get(row.short)!.unresponsive).toBeUndefined();
    // live pid, silent socket — listed, and flagged (spec §1e)
    expect(byShort.get("0badbeef")).toMatchObject({ unresponsive: true, state: "working", cwd: "/gone" });
    // terminal rows are LISTED (they carry the outcome) — they simply refuse attach
    expect(byShort.get("0ddddddd")).toMatchObject({ state: "done", endedAt: 1_700_000_009_000, sessionId: "sess-done" });

    const attached = await attach(conn, lines, 3, row.short);
    send(conn, { id: 4, method: "fleet/list", params: {} });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());
    const after = (frame(lines, 4).result.data as Array<Record<string, unknown>>).find((r) => r.short === row.short);
    expect(after!.threadId).toBe(attached.result.thread.id);
    void fh;
  });
});

describe("thread/attach resolution (M3 Task 7)", () => {
  it("resolves by short, by name and by sessionId — the CLI's own simultaneous filter", async () => {
    const { row } = await host({ status: { sessionId: "sess-abc" }, name: "worker-1", row: { sessionId: "sess-abc" } });
    const { srv, conn, lines } = boot();

    expect((await attach(conn, lines, 2, row.short)).result.thread.short).toBe(row.short);
    // …and the other two handles resolve to the SAME already-attached record (idempotent by target)
    expect((await attach(conn, lines, 3, "worker-1")).result.thread.id).toBe(frame(lines, 2).result.thread.id);
    expect((await attach(conn, lines, 4, "sess-abc")).result.thread.id).toBe(frame(lines, 2).result.thread.id);
    expect(srv.registry.list()).toHaveLength(1);
  });

  it("an AMBIGUOUS target answers -33008 carrying every match", async () => {
    // The CLI's rule (cli/lifecycle.ts): ambiguity is an error, never a precedence — one row's NAME is
    // the other row's SHORT, so a single string names two sessions.
    const { row } = await host({ name: "first" });
    writeRoster({ short: "0aaaaaaa", pid: 999003, cwd: "/two", kind: "bg", name: row.short, state: "working", startedAt: 1_700_000_000_000 });
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, row.short);
    expect(rep.error.code).toBe(ERR.ATTACH_FAILED);
    expect(rep.error.data.matches).toEqual(expect.arrayContaining([
      { short: row.short, name: "first" }, { short: "0aaaaaaa", name: row.short },
    ]));
    expect(srv.registry.list()).toHaveLength(0);
  });

  it("no match answers -33008", async () => {
    await host();
    const { conn, lines } = boot();
    const rep = await attach(conn, lines, 2, "nobody");
    expect(rep.error).toMatchObject({ code: ERR.ATTACH_FAILED, message: expect.stringContaining("no fleet session matches") });
  });

  it("a TERMINAL row answers -33008 — it is listed, but there is nothing to attach to", async () => {
    writeRoster({ short: "0ddddddd", pid: 999004, cwd: "/done", kind: "bg", name: "finished", state: "stopped", startedAt: 1_700_000_000_000, endedAt: 1_700_000_009_000 });
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, "finished");
    expect(rep.error).toMatchObject({ code: ERR.ATTACH_FAILED, message: "session already ended" });
    expect(srv.registry.list()).toHaveLength(0);
  });

  it("an UNRESPONSIVE row (live pid, dead socket) fails attach with the socket's own error", async () => {
    orphanRow();
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, "ghost");
    expect(rep.error.code).toBe(ERR.ATTACH_FAILED);
    expect(rep.error.message).toContain("ENOENT");       // the dial's own failure, not a synthesized one
    expect(srv.registry.list()).toHaveLength(0);
    // and a failed attach does not poison the target: the reservation was released
    const again = await attach(conn, lines, 3, "ghost");
    expect(again.error.code).toBe(ERR.ATTACH_FAILED);
  });
});

describe("thread/attach admission (M3 Task 7)", () => {
  it("registers a fleet record with the roster's identity and a mirror seeded from the host status", async () => {
    const { row } = await host({ status: { sessionId: "sess-1", model: "opus", permissionMode: "plan", thinkingTokens: 4096 }, cwd: "/work/here", name: "worker-1" });
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, row.short);
    const view = rep.result.thread;
    expect(view).toMatchObject({
      origin: "fleet", short: row.short, name: "worker-1", cwd: "/work/here", sessionId: "sess-1",
      model: "opus", permissionMode: "plan", thinking: { maxTokens: 4096 },
    });
    const record = srv.registry.get(view.id)!;
    expect(record.origin).toBe("fleet");
    expect(record.short).toBe(row.short);
    expect(record.cwd).toBe("/work/here");
    expect(record.epoch).toBe(0);
    // thread/started reaches every server-scoped watcher, exactly as thread/start's does
    expect(notifs(lines, "thread/started").map((n) => n.params.thread.id)).toEqual([view.id]);
  });

  it("a re-attach is idempotent: same threadId, no second record, no second thread/started", async () => {
    const { row } = await host();
    const { srv, conn, lines } = boot();

    const first = await attach(conn, lines, 2, row.short);
    const second = await attach(conn, lines, 3, row.short);

    expect(second.result.thread.id).toBe(first.result.thread.id);
    expect(srv.registry.list()).toHaveLength(1);
    expect(notifs(lines, "thread/started")).toHaveLength(1);
    expect(hosts[0].ops.filter((o) => o === "follow")).toHaveLength(1);   // dialled once
  });

  it("TWO SIMULTANEOUS attaches for one target collapse onto ONE admission (the reservation)", async () => {
    const { row } = await host();
    const { srv, conn, lines } = boot();

    // No await between them: both handlers run their synchronous prefix before either's dial resolves,
    // which is precisely the window a reservation taken after the first await would miss.
    send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
    send(conn, { id: 3, method: "thread/attach", params: { target: row.short } });
    await waitFor(() => { expect(frame(lines, 2)).toBeTruthy(); expect(frame(lines, 3)).toBeTruthy(); });

    expect(frame(lines, 3).result.thread.id).toBe(frame(lines, 2).result.thread.id);
    expect(srv.registry.list()).toHaveLength(1);
    expect(notifs(lines, "thread/started")).toHaveLength(1);
    expect(hosts[0].ops.filter((o) => o === "follow")).toHaveLength(1);
  });

  it("a REPLAYED frame never rewrites the settings mirror the attach just seeded", async () => {
    // The host's turn buffer holds every non-partial frame of the turn it is replaying (host.ts:333),
    // system/status frames included — router.ts:56-61 names exactly this one, the CLI's own post-approval
    // mode flip. `follow` replays them MARKED (host.ts:614), ahead of the `state` frame that carries the
    // host's truth RIGHT NOW (:630) — so a router that reads a replayed frame as news overwrites the mirror
    // the attach's own `status` op seeded a moment earlier, and announces the overwrite as an engine
    // change. `model` is the half that never heals: the host's `state` omits it until the host has one
    // (fakeHost's status(), host.ts:892), so nothing later corrects a historical model back.
    const { fh, row } = await host({ status: { permissionMode: "acceptEdits" } });
    fh.emitMessage({ type: "system", subtype: "status", permissionMode: "plan", model: "opus-4-stale" });
    const { srv, conn, lines } = boot({ listSessions: async () => [] });
    const spy = vi.spyOn(srv, "broadcast");

    const rep = await attach(conn, lines, 2, row.short);
    const record = srv.registry.get(rep.result.thread.id)!;
    // the replay's trailing `state` frame — proof the whole burst was drained before the claims below
    await waitFor(() => expect(spy.mock.calls.some((c) => c[1] === "thread/status/changed")).toBe(true));

    expect(spy.mock.calls.filter((c) => c[1] === "thread/settings/changed")).toEqual([]);
    expect(record.settings.permissionMode).toBe("acceptEdits");
    expect(record.settings.model).toBeUndefined();
    // …and the view every client reads says the same
    send(conn, { id: 3, method: "thread/list", params: {} });
    await waitFor(() => expect(frame(lines, 3)).toBeTruthy());
    const view = (frame(lines, 3).result.data as Array<Record<string, unknown>>).find((v) => v.id === record.id)!;
    expect(view.permissionMode).toBe("acceptEdits");
    expect(view.model).toBeUndefined();
  });

  it("ACTIVATION: a mid-turn attach loses nothing, and nothing is broadcast ahead of thread/started", async () => {
    // The follow replay is emitted SYNCHRONOUSLY at follow time and lands before the follow reply (P106),
    // so the whole burst is already in the engine's buffer when the record is built. It is released only
    // once every listener is live and the record is published — this case is what proves it.
    const { fh, row } = await host({ busy: true });
    fh.emitMessage({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "half a thought" }] } });
    fh.park({ toolUseID: "tu-1", toolName: "Bash", input: { command: "ls" } });
    fh.emitTasksChanged([{ task_id: "bg-1", task_type: "shell", description: "d" }]);
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, row.short);
    const threadId = rep.result.thread.id;
    const record = srv.registry.get(threadId)!;

    // the replayed turn-start owns the turn: busy, with the DERIVED id
    await waitFor(() => expect(record.busy).toBe(true));
    expect(record.currentTurnId).toBe("t1@e0");
    // the replayed message was itemized into the turn's own buffer (nothing lost)
    expect(record.buffer.map((b) => b.turnId)).toEqual(["t1@e0", "t1@e0"]);
    expect(record.buffer.map((b) => b.event.kind)).toEqual(["started", "completed"]);
    // the parked decision is a VIEW of the host's park — visible to decision/list
    expect(srv.pendingDecisions(threadId).map((d) => d.toolUseID)).toEqual(["tu-1"]);
    // NOTHING preceded thread/started on this connection: the burst is released after it goes out.
    // (Per-thread notifications reach `record.subscribers`, which is necessarily empty during an attach —
    // no client can subscribe to a thread that does not exist yet — so the burst's live delivery is the
    // buffer/park state asserted above, plus the subscribe-time replay below.)
    expect(parsed(lines).filter((f) => f.method)[0].method).toBe("thread/started");

    // …and the replayed TASK snapshot: no record-level mirror holds it (inProcess parity — `task/list`
    // forwards to the engine's own live set on both origins), so this is where a fresh client reads it.
    send(conn, { id: 3, method: "task/list", params: { threadId } });
    await waitFor(() => expect(frame(lines, 3)).toBeTruthy());
    expect(frame(lines, 3).result.data).toEqual([{ task_id: "bg-1", task_type: "shell", description: "d" }]);

    lines.length = 0;
    send(conn, { id: 4, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());
    expect(notifs(lines, "turn/started")[0].params.turn).toEqual({ id: "t1@e0", status: "inProgress" });
    expect(notifs(lines, "item/completed")[0].params).toMatchObject({ turnId: "t1@e0", item: { type: "agentMessage", text: "half a thought" } });
    expect(notifs(lines, "decision/requested")[0].params).toMatchObject({ threadId, turnId: "t1@e0", decision: { toolUseId: "tu-1" } });
    expect(notifs(lines, "thread/status/changed").at(-1)!.params.status).toEqual({ state: "active", waitingOn: "decision" });
  });
});

describe("the fleet event layer owns turn lifecycle (M3 Task 7)", () => {
  /** attach + subscribe — every case below watches one thread's own notification stream. */
  async function attached(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}, deps: Record<string, unknown> = {}) {
    const { fh, row } = await host(opts);
    const { srv, conn, lines } = boot(deps);
    const rep = await attach(conn, lines, 2, row.short);
    const threadId = rep.result.thread.id as string;
    send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(lines, 3)).toBeTruthy());
    lines.length = 0;
    return { fh, srv, conn, lines, threadId, record: srv.registry.get(threadId)! };
  }

  it("an OWN turn produces exactly one started/completed pair, under the derived id, with NO mint", async () => {
    const { fh, lines, conn, threadId, record } = await attached();

    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(fh.promptCalls).toHaveLength(1));
    fh.emitMessage({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hi" }] } });
    fh.endTurn(1, { result: "done" });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));

    expect(frame(lines, 4).result.turn).toEqual({ id: "t1@e0", status: "inProgress" });
    expect(notifs(lines, "turn/started")).toHaveLength(1);
    expect(notifs(lines, "turn/started")[0].params.turn).toEqual({ id: "t1@e0", status: "inProgress" });
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "completed" });
    // the id is DERIVED from the host seq (spec §1b) — the local minter is never reached, and its
    // counter never moves
    expect(mintTurnId).not.toHaveBeenCalled();
    expect(record.turnSeq).toBe(0);
    expect(record.busy).toBe(false);
  });

  it("a trivially-fast OWN turn whose end beats its prompt reply emits the inProgress reply BEFORE turn/completed (F2)", async () => {
    // The event layer broadcasts turn/completed SYNCHRONOUSLY off the host's turn-end frame, while
    // fleetTurnStart's inProgress reply + user item are published on the microtask after the prompt reply
    // resolves (its onAccepted). A turn whose end lands with (or before) its own reply therefore used to put
    // turn/completed on the wire ahead of the reply — terminal-before-acceptance, out of order. turn/started
    // legitimately precedes the reply (the host emits start before the reply); turn/completed must not.
    const { fh, lines, conn, threadId } = await attached();
    fh.completeNextPromptInline({ result: "done" });          // turn/start AND turn/end before the prompt reply
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));

    const seqLines = parsed(lines);
    const iStarted = seqLines.findIndex((f) => f.method === "turn/started");
    const iReply = seqLines.findIndex((f) => f.id === 4);
    const iUserItem = seqLines.findIndex((f) => f.method === "item/completed");
    const iCompleted = seqLines.findIndex((f) => f.method === "turn/completed");
    expect(iStarted).toBeGreaterThanOrEqual(0);
    expect(iReply).toBeGreaterThan(iStarted);                 // started may precede the reply — that is legitimate
    expect(iCompleted).toBeGreaterThan(iReply);               // THE FIX: completed never precedes the inProgress reply
    expect(iCompleted).toBeGreaterThan(iUserItem);            // …nor the user item onAccepted published with it
    expect(frame(lines, 4).result.turn).toEqual({ id: "t1@e0", status: "inProgress" });
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "completed" });
  });

  it("a turn the host reports as FAILED completes failed, and a busy host refuses turn/start with -33001", async () => {
    const { fh, lines, conn, threadId } = await attached();

    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(fh.promptCalls).toHaveLength(1));
    // a second turn/start while the host's turn is in flight: the ordinary busy refusal, off the record
    // state the EVENT layer set (nothing local claimed it)
    send(conn, { id: 5, method: "turn/start", params: { threadId, input: "again" } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).error).toMatchObject({ code: ERR.BUSY });

    fh.endTurn(1, { result: "partial", failure: { message: "API Error", terminalReason: "api_error" } });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t1@e0", status: "failed", error: "API Error" });
  });

  it("a socket death after dispatch but before the prompt ack maps turn/start to -33005, not -32603 (F6)", async () => {
    // fleetTurnStart special-cases only the BUSY refusal; an engine-gone rejection (the host died after the
    // op was sent but before its ack) used to fall through to -32603 INTERNAL, so a client could not tell a
    // reconnectable host loss from a server bug. `isEnded()` is the death latch the -33005 dispatch gate
    // itself reads, so a rejection from a dead engine now maps to ENGINE_GONE like every other fleet op.
    const { fh, lines, conn, threadId } = await attached();
    fh.killNextPrompt();                                       // host destroys the connection instead of acking
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());
    expect(frame(lines, 4).error.code).toBe(ERR.ENGINE_GONE);
    expect(notifs(lines, "turn/started")).toEqual([]);        // no turn ever started
  });

  it("a FOREIGN turn is first-class: started/completed under its own seq, and its frames are itemized", async () => {
    const { fh, lines, threadId, record } = await attached();

    fh.beginTurn(7);                                    // nobody here prompted — another client did
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));
    expect(notifs(lines, "turn/started")[0].params.turn).toEqual({ id: "t7@e0", status: "inProgress" });
    expect(record.busy).toBe(true);

    fh.emitMessage({ type: "assistant", message: { id: "m9", content: [{ type: "text", text: "someone else's work" }] } });
    await waitFor(() => expect(notifs(lines, "item/completed")).toHaveLength(1));
    expect(notifs(lines, "item/started")[0].params).toMatchObject({ threadId, turnId: "t7@e0", item: { id: "m9#0" } });
    expect(notifs(lines, "item/completed")[0].params.item).toMatchObject({ type: "agentMessage", text: "someone else's work" });

    fh.endTurn(7, { result: "ok" });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t7@e0", status: "completed" });
  });

  it("a turn END with no open window announces nothing — an unpaired turn/completed is not a lifecycle", async () => {
    // Unreachable through a real host's emission order (an end is always preceded by the start that opened
    // the window), which is exactly why the fake drives it: this layer must stay well-formed on its own
    // evidence rather than on another process's ordering.
    const { fh, lines } = await attached();

    fh.endTurn(9, { result: "whose turn?" });
    fh.emitTasksChanged([{ task_id: "bg-9", task_type: "shell", description: "after" }]);
    await waitFor(() => expect(notifs(lines, "task/changed")).toHaveLength(1)); // the later frame arrived…
    expect(notifs(lines, "turn/completed")).toEqual([]);                        // …and the end still said nothing
  });

  it("a host tasks_changed reaches the wire as task/changed", async () => {
    const { fh, lines, threadId } = await attached();

    fh.emitTasksChanged([{ task_id: "bg-2", task_type: "shell", description: "sleep" }]);
    await waitFor(() => expect(notifs(lines, "task/changed")).toHaveLength(1));
    expect(notifs(lines, "task/changed")[0].params).toEqual({ threadId, tasks: [{ task_id: "bg-2", task_type: "shell", description: "sleep" }] });
  });

  it("a foreign client's setting change reaches the mirror through `state`", async () => {
    const { fh, lines, threadId, record } = await attached({ status: { model: "sonnet", permissionMode: "default" } });

    fh.setStatus({ model: "opus" });
    await waitFor(() => expect(notifs(lines, "thread/settings/changed")).toHaveLength(1));
    expect(record.settings.model).toBe("opus");
    expect(notifs(lines, "thread/settings/changed")[0].params).toMatchObject({ threadId, source: "engine", model: "opus", permissionMode: "default" });
  });

  it("a host-side rewind bumps the epoch, reconciles the sessionId, announces, and invalidates read cursors", async () => {
    const rows = [0, 1, 2].map((n) => ({ type: "assistant", message: { id: `m${n}`, content: [{ type: "text", text: `row ${n}` }] } }));
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) =>
      (opts ? rows.slice(opts.offset ?? 0, opts.limit === undefined ? undefined : (opts.offset ?? 0) + opts.limit) : rows);
    const { fh, lines, conn, threadId, record } = await attached({ status: { sessionId: "s1" } }, { getSessionMessages });

    send(conn, { id: 4, method: "thread/read", params: { threadId, limit: 1 } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());
    const cursor = frame(lines, 4).result.nextCursor as string;
    expect(cursor.startsWith("0:")).toBe(true);

    fh.emitRewound({ sessionId: "s2" });
    await waitFor(() => expect(notifs(lines, "thread/rewound")).toHaveLength(1));
    expect(record.epoch).toBe(1);
    expect(record.sessionId).toBe("s2");
    expect(notifs(lines, "thread/rewound")[0].params).toMatchObject({ threadId, sessionId: "s2" });

    send(conn, { id: 5, method: "thread/read", params: { threadId, cursor } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).error).toMatchObject({ code: ERR.INVALID_PARAMS, message: expect.stringContaining("cursor invalidated") });

    // the frame router survives the epoch bump — it is re-installed on the SAME socket, since a host-side
    // swap replaces the host's engine, not this client's connection
    fh.emitMessage({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await waitFor(() => expect(notifs(lines, "task/changed")).toHaveLength(1));
  });

  it("a host-side rewind drops the per-turn replay buffer, so a later subscriber sees none of the discarded turn", async () => {
    const { fh, srv, lines, threadId, record } = await attached({ status: { sessionId: "s1" } });

    // A completed turn leaves its item window standing — that window is what subscribe.ts replays to
    // every client that joins before the next turn resets it.
    fh.beginTurn(1);
    fh.emitMessage({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "from the discarded conversation" }] } });
    await waitFor(() => expect(notifs(lines, "item/completed")).toHaveLength(1));
    fh.endTurn(1, { result: "done" });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));
    expect(record.buffer.length).toBeGreaterThan(0);

    // …and then another client of that host rewinds. The turn those items belong to is no longer in the
    // transcript the next reader will page.
    fh.emitRewound({ sessionId: "s2" });
    await waitFor(() => expect(record.epoch).toBe(1));

    const s2 = mkSink();
    const conn2 = srv.connect(s2.sink);
    send(conn2, { id: 1, method: "initialize", params: { clientInfo: { name: "T2" } } });
    await waitFor(() => expect(frame(s2.lines, 1)).toBeTruthy());
    send(conn2, { id: 2, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(s2.lines, 2)).toBeTruthy());

    expect(notifs(s2.lines, "item/completed")).toEqual([]);
    expect(notifs(s2.lines, "item/started")).toEqual([]);
    expect(JSON.stringify(s2.lines)).not.toContain("discarded conversation");
    expect(record.buffer).toEqual([]);   // …and the window itself is gone, not merely unreplayed
  });
});

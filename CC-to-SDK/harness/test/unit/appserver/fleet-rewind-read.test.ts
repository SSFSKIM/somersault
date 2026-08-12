// test/unit/appserver/fleet-rewind-read.test.ts — M3 Task 11: the SWAP FAMILY's fleet branches
// (`thread/rewind` with its anchors/dryRun pair, and `thread/clear`) plus the disk-only fleet
// `thread/read` (spec §1d, §1f).
//
// This file is the closure proof for the last interim hazard of the M3 bridge, and the hazard is a
// SILENT one: `thread/rewind` had no origin branch at all, so a conversation-scope rewind on a fleet
// record latched `swapInFlight` and ran the LOCAL `swapEngine` — disposing the socket to a host that
// other clients are still attached to, and replacing it with a locally resumed SDK session nobody asked
// for. Nothing on the wire would have said so: the reply is `{ok:true}` either way. So the assertions
// that matter here are about ABSENCE, and they are made three ways per case, because no single one of
// them is conclusive on its own:
//
//   1. `record.session` OBJECT IDENTITY is unchanged. A local swap replaces the field; forwarding cannot.
//   2. the host's own op log carries NO `unfollow`. That op is what `FleetEngine.dispose()` sends, so its
//      absence is the host's testimony that its follower was never dropped. (`unfollow` is also recorded
//      from the unregister callback a socket CLOSE fires — hence the assertion is made while the record
//      is still open, where only a deliberate dispose could have produced one.)
//   3. exactly ONE `thread/rewound` per host event. The epoch bump and the broadcast belong to the host's
//      `rewound` (Task 7's event layer); a branch that ALSO announced locally would double them, which a
//      client reads as two rewinds and two invalidated cursors.
//
// Everything is wire-level against a real fake host over a real unix socket for the same reason Tasks
// 7-10's suites are: the properties are about what crossed the socket and in what order, and only the
// real dispatch plus the real transport can show that.
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
/** Every call of one op, in order, with the arguments the HOST's handler was given (fleet-bridge.test.ts's
 *  helper) — the whole evidence base for "this method forwarded, and forwarded exactly this". */
const calls = (fh: FakeHostControls, op: string) => fh.opCalls.filter((c) => c.op === op).map((c) => c.args);

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-swap-")); process.env.CCX_FLEET_ROOT = root; });
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

/** attach + subscribe — every case below watches one fleet thread's own notification stream. */
async function attached(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}, deps: Record<string, unknown> = {}) {
  const { row: over, ...rest } = opts;
  const fh = await startFakeHost(rest);
  hosts.push(fh);
  const row: RosterRow = { ...fh.row, ...over };
  writeRoster(row);
  const { srv, conn, lines } = boot(deps);
  send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
  await waitFor(() => expect(frame(lines, 2)).toBeTruthy());
  const threadId = frame(lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(lines, 3)).toBeTruthy());
  lines.length = 0;
  fh.opCalls.length = 0; fh.ops.length = 0;   // the attach's own status/follow are not the case's evidence
  return { fh, row, srv, conn, lines, threadId, record: srv.registry.get(threadId)! };
}

/** One request, awaited to its reply frame — the shape every case below is written in. */
async function call(conn: { feed(ch: string): void }, lines: string[], id: number, method: string, params: Record<string, unknown>) {
  send(conn, { id, method, params });
  await waitFor(() => expect(frame(lines, id)).toBeTruthy());
  return frame(lines, id);
}

/** Three assistant rows, and a `getSessionMessages` that honours offset/limit exactly as the real reader
 *  does — the DI seam `thread/read` pages off (server.ts's `AppServerDeps`, and the same fixture shape
 *  fleet-adoption.test.ts's cursor case uses). */
const DISK_ROWS = [0, 1, 2].map((n) => ({ type: "assistant", message: { id: `m${n}`, content: [{ type: "text", text: `row ${n}` }] } }));
const diskReader = (rows: unknown[] = DISK_ROWS) => async (_sid: string, opts?: { limit?: number; offset?: number }) =>
  (opts ? rows.slice(opts.offset ?? 0, opts.limit === undefined ? undefined : (opts.offset ?? 0) + opts.limit) : rows);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("thread/rewind on a fleet thread forwards the host op and never swaps locally (§1d)", () => {
  it("forwards {op:'rewind'} with all three fields; no local dispose, no local swap, ONE rewound", async () => {
    const { fh, conn, lines, threadId, record } = await attached({ status: { sessionId: "s1" } }, { getSessionMessages: diskReader() });
    const engine = record.session;   // (1) the identity this case is about

    // A cursor minted BEFORE the swap — the epoch bump is what must invalidate it, and only a real bump can.
    const page = await call(conn, lines, 10, "thread/read", { threadId, limit: 1 });
    const cursor = page.result.nextCursor as string;
    expect(cursor.startsWith("0:")).toBe(true);

    const rep = await call(conn, lines, 11, "thread/rewind", { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" });
    expect(rep.result).toEqual({ ok: true, sessionId: "s1" });

    // FORWARDED, verbatim: the host handler took the anchor pair and the scope.
    expect(calls(fh, "rewind")).toEqual([[{ uuid: "u2", prevUuid: "u1" }, "conversation"]]);
    // (1) the engine was never replaced, and (2) the host was never told to drop this follower.
    expect(record.session).toBe(engine);
    expect(fh.ops).not.toContain("unfollow");
    expect(record.swapInFlight).toBeFalsy();

    // (3) exactly ONE broadcast, and it is the HOST's — epoch and id both move off its `rewound`.
    expect(notifs(lines, "thread/rewound")).toHaveLength(1);
    expect(notifs(lines, "thread/rewound")[0].params).toMatchObject({ threadId, sessionId: "s1" });
    expect(record.epoch).toBe(1);

    const stale = await call(conn, lines, 12, "thread/read", { threadId, cursor });
    expect(stale.error).toMatchObject({ code: ERR.INVALID_PARAMS, message: expect.stringContaining("cursor invalidated") });
  });

  it("a code-scope rewind forwards too, and this server announces nothing the host did not", async () => {
    const { fh, conn, lines, threadId, record } = await attached({ status: { sessionId: "s1" } });

    expect((await call(conn, lines, 10, "thread/rewind", { threadId, uuid: "u2", prevUuid: "u1", scope: "code" })).result)
      .toEqual({ ok: true, sessionId: "s1" });

    expect(calls(fh, "rewind")).toEqual([[{ uuid: "u2", prevUuid: "u1" }, "code"]]);
    // A code-only restore swaps no engine, so the host emits no `rewound` — and neither may this server.
    expect(notifs(lines, "thread/rewound")).toEqual([]);
    expect(record.epoch).toBe(0);
    expect(record.session.isEnded!()).toBe(false);
  });

  it("a null prevUuid is FORWARDED, not refused locally — the host expresses it by clearing", async () => {
    const { fh, conn, lines, threadId, record } = await attached({ status: { sessionId: "s1" } });

    // The inProcess arm refuses this -32602 because `resumeAt` cannot name "before the first message".
    // That is a statement about the LOCAL fork primitive; the host's own rewind clears instead (W-S8,
    // host.ts's `clearing`), so refusing here would deny a capability the engine on the other end has.
    const rep = await call(conn, lines, 10, "thread/rewind", { threadId, uuid: "u1", prevUuid: null, scope: "conversation" });
    expect(rep.result).toEqual({ ok: true, sessionId: null });

    expect(calls(fh, "rewind")).toEqual([[{ uuid: "u1", prevUuid: null }, "conversation"]]);
    expect(notifs(lines, "thread/rewound")).toHaveLength(1);
    expect(notifs(lines, "thread/rewound")[0].params).toMatchObject({ threadId, sessionId: null, cleared: true });
    expect(record.sessionId).toBeUndefined();
  });

  it("busy refuses -33001 BEFORE any op is sent", async () => {
    const { fh, conn, lines, threadId } = await attached();
    fh.beginTurn(7);
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));
    fh.opCalls.length = 0; fh.ops.length = 0;

    const rep = await call(conn, lines, 10, "thread/rewind", { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" });
    expect(rep.error).toMatchObject({ code: ERR.BUSY, message: "Thread is busy (turn)" });
    expect(fh.ops).toEqual([]);   // the local gate answered; nothing reached the host
  });

  it("a parked decision VIEW refuses -33001 before any op is sent (the host refuses the same way)", async () => {
    const { fh, conn, lines, threadId } = await attached();
    fh.park({ toolUseID: "t1" });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));
    fh.opCalls.length = 0; fh.ops.length = 0;

    const rep = await call(conn, lines, 10, "thread/rewind", { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" });
    expect(rep.error).toMatchObject({ code: ERR.BUSY, message: "a decision is pending — answer it first" });
    expect(fh.ops).toEqual([]);
  });

  it("no local sessionId gate: the HOST decides whether it has a conversation to rewind", async () => {
    // No `status.sessionId`, so the record carries none either — the inProcess arm answers -33005 "no
    // session to rewind" from its own field. A fleet record's id is a mirror of the host's, and the host
    // is the only party that knows whether its engine has one; forwarding is what asks it.
    const { fh, conn, lines, threadId, record } = await attached();
    expect(record.sessionId).toBeUndefined();

    const rep = await call(conn, lines, 10, "thread/rewind", { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" });
    expect(rep.error).toMatchObject({ code: ERR.INTERNAL, message: "no session to rewind" });
    expect(calls(fh, "rewind")).toEqual([[{ uuid: "u2", prevUuid: "u1" }, "conversation"]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the read half of the rewind trio forwards to the host (§1d)", () => {
  it("thread/rewind/anchors maps the host's rewind_anchors reply", async () => {
    const anchors = [{ uuid: "u2", prevUuid: "u1", text: "second", index: 2 }, { uuid: "u1", prevUuid: null, text: "first", index: 0 }];
    const { fh, conn, lines, threadId } = await attached({ status: { sessionId: "s1" } });
    fh.replies.rewind_anchors = anchors;

    const rep = await call(conn, lines, 10, "thread/rewind/anchors", { threadId });
    expect(rep.result).toEqual({ data: anchors, nextCursor: null });
    expect(calls(fh, "rewind_anchors")).toHaveLength(1);
  });

  it("anchors forwards even with no sessionId on the record — the host reads its own transcript", async () => {
    const { fh, conn, lines, threadId, record } = await attached();
    expect(record.sessionId).toBeUndefined();

    // The inProcess arm short-circuits to an empty page here (nothing persisted yet). On this origin that
    // field is a mirror that a host-side swap can leave momentarily empty, and the host's own
    // `rewindAnchors` already answers `[]` when it genuinely has nothing.
    expect((await call(conn, lines, 10, "thread/rewind/anchors", { threadId })).result).toEqual({ data: [], nextCursor: null });
    expect(calls(fh, "rewind_anchors")).toHaveLength(1);
  });

  it("thread/rewind/dryRun forwards the uuid and relays the host's verdict", async () => {
    const dryRun = { canRewind: true, filesChanged: ["a.ts"], insertions: 2, deletions: 1 };
    const { fh, conn, lines, threadId, record } = await attached({ status: { sessionId: "s1" } });
    fh.replies.rewind_dryrun = dryRun;
    // The absent member IS the design (§1b): without the branch this handler self-refuses through
    // `dryRunRewind`, which is a verdict about THIS server's engine, not about the host's.
    expect(record.session.rewind).toBeUndefined();

    expect((await call(conn, lines, 10, "thread/rewind/dryRun", { threadId, uuid: "u2" })).result).toEqual(dryRun);
    expect(calls(fh, "rewind_dryrun")).toEqual([["u2"]]);
  });

  it("a host that cannot dry-run answers the ONE shape, not an RPC error", async () => {
    const { fh, conn, lines, threadId } = await attached({ status: { sessionId: "s1" } });
    fh.replies.rewind_dryrun = { canRewind: false, error: "file checkpointing is off" };

    expect((await call(conn, lines, 10, "thread/rewind/dryRun", { threadId, uuid: "u2" })).result)
      .toEqual({ canRewind: false, error: "file checkpointing is off" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("thread/clear on a fleet thread forwards {op:'clear'} (§1d)", () => {
  it("forwards, swaps nothing locally, and rides the host's own cleared rewound", async () => {
    const { fh, conn, lines, threadId, record } = await attached({ status: { sessionId: "s1" } });
    const engine = record.session;

    expect((await call(conn, lines, 10, "thread/clear", { threadId })).result).toEqual({ ok: true, sessionId: null });

    expect(calls(fh, "clear")).toHaveLength(1);
    expect(record.session).toBe(engine);
    expect(fh.ops).not.toContain("unfollow");
    expect(record.swapInFlight).toBeFalsy();
    expect(notifs(lines, "thread/rewound")).toHaveLength(1);
    expect(notifs(lines, "thread/rewound")[0].params).toMatchObject({ threadId, sessionId: null, cleared: true });
    expect(record.epoch).toBe(1);
    expect(record.sessionId).toBeUndefined();
    // Task 10's conditional: its MCP/flag accumulators stay empty on this origin precisely BECAUSE no
    // local swap ever runs here, so `repushThreadState` has nothing to replay and nothing to reconcile.
    expect(record.mcpToggles).toEqual({});
    expect(record.mcpServersSet).toBeUndefined();
  });

  it("busy refuses -33001 before the op is sent", async () => {
    const { fh, conn, lines, threadId } = await attached();
    fh.beginTurn(3);
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));
    fh.opCalls.length = 0; fh.ops.length = 0;

    expect((await call(conn, lines, 10, "thread/clear", { threadId })).error).toMatchObject({ code: ERR.BUSY, message: "Thread is busy (turn)" });
    expect(fh.ops).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("thread/read on a fleet thread is disk-only (§1f)", () => {
  it("pages the persisted transcript under the epoch-qualified cursor", async () => {
    const { conn, lines, threadId } = await attached({ status: { sessionId: "s1" } }, { getSessionMessages: diskReader() });

    const first = await call(conn, lines, 10, "thread/read", { threadId, limit: 2 });
    expect((first.result.data as Array<{ text?: string }>).map((i) => i.text)).toEqual(["row 1", "row 2"]);
    expect(first.result.nextCursor).toBe("0:1");

    const older = await call(conn, lines, 11, "thread/read", { threadId, cursor: "0:1" });
    expect((older.result.data as Array<{ text?: string }>).map((i) => i.text)).toEqual(["row 0"]);
    expect(older.result.nextCursor).toBeNull();
  });

  it("a LIVE mid-turn message never joins a page — the page is exactly the disk fixture", async () => {
    const { fh, conn, lines, threadId } = await attached({ status: { sessionId: "s1" } }, { getSessionMessages: diskReader() });

    const before = await call(conn, lines, 10, "thread/read", { threadId });

    // A real turn on the host: the frame reaches the item layer (and this thread's live per-turn buffer),
    // which is the ONE thing a page must not absorb — the live half travels via subscribe replay, and an
    // absolute-offset cursor that counted it would double-count the row once the turn persists.
    fh.beginTurn(4);
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));
    fh.emitMessage({ type: "assistant", message: { id: "live", content: [{ type: "text", text: "LIVE" }] } });
    await waitFor(() => expect(notifs(lines, "item/completed")).toHaveLength(1));

    const after = await call(conn, lines, 11, "thread/read", { threadId });
    expect(after.result).toEqual(before.result);   // equality, not mere non-inclusion
    expect(JSON.stringify(after.result.data)).not.toContain("LIVE");
  });

  it("no sessionId yet is an empty page, not an error (the M1 rule, origin-blind)", async () => {
    const { conn, lines, threadId } = await attached({}, { getSessionMessages: diskReader() });
    expect((await call(conn, lines, 10, "thread/read", { threadId })).result).toEqual({ data: [], nextCursor: null });
  });
});

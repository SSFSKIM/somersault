// test/unit/appserver/fleet-decisions.test.ts — M3 Task 8: decision forwarding for fleet threads (spec
// §1b). A fleet thread's park belongs to the HOST; this server holds a VIEW of it, forwards answers to the
// host's `answer` op, and removes the view only when the host says it is settled.
//
// Every case drives a REAL fake host over a REAL unix socket (test/helpers/fakeHost.ts), wire-level through
// `srv.connect`/`feed`, because both properties under test are ORDERING properties: that the respond path
// never settles the view (only `decision_settled` does — even for the respond that won), and that the
// host's own receipt strings are what the error mapping keys on. Three cases additionally run a LOCAL
// (inProcess) thread on the same server and assert equality against it: neither the not-found error nor
// the resolved payload may depend on which origin answered.
//
// Each case gets its OWN `CCX_FLEET_ROOT` (the per-file default from test/setup/fleetRoot.ts is shared by
// every case in a file, and a roster row written by one case would then be in the next case's listing).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls, FakeHostOpts, PendingDecisionLike } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { PermissionBroker } from "../../../src/permissions/types.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const idxOf = (lines: string[], pred: (f: Record<string, unknown>) => boolean) => parsed(lines).findIndex(pred);
const listed = (lines: string[], id: number) => (frame(lines, id).result.data as Array<{ toolUseId: string }>).map((d) => d.toolUseId);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });
/** Who this server is when it answers a host park (fleetEngine.ts's LABEL) — the fake runs in THIS
 *  process, so the label the host stamps onto `decision_settled.by` is computable here. */
const LABEL = `ccx-appserver-${process.pid}`;

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fleetdec-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

/** A fake engine for the LOCAL threads the equality cases compare against — the same one-liner
 *  decisions.test.ts uses, so a local park here behaves exactly as it does in Task 7's own suite. */
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-local" });

/** A live fake host WITH its roster row on disk — the pair `thread/attach` resolves against. */
async function host(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}): Promise<{ fh: FakeHostControls; row: RosterRow }> {
  const { row: over, ...rest } = opts;
  const fh = await startFakeHost(rest);
  hosts.push(fh);
  const row: RosterRow = { ...fh.row, ...over };
  writeRoster(row);
  return { fh, row };
}

/** attach + subscribe: every case below watches one fleet thread's own notification stream. `brokers`
 *  collects the permission broker of any LOCAL thread the case also starts (the equality comparisons). */
async function attached(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}) {
  const { fh, row } = await host(opts);
  const brokers: PermissionBroker[] = [];
  const deps = { sessionFactory: (cfg: Record<string, unknown>) => { brokers.push(cfg.permissionBroker as PermissionBroker); return fakeSession(); } };
  const srv = new AppServer({}, deps as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
  await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
  const threadId = frame(s.lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
  s.lines.length = 0;
  return { fh, srv, conn, lines: s.lines, threadId, brokers, record: srv.registry.get(threadId)! };
}

/** Start a LOCAL (inProcess) thread on the same server, subscribed — the baseline the fleet path's error
 *  and notification shapes are compared against. Consumes ids `id` and `id+1`. */
async function localThread(ctx: { conn: { feed(ch: string): void }; lines: string[]; brokers: PermissionBroker[] }, id: number) {
  send(ctx.conn, { id, method: "thread/start", params: {} });
  await waitFor(() => expect(frame(ctx.lines, id)).toBeTruthy());
  const threadId = frame(ctx.lines, id).result.thread.id as string;
  send(ctx.conn, { id: id + 1, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(ctx.lines, id + 1)).toBeTruthy());
  return { threadId, broker: ctx.brokers.at(-1)! };
}

/** The rich park both origins are compared on — every optional field a `PermissionRequest` carries, so a
 *  field the view drops shows up as a missing key rather than as a value nobody asserted. */
const RICH_FIELDS = {
  toolName: "AskUserQuestion", kind: "question" as const,
  input: { questions: [{ question: "ship it?" }] },
  parentToolUseID: "tu-parent", subagentType: "explore", title: "Ship?", displayName: "Ask", description: "a question",
  suggestions: [{ type: "addRules", destination: "session" }], decisionReason: "the model asked",
  blockedPath: "/nope", agentID: "ag-1",
};
const RICH: PendingDecisionLike = { toolUseID: "tu-rich", createdAt: 1_700_000_000_000, ...RICH_FIELDS };

describe("a host park is a VIEW with the host's own fields (M3 Task 8)", () => {
  it("carries every field a locally-parked entry carries — same keys, the host's values, the host's park time", async () => {
    const { fh, conn, lines, threadId, brokers } = await attached();

    fh.park(RICH);
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));
    const view = notifs(lines, "decision/requested")[0].params.decision as Record<string, unknown>;

    // the wire spelling (toolUseId) and the thread's own id as sessionId — as for every local park
    expect(view).toEqual({
      ...RICH_FIELDS, sessionId: threadId, toolUseId: "tu-rich",
      // the HOST's park time, not the attach's: a park raised an hour ago must not read as brand new
      createdAt: 1_700_000_000_000,
    });

    // …and the same key set a LOCAL park of the same request produces (the vocabularies are 1:1, §1b)
    const local = await localThread({ conn, lines, brokers }, 10);
    void local.broker.request({ ...RICH_FIELDS, toolUseID: "tu-local", signal: new AbortController().signal });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(2));
    const localView = notifs(lines, "decision/requested")[1].params.decision as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(Object.keys(localView).sort());
  });
});

describe("decision/respond forwards to the host (M3 Task 8)", () => {
  it("sends the structured outcome and leaves the view parked until the host's settle removes it", async () => {
    const { fh, lines, conn, threadId } = await attached();
    fh.park({ toolUseID: "tu-1", toolName: "AskUserQuestion", kind: "question", input: {} });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));

    const answer = { kind: "question_answer", answers: { q1: "yes" }, response: "free text" };
    // The two frames are fed in ONE tick: the respond handler runs its synchronous prefix (which writes the
    // `answer` op to the socket) and returns at its await, then decision/list answers synchronously —
    // strictly before any host frame, which needs I/O to arrive. That window is where a respond path that
    // settled its own view would already have removed it.
    send(conn, { id: 5, method: "decision/respond", params: { threadId, toolUseId: "tu-1", answer } });
    send(conn, { id: 6, method: "decision/list", params: { threadId } });
    await waitFor(() => expect(frame(lines, 6)).toBeTruthy());
    expect(listed(lines, 6)).toEqual(["tu-1"]);

    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).result).toEqual({ ok: true });
    // the op the host received: the STRUCTURED outcome (the flat legacy form would drop the answers) plus
    // this server's own label, which is what comes back as `decision_settled.by`
    expect(fh.opCalls.filter((o) => o.op === "answer").map((o) => o.args)).toEqual([["tu-1", answer, LABEL]]);

    // the settlement is the HOST's, and it is the only thing that removes the view
    await waitFor(() => expect(notifs(lines, "decision/resolved")).toHaveLength(1));
    expect(notifs(lines, "decision/resolved")[0].params).toEqual({ threadId, toolUseId: "tu-1", by: LABEL, answer });
    // the still-parked list was answered BEFORE that settlement — the ordering, not just the end state
    expect(idxOf(lines, (f) => f.id === 6)).toBeLessThan(idxOf(lines, (f) => f.method === "decision/resolved"));

    send(conn, { id: 7, method: "decision/list", params: { threadId } });
    await waitFor(() => expect(frame(lines, 7)).toBeTruthy());
    expect(frame(lines, 7).result.data).toEqual([]);
    expect(notifs(lines, "decision/resolved")).toHaveLength(1);   // one settlement, one announcement
  });

  it("abortTurn rides the same path: the answer goes first, the interrupt after", async () => {
    const { fh, lines, conn, threadId } = await attached({ busy: true });
    fh.park({ toolUseID: "tu-a", input: { command: "rm -rf /" } });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));

    send(conn, { id: 5, method: "decision/respond", params: { threadId, toolUseId: "tu-a", answer: { kind: "deny", feedback: "no" }, abortTurn: true } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).result).toEqual({ ok: true });
    expect(fh.ops.filter((o) => o === "answer" || o === "interrupt")).toEqual(["answer", "interrupt"]);
  });

  it("a plan approval arms NO local upgrade — the host applies its own", async () => {
    const { fh, lines, conn, threadId, record } = await attached();
    fh.park({ toolUseID: "tu-p", toolName: "ExitPlanMode", kind: "plan", input: { plan: "do it" } });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));

    send(conn, { id: 5, method: "decision/respond", params: { threadId, toolUseId: "tu-p", answer: { kind: "plan_approve", mode: "acceptEdits" } } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).result).toEqual({ ok: true });
    expect(record.planUpgradeMode).toBeUndefined();

    // the trigger a locally-armed upgrade would fire on (router.ts's status route) reaches the thread and
    // still sends no setter: a second `set_permission_mode` for a mode the host already applied
    fh.emitMessage({ type: "system", subtype: "status", permissionMode: "acceptEdits" });
    await waitFor(() => expect(notifs(lines, "thread/settings/changed")).toHaveLength(1));
    expect(fh.ops).not.toContain("set_permission_mode");
  });
});

describe("receipt mapping is exact (M3 Task 8)", () => {
  it("a LOST RACE answers -33002 naming the winner, and the foreign settle already dropped the view", async () => {
    const { fh, lines, conn, threadId } = await attached();
    fh.park({ toolUseID: "tu-1", input: {} });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));

    // another client of the same host answered first (§1a-e: the whole outcome travels)
    fh.settle("tu-1", "other", { kind: "allow_once", updatedInput: { command: "ls -l" } });
    await waitFor(() => expect(notifs(lines, "decision/resolved")).toHaveLength(1));
    expect(notifs(lines, "decision/resolved")[0].params).toEqual({
      threadId, toolUseId: "tu-1", by: "other", answer: { kind: "allow_once", updatedInput: { command: "ls -l" } },
    });

    send(conn, { id: 5, method: "decision/respond", params: { threadId, toolUseId: "tu-1", answer: { kind: "allow_once" } } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).error).toEqual({ code: ERR.ALREADY_SETTLED, message: "Already settled", data: { by: "other" } });
    // the loser's answer still went to the host — first-answer-wins is host-side, never guessed from a
    // local view (which can be stale in either direction)
    expect(fh.opCalls.filter((o) => o.op === "answer")).toHaveLength(1);
    expect(notifs(lines, "decision/resolved")).toHaveLength(1);   // one settlement, one announcement
  });

  it("an id the host never parked answers EXACTLY what a local thread answers for an unknown id", async () => {
    const { fh, lines, conn, threadId, brokers } = await attached();
    const local = await localThread({ conn, lines, brokers }, 10);

    send(conn, { id: 20, method: "decision/respond", params: { threadId, toolUseId: "tu-ghost", answer: { kind: "allow_once" } } });
    send(conn, { id: 21, method: "decision/respond", params: { threadId: local.threadId, toolUseId: "tu-ghost", answer: { kind: "allow_once" } } });
    await waitFor(() => { expect(frame(lines, 20)).toBeTruthy(); expect(frame(lines, 21)).toBeTruthy(); });

    expect(frame(lines, 20).error).toEqual(frame(lines, 21).error);
    expect(frame(lines, 20).error).toEqual({ code: ERR.ALREADY_SETTLED, message: "Already settled", data: {} });
    // forwarded, not answered from the local view's absence
    expect(fh.opCalls.filter((o) => o.op === "answer").map((o) => o.args[0])).toEqual(["tu-ghost"]);
  });

  it("a KIND MISMATCH answers -32602 carrying the host's own message, and the park survives it", async () => {
    const { fh, lines, conn, threadId } = await attached();
    fh.park({ toolUseID: "tu-1", toolName: "Bash", kind: "permission", input: {} });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));

    send(conn, { id: 5, method: "decision/respond", params: { threadId, toolUseId: "tu-1", answer: { kind: "question_answer", answers: { q: "a" } } } });
    await waitFor(() => expect(frame(lines, 5)).toBeTruthy());
    expect(frame(lines, 5).error).toEqual({ code: ERR.INVALID_PARAMS, message: "kind mismatch: permission park cannot take question_answer" });

    // the host kind-checks BEFORE settling, so the park is still there for a correct answer
    send(conn, { id: 6, method: "decision/list", params: { threadId } });
    await waitFor(() => expect(frame(lines, 6)).toBeTruthy());
    expect(listed(lines, 6)).toEqual(["tu-1"]);
    expect(notifs(lines, "decision/resolved")).toEqual([]);

    send(conn, { id: 7, method: "decision/respond", params: { threadId, toolUseId: "tu-1", answer: { kind: "allow_once" } } });
    await waitFor(() => expect(frame(lines, 7)).toBeTruthy());
    expect(frame(lines, 7).result).toEqual({ ok: true });
    await waitFor(() => expect(notifs(lines, "decision/resolved")).toHaveLength(1));
  });
});

describe("decision/resolved is the SAME notification both origins emit (M3 Task 8)", () => {
  it("a host settle and a local respond produce the same payload shape", async () => {
    const { fh, lines, conn, threadId, brokers } = await attached();
    const local = await localThread({ conn, lines, brokers }, 10);

    fh.park({ toolUseID: "tu-f", toolName: "Bash", kind: "permission", input: {} });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(1));
    fh.settle("tu-f", "fh-user", { kind: "deny", feedback: "not that one" });
    await waitFor(() => expect(notifs(lines, "decision/resolved")).toHaveLength(1));

    void local.broker.request({ toolName: "Bash", input: {}, toolUseID: "tu-l", signal: new AbortController().signal });
    await waitFor(() => expect(notifs(lines, "decision/requested")).toHaveLength(2));
    send(conn, { id: 20, method: "decision/respond", params: { threadId: local.threadId, toolUseId: "tu-l", answer: { kind: "deny", feedback: "not that one" } } });
    await waitFor(() => expect(notifs(lines, "decision/resolved")).toHaveLength(2));

    const fleetResolved = notifs(lines, "decision/resolved")[0].params as Record<string, unknown>;
    const localResolved = notifs(lines, "decision/resolved")[1].params as Record<string, unknown>;
    expect(Object.keys(fleetResolved).sort()).toEqual(Object.keys(localResolved).sort());
    expect(fleetResolved).toEqual({ threadId, toolUseId: "tu-f", by: "fh-user", answer: { kind: "deny", feedback: "not that one" } });
    expect(localResolved).toEqual({ threadId: local.threadId, toolUseId: "tu-l", by: expect.stringMatching(/^T#\d+$/), answer: { kind: "deny", feedback: "not that one" } });
    // the fleet `by` is the HOST's, verbatim — never this server's own client stamp
    expect(fleetResolved.by).not.toMatch(/^T#\d+$/);
  });

  it("a settle for a decision this server holds no view of announces nothing", async () => {
    const { fh, lines } = await attached();
    // Not parked here (settled host-side before anyone attached, say): a decision/resolved for a
    // decision/requested no client ever heard is an unpaired event.
    fh.settle("tu-unknown", "someone", { kind: "allow_once" });
    fh.emitTasksChanged([{ task_id: "bg-1", task_type: "shell", description: "after" }]);
    await waitFor(() => expect(notifs(lines, "task/changed")).toHaveLength(1));  // the later frame arrived…
    expect(notifs(lines, "decision/resolved")).toEqual([]);                      // …and the settle said nothing
  });
});

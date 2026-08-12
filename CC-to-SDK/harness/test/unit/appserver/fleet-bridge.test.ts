// test/unit/appserver/fleet-bridge.test.ts — M3 Task 10: the FORWARDED control + settings surface. What
// this file proves is mostly ABSENCE, which is why it is wire-level against a real fake host rather than a
// handler unit test: the two interim hazards this task closes are both "the inProcess path did something
// extra", and only the host's own op log plus the notification stream can show that the extra thing is
// gone.
//
//  1. FLAG WRITERS. The shared `flagMutation` path calls `applyFlagSettings` — a member a fleet engine
//     deliberately does NOT have (§1b) — and maintains the per-record accumulator the swap seam replays.
//     Neither is right for a fleet thread: the HOST owns flag truth, and no local swap ever replays
//     anything. So each writer must reach the host as its own dedicated op AND leave every accumulator
//     empty, which is asserted on every case rather than once.
//  2. `thread/compact/start`. The inProcess arm rides the whole turn machinery (busy claim, minted turn
//     id, turn/started + turn/completed). On a fleet thread that would fabricate busy state no other
//     client of that host observes, and put a locally-minted turn id on a wire whose turn ids are DERIVED
//     from the host seq — two owners for one thread's lifecycle. The deviation (§1d) is the fix, and the
//     foreign-turn case below is what shows the fight is structurally gone rather than merely unlikely.
//
// Everything else here is the ZERO-CHANGE half of the task: handlers whose optional member the fleet
// engine already satisfies (mcp trio, task trio, the introspection reads, `thread/settings/read`). "It
// should just work" is a claim about a member signature; these cases are the evidence.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls, FakeHostOpts } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { emptyFlagPerms } from "../../../src/appserver/registry.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });
/** Every call of one op, in order, with the arguments the HOST's handler was given — the whole evidence
 *  base for "this method forwarded, and forwarded exactly this". */
const calls = (fh: FakeHostControls, op: string) => fh.opCalls.filter((c) => c.op === op).map((c) => c.args);

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-bridge-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

function boot() {
  const srv = new AppServer({}, {} as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  s.lines.length = 0;
  return { srv, conn, lines: s.lines };
}

/** attach + subscribe — every case below watches one fleet thread's own notification stream. */
async function attached(opts: FakeHostOpts & { row?: Partial<RosterRow> } = {}) {
  const { row: over, ...rest } = opts;
  const fh = await startFakeHost(rest);
  hosts.push(fh);
  const row: RosterRow = { ...fh.row, ...over };
  writeRoster(row);
  const { srv, conn, lines } = boot();
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("flag writers on a fleet thread forward dedicated ops and touch no accumulator (§1b)", () => {
  const CASES: Array<{ method: string; params: Record<string, unknown>; op: string; args: unknown[] }> = [
    { method: "thread/directory/add", params: { path: "/tmp/grant" }, op: "add_dir", args: ["/tmp/grant"] },
    { method: "thread/directory/remove", params: { path: "/tmp/grant" }, op: "remove_dir", args: ["/tmp/grant"] },
    { method: "thread/permissionRule/add", params: { behavior: "allow", rule: "Bash(ls:*)" }, op: "add_rule", args: ["allow", "Bash(ls:*)"] },
    { method: "thread/permissionRule/remove", params: { behavior: "deny", rule: "Bash(rm:*)" }, op: "remove_rule", args: ["deny", "Bash(rm:*)"] },
    { method: "thread/outputStyle/set", params: { style: "Explanatory" }, op: "set_output_style", args: ["Explanatory"] },
    { method: "thread/effort/set", params: { level: "high" }, op: "set_effort", args: ["high"] },
  ];

  for (const c of CASES) {
    it(`${c.method} sends ${c.op} and leaves flagPerms/flagOutputStyle/flagEffort untouched`, async () => {
      const { fh, conn, lines, record } = await attached();
      // The absent member IS the design (§1b's absent list): the fleet arm must not be reachable through
      // the shared applyFlagSettings path at all, and this is what makes that a compile-and-runtime fact
      // rather than a comment.
      expect(record.session.applyFlagSettings).toBeUndefined();

      expect((await call(conn, lines, 10, c.method, { threadId: record.id, ...c.params })).result).toEqual({ ok: true });

      expect(calls(fh, c.op)).toEqual([c.args]);
      expect(fh.ops).not.toContain("get_settings"); // no accumulator means no read-modify-write either
      expect(record.flagPerms).toEqual(emptyFlagPerms());
      expect(record.flagOutputStyle).toBeUndefined();
      expect(record.flagEffort).toBeUndefined();
    });
  }

  it("a repeat directory/add forwards AGAIN — the dedup guard is inProcess-only (the host owns truth)", async () => {
    const { fh, conn, lines, record } = await attached();
    await call(conn, lines, 10, "thread/directory/add", { threadId: record.id, path: "/tmp/twice" });
    expect((await call(conn, lines, 11, "thread/directory/add", { threadId: record.id, path: "/tmp/twice" })).result).toEqual({ ok: true });
    expect(calls(fh, "add_dir")).toEqual([["/tmp/twice"], ["/tmp/twice"]]);
    expect(record.flagPerms).toEqual(emptyFlagPerms());
  });

  it("a host refusal reaches the caller as an error, not a false {ok:true}", async () => {
    const { fh, conn, lines, record } = await attached();
    await fh.close();
    await waitFor(() => expect(record.session.isEnded!()).toBe(true));
    const rep = await call(conn, lines, 10, "thread/effort/set", { threadId: record.id, level: "max" });
    expect(rep.error.code).toBe(ERR.ENGINE_GONE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("forwarded reads on a fleet thread (§1b's table)", () => {
  it("thread/settings/read maps the host's get_settings reply", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.get_settings = { outputStyle: "Explanatory", effortLevel: "high" };
    const rep = await call(conn, lines, 10, "thread/settings/read", { threadId: record.id });
    expect(rep.result).toEqual({ settings: { outputStyle: "Explanatory", effortLevel: "high" } });
    expect(calls(fh, "get_settings")).toEqual([[]]);
  });

  it("thread/directory/list forwards list_dirs — the HOST's three sources, not this server's empty layer", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.list_dirs = [{ path: "/repo", source: "cwd" }, { path: "/extra", source: "launch" }, { path: "/tmp/grant", source: "session" }];
    const rep = await call(conn, lines, 10, "thread/directory/list", { threadId: record.id });
    expect(rep.result).toEqual({ data: fh.replies.list_dirs, nextCursor: null });
    expect(calls(fh, "list_dirs")).toEqual([[]]);
  });

  it("thread/usage/read and thread/contextUsage/read round-trip the host's payloads", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.usage = { ok: true, usage: { totalTokens: 7 } };
    fh.replies.context_usage = { ok: true, usage: { used: 3, total: 9 } };
    expect((await call(conn, lines, 10, "thread/usage/read", { threadId: record.id })).result).toEqual({ usage: { totalTokens: 7 } });
    expect((await call(conn, lines, 11, "thread/contextUsage/read", { threadId: record.id })).result).toEqual({ contextUsage: { used: 3, total: 9 } });
  });

  it("thread/capabilities/read carries all FOUR catalogs — agents included (§1a-d)", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.capabilities = { ok: true, models: ["m1"], commands: ["/c"], mcpServers: [{ name: "s" }], agents: ["reviewer"] };
    const rep = await call(conn, lines, 10, "thread/capabilities/read", { threadId: record.id });
    expect(rep.result).toEqual({ capabilities: { models: ["m1"], commands: ["/c"], mcpServers: [{ name: "s" }], agents: ["reviewer"] } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the three mirrored setters: the host's `state` is the mirror's only writer (§1a-c, Task 7)", () => {
  it("thread/model/set forwards set_model and the mirror moves on the EVENT — one notification, source engine", async () => {
    const { fh, conn, lines, record } = await attached({ status: { model: "old-model" } });
    expect(record.settings.model).toBe("old-model");

    expect((await call(conn, lines, 10, "thread/model/set", { threadId: record.id, model: "new-model" })).result).toEqual({ ok: true });

    expect(calls(fh, "set_model").map((a) => (a[0] as { model?: string }).model)).toEqual(["new-model"]);
    // ONE notification, and it is the ENGINE leg. A setter that also wrote the mirror would announce its
    // own `source:"client"` copy beside the host's — two events for one change, the second contradicting
    // nothing but claiming a different author.
    await waitFor(() => expect(notifs(lines, "thread/settings/changed")).toHaveLength(1));
    expect(notifs(lines, "thread/settings/changed")[0].params).toMatchObject({ threadId: record.id, source: "engine", model: "new-model" });
    expect(record.settings.model).toBe("new-model");
  });

  it("a RESET (model:null) forwards a bare set_model and leaves the mirror exactly as the host reports it", async () => {
    // The sharp edge of single-source: the host answers a model reset by publishing `model` ABSENT, which
    // §1a-c reads as "unknown", never as "cleared". A setter writing its own mirror would blank a value
    // the host never said it had lost — and announce it.
    const { fh, conn, lines, record } = await attached({ status: { model: "old-model" } });
    expect((await call(conn, lines, 10, "thread/model/set", { threadId: record.id, model: null })).result).toEqual({ ok: true });
    expect(calls(fh, "set_model")).toEqual([[{ op: "set_model", id: expect.any(Number) }]]);
    expect(record.settings.model).toBe("old-model");
    expect(notifs(lines, "thread/settings/changed")).toEqual([]);
  });

  it("thread/permissionMode/set forwards set_permission_mode; the mirror rides the state event", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "thread/permissionMode/set", { threadId: record.id, mode: "acceptEdits" })).result).toEqual({ ok: true });
    expect(calls(fh, "set_permission_mode").map((a) => (a[0] as { mode?: string }).mode)).toEqual(["acceptEdits"]);
    await waitFor(() => expect(notifs(lines, "thread/settings/changed")).toHaveLength(1));
    expect(notifs(lines, "thread/settings/changed")[0].params).toMatchObject({ source: "engine", permissionMode: "acceptEdits" });
    expect(record.settings.permissionMode).toBe("acceptEdits");
  });

  it("thread/thinking/set forwards set_thinking with the resolved budget", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "thread/thinking/set", { threadId: record.id, maxTokens: 4096 })).result).toEqual({ ok: true });
    expect(calls(fh, "set_thinking").map((a) => (a[0] as { maxTokens?: number }).maxTokens)).toEqual([4096]);
    await waitFor(() => expect(notifs(lines, "thread/settings/changed")).toHaveLength(1));
    expect(notifs(lines, "thread/settings/changed")[0].params).toMatchObject({ source: "engine", thinkingTokens: 4096 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the mcp trio and the task trio forward unchanged (the member signatures already match)", () => {
  it("mcpServer/status/list reads the host's server list", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.mcp_status = { ok: true, servers: [{ name: "fs", status: "connected" }] };
    const rep = await call(conn, lines, 10, "mcpServer/status/list", { threadId: record.id });
    expect(rep.result).toEqual({ data: [{ name: "fs", status: "connected" }], nextCursor: null });
  });

  it("mcpServer/reconnect forwards mcp_reconnect and pings the capabilities mirror", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "mcpServer/reconnect", { threadId: record.id, name: "fs" })).result).toEqual({ ok: true });
    expect(calls(fh, "mcp_reconnect").map((a) => (a[0] as { name?: string }).name)).toEqual(["fs"]);
    await waitFor(() => expect(notifs(lines, "thread/capabilities/changed")).toHaveLength(1));
  });

  it("mcpServer/toggle forwards mcp_toggle and writes NO local topology accumulator", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "mcpServer/toggle", { threadId: record.id, name: "fs", enabled: false })).result).toEqual({ ok: true });
    expect(calls(fh, "mcp_toggle").map((a) => a[0])).toEqual([{ op: "mcp_toggle", name: "fs", enabled: false, id: expect.any(Number) }]);
    // The accumulator exists for `repushThreadState`, which never runs on this origin (no local swap) —
    // a row here would be state this server keeps and can never use.
    expect(record.mcpToggles).toEqual({});
    await waitFor(() => expect(notifs(lines, "thread/capabilities/changed")).toHaveLength(1));
  });

  it("task/list reads the host's live task set", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.emitTasksChanged([{ task_id: "t1", task_type: "bash", description: "sleep" }]);
    const rep = await call(conn, lines, 10, "task/list", { threadId: record.id });
    expect(rep.result).toEqual({ data: [{ task_id: "t1", task_type: "bash", description: "sleep" }], nextCursor: null });
    expect(calls(fh, "tasks")).toEqual([[]]);
  });

  it("task/stop forwards stop_task with the task id", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "task/stop", { threadId: record.id, taskId: "t1" })).result).toEqual({ ok: true });
    expect(calls(fh, "stop_task")).toEqual([["t1"]]);
  });

  it("turn/background forwards background and relays the host's boolean receipt", async () => {
    const { fh, conn, lines, record } = await attached();
    expect((await call(conn, lines, 10, "turn/background", { threadId: record.id })).result).toEqual({ backgrounded: true });
    expect(calls(fh, "background")).toEqual([[]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("thread/compact/start on a fleet thread — the recorded §1d deviation", () => {
  it("forwards the bare compact op: no busy claim, no turn events, the op receipt as the reply", async () => {
    const { fh, conn, lines, record } = await attached();
    fh.replies.compact = { ok: true, outcome: { ok: true, preTokens: 900 } };

    const rep = await call(conn, lines, 10, "thread/compact/start", { threadId: record.id });

    expect(calls(fh, "compact")).toEqual([[{ op: "compact", id: expect.any(Number) }]]);
    expect(rep.result).toEqual({ ok: true, outcome: { ok: true, preTokens: 900 } });
    // NOT a turn: no local mint, no busy, and nothing on the wire that says otherwise. The status check is
    // what catches a TRANSIENT claim — `beginTurn` announces `thread/status/changed {state:"active"}` in
    // the same step it sets busy, so a claim taken and released inside the compact still shows up here.
    expect(record.busy).toBe(false);
    expect(notifs(lines, "turn/started")).toEqual([]);
    expect(notifs(lines, "turn/completed")).toEqual([]);
    expect(notifs(lines, "thread/status/changed").filter((n) => n.params.status.state === "active")).toEqual([]);
    // The outcome still reaches subscribers — a compaction nobody hears about is the one thing the
    // deviation must not cost. No `turnId`: there is no turn to name.
    expect(notifs(lines, "thread/compacted")).toHaveLength(1);
    expect(notifs(lines, "thread/compacted")[0].params).toEqual({ threadId: record.id, outcome: { ok: true, preTokens: 900 } });
  });

  it("a FOREIGN turn across a compact keeps its whole normal lifecycle — one started, one completed", async () => {
    // The two-owners fight, structurally: another client of this host prompts while this server's compact
    // is in flight. With the turn machinery, the compact would either be refused (-33001, busy) or hold a
    // locally-minted turn id beside the derived one the host's events carry. With the deviation, the event
    // layer is the only lifecycle owner and the compact is invisible to it.
    const { fh, conn, lines, record } = await attached();
    fh.beginTurn(4);                                       // the foreign turn starts first
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));

    const rep = await call(conn, lines, 10, "thread/compact/start", { threadId: record.id });
    expect(rep.result).toMatchObject({ ok: true });        // NOT refused for busy — the host owns that call
    expect(record.busy).toBe(true);                        // still the FOREIGN turn's claim, untouched
    expect(record.currentTurnId).toBe("t4@e0");

    fh.endTurn(4, { result: "done" });
    await waitFor(() => expect(notifs(lines, "turn/completed")).toHaveLength(1));
    expect(notifs(lines, "turn/started")).toHaveLength(1);
    expect(notifs(lines, "turn/started")[0].params.turn).toEqual({ id: "t4@e0", status: "inProgress" });
    expect(notifs(lines, "turn/completed")[0].params.turn).toEqual({ id: "t4@e0", status: "completed" });
    expect(record.busy).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the wire-gap trio stays origin-refused (§1c) — this task unlocks nothing", () => {
  it.each([
    ["thread/settings/apply", { settings: { outputStyle: "Explanatory" } }],
    ["mcpServer/set", { servers: {} }],
    ["mcpServer/permissionModeOverride/set", { name: "fs", mode: null }],
  ])("%s answers -33006", async (method, extra) => {
    const { fh, conn, lines, record } = await attached();
    const rep = await call(conn, lines, 10, method, { threadId: record.id, ...(extra as Record<string, unknown>) });
    expect(rep.error.code).toBe(ERR.UNSUPPORTED_FOR_ORIGIN);
    expect(fh.ops).toEqual([]); // refused before any handler, so nothing reached the host
  });
});

// test/unit/appserver/absorb.test.ts — M5 Task 13: the two 0.3.234 absorb survivors, wired through the
// seams probes 111/112 actually measured (spec D-M5-22).
//
// THE RULE THIS FILE IS WRITTEN TO (plan review F13): every case injects the field through the SAME FRAME
// PATH the probe observed. A case that hands a handler a pre-stamped `record.terminalSlashCommands`, or a
// pre-built ItemEvent carrying `contextUsage`, proves nothing — it would pass against an implementation
// that never reads a frame at all. So the inProcess cases drive `session.onFrame` / the per-turn
// `onMessage` sink (`session.ts`'s readLoop hands the router the first and the item mapper the second),
// and the fleet cases drive a REAL fake host over a REAL socket, whose `{kind:"message"}` events reach the
// same two consumers through `fleetEngine.ts`.
//
// BOTH ORIGINS, EVERY MECHANISM. The trap this milestone was warned about is inProcess-passes/fleet-fails:
// `routeInit` early-returns on `record.sessionId`, and a FLEET thread latches that id from the host's
// `state` event rather than from an init frame — so anything folded into `routeInit`'s body is already
// guarded off before the first fleet init frame arrives and silently never runs, while every in-process
// test still passes. Two fields × two origins is four sides, and each has its own case below.
//
// Task 12's own technique was to measure both legs from one turn on one real `Session` (subscribing
// `onFrame` and the submit sink together). The fleet cases here go one step further and use the fake host
// harness this repo already ships (`test/helpers/fakeHost.ts`), because it exercises the real socket, the
// real `FleetEngine` frame fan and the real replay marking rather than a stand-in for them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls, FakeHostOpts } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { capabilitiesReadResult } from "../../../src/appserver/schema/introspect.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** Probe 112's payload, verbatim off the live init frame (CLI 2.1.234). */
const TERMINAL = ["doctor", "color"];
/** Probe 111's payload, trimmed to the keys the wire assertion reads — the field is relayed VERBATIM, so
 *  the test's job is to prove the object arrived unchanged, not to re-describe `SDKContextUsage`. */
const CONTEXT_USAGE = { model: "claude-opus-5", total_tokens: 31179, raw_max_tokens: 800000, percentage: 4, categories: [{ kind: "used", tokens: 31179 }] };

/** The init frame as the engine emits it — `terminal_slash_commands` beside the full command list, on a
 *  `system/init` frame that ALSO carries a session_id (which is what makes the routeInit trap reachable:
 *  the id is latched by a different route on the same frame). */
const initFrame = (terminal: unknown = TERMINAL, sessionId = "sess-init") => ({
  type: "system", subtype: "init", session_id: sessionId,
  slash_commands: ["/compact", "/context"], terminal_slash_commands: terminal,
});

/** The `/context` turn's assistant frame: the twin is a WRAPPER-LEVEL sibling (probe 111 measured
 *  `message.context_usage` ABSENT), and the markdown table stays on `message.content`. */
const contextFrame = (usage: unknown = CONTEXT_USAGE) => ({
  type: "assistant", message: { id: "msg_ctx", content: [{ type: "text", text: "## Context Usage" }] }, context_usage: usage,
});

// ── inProcess rig ────────────────────────────────────────────────────────────────────────────────────
/** An engine-faithful fake: `onFrame` is a real fan (the router's feed) and `submit`'s second argument is
 *  the per-turn sink (the item mapper's feed). `readLoop` fans a frame to `frameCbs` BEFORE the turn sink,
 *  and `pushTurnFrame` reproduces that order rather than choosing one. */
function fakeSession(overrides: Record<string, unknown> = {}) {
  const cbs = new Set<(m: unknown, replay?: true) => void>();
  let sink: ((m: unknown) => void) | undefined;
  const session = {
    submit: async (_p: string, onMessage: (m: unknown) => void = () => {}) => { sink = onMessage; await tick(); sink = undefined; return { result: {} }; },
    interrupt: async () => ({}),
    dispose: async () => {},
    onFrame: (cb: (m: unknown, replay?: true) => void) => { cbs.add(cb); return () => cbs.delete(cb); },
    sessionId: "sess-1",
    isEnded: () => false,
    ...overrides,
  };
  return {
    session,
    /** A frame outside any turn — only the router sees it (there is no open sink). */
    push: (f: unknown) => { for (const cb of [...cbs]) cb(f); },
    /** A frame DURING a turn, delivered the way `session.ts`'s readLoop delivers one: frame fan first,
     *  then the turn's own `onMessage` sink. */
    pushTurnFrame: (f: unknown) => { for (const cb of [...cbs]) cb(f); sink?.(f); },
  };
}

async function bootInProcess(session: Record<string, unknown>) {
  const srv = new AppServer({}, { sessionFactory: () => session as never });
  const s = mkSink(); const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" } } });
  send(conn, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = frame(s.lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await tick();
  s.lines.length = 0;
  return { srv, conn, lines: s.lines, threadId, record: srv.registry.get(threadId)! };
}

// ── fleet rig (copied from fleet-bridge.test.ts so this file reads standalone) ────────────────────────
const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-absorb-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

async function attached(opts: FakeHostOpts = {}) {
  const fh = await startFakeHost(opts);
  hosts.push(fh);
  const row: RosterRow = fh.row;
  writeRoster(row);
  const srv = new AppServer({}, {} as never);
  servers.push(srv);
  const s = mkSink(); const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
  await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
  const threadId = frame(s.lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
  s.lines.length = 0;
  return { fh, srv, conn, lines: s.lines, threadId, record: srv.registry.get(threadId)! };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("terminal_slash_commands: latched off the init frame, served by thread/capabilities/read", () => {
  it("inProcess — a system/init frame arriving on the ROUTER'S OWN FEED stamps the record, and the read serves it beside the engine's catalogs", async () => {
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { conn, lines, record } = await bootInProcess(rig.session);
    expect(record.terminalSlashCommands).toBeUndefined();

    rig.push(initFrame());
    expect(record.terminalSlashCommands).toEqual(TERMINAL);

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await tick();
    expect(frame(lines, 4).result).toEqual({ capabilities: { models: [], commands: [], mcpServers: [], agents: [] }, terminalSlashCommands: TERMINAL });
  });

  it("inProcess — the ABSENT-KEY contract: with NO init frame on this thread the reply omits the key entirely (not null, not [])", async () => {
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { conn, lines, record } = await bootInProcess(rig.session);
    // Frames that are not an init frame AT ALL. Absence means one thing only — this server has not heard
    // from the engine yet. An init frame that merely omits the field is a DIFFERENT state (the engine
    // answering "none"), and the two rows below own it.
    rig.push({ type: "assistant", message: { id: "m", content: [] } });
    rig.push({ type: "result", subtype: "success", usage: { input_tokens: 1 } });

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await tick();
    const result = frame(lines, 4).result;
    expect(Object.hasOwn(result, "terminalSlashCommands")).toBe(false);
    expect(result).toEqual({ capabilities: { models: [], commands: [], mcpServers: [], agents: [] } });
  });

  it("inProcess — an init frame that OMITS the field is the engine answering 'none', and the read serves [] for it", async () => {
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { conn, lines, record } = await bootInProcess(rig.session);
    // `sdk.d.ts` declares `terminal_slash_commands` "present only when non-empty; absent on CLIs that
    // predate the field, and on sessions where no advertised command carries the tag" — so THIS frame, not
    // an explicit `[]`, is how a real engine says nothing is terminal-bound. Both senders mean the same
    // thing to a client deciding what to hide, so both land on `[]`.
    rig.push({ type: "system", subtype: "init", session_id: "sess-1", slash_commands: ["/compact", "/context"] });
    expect(record.terminalSlashCommands).toEqual([]);

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await tick();
    const result = frame(lines, 4).result;
    expect(Object.hasOwn(result, "terminalSlashCommands")).toBe(true);
    expect(result.terminalSlashCommands).toEqual([]);
  });

  it("inProcess — a keyed init followed by a KEY-LESS one serves [], never the stale list: EVERY init frame is authoritative", async () => {
    // The staleness this pins is not hypothetical: init recurs per turn, and `thread/capabilities/changed`
    // exists to tell clients to re-read. A latch that only wrote on a present key would hand that re-read
    // fresh `capabilities.commands` beside a list the session stopped advertising, with no wire value able
    // to say "no longer any".
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { conn, lines, record } = await bootInProcess(rig.session);
    rig.push(initFrame());
    expect(record.terminalSlashCommands).toEqual(TERMINAL);

    rig.push({ type: "system", subtype: "init", session_id: "sess-1", slash_commands: ["/compact", "/context"] });
    expect(record.terminalSlashCommands).toEqual([]);

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await tick();
    expect(frame(lines, 4).result.terminalSlashCommands).toEqual([]);
  });

  it("inProcess — the routeInit TRAP, in-process half: a record whose sessionId is ALREADY latched still stamps from a later init frame", async () => {
    // `routeInit` early-returns on `record.sessionId`. This case makes that guard true BEFORE the init
    // frame arrives, which is the state every fleet thread is in, and demands the field latch anyway.
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { record } = await bootInProcess(rig.session);
    record.sessionId = "already-latched";

    rig.push(initFrame());
    expect(record.terminalSlashCommands).toEqual(TERMINAL);
  });

  it("inProcess — init is RE-EMITTED per turn, so the latest frame wins", async () => {
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { record } = await bootInProcess(rig.session);
    rig.push(initFrame(["doctor", "color"]));
    rig.push(initFrame(["doctor"]));
    expect(record.terminalSlashCommands).toEqual(["doctor"]);
  });

  it("inProcess — an EXPLICIT empty list is accepted as 'none' too, not treated as malformed and ignored", async () => {
    // Belt to the row above: the SDK says it omits the key rather than sending `[]`, so this is the shape
    // a future CLI (or a host relaying one) might send instead. It must mean the same thing, and it must
    // not fall through the malformed branch and leave a previous answer standing.
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { conn, lines, record } = await bootInProcess(rig.session);
    rig.push(initFrame(TERMINAL));
    rig.push(initFrame([]));

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await tick();
    expect(frame(lines, 4).result.terminalSlashCommands).toEqual([]);
  });

  it("inProcess — a MALFORMED field (present, but not an array of strings) is ignored rather than published, and is not read as 'none'", async () => {
    // The one case an init frame does NOT settle. A value this server cannot parse is a frame it does not
    // understand, not a frame saying "nothing is terminal-bound" — so the previous (here: absent) answer
    // stands, rather than being overwritten with `[]`.
    const rig = fakeSession({ capabilities: async () => ({ models: [], commands: [], mcpServers: [], agents: [] }) });
    const { record } = await bootInProcess(rig.session);
    rig.push(initFrame("doctor"));
    expect(record.terminalSlashCommands).toBeUndefined();
    rig.push(initFrame(["doctor", 7]));
    expect(record.terminalSlashCommands).toBeUndefined();
    // …and a well-formed frame after the bad ones still lands.
    rig.push(initFrame());
    expect(record.terminalSlashCommands).toEqual(TERMINAL);
  });

  it("FLEET — the trap's other half, over a real host socket: the record's sessionId comes from the host's `state` event, and a later init MESSAGE still stamps the field", async () => {
    const { fh, conn, lines, record } = await attached({ status: { sessionId: "host-sess" } });
    // The attach's own follow burst already latched the id from `state` — the exact precondition that
    // makes a routeInit-nested implementation dead here.
    expect(record.sessionId).toBe("host-sess");
    expect(record.terminalSlashCommands).toBeUndefined();

    fh.emitMessage(initFrame(TERMINAL, "host-sess"));
    await waitFor(() => expect(record.terminalSlashCommands).toEqual(TERMINAL));

    send(conn, { id: 4, method: "thread/capabilities/read", params: { threadId: record.id } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());
    expect(frame(lines, 4).result.terminalSlashCommands).toEqual(TERMINAL);
  });

  it("FLEET — a REPLAYED init frame in the follow burst is ignored (the router's existing rule), and the next live init still lands", async () => {
    // Why this matters and is not a nit: a fleet thread's attach burst is replay-marked and dropped, so a
    // once-per-process init would have made this field inProcess-only. It recurs per turn, which is what
    // makes the live frame below reachable at all.
    const fh = await startFakeHost();
    hosts.push(fh);
    fh.emitMessage(initFrame()); // buffered BEFORE anyone attaches → replayed on follow
    writeRoster(fh.row);
    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const s = mkSink(); const conn = srv.connect(s.sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" } } });
    send(conn, { id: 2, method: "thread/attach", params: { target: fh.row.short } });
    await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
    const record = srv.registry.get(frame(s.lines, 2).result.thread.id as string)!;
    await tick();
    expect(record.terminalSlashCommands).toBeUndefined(); // the replayed copy is history, not news

    fh.emitMessage(initFrame());
    await waitFor(() => expect(record.terminalSlashCommands).toEqual(TERMINAL));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("context_usage: forwarded on the item events its own assistant frame produces (no retention)", () => {
  it("inProcess — the twin rides the turn's item notifications, read from the WRAPPER key the probe measured", async () => {
    const rig = fakeSession();
    const { conn, lines, threadId } = await bootInProcess(rig.session);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "/context" } });
    await tick();
    rig.pushTurnFrame(contextFrame());
    await tick();
    await tick();

    const completed = notifs(lines, "item/completed").filter((f) => f.params.item.type === "agentMessage");
    expect(completed).toHaveLength(1);
    expect(completed[0].params.contextUsage).toEqual(CONTEXT_USAGE);
    const started = notifs(lines, "item/started").filter((f) => f.params.item.type === "agentMessage");
    expect(started[0].params.contextUsage).toEqual(CONTEXT_USAGE);
  });

  it("inProcess — an ordinary assistant frame carries NO contextUsage key, and a twin nested inside `message` is not read", async () => {
    const rig = fakeSession();
    const { conn, lines, threadId } = await bootInProcess(rig.session);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "hi" } });
    await tick();
    rig.pushTurnFrame({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "hello" }] } });
    // The wrong place: probe 111 measured `message.context_usage` ABSENT, so a reader that looked there
    // would be reading a key the engine never sets — and would still pass a test that only asserts the
    // happy path. This frame makes that reader fail.
    rig.pushTurnFrame({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "x" }], context_usage: CONTEXT_USAGE } });
    await tick();
    await tick();

    for (const f of notifs(lines, "item/completed")) expect(Object.hasOwn(f.params, "contextUsage")).toBe(false);
    for (const f of notifs(lines, "item/started")) expect(Object.hasOwn(f.params, "contextUsage")).toBe(false);
  });

  it("inProcess — a RESULT frame carrying the twin forwards nothing: the probe measured the carrier as `assistant`, and a result frame never reaches a fleet follower at all", async () => {
    const rig = fakeSession();
    const { conn, lines, threadId } = await bootInProcess(rig.session);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "/context" } });
    await tick();
    rig.pushTurnFrame({ type: "result", subtype: "success", context_usage: CONTEXT_USAGE, usage: { input_tokens: 1 } });
    await tick();
    await tick();

    for (const f of parsed(lines).filter((x) => typeof x.method === "string")) expect(Object.hasOwn(f.params ?? {}, "contextUsage")).toBe(false);
  });

  it("inProcess — thread/contextUsage/read is UNTOUCHED: it still answers from getContextUsage(), whatever a turn's twin said", async () => {
    const control = { gridRows: [["used", "1"]], systemTools: [], systemPromptSections: [], slashCommands: [] };
    const rig = fakeSession({ getContextUsage: async () => control });
    const { conn, lines, threadId } = await bootInProcess(rig.session);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "/context" } });
    await tick();
    rig.pushTurnFrame(contextFrame());
    await tick();
    await tick();

    send(conn, { id: 5, method: "thread/contextUsage/read", params: { threadId } });
    await tick();
    expect(frame(lines, 5).result).toEqual({ contextUsage: control });
  });

  it("FLEET — the same twin, over a real host socket: the host's `{kind:'message'}` relay reaches the item layer and the notification carries it", async () => {
    const { fh, lines } = await attached();
    fh.beginTurn(1);
    await waitFor(() => expect(notifs(lines, "turn/started")).toHaveLength(1));
    fh.emitMessage(contextFrame());

    await waitFor(() => expect(notifs(lines, "item/completed").filter((f) => f.params.item.type === "agentMessage")).toHaveLength(1));
    const completed = notifs(lines, "item/completed").filter((f) => f.params.item.type === "agentMessage")[0];
    expect(completed.params.contextUsage).toEqual(CONTEXT_USAGE);
  });

  it("FLEET — the snapshot on the way into the per-turn buffer must PRESERVE the twin, or a fleet client's replay is starved of it", async () => {
    // The same shape as the case above, asserted from the buffer rather than the wire — the two are fed by
    // the SAME snapshot call in fleet.ts, and only the buffer can show the field survived it. `snapshot()`
    // runs on BOTH origins (`pushBounded`), so this row is not the only defender of the carry-through; what
    // it adds is the fleet WIRE's side, since fleet.ts snapshots before emitting and the in-process wire
    // never does. Reverting the carry-through reddens three rows, spanning both origins.
    const { fh, record } = await attached();
    fh.beginTurn(1);
    await waitFor(() => expect(record.currentTurnId).toBeTruthy());
    fh.emitMessage(contextFrame());
    await waitFor(() => expect(record.buffer.some((b) => b.event.kind === "completed")).toBe(true));
    const buffered = record.buffer.find((b) => b.event.kind === "completed")!;
    expect((buffered.event as { contextUsage?: unknown }).contextUsage).toEqual(CONTEXT_USAGE);
  });

  it("inProcess — a client joining mid-turn is replayed the twin with the item it belongs to (one delivery window)", async () => {
    // Titled for the rig it runs (review F5). The fleet half of replay is covered by the buffer row above:
    // `subscribe.ts` replays from `record.buffer` through the same `itemEventNotification` this rig drives,
    // and that row asserts the fleet origin's buffered event still carries the twin.
    const rig = fakeSession();
    const { srv, conn, lines, threadId } = await bootInProcess(rig.session);
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "/context" } });
    await tick();
    rig.pushTurnFrame(contextFrame());
    await tick();
    void lines;

    const b = mkSink(); const connB = srv.connect(b.sink);
    send(connB, { id: 1, method: "initialize", params: { clientInfo: { name: "B" } } });
    send(connB, { id: 2, method: "thread/subscribe", params: { threadId } });
    await tick();
    const replayed = notifs(b.lines, "item/completed").filter((f) => f.params.item.type === "agentMessage");
    expect(replayed).toHaveLength(1);
    expect(replayed[0].params.contextUsage).toEqual(CONTEXT_USAGE);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("the published contract for the new capabilities field", () => {
  it("thread/capabilities/read's result schema accepts the field's absence and its presence, and refuses a non-string list", () => {
    const capabilities = { models: [], commands: [], mcpServers: [], agents: [] };
    expect(capabilitiesReadResult.safeParse({ capabilities }).success).toBe(true);
    expect(capabilitiesReadResult.safeParse({ capabilities, terminalSlashCommands: TERMINAL }).success).toBe(true);
    expect(capabilitiesReadResult.safeParse({ capabilities, terminalSlashCommands: [] }).success).toBe(true);
    expect(capabilitiesReadResult.safeParse({ capabilities, terminalSlashCommands: "doctor" }).success).toBe(false);
    expect(capabilitiesReadResult.safeParse({ capabilities, terminalSlashCommands: [7] }).success).toBe(false);
  });
});

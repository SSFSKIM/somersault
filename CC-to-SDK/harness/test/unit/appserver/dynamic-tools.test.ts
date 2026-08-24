// test/unit/appserver/dynamic-tools.test.ts — M7 Task 4: the call machinery. A dynamic tool call parks in
// the server, travels to the thread's SUBSCRIBERS as `tool/callRequested`, and is settled by whichever of
// them answers `tool/callResult` first. This file drives all three halves against a real booted wire:
//
//   THE PARK SEAM (`srv.parkToolCall`) is called directly, as Task 6's MCP handler will call it — there is
//   no engine here that can raise a tool call, and faking one would fake the very seam under test.
//
//   THE HANDLER is invoked directly with a REAL ConnCtx taken off the booted server (`ctxOf`), because
//   `tool/callResult` is deliberately NOT in the dispatch table yet: registering it before declarations
//   exist would publish a method no client can ever legitimately reach. Task 8 registers it and re-proves
//   these same behaviors through one wire-driven smoke. Everything the handler consults — peer identity,
//   subscription, the thread record — is genuine wire state, so only the dispatch entry is missing.
//
//   EVERY ROW HOLDS A TURN OPEN, because a dynamic call only exists inside one: the boot helper starts a
//   turn whose `submit` never resolves, which is what makes `activeTurnId` answer.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer, threadView, type ConnCtx } from "../../../src/appserver/server.js";
import { swapEngine } from "../../../src/appserver/rewind.js";
import { emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { MAX_IN } from "../../../src/appserver/peer.js";
import { toolCallResult } from "../../../src/appserver/toolCallResult.js";
import { toolCallResultParams, toolCallResultResult } from "../../../src/appserver/schema/dynamicTools.js";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import type { CallToolResultLike } from "../../../src/appserver/dynamicCalls.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const CALL_ID = /^dyncall:[0-9a-f-]{36}$/;

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const notes = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const replyTo = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const noteOf = (result: CallToolResultLike): string => String(result.content[0]?.text ?? "");

/** Has this promise settled yet? Two macrotask turns, so anything scheduled in microtask-land has run.
 *  Every "resolves cancelled IMMEDIATELY" row asserts this FIRST — otherwise a park that never settles
 *  reads as a 120-second vitest timeout instead of a one-line assertion failure. */
async function settledYet(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => { done = true; });
  await tick(); await tick();
  return done;
}

/** The engine, as far as a parked tool call is concerned: a turn that never ends. `submit` returns a
 *  promise nothing resolves, so the record stays busy and `activeTurnId` keeps answering for the whole
 *  row — exactly the state a real engine is in while it waits on a tool result. */
const fakeSession = () => ({
  submit: () => new Promise<{ result: unknown }>(() => {}),
  interrupt: async () => ({}),
  dispose: async () => {},
  onFrame: () => () => {},
  sessionId: "sess-1",
});

/** One throwaway server-state root for this whole file. `thread/list` and the archive markers resolve
 *  their directory as `deps.ccxDir ?? fleetRoot()`, and a boot that omits it leans on the process-global
 *  CCX_FLEET_ROOT that any stray vitest invocation drops — pointing the read at the operator's real
 *  ~/.claude/ccx (commit fd4323ab59). */
const fileCcxDir = mkdtempSync(join(tmpdir(), "m7ccx-dyntools-"));
afterAll(() => { rmSync(fileCcxDir, { recursive: true, force: true }); });

/** A promise plus its resolver — every gated fake below is built from one. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** The statuses a peer has been told about, in order, and the last of them. Task 5's whole subject is a
 *  thread whose status says WHAT it is waiting for, so the rows read the sequence rather than one frame. */
const statuses = (lines: string[]): Array<Record<string, unknown>> => notes(lines, "thread/status/changed").map((n) => n.params.status);
const lastStatus = (lines: string[]): Record<string, unknown> | undefined => { const all = statuses(lines); return all[all.length - 1]; };

/** The park barrier set, read directly. It has no wire projection by design (it gates a park, it does not
 *  announce one), and the one failure a liveness bug produces is a residue only `closeRecord` sweeps. */
const barriers = (srv: AppServer): Set<string> => (srv as unknown as { parkBarriers: Set<string> }).parkBarriers;

/** A FLEET record as `thread/attach` admits one (fleet.ts), minus the socket: enough for the one question
 *  this origin raises here, which is what the thread-scoped tool-call reads answer for a thread that can
 *  never park into them. */
const fleetRecord = (srv: AppServer): ThreadRecord => ({
  id: srv.registry.mint(), origin: "fleet", session: fakeSession() as any, unattended: "park",
  busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
  subscribers: new Set(), chain: Promise.resolve(),
  sessionId: "sess-fleet", createdAt: 1, updatedAt: 1,
  cwd: "/work/here", short: "deadbeef", name: "worker-1",
  settings: {}, flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
});

/** The REAL per-connection context the dispatcher would hand a registered handler — peer identity
 *  included, which is the whole of the authority check. */
const ctxOf = (srv: AppServer, name: string): ConnCtx =>
  [...(srv as unknown as { conns: Map<number, ConnCtx> }).conns.values()].find((c) => c.clientName === name)!;

/** Adds a connection and initializes it. `watch` opts into thread-EXISTENCE fan-out, which is precisely
 *  NOT subscription — the distinction two authority rows below turn on. */
function attach(srv: AppServer, name: string, opts: { watch?: boolean } = {}) {
  const { lines, sink } = mkSink();
  const conn = srv.connect(sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name }, ...(opts.watch ? { watchThreads: true } : {}) } });
  return { lines, conn, ctx: () => ctxOf(srv, name) };
}

/** Boots a server, one thread, one connection ("A") and one turn in flight. `subscribe:false` leaves A
 *  initialized but unsubscribed — the zero-subscriber park rows need that. Sinks are cleared at the end,
 *  so a row's own assertions start on an empty transcript. */
async function bootTurn(opts: { subscribe?: boolean; session?: () => any } = {}) {
  const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: opts.session ?? (() => fakeSession()) });
  const a = attach(srv, "A");
  send(a.conn, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = replyTo(a.lines, 2).result.thread.id as string;
  if (opts.subscribe !== false) send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  send(a.conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
  await tick();
  const record = srv.registry.get(threadId)!;
  const turnId = record.currentTurnId!;
  a.lines.length = 0;
  return { srv, a, threadId, turnId, record };
}

describe("M7 tool/callRequested — the park, the notification, the replay", () => {
  it("a parked call reaches this thread's subscribers with the full request shape, and nobody else", async () => {
    const { srv, a, threadId, turnId } = await bootTurn();
    const watcher = attach(srv, "W", { watch: true });   // thread-existence fan-out, never subscribed
    const stranger = attach(srv, "S");                   // initialized and nothing more
    await tick();
    watcher.lines.length = 0; stranger.lines.length = 0;

    const parked = srv.parkToolCall(threadId, 0, { namespace: "ops", tool: "lookup", arguments: { q: "x" } });
    const bare = srv.parkToolCall(threadId, 0, { tool: "ping", arguments: {} });
    await tick();

    const requests = notes(a.lines, "tool/callRequested");
    expect(requests).toHaveLength(2);
    expect(requests[0].params.callId).toMatch(CALL_ID);
    expect(requests[0].params).toEqual({ threadId, callId: requests[0].params.callId, turnId, namespace: "ops", tool: "lookup", arguments: { q: "x" } });
    // A bare (namespace-less) declaration publishes under `dyn` at the MCP layer, but the WIRE request
    // names no namespace at all — the key is absent, not null.
    expect(Object.keys(requests[1].params).sort()).toEqual(["arguments", "callId", "threadId", "tool", "turnId"]);
    expect(requests[1].params.tool).toBe("ping");
    expect(requests[0].params.callId).not.toBe(requests[1].params.callId);

    // Subscribers only: a watcher opted into thread EXISTENCE, not into a thread's per-turn traffic.
    expect(notes(watcher.lines, "tool/callRequested")).toEqual([]);
    expect(notes(stranger.lines, "tool/callRequested")).toEqual([]);

    expect(srv.pendingToolCalls(threadId).map((c) => c.tool)).toEqual(["lookup", "ping"]);
    expect(await settledYet(parked)).toBe(false);
    expect(await settledYet(bare)).toBe(false);
  });

  it("only a SUBSCRIBER may settle: a watcher and an unsubscribed peer are refused even holding the real callId", async () => {
    const { srv, a, threadId } = await bootTurn();
    const watcher = attach(srv, "W", { watch: true });
    const stranger = attach(srv, "S");
    await tick();

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;
    watcher.lines.length = 0; stranger.lines.length = 0;

    for (const peer of [watcher, stranger]) {
      toolCallResult(srv, peer.ctx(), 10, { threadId, callId, contentItems: [{ type: "inputText", text: "stolen" }], success: true });
    }
    await tick();
    for (const peer of [watcher, stranger]) {
      expect(replyTo(peer.lines, 10).error.code).toBe(ERR.INVALID_PARAMS);
      expect(replyTo(peer.lines, 10).error.message).toBe("only a subscriber of this thread can settle its tool calls");
    }
    // Refused BEFORE the registry: the call is still parked and still answerable.
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);
    expect(await settledYet(parked)).toBe(false);

    toolCallResult(srv, ctxOf(srv, "A"), 11, { threadId, callId, contentItems: [{ type: "inputText", text: "ok" }], success: true });
    await tick();
    expect(replyTo(a.lines, 11).result).toEqual({});
    expect(await parked).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
  });

  it("a park with zero subscribers waits, replays in full on subscribe, and survives a disconnect", async () => {
    const { srv, a, threadId, turnId } = await bootTurn({ subscribe: false });

    const parked = srv.parkToolCall(threadId, 0, { namespace: "ops", tool: "lookup", arguments: { q: "x" } });
    await tick();
    expect(notes(a.lines, "tool/callRequested")).toEqual([]);
    expect(await settledYet(parked)).toBe(false);

    send(a.conn, { id: 20, method: "thread/subscribe", params: { threadId } });
    await tick();
    const replayed = notes(a.lines, "tool/callRequested");
    expect(replayed).toHaveLength(1);
    const callId = replayed[0].params.callId as string;
    // Replay and live are the same projection — the whole request, not a summary.
    expect(replayed[0].params).toEqual({ threadId, callId, turnId, namespace: "ops", tool: "lookup", arguments: { q: "x" } });

    a.conn.close(); // the browser tab closes: the peer leaves every subscriber set
    const late = attach(srv, "D");
    send(late.conn, { id: 21, method: "thread/subscribe", params: { threadId } });
    await tick();
    expect(notes(late.lines, "tool/callRequested")[0].params.callId).toBe(callId);

    toolCallResult(srv, late.ctx(), 22, { threadId, callId, contentItems: [{ type: "inputText", text: "late but valid" }], success: true });
    await tick();
    expect(replyTo(late.lines, 22).result).toEqual({});
    expect(await parked).toEqual({ content: [{ type: "text", text: "late but valid" }], isError: false });
  });

  it("first answer wins; the loser hears -33002 and a fabricated callId hears -32602", async () => {
    const { srv, a, threadId } = await bootTurn();
    const b = attach(srv, "B");
    send(b.conn, { id: 30, method: "thread/subscribe", params: { threadId } });
    await tick();

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    toolCallResult(srv, ctxOf(srv, "A"), 31, { threadId, callId, contentItems: [{ type: "inputText", text: "first" }], success: true });
    toolCallResult(srv, b.ctx(), 32, { threadId, callId, contentItems: [{ type: "inputText", text: "second" }], success: true });
    toolCallResult(srv, b.ctx(), 33, { threadId, callId: "dyncall:00000000-0000-4000-8000-000000000000", contentItems: [], success: true });
    await tick();

    expect(replyTo(a.lines, 31).result).toEqual({});
    expect(replyTo(b.lines, 32).error.code).toBe(ERR.ALREADY_SETTLED);
    // Different facts, deliberately: one client lost a race, the other is addressing a call that never was.
    expect(replyTo(b.lines, 33).error.code).toBe(ERR.INVALID_PARAMS);
    expect(replyTo(b.lines, 33).error.message).toBe("no such pending tool call");
    expect(await parked).toEqual({ content: [{ type: "text", text: "first" }], isError: false });
  });

  it("an over-cap result SETTLES isError and still acks {} — at 17 items and at 65", async () => {
    for (const count of [17, 65]) {
      const { srv, a, threadId } = await bootTurn();
      const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
      await tick();
      const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

      const contentItems = Array.from({ length: count }, (_, i) => ({ type: "inputText", text: `i${i}` }));
      toolCallResult(srv, ctxOf(srv, "A"), 40, { threadId, callId, contentItems, success: true });
      await tick();

      // The METHOD succeeded — the client's answer was delivered. The MODEL is the one told about the cap.
      expect(replyTo(a.lines, 40).result).toEqual({});
      const result = await parked;
      expect(result.isError).toBe(true);
      expect(noteOf(result)).toBe(`tool result has ${count} content items (max 16)`);
      // 65 is well past any count bound a schema could have carried: the wire schema deliberately has none,
      // because a -32602 here would leave the call parked with the client believing it had answered.
      expect(toolCallResultParams.safeParse({ threadId, callId, contentItems, success: true }).success).toBe(true);
    }
  });

  it("a malformed media URL passes the schema and settles isError — it is never a -32602", async () => {
    const { srv, a, threadId } = await bootTurn();
    const parked = srv.parkToolCall(threadId, 0, { tool: "shot", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    const contentItems = [{ type: "inputImage", imageUrl: "https://example.test/cat.png" }];
    expect(toolCallResultParams.safeParse({ threadId, callId, contentItems, success: true }).success).toBe(true);
    toolCallResult(srv, ctxOf(srv, "A"), 45, { threadId, callId, contentItems, success: true });
    await tick();

    expect(replyTo(a.lines, 45).result).toEqual({});
    const result = await parked;
    expect(result.isError).toBe(true);
    expect(noteOf(result)).toBe("tool result content item 0: not a base64 data: URL");
  });

  it("an over-FRAME result dies -32700 with a null id and leaves the call answerable by a smaller retry", async () => {
    const { srv, a, threadId } = await bootTurn();
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;
    a.lines.length = 0;

    // The frame cap is enforced BELOW dispatch (peer.ts), so this row is honest even while the method is
    // unregistered: the request never reaches a handler either way. What it proves is the recovery the
    // schema's `.describe()` promises — the call is not lost, only that one attempt is.
    send(a.conn, { id: 50, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "x".repeat(MAX_IN) }], success: true } });
    await tick();
    const dead = parsed(a.lines).find((f) => f.error);
    expect(dead.id).toBe(null);
    expect(dead.error.code).toBe(ERR.PARSE);
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);

    toolCallResult(srv, ctxOf(srv, "A"), 51, { threadId, callId, contentItems: [{ type: "inputText", text: "small" }], success: true });
    await tick();
    expect(replyTo(a.lines, 51).result).toEqual({});
    expect(await parked).toEqual({ content: [{ type: "text", text: "small" }], isError: false });
  });

  it("success:false keeps the client's own content and marks it an error", async () => {
    const { srv, a, threadId } = await bootTurn();
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    toolCallResult(srv, ctxOf(srv, "A"), 55, { threadId, callId, contentItems: [{ type: "inputText", text: "no such row" }], success: false });
    await tick();
    expect(replyTo(a.lines, 55).result).toEqual({});
    expect(await parked).toEqual({ content: [{ type: "text", text: "no such row" }], isError: true });
  });

  it("an unknown thread is -33004, ahead of everything else the handler could say", async () => {
    const { srv, a } = await bootTurn();
    toolCallResult(srv, ctxOf(srv, "A"), 56, { threadId: "thr_nope", callId: "dyncall:00000000-0000-4000-8000-000000000000", contentItems: [], success: true });
    await tick();
    expect(replyTo(a.lines, 56).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });
});

describe("M7 parkToolCall — the three refuse-fast exits", () => {
  it("a park from a superseded engine generation cancels immediately, with nothing on the wire", async () => {
    const { srv, a, threadId, record } = await bootTurn();
    record.epoch = 1; // the swap bumped the epoch; this callback belongs to the engine it replaced

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: engine generation superseded");
    // No registry touch and no notification: the client is never told about a call it can never answer.
    expect(notes(a.lines, "tool/callRequested")).toEqual([]);
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
  });

  it("a park inside the interrupt barrier cancels immediately, and the barrier lifts on release", async () => {
    const { srv, a, threadId } = await bootTurn();
    srv.latchParkBarrier(threadId);

    const blocked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    expect(await settledYet(blocked)).toBe(true);
    expect(noteOf(await blocked)).toBe("Tool call cancelled: turn interrupted");
    expect(notes(a.lines, "tool/callRequested")).toEqual([]);
    expect(srv.pendingToolCalls(threadId)).toEqual([]);

    // The barrier is a LATCH, not a flag the next turn's arrival clears: only an explicit release reopens
    // parking, which is what keeps a straggler from the interrupted turn out of its successor.
    srv.clearParkBarrier(threadId);
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    expect(await settledYet(parked)).toBe(false);
    expect(notes(a.lines, "tool/callRequested")).toHaveLength(1);
  });

  it("a park with no turn in flight cancels immediately", async () => {
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => fakeSession() });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    a.lines.length = 0;

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: no active turn");
    expect(notes(a.lines, "tool/callRequested")).toEqual([]);
  });

  it("a pre-aborted signal cancels without parking; a live one cancels the park when it fires", async () => {
    const { srv, threadId } = await bootTurn();
    const fired = new AbortController();
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} }, fired.signal);
    await tick();
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);
    fired.abort();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: aborted");

    const already = new AbortController();
    already.abort();
    const dead = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} }, already.signal);
    expect(await settledYet(dead)).toBe(true);
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
  });
});

describe("M7 lifecycle + replay ordering", () => {
  it("thread/close settles every parked call BEFORE it awaits the engine, and a later park answers the same reason", async () => {
    // DEADLOCK-SHAPED, not merely ordered: the real `Session.dispose()` is `input.close(); await this.done`,
    // and `done` is a read loop that cannot end while a turn sits blocked inside the tool handler. This
    // fake makes that mechanical — its dispose resolves only once the park has been settled — so a close
    // that awaited the engine first would simply never reply, which is what the reply assertion catches.
    const engineGate = deferred();
    const { srv, a, threadId } = await bootTurn({ session: () => ({ ...fakeSession(), dispose: () => engineGate.promise }) });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);

    send(a.conn, { id: 60, method: "thread/close", params: { threadId } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: thread closed");
    await tick();
    expect(replyTo(a.lines, 60).result).toEqual({ ok: true });

    // The engine can outlive the record by a callback or two; that callback must be ANSWERED, not parked
    // into a registry nobody is left to read.
    const late = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    expect(await settledYet(late)).toBe(true);
    expect(noteOf(await late)).toBe("Tool call cancelled: thread closed");
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
  });

  it("subscribe replays decisions, THEN tool calls, THEN status", async () => {
    let broker: any;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    void broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_1", signal: new AbortController().signal });
    void srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();

    const late = attach(srv, "L");
    send(late.conn, { id: 70, method: "thread/subscribe", params: { threadId } });
    await tick();
    const order = parsed(late.lines).filter((f) => f.method).map((f) => f.method);
    expect(order.filter((m: string) => ["decision/requested", "tool/callRequested", "thread/status/changed"].includes(m)))
      .toEqual(["decision/requested", "tool/callRequested", "thread/status/changed"]);
  });
});

describe("M7 tool/callResult is DEFINED but not published", () => {
  it("has no registry entry and no dispatch entry — the wire still answers -32601", async () => {
    expect(methodSchemas["tool/callResult"]).toBeUndefined();
    const { a, threadId } = await bootTurn();
    send(a.conn, { id: 80, method: "tool/callResult", params: { threadId, callId: "dyncall:x", contentItems: [], success: true } });
    await tick();
    expect(replyTo(a.lines, 80).error.code).toBe(ERR.METHOD_NOT_FOUND);
  });

  it("the params schema binds identity and the three item kinds, and the result schema is a closed ack", () => {
    const base = { threadId: "t", callId: "dyncall:1", success: true };
    expect(toolCallResultParams.safeParse({ ...base, contentItems: [] }).success).toBe(true);
    expect(toolCallResultParams.safeParse({ ...base, contentItems: [{ type: "inputAudio", audioUrl: "data:audio/wav;base64,AAAA" }] }).success).toBe(true);
    expect(toolCallResultParams.safeParse({ ...base, contentItems: [{ type: "inputVideo", url: "x" }] }).success).toBe(false);
    expect(toolCallResultParams.safeParse({ ...base, threadId: "", contentItems: [] }).success).toBe(false);
    expect(toolCallResultParams.safeParse({ ...base, callId: "", contentItems: [] }).success).toBe(false);
    expect(toolCallResultParams.safeParse({ threadId: "t", callId: "dyncall:1", contentItems: [] }).success).toBe(false);
    // A generated client must be able to validate the acknowledgment, and `{}` is the whole of it.
    expect(toolCallResultResult.safeParse({}).success).toBe(true);
    expect(toolCallResultResult.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("M7 lifecycle seams — every teardown answers the model", () => {
  it("swapEngine settles the parked calls right after the epoch bump, ahead of the old engine's dispose", async () => {
    // The seam BOTH `thread/rewind` and `thread/clear` route through, driven directly: neither can be
    // reached over the wire with a call still parked (every swap-family method is busy-gated and a park
    // requires a turn in flight), so the ordering is proved where it lives. The gated dispose is what
    // makes "after the bump, before the await" a testable claim rather than a comment.
    const engineGate = deferred();
    const { srv, threadId, record } = await bootTurn({ session: () => ({ ...fakeSession(), dispose: () => engineGate.promise }) });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();

    const swapped = swapEngine(srv, record, () => fakeSession() as any, undefined);
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: engine swapped");
    await swapped;                    // resolves ONLY because the settle above released the gated dispose
    expect(record.epoch).toBe(1);
  });

  it("thread/clear inherits the swap's settle: a GHOST park is answered and the clear still replies", async () => {
    // The reachable shape of the row above. A turn can end with a call still parked — the engine abandoned
    // its tool call without aborting the signal — and THAT is the state a swap-family method actually meets.
    const submitted = deferred<any>();
    const engineGate = deferred();
    const { srv, a, threadId } = await bootTurn({ session: () => ({ ...fakeSession(), submit: () => submitted.promise, dispose: () => engineGate.promise }) });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();
    submitted.resolve({});            // the turn completes; the call stays parked
    await tick();

    send(a.conn, { id: 61, method: "thread/clear", params: { threadId } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: engine swapped");
    await tick();
    expect(replyTo(a.lines, 61).result).toMatchObject({ ok: true });
  });

  it("turn/interrupt settles the parked calls before it awaits interrupt(), and the reply still lands", async () => {
    const engineGate = deferred();
    const { srv, a, threadId } = await bootTurn({ session: () => ({ ...fakeSession(), interrupt: async () => { await engineGate.promise; return {}; } }) });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();

    send(a.conn, { id: 62, method: "turn/interrupt", params: { threadId } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: turn interrupted");
    await tick();
    expect(replyTo(a.lines, 62).result).toMatchObject({ interrupted: true });
  });

  it("a call the engine parks INSIDE interrupt() is refused, not re-parked — the barrier is latched first", async () => {
    // The late-park deadlock: settling the parks releases the engine, which promptly raises one more call
    // and blocks on it. If the barrier were latched only after the reset — or not at all — that call would
    // park into a registry the interrupt has already swept, and `interrupt()` would await it forever.
    let srvRef!: AppServer;
    let tid!: string;
    let late!: Promise<CallToolResultLike>;
    const { srv, a, threadId } = await bootTurn({
      session: () => ({ ...fakeSession(), interrupt: async () => { late = srvRef.parkToolCall(tid, 0, { tool: "straggler", arguments: {} }); await late; return {}; } }),
    });
    srvRef = srv; tid = threadId;
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();

    send(a.conn, { id: 63, method: "turn/interrupt", params: { threadId } });
    await tick();
    expect(noteOf(await parked)).toBe("Tool call cancelled: turn interrupted");
    expect(noteOf(await late)).toBe("Tool call cancelled: turn interrupted");
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
    await tick();
    expect(replyTo(a.lines, 63).result).toMatchObject({ interrupted: true });
  });

  it("decision/respond{abortTurn} closes parking exactly as turn/interrupt does", async () => {
    // The OTHER interrupt caller that holds `srv`. `requestInterrupt` itself takes only the record and
    // stays that way, so the park side is stated at each of the two sites that can reach the registries.
    let broker: any;
    const engineGate = deferred();
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return { ...fakeSession(), interrupt: async () => { await engineGate.promise; return {}; } }; } });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    send(a.conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    void broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_1", signal: new AbortController().signal });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();

    send(a.conn, { id: 64, method: "decision/respond", params: { threadId, toolUseId: "toolu_1", answer: { kind: "allow_once" }, abortTurn: true } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: turn interrupted");
    await tick();
    expect(replyTo(a.lines, 64).result).toEqual({ ok: true });
    // …and the barrier is latched here too, so the aborted turn's straggler cannot re-park.
    const straggler = srv.parkToolCall(threadId, 0, { tool: "straggler", arguments: {} });
    expect(noteOf(await straggler)).toBe("Tool call cancelled: turn interrupted");
  });

  it("the barrier holds past the next turn's ARRIVAL and lifts only at its dispatch", async () => {
    // The published bound, made mechanical. An items-form turn resolves its input before it reaches the
    // engine, and that gap is the whole difference between "the successor was announced" and "the
    // successor's prompt is on the engine's queue" — a straggler from the interrupted turn must not be
    // rebound to a turn that has not dispatched yet.
    const submitted = deferred<any>();
    let turns = 0;   // only the FIRST turn ends on cue; the successor stays in flight so a park can reach it
    const { srv, a, threadId } = await bootTurn({ session: () => ({ ...fakeSession(), submit: () => (++turns === 1 ? submitted.promise : new Promise(() => {})) }) });
    send(a.conn, { id: 65, method: "turn/interrupt", params: { threadId } });
    await tick();
    submitted.resolve({});           // the interrupted turn settles; the thread goes idle
    await tick();

    const duringGap = srv.parkToolCall(threadId, 0, { tool: "straggler", arguments: {} });
    expect(noteOf(await duringGap)).toBe("Tool call cancelled: turn interrupted");

    send(a.conn, { id: 66, method: "turn/start", params: { threadId, input: [{ type: "text", text: "next" }] } });
    // SYNCHRONOUSLY after arrival: busy is already up and a turn id is already minted, but nothing has
    // reached the engine — the barrier must still refuse.
    const atArrival = srv.parkToolCall(threadId, 0, { tool: "straggler", arguments: {} });
    expect(noteOf(await atArrival)).toBe("Tool call cancelled: turn interrupted");

    await tick(); await tick();      // the input resolves and the prompt dispatches
    expect(barriers(srv).has(threadId)).toBe(false);
    const afterDispatch = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    expect(await settledYet(afterDispatch)).toBe(false);
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);
  });

  it("latching an unknown thread leaves no residue — the barrier set never outlives its threads", async () => {
    const { srv, threadId } = await bootTurn();
    srv.latchParkBarrier("thr_nope");
    expect(barriers(srv).has("thr_nope")).toBe(false);
    srv.latchParkBarrier(threadId);
    expect(barriers(srv).has(threadId)).toBe(true);
  });

  it("server shutdown settles every parked call, naming the shutdown, before it awaits any engine", async () => {
    const engineGate = deferred();
    const { srv, threadId } = await bootTurn({ session: () => ({ ...fakeSession(), dispose: () => engineGate.promise }) });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();

    const done = srv.shutdown();
    expect(await settledYet(parked)).toBe(true);
    // The reason is the shutdown's own, not the close's: it is the whole of what the model is told.
    expect(noteOf(await parked)).toBe("Tool call cancelled: server shutting down");
    await done;
  });

  it("an old generation's callId answers -33002 after a swap, and the new generation's park is untouched", async () => {
    const { srv, a, threadId, record } = await bootTurn();
    void srv.parkToolCall(threadId, 0, { tool: "one", arguments: {} });
    await tick();
    const oldId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    await swapEngine(srv, record, () => fakeSession() as any, undefined);
    a.lines.length = 0;
    const fresh = srv.parkToolCall(threadId, 1, { tool: "two", arguments: {} });
    await tick();
    const newId = notes(a.lines, "tool/callRequested")[0].params.callId as string;
    expect(newId).not.toBe(oldId);

    toolCallResult(srv, ctxOf(srv, "A"), 67, { threadId, callId: oldId, contentItems: [{ type: "inputText", text: "stale" }], success: true });
    await tick();
    expect(replyTo(a.lines, 67).error.code).toBe(ERR.ALREADY_SETTLED);
    expect(await settledYet(fresh)).toBe(false);
    expect(srv.pendingToolCalls(threadId).map((c) => c.callId)).toEqual([newId]);
  });

  it("an admitted FLEET record answers an empty pending set, and its close tears down harmlessly", async () => {
    // The registry is minted for every origin so each thread-scoped read has one to answer from; no fleet
    // path can park into it, because the engine that would raise a call belongs to the HOST.
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => fakeSession() });
    const a = attach(srv, "A");
    await tick();
    const record = fleetRecord(srv);
    srv.admitFleetThread(record);

    expect(srv.pendingToolCalls(record.id)).toEqual([]);
    expect(threadView(srv, record).status).toEqual({ state: "idle" });

    send(a.conn, { id: 68, method: "thread/close", params: { threadId: record.id } });
    await tick(); await tick();
    expect(replyTo(a.lines, 68).result).toEqual({ ok: true });
    expect(srv.registry.get(record.id)).toBeUndefined();
  });
});

describe("M7 thread status — a parked tool call is visible thread state", () => {
  it("a park moves the status to the tool-call waiter, for SUBSCRIBERS only", async () => {
    const { srv, a, threadId, record } = await bootTurn();
    const watcher = attach(srv, "W", { watch: true });
    await tick();
    watcher.lines.length = 0; a.lines.length = 0;

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    expect(statuses(a.lines)).toEqual([{ state: "active", waitingOn: "toolCall" }]);
    // A watcher opted into thread EXISTENCE; per-turn activity is not existence, and every other
    // `thread/status/changed` on this server is subscriber-scoped.
    expect(notes(watcher.lines, "thread/status/changed")).toEqual([]);
    // The same shape off the thread row, not a second one assembled at the notification site.
    expect(threadView(srv, record).status).toEqual({ state: "active", waitingOn: "toolCall" });

    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;
    a.lines.length = 0;
    toolCallResult(srv, ctxOf(srv, "A"), 70, { threadId, callId, contentItems: [{ type: "inputText", text: "ok" }], success: true });
    await tick();
    // Settled: the turn is still running, so the thread is active again with nothing being waited on.
    expect(lastStatus(a.lines)).toEqual({ state: "active" });
    expect(await parked).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
  });

  it("a pending DECISION outranks a parked tool call, and the toolCall waiter surfaces once it is answered", async () => {
    let broker: any;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    send(a.conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    a.lines.length = 0;

    void broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_1", signal: new AbortController().signal });
    void srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    // The client must answer the permission first — the very tool whose call is waiting behind it.
    expect(lastStatus(a.lines)).toEqual({ state: "active", waitingOn: "decision" });

    send(a.conn, { id: 71, method: "decision/respond", params: { threadId, toolUseId: "toolu_1", answer: { kind: "allow_once" } } });
    await tick();
    expect(lastStatus(a.lines)).toEqual({ state: "active", waitingOn: "toolCall" });
  });

  it("a zero-subscriber park is replayed AND reported: the join's own status ends on the tool-call waiter", async () => {
    const { srv, a, threadId } = await bootTurn({ subscribe: false });
    void srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    expect(statuses(a.lines)).toEqual([]);

    send(a.conn, { id: 72, method: "thread/subscribe", params: { threadId } });
    await tick();
    expect(notes(a.lines, "tool/callRequested")).toHaveLength(1);
    // Replay derives from BOTH registries: a join that replayed the call and then called the thread merely
    // active would contradict itself in two consecutive frames.
    expect(lastStatus(a.lines)).toEqual({ state: "active", waitingOn: "toolCall" });
  });

  it("thread/reopen settles a ghost park with NO decision in play, and its final status is idle", async () => {
    const submitted = deferred<any>();
    let ended = false;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => ({ ...fakeSession(), submit: () => submitted.promise, isEnded: () => ended }) });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    send(a.conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    submitted.resolve({});     // the turn ends, the call is abandoned still parked
    await tick();
    ended = true;              // …and the engine dies, which is reopen's whole precondition
    a.lines.length = 0;

    send(a.conn, { id: 73, method: "thread/reopen", params: { threadId } });
    await tick(); await tick();
    expect(replyTo(a.lines, 73).result).toMatchObject({ ok: true });
    expect(noteOf(await parked)).toBe("Tool call cancelled: thread reopened");
    // The settle broadcast a status computed under `swapInFlight` (i.e. "active"); the retraction is what
    // leaves a client rendering off the wire on the truth. The predicate has to see the DYNAMIC registry
    // for that to fire at all here — nothing was parked in the decisions one.
    expect(lastStatus(a.lines)).toEqual({ state: "idle" });
  });

  it("a reopen whose factory THROWS still retracts to idle", async () => {
    const submitted = deferred<any>();
    let ended = false;
    let built = 0;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => {
      if (++built > 1) throw new Error("cannot spawn");
      return { ...fakeSession(), submit: () => submitted.promise, isEnded: () => ended };
    } });
    const a = attach(srv, "A");
    send(a.conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = replyTo(a.lines, 2).result.thread.id as string;
    send(a.conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    send(a.conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    submitted.resolve({});
    await tick();
    ended = true;
    a.lines.length = 0;

    send(a.conn, { id: 74, method: "thread/reopen", params: { threadId } });
    await tick(); await tick();
    expect(replyTo(a.lines, 74).error.message).toBe("cannot spawn");
    expect(noteOf(await parked)).toBe("Tool call cancelled: thread reopened");
    expect(lastStatus(a.lines)).toEqual({ state: "idle" });
  });
});

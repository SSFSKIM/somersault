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
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AppServer, SERVER_OWNED_OVERLAY, threadView, type ConnCtx } from "../../../src/appserver/server.js";
import { DYNAMIC_TOOLS_DECLARED } from "../../../src/appserver/mcp.js";
import { MAX_DYNAMIC_TOOLS, MAX_TOOL_DESCRIPTION_CHARS, RESERVED_NAMESPACE, type DynamicToolSpec } from "../../../src/appserver/dynamicTools.js";
import { INJECTED_SERVER_NAMES } from "../../../src/session/session.js";
import { initializeResult } from "../../../src/appserver/schema/core.js";
import { swapEngine } from "../../../src/appserver/rewind.js";
import { emptyFlagPerms, type ThreadRecord } from "../../../src/appserver/registry.js";
import { DEFAULT_INBOUND } from "../../../src/appserver/peerPolicy.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { MAX_IN } from "../../../src/appserver/peer.js";
import { toolCallResult } from "../../../src/appserver/toolCallResult.js";
import { toolCallResultParams, toolCallResultResult } from "../../../src/appserver/schema/dynamicTools.js";
import { methodSchemas } from "../../../src/appserver/schema/index.js";
import type { CallToolResultLike } from "../../../src/appserver/dynamicCalls.js";
import { MCP_NO_PREFIX_ENV } from "../../../src/config/types.js";
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
  submit: (_prompt?: unknown) => new Promise<{ result: unknown }>(() => {}),
  // The block form of a turn — what `turn/start`'s items array resolves to — travels on the OPTIONAL
  // `submitContent` capability (registry.ts), never on the string-only `submit`. Routed back through
  // whatever `submit` the row installed, so one row still has one engine body.
  submitContent(prompt: unknown) { return this.submit(prompt); },
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

/** The order in which the named methods reached one peer, everything else filtered out. Content assertions
 *  cannot see a SWAPPED pair — a `tool/callRequested` emitted after its status frame still pins both — and
 *  the two are a promise to a client that renders off the wire: the call it is being asked to answer must
 *  arrive before the status that says it is waiting on one. */
const orderOf = (lines: string[], methods: string[]): string[] => parsed(lines).map((f) => f.method).filter((m: string) => methods.includes(m));

/** The park barrier set, read directly. It has no wire projection by design (it gates a park, it does not
 *  announce one), and the one failure a liveness bug produces is a residue only `closeRecord` sweeps. */
const barriers = (srv: AppServer): Set<string> => (srv as unknown as { parkBarriers: Set<string> }).parkBarriers;

/** A FLEET record as `thread/attach` admits one (fleet.ts), minus the socket: enough for the one question
 *  this origin raises here, which is what the thread-scoped tool-call reads answer for a thread that can
 *  never park into them. */
const fleetRecord = (srv: AppServer): ThreadRecord => ({
  id: srv.registry.mint(), origin: "fleet", session: fakeSession() as any, unattended: "park", crossSessionInbound: DEFAULT_INBOUND,
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
async function bootTurn(opts: { subscribe?: boolean; session?: () => any; deps?: Record<string, unknown> } = {}) {
  const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: opts.session ?? (() => fakeSession()), ...opts.deps });
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

    // The frame cap is enforced BELOW dispatch (peer.ts) — the request dies before any handler, registered
    // or not. What is only provable now that Task 8 has REGISTERED the method is the other half: the
    // recovery the schema's `.describe()` promises is a promise about `tool/callResult` itself, so the
    // retry has to travel the same wire and reach the same dispatched handler. Both halves are here.
    send(a.conn, { id: 50, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "x".repeat(MAX_IN) }], success: true } });
    await tick();
    const dead = parsed(a.lines).find((f) => f.error);
    expect(dead.id).toBe(null);
    expect(dead.error.code).toBe(ERR.PARSE);
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);

    // The published description IS the recovery instruction — a client that cannot read it here cannot
    // know the call survived, so the text is asserted where the behavior it describes is proved.
    const published = toolCallResultParams.shape.contentItems.description ?? "";
    expect(published).toContain("retry the same callId with a smaller result");
    expect(published).toContain("base64 `data:` URL");

    send(a.conn, { id: 51, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "small" }], success: true } });
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

describe("M7 tool/callResult is PUBLISHED (Task 8)", () => {
  it("is registered with both halves of its shape — the registry entry is what the artifact publishes", () => {
    // Task 4 defined these and pinned them UNREGISTERED: a settlement method reachable before any thread
    // could declare tools would have been a stable surface with no way to obtain a callId. Declarations
    // exist now, so the entry does too — and it carries the ack schema, not just the params.
    expect(methodSchemas["tool/callResult"]).toBeDefined();
    expect(methodSchemas["tool/callResult"].params).toBe(toolCallResultParams);
    expect(methodSchemas["tool/callResult"].result).toBe(toolCallResultResult);
    expect(methodSchemas["tool/callResult"].experimental).toBeUndefined(); // stable: the shape is this milestone's own
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
    a.lines.length = 0;               // everything below is the clear's own traffic

    send(a.conn, { id: 61, method: "thread/clear", params: { threadId } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: engine swapped");
    await tick();
    expect(replyTo(a.lines, 61).result).toMatchObject({ ok: true });
    // AND THE WIRE ENDS ON THE TRUTH. Settling the ghost broadcast a status computed under `swapInFlight`
    // — "active", for a thread whose turn is already over — and the latch then drops in a `finally`
    // without a word. The retraction is the second frame; without it a client that renders status off the
    // wire shows this thread busy forever (r7 finding 4, on the swap family this time).
    expect(statuses(a.lines)).toEqual([{ state: "active" }, { state: "idle" }]);
  });

  it("thread/rewind takes that retraction from the same latch, not from a line of its own", async () => {
    // The sibling of the row above, and the reason the correction is ONE release rather than a copy per
    // method: rewind reaches `swapEngine` through a different factory but the identical `latchSwap`, so a
    // fix written into `thread/clear` alone would leave this method reporting "active" forever. Scope is
    // `conversation` — the file-restore half is a different seam and would only need faking.
    const submitted = deferred<any>();
    const engineGate = deferred();
    const { srv, a, threadId } = await bootTurn({
      session: () => ({ ...fakeSession(), submit: () => submitted.promise, dispose: () => engineGate.promise }),
      deps: { resumeAtFactory: () => fakeSession() },
    });
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    void parked.then(() => engineGate.resolve());
    await tick();
    submitted.resolve({});
    await tick();
    a.lines.length = 0;

    send(a.conn, { id: 69, method: "thread/rewind", params: { threadId, uuid: "u2", prevUuid: "u1", scope: "conversation" } });
    await tick();
    expect(await settledYet(parked)).toBe(true);
    expect(noteOf(await parked)).toBe("Tool call cancelled: engine swapped");
    await tick();
    expect(replyTo(a.lines, 69).result).toMatchObject({ ok: true });
    expect(statuses(a.lines)).toEqual([{ state: "active" }, { state: "idle" }]);
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
    // …and the request comes FIRST. A client told "waiting on a tool call" before it has been told which
    // call would have a waiter it cannot name; the two emissions are one announcement in a fixed order.
    expect(orderOf(a.lines, ["tool/callRequested", "thread/status/changed"])).toEqual(["tool/callRequested", "thread/status/changed"]);
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
    // The replay's order is the live park's order, not an accident of the replay step: the call, then the
    // status that says the thread is waiting on it.
    expect(orderOf(a.lines, ["tool/callRequested", "thread/status/changed"])).toEqual(["tool/callRequested", "thread/status/changed"]);
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

// ── M7 TASK 7: THE TRANSIENT OVERLAY ─────────────────────────────────────────────────────────────
//
// A declaration reaches the engine as MCP servers, and the ONE thing every row below is really about is
// that those servers live on the config handed to ONE factory call and nowhere else. `record.config` is the
// clean base the swap family rebuilds from; the overlay is built fresh beside it at every build.
//
// THE FACTORY IS THE INSTRUMENT. Every row reads the config a capturing `sessionFactory` was handed, which
// is exactly what the real `openSession` would have received — there is no engine here to mount anything.
// The one place that is not enough is the swap family, where the claim is about the RELATIONSHIP between
// two builds, so those rows compare the WRAPPED instance across generations and then connect both to real
// transports: an MCP `Server` refuses a second one, so a cached instance rewrapped in a new entry object
// fails there and passes every identity check on the entry itself.

/** One namespace and one bare function — the two shapes, and therefore the two server slots. */
const declaration = (): DynamicToolSpec[] => [
  {
    type: "namespace", name: "ops", description: "the ops namespace",
    tools: [{ type: "function", name: "lookup", description: "look something up", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
  },
  { type: "function", name: "ping", description: "ping the client", inputSchema: { type: "object", properties: {} } },
];

type SdkEntry = { type: "sdk"; name: string; instance: McpServer };
const overlayOf = (cfg: Record<string, unknown> | undefined): Record<string, SdkEntry> | undefined =>
  cfg?.dynamicToolServers as Record<string, SdkEntry> | undefined;
const opsInstance = (cfg: Record<string, unknown>): McpServer => overlayOf(cfg)!.ops.instance;

/** A server whose factory RECORDS every engine config it was handed, in build order. */
function capturing(opts: { session?: () => any; deps?: Record<string, unknown> } = {}) {
  const configs: Array<Record<string, unknown>> = [];
  const make = opts.session ?? (() => fakeSession());
  const srv = new AppServer({}, {
    ccxDir: fileCcxDir,
    sessionFactory: (cfg: Record<string, unknown>) => { configs.push(cfg); return make(); },
    ...opts.deps,
  });
  return { srv, configs };
}

/** Every MCP client/server pair a row opens, closed after it — an in-memory transport keeps both ends alive. */
const opened: Array<{ client: Client; instance: McpServer }> = [];
afterEach(async () => {
  for (const { client, instance } of opened.splice(0)) {
    await client.close().catch(() => {});
    await instance.close().catch(() => {});
  }
});

/** A real MCP client initialized against one built instance. THIS is what a reused instance fails: the
 *  pinned SDK's `Server.connect` refuses a second transport, and the agent SDK swallows that failure with
 *  a debug log — a thread that silently lost its tools, with no error anywhere. */
async function connect(instance: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "m7-overlay", version: "0.0.0" });
  await Promise.all([instance.connect(serverTransport), client.connect(clientTransport)]);
  opened.push({ client, instance });
  return client;
}

/** The text of a tool call's result, as the MCP client sees it. */
const callNote = async (client: Client, tool: string): Promise<string> => {
  const result = await client.callTool({ name: tool, arguments: {} }) as { content: Array<{ text?: string }> };
  return String(result.content[0]?.text ?? "");
};

/** A swap crosses several real timer boundaries (an awaiting dispose, the chain callback). */
const settleSwap = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

describe("M7 the transient overlay — what one engine build receives", () => {
  it("a declaring start hands the factory one server per namespace plus dyn, and record.config never sees them", () => {
    const { srv, configs } = capturing();
    const specs = declaration();
    const record = srv.createThread({ config: { cwd: "/w" }, unattended: "park", dynamicTools: specs });

    expect(Object.keys(overlayOf(configs[0])!).sort()).toEqual(["dyn", "ops"]);
    const ops = overlayOf(configs[0])!.ops;
    expect(ops.type).toBe("sdk");
    expect(ops.name).toBe("ops");
    expect(ops.instance).toBeInstanceOf(McpServer);
    // NO `alwaysLoad` on the entry: the CLI ORs the server-level flag with each tool's own
    // `_meta["anthropic/alwaysLoad"]`, so a server-level true would defeat every `deferLoading: true`.
    expect(Object.keys(ops).sort()).toEqual(["instance", "name", "type"]);

    // THE CLEAN BASE. The swap family rebuilds every replacement engine from this object, so an overlay
    // left on it would be re-mounted by a second engine — the same instance, refusing its second transport.
    expect(record.config).not.toHaveProperty("dynamicToolServers");
    expect(JSON.stringify(record.config)).not.toContain("dynamicToolServers");
    expect(JSON.stringify(record.config)).not.toContain("instance");
    expect(JSON.parse(JSON.stringify(record.config)).cwd).toBe("/w");
    // …and the declaration itself is remembered ON the record, which is what every later build reads.
    expect(record.dynamicTools).toEqual(specs);
  });

  it("a NON-declaring start carries no overlay and no declaration at all", () => {
    const { srv, configs } = capturing();
    const record = srv.createThread({ config: { cwd: "/w" }, unattended: "park" });
    expect(configs[0]).not.toHaveProperty("dynamicToolServers");
    expect(record.dynamicTools).toBeUndefined();
  });

  it("forces CLAUDE_AGENT_SDK_MCP_NO_PREFIX off for a declaring thread, and leaves a non-declaring one's env alone", () => {
    // A truthy value strips the `mcp__<server>__` prefix from every tool name — every namespace collapses
    // into one flat space and the whole naming invariant this milestone rests on goes with it.
    const { srv, configs } = capturing();
    const declaring = srv.createThread({ config: { env: { CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1", KEEP: "yes" } }, unattended: "park", dynamicTools: declaration() });
    expect(configs[0].env).toEqual({ CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "", KEEP: "yes" });
    // The kill rides the TRANSIENT config only: what the client asked for is still what the record says.
    expect((declaring.config as { env: Record<string, string> }).env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX).toBe("1");

    srv.createThread({ config: { env: { CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1" } }, unattended: "park" });
    expect(configs[1].env).toEqual({ CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1" });
  });

  it("writes the kill onto process.env when the client declared no env — a one-key env would REPLACE the subprocess environment", () => {
    // An SDK `env` replaces the child's environment rather than augmenting it, so `{NO_PREFIX: ""}` alone
    // is PATH and the credentials gone. `resolveOptions` does spread `process.env` underneath what it
    // forwards, which makes the bare shape survivable — but that is the other file's property, and this
    // config is read as a config. The base is written here, the same way the sibling write states it.
    const { srv, configs } = capturing();
    srv.createThread({ config: { cwd: "/w" }, unattended: "park", dynamicTools: declaration() });

    const env = configs[0].env as Record<string, string | undefined>;
    expect(env[MCP_NO_PREFIX_ENV]).toBe("");
    expect(env.PATH).toBe(process.env.PATH);
    // …and nothing about the base is lost: every key the process had is still there.
    expect(Object.keys(env).length).toBeGreaterThanOrEqual(Object.keys(process.env).length);
  });

  it("the resume spine builds the overlay too, beside the resume it folds in", async () => {
    const { srv, configs } = capturing();
    const a = attach(srv, "A");
    await tick();
    await srv.startThread(a.ctx(), 9, { resume: "sess-x", config: {}, unattended: "park", dynamicTools: declaration() });

    expect(Object.keys(overlayOf(configs[0])!).sort()).toEqual(["dyn", "ops"]);
    expect(configs[0].resume).toBe("sess-x");
    const record = srv.registry.list()[0]!;
    expect(record.config).not.toHaveProperty("dynamicToolServers");
    expect((record.config as { resume?: string }).resume).toBe("sess-x");
    expect(record.dynamicTools).toHaveLength(2);
  });

  it("a declaring start whose factory throws leaves no record and no call registry behind", () => {
    // The factory runs BEFORE the record and both registries are written, so a synchronous throw — an
    // engine that cannot spawn — must not orphan a thread nobody can ever reach or settle.
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => { throw new Error("cannot spawn"); } });
    expect(() => srv.createThread({ config: {}, unattended: "park", dynamicTools: declaration() })).toThrow("cannot spawn");
    expect(srv.registry.list()).toEqual([]);
    const inner = srv as unknown as { dynamicCalls: Map<string, unknown>; decisions: Map<string, unknown> };
    expect(inner.dynamicCalls.size).toBe(0);
    expect(inner.decisions.size).toBe(0);
  });

  it("a declaring RESUME whose factory throws leaves no record and no registries behind either", async () => {
    // The resume spine's twin of the row above, and the twin is the point: the ordering is one line apart
    // on each spine, and until now only `createThread` stated it. What an orphaned `decisions` entry costs
    // is unbounded: `registry.list()` never names its thread, so nothing can enumerate it, nothing can
    // settle it, and `shutdown()` walks the registry rather than the map — one permanent leak per resume
    // whose engine could not spawn (a store id the CLI refuses, an invalid model, a cwd that is not there).
    const srv = new AppServer({}, { ccxDir: fileCcxDir, sessionFactory: () => { throw new Error("cannot spawn"); } });
    const a = attach(srv, "A");
    await tick();

    await expect(srv.startThread(a.ctx(), 9, { resume: "sess-x", config: {}, unattended: "park", dynamicTools: declaration() })).rejects.toThrow("cannot spawn");

    expect(srv.registry.list()).toEqual([]);
    const inner = srv as unknown as { dynamicCalls: Map<string, unknown>; decisions: Map<string, unknown> };
    expect(inner.dynamicCalls.size).toBe(0);
    expect(inner.decisions.size).toBe(0);
  });

  it("refuses a client that writes the overlay itself, through the config or through the hatch, on both spines", async () => {
    const { srv } = capturing();
    const a = attach(srv, "A");
    await tick();
    a.lines.length = 0;
    send(a.conn, { id: 20, method: "thread/start", params: { config: { dynamicToolServers: { ops: {} } } } });
    send(a.conn, { id: 21, method: "thread/start", params: { config: { extraOptions: { dynamicToolServers: { ops: {} } } } } });
    send(a.conn, { id: 22, method: "thread/resume", params: { sessionId: "sess-x", config: { dynamicToolServers: {} } } });
    await settleSwap();

    for (const id of [20, 21, 22]) {
      expect(replyTo(a.lines, id).error.code).toBe(ERR.INVALID_PARAMS);
      expect(replyTo(a.lines, id).error.message).toBe(SERVER_OWNED_OVERLAY);
    }
    expect(srv.registry.list()).toEqual([]);
  });

  it("review/start on a declaring target inherits neither the overlay nor the declaration", async () => {
    // Deliberate: a review is a DETACHED thread reading the target's tree, and the client-side tool runtime
    // the declaration names belongs to the target's conversation, not to this one.
    const { srv, configs } = capturing({ session: () => ({ ...fakeSession(), submit: async () => ({ result: {} }) }) });
    const a = attach(srv, "A");
    await tick();
    const target = srv.createThread({ config: { cwd: "/repo" }, unattended: "park", dynamicTools: declaration() });
    a.lines.length = 0;

    send(a.conn, { id: 30, method: "review/start", params: { threadId: target.id, target: { type: "uncommittedChanges" } } });
    await settleSwap();

    const reviewThreadId = replyTo(a.lines, 30).result.reviewThreadId as string;
    expect(configs).toHaveLength(2);
    expect(overlayOf(configs[1])).toBeUndefined();
    expect(srv.registry.get(reviewThreadId)!.dynamicTools).toBeUndefined();
  });

  it("mcpServer/set is refused on a declaring thread and untouched on a non-declaring one", async () => {
    // A wholesale replacement of the server set would drop the very servers the declared tools are
    // published under — the model would keep being told about tools nothing can answer.
    const sets: unknown[] = [];
    const { srv } = capturing({ session: () => ({ ...fakeSession(), setMcpServers: async (s: unknown) => { sets.push(s); return { added: [], removed: [], errors: {} }; } }) });
    const a = attach(srv, "A");
    await tick();
    const declaring = srv.createThread({ config: {}, unattended: "park", dynamicTools: declaration() });
    const plain = srv.createThread({ config: {}, unattended: "park" });
    a.lines.length = 0;

    send(a.conn, { id: 50, method: "mcpServer/set", params: { threadId: declaring.id, servers: {} } });
    send(a.conn, { id: 51, method: "mcpServer/set", params: { threadId: plain.id, servers: { theirs: { type: "sdk" } } } });
    await settleSwap();

    expect(replyTo(a.lines, 50).error.code).toBe(ERR.INVALID_PARAMS);
    expect(replyTo(a.lines, 50).error.message).toBe(DYNAMIC_TOOLS_DECLARED);
    expect(replyTo(a.lines, 51).result).toEqual({ added: [], removed: [], errors: {} });
    expect(sets).toEqual([{ theirs: { type: "sdk" } }]);
  });
});

describe("M7 the transient overlay — every swap builds it again", () => {
  it("thread/rewind hands the replacement a FRESH instance, and each generation parks under its own epoch", async () => {
    const swapConfigs: Array<Record<string, unknown>> = [];
    const { srv, configs } = capturing({
      session: () => ({ ...fakeSession(), submit: async () => ({ result: {} }), sessionId: "sess-1" }),
      deps: { resumeAtFactory: (_id: string, _at: string, _dropped: string, cfg: Record<string, unknown>) => { swapConfigs.push(cfg); return fakeSession(); } },
    });
    const a = attach(srv, "A");
    await tick();
    const record = srv.createThread({ config: {}, unattended: "park", dynamicTools: declaration() });
    a.lines.length = 0;

    send(a.conn, { id: 40, method: "thread/rewind", params: { threadId: record.id, uuid: "u2", prevUuid: "u1", scope: "conversation" } });
    await settleSwap();
    expect(replyTo(a.lines, 40).result).toMatchObject({ ok: true });

    const first = opsInstance(configs[0]);
    const second = opsInstance(swapConfigs[0]!);
    expect(second).not.toBe(first);
    // Both connectable — the assertion a rewrapped cached instance cannot pass.
    const firstClient = await connect(first);
    const secondClient = await connect(second);
    // …and each build captured its OWN generation, which is the only thing that tells a late callback from
    // the discarded engine apart from a live one. Neither call can park (no turn is in flight), and the two
    // cancellations say WHY in different words — which is the whole proof.
    expect(await callNote(firstClient, "lookup")).toBe("Tool call cancelled: engine generation superseded");
    expect(await callNote(secondClient, "lookup")).toBe("Tool call cancelled: no active turn");
  });

  it("thread/clear hands the fresh conversation a FRESH instance", async () => {
    const { srv, configs } = capturing({ session: () => ({ ...fakeSession(), submit: async () => ({ result: {} }), sessionId: "sess-1" }) });
    const a = attach(srv, "A");
    await tick();
    const record = srv.createThread({ config: {}, unattended: "park", dynamicTools: declaration() });
    a.lines.length = 0;

    send(a.conn, { id: 41, method: "thread/clear", params: { threadId: record.id } });
    await settleSwap();
    expect(replyTo(a.lines, 41).result).toMatchObject({ ok: true });

    expect(configs).toHaveLength(2);
    expect(opsInstance(configs[1]!)).not.toBe(opsInstance(configs[0]!));
    await connect(opsInstance(configs[0]!));
    await connect(opsInstance(configs[1]!));
  });

  it("thread/reopen hands the recovered engine a FRESH instance", async () => {
    let ended = false;
    const { srv, configs } = capturing({ session: () => ({ ...fakeSession(), submit: async () => ({ result: {} }), sessionId: "sess-1", isEnded: () => ended }) });
    const a = attach(srv, "A");
    await tick();
    const record = srv.createThread({ config: {}, unattended: "park", dynamicTools: declaration() });
    ended = true;      // reopen's whole precondition
    a.lines.length = 0;

    send(a.conn, { id: 42, method: "thread/reopen", params: { threadId: record.id } });
    await settleSwap();
    expect(replyTo(a.lines, 42).result).toMatchObject({ ok: true });

    expect(configs).toHaveLength(2);
    expect(opsInstance(configs[1]!)).not.toBe(opsInstance(configs[0]!));
    await connect(opsInstance(configs[0]!));
    await connect(opsInstance(configs[1]!));
  });
});

// ── M7 TASK 8: THE DECLARATION ON THE WIRE ───────────────────────────────────────────────────────
//
// Everything above this line is reachable only from inside the process. This section is the milestone's
// one wire-visible change: `dynamicTools` on `thread/start` AND `thread/resume`, `tool/callResult`
// dispatched, and the `initialize` reply carrying the marker that lets a client detect an OLD server
// before it declares. Three layers answer a bad declaration, and the rows are organized by which one:
//
//   THE SHAPE (zod, schema/threads.ts) → a bare "Invalid params". A malformed request, not a rejected one.
//   THE SEMANTICS (`validateDeclarations`) → -32602 whose message NAMES the offender, which is the whole
//   product: a client fixing a 33-tool declaration must be told it declared 33.
//   THE OVERLAY GUARD (`refuseServerOwnedOverlay`, Task 7) → the same -32602 on both spines.

/** The declaration a client actually sends: namespace children TAGGED `type:"function"`, exactly as
 *  Codex's own `DynamicToolNamespaceTool` spells them, so a canonical Codex declaration cross-parses. */
const codexShaped = () => [
  {
    type: "namespace", name: "ops", description: "operations tooling",
    tools: [
      { type: "function", name: "lookup", description: "look something up", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
      { type: "function", name: "count", description: "count rows", inputSchema: { type: "object", properties: { n: { type: "integer" } } }, deferLoading: true },
    ],
  },
  { type: "function", name: "ping", description: "ping the client", inputSchema: { type: "object", properties: {} } },
];

const fn = (name: string, extra: Record<string, unknown> = {}) =>
  ({ type: "function", name, description: "d", inputSchema: { type: "object", properties: {} }, ...extra });
const nsOf = (name: string, tools: unknown[] = [fn("a")]) => ({ type: "namespace", name, description: "d", tools });

let wireId = 100;
/** A booted wire whose factory captures every engine config, plus one initialized connection. */
async function bootWire(opts: { session?: () => any; deps?: Record<string, unknown> } = {}) {
  const { srv, configs } = capturing(opts);
  const a = attach(srv, "A");
  await tick();
  a.lines.length = 0;
  /** One request, answered. `settleSwap` because the resume spine replies mid-way through an async body
   *  and a refusal travels out through `admitResume`'s own await. */
  const call = async (method: string, params: object) => {
    const id = ++wireId;
    send(a.conn, { id, method, params });
    await settleSwap();
    return replyTo(a.lines, id);
  };
  const start = (params: object) => call("thread/start", params);
  const resume = (params: object) => call("thread/resume", { sessionId: "sess-x", ...params });
  return { srv, configs, a, call, start, resume };
}

describe("M7 the declaration on the wire — accepted", () => {
  it("a Codex-shaped declaration is accepted at thread/start, stamped on the record, and off record.config", async () => {
    const { srv, configs, start } = await bootWire();
    const reply = await start({ config: { cwd: "/w" }, dynamicTools: codexShaped() });

    expect(reply.error).toBeUndefined();
    const record = srv.registry.get(reply.result.thread.id as string)!;
    // The declaration survives the wire VERBATIM — tags, `deferLoading`, the raw JSON Schema and all.
    expect(record.dynamicTools).toEqual(codexShaped());
    expect(Object.keys(overlayOf(configs[0]!)!).sort()).toEqual(["dyn", "ops"]);
    // The record's config is the clean base every later engine is rebuilt from (Task 7's whole subject),
    // asserted HERE too because this is the first path a real client can reach it by.
    expect(JSON.stringify(record.config)).not.toContain("dynamicToolServers");
    expect(JSON.stringify(record.config)).not.toContain("instance");
    expect(JSON.parse(JSON.stringify(record.config)).cwd).toBe("/w");
  });

  it("thread/resume takes the same declaration, beside the resume it admits", async () => {
    const { srv, configs, resume } = await bootWire();
    const reply = await resume({ dynamicTools: codexShaped() });

    expect(reply.error).toBeUndefined();
    const record = srv.registry.get(reply.result.thread.id as string)!;
    expect(record.dynamicTools).toEqual(codexShaped());
    expect(record.sessionId).toBe("sess-x");
    expect(Object.keys(overlayOf(configs[0]!)!).sort()).toEqual(["dyn", "ops"]);
    expect(configs[0]!.resume).toBe("sess-x");
    expect(JSON.stringify(record.config)).not.toContain("dynamicToolServers");
  });

  it("a start that declares NOTHING is untouched — no overlay, no declaration, no new refusal", async () => {
    const { srv, configs, start } = await bootWire();
    const reply = await start({ config: { mcpServers: { ops: { type: "stdio", command: "x" } } } });
    expect(reply.error).toBeUndefined();
    expect(configs[0]).not.toHaveProperty("dynamicToolServers");
    expect(srv.registry.get(reply.result.thread.id as string)!.dynamicTools).toBeUndefined();
  });
});

describe("M7 the declaration on the wire — the semantic gate answers, naming the offender", () => {
  // ONE table, driven through BOTH spines. The gate is a single shared helper by construction, and a
  // table that ran on one spine only is exactly how the two would drift apart again.
  const cases: Array<{ label: string; specs: unknown[]; config?: Record<string, unknown>; message: string }> = [
    {
      label: "the global cap",
      specs: Array.from({ length: MAX_DYNAMIC_TOOLS + 1 }, (_, i) => fn(`t${i}`)),
      message: `too many dynamic tools: ${MAX_DYNAMIC_TOOLS + 1} declared (max ${MAX_DYNAMIC_TOOLS})`,
    },
    {
      // The row the occupied set exists for: `cc-context` is INJECTED by the session layer, not configured
      // by the client, so a declaration colliding with it would otherwise be admitted and then silently
      // lose its tools to the injection's own spread.
      label: "an injected server's slot",
      specs: [nsOf(INJECTED_SERVER_NAMES[0]!)],
      message: `server name "${INJECTED_SERVER_NAMES[0]}" collides with the MCP server "${INJECTED_SERVER_NAMES[0]}"`,
    },
    {
      label: "a configured server's slot",
      specs: [nsOf("ops")],
      config: { mcpServers: { ops: { type: "stdio", command: "x" } } },
      message: 'server name "ops" collides with the MCP server "ops"',
    },
    {
      // Through the HATCH, which is the spelling that actually reaches the SDK when a client uses it.
      label: "a server the extraOptions hatch configured",
      specs: [nsOf("ops")],
      config: { extraOptions: { mcpServers: { ops: { type: "stdio", command: "x" } } } },
      message: 'server name "ops" collides with the MCP server "ops"',
    },
    { label: "the reserved namespace", specs: [nsOf(RESERVED_NAMESPACE)], message: `namespace "${RESERVED_NAMESPACE}" is reserved for bare tool declarations` },
    { label: "the delimiter in a tool name", specs: [fn("prod__run")], message: 'tool "prod__run" may not contain "__" (the MCP tool-name delimiter)' },
    { label: "a native tool's name", specs: [fn("Read")], message: 'tool "Read" is the name of a native tool' },
    {
      label: "a schema outside the conversion subset",
      specs: [fn("choosy", { inputSchema: { type: "object", oneOf: [{ type: "object" }] } })],
      message: 'tool "choosy": unsupported inputSchema: oneOf',
    },
    {
      // draft-07 pins `required` to unique items, and the schema is advertised VERBATIM — a duplicate
      // makes a standards-validating consumer refuse the whole tools/list document, so the thread would
      // start and the namespace would be dead. Refused HERE, at declaration, naming the property.
      label: "a schema whose required repeats a property",
      specs: [fn("dup", { inputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a", "a"] } })],
      message: 'tool "dup": unsupported inputSchema: required:a duplicated',
    },
  ];

  for (const { label, specs, config, message } of cases) {
    it(`${label} → -32602 on BOTH spines, and nothing is admitted`, async () => {
      const { srv, configs, start, resume } = await bootWire();
      for (const reply of [await start({ ...(config ? { config } : {}), dynamicTools: specs }), await resume({ ...(config ? { config } : {}), dynamicTools: specs })]) {
        expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
        expect(reply.error.message).toBe(message);
      }
      // REFUSED BEFORE ANYTHING IS MINTED: no thread, and no engine ever built.
      expect(srv.registry.list()).toEqual([]);
      expect(configs).toEqual([]);
    });
  }

  it("the occupied set follows own-property replacement, so an extraOptions map REPLACES the typed one", async () => {
    // `resolveOptions` spreads `extraOptions` over the typed options, so whichever `mcpServers` the hatch
    // carries is the one the engine gets — including an own `null`, which replaces the map with nothing.
    // A `??` fallback here would resurrect the typed map and refuse a namespace that is genuinely free.
    const typed = { mcpServers: { ops: { type: "stdio", command: "x" } } };
    for (const hatch of [null, {}]) {
      const { srv, start } = await bootWire();
      const reply = await start({ config: { ...typed, extraOptions: { mcpServers: hatch } }, dynamicTools: [nsOf("ops")] });
      expect(reply.error, `extraOptions.mcpServers = ${JSON.stringify(hatch)}`).toBeUndefined();
      expect(srv.registry.get(reply.result.thread.id as string)!.dynamicTools).toHaveLength(1);
    }
    // …and the mirror: the hatch's own map is what occupies, so the typed map's name is free while the
    // hatch's is taken.
    const { start } = await bootWire();
    const config = { mcpServers: { typedOnly: { type: "stdio", command: "x" } }, extraOptions: { mcpServers: { hatched: { type: "stdio", command: "x" } } } };
    expect((await start({ config, dynamicTools: [nsOf("typedOnly")] })).error).toBeUndefined();
    expect((await start({ config, dynamicTools: [nsOf("hatched")] })).error.message).toBe('server name "hatched" collides with the MCP server "hatched"');
  });

  it("a non-record mcpServers occupies nothing at all, and never throws", async () => {
    // The value is a client passthrough: an array, a string or a number reaches here as easily as a map,
    // and `Object.keys` on any of them would either fabricate names ("0", "1") or read as occupied.
    for (const mcpServers of [[], ["ops"], "ops", 7]) {
      const { start } = await bootWire();
      const reply = await start({ config: { mcpServers }, dynamicTools: [nsOf("ops")] });
      expect(reply.error, `mcpServers = ${JSON.stringify(mcpServers)}`).toBeUndefined();
    }
  });
});

describe("M7 the declaration on the wire — the shape gate", () => {
  const badShapes: Array<[string, unknown]> = [
    ["a name that does not start with a letter", [fn("1lookup")]],
    ["a name carrying a character outside the class", [fn("look up")]],
    ["a name past 64 characters", [fn("a".repeat(65))]],
    ["a description past the cap", [fn("lookup", { description: "d".repeat(MAX_TOOL_DESCRIPTION_CHARS + 1) })]],
    ["an inputSchema that is not an object", [fn("lookup", { inputSchema: "not a schema" })]],
    ["a namespace with ZERO tools", [nsOf("ops", [])]],
    ["an UNTAGGED namespace child", [{ type: "namespace", name: "ops", description: "d", tools: [{ name: "a", description: "d", inputSchema: { type: "object" } }] }]],
    ["a spec of an unknown kind", [{ type: "widget", name: "ops", description: "d" }]],
    ["a dynamicTools that is not an array", { type: "function" }],
  ];

  for (const [label, dynamicTools] of badShapes) {
    it(`${label} → "Invalid params" on BOTH spines`, async () => {
      const { srv, start, resume } = await bootWire();
      for (const reply of [await start({ dynamicTools }), await resume({ dynamicTools })]) {
        expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
        expect(reply.error.message).toBe("Invalid params");
      }
      expect(srv.registry.list()).toEqual([]);
    });
  }

  it("counts a description in CODE POINTS, the unit its published maxLength is counted in", async () => {
    // THE ASTRAL ROW. draft-07 counts `maxLength` in Unicode code points, so a client validating against
    // the published `maxLength: 2000` sends 2,000 emoji — 4,000 UTF-16 units — and a zod `.max()` would
    // refuse what the artifact told it to send. Both halves of the union carry the same bound, so the
    // namespace description is asserted beside the function one.
    const astral = "\u{1F600}".repeat(MAX_TOOL_DESCRIPTION_CHARS);
    expect(astral.length).toBe(MAX_TOOL_DESCRIPTION_CHARS * 2); // …and the fixture really is over in units.
    const { start } = await bootWire();
    expect((await start({ dynamicTools: [fn("lookup", { description: astral })] })).error).toBeUndefined();
    expect((await start({ dynamicTools: [nsOf("ops"), { type: "namespace", name: "wide", description: astral, tools: [fn("a")] }] })).error).toBeUndefined();
    // One code point over is still refused, on both halves — the cap moved units, not position.
    const over = `${astral}\u{1F600}`;
    expect((await start({ dynamicTools: [fn("lookup", { description: over })] })).error.message).toBe("Invalid params");
    expect((await start({ dynamicTools: [{ type: "namespace", name: "wide", description: over, tools: [fn("a")] }] })).error.message).toBe("Invalid params");
  });

  it("the 64-character boundary itself is legal — the shape refuses one over, not the cap", async () => {
    const { start } = await bootWire();
    expect((await start({ dynamicTools: [fn("a".repeat(64))] })).error).toBeUndefined();
  });

  it("a deferLoading that is not a boolean is a shape refusal; the flag itself rides through", async () => {
    const { start } = await bootWire();
    expect((await start({ dynamicTools: [fn("lookup", { deferLoading: "yes" })] })).error.message).toBe("Invalid params");
    // Carried on a NAMESPACED tool, because that is the only place a true `deferLoading` is legal — the
    // shape layer takes the flag either way, and the semantic layer below is what judges the pairing.
    expect((await start({ dynamicTools: [nsOf("ops", [fn("lookup", { deferLoading: true })])] })).error).toBeUndefined();
  });

  it("a BARE deferred tool is refused by the semantics, in Codex's own words", async () => {
    // The shape layer accepts the flag anywhere; deferral only means something under a namespace the
    // model can be shown, so canonical Codex refuses the bare pairing and this server repeats its message
    // verbatim. The wire row is here because the -32602 message is the client's whole repair instruction.
    const { start } = await bootWire();
    const reply = await start({ dynamicTools: [fn("lookup", { deferLoading: true })] });
    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toBe("deferred dynamic tool must include a namespace: lookup");
  });
});

describe("M7 initialize publishes the capability that makes declaring safe", () => {
  it("the reply carries dynamicTools:true, and the registered result schema describes the WHOLE reply", async () => {
    // THE F9 LESSON. An old server does not refuse an unknown `dynamicTools` — `z.object` STRIPS it and
    // starts the thread toolless, with no error anywhere. A client that intends to declare must therefore
    // be able to ask first, and the answer has to be part of the published contract rather than a field
    // the client learns about from prose.
    const { srv } = capturing();
    const { lines, sink } = mkSink();
    const conn = srv.connect(sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "cap-reader" } } });
    await tick();

    const result = replyTo(lines, 1).result as Record<string, unknown>;
    expect(result.dynamicTools).toBe(true);
    // The schema is the COMPLETE current reply, not just the marker: a result schema that described one
    // field would tell a generated client the other three are unknown extras.
    expect(initializeResult.safeParse(result).success).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["crossSession", "dynamicTools", "platformOs", "userAgent", "version"]);
    // Registered, or the artifact's `results` map never carries it and a generated client cannot look.
    expect(methodSchemas["initialize"].result).toBe(initializeResult);
    // A downgraded reply — a marker absent — must FAIL that schema, or the detection is not a detection.
    // Both markers, separately: each answers a different optional param, so a schema that let either one
    // go missing would tell a client the wrong thing about the half it actually meant to use.
    const { dynamicTools: _marker, ...downgraded } = result;
    expect(initializeResult.safeParse(downgraded).success).toBe(false);
    const { crossSession: _m8, ...noCrossSession } = result;
    expect(initializeResult.safeParse(noCrossSession).success).toBe(false);
  });
});

describe("M7 tool/callResult, dispatched", () => {
  it("settles a real park over the wire, and the second answer hears -33002 from the same dispatch", async () => {
    // Task 4 pinned the handler's whole matrix by calling it directly. This is the one thing that could
    // not be proved that way: that the dispatch table actually reaches it.
    const { srv, a, threadId } = await bootTurn();
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    send(a.conn, { id: 90, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "answered" }], success: true } });
    send(a.conn, { id: 91, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "again" }], success: true } });
    await tick();

    expect(replyTo(a.lines, 90).result).toEqual({});
    expect(replyTo(a.lines, 91).error.code).toBe(ERR.ALREADY_SETTLED);
    expect(await parked).toEqual({ content: [{ type: "text", text: "answered" }], isError: false });
    expect(srv.pendingToolCalls(threadId)).toEqual([]);
  });

  it("a malformed settlement is a shape refusal that leaves the call parked and answerable", async () => {
    const { srv, a, threadId } = await bootTurn();
    const parked = srv.parkToolCall(threadId, 0, { tool: "lookup", arguments: {} });
    await tick();
    const callId = notes(a.lines, "tool/callRequested")[0].params.callId as string;

    send(a.conn, { id: 92, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputVideo", url: "x" }], success: true } });
    await tick();
    expect(replyTo(a.lines, 92).error.code).toBe(ERR.INVALID_PARAMS);
    expect(srv.pendingToolCalls(threadId)).toHaveLength(1);

    send(a.conn, { id: 93, method: "tool/callResult", params: { threadId, callId, contentItems: [{ type: "inputText", text: "ok" }], success: true } });
    await tick();
    expect(replyTo(a.lines, 93).result).toEqual({});
    expect(await parked).toEqual({ content: [{ type: "text", text: "ok" }], isError: false });
  });
});

describe("M7 the whole exchange, keyless, through the production closure", () => {
  it("declare → the engine's own server calls a tool → the wire answers it → CallTool resolves", async () => {
    // THE MILESTONE, END TO END, with nothing faked but the engine: the MCP server object under test is
    // the one `thread/start` handed the factory, its park is the REAL production closure
    // (`withDynamicServers` binding `srv.parkToolCall`), and the settlement travels the real dispatch.
    const { srv, configs, a, start } = await bootWire();
    const threadId = (await start({ dynamicTools: codexShaped() })).result.thread.id as string;
    send(a.conn, { id: 200, method: "thread/subscribe", params: { threadId } });
    send(a.conn, { id: 201, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const turnId = srv.registry.get(threadId)!.currentTurnId!;
    a.lines.length = 0;

    const client = await connect(opsInstance(configs[0]!));
    const call = client.callTool({ name: "lookup", arguments: { q: "who" } });
    await vi.waitFor(() => expect(notes(a.lines, "tool/callRequested")).toHaveLength(1));

    const request = notes(a.lines, "tool/callRequested")[0].params;
    expect(request).toEqual({ threadId, callId: request.callId, turnId, namespace: "ops", tool: "lookup", arguments: { q: "who" } });
    expect(request.callId).toMatch(CALL_ID);
    // The thread SAYS it is waiting on this call — the same wire, the same moment.
    expect(lastStatus(a.lines)).toEqual({ state: "active", waitingOn: "toolCall" });

    send(a.conn, { id: 202, method: "tool/callResult", params: { threadId, callId: request.callId, contentItems: [{ type: "inputText", text: "42" }], success: true } });
    await tick();
    expect(replyTo(a.lines, 202).result).toEqual({});
    await expect(call).resolves.toMatchObject({ content: [{ type: "text", text: "42" }], isError: false });
  });
});

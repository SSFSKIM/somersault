// test/unit/appserver/lifecycle2.test.ts — Task 11: compact-as-turn + thread/reinitialize (spec Wave 2:
// "compaction is a turn, not a side call"). Copies Task 6's mkSink/send/parsed/bootThread helpers
// (test/unit/appserver/turns.test.ts) so this file reads standalone. `lifecycle.test.ts` already owns
// close/shutdown — this file is the compact/reinitialize half.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

/** boots a server, initializes one connection, starts one thread, and subscribes that connection to it —
 *  mirrors turns.test.ts's bootThread so both files agree on setup. */
async function bootThread(sessionFactory: () => any) {
  const srv = new AppServer({}, { sessionFactory });
  const s = mkSink(); const c = srv.connect(s.sink);
  init(c, 1);
  send(c, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(s.lines).find((f) => f.id === 2).result.thread.id;
  send(c, { id: 99, method: "thread/subscribe", params: { threadId } });
  await tick();
  s.lines.length = 0;
  return { srv, s, c, threadId };
}

describe("appserver compact-as-turn (Task 11)", () => {
  it("thread/compact/start claims the turn machinery: busy-gates a concurrent turn/start (-33001), broadcasts turn/started/turn/completed, and thread/compacted is observed for a compact_boundary frame arriving mid-compact", async () => {
    let resolveCompact!: (v: unknown) => void;
    const cbs = new Set<(m: unknown) => void>();
    const sessionFactory = () => ({
      submit: async () => ({ result: {} }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: (cb: (m: unknown) => void) => { cbs.add(cb); return () => cbs.delete(cb); },
      // engine-faithful: compact() is a genuine turn whose completion we control, same shape as submit()
      // in the other turn tests — we resolve it only after asserting the busy-during-compact behavior.
      compact: () => new Promise((resolve) => { resolveCompact = resolve; }),
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "thread/compact/start", params: { threadId } });
    await tick();

    const compactStartReply = parsed(s.lines).find((f) => f.id === 3);
    expect(compactStartReply.result.turn.status).toBe("inProgress");
    const turnId = compactStartReply.result.turn.id;
    // Turn ids are minted in exactly one function (turns.ts's mintTurnId, beginTurn's only caller) — a
    // compact turn's id must be in the SAME format turn/start produces, not a bespoke compact-only scheme.
    expect(turnId).toBe(`turn_${threadId}_1`);
    expect(parsed(s.lines).find((f) => f.method === "turn/started")).toBeTruthy();

    // busy during compact — a concurrent turn/start is refused exactly as it would be during a turn
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "x" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).error.code).toBe(ERR.BUSY);

    // a compact_boundary frame arrives mid-compact — frames arriving between turns, engine-faithful — and
    // the router's existing compact_boundary route reports it, not the handler itself
    const boundaryFrame = { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual" } };
    for (const cb of [...cbs]) cb(boundaryFrame);
    await tick();
    const compacted = parsed(s.lines).find((f) => f.method === "thread/compacted");
    expect(compacted.params).toEqual({ threadId, turnId, outcome: boundaryFrame });

    // compact() resolves — the turn completes like any other
    resolveCompact({ ok: true });
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: turnId, status: "completed" });

    // busy is cleared afterward — a subsequent turn/start is accepted, not -33001
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "y" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 5).result.turn.status).toBe("inProgress");
  });

  it("a turn/start already in flight busy-gates a concurrent thread/compact/start the same way (-33001) — the gate is symmetric", async () => {
    const sessionFactory = () => ({
      submit: () => new Promise(() => {}), // never resolves — turn stays in flight
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      compact: async () => ({}),
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    send(c, { id: 4, method: "thread/compact/start", params: { threadId } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).error.code).toBe(ERR.BUSY);
  });

  it("thread/compact/start on an unknown thread is -33004; missing threadId is -32602", async () => {
    const srv = new AppServer({}, { sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, compact: async () => ({}), sessionId: "sess-1" }) });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/compact/start", params: { threadId: "thr_missing0000" } });
    send(c, { id: 3, method: "thread/compact/start", params: {} });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 2).error.code).toBe(ERR.THREAD_NOT_FOUND);
    expect(parsed(s.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("a rejecting compact() completes the turn as failed and clears busy — a rejecting compaction must not strand the thread busy forever", async () => {
    let rejectCompact!: (e: unknown) => void;
    const sessionFactory = () => ({
      submit: async () => ({ result: {} }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      compact: () => new Promise((_resolve, reject) => { rejectCompact = reject; }),
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "thread/compact/start", params: { threadId } });
    await tick();
    const turnId = parsed(s.lines).find((f) => f.id === 3).result.turn.id;

    rejectCompact(new Error("compact boom"));
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: turnId, status: "failed", error: expect.stringMatching(/compact boom/) });

    // busy is cleared — a subsequent turn/start is accepted, not -33001; the thread is not stranded busy
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).result.turn.status).toBe("inProgress");
  });
});

describe("appserver thread/reinitialize (Task 11)", () => {
  it("calls the engine's reinitialize(), replies with its fresh payload under `init`, and pings thread/capabilities/changed so clients re-read", async () => {
    let called = 0;
    const payload = { models: ["opus"], commands: ["/compact"], mcpServers: [] };
    const sessionFactory = () => ({
      submit: async () => ({ result: {} }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      reinitialize: async () => { called++; return payload; },
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "thread/reinitialize", params: { threadId } });
    await tick();

    expect(called).toBe(1);
    const reply = parsed(s.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ init: payload });
    const ping = parsed(s.lines).find((f) => f.method === "thread/capabilities/changed");
    expect(ping.params).toEqual({ threadId });
  });

  it("thread/reinitialize on an unknown thread is -33004", async () => {
    const srv = new AppServer({}, { sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" }) });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/reinitialize", params: { threadId: "thr_missing0000" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 2).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("thread/reinitialize is refused with the busy code while a turn is in flight, and the engine's reinitialize() is never called — reinitializing concurrently with a live submit() is not safe", async () => {
    let resolveSubmit!: (r: { result: unknown }) => void;
    let reinitCalled = 0;
    const sessionFactory = () => ({
      submit: () => new Promise<{ result: unknown }>((resolve) => { resolveSubmit = resolve; }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      reinitialize: async () => { reinitCalled++; return {}; },
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); // the turn's chain callback runs and calls submit(), which parks on resolveSubmit

    send(c, { id: 4, method: "thread/reinitialize", params: { threadId } });
    await tick();
    const reply = parsed(s.lines).find((f) => f.id === 4);
    expect(reply.error.code).toBe(ERR.BUSY);
    expect(reinitCalled).toBe(0);

    // the turn finishing afterward clears busy — a subsequent reinitialize is then accepted
    resolveSubmit({ result: {} });
    await tick();
    send(c, { id: 5, method: "thread/reinitialize", params: { threadId } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 5).result).toEqual({ init: {} });
    expect(reinitCalled).toBe(1);
  });

  it("a rejecting reinitialize() replies -32603 and does not ping capabilities/changed", async () => {
    const sessionFactory = () => ({
      submit: async () => ({ result: {} }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      reinitialize: async () => { throw new Error("boom"); },
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "thread/reinitialize", params: { threadId } });
    await tick();
    const reply = parsed(s.lines).find((f) => f.id === 3);
    expect(reply.error.message).toMatch(/boom/);
    expect(parsed(s.lines).some((f) => f.method === "thread/capabilities/changed")).toBe(false);
  });
});

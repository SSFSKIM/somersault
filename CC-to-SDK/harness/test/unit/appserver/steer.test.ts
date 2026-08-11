// test/unit/appserver/steer.test.ts — M2b Task 5: `turn/steer` (X), promoted from probe 103b (ALIVE).
// Driven through the full AppServer RPC surface like the rest of the M2b cluster tests, so the
// request-arrival eligibility split is proven against real dispatch.
//
// `turn/steer` inverts the busy convention: it is the one method that REQUIRES a turn in flight, and
// requires that the reason the thread is busy is a TURN. The three refusals it therefore owes are all
// exercised below — idle (-32602 "no turn in flight"), closing/swapping (-33001, the standard busy
// refusal), and an engine with no `steer` (-32601).
//
// Engine-faithful fake: `submit()` stays pending until the test releases it, so a turn is genuinely in
// flight across ticks; `steer()` is SYNCHRONOUS and returns void (the lib seam pushes onto the live input
// queue — there is nothing to await), and it does NOT settle the submit, because a steered turn keeps
// running and completes on its own.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });
const replyTo = (s: { lines: string[] }, id: number) => parsed(s.lines).find((f) => f.id === id);
const notifs = (s: { lines: string[] }, method: string) => parsed(s.lines).filter((f) => !("id" in f) && f.method === method);

interface SteerEngine {
  submits: string[];
  steers: string[];
  ended: boolean;
  sessionId?: string;
  release(): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  setModel(model?: string): Promise<void>;
  isEnded(): boolean;
  onFrame(cb: (m: unknown) => void): () => void;
  steer?(text: string): void;
}

/** `withSteer:false` drops the optional member entirely — the -32601 fixture. `setModelImpl` is the
 *  hand-held chain gate the un-chained assertion needs. */
function mkEngine(opts: { withSteer?: boolean; setModelImpl?: () => Promise<void>; steerImpl?: (text: string) => void } = {}): SteerEngine {
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const e: SteerEngine = {
    submits: [], steers: [], ended: false, sessionId: "sess-1",
    submit: (prompt) => {
      if (e.ended) return Promise.reject(new Error("session is not running"));
      e.submits.push(prompt);
      return new Promise<{ result: unknown }>((resolve, reject) => { pending.push({ resolve: () => resolve({ result: {} }), reject }); });
    },
    interrupt: async () => { e.release(); return {}; },
    dispose: () => { e.ended = true; for (const p of pending.splice(0)) p.reject(new Error("session disposed")); return Promise.resolve(); },
    setModel: async () => { await opts.setModelImpl?.(); },
    isEnded: () => e.ended,
    onFrame: () => () => {},
    release: () => { pending.shift()?.resolve(); },
  };
  if (opts.withSteer !== false) {
    e.steer = (text: string) => { e.steers.push(text); opts.steerImpl?.(text); };
  }
  return e;
}

async function boot(engine: SteerEngine) {
  const srv = new AppServer({}, { sessionFactory: () => engine as never });
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

/** Puts one turn genuinely in flight (the only state a steer is legal in) and clears the lines. */
async function withTurnInFlight(engine: SteerEngine) {
  const boot0 = await boot(engine);
  send(boot0.c, { id: 3, method: "turn/start", params: { threadId: boot0.threadId, input: "count to 30" } });
  await tick();
  boot0.s.lines.length = 0;
  return boot0;
}

describe("turn/steer (X) — busy-REQUIRED, and only for a TURN", () => {
  it("steers the running turn: the text reaches the engine and the reply is {ok:true}", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop counting" } });
    await tick();

    expect(engine.steers).toEqual(["stop counting"]);
    expect(replyTo(s, 4).result).toEqual({ ok: true });
  });

  it("does NOT settle the turn: the steered turn still completes on its own, once", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop counting" } });
    await tick();
    expect(notifs(s, "turn/completed")).toEqual([]);   // a steer is not a turn edge

    engine.release();
    await settle();
    expect(notifs(s, "turn/completed").map((f) => f.params.turn.status)).toEqual(["completed"]);
  });

  it("an IDLE thread answers -32602 'no turn in flight' — the busy convention inverted", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "hello" } });
    await tick();

    const reply = replyTo(s, 4);
    expect(reply.error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply.error.message).toBe("no turn in flight");
    expect(engine.steers).toEqual([]); // refused BEFORE the engine was touched
  });

  it("a CLOSING thread answers the standard -33001 busy refusal, naming the reason — not 'no turn in flight'", async () => {
    // A closing thread is going away: the client must be able to tell "retry in a moment" from that, which
    // is precisely what the -32602/-33001 split carries. threadBusyReason ranks `closing` above `turn`, so
    // this holds even though a turn is genuinely in flight.
    const engine = mkEngine();
    const { srv, s, c, threadId } = await withTurnInFlight(engine);
    srv.registry.get(threadId)!.closing = true;

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();

    const reply = replyTo(s, 4);
    expect(reply.error.code).toBe(ERR.BUSY);
    expect(reply.error.message).toBe("Thread is busy (closing)");
    expect(engine.steers).toEqual([]);
  });

  it("a SWAPPING thread answers -33001 too — the replacement engine has no turn to steer", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await withTurnInFlight(engine);
    srv.registry.get(threadId)!.swapInFlight = true;

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();

    const reply = replyTo(s, 4);
    expect(reply.error.code).toBe(ERR.BUSY);
    expect(reply.error.message).toBe("Thread is busy (swapping)");
    expect(engine.steers).toEqual([]);
  });

  it("an engine with no steer member answers -32601 'unsupported by this engine' — never a false {ok:true}", async () => {
    const engine = mkEngine({ withSteer: false });
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();

    const reply = replyTo(s, 4);
    expect(reply.error.code).toBe(ERR.METHOD_NOT_FOUND);
    expect(reply.error.message).toBe("unsupported by this engine");
    expect(reply.result).toBeUndefined();
  });

  it("an unknown threadId answers -33004, and a missing input answers -32602 'Invalid params'", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId: "thr_nope", input: "x" } });
    send(c, { id: 5, method: "turn/steer", params: { threadId } });
    await tick();

    expect(replyTo(s, 4).error.code).toBe(ERR.THREAD_NOT_FOUND);
    expect(replyTo(s, 5).error.code).toBe(ERR.INVALID_PARAMS);
    expect(replyTo(s, 5).error.message).toBe("Invalid params");
    expect(engine.steers).toEqual([]);
  });

  it("a dead engine answers -33005 through dispatch's arrival gate — turn/steer is NOT exempt", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await withTurnInFlight(engine);
    engine.ended = true;

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();

    expect(replyTo(s, 4).error.code).toBe(ERR.ENGINE_GONE);
    expect(engine.steers).toEqual([]);
  });

  it("is UN-chained: a steer lands while a slow chain-scoped op still holds the chain", async () => {
    // The deliberate divergence from the mutation convention. A steer must reach a turn that is RUNNING
    // RIGHT NOW; parking it behind a chain item would deliver it after the turn it was aimed at is over.
    let release!: () => void;
    const engine = mkEngine({ setModelImpl: () => new Promise<void>((r) => { release = r; }) });
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "thread/model/set", params: { threadId, model: "opus" } });
    send(c, { id: 5, method: "turn/steer", params: { threadId, input: "stop counting" } });
    await tick();

    expect(replyTo(s, 4)).toBeUndefined();            // still parked on the chain
    expect(engine.steers).toEqual(["stop counting"]); // the steer went straight through
    expect(replyTo(s, 5).result).toEqual({ ok: true });
    release();
    await settle();
  });

  it("emits no notification of its own — the steered turn's own frames are the only report", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await withTurnInFlight(engine);

    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();

    expect(parsed(s.lines).filter((f) => f.method !== undefined)).toEqual([]);
  });

  it("bumps record.updatedAt on success but not on a refusal — the timestamp tracks work the engine took", async () => {
    const engine = mkEngine();
    const { srv, c, threadId } = await withTurnInFlight(engine);
    const record = srv.registry.get(threadId)!;

    record.updatedAt = 0;
    send(c, { id: 4, method: "turn/steer", params: { threadId, input: "stop" } });
    await tick();
    expect(record.updatedAt).toBeGreaterThan(0);

    engine.release();
    await settle();
    record.updatedAt = 0;
    send(c, { id: 5, method: "turn/steer", params: { threadId, input: "too late" } }); // now idle
    await tick();
    expect(record.updatedAt).toBe(0);
  });
});

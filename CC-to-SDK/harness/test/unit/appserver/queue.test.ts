// test/unit/appserver/queue.test.ts — M2b Task 4: the server-side turn queue and its closing latch,
// driven through the full AppServer RPC surface (turns.test.ts / rewind.test.ts do the same) so the
// synchronous linearization points — enqueue inside turn/start's busy check, flush inside thread/close's
// and shutdown()'s request-arrival section, drain inside settleTurn — are proven against real dispatch
// rather than against the queue module in isolation.
//
// Engine-faithful fake: `submit()` returns a promise that resolves only when the test RELEASES it, so a
// turn stays genuinely in flight across ticks (the whole queue exists for that window), and `interrupt()`
// RESOLVES the in-flight submit rather than rejecting it — the real engine's contract (session.ts's
// readLoop discards error_during_execution and resolves the waiter; turns.ts's header records it).
// `dispose()` awaits a real timer, as the real `input.close(); await this.done` does.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { AppServerDeps } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
/** A drain crosses several boundaries (submit's resolve, settleTurn, beginTurn's chain callback), and a
 *  close crosses an awaiting dispose on top — one tick does not drain them, so every post-action
 *  assertion waits on this. */
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

interface QueueEngine {
  submits: string[];
  interrupts: number;
  disposed: number;
  sessionId?: string;
  release(): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
}

function mkEngine(opts: { disposeImpl?: () => Promise<void> } = {}): QueueEngine {
  const releases: Array<() => void> = [];
  const e: QueueEngine = {
    submits: [],
    interrupts: 0,
    disposed: 0,
    sessionId: "sess-1",
    submit: (prompt) => { e.submits.push(prompt); return new Promise<{ result: unknown }>((resolve) => { releases.push(() => resolve({ result: {} })); }); },
    interrupt: async () => { e.interrupts++; e.release(); return {}; },
    dispose: () => { e.disposed++; return opts.disposeImpl ? opts.disposeImpl() : new Promise<void>((r) => setTimeout(r, 1)); },
    onFrame: () => () => {},
    /** resolve the OLDEST still-pending submit — one engine turn finishing */
    release: () => { releases.shift()?.(); },
  };
  return e;
}

/** boots a server on one engine, initializes a connection, starts a thread and subscribes to it (queue
 *  cancellations are thread-scoped broadcasts, so a subscriber is required to observe them). */
async function boot(engine: QueueEngine, deps: AppServerDeps = {}) {
  const srv = new AppServer({}, { sessionFactory: () => engine as never, ...deps });
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

const replyTo = (s: { lines: string[] }, id: number) => parsed(s.lines).find((f) => f.id === id);
const notifs = (s: { lines: string[] }, method: string) => parsed(s.lines).filter((f) => !("id" in f) && f.method === method);
const cancelledIds = (s: { lines: string[] }) => notifs(s, "turn/completed").filter((f) => f.params.turn.status === "cancelled").map((f) => f.params.turn.id);

describe("turn queue (spec Wave 4)", () => {
  it("turn/start{queue:true} on a busy thread replies {queued, turn.id, position} with a pre-minted id, and starts no engine call", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();

    // The id is minted AT ENQUEUE, off the same counter turn/start uses — the enqueue reply, any cancel
    // receipt and the eventual turn/started all have to carry one correlatable id.
    expect(replyTo(s, 4).result).toEqual({ queued: true, turn: { id: `turn_${threadId}_2`, status: "queued" }, position: 1 });
    expect(engine.submits).toEqual(["one"]);
  });

  it("without the flag a busy thread still answers -33001", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two" } });
    await tick();
    expect(replyTo(s, 4).error.code).toBe(ERR.BUSY);
    expect(engine.submits).toEqual(["one"]);
  });

  it("drain starts the queued turn after settle: its turn/started carries the ENQUEUE-time id", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    const queuedId = replyTo(s, 4).result.turn.id;

    engine.release();
    await settle();

    expect(engine.submits).toEqual(["one", "two"]);
    const started = notifs(s, "turn/started").map((f) => f.params.turn.id);
    expect(started).toEqual([`turn_${threadId}_1`, queuedId]);
    // no id was re-minted for the drained turn: the counter did not skip
    expect(queuedId).toBe(`turn_${threadId}_2`);
  });

  it("FIFO: two queued turns drain in order, one at a time", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();
    expect(replyTo(s, 4).result.position).toBe(1);
    expect(replyTo(s, 5).result.position).toBe(2);

    engine.release();
    await settle();
    expect(engine.submits).toEqual(["one", "two"]); // one at a time — "three" waits its turn

    engine.release();
    await settle();
    expect(engine.submits).toEqual(["one", "two", "three"]);
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([
      `turn_${threadId}_1`, `turn_${threadId}_2`, `turn_${threadId}_3`,
    ]);
  });

  it("interrupt{cancelQueued:true} flushes first: the receipt lists the ids, each got turn/completed cancelled, and no queued turn drains behind the interrupt", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();

    send(c, { id: 6, method: "turn/interrupt", params: { threadId, cancelQueued: true } });
    await settle();

    expect(replyTo(s, 6).result).toEqual({ interrupted: true, cancelledQueued: [`turn_${threadId}_2`, `turn_${threadId}_3`] });
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`, `turn_${threadId}_3`]);
    expect(engine.interrupts).toBe(1);
    // Stop-means-stop-everything: the flush ran BEFORE the interrupt, so the settle the interrupt provokes
    // finds an empty queue and starts nothing.
    expect(engine.submits).toEqual(["one"]);
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn.status).toBe("interrupted");
  });

  it("thread/close cancels queued turns synchronously and no engine call starts after close", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();

    // Both frames in ONE tick: the close latches + flushes at request arrival, and the enqueue that lands
    // behind it in the same tick must be refused — its queue was already flushed, so an admitted entry
    // would either sit forever or (worse) drain into an engine call after close.
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    send(c, { id: 6, method: "turn/start", params: { threadId, input: "late", queue: true } });
    await settle();
    engine.release(); // the first turn's engine call finally returns, after the close
    await settle();

    expect(engine.submits).toEqual(["one"]); // the drained turn NEVER submitted
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`]);
    expect(replyTo(s, 6).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 5).result).toEqual({ ok: true });
  });

  it("the drain-vs-close race: a settle racing a close finds the latch up and starts nothing — and parks the entry rather than dropping it", async () => {
    // The one state the drain's own latch check exists for: `closing` is up while the queue is not yet
    // empty. Raised here exactly as thread/close raises it (a synchronous write at request arrival),
    // caught in the window before the flush — the interleaving where the drain is the only thing standing
    // between a closing thread and a fresh engine call. Nothing may be started, and nothing may be
    // silently swallowed either: the entry stays queued for the flush that follows.
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    const record = srv.registry.get(threadId)!;

    record.closing = true;
    engine.release();
    await settle();

    expect(engine.submits).toEqual(["one"]);
    expect(record.queue.map((q) => q.id)).toEqual([`turn_${threadId}_2`]); // parked, never silently dropped
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([`turn_${threadId}_1`]);

    // and the close that follows is what cancels it — the queued turn is answered, not abandoned
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    await settle();
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`]);
  });

  it("interrupt naming a QUEUED turn's id removes that entry and completes it cancelled, without touching the engine", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    const queuedId = replyTo(s, 4).result.turn.id;

    send(c, { id: 5, method: "turn/interrupt", params: { threadId, turnId: queuedId } });
    await settle();

    expect(replyTo(s, 5).result).toEqual({ interrupted: false, cancelled: [queuedId] });
    expect(cancelledIds(s)).toEqual([queuedId]);
    expect(engine.interrupts).toBe(0); // a queued turn has no engine work to interrupt
    expect(srv.registry.get(threadId)!.queue).toEqual([]);

    // the RUNNING turn is untouched — it completes normally
    engine.release();
    await settle();
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn.status).toBe("completed");
    expect(engine.submits).toEqual(["one"]);
  });

  it("interrupt naming an unknown id still interrupts the running turn (unchanged behavior)", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();

    send(c, { id: 4, method: "turn/interrupt", params: { threadId, turnId: "turn_nope_7" } });
    await settle();

    expect(replyTo(s, 4).result).toEqual({ interrupted: true });
    expect(engine.interrupts).toBe(1);
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn.status).toBe("interrupted");
  });

  it("shutdown cancels queued turns on every record", async () => {
    const engines = [mkEngine(), mkEngine()];
    let n = 0;
    const srv = new AppServer({}, { sessionFactory: () => engines[n++] as never });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "thread/start", params: {} });
    send(c, { id: 3, method: "thread/start", params: {} });
    await tick();
    const ids = [2, 3].map((i) => parsed(s.lines).find((f) => f.id === i).result.thread.id);
    for (const [i, threadId] of ids.entries()) send(c, { id: 10 + i, method: "thread/subscribe", params: { threadId } });
    await tick();
    s.lines.length = 0;
    for (const [i, threadId] of ids.entries()) send(c, { id: 20 + i, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    for (const [i, threadId] of ids.entries()) send(c, { id: 30 + i, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    expect(ids.map((t) => replyTo(s, 30 + ids.indexOf(t)).result.queued)).toEqual([true, true]);

    await srv.shutdown();
    await settle();

    expect(cancelledIds(s).sort()).toEqual(ids.map((t) => `turn_${t}_2`).sort());
    // and the in-flight turns settling AFTER the shutdown start nothing on either engine
    for (const e of engines) e.release();
    await settle();
    expect(engines.map((e) => e.submits)).toEqual([["one"], ["one"]]);
  });

  it("a CLOSING thread refuses turn/start{queue:true} exactly as it refuses the unflagged call — its queue was already flushed, so a late enqueue would sit forever", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "thread/close", params: { threadId } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "late", queue: true } });
    const record = srv.registry.get(threadId)!;
    expect(record.queue).toEqual([]);
    await settle();
    expect(replyTo(s, 5).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 5).error.message).toMatch(/closing/);
  });

  it("a SWAPPING thread refuses turn/start{queue:true} too — a swap never calls settleTurn, so an enqueue there would strand", async () => {
    // Hung swap, engine-faithful: the outgoing engine's dispose() never resolves, so swapInFlight stays up.
    const engine = mkEngine({ disposeImpl: () => new Promise<void>(() => {}) });
    const { srv, s, c, threadId } = await boot(engine, { resumeAtFactory: () => mkEngine() as never });
    send(c, { id: 3, method: "thread/rewind", params: { threadId, uuid: "u1", prevUuid: "u0", scope: "conversation" } });
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "later", queue: true } });
    const record = srv.registry.get(threadId)!;
    expect(record.queue).toEqual([]);
    await settle();
    expect(replyTo(s, 4).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 4).error.message).toMatch(/swapping/);
  });
});

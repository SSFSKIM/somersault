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
// `dispose()` is `input.close(); await this.done` (session.ts:164): the read loop ends and its `finally`
// REJECTS every still-pending waiter, so a close settles the in-flight turn by itself — and `submit()`
// after that rejects immediately rather than parking a waiter nothing can drain (session.ts:124). The
// close tests below rely on exactly that: no test hand-releases a turn the close already ended.
import { describe, it, expect } from "vitest";
import { AppServer, threadView } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { enqueueTurn, queuedInputBytes, MAX_QUEUED_BYTES, MAX_QUEUED_ENTRY_BYTES, MAX_QUEUED_TURNS } from "../../../src/appserver/queue.js";
import type { AppServerDeps } from "../../../src/appserver/server.js";
import type { ThreadRecord } from "../../../src/appserver/registry.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { UserTurnInput } from "../../../src/session/turnInput.js";
import { triple } from "../boundaryTriple.js";

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
  ended: boolean;
  models: Array<string | undefined>;
  sessionId?: string;
  release(): void;
  abort(): void;
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  setModel(model?: string): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
}

/** A promise the test releases by hand — used to hold a chain-scoped settings op on "engine I/O" for as
 *  long as the interleaving under test needs. */
function mkGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  return { wait: new Promise<void>((r) => { release = r; }), release };
}

function mkEngine(opts: {
  disposeImpl?: () => Promise<void>;
  setModelImpl?: () => Promise<void>;
  /** The other engine build's interrupt contract: `submit()` REJECTS on abort instead of resolving. The
   *  shipped Session resolves (file header), but nothing in the wire contract requires it, and the two
   *  land on different callbacks inside beginTurn — so the abort must report identically either way. */
  interruptRejects?: boolean;
} = {}): QueueEngine {
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const e: QueueEngine = {
    submits: [],
    interrupts: 0,
    disposed: 0,
    ended: false,
    models: [],
    sessionId: "sess-1",
    // session.ts:124 — once the read loop has ended, submit() rejects rather than parking a waiter that
    // nothing will ever drain. A test asserting "no engine call after close" gets to assert on `submits`
    // because THIS is what a real post-close submit would do.
    submit: (prompt) => {
      if (e.ended) return Promise.reject(new Error("session is not running"));
      e.submits.push(prompt);
      return new Promise<{ result: unknown }>((resolve, reject) => { pending.push({ resolve: () => resolve({ result: {} }), reject }); });
    },
    interrupt: async () => { e.interrupts++; if (opts.interruptRejects) e.abort(); else e.release(); return {}; },
    // The real `input.close(); await this.done`: the read loop's `finally` rejects every still-pending
    // waiter ("<label> disposed") before dispose resolves, so the close drives the in-flight turn's
    // settle-and-drain itself.
    dispose: () => {
      e.disposed++; e.ended = true;
      for (const p of pending.splice(0)) p.reject(new Error("session disposed"));
      return opts.disposeImpl ? opts.disposeImpl() : new Promise<void>((r) => setTimeout(r, 1));
    },
    setModel: async (model) => { await opts.setModelImpl?.(); e.models.push(model); },
    onFrame: () => () => {},
    /** resolve the OLDEST still-pending submit — one engine turn finishing */
    release: () => { pending.shift()?.resolve(); },
    /** reject it instead — the `interruptRejects` build's abort */
    abort: () => { pending.shift()?.reject(new Error("turn aborted")); },
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

    expect(engine.submits).toEqual(["one"]); // the drained turn NEVER submitted
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`]);
    expect(replyTo(s, 6).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 5).result).toEqual({ ok: true });
    // the close settled the in-flight turn on its own — dispose() rejects the pending waiter, exactly as
    // the real read loop's `finally` does, so the running turn is answered too and nothing is left in flight
    expect(engine.disposed).toBe(1);
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn.status).toBe("failed");
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

  it("an interrupted turn whose submit REJECTS still reports `interrupted` when a queued turn drains in the same step", async () => {
    // The drain is SYNCHRONOUS inside settleTurn and re-enters beginTurn, which clears
    // `interruptRequested` — so the abort's status must be snapshotted before the settle, not read after
    // it (external review 2026-08-11). With one turn queued, reading it late reported `failed` + an error
    // tag for a turn the client itself stopped.
    const engine = mkEngine({ interruptRejects: true });
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    const queuedId = replyTo(s, 4).result.turn.id;

    send(c, { id: 5, method: "turn/interrupt", params: { threadId } });
    await settle();

    // exact object: an `error` tag on a turn the client aborted is the other half of the misreport
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn)
      .toEqual({ id: `turn_${threadId}_1`, status: "interrupted" });
    // and the queue behind it still drained, under the id it was given at enqueue
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([`turn_${threadId}_1`, queuedId]);
    expect(engine.submits).toEqual(["one", "two"]);
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
    // the shutdown's dispose settled each in-flight turn (the read loop's `finally`), and that settle —
    // landing after the latch went up — starts nothing on either engine
    expect(engines.map((e) => e.submits)).toEqual([["one"], ["one"]]);
    expect(engines.map((e) => e.disposed)).toEqual([1, 1]);
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

  // The wire-reachable half of the closing latch (fix wave, reviewer-reproduced). `takeNext`'s check is
  // taken at DRAIN time, but a turn's engine call is deferred into `record.chain` — and the chain can be
  // parked on a settings op awaiting real engine I/O. `thread/close` latches and flushes underneath that
  // park, so the callback wakes up owning a thread that is already being torn down. Both entry points into
  // that callback are covered: the drained turn (id already on the wire) and a plain turn/start (its reply
  // still owed). Without the callback's own re-read, both submit to a closing engine and their terminal
  // event is broadcast after closeRecord dropped the record — i.e. never heard by anyone.
  it("a DRAINED turn whose chain callback wakes AFTER thread/close submits nothing — it settles cancelled instead", async () => {
    const gate = mkGate();
    const engine = mkEngine({ setModelImpl: () => gate.wait });
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();
    const queuedId = replyTo(s, 4).result.turn.id;
    // a chain-scoped settings op parked on engine I/O — everything queued behind it waits with it
    send(c, { id: 5, method: "thread/model/set", params: { threadId, model: "opus" } });
    await tick();

    engine.release(); // turn 1 settles -> the drain claims the thread for turn 2, behind the parked setter
    await settle();
    expect(engine.submits).toEqual(["one"]);

    send(c, { id: 6, method: "thread/close", params: { threadId } }); // latch + flush, synchronously
    await settle();
    gate.release(); // the setter answers; the drained turn's callback finally runs
    await settle();

    expect(engine.submits).toEqual(["one"]); // zero new submits after the close
    expect(cancelledIds(s)).toEqual([queuedId]); // the claimed id still got its terminal event
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([`turn_${threadId}_1`]);
    expect(replyTo(s, 6).result).toEqual({ ok: true });
  });

  it("a PLAIN turn/start whose chain callback wakes AFTER thread/close submits nothing — its caller is replied the cancelled turn", async () => {
    const gate = mkGate();
    const engine = mkEngine({ setModelImpl: () => gate.wait });
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "thread/model/set", params: { threadId, model: "opus" } });
    await tick();
    engine.release(); // turn 1 completes — the thread is idle, so the next turn/start is accepted outright
    await settle();

    send(c, { id: 5, method: "turn/start", params: { threadId, input: "two" } });
    await settle();
    expect(engine.submits).toEqual(["one"]);
    expect(replyTo(s, 5)).toBeUndefined(); // a plain turn/start's reply comes FROM the parked callback

    send(c, { id: 6, method: "thread/close", params: { threadId } });
    await settle();
    gate.release();
    await settle();

    expect(engine.submits).toEqual(["one"]);
    // Answered on the enqueue path's contract — the turn OBJECT carrying its terminal status, not an
    // error: the reply is where a plain turn/start learns its id, and without it the broadcast below names
    // a turn the caller cannot correlate.
    expect(replyTo(s, 5).result).toEqual({ turn: { id: `turn_${threadId}_2`, status: "cancelled" } });
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`]);
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([`turn_${threadId}_1`]);
    expect(replyTo(s, 6).result).toEqual({ ok: true });
  });

  // The interrupt half of the same re-read. Same park, different stopper: nothing is closing here, so the
  // callback's OTHER term is the only thing standing between a client's abort and an engine call it
  // already asked not to happen. A plain interrupt stops ONE turn, not the queue — so the entry behind the
  // stopped one must still drain, which is what separates this from the closing case.
  it("a DRAINED turn parked behind a chain item is settled 'interrupted' by a plain turn/interrupt — it never submits, and the queue behind it still drains", async () => {
    const gate = mkGate();
    const engine = mkEngine({ setModelImpl: () => gate.wait });
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();
    const drainedId = replyTo(s, 4).result.turn.id;
    send(c, { id: 6, method: "thread/model/set", params: { threadId, model: "opus" } }); // parks on engine I/O
    await tick();

    engine.release(); // turn 1 settles -> "two" is drained and claims the thread, behind the parked setter
    await settle();
    expect(engine.submits).toEqual(["one"]);

    send(c, { id: 7, method: "turn/interrupt", params: { threadId } });
    await settle();
    gate.release(); // the setter answers; the drained turn's callback finally runs
    await settle();

    expect(engine.submits).toEqual(["one", "three"]); // "two" never reached the engine; "three" drained normally
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === drainedId).params.turn)
      .toEqual({ id: drainedId, status: "interrupted" });
    // and no turn/started was ever emitted for it — a turn that never ran is not announced as running
    expect(notifs(s, "turn/started").map((f) => f.params.turn.id)).toEqual([`turn_${threadId}_1`, `turn_${threadId}_3`]);
    expect(replyTo(s, 7).result).toEqual({ interrupted: true });
  });

  it("interrupt with BOTH turnId and cancelQueued flushes FIRST: the named entry reports cancelled and the whole flush rides along", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();
    const named = replyTo(s, 4).result.turn.id;

    send(c, { id: 6, method: "turn/interrupt", params: { threadId, turnId: named, cancelQueued: true } });
    await settle();

    expect(replyTo(s, 6).result).toEqual({ interrupted: false, cancelled: [named], cancelledQueued: [`turn_${threadId}_2`, `turn_${threadId}_3`] });
    expect(cancelledIds(s)).toEqual([`turn_${threadId}_2`, `turn_${threadId}_3`]); // the flush is NOT skipped by the by-id arm
    expect(engine.interrupts).toBe(0); // naming a queued turn still never touches the engine
    expect(srv.registry.get(threadId)!.queue).toEqual([]);
  });

  it("interrupt with cancelQueued and a turnId that is NOT queued interrupts the running turn and still reports the flush", async () => {
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();

    // the RUNNING turn's own id — not in the queue, so it falls through to the engine interrupt
    send(c, { id: 5, method: "turn/interrupt", params: { threadId, turnId: `turn_${threadId}_1`, cancelQueued: true } });
    await settle();

    expect(replyTo(s, 5).result).toEqual({ interrupted: true, cancelledQueued: [`turn_${threadId}_2`] });
    expect(engine.interrupts).toBe(1);
    expect(notifs(s, "turn/completed").find((f) => f.params.turn.id === `turn_${threadId}_1`).params.turn.status).toBe("interrupted");
  });

  // --- queue VISIBILITY (Task 8, chartered by the Task 4 review adjudication 2026-08-11) ------------
  // Before this, a queued turn existed only in the enqueue reply — a private answer to one caller. Every
  // other subscriber's first news of that id was a `turn/started` or a `turn/completed {cancelled}` for a
  // turn it had never seen begin.
  it("enqueue broadcasts turn/queued to the thread's subscribers — the enqueuer's own connection included, once each, AFTER the private reply", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    const s2 = mkSink(); const c2 = srv.connect(s2.sink);
    init(c2, 1, "B");
    send(c2, { id: 2, method: "thread/subscribe", params: { threadId } });
    await tick();
    s2.lines.length = 0;

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    await tick();

    const queuedId = replyTo(s, 4).result.turn.id;
    const expected = { threadId, turn: { id: queuedId, status: "queued" }, position: 1 };
    expect(notifs(s2, "turn/queued").map((f) => f.params)).toEqual([expected]);
    // The enqueuer is a subscriber too, and hears it exactly once — one delivery per Peer, like every
    // other thread-scoped notification (its reply is not a substitute: the two carry the same id, and a
    // client that renders the queue off the notification must not have to special-case its own writes).
    expect(notifs(s, "turn/queued").map((f) => f.params)).toEqual([expected]);
    // Reply first, notification second — beginTurn's own turn/started precedent.
    const lines = parsed(s.lines);
    expect(lines.findIndex((f) => f.id === 4)).toBeLessThan(lines.findIndex((f) => f.method === "turn/queued"));
  });

  it("threadView.queueDepth tracks the queue: 0 while idle, 0 for a RUNNING turn, up on enqueue, down on drain, 0 after a flush", async () => {
    const engine = mkEngine();
    const { srv, c, threadId } = await boot(engine);
    const record = srv.registry.get(threadId)!;
    expect(threadView(srv, record).queueDepth).toBe(0);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    expect(threadView(srv, record).queueDepth).toBe(0); // a turn that is RUNNING is not a turn that is queued

    send(c, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(c, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();
    expect(threadView(srv, record).queueDepth).toBe(2);

    engine.release();
    await settle();
    expect(threadView(srv, record).queueDepth).toBe(1); // "two" drained into the engine, "three" still waits

    send(c, { id: 6, method: "turn/interrupt", params: { threadId, cancelQueued: true } });
    await settle();
    expect(threadView(srv, record).queueDepth).toBe(0);
  });

  // --- ADMISSION CAPS (fix wave 1, F2) --------------------------------------------------------------
  // The queue was unbounded: a client could hold a thread busy and stack unlimited turns of unlimited
  // size behind it, all of it retained in this server's memory until the drain or a flush. Two caps, both
  // checked BEFORE the id is minted, because a refused enqueue owes no terminal event and a skipped id
  // would be a turn nobody can ever account for.
  it("fills to MAX_QUEUED_TURNS, then refuses -33001 naming the entry cap — and the refusal minted no id, queued nothing and broadcast nothing", async () => {
    const engine = mkEngine();
    const { srv, s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    for (let i = 0; i < MAX_QUEUED_TURNS; i++) send(c, { id: 100 + i, method: "turn/start", params: { threadId, input: `q${i}`, queue: true } });
    await tick();
    const record = srv.registry.get(threadId)!;
    expect(record.queue).toHaveLength(MAX_QUEUED_TURNS);

    send(c, { id: 999, method: "turn/start", params: { threadId, input: "over", queue: true } });
    await tick();

    expect(replyTo(s, 999).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 999).error.message).toBe(`turn queue is full (max ${MAX_QUEUED_TURNS} queued turns)`);
    expect(record.queue).toHaveLength(MAX_QUEUED_TURNS);              // no state change
    expect(notifs(s, "turn/queued")).toHaveLength(MAX_QUEUED_TURNS);  // and no turn/queued for a turn that was refused

    // A drain re-opens admission, and the next accepted id is CONTIGUOUS: the refusal consumed no id.
    engine.release();
    await settle();
    send(c, { id: 1000, method: "turn/start", params: { threadId, input: "after", queue: true } });
    await tick();
    expect(replyTo(s, 1000).result.turn.id).toBe(`turn_${threadId}_${MAX_QUEUED_TURNS + 2}`);
  });

  // I3b: MAX_QUEUED_BYTES went 1 MiB -> 4 MiB (queue.ts) and the entry size that exercises the TOTAL cap
  // without tripping the new per-entry cap (MAX_QUEUED_ENTRY_BYTES, still 1 MiB) had to grow past
  // peer.ts's 256 KiB per-frame wire limit — so, like the "single over-cap entry" cell right below it,
  // this now drives `enqueueTurn` directly rather than through the wire (the old 250 KiB entries fit a
  // frame AND the old 1 MiB total; no size clears both bars against a 4 MiB total).
  it("the byte cap counts the candidate against what is already queued: four ~1,000,000-byte entries fit within the 4 MiB total, a fifth same-size one is refused, and a small one still gets in", () => {
    const record = { id: "thr_x", turnSeq: 0, queue: [] } as unknown as ThreadRecord;
    const big = "x".repeat(1_000_000 - 2); // JSON-serialized bytes: exactly 1,000,000 (the quotes add 2)
    for (let i = 0; i < 4; i++) expect(enqueueTurn(record, big).ok).toBe(true);
    expect(record.queue).toHaveLength(4);

    expect(enqueueTurn(record, big)).toEqual({ ok: false, reason: "bytes" });
    // The cap bounds the BUFFER, not the entry: what still fits is still admitted.
    expect(enqueueTurn(record, "small")).toMatchObject({ ok: true });
    expect(record.queue).toHaveLength(5);
  });

  // Driven against the function rather than the wire, deliberately: peer.ts refuses any frame over 256 KiB
  // (MAX_IN) before dispatch, so a single over-cap input cannot reach the handler at all. The cap still has
  // to hold here — queue.ts is the state machine, and it is the thing a later caller would reuse.
  it("a single over-cap entry is refused on an EMPTY queue, counts BYTES not characters, and mints no id", () => {
    const record = { id: "thr_x", turnSeq: 0, queue: [] } as unknown as ThreadRecord;

    // I3b: this fixture (1.2 MB of UTF-8, 600k UTF-16 units) now trips the NEW per-entry cap
    // (MAX_QUEUED_ENTRY_BYTES, 1 MiB) rather than the total-bytes cap it used to be the only cap named
    // "bytes" — the total cap is now 4 MiB and would not refuse a single entry this size. The
    // length-based-cap-would-have-admitted-it point the comment made still holds; it just surfaces
    // through "entry" now.
    expect(enqueueTurn(record, "😀".repeat(300_000))).toEqual({ ok: false, reason: "entry" });
    expect(record.queue).toEqual([]);
    expect(record.turnSeq).toBe(0);      // the id sequence must not skip: a refused enqueue owes no terminal event

    expect(enqueueTurn(record, "small")).toEqual({ ok: true, id: "turn_thr_x_1", position: 1 });
    expect(MAX_QUEUED_BYTES).toBe(4 * 1024 * 1024);
  });

  // The wire-reachable half of the total-bytes refusal (QUEUE_FULL's "bytes" message, turns.ts): entries
  // sized to clear peer.ts's 256 KiB frame cap individually, twenty-one of them to clear the new 4 MiB
  // total — proving the actual RPC reply text, not just the `enqueueTurn` reason, still says "4 MiB".
  it("the wire's BYTES refusal quotes the 4 MiB total cap (QUEUE_FULL message table)", async () => {
    const entry = "x".repeat(200_000 - 2); // ~200,000 JSON-serialized bytes, well under the 256 KiB frame cap
    const engine = mkEngine();
    const { s, c, threadId } = await boot(engine);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick();
    for (let i = 0; i < 20; i++) send(c, { id: 10 + i, method: "turn/start", params: { threadId, input: entry, queue: true } });
    await tick();
    send(c, { id: 99, method: "turn/start", params: { threadId, input: entry, queue: true } });
    await tick();
    expect(replyTo(s, 99).error.code).toBe(ERR.BUSY);
    expect(replyTo(s, 99).error.message).toBe("turn queue is full (max 4 MiB queued input)");
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

  // --- I3b: UserTurnInput ACCOUNTING + the three caps (F10 T-IMGREACH Task 8) -----------------------
  // `QueuedTurn.input` widens from a bare string to `UserTurnInput` (turnInput.ts, Task 2) and
  // `queuedInputBytes` becomes ONE function — serialized JSON bytes of whatever form the entry takes —
  // used by `enqueueTurn` for both the per-entry and the running-total check. A minimal raw record, same
  // shape the pre-existing "single over-cap entry" cell above already uses, since these cells drive
  // `enqueueTurn` directly rather than through the wire.
  describe("I3b: UserTurnInput accounting and the three admission caps", () => {
    function threadRecord(): ThreadRecord {
      return { id: "thr_x", turnSeq: 0, queue: [] } as unknown as ThreadRecord;
    }
    const textBlock = (text: string) => ({ type: "text" as const, text });
    const imageBlockOfSize = (dataLen: number) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png", data: "A".repeat(dataLen) },
    });
    // Sized so ONE fits comfortably alongside a small text block under the 1 MiB entry cap, but TWO
    // exceed it — the deliberate "no image queue-stacking" asymmetry MAX_QUEUED_ENTRY_BYTES exists for.
    const maxImageBlock = () => imageBlockOfSize(600_000);
    // A string whose JSON-serialized byte length is EXACTLY `n` — a bare ASCII run needs no escaping,
    // so the only overhead over the raw length is the pair of wrapping quotes.
    const stringWhoseSerializedBytesAre = (n: number): string => "x".repeat(Math.max(0, n - 2));
    const expectedFirstTurnId = (rec: ThreadRecord): string => `turn_${rec.id}_${rec.turnSeq + 1}`;
    // Fills `rec`'s queue to EXACTLY `target` total accounted bytes, chunked at the entry cap so no
    // individual push trips MAX_QUEUED_ENTRY_BYTES on its own; the target cap (MAX_QUEUED_BYTES) is what
    // the LAST push is left to hit. Returns false the moment any push is refused — the target could not
    // be reached — true once `target` bytes sit in the queue.
    function fillQueueToBytes(rec: ThreadRecord, target: number): boolean {
      const chunks: number[] = [];
      let remaining = target;
      while (remaining > 0) {
        let c = Math.min(remaining, MAX_QUEUED_ENTRY_BYTES);
        if (remaining - c === 1) c -= 1; // a bare 1-byte remainder is unrepresentable (min JSON string is 2 bytes: `""`)
        chunks.push(c);
        remaining -= c;
      }
      for (const c of chunks) {
        if (!enqueueTurn(rec, stringWhoseSerializedBytesAre(c)).ok) return false;
      }
      return true;
    }

    it("queuedInputBytes is serialized JSON bytes, for BOTH forms", () => {
      const inputs: UserTurnInput[] = ["hi", [textBlock("hi")], [textBlock("hi"), imageBlockOfSize(4)]];
      for (const input of inputs) expect(queuedInputBytes(input)).toBe(Buffer.byteLength(JSON.stringify(input), "utf8"));
    });

    it("a string's charge now includes JSON quoting — the documented, deliberate shift", () => {
      expect(queuedInputBytes("hi")).toBe(4); // `"hi"`, not 2
    });

    it("one max image + text FITS one entry; two max images do NOT (the deliberate asymmetry)", () => {
      expect(enqueueTurn(threadRecord(), [textBlock("look"), maxImageBlock()])).toMatchObject({ ok: true });
      expect(enqueueTurn(threadRecord(), [maxImageBlock(), maxImageBlock()])).toEqual({ ok: false, reason: "entry" });
    });

    it("refusal happens BEFORE any turn ID is minted", () => {
      const rec = threadRecord();
      const before = rec.turnSeq;
      expect(enqueueTurn(rec, [maxImageBlock(), maxImageBlock()])).toEqual({ ok: false, reason: "entry" });
      expect(rec.turnSeq).toBe(before);
      const expectedId = expectedFirstTurnId(rec); // computed BEFORE the mint below
      expect(enqueueTurn(rec, "ok")).toMatchObject({ ok: true, id: expectedId }); // the refusal burned nothing
    });

    it.each(triple(MAX_QUEUED_TURNS))("boundary: queued ENTRIES $label", ({ at, passes }) => {
      const rec = threadRecord();
      const results = Array.from({ length: at }, () => enqueueTurn(rec, "x"));
      expect(results.every((r) => r.ok)).toBe(passes);
      if (!passes) expect(results.at(-1)).toEqual({ ok: false, reason: "entries" });
    });

    it.each(triple(MAX_QUEUED_ENTRY_BYTES))("boundary: ONE entry's serialized bytes $label", ({ at, passes }) => {
      const rec = threadRecord();
      const r = enqueueTurn(rec, stringWhoseSerializedBytesAre(at));
      expect(r.ok).toBe(passes);
      if (!passes) expect(r).toEqual({ ok: false, reason: "entry" });
    });

    it.each(triple(MAX_QUEUED_BYTES))("boundary: TOTAL retained bytes $label", ({ at, passes }) => {
      const rec = threadRecord();
      expect(fillQueueToBytes(rec, at)).toBe(passes);
      if (!passes) expect(enqueueTurn(rec, "x")).toEqual({ ok: false, reason: "bytes" });
    });
  });
});

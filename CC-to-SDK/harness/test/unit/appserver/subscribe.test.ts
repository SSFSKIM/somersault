// test/unit/appserver/subscribe.test.ts — Task 9: replay-first subscribe + paginated thread/read.
// Copies Task 6's mkSink/send/parsed helpers (test/unit/appserver/server.test.ts) so this file reads
// standalone.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

/** Walks `thread/read` pages via `nextCursor` until it comes back null, merging every page's `data`
 *  into a Map keyed by item id (dedup-by-id over the union — losslessness means this map's key set
 *  equals the full set of item ids in the transcript, no more, no less). `guard` throws instead of
 *  looping forever if `nextCursor` never reaches null. Shared by every losslessness test in this file
 *  (Task 13's (g), and the follow-up (i)/(j) regression tests) so each only states its fixture and its
 *  expected id set, not the walking mechanics. `pageLengths` (one entry per page, in order) lets a
 *  caller assert on the shape of individual pages — in particular, whether threadRead's `from === 0`
 *  fallback (subscribe.ts) fired: that branch is the ONLY path that can return more than `limit`
 *  items on one page (it deliberately bypasses the clamp), so `pageLengths.some(n => n > limit)` is
 *  a reliable, purely black-box signal that it was exercised, with no instrumentation of production
 *  code required. */
async function readAllPages(connA: { feed(ch: string): void }, a: { lines: string[] }, threadId: string, limit: number, startId: number, guard = 20): Promise<{ merged: Map<string, unknown>; pages: number; pageLengths: number[] }> {
  const merged = new Map<string, unknown>();
  const pageLengths: number[] = [];
  let cursor: string | null | undefined;
  let reqId = startId;
  let pages = 0;
  do {
    send(connA, { id: reqId, method: "thread/read", params: { threadId, limit, ...(cursor ? { cursor } : {}) } });
    await tick();
    const page = parsed(a.lines).find((f) => f.id === reqId).result;
    for (const item of page.data as Array<{ id: string }>) merged.set(item.id, item);
    pageLengths.push((page.data as unknown[]).length);
    cursor = page.nextCursor;
    reqId += 1;
    pages += 1;
    if (pages >= guard) throw new Error(`readAllPages: exceeded guard of ${guard} pages — nextCursor never reached null`);
  } while (cursor);
  return { merged, pages, pageLengths };
}

describe("appserver subscribe + thread/read (Task 9)", () => {
  it("a pipelined turn/start + thread/subscribe (no tick between, same synchronous step) delivers EXACTLY ONE turn/started, from the live broadcast, with the correct turn id (Task 9 finding 1 + finding 2 regression guard)", async () => {
    // Finding 1 (fixed in round 1): turn/start's synchronous gate set busy/reset the buffer but only
    // minted the turn id LATER inside the deferred chain callback, so thread/subscribe's busy-but-
    // empty-buffer fallback (subscribe.ts) read a STALE turnSeq and replayed a bogus `turn_<id>_0` a
    // tick before the real `turn_<id>_1` broadcast landed.
    //
    // Finding 2 (fixed here): even once the id was correct, the subscribing peer still received
    // turn/started TWICE for this exact interleaving — once from subscribe's own replay (which saw
    // record.busy already true, since that flips synchronously at turn/start's request-arrival time,
    // before the chain callback's broadcast has fired), once from the live broadcast that follows once
    // this peer is already in record.subscribers (added before the replay branch runs). A turn whose
    // turn/started has not yet been broadcast was never MISSED by this subscriber — the live broadcast
    // about to fire is not a replay's job to duplicate. Reproduced live pre-fix against this exact test
    // (asserting count===1 failed with 2 deliveries); post-fix it's exactly 1.
    const sessionFactory = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
    const srv = new AppServer({}, { sessionFactory });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A"); init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    b.lines.length = 0;
    // no await between these two sends — turn/start's synchronous gate (busy/buffer/turn-id mint) and
    // thread/subscribe's replay must both run before either request's deferred work fires.
    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const turnId = parsed(a.lines).find((f) => f.id === 3).result.turn.id;
    expect(turnId).toBe(`turn_${threadId}_1`);

    const bStarted = parsed(b.lines).filter((f) => f.method === "turn/started");
    expect(bStarted).toHaveLength(1);
    expect(bStarted[0].params).toEqual({ threadId, turn: { id: turnId, status: "inProgress" } });

    const bCompleted = parsed(b.lines).find((f) => f.method === "turn/completed");
    expect(bCompleted.params.turn.id).toBe(turnId);
  });
  it("subscribing to a thread whose turn/started has ALREADY broadcast (ordinary mid-turn join, not the same-tick gap) still replays turn/started first, before the buffered item events", async () => {
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "text", text: "hi" }] } });
        return new Promise<{ result: unknown }>(() => {}); // never resolves — the turn stays in flight for this test
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const srv = new AppServer({}, { sessionFactory });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A"); init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); // the chain callback runs to completion in this tick: turn/started broadcasts, then
                  // submit() emits its item and parks on the never-resolving promise — turnStartedBroadcast
                  // is now true and stays true, since this turn never completes within the test.

    b.lines.length = 0;
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const turnId = `turn_${threadId}_1`;
    const notifs = parsed(b.lines).filter((f) => !("id" in f));
    // gap 6: the buffered replay now ALSO carries the turn's live userMessage item/completed, right after turn/started.
    expect(notifs.map((f) => f.method)).toEqual(["turn/started", "item/completed", "item/started", "item/completed", "thread/status/changed"]);
    expect(notifs[0].params).toEqual({ threadId, turn: { id: turnId, status: "inProgress" } });
    expect(notifs[1].params).toMatchObject({ threadId, turnId, item: { type: "userMessage", text: "go" } });
  });
  it("(a) replay order: turn/started -> buffered item events -> decision/requested -> thread/status/changed last", async () => {
    let broker: any;
    const sessionFactory = (cfg: any) => {
      broker = cfg.permissionBroker;
      return {
        submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
          onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "text", text: "hi" }] } });
          await broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_a", signal: new AbortController().signal });
          return { result: {} };
        },
        interrupt: async () => ({}),
        dispose: async () => {},
        onFrame: () => () => {},
        sessionId: "sess-1",
      };
    };
    const srv = new AppServer({}, { sessionFactory });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A");
    init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); // submit() runs to its first await (the parked broker.request) synchronously within this tick

    b.lines.length = 0; // discard B's init/initialized noise; only care about the subscribe reply + replay
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const bLines = parsed(b.lines);
    expect(bLines.find((f) => f.id === 4).result).toEqual({ subscribed: true });

    const notifs = bLines.filter((f) => !("id" in f));
    // gap 6: the turn's live userMessage item/completed lands right after turn/started, ahead of the agent's items.
    expect(notifs.map((f) => f.method)).toEqual(["turn/started", "item/completed", "item/started", "item/completed", "decision/requested", "thread/status/changed"]);
    expect(notifs[0].params).toEqual({ threadId, turn: { id: `turn_${threadId}_1`, status: "inProgress" } });
    expect(notifs[1].params).toMatchObject({ threadId, turnId: `turn_${threadId}_1`, item: { type: "userMessage", text: "go" } });
    expect(notifs[2].params).toMatchObject({ threadId, turnId: `turn_${threadId}_1`, item: { type: "agentMessage", id: "msg1#0", text: "hi" } });
    expect(notifs[3].params).toMatchObject({ threadId, turnId: `turn_${threadId}_1`, item: { type: "agentMessage", id: "msg1#0" } });
    expect(notifs[4].params.threadId).toBe(threadId);
    expect(notifs[4].params.decision.toolUseId).toBe("toolu_a");
    // status is now the {state,waitingOn} object (Task 7, spec D-M2-8) — a pending decision on this
    // thread means waitingOn:"decision", not just a bare "active" string.
    expect(notifs[5].params).toEqual({ threadId, status: { state: "active", waitingOn: "decision" } });
  });

  it("(b) an idle thread's subscribe replay carries no turn/started, and ends on thread/status/changed:idle", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    a.lines.length = 0;
    send(connA, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();

    const notifs = parsed(a.lines).filter((f) => !("id" in f));
    expect(notifs.some((f) => f.method === "turn/started")).toBe(false);
    expect(notifs.map((f) => f.method)).toEqual(["thread/status/changed"]);
    // status is now the {state} object (Task 7, spec D-M2-8) — idle carries no waitingOn key at all.
    expect(notifs[0].params).toEqual({ threadId, status: { state: "idle" } });
  });

  it("(b2) a late subscriber's replay carries one turn/queued per queued entry, FIFO and positioned, right after turn/started — and a later flush completes exactly those ids", async () => {
    // M2b Task 8, chartered by the Task 4 review adjudication (2026-08-11). Without the queue in the
    // replay a client joining mid-turn learns nothing about the turns waiting behind the one in flight,
    // and its FIRST news of a queued id is a `turn/completed {cancelled}` (or a `turn/started`) for a
    // turn it never saw exist — the id is uncorrelatable, so the event is unrenderable.
    const sessionFactory = () => ({
      submit: () => new Promise<{ result: unknown }>(() => {}), // never resolves — the turn stays in flight, so the queue holds
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const srv = new AppServer({}, { sessionFactory });
    const a = mkSink(); const connA = srv.connect(a.sink);
    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connA, 1, "A"); init(connB, 1, "B");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "one" } });
    await tick(); // the chain callback ran: turn/started broadcast, submit parked forever
    send(connA, { id: 4, method: "turn/start", params: { threadId, input: "two", queue: true } });
    send(connA, { id: 5, method: "turn/start", params: { threadId, input: "three", queue: true } });
    await tick();
    const queuedIds = [4, 5].map((i) => parsed(a.lines).find((f) => f.id === i).result.turn.id);

    b.lines.length = 0;
    send(connB, { id: 6, method: "thread/subscribe", params: { threadId } });
    await tick();

    const notifs = parsed(b.lines).filter((f) => !("id" in f));
    // The turn LAYER replays together (started, then what is queued behind it), then the item layer,
    // then decisions, then status — the §5 order with the queue slotted into the layer it belongs to.
    expect(notifs.map((f) => f.method)).toEqual(["turn/started", "turn/queued", "turn/queued", "item/completed", "thread/status/changed"]);
    expect(notifs.slice(1, 3).map((f) => f.params)).toEqual([
      { threadId, turn: { id: queuedIds[0], status: "queued" }, position: 1 },
      { threadId, turn: { id: queuedIds[1], status: "queued" }, position: 2 },
    ]);

    // The point of holding those ids: the flush that follows is now correlatable — every id this peer
    // was replayed gets its terminal event, and no id it was never told about appears.
    b.lines.length = 0;
    send(connA, { id: 7, method: "turn/interrupt", params: { threadId, cancelQueued: true } });
    await tick();
    const terminal = parsed(b.lines).filter((f) => f.method === "turn/completed");
    expect(terminal.map((f) => f.params.turn)).toEqual(queuedIds.map((id) => ({ id, status: "cancelled" })));
  });

  it("(c) stitch contract: buffered-replay ids and thread/read ids overlap, and dedup-by-id collapses the overlap to exactly one entry per id", async () => {
    // Task 5's replay.test.ts fixture — a prompt, an assistant reply with a tool_use, and its tool_result.
    // gap 6 makes this fake uuid-aware (engine-faithful): probe 70 (ALIVE) found the SDK persists exactly
    // the uuid the server supplies via submit's opts, so a faithful fake echoes THAT SAME uuid back as
    // the persisted prompt frame's uuid — a hardcoded "u-p" would no longer be the live item's real id.
    const restFrames = [
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ];
    let capturedUuid: string | undefined;
    const sessionFactory = () => ({
      // The real engine's onMessage never re-delivers the prompt itself — only assistant/tool_result
      // frames come through it — so feeding these here still only produces live items for the assistant
      // text + tool_use (mirrors what a genuine turn would buffer); the prompt echo comes from turns.ts.
      submit: async (_prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string }) => {
        capturedUuid = opts?.uuid;
        for (const f of restFrames) onMessage(f);
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-fixture",
    });
    let seenSessionId: string | undefined;
    const getSessionMessages = async (sessionId: string) => {
      seenSessionId = sessionId;
      return [{ type: "user", uuid: capturedUuid, message: { content: "run ls" } }, ...restFrames];
    };
    const srv = new AppServer({}, { sessionFactory, getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    expect(capturedUuid).toBeTruthy(); // the server minted and threaded a uuid into submit's opts

    a.lines.length = 0;
    send(connA, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();
    const liveIds = [...new Set(parsed(a.lines).filter((f) => f.method === "item/started" || f.method === "item/completed").map((f) => f.params.item.id))];
    expect(liveIds).toEqual([capturedUuid, "msg_A#0", "toolu_1"]); // the live-emitted prompt item's id equals the minted uuid (gap 6)

    send(connA, { id: 5, method: "thread/read", params: { threadId } });
    await tick();
    const read = parsed(a.lines).find((f) => f.id === 5).result;
    expect(seenSessionId).toBe("sess-fixture");
    expect(read.data.map((i: any) => i.id)).toEqual([capturedUuid, "msg_A#0", "toolu_1"]); // the persisted page DOES have the prompt, under the SAME id

    // The stitch: every live-replayed id also shows up in the persisted page (real overlap, not vacuous).
    for (const id of liveIds) expect(read.data.some((i: any) => i.id === id)).toBe(true);

    const beforeMergeCount = liveIds.length + read.data.length; // 3 + 3 = 6 raw occurrences
    const merged = new Map<string, unknown>();
    for (const id of liveIds) merged.set(id, { source: "live" });
    for (const item of read.data) merged.set(item.id, item); // client-side dedup-by-id, read wins last-write
    expect(merged.size).toBe(3); // capturedUuid, msg_A#0, toolu_1 — each survives exactly once
    expect(merged.size).toBeLessThan(beforeMergeCount); // proves a real collapse happened, not a no-op union
    expect([...merged.keys()].sort()).toEqual([capturedUuid, "msg_A#0", "toolu_1"].sort());
  });

  it("(d) thread/read pages newest-first with an epoch-qualified row cursor; last page is shorter with nextCursor:null", async () => {
    // Task 13: the cursor is now "<epoch>:<rowOffset>", not a plain item-consumed count — a thread
    // that never rewinds keeps epoch 0 throughout. This fixture is 1 row : 1 item (no tool calls), so
    // the row offset in each nextCursor is the exact item-count boundary too; the PAGE DATA below is
    // therefore identical to what the pre-Task-13 offset-from-end cursor produced — only the cursor
    // STRING format changed, which is the whole point of this task, so the literal values here are a
    // deliberately-edited pre-existing assertion (Task 13 brief, verbatim cursor format).
    const bigFixture = Array.from({ length: 450 }, (_, i) => ({ type: "assistant", message: { id: `msg${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    // Task 13: a subsequent page's fetch is a real bounded row window now, not the whole file every
    // time — this fake must honor offset/limit like the real reader does, or it can't tell the two
    // apart (a fake that always returns the full 450 rows would silently mask the gap-12 fix).
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
      if (!opts) return bigFixture;
      const { offset = 0, limit } = opts;
      return bigFixture.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId } });
    await tick();
    const page1 = parsed(a.lines).find((f) => f.id === 3).result;
    expect(page1.data).toHaveLength(200);
    expect(page1.nextCursor).toBe("0:250");
    expect(page1.data[0].id).toBe("msg250#0");
    expect(page1.data[199].id).toBe("msg449#0");

    send(connA, { id: 4, method: "thread/read", params: { threadId, cursor: page1.nextCursor } });
    await tick();
    const page2 = parsed(a.lines).find((f) => f.id === 4).result;
    expect(page2.data).toHaveLength(200);
    expect(page2.nextCursor).toBe("0:50");
    expect(page2.data[0].id).toBe("msg50#0");
    expect(page2.data[199].id).toBe("msg249#0");

    send(connA, { id: 5, method: "thread/read", params: { threadId, cursor: page2.nextCursor } });
    await tick();
    const page3 = parsed(a.lines).find((f) => f.id === 5).result;
    expect(page3.data).toHaveLength(50);
    expect(page3.nextCursor).toBeNull();
    expect(page3.data[0].id).toBe("msg0#0");
    expect(page3.data[49].id).toBe("msg49#0");
  });

  it("(e) gap 12: a second page's fetch is a bounded row window, not the whole file", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ type: "assistant", message: { id: `m${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    const calls: Array<{ limit?: number; offset?: number } | undefined> = [];
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
      calls.push(opts);
      if (!opts) return rows;
      const { offset = 0, limit } = opts;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId, limit: 10 } });
    await tick();
    const page1 = parsed(a.lines).find((f) => f.id === 3).result;
    expect(calls[0]).toBeUndefined(); // page 1: the reader is called with NO opts at all — one whole-file fetch

    send(connA, { id: 4, method: "thread/read", params: { threadId, limit: 10, cursor: page1.nextCursor } });
    await tick();
    // page 2's fetch is bounded: offset/limit are both present and the window is smaller than the file
    expect(calls[1]).toBeDefined();
    expect(calls[1]!.offset).toBeGreaterThanOrEqual(0);
    expect(calls[1]!.limit).toBeLessThan(rows.length);
  });

  it("(f) gap 10: a limit above 500 clamps to 500 and emits a limitClamped warning to the requesting peer", async () => {
    const getSessionMessages = async () => [{ type: "user", uuid: "u1", message: { content: "hi" } }];
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    a.lines.length = 0;
    send(connA, { id: 3, method: "thread/read", params: { threadId, limit: 9999 } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result.data).toHaveLength(1);
    const warnings = parsed(a.lines).filter((f) => f.method === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].params).toEqual({ code: "limitClamped", message: "thread/read limit clamped to 500" });
  });

  it("(g) gap 12 losslessness: paging a transcript with a straddling tool call across every page returns each item exactly once, deduped by id over the union", async () => {
    // A prompt, then a tool_use whose tool_result lands 20 filler rows later — with limit:5 the
    // straddle spans several page boundaries, so this fixture exercises the id-presence boundary
    // search (not just the item-count-per-row-happy-path (d) and (e) already cover).
    const rows: unknown[] = [{ type: "user", uuid: "p", message: { content: "start" } }];
    rows.push({ type: "assistant", message: { id: "mtool", content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "ls" } }] } });
    for (let i = 0; i < 20; i++) rows.push({ type: "assistant", message: { id: `mf${i}`, content: [{ type: "text", text: `filler${i}` }] } });
    rows.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "done" }] } });
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
      if (!opts) return rows;
      const { offset = 0, limit } = opts;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    const { merged, pages } = await readAllPages(connA, a, threadId, 5, 3);

    // 1 prompt + 20 filler + 1 tool call = 22 distinct items, each surviving exactly once in the union.
    expect(merged.size).toBe(22);
    const expectedIds = new Set<string>(["p", "toolu_x", ...Array.from({ length: 20 }, (_, i) => `mf${i}#0`)]);
    expect(new Set(merged.keys())).toEqual(expectedIds);
    expect(pages).toBeGreaterThan(1); // proves this actually walked multiple pages, not a vacuous one-page read
  });

  it("(h) gap 12: a cursor minted at epoch 0 is refused once the thread's epoch is bumped (rewind), instead of returning rows", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ type: "assistant", message: { id: `m${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
      if (!opts) return rows;
      const { offset = 0, limit } = opts;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId, limit: 5 } });
    await tick();
    const page1 = parsed(a.lines).find((f) => f.id === 3).result;
    expect(page1.nextCursor).toBe("0:5"); // epoch 0, minted against the un-rewound thread

    // Simulate M2b's rewind bumping the generation counter (router.test.ts's own precedent for
    // mutating `record.epoch` directly, since the rewind handler itself is a later milestone's task).
    srv.registry.get(threadId)!.epoch = 1;

    send(connA, { id: 4, method: "thread/read", params: { threadId, cursor: page1.nextCursor } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 4).error;
    expect(err.code).toBe(-32602);
    expect(err.message).toBe("cursor invalidated by a rewind; re-read from the start");
  });

  it("(i) gap 12 losslessness regression: a dangling tool call that opened BEFORE a genuinely-completed one must not strand the genuine one's rows (external review counterexample)", async () => {
    // r0 prompt; r1 opens toolA (never resolves); r2 opens toolB; r3 delivers toolB's real result;
    // r4 opens toolC (never resolves). Full-parse item order is [p, toolB(genuine), toolA(forced),
    // toolC(forced)] — toolB completes in SCAN order (at r3) even though it opened AFTER toolA (r1),
    // because itemsFromTranscript's finalize(false) appends still-dangling tools at the very TAIL,
    // in REGISTRATION order, not completion order. A boundary search that anchors on a single
    // representative discarded id (windowItems[discardCount-1], here toolA at r1) only guarantees
    // rows before r2 are re-fetchable — toolB's opening (r2) and completion (r3) rows are never
    // fetched again by any later page, and toolB is silently dropped from the whole-history union.
    const rows: unknown[] = [
      { type: "user", uuid: "p", message: { content: "start" } },
      { type: "assistant", message: { id: "mA", content: [{ type: "tool_use", id: "toolA", name: "Bash", input: { command: "sleep 100" } }] } },
      { type: "assistant", message: { id: "mB", content: [{ type: "tool_use", id: "toolB", name: "Bash", input: { command: "echo hi" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolB", content: "hi" }] } },
      { type: "assistant", message: { id: "mC", content: [{ type: "tool_use", id: "toolC", name: "Bash", input: { command: "sleep 200" } }] } },
    ];
    const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
      if (!opts) return rows;
      const { offset = 0, limit } = opts;
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    };
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    const { merged, pages } = await readAllPages(connA, a, threadId, 1, 3);

    expect(new Set(merged.keys())).toEqual(new Set(["p", "toolA", "toolB", "toolC"]));
    expect(merged.size).toBe(4); // every item exactly once — toolB in particular must survive
    expect(pages).toBeGreaterThan(1);
  });

  it("(j) gap 12 losslessness, harder: two concurrently-open tool calls with a genuine completion interleaved between them, walked at more than one page size", async () => {
    // r0 prompt; r1 opens toolA (never resolves); r2 opens toolB; r3 opens toolC (never resolves) —
    // toolA AND toolC are both still open when r3 lands; r4 delivers toolB's real result (interleaved
    // between two still-open tools, not merely adjacent to one); r5/r6 plain filler text; r7 opens
    // toolD (never resolves). 7 distinct items total. Walked at three different limits so the
    // property under test — union-by-id equals every item, at every page size — isn't tied to one
    // particular row/limit alignment.
    const rows: unknown[] = [
      { type: "user", uuid: "p", message: { content: "start" } },
      { type: "assistant", message: { id: "mA", content: [{ type: "tool_use", id: "toolA", name: "Bash", input: { command: "sleep 100" } }] } },
      { type: "assistant", message: { id: "mB", content: [{ type: "tool_use", id: "toolB", name: "Bash", input: { command: "echo hi" } }] } },
      { type: "assistant", message: { id: "mC", content: [{ type: "tool_use", id: "toolC", name: "Bash", input: { command: "sleep 200" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolB", content: "hi" }] } },
      { type: "assistant", message: { id: "mF1", content: [{ type: "text", text: "filler1" }] } },
      { type: "assistant", message: { id: "mF2", content: [{ type: "text", text: "filler2" }] } },
      { type: "assistant", message: { id: "mD", content: [{ type: "tool_use", id: "toolD", name: "Bash", input: { command: "sleep 300" } }] } },
    ];
    const expectedIds = new Set(["p", "toolA", "toolB", "toolC", "toolD", "mF1#0", "mF2#0"]);

    // Which limits actually drive threadRead's `from === 0` fallback (subscribe.ts) — hand-traced
    // against the real mapper/replay logic, then confirmed by running this exact fixture: at
    // limit:1 and limit:2 the fixed `4*limit` lookahead window undershoots (the same two-
    // concurrently-open-tool shape the (i) counterexample exercises, no batching involved) and the
    // retry loop bottoms out at `from === 0` without the window ever making progress, so the
    // fallback fires and dumps everything remaining in one oversized page. At limit:3 the window
    // (coincidentally also starting at `from === 0` on its first try, since `4*limit` already
    // exceeds the remaining row count) DOES make progress each time, so every page stays within
    // `limit` and the fallback never fires. This is deliberately asserted per limit, not left as an
    // accident of the fixture — a future refactor that stops exercising the fallback here would
    // otherwise lose this coverage silently.
    const expectFallback: Record<number, boolean> = { 1: true, 2: true, 3: false };

    for (const limit of [1, 2, 3]) {
      const calls: Array<{ limit?: number; offset?: number } | undefined> = [];
      const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
        calls.push(opts);
        if (!opts) return rows;
        const { offset = 0, limit: l } = opts;
        return rows.slice(offset, l === undefined ? undefined : offset + l);
      };
      const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
      const a = mkSink(); const connA = srv.connect(a.sink);
      init(connA, 1, "A");
      send(connA, { id: 2, method: "thread/start", params: {} });
      await tick();
      const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

      const { merged, pages, pageLengths } = await readAllPages(connA, a, threadId, limit, 3);
      expect(new Set(merged.keys())).toEqual(expectedIds); // same union at EVERY page size
      expect(merged.size).toBe(7);
      expect(pages).toBeGreaterThanOrEqual(1);

      // The fallback is the ONLY path that can return more items than `limit` on one page (it
      // deliberately bypasses the clamp to dump everything remaining) — a page longer than `limit`
      // is therefore conclusive, purely black-box proof that it fired, with no need to instrument
      // production code. Supplementary evidence: a call reaching `offset: 0` is necessary for the
      // fallback (it can only fire once the window covers the true start) but is NOT sufficient on
      // its own — limit:3 also reaches `offset: 0` on its very first attempt below, without ever
      // triggering the fallback, since that window still makes progress.
      const fallbackFired = pageLengths.some((n) => n > limit);
      expect(fallbackFired).toBe(expectFallback[limit]);
      expect(calls.some((c) => c?.offset === 0)).toBe(true); // every limit here reaches the true start eventually
    }
  });

  it("thread/read on a thread with no persisted sessionId returns an empty page, not an error", async () => {
    const srv = new AppServer({}, { sessionFactory: () => ({ ...fakeSession(), sessionId: undefined }) });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ data: [], nextCursor: null });
  });

  it("thread/read filters phantom persisted rows (command echoes, local-command output, caveats, compaction summaries) before mapping to items", async () => {
    const messages = [
      { type: "user", uuid: "u1", message: { content: "<command-name>/compact</command-name>" } },
      { type: "user", uuid: "u2", message: { content: "<local-command-stdout>ok</local-command-stdout>" } },
      { type: "user", uuid: "u3", message: { content: "<local-command-caveat>careful</local-command-caveat>" } },
      { type: "user", uuid: "u4", message: { content: "This session is being continued from a previous conversation summary." } },
      { type: "user", uuid: "u5", message: { content: "real question" } },
    ];
    const getSessionMessages = async () => messages;
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId } });
    await tick();
    const page = parsed(a.lines).find((f) => f.id === 3).result;
    expect(page.data).toEqual([{ type: "userMessage", id: "u5", text: "real question" }]);
  });

  it("thread/unsubscribe replies {subscribed:false} and stops further broadcasts to that peer", async () => {
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msgX", content: [{ type: "text", text: "x" }] } });
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const srv = new AppServer({}, { sessionFactory });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ subscribed: true });

    send(connA, { id: 4, method: "thread/unsubscribe", params: { threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 4).result).toEqual({ subscribed: false });

    a.lines.length = 0;
    send(connA, { id: 5, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    expect(parsed(a.lines).some((f) => f.method === "item/started")).toBe(false);
  });

  it("closing a connection sweeps its peer from every thread's subscriber set (no dead Peer left in any record)", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    send(connA, { id: 3, method: "thread/start", params: {} });
    await tick();
    const t1 = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    const t2 = parsed(a.lines).find((f) => f.id === 3).result.thread.id;

    send(connA, { id: 4, method: "thread/subscribe", params: { threadId: t1 } });
    send(connA, { id: 5, method: "thread/subscribe", params: { threadId: t2 } });
    await tick();
    expect(srv.registry.get(t1)!.subscribers.size).toBe(1);
    expect(srv.registry.get(t2)!.subscribers.size).toBe(1);

    connA.close();

    expect(srv.registry.get(t1)!.subscribers.size).toBe(0);
    expect(srv.registry.get(t2)!.subscribers.size).toBe(0);
  });

  it("thread/read rejects a non-numeric cursor as INVALID_PARAMS instead of producing a NaN-driven page", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession(), getSessionMessages: async () => [] });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "thread/read", params: { threadId, cursor: "not-a-number" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(-32602);
  });

  it("subscribe/unsubscribe/read on an unknown threadId are all -33004", async () => {
    const srv = new AppServer({}, { sessionFactory: () => fakeSession() });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/subscribe", params: { threadId: "thr_missing0000" } });
    send(connA, { id: 3, method: "thread/unsubscribe", params: { threadId: "thr_missing0000" } });
    send(connA, { id: 4, method: "thread/read", params: { threadId: "thr_missing0000" } });
    await tick();
    for (const id of [2, 3, 4]) expect(parsed(a.lines).find((f) => f.id === id).error.code).toBe(-33004);
  });
});

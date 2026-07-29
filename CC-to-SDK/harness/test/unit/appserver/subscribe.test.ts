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
    expect(notifs[4].params.decision.toolUseID).toBe("toolu_a");
    expect(notifs[5].params).toEqual({ threadId, status: "active" });
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
    expect(notifs[0].params).toEqual({ threadId, status: "idle" });
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

  it("(d) thread/read pages newest-first with an offset-from-end cursor; last page is shorter with nextCursor:null", async () => {
    const bigFixture = Array.from({ length: 450 }, (_, i) => ({ type: "assistant", message: { id: `msg${i}`, content: [{ type: "text", text: `t${i}` }] } }));
    const getSessionMessages = async () => bigFixture;
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
    expect(page1.nextCursor).toBe("200");
    expect(page1.data[0].id).toBe("msg250#0");
    expect(page1.data[199].id).toBe("msg449#0");

    send(connA, { id: 4, method: "thread/read", params: { threadId, cursor: page1.nextCursor } });
    await tick();
    const page2 = parsed(a.lines).find((f) => f.id === 4).result;
    expect(page2.data).toHaveLength(200);
    expect(page2.nextCursor).toBe("400");
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

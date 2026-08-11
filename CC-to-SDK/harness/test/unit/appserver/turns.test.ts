// test/unit/appserver/turns.test.ts — Task 8: turn lifecycle + item streaming. Copies Task 6's
// mkSink/send/parsed helpers (test/unit/appserver/server.test.ts) so this file reads standalone.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

/** boots a server, initializes one connection, starts one thread, and subscribes that connection to it
 *  (Task 9 tightened turn/item fan-out to real per-thread subscribers — was: every initialized conn);
 *  returns { srv, s, c, threadId }. The subscribe reply + its idle replay (thread/status/changed) are
 *  discarded from `s.lines` so callers' notification-order assertions start clean. */
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

describe("appserver turns (Task 8)", () => {
  it("streams item events in TurnMapper order between turn/started and turn/completed; a second turn/start while busy is -33001", async () => {
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "text", text: "hi" }] } });
        onMessage({ type: "assistant", message: { id: "msg2", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } });
        onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok", is_error: false }] } });
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "again" } });
    await tick();

    const startReply = parsed(s.lines).find((f) => f.id === 3);
    expect(startReply.result.turn).toEqual({ id: `turn_${threadId}_1`, status: "inProgress" });
    const busyReply = parsed(s.lines).find((f) => f.id === 4);
    expect(busyReply.error.code).toBe(ERR.BUSY);

    const notifs = parsed(s.lines).filter((f) => !("id" in f) && f.method !== "initialized");
    const order = notifs.map((f) => (f.method === "item/started" || f.method === "item/completed" ? `${f.method}:${f.params.item.type}` : f.method));
    expect(order).toEqual([
      "thread/status/changed",
      "turn/started",
      "item/completed:userMessage", // gap 6: the live prompt echo, minted right after turn/started
      "item/started:agentMessage",
      "item/completed:agentMessage",
      "item/started:toolCall",
      "item/completed:toolCall",
      "turn/completed",
      "thread/status/changed",
    ]);
    const started = notifs.find((f) => f.method === "turn/started");
    expect(started.params).toEqual({ threadId, turn: { id: `turn_${threadId}_1`, status: "inProgress" } });
    const completed = notifs.find((f) => f.method === "turn/completed");
    expect(completed.params).toEqual({ threadId, turn: { id: `turn_${threadId}_1`, status: "completed" } });
    const itemStarted = notifs.filter((f) => f.method === "item/started");
    for (const ev of itemStarted) expect(ev.params).toMatchObject({ threadId, turnId: `turn_${threadId}_1` });
  });

  it("turn/start emits a live userMessage item to subscribers (gap 6): item/completed:userMessage lands right after turn/started, before the first agent item, and its id is the SAME uuid threaded into session.submit's opts (probe-70 ALIVE — live id == persisted id)", async () => {
    let capturedOpts: { uuid?: string } | undefined;
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string }) => {
        capturedOpts = opts;
        onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "text", text: "hi" }] } });
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "hello there" } });
    await tick();

    const notifs = parsed(s.lines).filter((f) => !("id" in f) && f.method !== "initialized");
    const order = notifs.map((f) => (f.method === "item/started" || f.method === "item/completed" ? `${f.method}:${f.params.item.type}` : f.method));
    expect(order).toEqual([
      "thread/status/changed",
      "turn/started",
      "item/completed:userMessage",
      "item/started:agentMessage",
      "item/completed:agentMessage",
      "turn/completed",
      "thread/status/changed",
    ]);
    const userItemEvent = notifs.find((f) => f.method === "item/completed" && f.params.item.type === "userMessage");
    expect(userItemEvent.params.item.text).toBe("hello there");
    expect(capturedOpts?.uuid).toBeTruthy();
    expect(userItemEvent.params.item.id).toBe(capturedOpts?.uuid);
  });

  it("a rejecting submit yields turn/completed{status:'failed', error} and clears busy for the next turn", async () => {
    const sessionFactory = () => ({
      submit: async () => { throw new Error("boom"); },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn.status).toBe("failed");
    expect(completed.params.turn.error).toMatch(/boom/);

    send(c, { id: 4, method: "turn/start", params: { threadId, input: "again" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).result.turn.status).toBe("inProgress");
  });

  it("a submit that RESOLVES ERROR-TAGGED (Task 14: a terminal result frame that reported failure) broadcasts turn/completed{status:'failed', error} and finalizes its open tool call as failed", async () => {
    // turn/completed is a ONE-SHOT broadcast — nothing later corrects it — so an error tag dropped here is
    // a subscriber permanently told a dead API completed the turn. The error text survives only inside the
    // assistant message items, which no status field points at.
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } });
        return { result: "Failed to authenticate. API Error: 401 probe 96 synthetic 401", error: { message: "Failed to authenticate. API Error: 401 probe 96 synthetic 401", terminalReason: "api_error", apiErrorStatus: 401 } };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: `turn_${threadId}_1`, status: "failed", error: "Failed to authenticate. API Error: 401 probe 96 synthetic 401" });
    const tool = parsed(s.lines).filter((f) => f.method === "item/completed").map((f) => f.params.item).find((i: any) => i.type === "toolCall");
    expect(tool.status).toBe("failed");
    // busy still clears — a failed turn must not wedge the thread.
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "again" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).result.turn.status).toBe("inProgress");
  });

  it("an INTERRUPT wins over an error tag on the same resolve — the client's own abort is the more specific cause", async () => {
    let resolveSubmit!: (r: { result: unknown; error?: { message: string } }) => void;
    const sessionFactory = () => ({
      submit: (_p: string, _o: (m: unknown) => void) => new Promise<{ result: unknown; error?: { message: string } }>((resolve) => { resolveSubmit = resolve; }),
      interrupt: async () => { resolveSubmit({ result: "x", error: { message: "aborted mid-stream" } }); return {}; },
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } });
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: `turn_${threadId}_1`, status: "interrupted" });
  });

  it("a submit that RESOLVES after interrupt() (the real engine's actual contract — session.ts's readLoop discards error_during_execution and resolves the waiter) completes as 'interrupted', not 'completed'", async () => {
    let resolveSubmit!: (r: { result: unknown }) => void;
    const sessionFactory = () => ({
      submit: (_prompt: string, _onMessage: (m: unknown) => void) => new Promise<{ result: unknown }>((resolve) => { resolveSubmit = resolve; }),
      interrupt: async () => { resolveSubmit({ result: {} }); return {}; },
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick(); // let the chain callback run and call submit(), capturing resolveSubmit
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } });
    await tick();

    const interruptReply = parsed(s.lines).find((f) => f.id === 4);
    expect(interruptReply.result).toEqual({ interrupted: true });
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: `turn_${threadId}_1`, status: "interrupted" });
  });

  it("turn/interrupt arriving in the SAME synchronous tick as turn/start (before the chain callback runs) still reports 'interrupted' — the flag must not be wiped by that turn's own deferred setup", async () => {
    const sessionFactory = () => ({
      // Resolves quickly regardless of whether interrupt() ran first — the point under test is only
      // whether interruptRequested survives to when onSuccess reads it, not submit/interrupt ordering.
      submit: async () => ({ result: {} }),
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } }); // same tick — no await between sends
    await tick();

    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: `turn_${threadId}_1`, status: "interrupted" });
  });

  it("submit() throwing SYNCHRONOUSLY (not returning a rejected promise) still completes as failed, clears busy, and does not wedge the thread's chain", async () => {
    const sessionFactory = () => ({
      submit: () => { throw new Error("sync boom"); },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn.status).toBe("failed");
    expect(completed.params.turn.error).toMatch(/sync boom/);

    // busy must be cleared — a subsequent turn/start on this thread is accepted, not -33001
    send(c, { id: 4, method: "turn/start", params: { threadId, input: "again" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4).result.turn.status).toBe("inProgress");

    // the chain must not be wedged — a subsequent thread/close still gets a reply
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 5).result).toEqual({ ok: true });
  });

  it("turn/interrupt sets interruptRequested; a submit that subsequently rejects completes as 'interrupted' (mirrors the engine's interrupt-throws contract)", async () => {
    let rejectSubmit!: (e: unknown) => void;
    const sessionFactory = () => ({
      submit: (_prompt: string, _onMessage: (m: unknown) => void) => new Promise((_resolve, reject) => { rejectSubmit = reject; }),
      interrupt: async () => { rejectSubmit(new Error("engine interrupted")); return {}; },
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { s, c, threadId } = await bootThread(sessionFactory);

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } });
    await tick();

    const interruptReply = parsed(s.lines).find((f) => f.id === 4);
    expect(interruptReply.result).toEqual({ interrupted: true });
    const completed = parsed(s.lines).find((f) => f.method === "turn/completed");
    expect(completed.params.turn).toEqual({ id: `turn_${threadId}_1`, status: "interrupted" });
  });

  it("turn/interrupt accepts cancelQueued without error and replies {interrupted:true} with no cancelled/stillQueued fields (SDK Query.interrupt is zero-arg at 0.3.220)", async () => {
    const { s, c, threadId } = await bootThread(fakeSession);
    send(c, { id: 3, method: "turn/interrupt", params: { threadId, cancelQueued: true } });
    await tick();
    const reply = parsed(s.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ interrupted: true });
  });

  it("turn/start and turn/interrupt on an unknown thread are -33004", async () => {
    const srv = new AppServer({}, { sessionFactory: fakeSession });
    const s = mkSink(); const c = srv.connect(s.sink);
    init(c, 1);
    send(c, { id: 2, method: "turn/start", params: { threadId: "thr_missing0000", input: "x" } });
    send(c, { id: 3, method: "turn/interrupt", params: { threadId: "thr_missing0000" } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 2).error.code).toBe(ERR.THREAD_NOT_FOUND);
    expect(parsed(s.lines).find((f) => f.id === 3).error.code).toBe(ERR.THREAD_NOT_FOUND);
  });

  it("bad params (missing input) on turn/start is -32602", async () => {
    const { s, c, threadId } = await bootThread(fakeSession);
    send(c, { id: 3, method: "turn/start", params: { threadId } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("record.buffer caps at 500 events and drops the oldest, tagged with their turnId (Task 9 replays this bound)", async () => {
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        for (let i = 0; i < 300; i++) {
          onMessage({ type: "assistant", message: { id: `msg${i}`, content: [{ type: "text", text: `t${i}` }] } });
        }
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { srv, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const record = srv.registry.get(threadId)!;
    const turnId = `turn_${threadId}_1`;
    expect(record.buffer).toHaveLength(500);
    // 300 frames * 2 events (started, completed) = 600 pushed; the oldest 100 are dropped.
    expect(record.buffer[0]).toEqual({ turnId, event: { kind: "started", item: { type: "agentMessage", id: "msg50#0", text: "t50" } } });
    expect(record.buffer[499]).toEqual({ turnId, event: { kind: "completed", item: { type: "agentMessage", id: "msg299#0", text: "t299" } } });
  });

  it("a mid-turn joiner's replayed item/started carries the text as it was WHEN IT STARTED, not the accumulated text (the deltas that follow would double it)", async () => {
    // The mapper mutates its item in place (item.text += delta) and the buffer held the ItemEvent BY
    // REFERENCE, so a buffered item/started was serialized at replay time carrying what the item holds
    // NOW. A client following the spec's join rule (apply the started item, then the deltas) rendered
    // "Hello worldHello world". The buffer now snapshots the item at emit time.
    const sessionFactory = () => ({
      submit: (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "stream_event", event: { type: "message_start", message: { id: "msg1" } } });
        onMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
        onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } } });
        onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } } });
        return new Promise<{ result: unknown }>(() => {}); // the turn stays in flight so a second client can join it
      },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
    });
    const { srv, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connB, 1, "B");
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const notifs = parsed(b.lines).filter((f) => !("id" in f) && f.method !== "initialized");
    const started = notifs.find((f) => f.method === "item/started");
    expect(started.params.item).toEqual({ type: "agentMessage", id: "msg1#0", text: "" });
    expect(notifs.filter((f) => f.method === "item/agentMessage/delta").map((f) => f.params.delta)).toEqual(["Hello", " world"]);
  });

  it("a mid-turn joiner's replayed item/started for a tool call still reads inProgress with no result, even though the tool has since completed", async () => {
    const sessionFactory = () => ({
      submit: (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msg1", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } });
        onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt", is_error: false }] } });
        return new Promise<{ result: unknown }>(() => {});
      },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
    });
    const { srv, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connB, 1, "B");
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const notifs = parsed(b.lines).filter((f) => !("id" in f) && f.method !== "initialized");
    const started = notifs.find((f) => f.method === "item/started");
    expect(started.params.item).toEqual({ type: "toolCall", id: "toolu_1", tool: "Bash", view: "command", arguments: { command: "ls" }, status: "inProgress" });
    // gap 6: the replayed buffer now ALSO carries the turn's userMessage item/completed (it was pushed
    // before the tool call), so narrow to the toolCall's own completed event rather than the first one.
    const completed = notifs.find((f) => f.method === "item/completed" && f.params.item.type === "toolCall");
    expect(completed.params.item).toMatchObject({ id: "toolu_1", status: "completed", result: "file.txt" });
  });

  it("record.buffer is a PER-TURN window — reset at the start of the next turn, not a rolling lifetime window", async () => {
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "assistant", message: { id: "msgA", content: [{ type: "text", text: "a" }] } });
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { srv, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const record = srv.registry.get(threadId)!;
    // gap 6: +1 for the turn's own userMessage item/completed, on top of the agentMessage's started+completed
    expect(record.buffer).toHaveLength(3);
    expect(record.buffer.every((b) => b.turnId === `turn_${threadId}_1`)).toBe(true);

    send(c, { id: 4, method: "turn/start", params: { threadId, input: "again" } });
    await tick();
    // the second turn's buffer must contain ONLY its own events, not the first turn's leftovers
    expect(record.buffer).toHaveLength(3);
    expect(record.buffer.every((b) => b.turnId === `turn_${threadId}_2`)).toBe(true);
  });

  it("the bounded buffer never sheds an in-flight item's start while keeping its deltas — a mid-turn joiner can still reconstruct the text", async () => {
    // Drop-oldest evicted the item/started first, so a client reconnecting into a long streamed message was
    // replayed deltas for an itemId it had never seen: unreconstructable output. The start is folded
    // forward instead (its evicted deltas collapse into its own text) and re-seated at the head.
    const CHUNKS = 600; // > BUFFER_CAP (500), so the start is the first thing a plain shift() would drop
    let release!: () => void;
    const inFlight = new Promise<void>((r) => { release = r; });
    const sessionFactory = () => ({
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        onMessage({ type: "stream_event", event: { type: "message_start", message: { id: "msg_long" } } });
        onMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
        for (let i = 0; i < CHUNKS; i++) onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `w${i} ` } } });
        await inFlight;
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-1",
    });
    const { srv, c, threadId } = await bootThread(sessionFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    const b = mkSink(); const connB = srv.connect(b.sink);
    init(connB, 1, "B");
    send(connB, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();

    const notifs = parsed(b.lines).filter((f) => !("id" in f) && f.method !== "initialized");
    const started = notifs.find((f) => f.method === "item/started");
    expect(started, "replayed deltas for an item the subscriber was never shown starting").toBeTruthy();
    expect(started.params.item.type).toBe("agentMessage");
    const itemId = started.params.item.id;
    const deltas = notifs.filter((f) => f.method === "item/agentMessage/delta");
    expect(deltas.every((f) => f.params.itemId === itemId)).toBe(true);
    const full = Array.from({ length: CHUNKS }, (_, i) => `w${i} `).join("");
    expect(started.params.item.text + deltas.map((f) => f.params.delta).join("")).toBe(full);

    release();
    await tick();
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    await tick(); await tick();
  });
});

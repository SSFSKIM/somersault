// test/unit/appserver/turns.test.ts — Task 8: turn lifecycle + item streaming. Copies Task 6's
// mkSink/send/parsed helpers (test/unit/appserver/server.test.ts) so this file reads standalone.
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { AppServer, threadView } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { MAX_QUEUED_BYTES } from "../../../src/appserver/queue.js";
import { MAX_DATA_URL_CHARS, MAX_INPUT_ITEMS } from "../../../src/appserver/turnItems.js";
import { turnStartParams } from "../../../src/appserver/schema/turns.js";
import type { UserTurnInput } from "../../../src/session/turnInput.js";
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
    const submits: string[] = [];
    const sessionFactory = () => ({
      // NEVER CALLED on this path, and that is the point: beginTurn's chain callback re-reads
      // interruptRequested before running the runner, so a turn the client aborted before its own deferred
      // setup ran never reaches the engine at all. Recorded rather than asserted-away, because `submits`
      // being empty is the other half of what "the flag survived" now means.
      submit: async (prompt: string) => { submits.push(prompt); return { result: {} }; },
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
    expect(submits).toEqual([]);
    // The turn/start caller's own reply carries that same terminal status — the turn object, never an
    // error (it is the only place a plain turn/start learns its id, which the notification above names).
    // It read `inProgress` before the re-read landed; pinned here because a client branching on the reply
    // must not be told a turn started that never will.
    expect(parsed(s.lines).find((f) => f.id === 3).result).toEqual({ turn: { id: `turn_${threadId}_1`, status: "interrupted" } });
    // and no turn/started went out for a turn that never ran
    expect(parsed(s.lines).find((f) => f.method === "turn/started")).toBeUndefined();
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

  it("turn/interrupt{cancelQueued} on a thread with nothing queued replies {interrupted:true, cancelledQueued: []} — the SERVER-side set only (SDK Query.interrupt is still zero-arg at 0.3.220, so no cancelled/stillQueued from the engine)", async () => {
    // M2b Wave 4 (queue.test.ts owns the flush behavior): the flag stopped being inert when the
    // server-side queue landed. The receipt now always carries the flushed set when the flag is present,
    // empty included — a client must be able to tell "nothing was queued" from "the field is not supported".
    const { s, c, threadId } = await bootThread(fakeSession);
    send(c, { id: 3, method: "turn/interrupt", params: { threadId, cancelQueued: true } });
    await tick();
    const reply = parsed(s.lines).find((f) => f.id === 3);
    expect(reply.result).toEqual({ interrupted: true, cancelledQueued: [] });
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

  it("a turn bumps record.updatedAt at BOTH edges — a thread that has only ever run turns must not report the time it was created (merge review, finding 8)", async () => {
    // updatedAt used to move only on a settings write, so a thread doing nothing but work looked idle
    // since creation and sorted to the bottom of a recency-ordered picker.
    let release!: () => void;
    const inFlight = new Promise<void>((r) => { release = r; });
    const sessionFactory = () => ({
      submit: async () => { await inFlight; return { result: {} }; },
      interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
    });
    const { srv, s, c, threadId } = await bootThread(sessionFactory);
    const record = srv.registry.get(threadId)!;
    // Backdated rather than clock-compared: updatedAt is unix SECONDS, so a turn that starts and finishes
    // inside one second is indistinguishable from a stale timestamp by value alone.
    record.updatedAt = 0;

    send(c, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();
    const atStart = record.updatedAt;
    expect(atStart).toBeGreaterThan(0); // the turn STARTING is activity

    record.updatedAt = 0;
    release();
    await tick();
    expect(parsed(s.lines).find((f) => f.method === "turn/completed")).toBeTruthy();
    expect(record.updatedAt).toBeGreaterThan(0); // and so is its completion

    // and the wire projection a picker sorts on carries it, not just the record
    expect(threadView(srv, record).updatedAt).toBe(record.updatedAt);
  });
});

// =====================================================================================================
// `turn/start {input: InputItem[]}` — the public wire's items array (spec 2026-08-23 rev 3, "Wire
// design" / "Admission and the queue" / "Canonical ordering"). Driven through the real dispatch, because
// what these rows are about is exactly the seam between the SCHEMA (which refuses) and the RESOLVER
// (which degrades): a bound moved from one to the other changes nothing a resolver-level test can see.
describe("turn/start input items (spec 2026-08-23)", () => {
  /** Header-only PNG — `pngDimensions` never reads past byte 24, so this is the cheapest buffer that
   *  sniffs as a real image (the fixture fleet-engine.test.ts and client-chat-adapter.test.ts share). */
  const png = (width = 4, height = 4): Buffer => {
    const buf = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
    buf.write("IHDR", 12, "ascii");
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf;
  };
  const PNG_B64 = png().toString("base64");
  const PNG_URL = `data:image/png;base64,${PNG_B64}`;
  const imageBlock = (data = PNG_B64) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
  const note = (reason: string) => `[Image could not be processed: ${reason}]`;

  /** Records what the engine was handed, verbatim — the whole point of every row below. The gated
   *  `factory` holds a turn genuinely in flight (the window the queue exists for); `instantFactory`
   *  settles by itself, for the rows that are not about the queue. */
  function mkRecorder() {
    const submits: UserTurnInput[] = [];
    const pending: Array<() => void> = [];
    return {
      submits,
      release: () => { for (const r of pending.splice(0)) r(); },
      factory: () => ({
        submit: async (prompt: UserTurnInput) => { submits.push(prompt); await new Promise<void>((r) => pending.push(r)); return { result: {} }; },
        submitContent(prompt: UserTurnInput) { return this.submit(prompt); },
        interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
      }),
      instantFactory: () => ({
        submit: async (prompt: UserTurnInput) => { submits.push(prompt); return { result: {} }; },
        submitContent(prompt: UserTurnInput) { return this.submit(prompt); },
        interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
      }),
    };
  }

  it("(a) items reach the engine as the canonical block array — ONE text fold, then the images in declaration order", async () => {
    const rec = mkRecorder();
    const { c, threadId } = await bootThread(rec.instantFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "A" }, { type: "image", url: PNG_URL }, { type: "text", text: "B" }] } });
    await tick();
    // The interleave is DEFINED, not origin-dependent: text A and text B fold into one leading block and
    // the image follows, which is the one shape the host wire can also carry (spec "Canonical ordering").
    expect(rec.submits).toEqual([[{ type: "text", text: "AB" }, imageBlock()]]);
  });

  it("(b) a mixed-success turn folds the notes into that SAME text block, in image order, and still delivers the good image", async () => {
    const rec = mkRecorder();
    const { c, threadId } = await bootThread(rec.instantFactory);
    // "AAAA" is legal base64 that decodes to three bytes no sniffer recognizes — a degrade, never a refusal.
    send(c, { id: 3, method: "turn/start", params: { threadId, input: [
      { type: "text", text: "A" },
      { type: "image", url: "data:image/png;base64,AAAA" },
      { type: "text", text: "B" },
      { type: "image", url: PNG_URL },
    ] } });
    await tick();
    expect(rec.submits).toEqual([[{ type: "text", text: `AB${note("unreadable image data")}` }, imageBlock()]]);
  });

  it("(c) the schema refuses -32602: an https: url, an over-cap data: URL, a relative localImage path, an empty array, and 65 items", async () => {
    const rec = mkRecorder();
    const { s, c, threadId } = await bootThread(rec.instantFactory);
    const bad: Array<[number, unknown]> = [
      [10, [{ type: "image", url: "https://example.com/cat.png" }]],
      // OVER the cap by one quantum, measured the way the cap is measured — on the PAYLOAD (see (c2)).
      // The whole URL is 240,026 characters, comfortably under the emitted `maxLength` backstop, so this
      // row is refused by the payload refine and by nothing else.
      [11, [{ type: "image", url: `data:image/png;base64,${"A".repeat(MAX_DATA_URL_CHARS + 4)}` }]],
      [12, [{ type: "localImage", path: "relative/cat.png" }]],
      [13, []],
      [14, Array.from({ length: MAX_INPUT_ITEMS + 1 }, () => ({ type: "text", text: "x" }))],
    ];
    for (const [id, input] of bad) send(c, { id, method: "turn/start", params: { threadId, input } });
    await tick();
    for (const [id] of bad) expect(parsed(s.lines).find((f) => f.id === id)?.error?.code, `frame ${id}`).toBe(ERR.INVALID_PARAMS);
    // A refusal is not a turn: nothing reached the engine, and the thread is still idle.
    expect(rec.submits).toEqual([]);
  });

  // THE BOUND IS THE PAYLOAD'S, NOT THE URL'S (final review round 2). The schema's `.max()` measured the
  // whole string, prefix included, so an image at exactly the published bound — 240,000 base64 characters,
  // the 180,000 decoded bytes the docs tell a client to build to — arrived as a 240,022-character URL and
  // was refused -32602 by the very schema that published the number. The resolver had always measured the
  // payload, so the two layers disagreed about one cap. Driven through the real dispatch, since what
  // changed is which layer sees the request at all.
  it("(c2) an image AT the published payload bound is ADMITTED and reaches the engine, prefix and all", async () => {
    const rec = mkRecorder();
    const { s, c, threadId } = await bootThread(rec.instantFactory);
    const atCap = Buffer.alloc((MAX_DATA_URL_CHARS / 4) * 3);   // 180,000 bytes -> exactly 240,000 base64 chars
    png().copy(atCap, 0);                                       // …still a sniffable 4x4 PNG, so it survives the resolver too
    const b64 = atCap.toString("base64");
    const url = `data:image/png;base64,${b64}`;
    expect(b64.length).toBe(MAX_DATA_URL_CHARS);                // the payload is AT the cap
    expect(url.length).toBe(MAX_DATA_URL_CHARS + 22);           // …and the URL is over it, which is the whole defect
    send(c, { id: 3, method: "turn/start", params: { threadId, input: [{ type: "image", url }] } });
    await tick();
    const reply = parsed(s.lines).find((f) => f.id === 3);
    expect(reply.error).toBeUndefined();
    expect(reply.result.turn.status).toBe("inProgress");
    // END TO END, not merely admitted: the bytes the client sent are the bytes the engine was handed.
    expect(rec.submits).toEqual([[{ type: "text", text: "" }, imageBlock(b64)]]);
  });

  it("(d) the 21st image degrades against the host's own per-turn image cap while the first 20 survive", async () => {
    const rec = mkRecorder();
    const { c, threadId } = await bootThread(rec.instantFactory);
    const items = [
      ...Array.from({ length: 20 }, () => ({ type: "image", url: PNG_URL })),
      // A localImage the count gate never gets to read: its note names the CAP, not this path — the
      // syscall-level proof that no descriptor was opened lives in turn-items.test.ts's fs-spy row.
      { type: "localImage", path: "/nonexistent/twenty-first.png" },
    ];
    send(c, { id: 3, method: "turn/start", params: { threadId, input: items } });
    await tick();
    const blocks = rec.submits[0] as { type: string; text?: string }[];
    expect(blocks[0]).toEqual({ type: "text", text: note("too many images in one turn (limit 20)") });
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(20);
    expect(blocks[0].text).not.toContain("twenty-first");
  });

  it("(e) a QUEUED items turn is stored RAW and resolved at drain — the drained blocks are byte-for-byte a direct start's", async () => {
    const rec = mkRecorder();
    const { srv, s, c, threadId } = await bootThread(rec.factory);
    const items = [{ type: "text", text: "A" }, { type: "image", url: PNG_URL }];
    send(c, { id: 3, method: "turn/start", params: { threadId, input: "first" } });
    await tick();
    send(c, { id: 4, method: "turn/start", params: { threadId, input: items, queue: true } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 4)?.result?.queued).toBe(true);
    // RAW: admission and queueing are synchronous, so no resolution may have happened yet (an await on
    // this side of admission is the M6 stranding — every check before it goes stale).
    expect(srv.registry.get(threadId)!.queue.map((q) => q.input)).toEqual([{ items }]);
    expect(rec.submits).toEqual(["first"]);

    rec.release();
    for (let i = 0; i < 6; i++) await tick();
    // …and what the drain finally submits is exactly what a direct start submits.
    const direct = mkRecorder();
    const other = await bootThread(direct.instantFactory);
    send(other.c, { id: 5, method: "turn/start", params: { threadId: other.threadId, input: items } });
    await tick();
    expect(rec.submits[1]).toEqual(direct.submits[0]);
    expect(rec.submits[1]).toEqual([{ type: "text", text: "A" }, imageBlock()]);
  });

  it("(f) the queue's byte cap counts an items array by its RAW JSON — exactly at the remaining cap enqueues, one byte more is refused", async () => {
    // Sixteen fillers rather than one: the peer's inbound frame cap (256 KiB) is smaller than the queue's
    // byte cap (4 MiB), so the boundary is only reachable across many frames. Each filler is charged its
    // SERIALIZED bytes — `queuedInputBytes` is one function for every entry form, quotes included.
    const FILL = 250_000;
    const FILLERS = 16;
    const fillerBytes = Buffer.byteLength(JSON.stringify("f".repeat(FILL)), "utf8");
    const overhead = Buffer.byteLength(JSON.stringify([{ type: "text", text: "" }]), "utf8");
    const remaining = MAX_QUEUED_BYTES - FILLERS * fillerBytes;
    const exact = [{ type: "text", text: "a".repeat(remaining - overhead) }];
    expect(Buffer.byteLength(JSON.stringify(exact), "utf8")).toBe(remaining);

    const fill = async (c: { feed(ch: string): void }, threadId: string) => {
      send(c, { id: 3, method: "turn/start", params: { threadId, input: "running" } });
      await tick();
      for (let i = 0; i < FILLERS; i++) send(c, { id: 100 + i, method: "turn/start", params: { threadId, input: "f".repeat(FILL), queue: true } });
      await tick();
    };

    const a = await bootThread(mkRecorder().factory);
    await fill(a.c, a.threadId);
    send(a.c, { id: 20, method: "turn/start", params: { threadId: a.threadId, input: exact, queue: true } });
    await tick();
    expect(parsed(a.s.lines).find((f) => f.id === 20)?.result?.queued).toBe(true);

    const b = await bootThread(mkRecorder().factory);
    await fill(b.c, b.threadId);
    const oneMore = [{ type: "text", text: "a".repeat(remaining - overhead + 1) }];
    send(b.c, { id: 20, method: "turn/start", params: { threadId: b.threadId, input: oneMore, queue: true } });
    await tick();
    const refusal = parsed(b.s.lines).find((f) => f.id === 20);
    expect(refusal.error.code).toBe(ERR.BUSY);
    expect(refusal.error.message).toContain("MiB queued input");
  });

  it("(g) the live user item echoes the RESOLVED input — an image reads as its [Image #N] placeholder", async () => {
    const rec = mkRecorder();
    const { s, c, threadId } = await bootThread(rec.instantFactory);
    send(c, { id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "look" }, { type: "image", url: PNG_URL }] } });
    await tick();
    const userEvent = parsed(s.lines).find((f) => f.method === "item/completed" && f.params.item.type === "userMessage");
    expect(userEvent.params.item.text).toBe("look[Image #1]");
  });

  it("(h) version skew is LOUD BY SHAPE — an OLD server's string-only schema refuses today's array outright", () => {
    // The F9 lesson, pinned rather than described: this is the pre-widening shape, inline, so the row
    // keeps asserting it after the real one has moved on. A new client's images can never be silently
    // stripped by a server that never heard of them — it gets -32602 instead.
    const legacy = z.object({ threadId: z.string().min(1), input: z.string(), queue: z.boolean().optional() });
    expect(legacy.safeParse({ threadId: "t", input: [{ type: "text", text: "hi" }] }).success).toBe(false);
    expect(turnStartParams.safeParse({ threadId: "t", input: [{ type: "text", text: "hi" }] }).success).toBe(true);
  });

  it("(i) an items array with no content at all is -32602 at OUR wire, not a -32603 from the host's refine", async () => {
    // `text: z.string()` admits "", so an all-empty-text array used to parse, resolve to one empty text
    // block with no images, and reach the fleet bridge as a host prompt `{text:""}` — refused by the
    // host's own op schema ("prompt requires text or at least one image") and surfaced as INTERNAL for a
    // request our schema had just called valid. The rule mirrors the host's, so the two cannot disagree.
    const rec = mkRecorder();
    const { s, c, threadId } = await bootThread(rec.instantFactory);
    const bad: Array<[number, unknown]> = [
      [10, [{ type: "text", text: "" }]],
      [11, [{ type: "text", text: "" }, { type: "text", text: "" }]],
    ];
    for (const [id, input] of bad) send(c, { id, method: "turn/start", params: { threadId, input } });
    await tick();
    for (const [id] of bad) expect(parsed(s.lines).find((f) => f.id === id)?.error?.code, `frame ${id}`).toBe(ERR.INVALID_PARAMS);
    expect(rec.submits).toEqual([]);                                   // a refusal is not a turn
    // THE CONTROL, and the reason the rule is stated at the ARRAY level rather than per item: an empty
    // text item beside an image is a perfectly ordinary turn, and it is admitted.
    send(c, { id: 12, method: "turn/start", params: { threadId, input: [{ type: "text", text: "" }, { type: "image", url: PNG_URL }] } });
    await tick();
    expect(parsed(s.lines).find((f) => f.id === 12)?.result?.turn?.status).toBe("inProgress");
    expect(rec.submits).toEqual([[{ type: "text", text: "" }, imageBlock()]]);
  });
});

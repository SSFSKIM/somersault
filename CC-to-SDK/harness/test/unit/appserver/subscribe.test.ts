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
    expect(notifs.map((f) => f.method)).toEqual(["turn/started", "item/started", "item/completed", "decision/requested", "thread/status/changed"]);
    expect(notifs[0].params).toEqual({ threadId, turn: { id: `turn_${threadId}_1`, status: "inProgress" } });
    expect(notifs[1].params).toMatchObject({ threadId, turnId: `turn_${threadId}_1`, item: { type: "agentMessage", id: "msg1#0", text: "hi" } });
    expect(notifs[2].params).toMatchObject({ threadId, turnId: `turn_${threadId}_1`, item: { type: "agentMessage", id: "msg1#0" } });
    expect(notifs[3].params.threadId).toBe(threadId);
    expect(notifs[3].params.decision.toolUseID).toBe("toolu_a");
    expect(notifs[4].params).toEqual({ threadId, status: "active" });
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
    const frames = [
      { type: "user", uuid: "u-p", message: { content: "run ls" } },
      { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
      { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
    ];
    const sessionFactory = () => ({
      // The real engine's onMessage never re-delivers the prompt itself — only assistant/tool_result
      // frames come through it — so feeding all three frames here still only produces live items for
      // the assistant text + tool_use (mirrors what a genuine turn would buffer).
      submit: async (_prompt: string, onMessage: (m: unknown) => void) => {
        for (const f of frames) onMessage(f);
        return { result: {} };
      },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: () => () => {},
      sessionId: "sess-fixture",
    });
    let seenSessionId: string | undefined;
    const getSessionMessages = async (sessionId: string) => { seenSessionId = sessionId; return frames; };
    const srv = new AppServer({}, { sessionFactory, getSessionMessages });
    const a = mkSink(); const connA = srv.connect(a.sink);
    init(connA, 1, "A");
    send(connA, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;

    send(connA, { id: 3, method: "turn/start", params: { threadId, input: "go" } });
    await tick();

    a.lines.length = 0;
    send(connA, { id: 4, method: "thread/subscribe", params: { threadId } });
    await tick();
    const liveIds = [...new Set(parsed(a.lines).filter((f) => f.method === "item/started" || f.method === "item/completed").map((f) => f.params.item.id))];
    expect(liveIds).toEqual(["msg_A#0", "toolu_1"]); // the live buffer never saw the bare prompt frame

    send(connA, { id: 5, method: "thread/read", params: { threadId } });
    await tick();
    const read = parsed(a.lines).find((f) => f.id === 5).result;
    expect(seenSessionId).toBe("sess-fixture");
    expect(read.data.map((i: any) => i.id)).toEqual(["u-p", "msg_A#0", "toolu_1"]); // the persisted page DOES have the prompt

    // The stitch: every live-replayed id also shows up in the persisted page (real overlap, not vacuous).
    for (const id of liveIds) expect(read.data.some((i: any) => i.id === id)).toBe(true);

    const beforeMergeCount = liveIds.length + read.data.length; // 2 + 3 = 5 raw occurrences
    const merged = new Map<string, unknown>();
    for (const id of liveIds) merged.set(id, { source: "live" });
    for (const item of read.data) merged.set(item.id, item); // client-side dedup-by-id, read wins last-write
    expect(merged.size).toBe(3); // u-p, msg_A#0, toolu_1 — each survives exactly once
    expect(merged.size).toBeLessThan(beforeMergeCount); // proves a real collapse happened, not a no-op union
    expect([...merged.keys()].sort()).toEqual(["msg_A#0", "toolu_1", "u-p"]);
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

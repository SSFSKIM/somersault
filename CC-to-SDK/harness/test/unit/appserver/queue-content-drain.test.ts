// test/unit/appserver/queue-content-drain.test.ts — F10 T-IMGREACH Task 8 (I3b): the BUSY -> ENQUEUE ->
// DRAIN path for a content-block turn, end to end against real `ThreadRecord`/`beginTurn` machinery with
// a DI engine — the cell the pre-widening queue tests had no equivalent of, since `QueuedTurn.input` was
// string-only. Proves three things together: (1) an array queued while busy reaches `submitContent` on
// the drain with its blocks intact, never flattened or re-ordered; (2) the LIVE user item the drain emits
// is the flattened display string (`flattenForDisplay`, turnInput.ts), exactly once; (3) an engine that
// LOSES `submitContent` between enqueue and drain (the engine-swap window) fails the turn LOUDLY —
// `EngineCapabilityError` thrown synchronously by `submitRunner` (turns.ts) — rather than silently
// flattening to text or hanging.
import { describe, it, expect, vi } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { enqueueTurn } from "../../../src/appserver/queue.js";
import { beginTurn, submitRunner } from "../../../src/appserver/turns.js";
import type { EngineSession } from "../../../src/appserver/registry.js";
import type { UserTurnInput, UserContentBlock } from "../../../src/session/turnInput.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number) => send(c, { id, method: "initialize", params: { clientInfo: { name: "t" } } });
const waitFor = (pred: () => boolean) => vi.waitFor(() => { if (!pred()) throw new Error("condition not yet true"); }, { timeout: 2000 });

function img(): UserContentBlock {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } };
}

/** The engine-faithful DI fake the drain dispatch is proven against: `submit` parks on a hand-released
 *  promise (so a turn stays genuinely in flight, exactly as queue.test.ts's `mkEngine` does), while
 *  `submitContent` resolves immediately — the content path here is a settled leaf, not a second in-flight
 *  turn, since nothing in this file needs it to overlap with anything else. */
function engineFake() {
  const submits: string[] = [];
  const contents: UserTurnInput[] = [];
  let release!: (v: { result: unknown }) => void;
  const session: EngineSession = {
    submit: (p: string) => { submits.push(p); return new Promise<{ result: unknown }>((r) => { release = r; }); },
    submitContent: (i: UserTurnInput) => { contents.push(i); return Promise.resolve({ result: "ok" }); },
    interrupt: async () => { release?.({ result: {} }); return {}; },
    dispose: async () => {},
    onFrame: () => () => {},
  };
  return { submits, contents, release: () => release({ result: "ok" }), session };
}

/** Boots a real AppServer + thread on the given DI session, subscribes, and returns the live `ThreadRecord`
 *  plus two accumulators fed straight from the wire notifications: `completed` (every `turn/completed`'s
 *  `turn` payload, in arrival order) and `items` (every `item/completed`'s `item`, same). Both grow live —
 *  no polling `s.lines` needed — because tests key their `waitFor`s off these arrays' lengths. */
async function threadWith(session: EngineSession) {
  const lines: string[] = [];
  const completed: Array<{ id: string; status: string; error?: string }> = [];
  const items: unknown[] = [];
  const sink: PeerSink = {
    write: (l: string) => {
      lines.push(l);
      const f = JSON.parse(l);
      if ("id" in f) return;
      if (f.method === "turn/completed") completed.push(f.params.turn);
      if (f.method === "item/completed") items.push(f.params.item);
    },
    buffered: () => 0,
    end: () => {},
  };
  const srv = new AppServer({}, { sessionFactory: () => session as never });
  const c = srv.connect(sink);
  init(c, 1);
  send(c, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(lines).find((f) => f.id === 2).result.thread.id;
  send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
  await tick();
  lines.length = 0;
  const record = srv.registry.get(threadId)!;
  return { srv, record, threadId, completed, items };
}

describe("I3b: the queue drain routes UserTurnInput to submit/submitContent (F10 T-IMGREACH Task 8)", () => {
  it("a content turn enqueued while BUSY reaches submitContent on the drain, blocks intact", async () => {
    const e = engineFake();
    const { srv, record } = await threadWith(e.session);
    beginTurn(srv, undefined, undefined, record, submitRunner(srv, record, "first"), "t1");
    await waitFor(() => e.submits.length === 1); // busy

    const blocks: UserTurnInput = [{ type: "text", text: "what colour" }, img()];
    const enq = enqueueTurn(record, blocks);
    expect(enq.ok).toBe(true);
    expect(e.contents).toHaveLength(0); // nothing ran yet

    e.release();
    await waitFor(() => e.contents.length === 1);
    expect(e.contents[0]).toEqual(blocks); // EXACT blocks — not flattened, not re-ordered
    expect(e.submits).toHaveLength(1); // the string path was NOT used
  });

  it("the drained turn's LIVE user item is the flattened display string, once", async () => {
    const e = engineFake();
    const { srv, record, items } = await threadWith(e.session);
    const blocks: UserTurnInput = [{ type: "text", text: "hi " }, img()];
    // The drain re-enters exactly this spine (turns.ts's startQueuedTurn) — driving it directly on an
    // otherwise-idle thread is the drain's own dispatch, not a stand-in for it.
    beginTurn(srv, undefined, undefined, record, submitRunner(srv, record, blocks), "t1");
    await waitFor(() => e.contents.length === 1);

    const userItems = items.filter((i): i is { type: string; text: string } => (i as { type?: string }).type === "userMessage");
    expect(userItems).toHaveLength(1); // `[Image #1]` present, the base64 absent — a GUI render, not the payload
    expect(userItems[0]!.text).toBe("hi [Image #1]");
  });

  it("a string entry still drains to `submit` — the common path is untouched", async () => {
    const e = engineFake();
    const { srv, record } = await threadWith(e.session);
    beginTurn(srv, undefined, undefined, record, submitRunner(srv, record, "first"), "t1");
    await waitFor(() => e.submits.length === 1);
    expect(enqueueTurn(record, "second").ok).toBe(true);
    e.release();
    await waitFor(() => e.submits.length === 2);
    expect(e.submits).toEqual(["first", "second"]);
    expect(e.contents).toHaveLength(0);
  });

  it("an array entry drained against an engine that LOST submitContent fails LOUDLY", async () => {
    // The engine-swap window: the capability was present at enqueue and gone by drain time. The turn
    // must complete `failed` with the explicit message — never flatten to text, never hang.
    const e = engineFake();
    const { srv, record, completed } = await threadWith(e.session);
    beginTurn(srv, undefined, undefined, record, submitRunner(srv, record, "first"), "t1");
    await waitFor(() => e.submits.length === 1);
    expect(enqueueTurn(record, [{ type: "text", text: "hi" }, img()]).ok).toBe(true);
    delete (record.session as { submitContent?: unknown }).submitContent; // the engine-swap window
    e.release();
    await waitFor(() => completed.length === 2);
    expect(completed[1]).toMatchObject({ status: "failed" });
    expect(completed[1].error).toContain("engine does not support content submission");
    expect(e.contents).toHaveLength(0);
  });
});

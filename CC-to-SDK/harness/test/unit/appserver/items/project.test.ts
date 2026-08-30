// test/unit/appserver/items/project.test.ts — the projector (M9 Stage C, Task 3).
//
// THE LAW COMES FIRST, and everything else in this file is a rider on it: with no arrivals to place, the
// projector IS the replay, element for element, on every transcript shape the suite knows (corpus.ts).
// That is not a nice-to-have — `thread/read` will call the projector on EVERY read, including the
// overwhelming majority that carry no arrival at all, so any divergence is a regression in ordinary
// history reading rather than a defect in a new feature. It is why the two share one routing body instead
// of one copying the other's: a transcription can drift, a function cannot drift from itself.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../../src/appserver/server.js";
import type { PeerSink } from "../../../../src/appserver/peer.js";
import { itemsFromTranscript } from "../../../../src/appserver/items/replay.js";
import { EMPTY_ARRIVALS, projectItems, type ResolvedArrivals } from "../../../../src/appserver/items/project.js";
import { peerArrival } from "../../../../src/peer/address.js";
import type { ArrivalEntry } from "../../../../src/peer/arrivalLog.js";
import { TRANSCRIPT_CORPUS } from "./corpus.js";

const TS = "2026-08-30T00:00:00.000Z";
const ORIGIN = { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", body: "hello", verifiedPeerPid: 4242 };
/** An entry as the observer wrote it (peerArrivalPath.ts's `logArrival`). `anchor` is irrelevant to this file
 *  — resolving an anchor to a row index is Task 4's job, and the projector is handed the ANSWER — so these
 *  entries carry the null sentinel and say what they mean through `byRow`/`atStart` instead. */
const ENTRY = (over: Partial<ArrivalEntry> & Pick<ArrivalEntry, "id" | "text">): ArrivalEntry => ({
  v: 1, sessionId: "s", anchor: null, seq: 1, observedAt: TS, origin: ORIGIN, ...over,
});
const at = (byRow: Record<number, ArrivalEntry[]>, atStart: ArrivalEntry[] = []): ResolvedArrivals =>
  ({ byRow: new Map(Object.entries(byRow).map(([k, v]) => [Number(k), v])), atStart });

describe("the parity law: with no arrivals, the projector IS the replay", () => {
  for (const { name, rows } of TRANSCRIPT_CORPUS) {
    it(name, () => {
      const replayed = itemsFromTranscript(rows);
      // BOTH values of the window flag: `EMPTY_ARRIVALS` has nothing to place at the start either, so the
      // law is "equal for ANY third argument", not "equal for the one the caller happens to pass".
      expect(projectItems(rows, EMPTY_ARRIVALS, false)).toEqual(replayed);
      expect(projectItems(rows, EMPTY_ARRIVALS, true)).toEqual(replayed);
    });
  }

  it("the prompt-erasure case, asserted POSITIVELY: the user's own prompt is an item", () => {
    // Parity against a broken replay would still be parity. A design review caught a router that omitted
    // the direct top-level user path — every deep-equality cell above stays green while ordinary prompts
    // vanish from history, because both sides lose them together. This cell is what makes that visible.
    const rows = TRANSCRIPT_CORPUS.find((f) => f.name.startsWith("plain [user, assistant]"))!.rows;
    expect(projectItems(rows, EMPTY_ARRIVALS, true)).toEqual([
      { type: "userMessage", id: "u-plain", text: "hello" },
      { type: "agentMessage", id: "msg_P#0", text: "hi back" },
    ]);
  });
});

describe("the shared empty refuses to be poisoned", () => {
  // `EMPTY_ARRIVALS` is handed to EVERY read that carries no arrivals — the overwhelming majority of them —
  // so one consumer that mutated it would corrupt every LATER projection in the process, silently, in reads
  // that never asked about arrivals at all. A shallow `Object.freeze` does NOT close that: a `Map` accepts
  // `set` through a frozen reference, and freezing the container does not reach the array either. Hence the
  // shape of this cell: it performs the poisoning a consumer would perform and then re-projects, rather
  // than asserting `Object.isFrozen` — which the broken version would also have passed.
  const rows = [{ type: "user", uuid: "p0", message: { content: "a prompt" } }];
  const smuggled = ENTRY({ id: "poison", text: "an arrival nobody logged" });

  it("every mutator throws, and a projection taken afterwards is the one taken before", () => {
    const before = projectItems(rows, EMPTY_ARRIVALS, true);
    expect(() => EMPTY_ARRIVALS.byRow.set(0, [smuggled])).toThrow(TypeError);
    expect(() => EMPTY_ARRIVALS.byRow.delete(0)).toThrow(TypeError);
    expect(() => EMPTY_ARRIVALS.byRow.clear()).toThrow(TypeError);
    expect(() => EMPTY_ARRIVALS.atStart.push(smuggled)).toThrow(TypeError);
    // The container too: swapping `byRow` wholesale is the poisoning a throwing Map alone would still allow.
    expect(() => { (EMPTY_ARRIVALS as { byRow: unknown }).byRow = new Map([[0, [smuggled]]]); }).toThrow(TypeError);

    // THE CLAIM — not that the calls threw, but that the projector still projects the empty case, on both
    // values of the window flag (`atStart` is the half a frozen map would have left open).
    expect(projectItems(rows, EMPTY_ARRIVALS, true)).toEqual(before);
    expect(projectItems(rows, EMPTY_ARRIVALS, false)).toEqual(before);
    expect(before.map((i) => i.id)).toEqual(["p0"]);
    expect(itemsFromTranscript(rows)).toEqual(before);      // …and the parity law survives the attempt
  });
});

describe("placing arrivals", () => {
  const rows = [
    { type: "user", uuid: "r0", message: { content: "first prompt" } },
    { type: "assistant", uuid: "r1", message: { id: "msg_1", content: [{ type: "text", text: "answering" }] } },
    { type: "user", uuid: "r2", message: { content: "second prompt" } },
  ];

  it("an anchored entry emits immediately after its row's items", () => {
    const items = projectItems(rows, at({ 1: [ENTRY({ id: "arr-1", text: "peer says hi" })] }), false);
    expect(items.map((i) => i.id)).toEqual(["r0", "msg_1#0", "arr-1", "r2"]);
    expect(items[2]).toEqual({ type: "userMessage", id: "arr-1", text: "peer says hi", origin: ORIGIN });
  });

  it("an item that OPENS at the anchor row but completes later emits after the arrival", () => {
    // The anchor names a ROW; a tool call spans rows. The arrival was observed after that row was written
    // and before the result came back, so "after the row" is the position that is actually true — and it is
    // what falls out of emitting at the row rather than at the item, with no special case for the straddle.
    const straddle = [
      { type: "user", uuid: "s0", message: { content: "run it" } },
      { type: "assistant", uuid: "s1", message: { id: "msg_T", content: [{ type: "tool_use", id: "toolu_s", name: "Bash", input: { command: "ls" } }] } },
      { type: "assistant", uuid: "s2", message: { id: "msg_F", content: [{ type: "text", text: "still working" }] } },
      { type: "user", uuid: "s3", message: { content: [{ type: "tool_result", tool_use_id: "toolu_s", content: "file.txt" }] } },
    ];
    const items = projectItems(straddle, at({ 1: [ENTRY({ id: "arr-mid", text: "peer interrupts" })] }), false);
    expect(items.map((i) => i.id)).toEqual(["s0", "arr-mid", "msg_F#0", "toolu_s"]);
  });

  it("several entries at one row keep the order the store returned them in", () => {
    const items = projectItems(rows, at({ 0: [ENTRY({ id: "arr-a", text: "a", seq: 7 }), ENTRY({ id: "arr-b", text: "b", seq: 8 })] }), false);
    // (seq, id) sorting is the STORE's (peer/arrivalLog.ts) — the projector preserves what it is handed
    // rather than re-deriving an order, so one rule decides it and a test of that rule lives with it.
    expect(items.map((i) => i.id)).toEqual(["r0", "arr-a", "arr-b", "msg_1#0", "r2"]);
  });

  it("the text is the ENTRY's, verbatim — including a collapsed batch's two messages", () => {
    // Probe 121 (CLI 2.1.250): one row carried two envelopes, so `peerArrival` joined both bodies into one
    // text under one uuid. The projector re-reads nothing; whatever the observer recorded is what a client
    // sees, or the second message would be destroyed at read time after surviving live.
    const text = "first message\n\nsecond message";
    const items = projectItems(rows, at({ 2: [ENTRY({ id: "arr-batch", text })] }), false);
    expect(items[items.length - 1]).toEqual({ type: "userMessage", id: "arr-batch", text, origin: ORIGIN });
  });

  it("an arrival anchored to a filtered row still lands at that row's position", () => {
    // `byRow` keys are RAW window indices; a phantom bookkeeping row produces no item but still occupies
    // one. Keying on surviving items instead would shift every arrival behind a `/compact` echo.
    const withPhantom = [
      { type: "user", uuid: "q0", message: { content: "<command-name>/compact</command-name>" } },
      { type: "user", uuid: "q1", message: { content: "after the echo" } },
    ];
    const items = projectItems(withPhantom, at({ 0: [ENTRY({ id: "arr-ph", text: "landed" })] }), false);
    expect(items.map((i) => i.id)).toEqual(["arr-ph", "q1"]);
  });

  it("an arrival anchored to the last row precedes the finalize tail", () => {
    // `finalize` closes still-open tools at the very END, after every row — so an arrival at the last row
    // is still BEFORE them. That is the honest order: the tool had not completed when the message landed.
    const dangling = [
      { type: "user", uuid: "d0", message: { content: "go" } },
      { type: "assistant", uuid: "d1", message: { id: "msg_D", content: [{ type: "tool_use", id: "toolu_d", name: "Bash", input: { command: "sleep 1" } }] } },
    ];
    const items = projectItems(dangling, at({ 1: [ENTRY({ id: "arr-tail", text: "late" })] }), false);
    expect(items.map((i) => i.id)).toEqual(["d0", "arr-tail", "toolu_d"]);
  });
});

describe("the null sentinel", () => {
  const rows = [{ type: "user", uuid: "n0", message: { content: "a prompt" } }];
  const arrivals = at({}, [ENTRY({ id: "arr-start", text: "before everything" })]);

  it("atStart entries emit first when the window includes row zero", () => {
    // `anchor: null` means the arrival precedes every row the seed returned — which subsumes, but is not
    // limited to, a transcript that was confirmed empty. So a non-empty window can carry one too.
    expect(projectItems(rows, arrivals, true).map((i) => i.id)).toEqual(["arr-start", "n0"]);
    expect(projectItems([], arrivals, true).map((i) => i.id)).toEqual(["arr-start"]);
  });

  it("…and are withheld entirely when it does not", () => {
    // A later page's first row is not the top of history. Emitting there would render a message that
    // preceded the whole transcript in the middle of it, and on every page the client asks for.
    expect(projectItems(rows, arrivals, false).map((i) => i.id)).toEqual(["n0"]);
  });
});

// ── Criterion 20: THREE PATHS, ONE ITEM ────────────────────────────────────────────────────────────────
// The same arrival reaches a client three ways — live off the engine, cold off the transcript, and
// projected out of the arrival log — and a client deduplicates them BY ID. Three paths agreeing on an id
// while disagreeing on text or attribution is worse than any one of them alone: what gets rendered then
// depends on which copy the client happened to see first, i.e. on who was subscribed.
const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

/** peer-inbound.test.ts's engine fake in shape: a test PUSHES frames, so the observer under test is driven
 *  by frame order rather than by promise order. */
function pushEngine() {
  const frameSubs = new Set<(f: unknown) => void>();
  return {
    engine: {
      onFrame: (cb: (f: unknown) => void) => { frameSubs.add(cb); return () => frameSubs.delete(cb); },
      onUnclaimedResult: () => () => {},
      submit: async () => undefined,
      dispose: async () => {},
      interrupt: async () => {},
    } as any,
    push: (f: unknown) => { for (const s of [...frameSubs]) s(f); },
  };
}

const PEER_FRAME = {
  type: "user", uuid: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", session_id: "s", parent_tool_use_id: null,
  message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s1" hop-chain="a" from-name="peer" from-mode="prompting">hello</cross-session-message>` },
  origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", fromSession: "s1", body: "hello", verifiedPeerPid: 4242 },
};

describe("three-path parity", () => {
  it("the live item, the cold replayed item and the projected item are one item", async () => {
    // (a) LIVE. The engine replays the peer message as a user frame; the observer queues it and the turn
    // that adopts it drains it as an item (`drainArrivals`).
    const e = pushEngine();
    const srv = new AppServer({}, { listSessions: async () => [], sessionFactory: (() => e.engine) as never });
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    e.push(PEER_FRAME);
    e.push({ type: "command_lifecycle", command_uuid: "foreign-3p", state: "started", session_id: "s", uuid: "f" });
    await tick();
    const live = parsed(lines).filter((m) => m.method === "item/completed").map((m) => m.params.item)
      .find((i: any) => i?.type === "userMessage" && i.id === PEER_FRAME.uuid);
    expect(live, "no live userMessage item carried the arrival's uuid").toBeTruthy();

    // (b) COLD. The same frame as the transcript persists it, read back through the replay.
    const cold = itemsFromTranscript([PEER_FRAME])[0];

    // (c) PROJECTED. The entry the observer would have logged for that frame — its fields are exactly what
    // `noteArrival` records (`peerArrival`'s uuid, text and verbatim origin), which is what makes this a
    // comparison of the three PATHS rather than of three hand-written literals.
    const read = peerArrival(PEER_FRAME)!;
    const entry = ENTRY({ id: read.uuid!, text: read.text, origin: read.origin });
    const projected = projectItems([], at({}, [entry]), true)[0];

    const identity = (i: any) => ({ id: i.id, text: i.text, origin: i.origin });
    expect(identity(cold)).toEqual(identity(live));
    expect(identity(projected)).toEqual(identity(live));
    // The attribution the kernel vouched for survives all three, rather than being dropped on the one path
    // that had to reconstruct the item from a log.
    expect((projected as any).origin).toEqual(PEER_FRAME.origin);
  });
});

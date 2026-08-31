// test/unit/appserver/arrivals-clear-degraded.test.ts — the three cross-cutting contracts of the arrival
// log (M9 Task 6), each of which spans the whole pipeline and is therefore owned by no single stage.
//
// EVERY TEST HERE DRIVES THE ASSEMBLED SERVER end to end: an engine fake the test pushes frames at, the
// real observer, the real `fsArrivalStore` under a tmpdir root, and the real `thread/read`. Nothing is
// mocked between the frame and the page. That is the point — the claims below are exactly the ones that a
// per-stage test cannot make, because each of them is about two stages disagreeing:
//
//   (25) `thread/clear` DETACHES. It swaps the engine with no session id (settingsOps.ts), so the entries
//        stay keyed to the OLD id: the cleared thread must read empty, the fresh conversation must log
//        under its own id, and a `thread/resume` back to the first session must find its arrivals intact.
//        "Detach, not delete" is only observable across all three of those.
//   (13) DEGRADATION IS AS DURABLE AS THE STORE THAT RECORDS IT. A failed write that can still write its
//        marker stays degraded across a restart; a directory that cannot be written at all latches in
//        memory only, and the spec states that as a limit rather than pretending otherwise.
//   (23) `arrivals.logged` EQUALS THE ANNOUNCEMENTS. One entry per `thread/peerMessage`, and `logged`
//        counts what was received rather than what survives eviction — the number a client checks its own
//        completeness against.
//
// The store root is ALWAYS an explicit tmpdir and `deps.getSessionMessages` is ALWAYS injected: the
// structural rule in `effectiveArrivalStore` builds a default filesystem store under the operator's real
// `~/.claude` when the reader is also the default, and a fixture that engaged it would write this suite's
// peer messages into a real transcript's neighbourhood.
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { ARRIVAL_LOG_CAP, fsArrivalStore, type ArrivalEntry, type ArrivalStore } from "../../../src/peer/arrivalLog.js";

const dirs: string[] = [];
const tmpRoot = (tag: string): string => { const d = mkdtempSync(join(tmpdir(), `m9t6-${tag}-`)); dirs.push(d); return d; };
const fileCcxDir = tmpRoot("ccx");
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A chmod-based fixture proves nothing where the mode is not enforced (Windows, or root, which writes
 *  through a 0o500 directory). The precedent is `client-chat-adapter.test.ts`. */
const noModeEnforcement = process.platform === "win32" || process.getuid?.() === 0;

const mkSink = () => {
  const lines: string[] = [];
  return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink };
};
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
/** The `fr-*` family's wait: POLL THE CONDITION the assertion is about to read. A fixed count of macrotask
 *  drains says "four turns of the loop ought to be enough", which is a guess about the implementation — one
 *  added `await` on the observer's path turns it into a flake that reads as a claim about behaviour. Every
 *  wait below therefore names what it is waiting for: a reply frame, a grounded seed, a logged entry. */
const waitFor = (fn: () => void | Promise<void>) => vi.waitFor(fn, { timeout: 2000 });

/** peer-inbound-log.test.ts's engine fake: the test PUSHES frames, so the observer is driven by frame
 *  order rather than by promise order. `sessionId` stays undefined — the record learns its id from the
 *  admission (resume) or from an init frame (router.ts's `routeInit`), which is the sequence
 *  `thread/clear` actually produces. */
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

const TS = "2026-08-30T00:00:00.000Z";
/** A persisted row and a live frame in ONE shape: the anchor's whole job is to name a row by what the
 *  observer saw live, so a fixture whose two sides differed would prove nothing about that identity. */
const ROW = (uuid: string, text: string) =>
  ({ type: "user", uuid, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: text }, timestamp: TS });
const REPLY = (uuid: string, msgId: string, text: string) =>
  ({ type: "assistant", uuid, session_id: "s", message: { id: msgId, content: [{ type: "text", text }] }, timestamp: TS });
/** An arrival as the CLI stamps one — `isMeta: true` is the measured shape, which is why a peer row never
 *  advances the anchor onto itself. */
const PEER = (uuid: string, body: string) => ({
  type: "user", uuid, session_id: "s", isMeta: true, parent_tool_use_id: null,
  message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s1" hop-chain="a" from-name="peer" from-mode="prompting">${body}</cross-session-message>` },
  origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", fromSession: "s1", body, verifiedPeerPid: 4242 },
});
const INIT = (sessionId: string) => ({ type: "system", subtype: "init", session_id: sessionId });

type Reader = (sessionId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown[]>;
/** A reader over a WHOLE FILESYSTEM of sessions, keyed by id, honouring the pager's offset/limit exactly
 *  as the real one does — which is what makes `thread/clear`'s "the fresh conversation reads its own
 *  transcript" testable at all. */
const readerOver = (files: Record<string, unknown[]>): Reader => async (sessionId, opts) => {
  const rows = files[sessionId] ?? [];
  if (!opts) return rows.slice();
  const { offset = 0, limit } = opts;
  return rows.slice(offset, limit === undefined ? undefined : offset + limit);
};

interface ReadPage { data: Array<Record<string, any>>; nextCursor: string | null; arrivals?: { logged: number; dropped: number } | null }
const ids = (page: ReadPage) => page.data.map((i) => String(i.id));

interface BootDeps { getSessionMessages: Reader; arrivalStore: ArrivalStore; deleteSession?: (id: string) => Promise<void> }
const boot = (engine: unknown, deps: BootDeps) =>
  new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => engine) as never, ...deps });

/** One connected client on one server. `resume` admits the thread WITH a session id, so the observer seeds
 *  at install; without it the thread is admitted with none and seeds at the init frame. */
async function open(engine: any, deps: BootDeps, resume?: string) {
  const srv = boot(engine, deps);
  const { lines, sink } = mkSink();
  const conn = srv.connect(sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  send(conn, resume
    ? { id: 2, method: "thread/resume", params: { sessionId: resume, crossSessionInbound: "accept" } }
    : { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
  await waitFor(() => expect(parsed(lines).find((m) => m.id === 2), "no reply to the admission").toBeDefined());
  const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(parsed(lines).find((m) => m.id === 3), "no reply to thread/subscribe").toBeDefined());
  const record = srv.registry.get(threadId)!;
  // THE SEED, not merely the reply: a record admitted WITH a session id fires its seed read at install and
  // grounds the anchor chain when that read resolves. Every arrival this suite pushes anchors against that
  // chain, so a wait that stopped at the reply would race the grounding and re-place the arrivals.
  if (resume) await waitFor(() => expect(record.peerInbound?.seeded, "the seed never grounded").toBe(true));
  lines.length = 0;

  let reqId = 100;
  const call = async (method: string, params: Record<string, unknown>) => {
    const id = reqId++;
    send(conn, { id, method, params });
    await waitFor(() => expect(parsed(lines).find((m) => m.id === id), `no reply for ${method}`).toBeDefined());
    return parsed(lines).find((m) => m.id === id)!;
  };
  const read = async (threadOf = threadId, params: Record<string, unknown> = {}): Promise<ReadPage> =>
    (await call("thread/read", { threadId: threadOf, ...params })).result as ReadPage;
  /** Walks to `nextCursor: null`. Throws rather than looping: a stalled pager must fail, not hang. */
  const walk = async (limit: number, threadOf = threadId): Promise<ReadPage[]> => {
    const pages: ReadPage[] = [];
    let cursor: string | null = null;
    do {
      const page: ReadPage = await read(threadOf, { limit, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.nextCursor;
      if (pages.length >= 40) throw new Error("walk: nextCursor never reached null");
    } while (cursor);
    return pages;
  };
  const announced = () => parsed(lines).filter((m) => m.method === "thread/peerMessage");
  return { srv, conn, lines, threadId, call, read, walk, announced, record };
}

describe("(25) `thread/clear` detaches the arrivals — it does not delete them", () => {
  // ONE SEQUENTIAL RUN, MANY CLAIMS. What follows — two arrivals, the clear, the init frame that reveals
  // the fresh conversation's id, an arrival on it — is one server's history and cannot be re-derived per
  // test, so it runs once here and each claim asserts against what that run captured. It is SPLIT rather
  // than left as one block because vitest abandons an `it` at its first failed expect: as a single test, a
  // break in the earliest claim hid every later one, and the later ones are where D2 actually lives (the
  // entries stay under the OLD id, the fresh conversation logs under its own, and a resume brings them
  // back). Split, a red names the claim that broke.
  //
  // ONE PAGE PER READ throughout (the default limit is 200 and these transcripts are tiny), so "the
  // arrivals render again" cannot be an accident of where a walk happened to stop — the null-anchor page
  // gate (spec rev 8.3) only matters to a multi-page walk, and these entries are anchored anyway.
  const root = tmpRoot("c25");
  const store = fsArrivalStore(root);
  const files: Record<string, unknown[]> = {
    "sess-A": [ROW("r-1", "a question"), REPLY("r-2", "msg_1", "an answer")],
    "sess-B": [ROW("b-1", "the fresh conversation's own prompt")],
  };
  const e = pushEngine();

  let a: Awaited<ReturnType<typeof open>>;
  let before: ReadPage, postClear: ReadPage, cleared: ReadPage, afterArrival: ReadPage;
  let clearReply: any;
  // Snapshots, not live reads: the run walks past each of these states, so a claim that read
  // `record.sessionId` when it executed would be reading the END of the run rather than its own moment.
  let sessionIdAfterClear: string | undefined;
  let sessionIdAfterInit: string | undefined;
  let entriesA: string[] = [], entriesB: string[] = [];

  beforeAll(async () => {
    a = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: store }, "sess-A");

    e.push(PEER("a-1", "first arrival"));
    e.push(PEER("a-2", "second arrival"));
    await waitFor(() => expect(store.readAll("sess-A")).toHaveLength(2));
    before = await a.read();

    clearReply = await a.call("thread/clear", { threadId: a.threadId });
    sessionIdAfterClear = a.record.sessionId;
    postClear = await a.read();

    // The init frame reveals the new id, and from here the thread is reading a DIFFERENT transcript.
    e.push(INIT("sess-B"));
    // The init frame reveals the id AND opens the fresh conversation's own seed; the arrival below anchors
    // against that seed, so both halves must have happened before the run moves on.
    await waitFor(() => { expect(a.record.sessionId).toBe("sess-B"); expect(a.record.peerInbound?.seeded).toBe(true); });
    sessionIdAfterInit = a.record.sessionId;
    cleared = await a.read();

    e.push(PEER("b-arr", "an arrival after the clear"));
    await waitFor(() => expect(store.readAll("sess-B")).toHaveLength(1));
    entriesB = store.readAll("sess-B").map((entry: ArrivalEntry) => entry.id);
    entriesA = store.readAll("sess-A").map((entry: ArrivalEntry) => entry.id);
    afterArrival = await a.read();
  });

  it("before the clear: both arrivals render at their anchors, and both are counted", () => {
    expect(ids(before)).toEqual(["r-1", "msg_1#0", "a-1", "a-2"]);
    expect(before.arrivals).toEqual({ logged: 2, dropped: 0 });
  });

  it("the clear replies with no session id, and leaves the record with none", () => {
    // `sessionId: null` is the swap's own answer: the fresh conversation has no store id until its first
    // init frame, and stamping the old one would point every reader at a transcript this thread dropped.
    expect(clearReply.result).toEqual({ ok: true, sessionId: null });
    expect(sessionIdAfterClear).toBeUndefined();
  });

  it("the cleared thread reads as one that has never persisted — zeros, not an absent key", () => {
    // Absent would say "this server does not merge"; zero says "merging is on and this conversation has
    // logged nothing". The difference is the whole of D3.
    expect(postClear).toEqual({ data: [], nextCursor: null, arrivals: { logged: 0, dropped: 0 } });
  });

  it("the fresh conversation reads its OWN transcript, with none of session A's arrivals in it", () => {
    expect(sessionIdAfterInit).toBe("sess-B");
    expect(ids(cleared)).toEqual(["b-1"]);
    expect(cleared.data.filter((i) => i.origin)).toEqual([]);
    expect(cleared.arrivals).toEqual({ logged: 0, dropped: 0 });
  });

  it("an arrival after the clear is keyed to the NEW id, and session A's entries are untouched", () => {
    // THE DETACH, on the write side: two session ids, two logs, neither aware of the other — and A's log
    // is still there, which is the difference between detaching a conversation and deleting its history.
    expect(entriesB).toEqual(["b-arr"]);
    expect(entriesA).toEqual(["a-1", "a-2"]);
    expect(ids(afterArrival)).toEqual(["b-1", "b-arr"]);
    expect(afterArrival.arrivals).toEqual({ logged: 1, dropped: 0 });
  });

  it("resuming session A re-engages the old id: its arrivals render exactly where they did", async () => {
    // The other half of "detached", and the reason the entries were kept: the conversation can be picked
    // up again, and its history comes back whole. Last in the run and self-contained, so it can do its own
    // admission without disturbing the claims above.
    const reply = await a.call("thread/resume", { sessionId: "sess-A", crossSessionInbound: "accept" });
    expect(reply.error).toBeUndefined();
    const again = await a.read(reply.result.thread.id);
    expect(ids(again)).toEqual(["r-1", "msg_1#0", "a-1", "a-2"]);
    expect(again.data.filter((i) => i.origin).map((i) => i.text)).toEqual(["first arrival", "second arrival"]);
    expect(again.arrivals).toEqual({ logged: 2, dropped: 0 });
  });
});

describe("(13) degradation is exactly as durable as the store that records it", () => {
  /** A store whose FIRST `append` fails and whose marker path is untouched — the fixture criterion 13
   *  names. The wrapper delegates everything else to a real `fsArrivalStore`, so `markDegraded` really
   *  writes, which is the whole difference between this test and the one below it. */
  const failFirstAppend = (inner: ArrivalStore): ArrivalStore => {
    let failed = false;
    return { ...inner, append(entry: ArrivalEntry) { if (!failed) { failed = true; throw new Error("ENOSPC"); } inner.append(entry); } };
  };

  it("a failed write whose marker CAN be written stays degraded across a restart", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = tmpRoot("c13a");
    const files = { "sess-D": [ROW("r-1", "a question"), REPLY("r-2", "msg_1", "an answer")] };
    const e = pushEngine();
    const first = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: failFirstAppend(fsArrivalStore(root)) }, "sess-D");

    e.push(PEER("d-1", "the write that failed"));
    e.push(PEER("d-2", "the write that landed"));
    // The live channel reports what the ENGINE did either way: both messages were delivered, so both were
    // announced, whether or not the sidecar could record them.
    await waitFor(() => expect(first.announced()).toHaveLength(2));

    const page = await first.read();
    expect(page.arrivals).toBeNull();                              // a count it cannot vouch for is not a count
    expect(ids(page)).toEqual(["r-1", "msg_1#0", "d-2"]);          // the entry that landed still renders
    // The durable signal, on disk: this is what a restart has to read.
    expect(JSON.parse(readFileSync(join(root, "sess-D", "marker.json"), "utf8"))).toMatchObject({ degraded: true });

    // THE RESTART: a second server with a second store instance over the same root. Nothing in memory
    // carries over — the in-process latch is gone, and the marker is the only thing left saying so.
    const e2 = pushEngine();
    const second = await open(e2.engine, { getSessionMessages: readerOver(files), arrivalStore: fsArrivalStore(root) }, "sess-D");
    const afterRestart = await second.read();
    expect(afterRestart.arrivals).toBeNull();
    expect(ids(afterRestart)).toEqual(["r-1", "msg_1#0", "d-2"]);
    warn.mockRestore();
  });

  it.skipIf(noModeEnforcement)("a directory that cannot be written AT ALL latches in memory only — the spec's stated limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = tmpRoot("c13b");
    const files = { "sess-E": [ROW("r-1", "a question"), REPLY("r-2", "msg_1", "an answer")] };
    const e = pushEngine();
    const store = fsArrivalStore(root);
    const live = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: store }, "sess-E");

    e.push(PEER("e-1", "logged while the directory was writable"));
    await waitFor(async () => expect((await live.read()).arrivals).toEqual({ logged: 1, dropped: 0 }));

    const dir = join(root, "sess-E");
    chmodSync(dir, 0o500);
    try {
      e.push(PEER("e-2", "the write that could not land, nor say so"));
      await waitFor(() => expect(live.announced().map((m) => m.params.arrivalUuid)).toEqual(["e-1", "e-2"]));
      expect((await live.read()).arrivals).toBeNull();             // the in-process latch, doing its job
      // NOTHING DURABLE WAS WRITTEN, and this is the assertion the fixture exists to make: the fault that
      // made the store fail is the same one that stops it recording the failure.
      expect(existsSync(join(dir, "marker.json"))).toBe(false);
      expect(fsArrivalStore(root).isDegraded("sess-E")).toBe(false);
    } finally { chmodSync(dir, 0o700); }

    // So a restart reports counts again. That is the LIMIT the spec states — the latch dies with the
    // process — and pinning it here is what stops a later reading of criterion 13 from over-claiming.
    const e2 = pushEngine();
    const second = await open(e2.engine, { getSessionMessages: readerOver(files), arrivalStore: fsArrivalStore(root) }, "sess-E");
    expect((await second.read()).arrivals).toEqual({ logged: 1, dropped: 0 });
    warn.mockRestore();
  });

  it("a degrade landing between a reply's two reads still reaches the reply — the counts and the verdict are ONE snapshot", async () => {
    // TWO app-server processes can hold one session, so a reply that asked "are you degraded?" and then
    // "what are your counts?" has a window between the two questions, and the second process's degrade
    // lands in it: the reply then publishes numbers taken from a marker that had already stopped standing
    // behind them — a false completeness claim, which is the one direction this design forbids. The store
    // below is exactly that window made deterministic: healthy to the old two-call sequence, degraded to
    // the single snapshot the reply is required to use.
    const root = tmpRoot("c13c");
    const inner = fsArrivalStore(root);
    const degradedByAnotherProcess: ArrivalStore = { ...inner, isDegraded: () => false, countsSnapshot: () => null };
    const files = { "sess-F": [ROW("r-1", "a question")] };
    const e = pushEngine();
    const live = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: degradedByAnotherProcess }, "sess-F");

    e.push(PEER("f-1", "an arrival whose count another process can no longer vouch for"));
    // the numbers really are available
    await waitFor(() => expect(inner.counts("sess-F")).toEqual({ logged: 1, dropped: 0 }));
    expect((await live.read()).arrivals).toBeNull();                     // …and the reply still declines to claim them
  });
});

describe("`thread/delete` DESTROYS the arrivals, where `thread/clear` detaches them", () => {
  // The other half of D2, and the half a store keyed by session id does NOT give for free. Clear detaches
  // because the transcript survives and the entries stay with it; delete destroys the transcript, and the
  // full text of every peer message it received must not outlive it — nor be re-attachable to that id.
  const files = { "sess-G": [ROW("r-1", "a question"), REPLY("r-2", "msg_1", "an answer")] };

  it("removes the session's sidecar after the transcript delete succeeds, and the id then reads empty", async () => {
    const root = tmpRoot("del-a");
    const store = fsArrivalStore(root);
    const deleted: string[] = [];
    const e = pushEngine();
    const live = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: store, deleteSession: async (sid) => { deleted.push(sid); } }, "sess-G");

    e.push(PEER("g-1", "a peer message with a body worth erasing"));
    e.push(PEER("g-2", "and a second one"));
    await waitFor(() => expect(store.readAll("sess-G")).toHaveLength(2));
    expect(readFileSync(join(root, "sess-G", readdirSync(join(root, "sess-G"))[0]), "utf8")).toContain("worth erasing");

    // The live-guard refuses a delete on a session this server holds open, so the thread closes first —
    // which is exactly the sequence a client performs.
    await live.call("thread/close", { threadId: live.threadId });
    const reply = await live.call("thread/delete", { threadId: "sess-G" });
    expect(reply.result).toEqual({ ok: true });
    expect(deleted).toEqual(["sess-G"]);                    // the transcript went first
    expect(existsSync(join(root, "sess-G"))).toBe(false);   // …and the message text went with it

    // RE-ADMISSION STARTS EMPTY: nothing is left to reattach to a restored id.
    const e2 = pushEngine();
    const second = await open(e2.engine, { getSessionMessages: readerOver({ "sess-G": [] }), arrivalStore: fsArrivalStore(root) }, "sess-G");
    const page = await second.read();
    expect(page.data).toEqual([]);
    expect(page.arrivals).toEqual({ logged: 0, dropped: 0 });
  });

  it("a transcript delete that FAILS leaves the sidecar alone — the arrivals belong to a session that still exists", async () => {
    const root = tmpRoot("del-b");
    const store = fsArrivalStore(root);
    const e = pushEngine();
    const live = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: store, deleteSession: async () => { throw new Error("EBUSY"); } }, "sess-G");
    e.push(PEER("g-3", "an arrival on a session that survives"));
    await waitFor(() => expect(store.readAll("sess-G")).toHaveLength(1));

    await live.call("thread/close", { threadId: live.threadId });
    expect((await live.call("thread/delete", { threadId: "sess-G" })).error.code).toBe(-32603);
    expect(store.readAll("sess-G")).toHaveLength(1);
    expect(existsSync(join(root, "sess-G"))).toBe(true);
  });

  it("a sidecar that cannot be removed is REPORTED, not swallowed — and the thread is still announced deleted", async () => {
    // The transcript is gone either way, so a picker must drop the row; what must not happen is a `{ok:
    // true}` for a deletion that left the message bodies on disk. Loud beats wrong.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = tmpRoot("del-c");
    const inner = fsArrivalStore(root);
    const wedged: ArrivalStore = { ...inner, deleteSession: () => { throw new Error("EACCES"); } };
    const e = pushEngine();
    const live = await open(e.engine, { getSessionMessages: readerOver(files), arrivalStore: wedged, deleteSession: async () => {} }, "sess-G");
    const watcher = mkSink();
    const wc = live.srv.connect(watcher.sink);
    send(wc, { id: 1, method: "initialize", params: { clientInfo: { name: "w" }, watchThreads: true } });
    e.push(PEER("g-4", "an arrival whose sidecar cannot be removed"));
    await waitFor(() => expect(inner.readAll("sess-G")).toHaveLength(1));

    await live.call("thread/close", { threadId: live.threadId });
    const reply = await live.call("thread/delete", { threadId: "sess-G" });
    expect(reply.result).toBeUndefined();
    expect(reply.error.code).toBe(-32603);                  // ERR.INTERNAL, the handler's own failure idiom
    expect(String(reply.error.message)).toContain("arrival");
    expect(parsed(watcher.lines).some((m) => m.method === "thread/deleted")).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("(23) `arrivals.logged` equals the announcements the run made", () => {
  it("across a run of interleaved turns and arrivals, every page of the walk agrees with the notification count", async () => {
    const root = tmpRoot("c23a");
    const store = fsArrivalStore(root);
    // The engine persists what it emits, so a live frame becomes a row the reader returns: `rows` is
    // appended to as the run proceeds, which is what lets the anchors resolve at read time.
    const rows: unknown[] = [ROW("r-0", "the opening prompt")];
    const e = pushEngine();
    const run = await open(e.engine, { getSessionMessages: readerOver({ "sess-K": rows }), arrivalStore: store }, "sess-K");

    let arrivals = 0;
    for (let turn = 0; turn < 4; turn++) {
      const reply = REPLY(`r-${turn + 1}`, `msg_${turn}`, `answer ${turn}`);
      rows.push(reply);
      e.push(reply);
      for (let k = 0; k <= turn % 2; k++) e.push(PEER(`k-${turn}-${k}`, `peer message ${turn}.${k}`));
      arrivals += 1 + (turn % 2);
      await waitFor(() => expect(run.announced()).toHaveLength(arrivals));
    }

    const announced = run.announced().map((m) => m.params.arrivalUuid);
    expect(announced).toHaveLength(arrivals);
    expect(new Set(store.readAll("sess-K").map((entry: ArrivalEntry) => entry.id))).toEqual(new Set(announced));

    const pages = await run.walk(2);
    expect(pages[pages.length - 1].nextCursor).toBeNull();
    // THE EQUALITY, on the final page and — because a count a client sees only once is a count it cannot
    // check — on every page of the walk.
    expect(pages[pages.length - 1].arrivals).toEqual({ logged: announced.length, dropped: 0 });
    for (const page of pages) expect(page.arrivals).toEqual({ logged: announced.length, dropped: 0 });
    // Every announced arrival is also RENDERED somewhere in the walk: `logged` matching while the items
    // went missing would be a count of nothing.
    expect(new Set(pages.flatMap(ids).filter((id) => id.startsWith("k-")))).toEqual(new Set(announced));
  });

  it("…and the equality survives eviction, because `logged` is the PRE-eviction total", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = tmpRoot("c23b");
    const store = fsArrivalStore(root);
    const rows: unknown[] = [ROW("r-0", "the opening prompt")];
    const e = pushEngine();
    const run = await open(e.engine, { getSessionMessages: readerOver({ "sess-C": rows }), arrivalStore: store }, "sess-C");

    // Read off the store's own cap, never a literal: a cap change must redden this loudly rather than
    // quietly re-arithmetic itself into agreement.
    const sent = ARRIVAL_LOG_CAP + 3;
    for (let i = 0; i < sent; i++) e.push(PEER(`c-${String(i).padStart(2, "0")}`, `peer message ${i}`));
    await waitFor(() => expect(run.announced()).toHaveLength(sent));

    const announced = run.announced();
    expect(store.readAll("sess-C")).toHaveLength(ARRIVAL_LOG_CAP);   // the log really did evict
    const page = await run.read();
    expect(page.nextCursor).toBeNull();                 // one page, so this IS the final page
    expect(page.arrivals).toEqual({ logged: sent, dropped: sent - ARRIVAL_LOG_CAP });
    // The client can therefore see the gap: it received `ARRIVAL_LOG_CAP` marked items and is told
    // that more than that arrived.
    expect(page.data.filter((i) => i.origin)).toHaveLength(ARRIVAL_LOG_CAP);
    warn.mockRestore();
  });
});

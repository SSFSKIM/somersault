// test/unit/appserver/peer-inbound-log.test.ts — the observer's DURABLE half (M9 Stage B, criteria 6-16).
//
// Its sibling `peer-inbound.test.ts` pins the LIVE half and is deliberately untouched: it boots a server
// with no store and no reader override, which is the non-logging path, so it stays the regression net for
// every announce/adoption contract this file does not restate.
//
// What is actually hard here is the SEED WINDOW. The anchor is "the last filter-surviving frame this
// thread observed", and on attach or resume the observer has seen none — while the read that would tell
// it is asynchronous and frames land synchronously. So every interesting test below drives that window
// explicitly: a reader whose promise the test resolves by hand, frames and arrivals pushed inside it, and
// an assertion about what the entry ended up SAYING. A test that let the seed resolve first would prove
// none of it.
import { describe, it, expect, vi } from "vitest";
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { contentHash16, fsArrivalStore, type ArrivalStore } from "../../../src/peer/arrivalLog.js";

const dirs: string[] = [];
const tmpRoot = (tag: string): string => { const d = mkdtempSync(join(tmpdir(), `m9-${tag}-`)); dirs.push(d); return d; };
const fileCcxDir = tmpRoot("ccx");
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const mkSink = (log?: string[]) => {
  const lines: string[] = [];
  const sink = { write: (l: string) => { lines.push(l); log?.push(`note:${JSON.parse(l).method ?? "reply"}`); }, buffered: () => 0, end: () => {} } as PeerSink;
  return { lines, sink };
};
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const notes = (lines: string[], method: string) => parsed(lines).filter((m) => m.method === method);

/** peer-inbound.test.ts's engine fake, verbatim in shape: a test PUSHES frames, so the observer is driven
 *  by frame order rather than by promise order. */
function pushEngine() {
  const frameSubs = new Set<(f: unknown) => void>();
  const resultSubs = new Set<(r: unknown) => boolean>();
  return {
    engine: {
      onFrame: (cb: (f: unknown) => void) => { frameSubs.add(cb); return () => frameSubs.delete(cb); },
      onUnclaimedResult: (cb: (r: unknown) => boolean) => { resultSubs.add(cb); return () => resultSubs.delete(cb); },
      submit: async () => undefined,
      dispose: async () => {},
      interrupt: async () => {},
    } as any,
    push: (f: unknown) => { for (const s of [...frameSubs]) s(f); },
  };
}

const TS = "2026-08-30T00:00:00.000Z";
/** A transcript row as `getSessionMessages` returns one, and — pushed at the engine — a live frame that
 *  survives the reader's filter. One shape for both on purpose: the anchor's whole job is to name a row
 *  by what the observer saw live, so a test whose live frames and rows were different shapes would prove
 *  nothing about that identity. */
const ROW = (uuid: string, text: string, over: Record<string, unknown> = {}) => ({
  type: "user", uuid, session_id: "s", parent_tool_use_id: null,
  message: { role: "user", content: text }, timestamp: TS, ...over,
});
/** An arrival as the CLI stamps one. `isMeta: true` is the measured shape (spec M1/M2: the reader drops
 *  every `isMeta` row, which is WHY history loses the question) — so a peer frame is not filter-surviving
 *  and never advances the anchor onto itself. */
const PEER = (uuid: string, body: string) => ({
  type: "user", uuid, session_id: "s", isMeta: true, parent_tool_use_id: null,
  message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s1" hop-chain="a" from-name="peer" from-mode="prompting">${body}</cross-session-message>` },
  origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", fromSession: "s1", body, verifiedPeerPid: 4242 },
});
const INIT = (sessionId: string) => ({ type: "system", subtype: "init", session_id: sessionId });
const LIFECYCLE = (state: string, uuid: string) => ({ type: "command_lifecycle", command_uuid: uuid, state, session_id: "s", uuid: "f" });

type Reader = (sessionId: string, opts?: { limit?: number; offset?: number; cwd?: string }) => Promise<unknown[]>;
interface BootDeps { getSessionMessages?: Reader; arrivalStore?: ArrivalStore }

const boot = (engine: unknown, deps: BootDeps) =>
  new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => engine) as never, ...deps });

/** `resume` admits the thread WITH a session id (attach/resume), so the seed fires at install; without it
 *  the thread is admitted with none and seeds at the init frame — the fork shape. */
async function open(engine: any, deps: BootDeps, resume?: string, log?: string[]) {
  const srv = boot(engine, deps);
  const { lines, sink } = mkSink(log);
  const c = srv.connect(sink);
  send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  send(c, resume
    ? { id: 2, method: "thread/resume", params: { sessionId: resume, crossSessionInbound: "accept" } }
    : { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
  await tick();
  const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
  send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
  await tick();
  lines.length = 0;
  log?.splice(0, log.length);
  return { srv, c, lines, threadId, record: srv.registry.get(threadId)! };
}

/** A seed the test resolves BY HAND. Everything about the seed window is an ordering claim, and an
 *  ordering claim proved against a promise that resolves whenever the microtask queue drains is not
 *  proved at all. */
function heldReader(): { reader: Reader; resolve: (rows: unknown[]) => void } {
  let resolve!: (rows: unknown[]) => void;
  const pending = new Promise<unknown[]>((r) => { resolve = r; });
  return { reader: () => pending, resolve };
}

describe("the arrival log — one entry per announcement", () => {
  it("(6) writes exactly one entry per thread/peerMessage, and the id sets are equal", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c6"));
    const { lines } = await open(e.engine, { getSessionMessages: async () => [], arrivalStore: store }, "s6");
    for (const u of ["u-1", "u-2", "u-3"]) e.push(PEER(u, `msg ${u}`));
    await tick();

    const announced = notes(lines, "thread/peerMessage").map((m) => m.params.arrivalUuid);
    const logged = store.readAll("s6").map((entry) => entry.id);
    expect(announced).toHaveLength(3);
    expect(new Set(logged)).toEqual(new Set(announced));
    // …and the entry carries what the announcement carries, so the two channels cannot disagree about
    // WHAT arrived either.
    expect(store.readAll("s6").map((entry) => entry.text)).toEqual(["msg u-1", "msg u-2", "msg u-3"]);
    expect(store.readAll("s6")[0].origin).toEqual(PEER("u-1", "msg u-1").origin);
  });

  it("(7) every non-null anchor names a row the reader returns, after that row's predecessor, with its content hash", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c7"));
    // The engine persists as it emits, so a frame observed live becomes a row the reader returns — which
    // is exactly the property criterion 7 asserts, and it is only testable if the fixture models it.
    const rows: unknown[] = [ROW("r-1", "first"), ROW("r-2", "second")];
    const { record } = await open(e.engine, { getSessionMessages: async () => rows.slice(), arrivalStore: store }, "s7");

    e.push(PEER("a-1", "anchored at the seed tail"));
    const live = ROW("r-3", "said live");
    rows.push(live);
    e.push(live);
    e.push(PEER("a-2", "anchored at the live frame"));
    await tick();

    const uuids = rows.map((r: any) => r.uuid);
    for (const entry of store.readAll("s7")) {
      expect(entry.anchor).not.toBeNull();
      const at = uuids.indexOf(entry.anchor!.afterUuid);
      expect(at).toBeGreaterThanOrEqual(0);                                   // names a row that EXISTS
      expect(entry.anchor!.prevUuid).toBe(at > 0 ? uuids[at - 1] : null);     // …in the position it claims
      expect(entry.anchor!.fp).toEqual({ type: "user", hash: contentHash16((rows[at] as any).message.content), timestamp: TS });
    }
    expect(store.readAll("s7").map((entry) => entry.anchor!.afterUuid)).toEqual(["r-2", "r-3"]);
  });

  it("(8) logs an arrival that folded into an already-running adopted turn", async () => {
    // M7's positive control: a folded arrival persists NOTHING to the transcript, so this is the case no
    // transcript reader can ever recover and the one the log exists for.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c8"));
    const { lines } = await open(e.engine, { getSessionMessages: async () => [ROW("r-1", "first")], arrivalStore: store }, "s8");
    e.push(LIFECYCLE("started", "foreign-1"));
    await tick();
    e.push(PEER("folded-1", "folded into a running turn"));
    await tick();

    expect(notes(lines, "turn/started")).toHaveLength(1);
    expect(store.readAll("s8").map((entry) => entry.text)).toEqual(["folded into a running turn"]);
    expect(store.readAll("s8")[0].anchor!.afterUuid).toBe("r-1");
  });
});

describe("the structural rule", () => {
  it("an overridden reader with no store supplied logs nothing, and announces exactly as M8 did", async () => {
    // The write half of spec criterion 26. An embedder that overrode the reader owns a transcript this
    // machine does not, so the default store is withheld — and with no store there is no seed, no anchor
    // and no entry, only the live announcement the arrival always had.
    const e = pushEngine();
    let read = 0;
    const { lines, record } = await open(e.engine, { getSessionMessages: async () => { read++; return []; } }, "s26");
    e.push(PEER("a-1", "announced but not logged"));
    await tick();

    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    expect(record.peerInbound!.anchor).toBeUndefined();      // never seeded — nothing to seed FOR
    expect(record.peerInbound!.seeding).toBeNull();
    expect(read).toBe(0);
  });

  it("a store with no session id yet announces and writes nothing — the accepted pre-init limit", async () => {
    // The deviation, pinned so it cannot drift into something else: before an id exists there is no scope
    // to key an entry by, so the arrival takes M8's path exactly. What must NOT happen is a durable entry
    // guessing at a scope, or silence.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("pre-init"));
    const { lines, record } = await open(e.engine, { getSessionMessages: async () => [ROW("r-1", "history")], arrivalStore: store });
    e.push(PEER("a-1", "arrived before the engine said who it was"));
    await tick();

    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    expect(record.peerInbound!.seeded).toBe(false);
    expect(store.readAll("anything")).toHaveLength(0);
  });

  it("a filter-surviving frame seen before the id NEVER becomes the anchor, and the seed still runs at init", async () => {
    // The bug this pins: a pre-init frame that advanced the anchor also made the observer believe it had
    // seeded, so the seed never ran and every later arrival was logged at `prevUuid: null` — the top of a
    // transcript with a hundred rows in it.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("pre-init-frame"));
    const rows = [ROW("r-1", "one"), ROW("r-2", "two")];
    const { record } = await open(e.engine, { getSessionMessages: async () => rows.slice(), arrivalStore: store });

    e.push(ROW("early", "observed before the id was known"));
    await tick();
    expect(record.peerInbound!.anchor).toBeUndefined();      // it advanced NOTHING

    e.push(INIT("late-session"));
    await tick();
    e.push(PEER("a-1", "after the seed finally ran"));
    await tick();

    const [entry] = store.readAll("late-session");
    expect(entry.anchor).toEqual({ afterUuid: "r-2", prevUuid: "r-1", fp: { type: "user", hash: contentHash16("two"), timestamp: TS } });
  });

  it("an arrival on the SAME frame batch that reveals the id is buffered, then logged", async () => {
    // No `tick` between the two: the seed read is in flight when the arrival lands, which is the ordinary
    // shape rather than an exotic one — the id is revealed by a frame, and the next frame can be an arrival.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("same-batch"));
    const { lines } = await open(e.engine, { getSessionMessages: async () => [ROW("r-1", "copied")], arrivalStore: store });

    e.push(INIT("same-batch-session"));
    e.push(PEER("a-1", "no tick in between"));
    expect(store.readAll("same-batch-session")).toHaveLength(0);   // still held — the read has not resolved
    expect(notes(lines, "thread/peerMessage")).toHaveLength(0);
    await tick();

    const [entry] = store.readAll("same-batch-session");
    expect(entry.id).toBe("a-1");
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    // Nothing observed relates it to the row the seed returned, so it is withheld rather than placed —
    // and it is never anchored `null`, which would claim it preceded that row.
    expect(entry.ambiguous).toBe(true);
    expect(entry.anchor).not.toBeNull();
  });
});

describe("durability", () => {
  it("(10) the entry is written BEFORE the notification goes out", async () => {
    const e = pushEngine();
    const order: string[] = [];
    const inner = fsArrivalStore(tmpRoot("c10a"));
    const store: ArrivalStore = { ...inner, append(entry) { inner.append(entry); order.push("append"); } };
    await open(e.engine, { getSessionMessages: async () => [], arrivalStore: store }, "s10a", order);
    e.push(PEER("a-1", "persist first"));
    await tick();

    // Killing the process between the two leaves an entry with no notification, never the reverse.
    expect(order.filter((s) => s === "append" || s === "note:thread/peerMessage"))
      .toEqual(["append", "note:thread/peerMessage"]);
  });

  it("(10) a write that throws still announces, and latches the session degraded", async () => {
    const e = pushEngine();
    const inner = fsArrivalStore(tmpRoot("c10b"));
    let thrown = false;
    const store: ArrivalStore = { ...inner, append(entry) { if (!thrown) { thrown = true; throw new Error("ENOSPC"); } inner.append(entry); } };
    const { lines, record } = await open(e.engine, { getSessionMessages: async () => [], arrivalStore: store }, "s10b");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    e.push(PEER("a-1", "the write that failed"));
    await tick();
    // The live channel reports what the ENGINE did, and the engine delivered the message whether or not
    // our sidecar could record it. What must not happen is silence about the gap.
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    expect(store.readAll("s10b")).toHaveLength(0);
    expect(store.isDegraded("s10b")).toBe(true);
    expect(record.peerInbound!.degraded).toBe(true);

    // …and the observer keeps going: the next arrival is logged, on a session that stays degraded.
    e.push(PEER("a-2", "after the failure"));
    await tick();
    expect(store.readAll("s10b").map((entry) => entry.id)).toEqual(["a-2"]);
    expect(store.isDegraded("s10b")).toBe(true);
    // The marker is the durable signal; this is the one an operator reads, and it has to name the session
    // and carry the reason (ENOSPC, EACCES) the marker cannot hold.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("s10b");
    expect(String(warn.mock.calls[0][1])).toContain("ENOSPC");
    warn.mockRestore();
  });

  it("(11) seq keeps counting across a restart, so two same-anchor arrivals stay ordered", async () => {
    const root = tmpRoot("c11");
    const rows = [ROW("r-1", "first")];
    const reader = async () => rows.slice();

    const first = pushEngine();
    await open(first.engine, { getSessionMessages: reader, arrivalStore: fsArrivalStore(root) }, "s11");
    first.push(PEER("a-1", "before the restart"));
    await tick();

    // A NEW store instance over the same root is the restart: nothing in memory carries over, and the
    // counter has to be seeded from what is on disk or the second entry sorts before the first.
    const second = pushEngine();
    await open(second.engine, { getSessionMessages: reader, arrivalStore: fsArrivalStore(root) }, "s11");
    second.push(PEER("a-2", "after the restart"));
    await tick();

    const entries = fsArrivalStore(root).readAll("s11");
    expect(entries.map((entry) => entry.id)).toEqual(["a-1", "a-2"]);
    expect(entries[1].seq).toBeGreaterThan(entries[0].seq);
    expect(entries[0].anchor!.afterUuid).toBe(entries[1].anchor!.afterUuid);   // same anchor: seq is the only order
  });
});

describe("the seed window", () => {
  it("(12) an arrival racing the seed is held until it resolves, then persisted — never anchored null", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c12a"));
    const { reader, resolve } = heldReader();
    const { lines } = await open(e.engine, { getSessionMessages: reader, arrivalStore: store }, "s12a");

    e.push(PEER("a-1", "arrived while the seed was in flight"));
    await tick();
    // Nothing durable is wrong yet BECAUSE nothing is durable yet.
    expect(store.readAll("s12a")).toHaveLength(0);
    expect(notes(lines, "thread/peerMessage")).toHaveLength(0);

    resolve([ROW("r-1", "a row the observer never saw")]);
    await tick();
    const [entry] = store.readAll("s12a");
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    // No live frame relates this arrival to that row, and the seed cannot: the reader drops arrivals, so
    // the buffer establishes no overlap. Ambiguous is the honest answer; the seed tail would render the
    // question after its own answer, and `null` would claim it preceded all history.
    expect(entry.ambiguous).toBe(true);
    expect(entry.anchor).not.toBeNull();
  });

  it("(12) …and it anchors on the live frame when one was observed before it", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c12b"));
    const { reader, resolve } = heldReader();
    await open(e.engine, { getSessionMessages: reader, arrivalStore: store }, "s12b");

    e.push(ROW("f-1", "observed live, inside the window"));
    e.push(PEER("a-1", "after a frame this process actually saw"));
    await tick();
    resolve([ROW("r-1", "the seed's own tail")]);
    await tick();

    const [entry] = store.readAll("s12b");
    expect(entry.ambiguous).toBeUndefined();
    expect(entry.anchor).toEqual({ afterUuid: "f-1", prevUuid: "r-1", fp: { type: "user", hash: contentHash16("observed live, inside the window"), timestamp: TS } });
  });

  it("(12b) a thread admitted with NO session id seeds at the init frame, and grounds on the copied tail", async () => {
    // The fork shape: fork admission deliberately leaves `record.sessionId` undefined while the fork
    // already carries copied history. Grounding confirmed-empty "because there is no id yet" would render
    // its first arrival at the top of a history it did not precede.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c12c"));
    const seen: string[] = [];
    const rows = [ROW("copied-1", "copied"), ROW("copied-2", "copied tail")];
    const reader = async (sessionId: string) => { seen.push(sessionId); return rows.slice(); };
    const { record } = await open(e.engine, { getSessionMessages: reader, arrivalStore: store });
    expect(record.sessionId).toBeUndefined();
    expect(seen).toHaveLength(0);                       // nothing to seed against yet — and nothing guessed

    e.push(INIT("forked-session"));
    await tick();
    e.push(PEER("a-1", "the fork's first arrival"));
    await tick();

    expect(seen).toEqual(["forked-session"]);
    const [entry] = store.readAll("forked-session");
    expect(entry.sessionId).toBe("forked-session");
    expect(entry.anchor).toEqual({ afterUuid: "copied-2", prevUuid: "copied-1", fp: { type: "user", hash: contentHash16("copied tail"), timestamp: TS } });
  });

  it("(15) an arrival with no relatable order is persisted ambiguous, and still counted", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c15"));
    const { reader, resolve } = heldReader();
    await open(e.engine, { getSessionMessages: reader, arrivalStore: store }, "s15");

    e.push(PEER("a-1", "the question"));
    await tick();
    // The seed holds rows the observer never saw live — the arrival's own answer among them.
    resolve([ROW("r-1", "the question, as the CLI re-rendered it"), ROW("r-2", "the answer to it")]);
    await tick();

    const [entry] = store.readAll("s15");
    // THE FLAG IS THE WITHHOLDING, and the anchor field is not. Criterion 12 requires this entry not be
    // anchored `null` (that would claim it preceded all history), so what is recorded is the ground the
    // seed produced — and `ambiguous` is what stops the read side from ever placing it there, which is how
    // "never rendered after its own answer" is delivered without collapsing `null`'s one meaning.
    expect(entry.ambiguous).toBe(true);
    expect(entry.anchor).not.toBeNull();
    expect(store.counts("s15").logged).toBe(1);              // withheld from placement, still counted
  });
});

describe("grounding survives seed/buffer overlap", () => {
  /** One shape per call: buffer `frames` and one trailing arrival inside the seed window, resolve the seed
   *  with `seed`, and report what the entries ended up saying. */
  async function overlap(tag: string, seed: unknown[], buffered: unknown[], leading = false) {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot(tag));
    const { reader, resolve } = heldReader();
    await open(e.engine, { getSessionMessages: reader, arrivalStore: store }, tag);
    if (leading) e.push(PEER("a-0", "buffered before every frame"));
    for (const f of buffered) e.push(f);
    e.push(PEER("a-1", "buffered after every frame"));
    await tick();
    resolve(seed);
    await tick();
    return store.readAll(tag);
  }

  it("(14) seed-behind: no overlap at all grounds on the seed's tail", async () => {
    const entries = await overlap("ov1", [ROW("r-1", "one"), ROW("r-2", "two")], [ROW("f-3", "three")]);
    expect(entries.map((entry) => entry.anchor)).toEqual([
      { afterUuid: "f-3", prevUuid: "r-2", fp: { type: "user", hash: contentHash16("three"), timestamp: TS } },
    ]);
  });

  it("(14) seed-ahead: a buffer wholly contained in the seed grounds before its first frame", async () => {
    const entries = await overlap("ov2", [ROW("r-1", "one"), ROW("f-2", "two"), ROW("f-3", "three")], [ROW("f-2", "two"), ROW("f-3", "three")]);
    // Every buffered frame counts exactly once: the chain grounds on the row BEFORE the first of them and
    // replays the buffer from its start, so `f-2` is not both the ground and a replayed step.
    expect(entries[0].anchor).toEqual({ afterUuid: "f-3", prevUuid: "f-2", fp: { type: "user", hash: contentHash16("three"), timestamp: TS } });
  });

  it("(14) partial overlap: the seed's tail is also the buffer's head", async () => {
    const entries = await overlap("ov3", [ROW("r-1", "one"), ROW("f-2", "two")], [ROW("f-2", "two"), ROW("f-3", "three")]);
    expect(entries[0].anchor).toEqual({ afterUuid: "f-3", prevUuid: "f-2", fp: { type: "user", hash: contentHash16("three"), timestamp: TS } });
  });

  it("(14) an arrival buffered before a row the seed also returned anchors BEFORE that row", async () => {
    const entries = await overlap("ov4", [ROW("r-1", "one"), ROW("f-2", "two")], [ROW("f-2", "two"), ROW("f-3", "three")], true);
    expect(entries.map((entry) => entry.id)).toEqual(["a-0", "a-1"]);
    // `a-0` was observed before the frame the seed also holds, so it belongs before that row — not after
    // the whole seed, and not ambiguous: the overlap is exactly what makes its order knowable.
    expect(entries[0].ambiguous).toBeUndefined();
    expect(entries[0].anchor).toEqual({ afterUuid: "r-1", prevUuid: null, fp: { type: "user", hash: contentHash16("one"), timestamp: TS } });
    expect(entries[1].anchor!.afterUuid).toBe("f-3");
  });

  it("a uuid occurring TWICE in the seed establishes no overlap — never a ground before its first copy", async () => {
    // The duplicate-uuid overlap. Taking the first occurrence of `[X, r-2, X]` grounds on `rows[-1]`, i.e.
    // `null`, i.e. confirmed-empty over a seed that plainly held rows — an unflagged placement at the top
    // of history. Two occurrences mean the frame relates buffer to seed at inconsistent positions, so it
    // relates them not at all: fall through to the tail, and let the leading arrival be ambiguous.
    const entries = await overlap("dup1", [ROW("X", "first occurrence"), ROW("r-2", "between"), ROW("X", "second occurrence")], [ROW("X", "second occurrence")], true);
    expect(entries.map((entry) => entry.id)).toEqual(["a-0", "a-1"]);
    expect(entries[0].ambiguous).toBe(true);                  // withheld, counted, never placed
    expect(entries[0].anchor).not.toBeNull();                 // and never confirmed-empty over a non-empty seed
    expect(entries[0].anchor!.prevUuid).toBe("r-2");          // the TAIL, not the row before the first copy
  });

  it("…and the same holds when neither copy is the seed's first row", async () => {
    const entries = await overlap("dup2", [ROW("r-1", "one"), ROW("X", "first"), ROW("r-3", "three"), ROW("X", "second")], [ROW("X", "second")], true);
    expect(entries[0].ambiguous).toBe(true);
    expect(entries[0].anchor!.afterUuid).toBe("X");
    expect(entries[0].anchor!.prevUuid).toBe("r-3");          // grounded on the tail, not on `r-1` before the first copy
  });

  it("a single occurrence whose CONTENT disagrees is not the frame we saw, so it grounds nothing", async () => {
    // A row rebound by the reader's last-wins keying carries the buffered frame's uuid at a position it
    // never held. The fingerprint recorded live is what catches it, and the answer is the same: no usable
    // overlap, ground on the tail, leading arrivals ambiguous.
    const entries = await overlap("dup3", [ROW("r-1", "one"), ROW("X", "rewritten content")], [ROW("X", "what we actually observed")], true);
    expect(entries[0].ambiguous).toBe(true);
    expect(entries[0].anchor!.afterUuid).toBe("X");           // the tail…
    expect(entries[0].anchor!.prevUuid).toBe("r-1");          // …rather than a ground before it
    expect(entries[0].anchor!.fp.hash).toBe(contentHash16("rewritten content"));
  });

  it("(14) an empty seed grounds confirmed-empty, which is the ONLY thing a null anchor means", async () => {
    const entries = await overlap("ov5", [], []);
    expect(entries[0].anchor).toBeNull();
    expect(entries[0].ambiguous).toBeUndefined();
  });
});

describe("the recorded fingerprint", () => {
  it("(16) records the anchor row's own position and content, not merely its uuid", async () => {
    // M5's measured shape: one uuid occurring twice with different parents and different content. What is
    // recorded has to be enough for the read side to reject the wrong occurrence, so it is the occurrence
    // the observer grounded on — position included — that must be written down.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c16a"));
    const seed = [ROW("dup", "the first occurrence"), ROW("r-2", "between them"), ROW("dup", "the second occurrence")];
    await open(e.engine, { getSessionMessages: async () => seed.slice(), arrivalStore: store }, "s16a");
    e.push(PEER("a-1", "after the duplicate"));
    await tick();

    expect(store.readAll("s16a")[0].anchor).toEqual({
      afterUuid: "dup", prevUuid: "r-2",
      fp: { type: "user", hash: contentHash16("the second occurrence"), timestamp: TS },
    });
  });

  it("(16) a frame that carried no timestamp records none — an absent field constrains nothing", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c16b"));
    await open(e.engine, { getSessionMessages: async () => [], arrivalStore: store }, "s16b");
    e.push(ROW("f-1", "no timestamp on this one", { timestamp: undefined }));
    e.push(PEER("a-1", "after the undated frame"));
    await tick();

    const fp = store.readAll("s16b")[0].anchor!.fp;
    expect(fp).toEqual({ type: "user", hash: contentHash16("no timestamp on this one") });
    expect("timestamp" in fp).toBe(false);   // omitted, not `undefined` — the read side matches on presence
  });

  it("(16) a frame that carried one records it verbatim", async () => {
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c16c"));
    await open(e.engine, { getSessionMessages: async () => [], arrivalStore: store }, "s16c");
    e.push(ROW("f-1", "dated", { timestamp: "2026-08-30T12:34:56.789Z", type: "assistant" }));
    e.push(PEER("a-1", "after the dated frame"));
    await tick();

    expect(store.readAll("s16c")[0].anchor!.fp).toEqual({
      type: "assistant", hash: contentHash16("dated"), timestamp: "2026-08-30T12:34:56.789Z",
    });
  });
});

describe("Stage C reads back exactly what Stage B wrote", () => {
  it("(9) the arrivals the observer logged are on the next thread/read, anchored where they landed", async () => {
    // This cell pinned the INVERSE while Stage B stood alone: nothing read the log yet, so a populated
    // one had to be invisible on the wire — true only "until the projector lands", which is what Task 4
    // is. The fixture is unchanged and now states the round trip end to end, through a REAL
    // `fsArrivalStore` rather than a fake: the observer wrote these entries from live frames, and the
    // pager resolved them against the rows the reader returned. Nothing else about the page moves.
    const e = pushEngine();
    const store = fsArrivalStore(tmpRoot("c9"));
    const rows = [
      ROW("r-1", "a question"),
      ROW("r-2", "an answer", { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "an answer" }] } }),
    ];
    const { c, lines, threadId } = await open(e.engine, { getSessionMessages: async () => rows.slice(), arrivalStore: store }, "s9");

    send(c, { id: 20, method: "thread/read", params: { threadId } });
    await tick();
    const before = parsed(lines).find((m) => m.id === 20)!.result;
    expect(before.data.length).toBeGreaterThan(0);

    e.push(PEER("a-1", "a logged arrival"));
    e.push(PEER("a-2", "and another"));
    await tick();
    expect(store.readAll("s9")).toHaveLength(2);

    lines.length = 0;
    send(c, { id: 21, method: "thread/read", params: { threadId } });
    await tick();
    const after = parsed(lines).find((m) => m.id === 21)!.result;

    // The transcript's own items are untouched, element for element — an arrival rides a row, it does not
    // displace one.
    expect(after.data.slice(0, before.data.length)).toEqual(before.data);
    // Both entries anchored on the seed's LAST row (no live frame advanced the anchor past it), so they
    // emit after it, in the store's `(seq, id)` order.
    expect(after.data.slice(before.data.length).map((i: any) => [i.id, i.text, i.type])).toEqual([
      ["a-1", "a logged arrival", "userMessage"],
      ["a-2", "and another", "userMessage"],
    ]);
    for (const item of after.data.slice(before.data.length)) expect(item.origin).toMatchObject({ kind: "peer", verifiedPeerPid: 4242 });
    // The cursor is untouched: an arrival rides a row, so the coordinate space the client pages through
    // is the one it already had.
    expect(after.nextCursor).toBe(before.nextCursor);
    // The counts come off the store, and they agree with what rendered here because every anchor resolved.
    expect(before.arrivals).toEqual({ logged: 0, dropped: 0 });
    expect(after.arrivals).toEqual({ logged: 2, dropped: 0 });
  });
});

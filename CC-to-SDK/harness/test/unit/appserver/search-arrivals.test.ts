// test/unit/appserver/search-arrivals.test.ts — M9 Stage D, Task 5: `thread/searchOccurrences` scans the
// retained arrivals at their anchors, and its `arrivals` counts say when eviction has hidden some.
//
// EVERY TEST HERE BOOTS THE REAL SERVER and drives it over the real wire (search.test.ts's harness), and
// every one that merges injects BOTH halves of the structural rule (spec: Store injection) —
// `deps.getSessionMessages` AND `deps.arrivalStore` — because supplying only the reader is how an embedder
// says "do not merge". Nothing here mocks `searchScan.ts` or `arrivalsReply.ts`: the assertions are on the
// wire replies, so a scanner that agrees with its own test and disagrees with `thread/read` still goes red.
// The two round-trip rows are exactly that cross-check — an occurrence's `readCursor` is pasted into
// `thread/read` unchanged and the page it returns has to hold the arrival.
//
// The sibling `search.test.ts` is deliberately untouched: it boots with a reader and no store, which is the
// non-merging path, and so remains the regression net for the row scan itself.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { decodeOccCursor, encodeOccCursor, fingerprint } from "../../../src/appserver/searchScan.js";
import { rawTextOf } from "../../../src/peer/address.js";
import { ARRIVAL_LOG_CAP, contentHash16, fsArrivalStore, type ArrivalAnchor, type ArrivalEntry, type ArrivalStore } from "../../../src/peer/arrivalLog.js";
import { ASSISTANT, ORIGIN, TS, USER, entryBuilder } from "./items/corpus.js";

// ── wire harness ──────────────────────────────────────────────────────────────────────────────────────
const mkSink = () => { const ls: string[] = []; return { lines: ls, sink: { write: (l: string) => void ls.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parse = (ls: string[]) => ls.map((l) => JSON.parse(l) as any);
const servers: AppServer[] = [];
const temps: string[] = [];
let conn!: { feed(chunk: string): void };
let lines!: string[];
let nextId = 100;

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}
afterEach(async () => {
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const send = async (method: string, params: unknown): Promise<any> => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  for (let i = 0; i < 400; i++) {
    const hit = parse(lines).find((m) => m.id === id);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${method} (id ${id}) within 2s`);
};
const occ = (params: Record<string, unknown>) => send("thread/searchOccurrences", params);
const read = (params: Record<string, unknown>) => send("thread/read", params);
const mkTmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────
const SESSION = "sess-search-arrivals";

/** A row with NULL search text that is nonetheless a perfectly good anchor: the reader returns it, the
 *  observer could name it, and `rowSearchText` classifies it out of the corpus. */
const TOOL_RESULT = (uuid: string, toolId: string) =>
  ({ type: "user", uuid, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "done" }] }, timestamp: TS });

/** The anchor as the observer would have written it for `row`, whose predecessor is `prev` (`null` = the
 *  arrival precedes every row the seed returned). Derived from the row rather than hand-written, so a
 *  fixture cannot drift from the fingerprint the live side records. */
const anchorOf = (row: any, prev: any | null): ArrivalAnchor => ({
  afterUuid: String(row.uuid),
  prevUuid: prev ? String(prev.uuid) : null,
  fp: { type: String(row.type), hash: contentHash16(rawTextOf(row.message?.content)), ...(row.timestamp ? { timestamp: row.timestamp as string } : {}) },
});

const ENTRY = entryBuilder(SESSION);

/** The store as Task 1 defines it, in memory. `readAll` hands the entries back in `(seq, id)` order — the
 *  order the fixture lists them in — and `counts` reports the PRE-eviction total. */
const fakeStore = (entries: ArrivalEntry[], over: { dropped?: number; degraded?: boolean } = {}): ArrivalStore => ({
  append() {},
  readAll: () => entries,
  counts: () => ({ logged: entries.length + (over.dropped ?? 0), dropped: over.dropped ?? 0 }),
  // The operation the reply actually consults: counts and verdict from one snapshot, `null` for degraded.
  countsSnapshot: () => over.degraded === true ? null : { logged: entries.length + (over.dropped ?? 0), dropped: over.dropped ?? 0 },
  nextSeq: () => entries.length,
  isDegraded: () => over.degraded === true,
  markDegraded() {},
  deleteSession() {},
});

interface Booted { srv: AppServer; threadId: string; epoch: number; recordId: string; calls: Array<{ offset?: number; limit?: number }> }

/** A LIVE thread over `rows` (the record's `sessionId` comes from the engine, search.test.ts's pattern), so
 *  every occurrence has an epoch to qualify a jump with. `calls` records the BOUNDED reads only. */
async function bootLive(rows: unknown[], store?: ArrivalStore, sessionId = SESSION): Promise<Booted> {
  const calls: Array<{ offset?: number; limit?: number }> = [];
  const getSessionMessages = async (_id: string, o?: { offset?: number; limit?: number }) => {
    if (!o) return rows;
    calls.push({ offset: o.offset, limit: o.limit });
    const from = o.offset ?? 0;
    return rows.slice(from, o.limit === undefined ? undefined : from + o.limit);
  };
  const srv = boot({
    getSessionMessages,
    getSessionInfo: async (id: string) => ({ sessionId: id, summary: "s", lastModified: 5_000, createdAt: 1_000 }) as never,
    ...(store ? { arrivalStore: store } : {}),
    sessionFactory: (() => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId })) as never,
  });
  await send("thread/start", {});
  const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
  const record = srv.registry.get(threadId)!;
  return { srv, threadId, epoch: record.epoch, recordId: record.id, calls };
}

/** A COLD session: no live record, so `thread/searchOccurrences` reaches it by bare store id and has no
 *  epoch to compose a jump from. */
function bootCold(rows: unknown[], store?: ArrivalStore, sessionId = SESSION): void {
  boot({
    getSessionMessages: async (_id: string, o?: { offset?: number; limit?: number }) => {
      const from = o?.offset ?? 0;
      return o ? rows.slice(from, o.limit === undefined ? undefined : from + o.limit) : rows;
    },
    getSessionInfo: async (id: string) => (id === sessionId ? ({ sessionId: id, summary: "s", lastModified: 5_000, createdAt: 1_000 } as never) : undefined),
    ...(store ? { arrivalStore: store } : {}),
  });
}

const shape = (r: any) => r.result.data.map((o: any) => [o.rowOffset, o.uuid, o.snippet]);

// ── criterion 27 — a retained arrival's text is findable, and its jump lands ────────────────────────────
describe("criterion 27 — the arrival is findable at its anchor", () => {
  it("a retained arrival's text is found, published at the ANCHOR's coordinates, and its readCursor lands a thread/read page holding it", async () => {
    const rows = [ASSISTANT("r0", "m0", "an earlier answer"), ASSISTANT("r1", "m1", "answering the peer")];
    const entry = ENTRY("arr-find", "please ship the needle release", anchorOf(rows[0], null));
    const { threadId, epoch } = await bootLive(rows, fakeStore([entry]));

    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    // The occurrence publishes the ANCHOR's row and the ENTRY's id — an arrival has no row of its own.
    expect(shape(r)).toEqual([[0, "arr-find", "please ship the needle release"]]);
    expect(r.result.data[0].snippet.slice(r.result.data[0].snippetMatchRange.start, r.result.data[0].snippetMatchRange.end)).toBe("needle");
    expect(r.result.data[0].readCursor).toBe(`${epoch}:1`);
    expect(r.result.arrivals).toEqual({ logged: 1, dropped: 0 });

    // THE CROSS-SURFACE CONTRACT: the cursor is pasted back UNCHANGED and the page holds the arrival.
    const page = await read({ threadId, cursor: r.result.data[0].readCursor, limit: 100 });
    expect(page.error).toBeUndefined();
    expect(page.result.data.map((i: any) => i.id)).toContain("arr-find");
    expect(JSON.stringify(page.result.data)).toContain("please ship the needle release");
  });

  it("an arrival anchored to a NON-first row round-trips too — the jump is the anchor's, not row zero's", async () => {
    const rows = [ASSISTANT("r0", "m0", "one"), ASSISTANT("r1", "m1", "two"), ASSISTANT("r2", "m2", "three")];
    const entry = ENTRY("arr-mid", "the needle landed mid-thread", anchorOf(rows[1], rows[0]));
    const { threadId, epoch } = await bootLive(rows, fakeStore([entry]));

    const r = await occ({ threadId, searchTerm: "needle" });
    expect(shape(r)).toEqual([[1, "arr-mid", "the needle landed mid-thread"]]);
    expect(r.result.data[0].readCursor).toBe(`${epoch}:2`);
    const page = await read({ threadId, cursor: `${epoch}:2`, limit: 100 });
    expect(page.result.data.map((i: any) => i.id)).toContain("arr-mid");
  });

  it("the entries scan in the store's (seq, id) order, AFTER the text of the row they are anchored to", async () => {
    const rows = [ASSISTANT("r0", "m0", "a needle in the row itself")];
    const a = ENTRY("arr-a", "needle a", anchorOf(rows[0], null));
    const b = ENTRY("arr-b", "needle b", anchorOf(rows[0], null));
    const { threadId } = await bootLive(rows, fakeStore([a, b]));
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(shape(r)).toEqual([[0, "r0", "a needle in the row itself"], [0, "arr-a", "needle a"], [0, "arr-b", "needle b"]]);
  });

  it("after filling past the cap the EVICTED arrival's text is not found, and the reply says dropped > 0", async () => {
    // The real store, really evicting: `arrivals.dropped` is what distinguishes exhaustion from proof of
    // absence, so it is asserted against a log that actually shed an entry rather than against a fake count.
    const rows = [ASSISTANT("r0", "m0", "the anchor row")];
    const anchor = anchorOf(rows[0], null);
    const real = fsArrivalStore(mkTmp("m9-arrivals-"));
    const total = ARRIVAL_LOG_CAP + 1;
    for (let i = 0; i < total; i++) {
      real.append({ v: 1, id: `arr-${String(i).padStart(2, "0")}`, sessionId: SESSION, anchor, seq: i, observedAt: TS, origin: ORIGIN, text: `needle-${String(i).padStart(2, "0")}` });
    }
    const { threadId } = await bootLive(rows, real);

    const r = await occ({ threadId, searchTerm: "needle", limit: 50 });
    expect(r.error).toBeUndefined();
    const found = r.result.data.map((o: any) => o.snippet);
    expect(found).toHaveLength(ARRIVAL_LOG_CAP);
    expect(found).not.toContain("needle-00");                     // the evicted one is genuinely gone
    expect(found).toContain(`needle-${String(total - 1).padStart(2, "0")}`);
    // …and the reply says so, which is the only thing that keeps "not found" honest.
    expect(r.result.arrivals).toEqual({ logged: total, dropped: 1 });
  });

  it("a null-anchored arrival is findable at row 0 with an `epoch:1` jump — and is not enumerable at all in an empty transcript", async () => {
    const rows = [ASSISTANT("r0", "m0", "the first row"), ASSISTANT("r1", "m1", "the second")];
    const entry = ENTRY("arr-top", "the needle got there first", null);
    const { threadId, epoch } = await bootLive(rows, fakeStore([entry]));

    const r = await occ({ threadId, searchTerm: "needle" });
    expect(shape(r)).toEqual([[0, "arr-top", "the needle got there first"]]);
    expect(r.result.data[0].readCursor).toBe(`${epoch}:1`);
    // rev 8.3: a one-row window discards nothing, so the atStart head really does render on that page.
    const page = await read({ threadId, cursor: `${epoch}:1`, limit: 100 });
    expect(page.result.data.map((i: any) => i.id)).toContain("arr-top");

    // An EMPTY transcript has no row coordinate to publish, so the occurrence shape cannot carry it — the
    // `arrivals` counts are what say the entry exists at all.
    const empty = await bootLive([], fakeStore([ENTRY("arr-alone", "a needle with nowhere to go", null)]));
    const none = await occ({ threadId: empty.threadId, searchTerm: "needle" });
    expect(none.result.data).toEqual([]);
    expect(none.result.nextCursor).toBeNull();
    expect(none.result.arrivals).toEqual({ logged: 1, dropped: 0 });
  });

  it("a COLD session's arrival occurrence publishes readCursor: null — the pager is live-only, and a jump that cannot land is not published", async () => {
    const rows = [ASSISTANT("r0", "m0", "the anchor row")];
    bootCold(rows, fakeStore([ENTRY("arr-cold", "a needle from a peer", anchorOf(rows[0], null))]));
    const r = await occ({ threadId: SESSION, searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    expect(shape(r)).toEqual([[0, "arr-cold", "a needle from a peer"]]);
    expect(r.result.data[0].readCursor).toBeNull();
  });

  it("an arrival anchored to a NULL-SEARCH-TEXT row is still scanned — the anchor is a row, not a corpus entry", async () => {
    // The row is out of the corpus (`rowSearchText` answers null for a tool result), and the pre-M9 loop
    // `continue`d past it. An arrival that landed after one would then be invisible forever.
    const rows = [ASSISTANT("r0", "m0", "running the tool"), TOOL_RESULT("r1", "toolu_1"), ASSISTANT("r2", "m2", "and back")];
    const entry = ENTRY("arr-quiet", "a needle while the tool ran", anchorOf(rows[1], rows[0]));
    const { threadId, epoch } = await bootLive(rows, fakeStore([entry]));

    const r = await occ({ threadId, searchTerm: "needle" });
    expect(shape(r)).toEqual([[1, "arr-quiet", "a needle while the tool ran"]]);
    expect(r.result.data[0].readCursor).toBe(`${epoch}:2`);
    // …and the oversized-row exit is the other one it must run outside of: a row too large to search is
    // still an anchor. (The row scan discloses it through `skipped`; the arrival is found regardless.)
    const huge = { ...ASSISTANT("r1", "m1", "x".repeat(1_048_577)) };
    const over = [ASSISTANT("r0", "m0", "prelude"), huge];
    const oversized = await bootLive(over, fakeStore([ENTRY("arr-huge", "a needle behind a huge row", anchorOf(huge, over[0]))]));
    const r2 = await occ({ threadId: oversized.threadId, searchTerm: "needle" });
    expect(shape(r2)).toEqual([[1, "arr-huge", "a needle behind a huge row"]]);
    expect(r2.result.skipped).toBe(1);
  });

  it("an arrival anchored at a RESUMED window's first row is found — the one-row lookbehind verifies its predecessor", async () => {
    // Rows 0-4 each hold one hit, so `limit: 5` ends page 1 inside row 4's text and page 2 resumes AT row 4
    // — whose predecessor (row 3) this page never fetches as part of its window. Without the peel the
    // anchor is unverifiable, and `anchorMatchesRow` withholds on an unverifiable one.
    const rows = [
      ASSISTANT("r0", "m0", "needle zero"), ASSISTANT("r1", "m1", "needle one"), ASSISTANT("r2", "m2", "needle two"),
      ASSISTANT("r3", "m3", "needle three"), ASSISTANT("r4", "m4", "needle four"), ASSISTANT("r5", "m5", "quiet"),
    ];
    const entry = ENTRY("arr-edge", "a needle at the left edge", anchorOf(rows[4], rows[3]));
    const first = await bootLive(rows, fakeStore([entry]));
    const p1 = await occ({ threadId: first.threadId, searchTerm: "needle", limit: 5 });
    expect(p1.result.data.map((o: any) => o.rowOffset)).toEqual([0, 1, 2, 3, 4]);
    expect(decodeOccCursor(p1.result.nextCursor)).toMatchObject({ r: 4 });

    first.calls.length = 0;
    const p2 = await occ({ threadId: first.threadId, searchTerm: "needle", limit: 5, cursor: p1.result.nextCursor });
    expect(p2.error).toBeUndefined();
    expect(shape(p2)).toEqual([[4, "arr-edge", "a needle at the left edge"]]);
    // The peel is a real, bounded read of exactly one row of left context.
    expect(first.calls[0]).toEqual({ offset: 3, limit: 1 });

    // The negative control on the same fixture: an anchor whose `prevUuid` names a different row is NOT
    // verified by the lookbehind, so nothing is placed and nothing is invented.
    const wrong = await bootLive(rows, fakeStore([ENTRY("arr-edge", "a needle at the left edge", anchorOf(rows[4], rows[2]))]));
    const w1 = await occ({ threadId: wrong.threadId, searchTerm: "needle", limit: 5 });
    const w2 = await occ({ threadId: wrong.threadId, searchTerm: "needle", limit: 5, cursor: w1.result.nextCursor });
    expect(w2.result.data).toEqual([]);
  });

  it("a reader override without a store does not merge: no `arrivals` key, and no arrival occurrences", async () => {
    const rows = [ASSISTANT("r0", "m0", "a needle in the row")];
    const { threadId } = await bootLive(rows);      // reader injected, store withheld
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.result).toEqual({ data: r.result.data, nextCursor: null });
    expect("arrivals" in r.result).toBe(false);
    expect(shape(r)).toEqual([[0, "r0", "a needle in the row"]]);
  });

  it("a DEGRADED store reports `arrivals: null` — the entries still scan, only the number is void", async () => {
    const rows = [ASSISTANT("r0", "m0", "the anchor row")];
    const store = fakeStore([ENTRY("arr-deg", "a needle from a peer", anchorOf(rows[0], null))], { degraded: true });
    const { threadId } = await bootLive(rows, store);
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.result.arrivals).toBeNull();
    expect(shape(r)).toEqual([[0, "arr-deg", "a needle from a peer"]]);
  });

  it("an AMBIGUOUS entry is never scanned — it has no position, and `arrivals` is where it is visible", async () => {
    const rows = [ASSISTANT("r0", "m0", "the anchor row")];
    const store = fakeStore([ENTRY("arr-amb", "a needle nobody can place", anchorOf(rows[0], null), { ambiguous: true })]);
    const { threadId } = await bootLive(rows, store);
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.result.data).toEqual([]);
    expect(r.result.arrivals).toEqual({ logged: 1, dropped: 0 });
  });

  it("an arrival anchored to a NESTED row still publishes a jump — the projector emits it at that row's INDEX", async () => {
    // The one place this scan deliberately differs from the row scan beside it. `rowIsNested` withholds a
    // ROW's jump because the pager renders no item for a nested frame at any limit; an arrival is injected
    // at its anchor's row index whether or not that row produced an item of its own, so the jump lands and
    // withholding it would deny a client a target it can actually reach. Asserted the strong way, by
    // pasting the cursor into `thread/read` — if the pager ever stops rendering it, this goes red.
    const nested = { type: "user", uuid: "n1", session_id: "s", parent_tool_use_id: "toolu_1", message: { role: "user", content: "a subagent prompt" }, timestamp: TS };
    const rows = [ASSISTANT("r0", "m0", "opening a subagent"), nested, ASSISTANT("r2", "m2", "back at top level")];
    const entry = ENTRY("arr-nested", "a needle behind a nested row", anchorOf(nested, rows[0]));
    const { threadId, epoch } = await bootLive(rows, fakeStore([entry]));

    const r = await occ({ threadId, searchTerm: "needle" });
    expect(shape(r)).toEqual([[1, "arr-nested", "a needle behind a nested row"]]);
    expect(r.result.data[0].readCursor).toBe(`${epoch}:2`);
    const page = await read({ threadId, cursor: `${epoch}:2`, limit: 100 });
    expect(page.result.data.map((i: any) => i.id)).toContain("arr-nested");
  });

  it("the arrival-text budget is a real bound, and an entry past it is DISCLOSED through `skipped`", async () => {
    // `ARRIVAL_LOG_CAP × MAX_FRAME_CHARS` is the most a conforming log can present, so this needs a store
    // that broke one of the two caps — which is exactly why the bound is enforced rather than assumed.
    const rows = [ASSISTANT("r0", "m0", "the anchor row")];
    const anchor = anchorOf(rows[0], null);
    // Each entry is exactly `MAX_FRAME_CHARS` long, so the budget divides into precisely `ARRIVAL_LOG_CAP`
    // of them and the (cap + 1)-th is the first that cannot fit.
    const per = 60_000;
    const fits = ARRIVAL_LOG_CAP;
    const entries = Array.from({ length: fits + 1 }, (_, i) => ENTRY(`arr-big-${i}`, "needle" + "x".repeat(per - 6), anchor));
    const { threadId } = await bootLive(rows, fakeStore(entries));

    const r = await occ({ threadId, searchTerm: "needle", limit: 50 });
    expect(r.result.data).toHaveLength(fits);                       // the budget spent exactly, and no more
    expect(r.result.skipped).toBe(1);                               // …and the shortfall is on the wire
    expect(r.result.arrivals).toEqual({ logged: fits + 1, dropped: 0 });
  });

  it("an unresolvable anchor withholds rather than misplaces, and the count still shows it", async () => {
    const rows = [ASSISTANT("r0", "m0", "one"), ASSISTANT("r1", "m1", "two")];
    const gone = ENTRY("arr-gone", "a needle with no row", anchorOf(ASSISTANT("nope", "mx", "vanished"), rows[0]));
    const { threadId } = await bootLive(rows, fakeStore([gone]));
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.result.data).toEqual([]);
    expect(r.result.arrivals).toEqual({ logged: 1, dropped: 0 });
  });
});

// ── criterion 28 — the discriminated resume phase ──────────────────────────────────────────────────────
describe("criterion 28 — a page boundary inside the arrivals resumes exactly where it stopped", () => {
  it("two same-anchor arrivals at limit:1 — a walk visits each exactly once, and the cursor names which entry is next", async () => {
    const rows = [ASSISTANT("r0", "m0", "a quiet row")];
    const a = ENTRY("arr-a", "needle from A", anchorOf(rows[0], null));
    const b = ENTRY("arr-b", "needle from B", anchorOf(rows[0], null));
    const { threadId } = await bootLive(rows, fakeStore([a, b]));

    const pages: any[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page: any = await occ({ threadId, searchTerm: "needle", limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.error).toBeUndefined();
      pages.push(page.result);
      cursor = page.result.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    const all = pages.flatMap((p) => p.data.map((o: any) => o.snippet));
    expect(all).toEqual(["needle from A", "needle from B"]);          // each exactly once, in store order
    // The first boundary lands INSIDE the arrival phase and names the entry it stopped on.
    expect(decodeOccCursor(pages[0].nextCursor)).toMatchObject({ r: 0, a: { seq: a.seq, id: "arr-a" } });
  });

  it("two matches inside ONE arrival at limit:1 resume on the ENTRY-LOCAL character offset", async () => {
    const rows = [ASSISTANT("r0", "m0", "a quiet row")];
    const entry = ENTRY("arr-two", "needle one and needle two", anchorOf(rows[0], null));
    const { threadId } = await bootLive(rows, fakeStore([entry]));

    const p1 = await occ({ threadId, searchTerm: "needle", limit: 1 });
    expect(p1.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 0, end: 6 }]);
    const c1 = decodeOccCursor(p1.result.nextCursor);
    expect(c1).toMatchObject({ r: 0, c: 1, a: { seq: entry.seq, id: "arr-two" } });   // entry-local, not row-local

    const p2 = await occ({ threadId, searchTerm: "needle", limit: 1, cursor: p1.result.nextCursor });
    expect(p2.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 15, end: 21 }]);
    expect(p2.result.data[0].snippet.slice(15, 21)).toBe("needle");
    const p3 = await occ({ threadId, searchTerm: "needle", limit: 1, cursor: p2.result.nextCursor });
    expect(p3.result.data).toEqual([]);
    expect(p3.result.nextCursor).toBeNull();
  });

  it("a null-anchored entry pages through its own phase, and row 0's OWN text is still owed afterwards", async () => {
    // The atStart group scans BEFORE row 0, so a boundary inside it must not consume row 0's text with it.
    const rows = [ASSISTANT("r0", "m0", "a needle in row zero")];
    const top = ENTRY("arr-first", "needle before everything", null);
    const { threadId } = await bootLive(rows, fakeStore([top]));

    const p1 = await occ({ threadId, searchTerm: "needle", limit: 1 });
    expect(shape(p1)).toEqual([[0, "arr-first", "needle before everything"]]);
    expect(decodeOccCursor(p1.result.nextCursor)).toMatchObject({ r: 0, a: { seq: top.seq, id: "arr-first" } });
    const p2 = await occ({ threadId, searchTerm: "needle", limit: 1, cursor: p1.result.nextCursor });
    expect(shape(p2)).toEqual([[0, "r0", "a needle in row zero"]]);
    expect(p2.result.nextCursor).not.toBeNull();
    const p3 = await occ({ threadId, searchTerm: "needle", limit: 1, cursor: p2.result.nextCursor });
    expect(p3.result.data).toEqual([]);
    expect(p3.result.nextCursor).toBeNull();
  });

  it("a PRE-M9 cursor — the `{s,r,c,q,g}` shape, no phase field — resumes as the ROW phase", async () => {
    // A walk in flight across the upgrade. The bytes are hand-forged rather than taken from a reply,
    // because what is under test is the shape a client stored BEFORE this milestone existed.
    const rows = [ASSISTANT("r0", "m0", "needle one needle two"), ASSISTANT("r1", "m1", "needle three")];
    const { threadId, recordId, epoch } = await bootLive(rows, fakeStore([ENTRY("arr-legacy", "needle from a peer", anchorOf(rows[0], null))]));
    const legacy = encodeOccCursor({ s: SESSION, r: 0, c: 1, q: fingerprint(["needle"]), g: `L${recordId}:${epoch}` });
    expect(decodeOccCursor(legacy)).not.toHaveProperty("a");

    const r = await occ({ threadId, searchTerm: "needle", cursor: legacy });
    expect(r.error).toBeUndefined();
    // Resumed inside ROW 0's text at unit 1 — so the row's SECOND hit, then the arrival anchored to that
    // row, then row 1. A cursor read as the arrival phase would have skipped row 0's remaining text.
    expect(shape(r)).toEqual([
      [0, "r0", "needle one needle two"], [0, "arr-legacy", "needle from a peer"], [1, "r1", "needle three"],
    ]);
    expect(r.result.data[0].snippetMatchRange).toEqual({ start: 11, end: 17 });
    // …and the cursor this server MINTS for a row position still has no phase field either, so a pre-M9
    // client's stored shape and today's are the same bytes.
    const p1 = await occ({ threadId, searchTerm: "needle", limit: 1 });
    expect(Object.keys(JSON.parse(Buffer.from(p1.result.nextCursor, "base64url").toString("utf8")))).toEqual(["s", "r", "c", "q", "g"]);
  });

  it("an arrival-phase cursor is still refused when the WALK moved — a different term, and a rewound generation", async () => {
    const rows = [ASSISTANT("r0", "m0", "a quiet row")];
    const a = ENTRY("arr-a", "needle from A", anchorOf(rows[0], null));
    const b = ENTRY("arr-b", "needle from B", anchorOf(rows[0], null));
    const { threadId, srv } = await bootLive(rows, fakeStore([a, b]));
    const p1 = await occ({ threadId, searchTerm: "needle", limit: 1 });
    const cursor = p1.result.nextCursor;

    const requeried = await occ({ threadId, searchTerm: "haystack", cursor });
    expect(requeried.error?.message).toBe("cursor was minted for a different search; re-read from the start");
    srv.registry.get(threadId)!.epoch += 1;
    const rewound = await occ({ threadId, searchTerm: "needle", cursor });
    expect(rewound.error?.message).toBe("cursor invalidated by a rewind; re-read from the start");
  });
});

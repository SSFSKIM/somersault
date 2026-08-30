// test/unit/appserver/subscribe-arrivals.test.ts — M9 Stage C, Task 4: `thread/read` puts the logged
// arrivals back where they happened, and says how many it knows about.
//
// EVERY TEST HERE BOOTS THE REAL SERVER and injects BOTH halves of the structural rule (spec: Store
// injection) — `deps.getSessionMessages` AND `deps.arrivalStore` — because supplying only the reader is
// how an embedder says "do not merge", and that case is under test too (criterion 26). Nothing below
// mocks `arrivalsReply.ts`; the assertions are on the wire replies the handler actually sends, so a
// resolver that agrees with its own test and disagrees with the projector still goes red.
//
// The sibling `subscribe.test.ts` is deliberately untouched: it boots with a reader and no store, which
// is the non-merging path, and so remains the regression net for the pager itself. The last block in
// this file is the other half of that guarantee — with a store that holds nothing, every page is
// element-identical to the no-store run, cursors included.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { rawTextOf } from "../../../src/peer/address.js";
import { contentHash16, type ArrivalAnchor, type ArrivalEntry, type ArrivalStore } from "../../../src/peer/arrivalLog.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

const SESSION = "sess-arrivals";
const TS = "2026-08-30T00:00:00.000Z";
const ORIGIN = { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", verifiedPeerPid: 4242 };

/** `sessionId` is passed positionally with NO default: `undefined` is a real fixture here (the thread that
 *  has never persisted), and a default parameter would silently turn it back into a session. */
const fakeSession = (sessionId: string | undefined) =>
  ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId });

/** A persisted row, in the shapes `getSessionMessages` returns. `uuid` is the row's identity and — for a
 *  user row — the item id too, so a fixture's expected id list is readable off its rows. */
const USER = (uuid: string, text: string, over: Record<string, unknown> = {}) =>
  ({ type: "user", uuid, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: text }, timestamp: TS, ...over });
const ASSISTANT = (uuid: string, msgId: string, text: string, over: Record<string, unknown> = {}) =>
  ({ type: "assistant", uuid, session_id: "s", message: { id: msgId, content: [{ type: "text", text }] }, timestamp: TS, ...over });
/** An assistant row whose tool call never receives its result: it produces NO item at its own row and one
 *  forced completion at `finalize`, which is what makes it the straddle fixture criterion 22 names. */
const TOOL_OPEN = (uuid: string, msgId: string, toolId: string) =>
  ({ type: "assistant", uuid, session_id: "s", message: { id: msgId, content: [{ type: "tool_use", id: toolId, name: "Bash", input: {} }] }, timestamp: TS });
/** A nested (subagent) row: reader-visible, occupies a row index, and produces no item at all — the shape
 *  that lets a bounded window hold fewer items than `limit`. */
const NESTED = (uuid: string) =>
  ({ type: "user", uuid, session_id: "s", parent_tool_use_id: "toolu_parent", message: { role: "user", content: "nested" }, timestamp: TS });

/** The anchor as the observer would have written it for `row`, whose predecessor among filter-surviving
 *  frames is `prev` (`null` = the arrival precedes every row the seed returned). Derived from the row
 *  rather than hand-written, so a fixture cannot drift from the fingerprint the live side records. */
const anchorOf = (row: any, prev: any | null, over: Partial<ArrivalAnchor> = {}): ArrivalAnchor => ({
  afterUuid: String(row.uuid),
  prevUuid: prev ? String(prev.uuid) : null,
  fp: { type: String(row.type), hash: contentHash16(rawTextOf(row.message?.content)), ...(row.timestamp ? { timestamp: row.timestamp as string } : {}) },
  ...over,
});

let seq = 0;
const ENTRY = (id: string, text: string, anchor: ArrivalAnchor | null, over: Partial<ArrivalEntry> = {}): ArrivalEntry =>
  ({ v: 1, id, sessionId: SESSION, anchor, seq: seq++, observedAt: TS, origin: ORIGIN, text, ...over });

/** The store as Task 1 defines it, in memory. `readAll` hands back the entries in `(seq, id)` order — the
 *  order the fixture lists them in — and `counts` reports the PRE-eviction total, which is what lets a
 *  reply claim more arrivals than it rendered. */
const fakeStore = (entries: ArrivalEntry[], over: { dropped?: number; degraded?: boolean } = {}): ArrivalStore => ({
  append() {},
  readAll: () => entries,
  counts: () => ({ logged: entries.length + (over.dropped ?? 0), dropped: over.dropped ?? 0 }),
  nextSeq: () => entries.length,
  isDegraded: () => over.degraded === true,
  markDegraded() {},
});

interface ReadPage { data: Array<Record<string, any>>; nextCursor: string | null; arrivals?: { logged: number; dropped: number } | null }

/** Boots a thread over `rows`, with a store when `entries` is supplied and none when it is not (the
 *  merge-disabled arm). `calls` records only the BOUNDED fetches — the observer's own seed read is a
 *  whole-file call and is not what the pager's offset arithmetic is being asserted about. */
async function openThread(rows: unknown[], entries?: ArrivalEntry[], over: { dropped?: number; degraded?: boolean; sessionId?: string | undefined } = {}) {
  const calls: Array<{ limit?: number; offset?: number }> = [];
  const getSessionMessages = async (_sid: string, opts?: { limit?: number; offset?: number }) => {
    if (!opts) return rows;
    calls.push(opts);
    const { offset = 0, limit } = opts;
    return rows.slice(offset, limit === undefined ? undefined : offset + limit);
  };
  const sessionId = "sessionId" in over ? over.sessionId : SESSION;
  const srv = new AppServer({}, {
    sessionFactory: (() => fakeSession(sessionId)) as never,
    getSessionMessages,
    ...(entries ? { arrivalStore: fakeStore(entries, over) } : {}),
  });
  const { lines, sink } = mkSink();
  const conn = srv.connect(sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  send(conn, { id: 2, method: "thread/start", params: {} });
  await tick();
  const threadId = parsed(lines).find((f) => f.id === 2).result.thread.id;
  let reqId = 10;
  const read = async (params: Record<string, unknown> = {}): Promise<ReadPage> => {
    const id = reqId++;
    send(conn, { id, method: "thread/read", params: { threadId, ...params } });
    await tick();
    return parsed(lines).find((f) => f.id === id).result as ReadPage;
  };
  const readRaw = async (params: Record<string, unknown> = {}) => {
    const id = reqId++;
    send(conn, { id, method: "thread/read", params: { threadId, ...params } });
    await tick();
    return parsed(lines).find((f) => f.id === id);
  };
  /** Walks to `nextCursor: null`, returning every page. Throws rather than looping if the walk never ends
   *  — a stranded arrival that also stalls the pager must fail as a test, not as a hang. */
  const walk = async (limit: number, guard = 30): Promise<ReadPage[]> => {
    const pages: ReadPage[] = [];
    let cursor: string | null = null;
    do {
      const page = await read({ limit, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.nextCursor;
      if (pages.length >= guard) throw new Error(`walk: exceeded ${guard} pages — nextCursor never reached null`);
    } while (cursor);
    return pages;
  };
  return { read, readRaw, walk, calls };
}

const ids = (page: ReadPage) => page.data.map((i) => String(i.id));
const marked = (pages: ReadPage[]) => new Set(pages.flatMap((p) => p.data.filter((i) => i.origin).map((i) => String(i.id))));
const seen = (pages: ReadPage[]) => new Set(pages.flatMap(ids));
const cursors = (pages: ReadPage[]) => pages.map((p) => p.nextCursor);

describe("criterion 19 — the question precedes the answer", () => {
  it("the arrival item lands immediately before the assistant turn it caused, carrying the entry's text and origin", async () => {
    // The inverse of M8's LEG 2: history used to hold an answer whose question was never on disk.
    const rows = [ASSISTANT("r0", "msg_0", "earlier answer"), ASSISTANT("r1", "msg_1", "answering the peer")];
    const entry = ENTRY("arr-1", "ship the release", anchorOf(rows[0], null));
    const { read } = await openThread(rows, [entry]);

    const page = await read();
    expect(ids(page)).toEqual(["msg_0#0", "arr-1", "msg_1#0"]);
    expect(page.data[1]).toEqual({ type: "userMessage", id: "arr-1", text: "ship the release", origin: ORIGIN });
  });
});

describe("criterion 21 — the cursor is unchanged", () => {
  // 10 one-item rows at `limit: 3`, arrival on row 0. The arrival adds an item to every window, and the
  // discarded set grows with it — but `boundaryRow` answers in ROWS, and the arrival rides a row that was
  // already inside every boundary, so the walk emits the same cursor sequence either way. That is the
  // claim: an arrival is a row that completes an extra item, which is the case this pager was built for.
  const rows = Array.from({ length: 10 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
  const entry = () => ENTRY("arr-cursor", "peer says hi", anchorOf(rows[0], null));

  it("walks with and without arrivals emit the identical cursor sequence, every cursor matching ^\\d+:\\d+$ over raw rows", async () => {
    const withArrivals = await (await openThread(rows, [entry()])).walk(3);
    const without = await (await openThread(rows, [])).walk(3);
    expect(cursors(withArrivals)).toEqual(["0:7", "0:4", "0:1", null]);
    expect(cursors(without)).toEqual(cursors(withArrivals));
    for (const c of cursors(withArrivals)) if (c !== null) expect(c).toMatch(/^\d+:\d+$/);
    // The row coordinates are REAL rows, not item counts inflated by the arrival: 10 rows, so no cursor
    // may address past the file.
    for (const c of cursors(withArrivals)) if (c !== null) expect(Number(c.split(":")[1])).toBeLessThanOrEqual(rows.length);
    expect(seen(withArrivals)).toEqual(new Set([...rows.map((_, i) => `m${i}#0`), "arr-cursor"]));
  });

  it("a cursor from another generation is still refused with the pager's own message", async () => {
    const { readRaw } = await openThread(rows, [entry()]);
    const reply = await readRaw({ cursor: "7:5" });
    expect(reply.error.message).toBe("cursor invalidated by a rewind; re-read from the start");
  });
});

describe("criterion 22 — a limit:1 walk terminates and strands nothing", () => {
  it("an anchor on the window's LAST row: the walk ends in the last-resort page, and the arrival is on it", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
    const entry = ENTRY("arr-last", "peer says hi", anchorOf(rows[6], rows[5]));
    const pages = await (await openThread(rows, [entry])).walk(1);

    expect(seen(pages)).toEqual(new Set([...rows.map((_, i) => `m${i}#0`), "arr-last"]));
    // The last-resort `from === 0` page is the ONLY branch that returns more than `limit` items, so a page
    // over the limit is a black-box signal it fired — and it always ends the walk.
    expect(pages.some((p) => p.data.length > 1)).toBe(true);
    expect(pages[pages.length - 1].nextCursor).toBeNull();
  });

  it("an anchor row that opened a still-unfinished tool: the arrival emits at the ROW, ahead of the forced completion", async () => {
    const rows = [USER("u0", "run it"), TOOL_OPEN("r1", "msg_1", "toolu_1")];
    const entry = ENTRY("arr-tool", "peer says hi", anchorOf(rows[1], rows[0]));
    const { read, walk } = await openThread(rows, [entry]);

    // The tool's item is completed by `finalize`, at the tail — the arrival really did land while the tool
    // was still running, and that is where it renders.
    expect(ids(await read({ limit: 10 }))).toEqual(["u0", "arr-tool", "toolu_1"]);
    const pages = await walk(1);
    expect(seen(pages)).toEqual(new Set(["u0", "arr-tool", "toolu_1"]));
  });

  it("more same-anchor arrivals than `limit`: all three appear, and the walk ends in the last-resort page", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
    const anchor = anchorOf(rows[1], rows[0]);
    const entries = ["a", "b", "c"].map((k) => ENTRY(`arr-${k}`, `peer ${k}`, anchor));
    const pages = await (await openThread(rows, entries)).walk(1);

    expect(seen(pages)).toEqual(new Set([...rows.map((_, i) => `m${i}#0`), "arr-a", "arr-b", "arr-c"]));
    expect(pages.some((p) => p.data.length > 1)).toBe(true);
    // Same-anchor entries keep the store's `(seq, id)` order wherever they render together.
    const together = pages.find((p) => ids(p).includes("arr-a"))!;
    expect(ids(together).filter((i) => i.startsWith("arr-"))).toEqual(["arr-a", "arr-b", "arr-c"]);
  });

  it("round 5's walk: a null-anchored entry plus three rows at limit 1 returns all four items", async () => {
    // The review's own construction. A confirmed-empty entry sits in EVERY prefix, so once discarded its
    // boundary resolves to row 0 and the walk ends without it — unless it is outside the bisection
    // entirely, which is what the null sentinel is.
    const rows = Array.from({ length: 3 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
    const entry = ENTRY("arr-start", "peer got there first", null);
    const pages = await (await openThread(rows, [entry])).walk(1);

    expect(seen(pages)).toEqual(new Set(["m0#0", "m1#0", "m2#0", "arr-start"]));   // no loss over the walk
    // It arrives on the TERMINAL page and on no other (spec rev 8.3): every earlier page discards, so its
    // oldest rendered item is not the top of history, and a head there would be a misplacement rather than
    // an early delivery. It rides past `limit` on the page that does qualify.
    expect(pages.slice(0, -1).flatMap(ids)).not.toContain("arr-start");
    expect(ids(pages[pages.length - 1])).toEqual(["arr-start", "m0#0"]);
    expect(pages[pages.length - 1].nextCursor).toBeNull();
  });

  it("round 6's left edge: an anchor on a bounded window's FIRST row is verified through the one-row lookbehind", async () => {
    // The stranding this fixture is built to reproduce. Rows 5-7 are nested, so the window [4,8) holds one
    // item — fewer than `limit` would discard — and the page's `begin` is the window's own start. The next
    // window is [.., 4), exclusive, so row 4 is never fetched again: an arrival anchored there renders on
    // THIS page or on none.
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`)),
      USER("u4", "the anchor row"), NESTED("n5"), NESTED("n6"), NESTED("n7"),
      ASSISTANT("r8", "m8", "t8"), ASSISTANT("r9", "m9", "t9"),
    ];
    const entry = ENTRY("arr-edge", "peer says hi", anchorOf(rows[4], rows[3]));
    const { read, calls } = await openThread(rows, [entry]);

    const page = await read({ limit: 1, cursor: "0:8" });
    // The fetch reached one row further back than the window it maps, and the extra row is not in it.
    expect(calls).toEqual([{ offset: 3, limit: 5 }]);
    expect(ids(page)).toEqual(["arr-edge"]);
    expect(page.nextCursor).toBe("0:5");

    // The negative control, same fixture: an anchor whose `prevUuid` names a different row is NOT
    // verified by the lookbehind, so the arrival is withheld and the page is the plain transcript.
    const wrong = ENTRY("arr-edge", "peer says hi", anchorOf(rows[4], rows[2]));
    const other = await openThread(rows, [wrong]);
    expect(ids(await other.read({ limit: 1, cursor: "0:8" }))).toEqual(["u4"]);
  });
});

describe("the null sentinel's page gate (spec rev 8.3)", () => {
  it("a transcript longer than `limit`: no head on the cursorless first page, the head on the terminal page, once over the walk", async () => {
    // THE REGRESSION THIS PINS. Under the earlier window gate, the cursorless read fetches the whole file,
    // so `windowIncludesRowZero` was true on a page that is actually the NEWEST `limit` items — and the
    // precedes-everything arrival was prepended to them. A client that dedupes by first-seen id then
    // assembles it beside the newest turns, which is misplacement, not early delivery.
    const rows = Array.from({ length: 5 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
    const entry = ENTRY("arr-top", "peer got there first", null);
    const { read, walk } = await openThread(rows, [entry]);

    const first = await read({ limit: 2 });
    expect(ids(first)).toEqual(["m3#0", "m4#0"]);
    expect(first.data.filter((i) => i.origin)).toEqual([]);
    expect(first.nextCursor).toBe("0:3");                 // it discarded, so the walk continues — nothing is stranded

    const pages = await walk(2);
    expect(ids(pages[pages.length - 1])).toEqual(["arr-top", "m0#0"]);
    expect(pages.flatMap(ids).filter((i) => i === "arr-top")).toHaveLength(1);
    expect(seen(pages)).toEqual(new Set([...rows.map((_, i) => `m${i}#0`), "arr-top"]));
  });
});

describe("criterion 23 — `arrivals` rides every merge-enabled reply", () => {
  it("cursorless, normal page, last resort, exhausted cursor and no-session all carry the counts", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ASSISTANT(`r${i}`, `m${i}`, `t${i}`));
    const entry = ENTRY("arr-paths", "peer says hi", anchorOf(rows[6], rows[5]));
    const { read, walk } = await openThread(rows, [entry], { dropped: 2 });
    const counts = { logged: 3, dropped: 2 };

    expect((await read()).arrivals).toEqual(counts);                    // cursorless
    const pages = await walk(1);
    for (const page of pages) expect(page.arrivals).toEqual(counts);    // normal pages AND the last resort
    expect(pages.some((p) => p.data.length > 1)).toBe(true);            // the last-resort page really fired
    expect((await read({ cursor: "0:0" })).arrivals).toEqual(counts);   // the exhausted-cursor reply

    // The no-session reply reports zero rather than hiding the field: merging is on, this session has
    // simply logged nothing yet.
    const noSession = await openThread(rows, [entry], { sessionId: undefined });
    expect(await noSession.read()).toEqual({ data: [], nextCursor: null, arrivals: { logged: 0, dropped: 0 } });
  });

  it("a degraded store reports `arrivals: null` — a count it cannot vouch for is not a count", async () => {
    const rows = [ASSISTANT("r0", "m0", "t0")];
    const { read } = await openThread(rows, [ENTRY("arr-deg", "peer says hi", null)], { degraded: true });
    const page = await read();
    expect(page.arrivals).toBeNull();
    expect(ids(page)).toEqual(["arr-deg", "m0#0"]);   // the entries still render; only the number is void
  });
});

describe("criterion 24 — an unresolvable anchor withholds rather than misplaces", () => {
  const rows = [ASSISTANT("r0", "m0", "t0"), ASSISTANT("r1", "m1", "t1"), ASSISTANT("r2", "m2", "t2")];
  const plain = ["m0#0", "m1#0", "m2#0"];

  const cases: Array<[string, () => ArrivalEntry]> = [
    ["the anchor row is gone", () => ENTRY("arr-x", "peer says hi", anchorOf(ASSISTANT("gone", "mg", "tg"), rows[0]))],
    ["the fingerprint's hash changed", () => ENTRY("arr-x", "peer says hi", { ...anchorOf(rows[1], rows[0]), fp: { ...anchorOf(rows[1], rows[0]).fp, hash: contentHash16("something else") } })],
    ["the predecessor changed (the rebound-duplicate shape)", () => ENTRY("arr-x", "peer says hi", anchorOf(rows[1], rows[2]))],
    ["the entry is ambiguous", () => ENTRY("arr-x", "peer says hi", anchorOf(rows[1], rows[0]), { ambiguous: true })],
  ];

  for (const [label, mk] of cases) {
    it(`${label}: nothing renders, no position moves, and \`logged\` exceeds the marked items`, async () => {
      const { read } = await openThread(rows, [mk()]);
      const page = await read();
      expect(ids(page)).toEqual(plain);                              // withheld, and nothing else shifted
      expect(page.data.filter((i) => i.origin)).toEqual([]);
      expect(page.arrivals).toEqual({ logged: 1, dropped: 0 });      // the omission is VISIBLE
    });
  }

  it("a withheld entry does not take its neighbours with it", async () => {
    // Two entries, one resolvable and one not: the survivor still lands where it belongs.
    const good = ENTRY("arr-good", "peer says hi", anchorOf(rows[1], rows[0]));
    const bad = ENTRY("arr-bad", "peer says bye", anchorOf(rows[1], rows[2]));
    const page = await (await openThread(rows, [good, bad])).read();
    expect(ids(page)).toEqual(["m0#0", "m1#0", "arr-good", "m2#0"]);
    expect(page.arrivals).toEqual({ logged: 2, dropped: 0 });
  });
});

describe("criterion 16 at resolution time — what the fingerprint does and does not constrain", () => {
  it("a fingerprint recorded WITHOUT a timestamp resolves against a row that carries one", async () => {
    // A field absent at observation constrains nothing — live `timestamp` is optional, so requiring it to
    // be absent from the row too would withhold every arrival observed on a frame that lacked it.
    const rows = [ASSISTANT("r0", "m0", "t0"), ASSISTANT("r1", "m1", "t1")];
    const anchor = anchorOf(rows[0], null);
    const noTimestamp: ArrivalAnchor = { ...anchor, fp: { type: anchor.fp.type, hash: anchor.fp.hash } };
    const page = await (await openThread(rows, [ENTRY("arr-nots", "peer says hi", noTimestamp)])).read();
    expect(ids(page)).toEqual(["m0#0", "arr-nots", "m1#0"]);
  });

  it("a recorded timestamp that DISAGREES with the row still withholds", async () => {
    const rows = [ASSISTANT("r0", "m0", "t0"), ASSISTANT("r1", "m1", "t1")];
    const anchor = anchorOf(rows[0], null);
    const skewed: ArrivalAnchor = { ...anchor, fp: { ...anchor.fp, timestamp: "2020-01-01T00:00:00.000Z" } };
    expect(ids(await (await openThread(rows, [ENTRY("arr-skew", "peer says hi", skewed)])).read())).toEqual(["m0#0", "m1#0"]);
  });

  it("two occurrences indistinguishable in every recorded field: the rendered output is one of them, exactly once", async () => {
    // Round 6, finding 2, as a stated limit rather than a pretence: when a duplicate matches uuid,
    // predecessor, type, timestamp and content, no recorded dimension separates the two occurrences. The
    // assertion is therefore about the RENDERING — the transcript is unchanged and the arrival appears
    // once, beside a row that satisfies its anchor — not about which occurrence "really" carried it.
    const p = ASSISTANT("p", "mp", "prelude");
    const d = ASSISTANT("dup", "md", "the same content");
    const rows = [p, d, { ...p }, { ...d }];
    const page = await (await openThread(rows, [ENTRY("arr-dup", "peer says hi", anchorOf(d, p))])).read();

    const arrivals = page.data.filter((i) => i.origin);
    expect(arrivals.map((i) => i.id)).toEqual(["arr-dup"]);
    expect(ids(page).filter((i) => i !== "arr-dup")).toEqual(["mp#0", "md#0", "mp#0", "md#0"]);
    expect(ids(page)[ids(page).indexOf("arr-dup") - 1]).toBe("md#0");   // beside an occurrence of its anchor
  });

  it("an entry whose id is already a fetched row's uuid is skipped — the dedupe guard", async () => {
    // Inert today (the reader drops every `isMeta` row), and what keeps this correct on the day an SDK
    // stops dropping them: the row would render itself, and the entry would render it a second time.
    const rows = [ASSISTANT("r0", "m0", "t0"), USER("arr-dupe-id", "the peer row, as the reader returned it")];
    const page = await (await openThread(rows, [ENTRY("arr-dupe-id", "peer says hi", anchorOf(rows[0], null))])).read();
    expect(ids(page)).toEqual(["m0#0", "arr-dupe-id"]);
    expect(page.data.filter((i) => i.origin)).toEqual([]);
  });
});

describe("criterion 26 — a reader override without a store does not merge", () => {
  it("no `arrivals` key at all, and no arrival items", async () => {
    // Absent, not `0`: an embedder whose transcript this machine does not own is told nothing rather than
    // told zero, which would be a claim about a log that was never consulted.
    const rows = [ASSISTANT("r0", "m0", "t0")];
    const page = await (await openThread(rows)).read();
    expect(page).toEqual({ data: [{ type: "agentMessage", id: "m0#0", text: "t0" }], nextCursor: null });
    expect("arrivals" in page).toBe(false);
  });
});

describe("the no-arrivals regression guard", () => {
  it("an EMPTY store changes no page: same items, same cursors, element for element", async () => {
    // `thread/read` now runs the projector on every read, including the overwhelming majority that carry
    // no arrival — so this is a regression test for ordinary history reading, not for a new feature.
    const rows = [
      USER("u0", "first prompt"), ASSISTANT("r1", "m1", "answering"), TOOL_OPEN("r2", "m2", "toolu_1"),
      { type: "user", uuid: "u3", session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }] } },
      ASSISTANT("r4", "m4", "wrapping up"), NESTED("n5"), USER("u6", "second prompt"),
    ];
    const merged = await (await openThread(rows, [])).walk(2);
    const unmerged = await (await openThread(rows)).walk(2);
    expect(cursors(merged)).toEqual(cursors(unmerged));
    expect(merged.map((p) => p.data)).toEqual(unmerged.map((p) => p.data));
    expect(marked(merged)).toEqual(new Set());
    for (const page of merged) expect(page.arrivals).toEqual({ logged: 0, dropped: 0 });
  });
});

// test/unit/appserver/fr-cursor-bindings.test.ts — fix wave E / D-M5-26: a cursor carries the WALK, not
// only the position.
//
// Six confirmed defects turned out to be one root. A cursor resumes a walk, and a walk's meaning depends on
// two things that were not in the cursor: the QUERY that decides what is enumerated, and the GENERATION of
// the content being enumerated. `thread/search`'s cursor carried neither; `thread/searchOccurrences`'
// carried a generation with a `null` that meant "do not check", and three separate ways of addressing the
// wrong generation went through that one value. Every row below is a walk resumed under a binding that
// moved, and every one of them answered confidently and wrongly before this file existed.
//
// Driven over the REAL wire (`srv.connect(sink)` + `conn.feed`), like every other file in this suite: the
// refusals are error codes and messages, which only a request can observe. The store is a fake — this is a
// cursor contract, not a storage one — but the one premise the non-live stamp rests on was measured against
// the REAL reader rather than modelled: `getSessionInfo`'s `lastModified` is the transcript file's mtime in
// integer ms (`Math.trunc(statSync(...).mtimeMs)` in the pinned bundle) and `fileSize` its byte length, and
// a rewritten transcript moves both (measured: `S1787170730355:7540` -> `S1787170730588:2248` for a
// 40-row file rewritten to 12 rows). The fakes here move the metadata with the content for that reason —
// a store that swapped rows while freezing its own mtime is one no filesystem produces, and a fixture that
// did so would be pinning the defect rather than the fix.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { SEARCH_CAPS, decodeSearchCursor, decodeOccCursor, fingerprint } from "../../../src/appserver/searchScan.js";
import { writeRoster } from "../../../src/fleet/roster.js";

const mkSink = () => { const ls: string[] = []; return { lines: ls, sink: { write: (l: string) => void ls.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parse = (ls: string[]) => ls.map((l) => JSON.parse(l) as any);
const servers: AppServer[] = [];
const temps: string[] = [];
let conn!: { feed(chunk: string): void };
let lines!: string[];
let nextId = 900;

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
  for (let i = 0; i < 800; i++) {
    const hit = parse(lines).find((m) => m.id === id);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${method} (id ${id})`);
};
const search = (p: Record<string, unknown>) => send("thread/search", p);
const occ = (p: Record<string, unknown>) => send("thread/searchOccurrences", p);
const mkTmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };

const assistant = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

/** A store whose METADATA MOVES WITH ITS CONTENT, which is the whole point of the fixture: `replace()` is
 *  what a rewind looks like from the outside, and a real store's mtime and size move when it happens. */
interface Row { sessionId: string; summary: string; lastModified: number; createdAt: number; fileSize: number }
function store(fakes: { info: Row; rows: unknown[] }[]) {
  const live = [...fakes];
  const calls: { id: string; offset?: number; limit?: number }[] = [];
  return {
    calls,
    replace(id: string, rows: unknown[]) {
      const f = live.find((x) => x.info.sessionId === id)!;
      f.rows = rows;
      f.info.lastModified += 1_000;                    // a later mtime, as a rewritten file has
      f.info.fileSize = rows.length * 64;              // and a different size
    },
    drop(id: string) { const i = live.findIndex((f) => f.info.sessionId === id); if (i >= 0) live.splice(i, 1); },
    deps: {
      getSessionInfo: async (id: string) => live.find((f) => f.info.sessionId === id)?.info,
      listSessions: async () => live.map((f) => f.info),
      getSessionMessages: async (id: string, o?: { offset?: number; limit?: number }) => {
        calls.push({ id, offset: o?.offset, limit: o?.limit });
        const rows = live.find((f) => f.info.sessionId === id)?.rows ?? [];
        const from = o?.offset ?? 0;
        return rows.slice(from, o?.limit === undefined ? undefined : from + o.limit);
      },
    } as AppServerDeps,
  };
}
const sess = (sessionId: string, over: Partial<Row> = {}, rows: unknown[] = []) =>
  ({ info: { sessionId, summary: `summary of ${sessionId}`, lastModified: 5_000, createdAt: 1_000, fileSize: 100, ...over }, rows });

const engine = (sessionId: string) => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId }) as any;

const REWOUND = "cursor invalidated by a rewind; re-read from the start";
const REQUERIED = "cursor was minted for a different search; re-read from the start";

describe("D-M5-26 — a cursor is bound to the QUERY it was minted under", () => {
  it("thread/search: all four query axes refuse, and the SAME query still resumes", async () => {
    // Before: each of these answered a page, terminated by `nextCursor: null` — i.e. told the client the
    // walk was complete. The term swap was the sharpest, answering `{"data":[],"nextCursor":null}` — an
    // affirmative "no matches" for a term that has one, which is the D-M5-8 lie reached without any
    // forgery at all. A search box that re-issues on keystroke while holding the previous page's cursor
    // produces exactly this.
    const st = store([
      sess("s1", { createdAt: 1_000, lastModified: 1_000, summary: "alpha and beta hit here" }),
      sess("s2", { createdAt: 2_000, lastModified: 3_500, summary: "alpha hit here" }),
      sess("s3", { createdAt: 3_000, lastModified: 4_500, summary: "alpha hit here" }),
    ]);
    boot(st.deps);
    const base = { searchTerm: "alpha", sortKey: "created_at", sortDirection: "asc" } as const;
    const p1 = await search({ ...base, limit: 1 });
    expect(p1.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s1"]);
    const cursor = p1.result.nextCursor as string;

    // The control FIRST, so a blanket refusal cannot pass this row: the same query resumes and completes.
    const same = await search({ ...base, cursor });
    expect(same.error).toBeUndefined();
    expect(same.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s2", "s3"]);

    for (const [axis, params] of [
      ["searchTerm", { ...base, searchTerm: "beta", cursor }],
      ["sortKey", { ...base, sortKey: "updated_at", cursor }],
      ["sortDirection", { ...base, sortDirection: "desc", cursor }],
      ["cwd", { ...base, cwd: "/somewhere/else", cursor }],
      ["archived", { ...base, archived: true, cursor }],
    ] as const) {
      const r = await search(params as Record<string, unknown>);
      expect([axis, r.error?.code, r.error?.message]).toEqual([axis, -32602, REQUERIED]);
      expect([axis, r.result]).toEqual([axis, undefined]); // no page went out beside the refusal
    }
    // …and `limit` is NOT an axis: it sizes a page, it does not choose what is walked.
    const bigger = await search({ ...base, limit: 50, cursor });
    expect(bigger.error).toBeUndefined();
    expect(bigger.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s2", "s3"]);
  });

  it("thread/searchOccurrences: the sibling's own term binding — one row per side of the mechanism", async () => {
    const st = store([sess("cold", { createdAt: 1_000 }, [assistant("alpha beta alpha"), assistant("alpha again")])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold", searchTerm: "alpha", limit: 1 });
    expect(p1.result.data.map((o: any) => o.rowOffset)).toEqual([0]);
    const cursor = p1.result.nextCursor as string;

    const same = await occ({ threadId: "cold", searchTerm: "alpha", cursor });
    expect(same.error).toBeUndefined();
    expect(same.result.data.map((o: any) => o.rowOffset)).toEqual([0, 1]);

    const other = await occ({ threadId: "cold", searchTerm: "beta", cursor });
    expect(other.error?.code).toBe(-32602);
    expect(other.error?.message).toBe(REQUERIED);
    // A cursor for ANOTHER thread keeps its own, older refusal (`s`, Task 8's): the two bindings answer
    // different sentences because they are different mistakes, and folding them would tell a client that
    // changed its search term that it pasted a cursor from another conversation.
    const elsewhere = await occ({ threadId: "no-such", searchTerm: "alpha", cursor });
    expect(elsewhere.error?.code).toBe(-32602);
    expect(elsewhere.error?.message).toBe("Invalid cursor");
  });
});

describe("D-M5-26 — a cursor is bound to the GENERATION it addresses", () => {
  it("thread/search: an intra-file cursor refuses after a rewind, resumes when nothing moved, and a DELETED session still continues at its successor", async () => {
    // The store-wide cursor carried no generation at all. Constructed: page 1 spends its 4000-row budget
    // inside one session and mints `r: 4000`; a real `thread/rewind` truncates that session to 500 rows;
    // page 2 reads at offset 4000 of a 500-row transcript, finds nothing, and answers
    // `{"data":[],"nextCursor":null}` while the same instant's fresh walk returns the hit.
    const rows = (n: number, tag: string) => [...Array(n)].map((_, i) => assistant(i === n - 2 ? `here is the ${tag} needle` : `filler ${i}`));
    const st = store([sess("s-big", { createdAt: 1_000 }, rows(4_200, "first"))]);
    const srv = boot({ ...st.deps, sessionFactory: () => engine("s-big") });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    const record = srv.registry.get(threadId)!;

    const p1 = await search({ searchTerm: "needle" });
    expect(p1.result.data).toEqual([]);                                        // bounded progress (D-M5-16)
    const cursor = p1.result.nextCursor as string;
    // The live stamp is the RECORD plus its epoch, not the epoch alone: an epoch is a per-record counter
    // that restarts at 0 when a closed thread is re-admitted, so `L0` alone made a stale cursor compare
    // equal to a brand-new record (the close-and-reopen row below).
    expect(decodeSearchCursor(cursor)).toMatchObject({ s: "s-big", r: SEARCH_CAPS.maxRowsPerPage, g: `L${record.id}:0` });

    // Control: nothing moved, so the walk continues into the rows page 1 did not reach.
    const same = await search({ searchTerm: "needle", cursor });
    expect(same.error).toBeUndefined();
    expect(same.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-big"]);

    record.epoch += 1;                                                          // a rewind, on this server
    st.replace("s-big", rows(500, "second"));
    const stale = await search({ searchTerm: "needle", cursor });
    expect(stale.error?.code).toBe(-32602);
    expect(stale.error?.message).toBe(REWOUND);
    expect(stale.result).toBeUndefined();
    // …and the fresh walk finds what the stale cursor claimed did not exist, which is the whole complaint.
    expect((await search({ searchTerm: "needle" })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-big"]);
  });

  it("thread/search: a cursor minted before a thread/close is refused after the same session is re-admitted", async () => {
    // D-M5-26e. `epoch` alone was never a generation: it is a per-record counter starting at 0, bumped in
    // place, and `thread/close` DELETES the record — so re-admitting the same session minted a fresh record
    // back at 0 and the stale cursor compared EQUAL to it. Three ordinary wire calls (search → close →
    // start), which is a normal thing to do between two pages, and the reply was the terminal
    // `{"data":[],"nextCursor":null}` D-M5-8 forbids while the same instant's fresh walk returned the hit.
    // The stamp now names the record as well as its epoch, so the two records cannot collide.
    const rows = (n: number, tag: string) => [...Array(n)].map((_, i) => assistant(i === n - 2 ? `here is the ${tag} needle` : `filler ${i}`));
    const st = store([sess("s-reopen", { createdAt: 1_000 }, rows(4_200, "first"))]);
    const srv = boot({ ...st.deps, sessionFactory: () => engine("s-reopen") });
    const first = await send("thread/start", {});
    const firstId = first.result.thread.id;
    expect(srv.registry.get(firstId)!.epoch).toBe(0);
    const cursor = (await search({ searchTerm: "needle" })).result.nextCursor as string;
    expect(decodeSearchCursor(cursor)).toMatchObject({ s: "s-reopen", r: SEARCH_CAPS.maxRowsPerPage, g: `L${firstId}:0` });

    await send("thread/close", { threadId: firstId });
    expect(srv.registry.get(firstId)).toBeUndefined();          // the record is GONE, counter and all
    const second = await send("thread/start", {});
    const secondId = second.result.thread.id;
    expect(srv.registry.get(secondId)!.epoch).toBe(0);          // …and the replacement starts at 0 again
    expect(secondId).not.toBe(firstId);

    const stale = await search({ searchTerm: "needle", cursor });
    expect(stale.error?.code).toBe(-32602);
    expect(stale.error?.message).toBe(REWOUND);
    expect(stale.result).toBeUndefined();
    // Control, and the half that keeps this from being "refuse everything": a cursor minted AFTER the
    // reopen resumes the walk against the record that is actually there.
    const fresh = (await search({ searchTerm: "needle" })).result.nextCursor as string;
    const p2 = await search({ searchTerm: "needle", cursor: fresh });
    expect(p2.error).toBeUndefined();
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-reopen"]);
  });

  it("thread/searchOccurrences: the same close-and-reopen refuses there too — one row per side", async () => {
    // The sibling half of D-M5-26e. Both methods stamp through `generationOf`, and both mint a cursor a
    // client holds across other calls; a fix pinned on one of them would leave the other free to regress.
    // Sharper here than on the sibling, because this cursor carries a CHARACTER offset as well as a row:
    // honoured against a new generation the two pages together reported three occurrences for a transcript
    // holding two.
    const st = store([sess("o-reopen", { createdAt: 1_000 }, [assistant("needle needle needle")])]);
    const srv = boot({ ...st.deps, sessionFactory: () => engine("o-reopen") });
    const firstId = (await send("thread/start", {})).result.thread.id;
    const p1 = await occ({ threadId: firstId, searchTerm: "needle", limit: 1 });
    const cursor = p1.result.nextCursor as string;
    expect(decodeOccCursor(cursor)).toMatchObject({ s: "o-reopen", r: 0, c: 1, g: `L${firstId}:0` });

    await send("thread/close", { threadId: firstId });
    const secondId = (await send("thread/start", {})).result.thread.id;
    expect(srv.registry.get(secondId)!.epoch).toBe(0);
    // Addressed by STORE id — the `thr_…` id died with the record, and the cursor's subject is the session.
    const stale = await occ({ threadId: "o-reopen", searchTerm: "needle", cursor });
    expect(stale.error?.code).toBe(-32602);
    expect(stale.error?.message).toBe(REWOUND);
    // Control: a cursor minted against the record now holding the session pages normally.
    const p1b = await occ({ threadId: "o-reopen", searchTerm: "needle", limit: 1 });
    const p2b = await occ({ threadId: "o-reopen", searchTerm: "needle", cursor: p1b.result.nextCursor });
    expect(p2b.error).toBeUndefined();
    expect(p2b.result.data.map((o: any) => o.snippetMatchRange.start)).toEqual([7, 14]);
  });

  it("thread/search: the keyset's DELETED-session tolerance survives the generation check", async () => {
    // D-M5-15 deliberately continues at the successor when the cursor's session vanishes between pages, and
    // a generation check that refused there would have traded one defect for another. It does not fire:
    // a cursor with `r === 0` names a place in the session ORDERING, which no transcript owns.
    const st = store([
      sess("s-a", { createdAt: 1_000 }, [assistant("needle a")]),
      sess("s-b", { createdAt: 2_000 }, [assistant("needle b")]),
      sess("s-c", { createdAt: 3_000 }, [assistant("needle c")]),
    ]);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1 });
    expect(decodeSearchCursor(p1.result.nextCursor)).toMatchObject({ s: "s-b", r: 0, g: "" });
    st.drop("s-b");
    const p2 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1, cursor: p1.result.nextCursor });
    expect(p2.error).toBeUndefined();
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-c"]);
  });

  it("thread/search: a session that merely GREW between pages is still walked, not refused", async () => {
    // The other half of the same scoping, and the one that says why `r === 0` carries no stamp. Sessions
    // are written to constantly; if a cursor naming the next session in the ORDERING were qualified by that
    // session's transcript generation, every walk over a store anyone is using would refuse at page 2.
    // Keyset semantics already state what happens when a session moves (D-M5-15: it may be re-encountered
    // or skipped, and `created_at` is the key recommended for an exhaustive walk) — refusing is not one of
    // the answers that rule allows.
    const st = store([
      sess("g-a", { createdAt: 1_000 }, [assistant("needle a")]),
      sess("g-b", { createdAt: 2_000 }, [assistant("needle b")]),
    ]);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1 });
    expect(decodeSearchCursor(p1.result.nextCursor)).toMatchObject({ s: "g-b", r: 0, g: "" });
    st.replace("g-b", [assistant("needle b"), assistant("needle b again")]); // a turn lands on it
    const p2 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1, cursor: p1.result.nextCursor });
    expect(p2.error).toBeUndefined();
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["g-b"]);
  });

  it("thread/searchOccurrences: a session another ccx host holds is stamped from the STORE, and its rewind refuses the cursor", async () => {
    // The finding: this server answered `-33001 "Thread is live in another ccx process"` for archive and
    // delete on an id, and paged the same id as immutable cold storage seconds later — so the other host's
    // rewind renumbered rows under a cursor that had declared itself unqualified. The client's two pages
    // together reported `f-0, f-1, NEW-B, NEW-C` where the truth was `f-0, NEW-A, NEW-B, NEW-C`.
    const root = mkTmp("m5e-root-");
    const ccxDir = mkTmp("m5e-ccx-");
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root;
    try {
      writeRoster({ short: "ab12cd34", pid: process.pid, cwd: "/w", kind: "bg", name: "other", state: "working", startedAt: Date.now(), sessionId: "fleet-held" });
      const st = store([sess("fleet-held", { createdAt: 1_000 }, [assistant("needle f-0"), assistant("needle f-1"), assistant("needle f-2")])]);
      boot({ ...st.deps, ccxDir, sessionFactory: () => engine("x") });

      // The other two guards' answer, so the row states the contradiction it closes rather than assuming it.
      expect((await send("thread/archive", { threadId: "fleet-held" })).error?.code).toBe(-33001);

      const p1 = await occ({ threadId: "fleet-held", searchTerm: "needle", limit: 1 });
      expect(decodeOccCursor(p1.result.nextCursor)!.g).toBe("S5000:100"); // the store's own metadata
      const cursor = p1.result.nextCursor as string;

      // Control: the foreign host is idle, the file has not moved, and the walk continues.
      const idle = await occ({ threadId: "fleet-held", searchTerm: "needle", cursor });
      expect(idle.error).toBeUndefined();
      expect(idle.result.data.map((o: any) => o.rowOffset)).toEqual([1, 2]);

      st.replace("fleet-held", [assistant("needle f-0"), assistant("needle NEW-A"), assistant("needle NEW-B")]);
      const stale = await occ({ threadId: "fleet-held", searchTerm: "needle", cursor });
      expect(stale.error?.code).toBe(-32602);
      expect(stale.error?.message).toBe(REWOUND);
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
    }
  });
});

describe("D-M5-26 — a forged cursor value is refused, never repaired", () => {
  it("thread/search: a non-finite v is refused in BOTH directions, where a legitimate one resumes", async () => {
    // `JSON.stringify` cannot emit Infinity and `sortValueOf` screens it besides, so a decoded non-finite
    // `v` is definitionally forged. In `desc` — the schema's default — `compareTuple` answered `Infinity >= 0`
    // at index 0, so the walk RESTARTED at the top and re-delivered every row the client already held under
    // a terminal `nextCursor: null`; in `asc` it answered an empty terminal page. Ordinary garbage was
    // refused all along, which is the inconsistency: the value a client could never have been given was the
    // one that got through.
    const st = store([
      sess("s-a", { createdAt: 1_000, summary: "needle a" }),
      sess("s-b", { createdAt: 2_000, summary: "needle b" }),
      sess("s-c", { createdAt: 3_000, summary: "needle c" }),
    ]);
    boot(st.deps);
    const forge = (json: string) => Buffer.from(json, "utf8").toString("base64url");
    for (const dir of ["desc", "asc"] as const) {
      const real = await search({ searchTerm: "needle", sortDirection: dir, limit: 1 });
      const q = decodeSearchCursor(real.result.nextCursor)!.q;
      for (const v of ["1e999", "-1e999"]) {
        const r = await search({ searchTerm: "needle", sortDirection: dir, cursor: forge(`{"v":${v},"s":"s-b","r":0,"q":"${q}","g":""}`) });
        expect([dir, v, r.error?.code, r.error?.message]).toEqual([dir, v, -32602, "Invalid cursor"]);
      }
      // The control that makes this a screen rather than a wall: the server's own cursor still pages.
      const ok = await search({ searchTerm: "needle", sortDirection: dir, cursor: real.result.nextCursor });
      expect([dir, ok.error]).toEqual([dir, undefined]);
      expect(ok.result.data.length).toBe(2);
    }
  });
});

describe("D-M5-26 — a rewind landing INSIDE one page refuses the page", () => {
  it("thread/search: the symmetric side of the occurrences guard", async () => {
    // `thread/rewind` runs on `record.chain` while a scan holds `runScanExclusive`'s per-server chain, so
    // the two do not serialize and a truncation can land between two window reads of one page. Both scans
    // read windows through the same `readWindow`, so both need the check and each gets its own row.
    const rows = (tag: string) => [...Array(SEARCH_CAPS.windowRows + 200)].map((_, i) => assistant(i === SEARCH_CAPS.windowRows + 100 ? `a ${tag} needle` : `filler ${i}`));
    const st = store([sess("s-live", { createdAt: 1_000 }, rows("first"))]);
    let record: { epoch: number } | undefined;
    let bump = false;
    const srv = boot({
      ...st.deps,
      getSessionMessages: async (sid: string, o?: { offset?: number; limit?: number }) => {
        if (bump && record && o?.offset === SEARCH_CAPS.windowRows) { record.epoch += 1; st.replace("s-live", rows("second")); }
        return st.deps.getSessionMessages!(sid, o);
      },
      sessionFactory: () => engine("s-live"),
    });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    record = srv.registry.get(threadId)!;

    // Control: the same page, no rewind — it answers, so the refusal below is a change of answer.
    expect((await search({ searchTerm: "needle" })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-live"]);

    bump = true;
    const r = await search({ searchTerm: "needle" });
    expect(record.epoch).toBe(1);
    expect(r.result).toBeUndefined();
    expect(r.error?.code).toBe(-33001);
    expect(r.error?.message).toBe("the conversation was rewound during this scan; search again");

    bump = false;
    const retry = await search({ searchTerm: "needle" });
    expect(retry.error).toBeUndefined(); // retryable, which is what BUSY promises
  });

  it("thread/search: a record REPLACED inside one page refuses too — the epoch alone cannot see it", async () => {
    // FIX WAVE G / P2-2#2. The mid-scan check held one `ThreadRecord` and watched its `epoch`. A
    // `thread/close` DELETES the record and a re-admission mints a fresh one back at epoch 0, so the
    // captured object's epoch never moves while the windows after it come from a different generation —
    // measured before the fix: the page came back `ok`, carrying the SECOND generation's rows at offsets
    // computed against the first. `generationOf` already names the record's own id for exactly this reason
    // at page boundaries (the close-and-reopen rows above); this asks the same question per window.
    const rows = (tag: string) => [...Array(SEARCH_CAPS.windowRows + 200)].map((_, i) => assistant(i === SEARCH_CAPS.windowRows + 100 ? `a ${tag} needle` : `filler ${i}`));
    const st = store([sess("s-live", { createdAt: 1_000 }, rows("first"))]);
    let swap = false;
    let threadId = "";
    let srv!: AppServer;
    srv = boot({
      ...st.deps,
      getSessionMessages: async (sid: string, o?: { offset?: number; limit?: number }) => {
        if (swap && o?.offset === SEARCH_CAPS.windowRows) {
          // close-and-readmit, in the registry's own terms: a NEW record, a new id, epoch back at 0.
          const old = srv.registry.get(threadId)!;
          srv.registry.delete(threadId);
          srv.registry.add({ ...old, id: srv.registry.mint(), epoch: 0 });
          st.replace("s-live", rows("second"));
        }
        return st.deps.getSessionMessages!(sid, o);
      },
      sessionFactory: () => engine("s-live"),
    });
    await send("thread/start", {});
    threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    expect(srv.registry.get(threadId)!.epoch).toBe(0);

    // Control first: with no swap the same page answers, so the refusal below is a change of answer.
    expect((await search({ searchTerm: "needle" })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-live"]);

    swap = true;
    const r = await search({ searchTerm: "needle" });
    // The replacement kept the epoch at 0 — which is precisely why watching the epoch could not see it.
    expect(srv.registry.list().map((x) => x.epoch)).toEqual([0]);
    expect(r.result).toBeUndefined();
    expect([r.error?.code, r.error?.message]).toEqual([-33001, "the conversation was rewound during this scan; search again"]);

    swap = false;
    expect((await search({ searchTerm: "needle" })).error).toBeUndefined();   // retryable, as BUSY promises
  });
});

describe("D-M5-26 — the query fingerprint is wide enough to be a binding (fix wave G / P2-2#3)", () => {
  it("the walk shape that collided at 32 bits produces no collision at all", async () => {
    // `q` is the SOLE query-equality check, so two walks that fingerprint alike SHARE a cursor — and the
    // shape that collides is the DEFAULT request. Measured on the 32-bit FNV-1a this replaces, sweeping
    // `created_at`/`desc`/no-cwd over both `archived` values: the first collision arrived at 212,532
    // fingerprints, and all five in that sweep crossed the archive partition (e.g. `9pw457` for both
    // `("t38481", archived:false)` and `("t86137", archived:true)`) — a cursor resuming a walk over the
    // OTHER half of the store, at a tuple computed for a different set of sessions, skipping whatever
    // sorts before it, under a reply that looks ordinary. The same sweep, past the same point, now.
    const seen = new Set<string>();
    let collisions = 0;
    for (let n = 0; n < 220_000; n++)
      for (const archived of [false, true]) {
        const q = fingerprint([`t${n}`, "created_at", "desc", archived, undefined]);
        if (seen.has(q)) collisions++; else seen.add(q);
      }
    expect(`${collisions} collisions in ${seen.size + collisions} fingerprints`).toBe(`0 collisions in 440000 fingerprints`);
    // …and the two things a fingerprint must still be, which width alone does not give it: INJECTIVE over
    // the sentinels (a `cwd` of "u" is not `cwd: undefined`) and separated by the NUL join.
    expect(fingerprint(["u"])).not.toBe(fingerprint([undefined]));
    expect(fingerprint(["n"])).not.toBe(fingerprint([null]));
    expect(fingerprint(["ab", "c"])).not.toBe(fingerprint(["a", "bc"]));
    // …and stable, because a cursor minted by one request is resumed by the next.
    expect(fingerprint(["needle", "created_at", "desc", false, undefined])).toBe(fingerprint(["needle", "created_at", "desc", false, undefined]));
  }, 60_000);
});

// test/unit/appserver/search.test.ts — M5 Task 7: `thread/search`, the store searched.
//
// Driven through the REAL wire (`srv.connect(sink)` + `conn.feed(...)`, config-domain.test.ts's harness):
// `dispatch` is private and four-arg, so a request is the only way in — and going through it is what makes
// the params gate, the error codes, the `warning` notification and the reply shape observable at all.
//
// The store is a FAKE (`listSessions`/`getSessionMessages` deps) and every list it serves is SHUFFLED with
// a seeded permutation before it reaches the handler: this method's whole ordering claim is that the reply
// is sorted by the requested key rather than by whatever order the store happened to answer in, and a
// fixture that arrives pre-sorted proves nothing (Task 6's own review: a paged walk that passes because
// its input was already ordered is an incidental pass). The seed is fixed so a failure reproduces.
import { describe, it, expect, afterEach } from "vitest";
import { Ajv } from "ajv";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { SEARCH_CAPS, decodeSearchCursor, decodeOccCursor } from "../../../src/appserver/searchScan.js";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));

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

/** Feeds the request and waits for ITS reply. The handler awaits real async store fakes, so a single
 *  microtask settles nothing; a poll that gave up silently would turn a never-answered request into a
 *  confusing "cannot read property of undefined" instead of the honest "no reply". */
const send = async (method: string, params: unknown): Promise<number> => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  for (let i = 0; i < 400; i++) {
    if (parse(lines).some((m) => m.id === id)) return id;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${method} (id ${id}) within 2s`);
};
const sendNoAwait = (method: string, params: unknown): number => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  return id;
};
const frameOf = (id: number) => parse(lines).find((l) => l.id === id) as any;
const search = async (params: Record<string, unknown>) => frameOf(await send("thread/search", params));
const occ = async (params: Record<string, unknown>) => frameOf(await send("thread/searchOccurrences", params));
const warnings = () => parse(lines).filter((l) => l.method === "warning");
const mkTmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };

// ── fake store ────────────────────────────────────────────────────────────────────────────────────────
interface Info { sessionId: string; summary: string; lastModified: number; createdAt?: number; customTitle?: string; firstPrompt?: string; tag?: string; cwd?: string }
interface Fake { info: Info; rows: unknown[] }
const prompt = (text: string, uuid = "u1") => ({ type: "user", uuid, message: { content: text } });
/** `uuid`/`msgId` are OPTIONAL and omitted when not passed, which is the point rather than a convenience:
 *  Task 8 publishes the row's uuid, so a row that genuinely carries none has to be constructible here, and
 *  a persisted assistant row's `message.id` is what the item mapper builds `thread/read`'s item ids from —
 *  the jump test needs real ids, the corpus tests do not care. */
const assistant = (text: string, uuid?: string, msgId?: string) =>
  ({ type: "assistant", ...(uuid ? { uuid } : {}), message: { ...(msgId ? { id: msgId } : {}), content: [{ type: "text", text }] } });
const sess = (sessionId: string, over: Partial<Info> = {}, rows: unknown[] = []): Fake =>
  ({ info: { sessionId, summary: `summary of ${sessionId}`, lastModified: 5_000, createdAt: 1_000, ...over }, rows });

/** Deterministic shuffle (mulberry32) — the store's answer order must never be the reply's order by
 *  accident, and a random seed would make a failure unreproducible. */
function shuffled<T>(xs: T[], seed = 0x5eed): T[] {
  const out = [...xs];
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

interface Store { deps: AppServerDeps; calls: { id: string; offset?: number; limit?: number }[]; listCalls: { cwd?: string }[]; infoCalls: string[]; drop(id: string): void }
function store(fakes: Fake[], opts: { shuffle?: boolean } = {}): Store {
  const live = [...fakes];
  const calls: Store["calls"] = [];
  const listCalls: Store["listCalls"] = [];
  const infoCalls: Store["infoCalls"] = [];
  return {
    calls, listCalls, infoCalls,
    drop(id) { const i = live.findIndex((f) => f.info.sessionId === id); if (i >= 0) live.splice(i, 1); },
    deps: {
      // D-M5-20's existence oracle (Task 8). Answers `undefined` for an id this store does not hold, which
      // is exactly what the real reader does for a typo — and `drop()` makes it forget, so "the session was
      // deleted between two pages" is constructible. `thread/search` never calls it; its tests are
      // unaffected by its presence here.
      getSessionInfo: async (id) => { infoCalls.push(id); return live.find((f) => f.info.sessionId === id)?.info; },
      listSessions: async (o) => { listCalls.push({ cwd: o?.cwd }); const infos = live.map((f) => f.info); return opts.shuffle === false ? infos : shuffled(infos); },
      getSessionMessages: async (id, o) => {
        calls.push({ id, offset: o?.offset, limit: o?.limit });
        const rows = live.find((f) => f.info.sessionId === id)?.rows ?? [];
        const from = o?.offset ?? 0;
        return rows.slice(from, o?.limit === undefined ? undefined : from + o.limit);
      },
    },
  };
}

/** A lone surrogate is a half-character: it renders as U+FFFD and JSON-encodes as a bare `\ud800`-class
 *  escape that strict decoders in other languages refuse outright. This is the check the snippet window
 *  has to survive — NOT "is the text astral", which any emoji satisfies. */
const loneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) return true; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
};

describe("thread/search", () => {
  // ── the brief's five rows ───────────────────────────────────────────────────────────────────────────

  it("metadata and content hits come back with snippets in GLOBAL created_at asc order — oldest first, though the store answered shuffled", async () => {
    const fakes = [
      sess("s-old", { createdAt: 1_000, lastModified: 9_000, summary: "a NEEDLE in the summary" }),
      sess("s-mid", { createdAt: 2_000, lastModified: 8_000 }, [assistant("nothing"), prompt("the needle is in the transcript")]),
      sess("s-new", { createdAt: 3_000, lastModified: 7_000, customTitle: "Needle title" }),
      sess("s-none", { createdAt: 1_500, lastModified: 6_000 }, [assistant("haystack only")]),
    ];
    const st = store(fakes);
    boot(st.deps);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc" });
    expect(r.error).toBeUndefined();
    // The ORDER is the claim: createdAt asc, which is neither the store's answer order (shuffled) nor
    // lastModified order (which would put s-old LAST, since it is the most recently touched).
    expect(r.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-old", "s-mid", "s-new"]);
    expect(r.result.data.map((d: any) => d.snippet)).toEqual(["a NEEDLE in the summary", "the needle is in the transcript", "Needle title"]);
    expect(r.result.nextCursor).toBeNull();
    expect("skipped" in r.result).toBe(false); // omitted, not 0, when nothing was skipped
    // …and the store really did answer in a different order, so the assertion above is not incidental.
    const answered = await st.deps.listSessions!({});
    expect((answered as Info[]).map((i) => i.sessionId)).not.toEqual(["s-old", "s-mid", "s-new", "s-none"]);
  });

  it("a page that exhausts the row budget returns ZERO hits with a non-null cursor, and page 2 finds the hit — every storage read bounded by windowRows", async () => {
    const rows = [...Array(4_200)].map((_, i) => assistant(`filler ${i}`));
    rows.push(assistant("here is the needle"));
    const st = store([sess("s-big", { createdAt: 1_000 }, rows)]);
    boot(st.deps);

    const p1 = await search({ searchTerm: "needle" });
    expect(p1.result.data).toEqual([]);           // zero hits…
    expect(p1.result.nextCursor).not.toBeNull();  // …and still progress, honestly reported (D-M5-16)
    const cur = decodeSearchCursor(p1.result.nextCursor)!;
    expect(cur).toEqual({ v: 1_000, s: "s-big", r: SEARCH_CAPS.maxRowsPerPage });
    // Bounds hold AT THE STORAGE BOUNDARY, not just in the loop's arithmetic: no read may ask for more
    // rows than one window, and the windows must tile without a gap (a gap is a permanently unsearched row).
    expect(st.calls.every((c) => (c.limit ?? Infinity) <= SEARCH_CAPS.windowRows)).toBe(true);
    expect(st.calls.map((c) => c.offset)).toEqual([...Array(8)].map((_, i) => i * SEARCH_CAPS.windowRows));

    st.calls.length = 0;
    const p2 = await search({ searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-big"]);
    expect(p2.result.data[0].snippet).toBe("here is the needle");
    expect(st.calls[0].offset).toBe(SEARCH_CAPS.maxRowsPerPage); // resumed IN the file, not from the top
    expect(st.calls.every((c) => (c.limit ?? Infinity) <= SEARCH_CAPS.windowRows)).toBe(true);
  });

  it("a cursor whose session was deleted resumes at the SUCCESSOR — nothing sorted before the cursor is read again", async () => {
    const st = store([
      sess("s-a", { createdAt: 1_000 }, [assistant("needle a")]),
      sess("s-b", { createdAt: 2_000 }, [assistant("needle b")]),
      sess("s-c", { createdAt: 3_000 }, [assistant("needle c")]),
    ]);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1 });
    expect(p1.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-a"]);
    expect(decodeSearchCursor(p1.result.nextCursor)).toEqual({ v: 2_000, s: "s-b", r: 0 });

    st.drop("s-b"); // the cursor now names a session the store no longer has
    st.calls.length = 0;
    const p2 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1, cursor: p1.result.nextCursor });
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-c"]);
    expect(st.calls.map((c) => c.id)).toEqual(["s-c"]); // s-a (before the cursor) is never re-read
  });

  it("a store read failure is an ERROR, term bounds refuse at both ends, and an over-cap limit clamps with a warning on the wire", async () => {
    // (a) D-M5-8: a failing list is -32603, never an honest-looking empty page.
    boot({ listSessions: async () => { throw new Error("store is on fire"); } });
    const fail = await search({ searchTerm: "needle" });
    expect(fail.error.code).toBe(-32603);
    expect(fail.result).toBeUndefined();
    // …and the same rule one door in: a transcript read that fails mid-scan must not reply with the hits
    // collected so far, which would be a page that claims to have searched what it could not read.
    const boom = store([sess("s-1", { createdAt: 1 }, [assistant("needle one")]), sess("s-2", { createdAt: 2 }, [])]);
    boot({
      listSessions: boom.deps.listSessions,
      getSessionMessages: async (id, o) => { if (id === "s-2") throw new Error("unreadable transcript"); return boom.deps.getSessionMessages!(id, o); },
    });
    const midFail = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc" });
    expect(midFail.error.code).toBe(-32603);
    expect(midFail.result).toBeUndefined();

    // (b) term bounds, BOTH ends refused and both boundaries admitted — an off-by-one in either
    // comparison keeps the refusals red-free, so the legal ends are asserted beside the illegal ones.
    const ok = store([sess("s-1", { createdAt: 1 })]);
    boot(ok.deps);
    expect((await search({ searchTerm: "a" })).error.code).toBe(-32602);
    expect((await search({ searchTerm: "" })).error.code).toBe(-32602);
    expect((await search({ searchTerm: "x".repeat(SEARCH_CAPS.maxTerm + 1) })).error.code).toBe(-32602);
    expect((await search({ searchTerm: "ab" })).error).toBeUndefined();
    expect((await search({ searchTerm: "x".repeat(SEARCH_CAPS.maxTerm) })).error).toBeUndefined();

    // (c) limit 60 over 60 metadata hits: 50 rows, a `limitClamped` warning, and a cursor for the rest.
    const many = store([...Array(60)].map((_, i) => sess(`s-${String(i).padStart(2, "0")}`, { createdAt: 1_000 + i, summary: `needle ${i}` })));
    boot(many.deps);
    lines.length = 0;
    const clamped = await search({ searchTerm: "needle", limit: 60, sortKey: "created_at", sortDirection: "asc" });
    expect(clamped.result.data.length).toBe(SEARCH_CAPS.maxLimit);
    expect(clamped.result.nextCursor).not.toBeNull();
    expect(warnings().map((w) => w.params.code)).toEqual(["limitClamped"]);
    expect(warnings()[0].params.message).toMatch(/limit/i);
    // A limit AT the cap is not "adjusted" — a warning nobody needs is noise on every well-behaved call.
    lines.length = 0;
    await search({ searchTerm: "needle", limit: SEARCH_CAPS.maxLimit });
    expect(warnings()).toEqual([]);
    // …and ONE over the cap is the boundary that actually pins the comparison: 60 and 50 both survive an
    // off-by-one, so without this row a `> maxLimit + 1` would hand back 51 results with nothing disclosed.
    lines.length = 0;
    const justOver = await search({ searchTerm: "needle", limit: SEARCH_CAPS.maxLimit + 1, sortKey: "created_at", sortDirection: "asc" });
    expect(justOver.result.data.length).toBe(SEARCH_CAPS.maxLimit);
    expect(warnings().map((w) => w.params.code)).toEqual(["limitClamped"]);
  });

  it("a row past the UTF-16 row cap is skipped AND COUNTED while a later small row in the same session still matches", async () => {
    const huge = "needle" + "z".repeat(SEARCH_CAPS.maxRowUnits - 5); // maxRowUnits + 1 units, term inside
    expect(huge.length).toBe(SEARCH_CAPS.maxRowUnits + 1);
    const st = store([sess("s-huge", { createdAt: 1_000 }, [assistant(huge), assistant("a small needle row")])]);
    boot(st.deps);
    const r = await search({ searchTerm: "needle" });
    expect(r.result.skipped).toBe(1);
    expect(r.result.data.length).toBe(1);
    // The snippet proves WHICH row answered: the oversized row also contains the term, so a cap that
    // silently searched it anyway would still return one hit here.
    expect(r.result.data[0].snippet).toBe("a small needle row");
  });

  // ── beyond the brief ────────────────────────────────────────────────────────────────────────────────

  it("a row EXACTLY at the cap is searched, not skipped — the boundary is inclusive and `skipped` stays absent", async () => {
    const atCap = "needle" + "z".repeat(SEARCH_CAPS.maxRowUnits - 6);
    expect(atCap.length).toBe(SEARCH_CAPS.maxRowUnits);
    const st = store([sess("s-cap", { createdAt: 1_000 }, [assistant(atCap)])]);
    boot(st.deps);
    const r = await search({ searchTerm: "needle" });
    expect(r.result.data.length).toBe(1);
    expect(r.result.data[0].snippet.startsWith("needle")).toBe(true);
    expect("skipped" in r.result).toBe(false);
  });

  it("a hit on the LAST row of a window and on the FIRST row of the next are both found — windows tile, they do not skip or double-count", async () => {
    const w = SEARCH_CAPS.windowRows;
    const at = (n: number) => { const rows = [...Array(n)].map((_, i) => assistant(`filler ${i}`)); rows.push(assistant(`boundary needle ${n}`)); return rows; };
    const st = store([
      sess("s-last", { createdAt: 1_000 }, at(w - 1)), // hit at index w-1: the last row of window 1
      sess("s-first", { createdAt: 2_000 }, at(w)),    // hit at index w: the first row of window 2
    ]);
    boot(st.deps);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc" });
    expect(r.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-last", "s-first"]);
    expect(r.result.data.map((d: any) => d.snippet)).toEqual([`boundary needle ${w - 1}`, `boundary needle ${w}`]);
  });

  it("snippets are centered on the match, and a hit at the very first or very last unit of a row is not lost to the window", async () => {
    const st = store([
      sess("s-head", { createdAt: 1_000 }, [assistant("needle" + "x".repeat(300))]),
      sess("s-tail", { createdAt: 2_000 }, [assistant("x".repeat(300) + "needle")]),
      sess("s-mid", { createdAt: 3_000 }, [assistant("a".repeat(500) + "needle" + "b".repeat(500))]),
    ]);
    boot(st.deps);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc" });
    const [head, tail, mid] = r.result.data.map((d: any) => d.snippet);
    expect(head).toBe("needle" + "x".repeat(SEARCH_CAPS.snippetMax - 6)); // clipped right, nothing lost left
    expect(tail).toBe("x".repeat(97) + "needle");                          // clipped left, ends AT the match
    expect(mid).toBe("a".repeat(97) + "needle" + "b".repeat(97));          // centered: equal padding each side
    expect(mid.length).toBe(SEARCH_CAPS.snippetMax);
  });

  it("a term longer than the 200-unit snippet budget still fits its own snippet whole", async () => {
    const term = "q".repeat(SEARCH_CAPS.maxTerm); // 256 units — over snippetMax
    const st = store([sess("s-long", { createdAt: 1_000 }, [assistant("a".repeat(50) + term + "b".repeat(50))])]);
    boot(st.deps);
    const r = await search({ searchTerm: term });
    expect(r.result.data[0].snippet).toBe(term);
  });

  it("the snippet window never splits a surrogate pair — astral text in, whole characters out", async () => {
    // Reachable, not hypothetical: the window is `max(200, n)` UTF-16 units centered on the match, so with
    // astral characters around the hit the cut lands mid-pair for one parity of match offset and not the
    // other. The sweep shifts the offset by one unit at a time so both parities are covered at both edges.
    const fakes = [...Array(8)].map((_, i) =>
      sess(`s-astral-${i}`, { createdAt: 1_000 + i }, [assistant("z".repeat(i) + "\u{1F600}".repeat(200) + "needle" + "\u{1F600}".repeat(200))]));
    const st = store(fakes);
    boot(st.deps);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 8 });
    expect(r.result.data.length).toBe(8);
    for (const d of r.result.data) {
      expect(d.snippet).toContain("needle");
      expect(loneSurrogate(d.snippet)).toBe(false);
    }
    // And the wire agrees: JSON.stringify escapes a lone surrogate rather than refusing it, so a split
    // would ride out as `\udXXX` and only break the client that parses it.
    expect(/\\ud[89ab][0-9a-f]{2}/i.test(JSON.stringify(r.result.data))).toBe(false);
  });

  it("pages walk sessions that share a sort value exactly once each, in sessionId order, in both directions", async () => {
    // Equal sort keys are where a keyset cursor either holds or silently drops/repeats rows: the tuple's
    // sessionId tie-break is the whole defence, and it must be the SAME in the sort and in the resume.
    const ids = ["s-e", "s-a", "s-f", "s-c", "s-b", "s-d"];
    const fakes = ids.map((id) => sess(id, { createdAt: 4_242, summary: `needle for ${id}` }));
    for (const dir of ["asc", "desc"] as const) {
      const st = store(fakes);
      boot(st.deps);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const r: any = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: dir, limit: 1, ...(cursor ? { cursor } : {}) });
        seen.push(...r.result.data.map((d: any) => d.thread.sessionId));
        cursor = r.result.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor).toBeNull();                       // the walk terminated rather than running out of pages
      expect(seen).toEqual([...ids].sort());           // every session exactly once, tie-broken by id ascending
    }
  });

  it("archived sessions are excluded by default and are the ONLY ones returned with archived:true", async () => {
    const ccxDir = mkTmp("m5search-");
    mkdirSync(join(ccxDir, "archived"), { recursive: true });
    writeFileSync(join(ccxDir, "archived", "s-arch"), "");
    const st = store([
      sess("s-arch", { createdAt: 1_000, summary: "archived needle" }),
      sess("s-open", { createdAt: 2_000, summary: "open needle" }),
    ]);
    boot({ ...st.deps, ccxDir });
    expect((await search({ searchTerm: "needle" })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-open"]);
    expect((await search({ searchTerm: "needle", archived: false })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-open"]);
    expect((await search({ searchTerm: "needle", archived: true })).result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-arch"]);
  });

  it("a garbage, foreign or out-of-range cursor refuses -32602 instead of silently restarting the walk", async () => {
    const st = store([sess("s-1", { createdAt: 1_000, summary: "needle" })]);
    boot(st.deps);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
    for (const cursor of [
      "not-a-cursor",
      b64({ v: 1, s: "s-1" }),                    // no row offset
      b64({ v: 1, s: "s-1", r: -1 }),             // negative offset — refused, never clamped (D-M5-16a)
      b64({ v: 1, s: "s-1", r: 1.5 }),            // fractional
      b64({ v: 1, s: "s-1", r: 1e30 }),           // past MAX_SAFE_INTEGER
      b64({ s: "s-1", r: 0, c: 0, e: null }),     // the OCCURRENCE codec's shape, not this one's
    ]) {
      const r = await search({ searchTerm: "needle", cursor });
      expect(r.error?.code, `cursor ${cursor}`).toBe(-32602);
    }
    // …and a well-formed one still works, so the refusals are not a blanket "cursors are broken".
    const p1 = await search({ searchTerm: "needle" });
    expect(p1.result.data.length).toBe(1);
  });

  it("`cwd` reaches the store, and a live thread's row is the LIVE view, not the store-only projection", async () => {
    const st = store([sess("sess-live", { createdAt: 1_000, summary: "a live needle" }), sess("s-cold", { createdAt: 2_000, summary: "a cold needle" })]);
    const srv = boot({ ...st.deps, sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-live" }) as any });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    expect(threadId.startsWith("thr_")).toBe(true);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", cwd: "/tmp/project-x" });
    expect(st.listCalls.at(-1)!.cwd).toBe("/tmp/project-x");
    // The live session's row carries the registry id and the live-only `queueDepth`/`status` shape; the
    // cold one is the store projection, whose `id` IS the store sessionId.
    expect(r.result.data.map((d: any) => d.thread.id)).toEqual([threadId, "s-cold"]);
    expect(r.result.data[0].thread.sessionId).toBe("sess-live");
    expect(srv.registry.get(threadId)!.sessionId).toBe("sess-live");
  });

  it("two overlapping searches do not interleave — one content scan at a time per server", async () => {
    // Observable because each request's list answer names a DIFFERENT session, so the transcript reads are
    // attributable. Without the exclusive chain the `await` inside the first list lets the second request's
    // list run before the first has read a single row.
    const log: string[] = [];
    let listN = 0;
    boot({
      listSessions: async () => {
        const n = ++listN;
        log.push(`list#${n}`);
        await new Promise((r) => setTimeout(r, 10));
        return [{ sessionId: `s-${n}`, summary: "no metadata hit here", lastModified: 1_000, createdAt: 1_000 }];
      },
      getSessionMessages: async (id) => { log.push(`read:${id}`); return [assistant("needle")]; },
    });
    const a = sendNoAwait("thread/search", { searchTerm: "needle" });
    const b = sendNoAwait("thread/search", { searchTerm: "needle" });
    for (let i = 0; i < 400 && !(frameOf(a) && frameOf(b)); i++) await new Promise((r) => setTimeout(r, 5));
    expect(frameOf(a).result.data.length).toBe(1);
    expect(frameOf(b).result.data.length).toBe(1);
    expect(log).toEqual(["list#1", "read:s-1", "list#2", "read:s-2"]);
  });

  it("the FILE cap bounds a page too, not just the row cap — 40 transcripts opened, the rest carried by the cursor", async () => {
    // The row cap is what the beyond-budget row above exercises; `maxFilesPerPage` is a separate bound, and
    // every session here is a one-row hit, so the row budget is nowhere near spent when it fires.
    const fakes = [...Array(45)].map((_, i) => sess(`s-${String(i).padStart(2, "0")}`, { createdAt: 1_000 + i }, [assistant(`needle ${i}`)]));
    const st = store(fakes);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 50 });
    expect(p1.result.data.length).toBe(SEARCH_CAPS.maxFilesPerPage);
    expect(p1.result.nextCursor).not.toBeNull();
    expect(st.calls.length).toBe(SEARCH_CAPS.maxFilesPerPage); // 40 transcripts opened, not 45
    const p2 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 50, cursor: p1.result.nextCursor });
    const seen = [...p1.result.data, ...p2.result.data].map((d: any) => d.thread.sessionId);
    expect(seen).toEqual(fakes.map((f) => f.info.sessionId)); // all 45, in order, exactly once
    expect(p2.result.nextCursor).toBeNull();
  });

  it("a non-finite sort value sorts LAST in both directions and the walk still returns every session exactly once", async () => {
    // The screen lives in `sortValueOf` (D-M5-15a) and this handler must route BOTH the sort and the cursor
    // mint through it: a bespoke `createdAt ?? null` callback hands NaN straight to the comparator, which
    // then answers NaN — read by `Array.prototype.sort` as "no opinion", leaving unrelated well-formed
    // sessions unordered. A bring-your-own SessionStore's `mtime` really does arrive as NaN.
    const ids = [...Array(12)].map((_, i) => `s-${String(i).padStart(2, "0")}`);
    const fakes = ids.map((id, i) => sess(id, { createdAt: id === "s-05" ? Number.NaN : 1_000 + i, summary: `needle ${id}` }));
    for (const dir of ["asc", "desc"] as const) {
      const st = store(fakes);
      boot(st.deps);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 30; page++) {
        const r: any = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: dir, limit: 1, ...(cursor ? { cursor } : {}) });
        seen.push(...r.result.data.map((d: any) => d.thread.sessionId));
        cursor = r.result.nextCursor;
        if (cursor === null) break;
      }
      expect(cursor).toBeNull();
      expect([...seen].sort()).toEqual([...ids].sort()); // every session, exactly once — none lost, none repeated
      expect(seen.at(-1)).toBe("s-05");                  // …and the unusable sort value sorts LAST, both directions
    }
  });

  it("the metadata corpus is searched in its documented order — customTitle, then summary, then firstPrompt, then tag", async () => {
    const st = store([sess("s-all", { createdAt: 1_000, customTitle: "needle in the title", summary: "needle in the summary", firstPrompt: "needle in the prompt", tag: "needle-tag" })]);
    boot(st.deps);
    expect((await search({ searchTerm: "needle" })).result.data[0].snippet).toBe("needle in the title");
    const st2 = store([sess("s-tag", { createdAt: 1_000, summary: "no hit here", tag: "needle-tag" })]);
    boot(st2.deps);
    expect((await search({ searchTerm: "needle" })).result.data[0].snippet).toBe("needle-tag"); // the last field is reached
  });

  it("the reply on the wire validates against the published result schema — every optional key filled and every arm of nextCursor", async () => {
    // D-M5-19 ships a RESULT schema and a result schema nothing ever validates is decoration; this is the
    // one place the generated artifact meets an actual reply. `additionalProperties: false` works in both
    // directions — a key the handler invents fails as loudly as a required one it drops — so the two calls
    // between them have to cover `skipped` present and absent and `nextCursor` null and non-null.
    const huge = "needle" + "z".repeat(SEARCH_CAPS.maxRowUnits - 5);
    const st = store([
      sess("s-meta", { createdAt: 1_000, summary: "a needle in metadata" }),
      sess("s-skip", { createdAt: 2_000 }, [assistant(huge), assistant("small needle row")]),
    ]);
    boot(st.deps);
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["thread/search"]);
    const full = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 1 });
    expect(full.result.nextCursor).not.toBeNull();
    expect(validate(full.result), JSON.stringify(validate.errors)).toBe(true);
    const rest = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", cursor: full.result.nextCursor });
    expect(rest.result.skipped).toBe(1);
    expect(rest.result.nextCursor).toBeNull();
    expect(validate(rest.result), JSON.stringify(validate.errors)).toBe(true);
  });

  it("a case fold that CHANGES LENGTH does not slide the snippet window off the match — both corpora, at one occurrence", async () => {
    // The match is located in `text.toLowerCase()`; the snippet is cut from `text`. U+0130 (Turkish
    // capital İ) is the ONE code point in all of Unicode whose lowercase is longer than itself (swept
    // 0..0x10FFFF: expanders 1, shrinkers 0), so each one before a match shifts the lowered offset by one
    // unit. It is wrong at E = 1, not at some exotic threshold: unmapped, the window here starts one unit
    // late and ends one unit late, and the same offset is what Task 8 publishes as `snippetMatchRange`.
    const pad = "y".repeat(300);
    const drifty = "İ" + pad + "needle" + pad;
    expect(drifty.toLowerCase().indexOf("needle") - drifty.indexOf("needle")).toBe(1); // the drift, measured
    const st = store([
      sess("s-meta", { createdAt: 1_000, customTitle: drifty }),                 // the metadata call site
      sess("s-row", { createdAt: 2_000 }, [assistant(drifty)]),                  // the transcript call site
    ]);
    boot(st.deps);
    const r = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc" });
    // Exact strings, not `toContain`: at one occurrence the drifted window still holds the term, so
    // "the snippet contains the match" is precisely the assertion that would NOT catch this.
    const centered = "y".repeat(97) + "needle" + "y".repeat(97);
    expect(r.result.data.map((d: any) => d.snippet)).toEqual([centered, centered]);
  });

  it("a fold INSIDE the term maps the match's LENGTH too — the term's own length is the span in neither the lowered row nor the original", async () => {
    // The row above pins the START of the match; this one pins its LENGTH, and they are separate axes: the
    // expansion has to sit inside the term rather than before the match. `İstanbul` is 8 UTF-16 units and
    // lowers to 9 ("i" + U+0307 + "stanbul"), so a row storing the already-decomposed form and a row
    // storing the composed İ are BOTH hits for it while covering 9 and 8 original units respectively —
    // the term's length (8) is wrong for the first, the lowered term's length (9) wrong for the second.
    // Observable here through the window, which is centered on the match and therefore shifts by one unit
    // when the length is off by one; Task 8 publishes the same number as `snippetMatchRange`, where being
    // one unit off is a wrong PUBLISHED range rather than a slightly off-center excerpt.
    const DEC = "i̇stanbul";                        // "İstanbul".toLowerCase() — 9 units, and a form a row can hold
    expect("İstanbul".toLowerCase()).toBe(DEC);
    const y = (n: number) => "y".repeat(n);
    const decomposed = y(300) + DEC + y(300);       // length-stable row: the fast path, and a 9-unit span
    const composed = y(300) + "İstanbul" + y(300);  // the fold is INSIDE the match: an 8-unit span
    const bothAxes = "İ" + y(300) + "İstanbul" + y(300); // …plus one BEFORE it, so start and length both move
    const st = store([
      sess("s-meta", { createdAt: 1_000, customTitle: decomposed }),          // the metadata call site
      sess("s-dec", { createdAt: 2_000 }, [assistant(decomposed)]),
      sess("s-com", { createdAt: 3_000 }, [assistant(composed)]),
      sess("s-both", { createdAt: 4_000 }, [assistant(bothAxes)]),
    ]);
    boot(st.deps);
    const r = await search({ searchTerm: "İstanbul", sortKey: "created_at", sortDirection: "asc" });
    // Exact strings again: every one of these still CONTAINS the term when the length is wrong, so
    // `toContain` is precisely the assertion that would let this through.
    const nine = y(95) + DEC + y(96);               // pad = floor((200-9)/2) = 95
    const eight = y(96) + "İstanbul" + y(96);       // pad = floor((200-8)/2) = 96
    expect(r.result.data.map((d: any) => d.snippet)).toEqual([nine, nine, eight, eight]);
    expect(r.result.data.every((d: any) => d.snippet.length === SEARCH_CAPS.snippetMax)).toBe(true);
  });

  it("a rename that lands MID-WALK is reported once, not zero times — metadata is checked on every page", async () => {
    // The `startRow === 0` guard this replaces was justified as costing nothing and reporting the session
    // "exactly once"; over a store that changes between pages it reported it ZERO times, which is a
    // coverage loss, and D-M5-16 is explicit that the caps bound work and never coverage.
    const fakes = [sess("s-big", { createdAt: 1_000 }, [...Array(4_200)].map((_, i) => assistant(`filler ${i}`)))];
    const st = store(fakes);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle" });
    expect(p1.result.data).toEqual([]);
    expect(decodeSearchCursor(p1.result.nextCursor)).toEqual({ v: 1_000, s: "s-big", r: SEARCH_CAPS.maxRowsPerPage });
    fakes[0].info.customTitle = "a needle in the title"; // a `thread/name/set` lands between the two pages
    const p2 = await search({ searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-big"]); // once — exactly once
    expect(p2.result.data[0].snippet).toBe("a needle in the title");
  });

  it("a snippet carries the row's ORIGINAL casing — the wire ships the transcript, not the lowercased copy searched", async () => {
    // Search lowercases both sides to compare them; the excerpt must not inherit that. Undefended, the
    // wire could ship flattened transcript text past every other gate in this file.
    const said = "Mixed CASE: a NEEDLE, Preserved Verbatim.";
    const st = store([sess("s-case", { createdAt: 1_000 }, [assistant(said)])]);
    boot(st.deps);
    expect((await search({ searchTerm: "needle" })).result.data[0].snippet).toBe(said);
  });

  it("a cursor that sorts after every REMAINING session answers an honest empty page, not an internal error", async () => {
    // Reachable without forging anything: the walk's own cursor goes stale when the sessions it named are
    // deleted between pages. `findIndex` then answers -1, and -1 used as a start index reads `sorted[-1]`.
    const st = store([
      sess("s-a", { createdAt: 1_000, summary: "needle a" }),
      sess("s-b", { createdAt: 2_000, summary: "needle b" }),
      sess("s-c", { createdAt: 3_000, summary: "needle c" }),
    ]);
    boot(st.deps);
    const p1 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", limit: 2 });
    expect(p1.result.data.map((d: any) => d.thread.sessionId)).toEqual(["s-a", "s-b"]);
    expect(decodeSearchCursor(p1.result.nextCursor)).toEqual({ v: 3_000, s: "s-c", r: 0 });
    st.drop("s-b");
    st.drop("s-c"); // everything at or after the cursor is gone; only s-a, which sorts BEFORE it, remains
    const p2 = await search({ searchTerm: "needle", sortKey: "created_at", sortDirection: "asc", cursor: p1.result.nextCursor });
    expect(p2.error).toBeUndefined();
    expect(p2.result).toEqual({ data: [], nextCursor: null });
  });

  it("the corpus is the classifier's, not every row: tool_results and command echoes never match", async () => {
    const st = store([sess("s-noise", { createdAt: 1_000 }, [
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "needle in a tool result" }] } },
      { type: "user", uuid: "u9", message: { content: "<command-name>/needle</command-name>" } },
      { type: "system", message: { content: "needle in a system row" } },
    ])]);
    boot(st.deps);
    expect((await search({ searchTerm: "needle" })).result.data).toEqual([]);
  });
});

// ── thread/searchOccurrences (Task 8) ──────────────────────────────────────────────────────────────────
//
// The method that PUBLISHES `snippetMatchRange` (Codex's field name, verbatim), so the standing assertion
// in this block is not "the arithmetic is x" but `snippet.slice(start, end)` IS the matched text: the range
// is a wire contract, and an exact-number check that agreed with a wrong implementation on both sides would
// pass while the client highlights the wrong characters.
describe("thread/searchOccurrences", () => {
  /** A live thread over the fake store. `thread/start`'s registration stamps `record.sessionId` off the
   *  engine's own `sessionId` (server.ts's startThread), which is subscribe.test.ts's fixture pattern — the
   *  record is findable by store id without forging an init frame. */
  const bootLive = async (fakes: Fake[], sessionId: string, engine: Record<string, unknown> = {}) => {
    const st = store(fakes);
    const srv = boot({
      ...st.deps,
      sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId, ...engine }) as any,
    });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    return { st, srv, threadId, record: srv.registry.get(threadId)! };
  };

  // ── the brief's five rows ───────────────────────────────────────────────────────────────────────────

  it("a COLD session's occurrences come back in row order with UTF-16 ranges, row uuids and a null readCursor", async () => {
    const rows = [
      prompt("a needle here", "u-prompt"),                                                                                        // row 0 — one hit
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "needle in a tool result" }] } },    // row 1 — outside the corpus
      assistant("no match in this row", "u-quiet"),                                                                               // row 2 — IN the corpus, no hit
      assistant("needle twice: needle", "u-asst"),                                                                                // row 3 — two hits
      assistant("needle with no uuid at all"),                                                                                    // row 4 — uuid null, not absent
    ];
    const st = store([sess("cold-session", { createdAt: 1_000 }, rows)]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    // Row 1 is excluded by the classifier and row 2 by having no match — the second is what pins the inner
    // loop's `at >= 0` guard, which owns `originalSpan`'s documented `atLowered >= 0` precondition: a loop
    // that ran its body once on a miss would publish a clamped range for every corpus row in the file.
    expect(r.result.data.map((o: any) => o.rowOffset)).toEqual([0, 3, 3, 4]);
    expect(r.result.data.map((o: any) => o.uuid)).toEqual(["u-prompt", "u-asst", "u-asst", null]);
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([
      { start: 2, end: 8 }, { start: 0, end: 6 }, { start: 14, end: 20 }, { start: 0, end: 6 },
    ]);
    // THE contract, not the arithmetic.
    for (const o of r.result.data) expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end)).toBe("needle");
    expect(r.result.data.map((o: any) => o.readCursor)).toEqual([null, null, null, null]);
    expect(r.result.nextCursor).toBeNull();
    expect("skipped" in r.result).toBe(false);
    // The corpus is the TRANSCRIPT only — `sess()` gives every session a `summary`, and the store-wide
    // search's metadata corpus has no counterpart here.
    const meta = store([sess("meta-only", { createdAt: 1_000, customTitle: "a needle title", summary: "needle summary", firstPrompt: "needle prompt", tag: "needle" }, [assistant("quiet row")])]);
    boot(meta.deps);
    expect((await occ({ threadId: "meta-only", searchTerm: "needle" })).result.data).toEqual([]);
  });

  it("a threadId the store does not know refuses THREAD_NOT_FOUND — an empty page over a typo is the D-M5-8 lie in miniature", async () => {
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("a needle row", "u-a")])]);
    boot(st.deps);
    const unknown = await occ({ threadId: "no-such-session", searchTerm: "needle" });
    expect(unknown.error?.code).toBe(-33004);
    expect(unknown.error?.message).toBe("Thread not found");
    expect(unknown.result).toBeUndefined();
    // A `thr_…` id the REGISTRY does not know refuses the same code one door earlier (resolveThreadId), and
    // the store is never asked about it — the two refusals are different mechanisms with one wire answer.
    st.infoCalls.length = 0;
    expect((await occ({ threadId: "thr_deadbeef", searchTerm: "needle" })).error?.code).toBe(-33004);
    expect(st.infoCalls).toEqual([]);
    // …and the known id still answers, so neither refusal is a blanket failure.
    expect((await occ({ threadId: "cold-session", searchTerm: "needle" })).result.data.length).toBe(1);
    // The session deleted BETWEEN two pages is the reachable form of this: the cursor is well-formed and
    // the store has simply stopped knowing the id.
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 1 });
    st.drop("cold-session");
    expect((await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor })).error?.code).toBe(-33004);
  });

  it("every occurrence on a LIVE thread carries the pager's own epoch-qualified cursor, and thread/read with it UNCHANGED lands on the matched row", async () => {
    const texts = ["a needle in the prompt", "nothing to see here", "the second needle", "a third needle row"];
    const rows = [prompt(texts[0], "u-0"), assistant(texts[1], "u-1", "m1"), assistant(texts[2], "u-2", "m2"), assistant(texts[3], "u-3", "m3")];
    const { st, threadId, record } = await bootLive([sess("live-session", { createdAt: 1_000 }, rows)], "live-session");
    expect(record.sessionId).toBe("live-session");
    st.infoCalls.length = 0;
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    expect(r.result.data.map((o: any) => o.rowOffset)).toEqual([0, 2, 3]);
    // The existence check is asked of the STORE only when no live record backs the id: a thread started
    // this tick has every right to be searched before its first row is ever persisted.
    expect(st.infoCalls).toEqual([]);
    for (const o of r.result.data) {
      expect(o.readCursor).toBe(`${record.epoch}:${o.rowOffset + 1}`);
      // Items expose id/text, not uuid (plan review F10), so the assertion is on the SERIALIZED page: it
      // stays true whatever field the pager's item shape carries the row's text in.
      const page = frameOf(await send("thread/read", { threadId, cursor: o.readCursor, limit: 1 }));
      expect(page.error, o.readCursor).toBeUndefined();
      expect(JSON.stringify(page.result.data), o.readCursor).toContain(texts[o.rowOffset]);
    }
    // …and the +1 is load-bearing rather than incidental: the pager's bound is EXCLUSIVE, so the un-shifted
    // cursor addresses the row BEFORE the hit (and row 0's becomes an empty page).
    const off = frameOf(await send("thread/read", { threadId, cursor: `${record.epoch}:2`, limit: 1 }));
    expect(JSON.stringify(off.result.data)).not.toContain(texts[2]);
  });

  it("a page boundary INSIDE one row resumes at the next occurrence of that row, not at the next row", async () => {
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("needle one needle two needle three", "u-a")])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 2 });
    expect(p1.result.data.map((o: any) => o.rowOffset)).toEqual([0, 0]);
    expect(p1.result.data.map((o: any) => o.snippetMatchRange.start)).toEqual([0, 11]);
    expect(p1.result.nextCursor).not.toBeNull();
    expect(decodeOccCursor(p1.result.nextCursor)).toEqual({ s: "cold-session", r: 0, c: 12, e: null });
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((o: any) => o.rowOffset)).toEqual([0]);
    expect(p2.result.data[0].snippetMatchRange.start).toBe(22);
    expect(p2.result.nextCursor).toBeNull();
  });

  it("a live continuation cursor is refused once a rewind bumps the epoch — the pager's own message, verbatim", async () => {
    const { threadId, record } = await bootLive([sess("live-session", { createdAt: 1_000 }, [assistant("needle needle needle", "u-a")])], "live-session");
    const p1 = await occ({ threadId, searchTerm: "needle", limit: 1 });
    expect(decodeOccCursor(p1.result.nextCursor)).toEqual({ s: "live-session", r: 0, c: 1, e: 0 });
    record.epoch += 1; // a rewind, simulated: the rows this cursor named are no longer the rows at those offsets
    const stale = await occ({ threadId, searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(stale.error?.code).toBe(-32602);
    expect(stale.error?.message).toBe("cursor invalidated by a rewind; re-read from the start");
    // The refusal is the EPOCH and not the cursor: put the generation back and the very same string works.
    record.epoch -= 1;
    expect((await occ({ threadId, searchTerm: "needle", cursor: p1.result.nextCursor })).result.data.map((o: any) => o.snippetMatchRange.start)).toEqual([7, 14]);
  });

  it("the OTHER arm of the epoch condition: a live cursor presented once the thread is gone is refused too, while a COLD cursor stays valid after the session goes live", async () => {
    // Two sides, two rows (this file has twice shipped a two-sided rule with one side pinned). Side A: the
    // thread is no longer live, so there is no generation to compare a live cursor's `e` against.
    const gone = await bootLive([sess("live-session", { createdAt: 1_000 }, [assistant("needle needle", "u-a")])], "live-session");
    const p1 = await occ({ threadId: gone.threadId, searchTerm: "needle", limit: 1 });
    expect(decodeOccCursor(p1.result.nextCursor)!.e).toBe(0);
    await send("thread/close", { threadId: gone.threadId });
    // Addressed by STORE id — the `thr_…` id died with the record, and the cursor's subject is the session.
    const orphan = await occ({ threadId: "live-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(orphan.error?.code).toBe(-32602);
    expect(orphan.error?.message).toBe("cursor invalidated by a rewind; re-read from the start");

    // Side B: a COLD mint carries `e: null` and is accepted unqualified — deliberate, documented asymmetry
    // (a store session has no generation counter), so the same walk survives the session going live.
    const st = store([sess("later-live", { createdAt: 1_000 }, [assistant("needle needle", "u-a")])]);
    const srv = boot({ ...st.deps, sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "later-live" }) as any });
    const cold = await occ({ threadId: "later-live", searchTerm: "needle", limit: 1 });
    expect(decodeOccCursor(cold.result.nextCursor)!.e).toBeNull();
    expect(cold.result.data[0].readCursor).toBeNull();
    await send("thread/start", {});
    expect(srv.registry.list().some((rec) => rec.sessionId === "later-live")).toBe(true);
    const after = await occ({ threadId: "later-live", searchTerm: "needle", cursor: cold.result.nextCursor });
    expect(after.error).toBeUndefined();
    expect(after.result.data.map((o: any) => o.snippetMatchRange.start)).toEqual([7]);
    expect(after.result.data[0].readCursor).toBe("0:1"); // now live, so the jump cursor appears mid-walk
  });

  it("60 single-hit rows cap at the requested 50 with a cursor for the rest, and an over-cap limit clamps with a warning", async () => {
    const rows = [...Array(60)].map((_, i) => assistant(`needle ${i}`, `u-${i}`));
    const st = store([sess("cold-session", { createdAt: 1_000 }, rows)]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: SEARCH_CAPS.maxLimit });
    expect(p1.result.data.length).toBe(SEARCH_CAPS.maxLimit);
    expect(p1.result.data.map((o: any) => o.rowOffset)).toEqual([...Array(50)].map((_, i) => i));
    expect(p1.result.nextCursor).not.toBeNull();
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((o: any) => o.rowOffset)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(p2.result.nextCursor).toBeNull();
    // The clamp, and the boundary that pins the comparison rather than surviving an off-by-one.
    lines.length = 0;
    const over = await occ({ threadId: "cold-session", searchTerm: "needle", limit: SEARCH_CAPS.maxLimit + 1 });
    expect(over.result.data.length).toBe(SEARCH_CAPS.maxLimit);
    expect(warnings().map((w) => w.params.code)).toEqual(["limitClamped"]);
    expect(warnings()[0].params.message).toMatch(/searchOccurrences limit clamped/);
    lines.length = 0;
    await occ({ threadId: "cold-session", searchTerm: "needle", limit: SEARCH_CAPS.maxLimit });
    expect(warnings()).toEqual([]); // a limit AT the cap is not "adjusted"
  });

  // ── the range, probed where it is most exposed ───────────────────────────────────────────────────────

  it("the resume offset applies ONLY to the row the cursor names — a hit at unit 0 of the NEXT row is not skipped", async () => {
    const st = store([sess("cold-session", { createdAt: 1_000 }, [
      assistant("needle needle", "u-0"),        // two hits, so the mint lands mid-row with c = 1
      assistant("needle at the head", "u-1"),   // …and this row's only hit sits at unit 0
    ])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 1 });
    expect(decodeOccCursor(p1.result.nextCursor)).toEqual({ s: "cold-session", r: 0, c: 1, e: null });
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    // Applying `c` to every row would search row 1 from unit 1 and lose its head hit entirely.
    expect(p2.result.data.map((o: any) => [o.rowOffset, o.snippetMatchRange.start])).toEqual([[0, 7], [1, 0]]);
  });

  it("overlapping occurrences are published at every offset, and a resume landing EXACTLY on one returns it", async () => {
    // `at + 1` (not `at + term.length`) is what makes "aa" three occurrences in "aaaa" — and it is also the
    // step the mint carries, so the boundary case is a resume whose `c` IS the next occurrence's offset.
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("aaaa", "u-a")])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "aa", limit: 2 });
    expect(p1.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 0, end: 2 }, { start: 1, end: 3 }]);
    expect(decodeOccCursor(p1.result.nextCursor)!.c).toBe(2);
    const p2 = await occ({ threadId: "cold-session", searchTerm: "aa", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 2, end: 4 }]);
    expect(p2.result.nextCursor).toBeNull();
    for (const o of [...p1.result.data, ...p2.result.data]) expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end)).toBe("aa");
  });

  it("two occurrences whose snippet WINDOWS overlap each publish a range into their own snippet, not into the row", async () => {
    const x = "x".repeat(150);
    const row = `${x}needle${"x".repeat(20)}needle${x}`;
    expect([row.indexOf("needle"), row.lastIndexOf("needle")]).toEqual([150, 176]);
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(row, "u-a")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    // Row-absolute publication would read {150,156} and {176,182} — both wrong against their own snippet.
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 97, end: 103 }, { start: 97, end: 103 }]);
    for (const o of r.result.data) expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end)).toBe("needle");
    // …and the two windows really are different slices of the row, so the equal numbers are not one window.
    expect(r.result.data[0].snippet).not.toBe(r.result.data[1].snippet);
    expect(row.indexOf(r.result.data[0].snippet)).toBe(53);
    expect(row.indexOf(r.result.data[1].snippet)).toBe(79);
  });

  it("a term appearing 60 times in ONE row pages within that row and every page's ranges still select the match", async () => {
    const row = [...Array(60)].map((_, i) => `needle${i}`).join(" ");
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(row, "u-a")])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: SEARCH_CAPS.maxLimit });
    expect(p1.result.data.length).toBe(SEARCH_CAPS.maxLimit);
    expect(new Set(p1.result.data.map((o: any) => o.rowOffset))).toEqual(new Set([0]));
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.length).toBe(10);
    expect(p2.result.nextCursor).toBeNull();
    const all = [...p1.result.data, ...p2.result.data];
    for (const o of all) expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end)).toBe("needle");
    // Every occurrence is a DIFFERENT one: the row's own match offsets, in order, exactly once each.
    const offsets = all.map((o: any) => row.indexOf(o.snippet) + o.snippetMatchRange.start);
    const truth: number[] = [];
    for (let at = row.indexOf("needle"); at >= 0; at = row.indexOf("needle", at + 1)) truth.push(at);
    expect(offsets).toEqual(truth);
  });

  it("a hit on the LAST row of a window and on the FIRST row of the next are both found — windows tile", async () => {
    const rows = [...Array(SEARCH_CAPS.windowRows + 1)].map((_, i) =>
      assistant(i === SEARCH_CAPS.windowRows - 1 || i === SEARCH_CAPS.windowRows ? `a needle at ${i}` : `filler ${i}`, `u-${i}`));
    const st = store([sess("cold-session", { createdAt: 1_000 }, rows)]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(r.result.data.map((o: any) => o.rowOffset)).toEqual([SEARCH_CAPS.windowRows - 1, SEARCH_CAPS.windowRows]);
    expect(st.calls.map((c) => c.offset)).toEqual([0, SEARCH_CAPS.windowRows]); // read in windows, not whole
    expect(st.calls.every((c) => c.limit === SEARCH_CAPS.windowRows)).toBe(true);
  });

  it("a page that exhausts the ROW budget returns zero occurrences with a non-null cursor, and page 2 finds the hit", async () => {
    const rows = [...Array(4_200)].map((_, i) => assistant(i === 4_100 ? "a needle beyond the budget" : `filler ${i}`, `u-${i}`));
    const st = store([sess("cold-session", { createdAt: 1_000 }, rows)]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(p1.result.data).toEqual([]); // bounded progress, honestly reported (D-M5-16) — never "no matches"
    expect(decodeOccCursor(p1.result.nextCursor)).toEqual({ s: "cold-session", r: SEARCH_CAPS.maxRowsPerPage, c: 0, e: null });
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.result.data.map((o: any) => o.rowOffset)).toEqual([4_100]);
    expect(p2.result.nextCursor).toBeNull();
  });

  it("a row past the UTF-16 row cap is skipped AND COUNTED while a later small row still matches", async () => {
    const huge = `needle${"z".repeat(SEARCH_CAPS.maxRowUnits - 5)}`;
    expect(huge.length).toBe(SEARCH_CAPS.maxRowUnits + 1);
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(huge, "u-big"), assistant("a small needle row", "u-small")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(r.result.data.map((o: any) => o.rowOffset)).toEqual([1]);
    expect(r.result.skipped).toBe(1); // D-M5-8's disclosure half
    // The boundary is INCLUSIVE, and it needs its own row here rather than borrowing `thread/search`'s: the
    // `> maxRowUnits` comparison is spelled once per handler, so an off-by-one in this copy alone is
    // invisible to the other's test.
    const atCap = `needle${"z".repeat(SEARCH_CAPS.maxRowUnits - 6)}`;
    expect(atCap.length).toBe(SEARCH_CAPS.maxRowUnits);
    const edge = store([sess("cold-session", { createdAt: 1_000 }, [assistant(atCap, "u-edge")])]);
    boot(edge.deps);
    const r2 = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(r2.result.data.map((o: any) => o.rowOffset)).toEqual([0]);
    expect("skipped" in r2.result).toBe(false);
  });

  it("a cursor whose row offset is past the end of the transcript answers an honest empty page, not a crash", async () => {
    // Reachable without forging anything: a cold transcript can be truncated on disk between two pages, and
    // the store's immutability-between-requests is an assumption, not an enforcement (D-M5-7).
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("needle needle", "u-a")])]);
    boot(st.deps);
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 1 });
    st.drop("cold-session");
    // Same session id, now holding nothing: the existence check still passes (re-add it), the walk does not.
    const shrunk = store([sess("cold-session", { createdAt: 1_000 }, [])]);
    boot(shrunk.deps);
    const p2 = await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor });
    expect(p2.error).toBeUndefined();
    expect(p2.result).toEqual({ data: [], nextCursor: null });
  });

  it("ONE epoch read per request: a rewind landing mid-scan cannot ship a reply whose two cursor families disagree", async () => {
    // `record.epoch` is mutable and the scan awaits between window reads, so the mint's `e` and each
    // occurrence's `readCursor` are two chances to read it. They must be one read — and it must be the read
    // taken BEFORE the rows were examined, so both cursors carry the superseded generation and both are
    // refused, rather than the fresh one silently addressing post-truncation rows at pre-truncation offsets.
    const rows = [...Array(SEARCH_CAPS.windowRows + 1)].map((_, i) => assistant(i === 0 || i === SEARCH_CAPS.windowRows ? "a needle row" : `filler ${i}`, `u-${i}`));
    const st = store([sess("live-session", { createdAt: 1_000 }, rows)]);
    let record: { epoch: number } | undefined;
    const srv = boot({
      ...st.deps,
      getSessionMessages: async (sid, o) => { if (record && o?.offset === 0) record.epoch += 1; return st.deps.getSessionMessages!(sid, o); },
      sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "live-session" }) as any,
    });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    record = srv.registry.get(threadId)!;
    const r = await occ({ threadId, searchTerm: "needle", limit: 1 });
    expect(record.epoch).toBe(1); // the rewind really did land inside the scan
    expect(r.result.data[0].readCursor).toBe("0:1");
    expect(decodeOccCursor(r.result.nextCursor)!.e).toBe(0);
    expect(Number(r.result.data[0].readCursor.split(":")[0])).toBe(decodeOccCursor(r.result.nextCursor)!.e);
    // …and the continuation is then refused, which is the point of carrying the superseded generation.
    expect((await occ({ threadId, searchTerm: "needle", cursor: r.result.nextCursor })).error?.code).toBe(-32602);
  });

  // ── the two edges of the span, one row per side ──────────────────────────────────────────────────────

  it("a match whose START edge lands inside a case-fold expansion publishes a range covering that character", async () => {
    // "İ".toLowerCase() is "i" + U+0307, the only length-changing fold in Unicode. The term here begins
    // with the combining dot, so the match starts BETWEEN the two halves — the start edge must floor onto
    // the İ, or the published range excludes a character that matched.
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("aİb", "u-a")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "\u0307b" });
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 1, end: 3 }]);
    expect(r.result.data[0].snippet.slice(1, 3)).toBe("İb");
  });

  it("a match whose END edge lands inside a case-fold expansion publishes a range covering that character", async () => {
    // The mirror: the term ends with the expansion's FIRST half, so the end edge must ceil past the İ.
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("aİb", "u-a")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "ai" });
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 0, end: 2 }]);
    expect(r.result.data[0].snippet.slice(0, 2)).toBe("aİ");
  });

  it("a match straddling an expansion at BOTH edges covers both original characters — the two edges disagree only here", async () => {
    const row = "pad İİ pad";
    expect(row.toLowerCase().indexOf("\u0307i")).toBe(5);
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(row, "u-a")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "\u0307i" });
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 4, end: 6 }]);
    expect(r.result.data[0].snippet.slice(4, 6)).toBe("İİ");
  });

  it("a fold BEFORE the match does not slide the range, and one INSIDE it re-measures the LENGTH", async () => {
    // The two axes Task 7's review separated, re-asserted where being one unit off is a wrong PUBLISHED
    // range rather than an off-centre excerpt. `İstanbul` is 8 units and lowers to 9, so the composed and
    // decomposed rows are both hits for it while covering 8 and 9 original units.
    const DEC = "i\u0307stanbul";
    expect("İstanbul".toLowerCase()).toBe(DEC);
    const st = store([sess("cold-session", { createdAt: 1_000 }, [
      assistant(`x${DEC}y`, "u-dec"),          // length-stable row: a 9-unit span
      assistant("xİstanbuly", "u-com"),        // the fold is INSIDE the match: an 8-unit span
      assistant("İxİstanbuly", "u-both"),      // …plus one BEFORE it, so start and length both move
    ])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "İstanbul" });
    expect(r.result.data.map((o: any) => o.snippetMatchRange)).toEqual([{ start: 1, end: 10 }, { start: 1, end: 9 }, { start: 2, end: 10 }]);
    expect(r.result.data.map((o: any) => o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end))).toEqual([DEC, "İstanbul", "İstanbul"]);
  });

  it("astral text around the match: the window trims to whole characters and the range still selects the match", async () => {
    const row = `${"😀".repeat(100)}needle${"😀".repeat(100)}`;
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(row, "u-a")])]);
    boot(st.deps);
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    const o = r.result.data[0];
    expect(loneSurrogate(o.snippet)).toBe(false);
    expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end)).toBe("needle");
  });

  it("a generated sweep: every published range covers exactly the original characters that matched", async () => {
    // The oracle maps the span's ends FORWARD, through prefix LENGTHS under the engine's own toLowerCase —
    // it never re-lowercases the extracted slice. Task 7's reviewer's 24.8M-pair sweep produced 437
    // failures doing exactly that, every one of them the checker's own: `Final_Sigma` is context-sensitive,
    // so a slice's SPELLING is not the spelling of the same stretch in the whole row's lowered copy. Its
    // LENGTH is safe under context — the only length-changing fold, U+0130, is context-free — which is why
    // this reads lengths and nothing else, and why it delegates to toLowerCase rather than re-deriving the
    // implementation's own U+0130 count (a checker written off the code inherits its blind spots).
    const L = (text: string, i: number) => text.slice(0, i).toLowerCase().length;
    const alphabet = ["a", "B", "İ", "\u0307", "😀", "y", "K"];
    let seed = 0xc0ffee >>> 0;
    const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const trials: { id: string; text: string; term: string; expected: number[] }[] = [];
    for (let n = 0; n < 200; n++) {
      let text = "";
      for (let i = 0, len = 3 + Math.floor(rnd() * 8); i < len; i++) text += alphabet[Math.floor(rnd() * alphabet.length)];
      const lowered = text.toLowerCase();
      if (lowered.length < 4) continue;
      const from = Math.floor(rnd() * (lowered.length - 2));
      const term = lowered.slice(from, from + 2 + Math.floor(rnd() * Math.min(3, lowered.length - from - 2)));
      if (term.length < SEARCH_CAPS.minTerm || term.toLowerCase() !== term) continue;
      const expected: number[] = [];
      for (let at = lowered.indexOf(term); at >= 0; at = lowered.indexOf(term, at + 1)) expected.push(at);
      if (!expected.length || expected.length > SEARCH_CAPS.maxLimit) continue;
      trials.push({ id: `sweep-${trials.length}`, text, term, expected });
    }
    expect(trials.length).toBeGreaterThan(60);
    const st = store(trials.map((t) => sess(t.id, { createdAt: 1_000 }, [assistant(t.text, `u-${t.id}`)])));
    boot(st.deps);
    let cases = 0;
    for (const t of trials) {
      const r = await occ({ threadId: t.id, searchTerm: t.term, limit: SEARCH_CAPS.maxLimit });
      const where = `${t.id} ${JSON.stringify(t.text)} / ${JSON.stringify(t.term)}`;
      expect(r.error, where).toBeUndefined();
      expect(r.result.data.length, where).toBe(t.expected.length);
      for (let k = 0; k < t.expected.length; k++) {
        const { snippet, snippetMatchRange: { start, end } } = r.result.data[k];
        // Short rows, so the snippet IS the row and the range is row-absolute — asserted, not assumed.
        expect(snippet, where).toBe(t.text);
        const atLc = t.expected[k], endLc = atLc + t.term.length;
        expect(end, where).toBeGreaterThan(start);
        expect(L(t.text, start), `coverage start ${where}`).toBeLessThanOrEqual(atLc);
        expect(L(t.text, end), `coverage end ${where}`).toBeGreaterThanOrEqual(endLc);
        expect(L(t.text, start + 1), `tight start ${where}`).toBeGreaterThan(atLc);
        expect(L(t.text, end - 1), `tight end ${where}`).toBeLessThan(endLc);
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  // ── refusals, exclusion, honesty ─────────────────────────────────────────────────────────────────────

  it("a garbage, foreign-codec, out-of-range or WRONG-SESSION cursor refuses -32602 instead of resuming somewhere nothing computed", async () => {
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("a needle row", "u-a")]), sess("other-session", { createdAt: 2_000 }, [assistant("needle", "u-b")])]);
    boot(st.deps);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
    for (const cursor of [
      "not-a-cursor",
      b64({ s: "cold-session", r: 0 }),                            // no char offset
      b64({ s: "cold-session", r: 0, c: -1, e: null }),            // negative — refused, never clamped
      b64({ s: "cold-session", r: 0, c: 1.5, e: null }),           // fractional char offset
      b64({ s: "cold-session", r: 1.5, c: 0, e: null }),           // fractional row offset
      b64({ s: "cold-session", r: 0, c: 1e30, e: null }),          // past MAX_SAFE_INTEGER
      b64({ s: "cold-session", r: 0, c: 0, e: "0" }),              // epoch is a number or null, never a string
      b64({ v: 1_000, s: "cold-session", r: 0 }),                  // the store-wide SEARCH codec's shape
      b64({ s: "other-session", r: 0, c: 0, e: null }),            // well-formed, but for another transcript
    ]) {
      const r = await occ({ threadId: "cold-session", searchTerm: "needle", cursor });
      expect(r.error?.code, `cursor ${cursor}`).toBe(-32602);
      expect(r.error?.message, `cursor ${cursor}`).toBe("Invalid cursor");
    }
    // …and a well-formed one for THIS session still resumes, so the refusals are not "cursors are broken".
    const p1 = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 1 });
    expect((await occ({ threadId: "cold-session", searchTerm: "needle", cursor: p1.result.nextCursor })).error).toBeUndefined();
    // The same cursor addressed by the OTHER spelling of one thread is interchangeable: `s` is compared
    // against the RESOLVED store id, not against the string the client typed.
    const liveOne = await bootLive([sess("live-session", { createdAt: 1_000 }, [assistant("needle needle", "u-a")])], "live-session");
    const byRegistryId = await occ({ threadId: liveOne.threadId, searchTerm: "needle", limit: 1 });
    expect((await occ({ threadId: "live-session", searchTerm: "needle", cursor: byRegistryId.result.nextCursor })).error).toBeUndefined();
  });

  it("term bounds refuse at both ends and both legal boundaries are admitted", async () => {
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant("ab", "u-a")])]);
    boot(st.deps);
    expect((await occ({ threadId: "cold-session", searchTerm: "a" })).error?.code).toBe(-32602);
    expect((await occ({ threadId: "cold-session", searchTerm: "" })).error?.code).toBe(-32602);
    expect((await occ({ threadId: "cold-session", searchTerm: "x".repeat(SEARCH_CAPS.maxTerm + 1) })).error?.code).toBe(-32602);
    expect((await occ({ threadId: "cold-session", searchTerm: "ab" })).error).toBeUndefined();
    expect((await occ({ threadId: "cold-session", searchTerm: "x".repeat(SEARCH_CAPS.maxTerm) })).error).toBeUndefined();
    expect((await occ({ threadId: "", searchTerm: "ab" })).error?.code).toBe(-32602); // params gate: threadId min(1)
    // `limit` is `positive()`, so 0 refuses at the params gate rather than reaching a loop where
    // `data.length >= 0` would be true before the first occurrence was ever examined.
    expect((await occ({ threadId: "cold-session", searchTerm: "ab", limit: 0 })).error?.code).toBe(-32602);
    expect((await occ({ threadId: "cold-session", searchTerm: "ab", limit: -1 })).error?.code).toBe(-32602);
  });

  it("a transcript read that fails is an ERROR, never an empty page", async () => {
    boot({
      getSessionInfo: async () => ({ sessionId: "cold-session", summary: "s", lastModified: 1 }),
      getSessionMessages: async () => { throw new Error("unreadable transcript"); },
    });
    const r = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(r.error?.code).toBe(-32603);
    expect(r.error?.message).toBe("unreadable transcript");
    expect(r.result).toBeUndefined();
  });

  it("a thread whose ENGINE is gone still answers — the subject is disk, not the engine", async () => {
    // ENGINE_GONE_EXEMPT (spec §9): without it the same session is reachable by bare store id and refused
    // by its own registry id, which is the inconsistency the exemption exists to prevent.
    const { threadId } = await bootLive([sess("live-session", { createdAt: 1_000 }, [assistant("a needle row", "u-a")])], "live-session", { isEnded: () => true });
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.error).toBeUndefined();
    expect(r.result.data.map((o: any) => o.rowOffset)).toEqual([0]);
    // The exemption is scoped: a NON-exempt method on the same record still hears -33005.
    expect(frameOf(await send("turn/start", { threadId, input: "go" })).error?.code).toBe(-33005);
  });

  it("a registry thread that has not latched a store sessionId refuses ENGINE_GONE rather than searching nothing", async () => {
    const st = store([sess("some-session", { createdAt: 1_000 }, [assistant("needle", "u-a")])]);
    const srv = boot({ ...st.deps, sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {} }) as any });
    await send("thread/start", {});
    const threadId = parse(lines).find((l) => l.result?.thread)!.result.thread.id;
    expect(srv.registry.get(threadId)!.sessionId).toBeUndefined();
    const r = await occ({ threadId, searchTerm: "needle" });
    expect(r.error?.code).toBe(-33005);
    expect(r.error?.message).toBe("Session id not yet available for this thread");
  });

  it("two overlapping occurrence searches do not interleave — one content scan at a time per server", async () => {
    // The chain is shared with `thread/search` (runScanExclusive is per-SERVER, not per-method), and the
    // existence read sits INSIDE it: it is a store read like any other, and the resource being rationed is
    // this process's disk read rate. Interleaved logs are what a scan outside the chain looks like.
    const log: string[] = [];
    boot({
      getSessionInfo: async (id) => { log.push(`info:${id}`); await new Promise((r) => setTimeout(r, 10)); return { sessionId: id, summary: "s", lastModified: 1 }; },
      getSessionMessages: async (id) => { log.push(`read:${id}`); return [assistant("a needle row")]; },
    });
    const a = sendNoAwait("thread/searchOccurrences", { threadId: "s-a", searchTerm: "needle" });
    const b = sendNoAwait("thread/searchOccurrences", { threadId: "s-b", searchTerm: "needle" });
    for (let i = 0; i < 400 && !(frameOf(a) && frameOf(b)); i++) await new Promise((r) => setTimeout(r, 5));
    expect(frameOf(a).result.data.length).toBe(1);
    expect(frameOf(b).result.data.length).toBe(1);
    expect(log).toEqual(["info:s-a", "read:s-a", "info:s-b", "read:s-b"]);
  });

  it("the reply on the wire validates against the published result schema — every optional key, both arms of nextCursor", async () => {
    const huge = `needle${"z".repeat(SEARCH_CAPS.maxRowUnits - 5)}`;
    const st = store([sess("cold-session", { createdAt: 1_000 }, [assistant(huge, "u-big"), assistant("needle one", "u-1"), assistant("needle two", "u-2")])]);
    boot(st.deps);
    const results = (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results;
    const validate = new Ajv({ strict: true }).compile(results["thread/searchOccurrences"]);
    const paged = await occ({ threadId: "cold-session", searchTerm: "needle", limit: 1 });
    expect(paged.result.skipped).toBe(1);
    expect(paged.result.nextCursor).not.toBeNull();
    expect(validate(paged.result), JSON.stringify(validate.errors)).toBe(true);
    const whole = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect(whole.result.nextCursor).toBeNull();
    expect(validate(whole.result), JSON.stringify(validate.errors)).toBe(true);
    // …and a reply with `skipped` ABSENT and a null uuid, so the optional key is covered in both states and
    // `uuid: null` is proven to satisfy the published nullable rather than only a string being tried.
    const clean = store([sess("cold-session", { createdAt: 1_000 }, [assistant("needle three")])]);
    boot(clean.deps);
    const plain = await occ({ threadId: "cold-session", searchTerm: "needle" });
    expect("skipped" in plain.result).toBe(false);
    expect(plain.result.data[0].uuid).toBeNull();
    expect(validate(plain.result), JSON.stringify(validate.errors)).toBe(true);
  });
});

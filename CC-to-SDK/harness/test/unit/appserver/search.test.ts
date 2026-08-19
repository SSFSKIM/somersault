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
import { SEARCH_CAPS, decodeSearchCursor } from "../../../src/appserver/searchScan.js";

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
const warnings = () => parse(lines).filter((l) => l.method === "warning");
const mkTmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); temps.push(d); return d; };

// ── fake store ────────────────────────────────────────────────────────────────────────────────────────
interface Info { sessionId: string; summary: string; lastModified: number; createdAt?: number; customTitle?: string; firstPrompt?: string; tag?: string; cwd?: string }
interface Fake { info: Info; rows: unknown[] }
const prompt = (text: string, uuid = "u1") => ({ type: "user", uuid, message: { content: text } });
const assistant = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
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

interface Store { deps: AppServerDeps; calls: { id: string; offset?: number; limit?: number }[]; listCalls: { cwd?: string }[]; drop(id: string): void }
function store(fakes: Fake[], opts: { shuffle?: boolean } = {}): Store {
  const live = [...fakes];
  const calls: Store["calls"] = [];
  const listCalls: Store["listCalls"] = [];
  return {
    calls, listCalls,
    drop(id) { const i = live.findIndex((f) => f.info.sessionId === id); if (i >= 0) live.splice(i, 1); },
    deps: {
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

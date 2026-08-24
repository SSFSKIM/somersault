// test/unit/appserver/sessionLib.test.ts — Task 12: the session library (store-merged thread/list,
// fork, rename, tag, delete). Copies Task 6's mkSink/send/parsed/init helpers (server.test.ts) so this
// file reads standalone.
//
// Engine-faithful fakes (spec Testing, verbatim): `sessionId` is undefined until the first init frame —
// several cases below deliberately construct a live record in exactly that state (a thread/start whose
// fake session never latches an id) because the merge's dedup key IS sessionId, and a thread that cannot
// offer one cannot be matched against a store row by definition. That is tested explicitly, not left
// implicit in the happy-path cases.
import { describe, it, expect, afterAll } from "vitest";
import { AppServer, threadView, type AppServerDeps } from "../../../src/appserver/server.js";
import { storeOnlyView } from "../../../src/appserver/sessionLib.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRoster } from "../../../src/fleet/roster.js";
import { waitReply } from "../../helpers/waitReply.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, opts: { name?: string; watchThreads?: boolean } = {}) =>
  send(c, { id, method: "initialize", params: { clientInfo: { name: opts.name ?? "t" }, ...(opts.watchThreads ? { watchThreads: true } : {}) } });
const fakeSession = (overrides: Record<string, unknown> = {}) => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", ...overrides });

/** One throwaway archive-marker root for this whole file. `thread/list` reads that directory on every
 *  request and resolves it as `deps.ccxDir ?? fleetRoot()` (appserver/archive.ts), so a boot that omits
 *  the dep is protected only by the process-global `CCX_FLEET_ROOT` backstop — which any vitest
 *  invocation that misses this project's config (a `--root` above the harness, an explicit `--config`)
 *  drops silently, pointing the read at the operator's real `~/.claude/ccx/archived`. A stale marker
 *  there named for a fixture sessionId then filters the live thread out of its own reply. The M6 rows
 *  below still pass their own per-test root. */
const fileCcxDir = mkdtempSync(join(tmpdir(), "m7ccx-sessionLib-"));
afterAll(() => { rmSync(fileCcxDir, { recursive: true, force: true }); });

/** Every case here calls thread/list at least indirectly; the store side MUST be DI'd (never left to the
 *  real src/sessions/index.js default) — this repo's own real `~/.claude/projects` has thousands of real
 *  sessions on it, so an un-DI'd listSessions call is both slow and non-deterministic in exactly this
 *  environment. `deps.listSessions` defaults to an empty store here; individual tests override it, and
 *  `deps.ccxDir` defaults to this file's own marker root for the same reason (see above). */
function boot(deps: Partial<AppServerDeps> = {}) {
  const fullDeps: AppServerDeps = { ccxDir: fileCcxDir, sessionFactory: () => fakeSession(), listSessions: async () => [], ...deps };
  const srv = new AppServer({}, fullDeps);
  const s = mkSink();
  const c = srv.connect(s.sink);
  return { srv, lines: s.lines, c };
}

async function startThread(c: { feed(ch: string): void }, lines: string[], id: number, params: Record<string, unknown> = {}) {
  send(c, { id, method: "thread/start", params });
  await tick();
  return parsed(lines).find((f) => f.id === id).result.thread as { id: string; sessionId?: string };
}

describe("thread/list — store-merged (Task 12, gap 4)", () => {
  it("dedups on sessionId with live-wins: a store row sharing a live thread's sessionId yields ONE row, keeping the thr_ id, with the store's title filled in", async () => {
    const { srv, lines, c } = boot({
      listSessions: async () => [{ sessionId: "sess-1", summary: "Store title", lastModified: 1, cwd: "/tmp", createdAt: 1 }],
    });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    expect(thread.sessionId).toBe("sess-1");

    lines.length = 0;
    // `waitReply` rather than a bare `tick` at every thread/list below: since M5 Task 10 the handler reads
    // the archive marker directory before replying, so its reply lands a filesystem round-trip after the
    // request rather than within one macrotask (see the helper).
    send(c, { id: 3, method: "thread/list", params: {} });
    const { data } = (await waitReply(lines, 3)).result;
    const rows = data.filter((r: any) => r.sessionId === "sess-1");
    expect(rows).toHaveLength(1); // deduped, not two rows for the one session
    expect(rows[0].id).toBe(thread.id); // live wins — keeps the thr_ id, not the bare sessionId
    expect(rows[0].title).toBe("Store title"); // filled in from the store match
    void srv;
  });

  it("store-only rows project the EXACT field set a live threadView does — key-set equality, so the two cannot drift apart at any field count", async () => {
    // The claim sessionLib.ts makes ("a client must not be able to tell a live row from a stored one by
    // its shape alone") pinned as an equality rather than as a hand-listed field count: a field added to
    // one projection and forgotten on the other fails HERE, whether the shape is at 13 fields or 15.
    // Compared as OBJECTS, not as wire rows — JSON drops undefined-valued keys and the two views leave
    // different fields undefined (a live row never has `preview`, a store row never has `origin`), so a
    // wire-level comparison could only ever pin their intersection.
    const { srv, lines, c } = boot();
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    const live = threadView(srv, srv.registry.get(thread.id)!);
    const stored = storeOnlyView({ sessionId: "store-a", summary: "A", lastModified: 1_700_000_010_000, createdAt: 1_700_000_009_000, firstPrompt: "hi a" } as SDKSessionInfo);

    expect(Object.keys(stored).sort()).toEqual(Object.keys(live).sort());
    // and the one field whose store-side VALUE is a claim rather than a copy: a session this server never
    // opened has no engine and no queue, so 0 is the fact, not a placeholder.
    expect(stored.queueDepth).toBe(0);
    expect(live.queueDepth).toBe(0);
  });

  it("store-only rows carry id=sessionId (no thr_ id), status idle and SECONDS timestamps; pages newest-first with the keyset cursor", async () => {
    const { lines, c } = boot({
      // lastModified/createdAt are MILLISECONDS-since-epoch on SDKSessionInfo (per sdk.d.ts) — realistic
      // ms-scale values here (not small round numbers) so a /1000 unit bug would actually show up as a
      // wrong updatedAt rather than passing by coincidence.
      listSessions: async () => [
        { sessionId: "store-a", summary: "A", lastModified: 1_700_000_010_000, firstPrompt: "hi a", createdAt: 1_700_000_009_000 },
        { sessionId: "store-b", summary: "B", lastModified: 1_700_000_020_000, firstPrompt: "hi b", createdAt: 1_700_000_019_000 },
      ],
    });
    init(c, 1);
    await tick();

    send(c, { id: 2, method: "thread/list", params: { limit: 1 } });
    const page1 = (await waitReply(lines, 2)).result;
    expect(page1.data).toHaveLength(1);
    // updatedAt/createdAt are unix SECONDS on the wire (registry.ts's ThreadRecord convention, which
    // threadView passes straight through for live rows) — a store-only row must match that unit, not
    // SDKSessionInfo's own milliseconds.
    // store-b leads: M6 orders the merge by `updatedAt` DESCENDING, and it is the newer of the two.
    expect(page1.data[0]).toMatchObject({ id: "store-b", sessionId: "store-b", title: "B", status: { state: "idle" }, preview: "hi b", updatedAt: 1_700_000_020, createdAt: 1_700_000_019 });
    expect(page1.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    send(c, { id: 3, method: "thread/list", params: { limit: 1, cursor: page1.nextCursor } });
    const page2 = (await waitReply(lines, 3)).result;
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]).toMatchObject({ id: "store-a", sessionId: "store-a", title: "A", updatedAt: 1_700_000_010, createdAt: 1_700_000_009 });
    expect(page2.nextCursor).toBeNull();
  });

  it("a live thread whose sessionId has not yet latched (engine-faithful: undefined until the first init frame) cannot be matched by the merge — it lists as its own unmatched row, alongside the store's rows, not merged into any of them", async () => {
    const { lines, c } = boot({
      sessionFactory: () => fakeSession({ sessionId: undefined }),
      listSessions: async () => [{ sessionId: "store-only", summary: "Unrelated stored session", lastModified: 5, createdAt: 4 }],
    });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    expect(thread.sessionId).toBeUndefined(); // confirms the fixture is in the state the guard test needs

    lines.length = 0;
    send(c, { id: 3, method: "thread/list", params: {} });
    const { data } = (await waitReply(lines, 3)).result;
    expect(data).toHaveLength(2); // the unlatched live thread AND the unrelated store row — no false merge
    const liveRow = data.find((r: any) => r.id === thread.id);
    expect(liveRow.sessionId).toBeUndefined();
    expect(liveRow.title).toBeUndefined(); // no store match was possible, so nothing to fill in
    const storeRow = data.find((r: any) => r.id === "store-only");
    expect(storeRow).toBeTruthy();
  });

  it("a live record's own title (already patched by a prior thread/name/set) wins over a store match, not the other way around", async () => {
    const { lines, c } = boot({
      listSessions: async () => [{ sessionId: "sess-1", summary: "Stale store title", lastModified: 1, createdAt: 1 }],
      renameSession: async () => {},
    });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    send(c, { id: 3, method: "thread/name/set", params: { threadId: thread.id, title: "Patched live title" } });
    await tick();

    lines.length = 0;
    send(c, { id: 4, method: "thread/list", params: {} });
    const row = (await waitReply(lines, 4)).result.data.find((r: any) => r.id === thread.id);
    expect(row.title).toBe("Patched live title");
  });
});

describe("thread/fork (Task 12)", () => {
  it("resolves the source id, calls deps.forkSession, and yields a NEW live thread whose sessionId is the forked id (proving `resume` threaded through startThread, not merely a stored copy)", async () => {
    const forkCalls: unknown[] = [];
    let sessionFactoryCalls = 0;
    const { srv, lines, c } = boot({
      forkSession: async (id, opts) => { forkCalls.push({ id, opts }); return { sessionId: "forked-123" }; },
      // First call seeds the SOURCE thread (must latch "sess-1" so resolveThreadId can resolve it).
      // Second call seeds the forked thread's engine session — engine-faithful: sessionId unlatched
      // until a turn runs, so the record can ONLY get "forked-123" via the resume fallback, never via
      // session.sessionId.
      sessionFactory: () => (sessionFactoryCalls++ === 0 ? fakeSession() : fakeSession({ sessionId: undefined })),
    });
    init(c, 1);
    const source = await startThread(c, lines, 2);

    send(c, { id: 3, method: "thread/fork", params: { threadId: source.id, upToMessageId: "m1", title: "Fork title" } });
    await tick();
    expect(forkCalls).toEqual([{ id: "sess-1", opts: { upToMessageId: "m1", title: "Fork title" } }]);

    const reply = parsed(lines).find((f) => f.id === 3).result;
    expect(reply.thread.id).toMatch(/^thr_[0-9a-f]{12}$/);
    expect(reply.thread.id).not.toBe(source.id); // a NEW thread, not the source mutated in place
    expect(reply.thread.sessionId).toBe("forked-123");

    // the new thread is genuinely live and usable — present in the registry/list, not a stray reply
    expect(srv.registry.get(reply.thread.id)).toBeTruthy();
  });

  it("a bare store sessionId (never registered in this server) resolves and forks a cold session too", async () => {
    const forkCalls: unknown[] = [];
    const { lines, c } = boot({
      forkSession: async (id, opts) => { forkCalls.push({ id, opts }); return { sessionId: "forked-cold" }; },
      sessionFactory: () => fakeSession({ sessionId: undefined }),
    });
    init(c, 1);
    send(c, { id: 2, method: "thread/fork", params: { threadId: "cold-session-id" } });
    await tick();
    expect(forkCalls).toEqual([{ id: "cold-session-id", opts: { upToMessageId: undefined, title: undefined } }]);
    expect(parsed(lines).find((f) => f.id === 2).result.thread.sessionId).toBe("forked-cold");
  });
});

describe("thread/delete (Task 12) — the live-guard (spec D-M2-7)", () => {
  it("refuses -33001 BUSY on a live session's id, addressed by its thr_ id, and never calls deps.deleteSession", async () => {
    const deleteCalls: string[] = [];
    const { lines, c } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });
    init(c, 1);
    const thread = await startThread(c, lines, 2);

    send(c, { id: 3, method: "thread/delete", params: { threadId: thread.id } });
    await tick();
    const err = parsed(lines).find((f) => f.id === 3).error;
    expect(err.code).toBe(-33001);
    expect(err.code).toBe(ERR.BUSY);
    expect(deleteCalls).toEqual([]);
  });

  it("refuses -33001 BUSY on a live session's id, addressed by its BARE sessionId (not the thr_ id) too — the guard matches on the resolved sessionId, not on how the caller spelled it", async () => {
    const deleteCalls: string[] = [];
    const { lines, c } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    expect(thread.sessionId).toBe("sess-1");

    send(c, { id: 3, method: "thread/delete", params: { threadId: "sess-1" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(-33001);
    expect(deleteCalls).toEqual([]);
  });

  it("a cold session (never live in this server) deletes: deps.deleteSession is called, the reply is {ok:true}, and thread/deleted reaches a watcher connection", async () => {
    const deleteCalls: string[] = [];
    const { srv, lines, c } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });
    const watcher = mkSink(); const wc = srv.connect(watcher.sink);
    init(wc, 1, { watchThreads: true });
    await tick();

    init(c, 1);
    send(c, { id: 2, method: "thread/delete", params: { threadId: "cold-sess-1" } });
    await tick();
    expect(deleteCalls).toEqual(["cold-sess-1"]);
    expect(parsed(lines).find((f) => f.id === 2).result).toEqual({ ok: true });
    const notif = parsed(watcher.lines).find((f) => f.method === "thread/deleted");
    expect(notif.params).toEqual({ sessionId: "cold-sess-1" });
  });

  it("a thr_ id whose record has not yet latched a sessionId refuses ENGINE_GONE (-33005), not BUSY and not a silent pass-through", async () => {
    const { lines, c } = boot({ sessionFactory: () => fakeSession({ sessionId: undefined }) });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    expect(thread.sessionId).toBeUndefined();

    send(c, { id: 3, method: "thread/delete", params: { threadId: thread.id } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(-33005);
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(ERR.ENGINE_GONE);
  });

  it("an unknown thr_ id is THREAD_NOT_FOUND (-33004), same as every other threadId-taking method", async () => {
    const { lines, c } = boot();
    init(c, 1);
    send(c, { id: 2, method: "thread/delete", params: { threadId: "thr_doesnotexist" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(-33004);
  });
});

describe("thread/delete — the ROSTER arm (D-M5-21c, Task 9 re-review)", () => {
  it("refuses a session a running ccx process still holds, names THAT process rather than this server, and leaves the transcript alone", async () => {
    // The gap this closes was a three-way disagreement about one session: `thread/resume` refused an id a
    // live fleet host held, `thread/archive` refused it (D-M5-21a) — and `thread/delete`, the one op whose
    // mistake nobody can undo later, erased the transcript that process was still appending to. Same probe
    // as the other two (server.ts's `liveInFleet`), same BUSY code, and the cross-process sentence,
    // because "close it first" is advice no request to THIS server can carry out.
    const root = mkdtempSync(join(tmpdir(), "m5del-"));
    const prev = process.env.CCX_FLEET_ROOT;
    process.env.CCX_FLEET_ROOT = root;
    try {
      // No `procStart` is the roster's own "assume live" (fleet/liveness.ts) — the reading thread/resume
      // and thread/archive both take, so all three now answer from one rule.
      const row = { short: "cd34ef56", pid: process.pid, cwd: "/w", kind: "bg" as const, name: "other", state: "working" as const, startedAt: Date.now(), sessionId: "fleet-held" };
      writeRoster(row);
      const deleteCalls: string[] = [];
      const { lines, c } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });
      init(c, 1);
      send(c, { id: 2, method: "thread/delete", params: { threadId: "fleet-held" } });
      await tick();
      const err = parsed(lines).find((f) => f.id === 2).error;
      expect([err.code, err.message]).toEqual([ERR.BUSY, "Thread is live in another ccx process; close it there first"]);
      expect(deleteCalls).toEqual([]); // the store was never reached — the whole point is that the bytes survive

      // LIVENESS, not mere presence: a terminal row is a finished session, and deleting one is exactly what
      // a client reaches for. Without this half the arm could refuse every id the roster has ever seen.
      writeRoster({ ...row, state: "done" as const, endedAt: Date.now() });
      send(c, { id: 3, method: "thread/delete", params: { threadId: "fleet-held" } });
      await tick();
      expect(parsed(lines).find((f) => f.id === 3).result).toEqual({ ok: true });
      expect(deleteCalls).toEqual(["fleet-held"]);

      // …and the two sentences do not collapse into one: an in-process live thread, under the SAME roster,
      // still gets the original. A "fix" that handed every arm the cross-process sentence would be as green
      // as the right one without this.
      const thread = await startThread(c, lines, 4);
      send(c, { id: 5, method: "thread/delete", params: { threadId: thread.id } });
      await tick();
      const here = parsed(lines).find((f) => f.id === 5).error;
      expect([here.code, here.message]).toEqual([ERR.BUSY, "Thread is live in this server — close it first"]);
    } finally {
      if (prev === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ══ M6: the keyset walk ════════════════════════════════════════════════════════════════════════════════
//
// Everything below drives the REAL wire — `thread/list` interleaved with `thread/archive`/
// `thread/unarchive` — because the claim is about what happens BETWEEN two requests, and the mutator it is
// about is a method a client of this same server calls. A test that reached into the marker directory
// itself would prove the same arithmetic while skipping the part that makes it a defect: that moving a
// session across the partition is a first-party operation, not an act of some other process.

const m6temps: string[] = [];
const m6tmp = (): string => { const d = mkdtempSync(join(tmpdir(), "m6list-")); m6temps.push(d); return d; };
afterAll(() => { for (const d of m6temps.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Store rows NEWEST-FIRST in argument order, so every expectation below reads in list order. The spacing
 *  is a million ms because the wire unit is SECONDS (`storeOnlyView` divides): rows a millisecond apart
 *  would land on one `updatedAt` and be ordered by the id tie-break instead, testing the wrong half. */
const storeRows = (...ids: string[]) => ids.map((sessionId, i) => ({ sessionId, summary: `s-${sessionId}`, lastModified: (ids.length - i) * 1_000_000 }));
/** `thread/archive`'s existence oracle (D-M5-20) is a DIFFERENT store from `listSessions` and has to be
 *  injected on its own — a session the listing knows and this does not is refused THREAD_NOT_FOUND, and
 *  the walk under test never gets its mutation. */
const knowsAll = async (sessionId: string) => ({ sessionId, summary: `s-${sessionId}`, lastModified: 1 });

/** One request/reply channel over a booted server, so a walk reads as the sequence of calls it is. The
 *  request-id counter is MODULE-scoped rather than per-channel: `waitReply` matches on id alone, so two
 *  channels over one sink that both started at 500 would each read the other's oldest reply and assert
 *  confidently against the wrong frame (measured — it cost this file a green run). */
let m6reqId = 500;
function wire(b: { lines: string[]; c: { feed(ch: string): void } }) {
  return async (method: string, params: unknown): Promise<Record<string, any>> => {
    const rid = m6reqId++;
    send(b.c, { id: rid, method, params });
    return await waitReply(b.lines, rid);
  };
}

/** Walks to exhaustion, returning every id delivered IN ORDER plus the per-page `nextCursor`s, and running
 *  `between` after each page — which is where the mutation goes. Bounded: a walk that stopped making
 *  progress would otherwise hang the suite instead of failing it. */
async function walk(call: ReturnType<typeof wire>, params: Record<string, unknown>, between?: (page: number) => Promise<void>): Promise<{ ids: string[]; cursors: (string | null)[] }> {
  const ids: string[] = [];
  const cursors: (string | null)[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const reply = await call("thread/list", cursor === null ? params : { ...params, cursor });
    expect(reply.error, `page ${page} refused`).toBeUndefined();
    for (const row of reply.result.data as { id: string }[]) ids.push(row.id);
    cursors.push(reply.result.nextCursor);
    if (between) await between(page);
    if (reply.result.nextCursor === null) return { ids, cursors };
    cursor = reply.result.nextCursor;
  }
  throw new Error("walk did not terminate within 20 pages");
}

describe("thread/list — the keyset walk (M6)", () => {
  it("a stable walk returns every row exactly once, newest first, and `nextCursor` is null EXACTLY on the last page", async () => {
    const b = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("n1", "n2", "n3", "n4", "n5") });
    init(b.c, 1);
    const { ids, cursors } = await walk(wire(b), { limit: 2 });
    expect(ids).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    expect(cursors.map((x) => (x === null ? null : "cursor"))).toEqual(["cursor", "cursor", null]);

    // …and the exact-multiple case, which is where "null on the last page" is usually got wrong: a walk
    // whose last page is FULL must still end there, not mint a cursor for an empty page after it.
    const even = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("e1", "e2", "e3", "e4") });
    init(even.c, 1);
    const walked = await walk(wire(even), { limit: 2 });
    expect(walked.ids).toEqual(["e1", "e2", "e3", "e4"]);
    expect(walked.cursors.map((x) => (x === null ? null : "cursor"))).toEqual(["cursor", null]);
  });

  it("ARCHIVING a row that has already been returned, mid-walk, skips nothing and repeats nothing", async () => {
    // THE ROW THIS WHOLE CHANGE EXISTS FOR. Under the offset cursor the first page consumed 2, `a1` then
    // left the partition, and `slice(2, 4)` of the now-5-long array began at `a4` — `a3` was skipped, in a
    // reply that reported nothing wrong. The mutation is a first-party `thread/archive` from the same
    // client that holds the cursor, not an exotic race.
    const b = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("a1", "a2", "a3", "a4", "a5", "a6"), getSessionInfo: knowsAll });
    init(b.c, 1);
    const call = wire(b);
    const { ids } = await walk(call, { limit: 2 }, async (page) => {
      if (page === 0) expect((await call("thread/archive", { threadId: "a1" })).result).toEqual({ ok: true });
    });
    expect(ids).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    // Stated separately from the list above: "every row exactly once" is two claims, and a walk that
    // skipped one row while repeating another satisfies neither on its own.
    expect(new Set(ids).size).toBe(ids.length);
    // …and the mutation really did land, or this row passes by testing an ordinary walk.
    expect((await call("thread/list", { archived: true })).result.data.map((r: any) => r.id)).toEqual(["a1"]);
  });

  it("UNARCHIVING a session INTO the partition being walked repeats nothing", async () => {
    // The other direction, and it fails the other way: the returning row joins AHEAD of the cursor (it is
    // the newest), so under an offset every later position shifted right by one and the next page began on
    // a row the client already held — `a3` delivered twice. A tuple is unmoved by an insertion before it.
    const b = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("a1", "a2", "a3", "a4", "a5", "a6"), getSessionInfo: knowsAll });
    init(b.c, 1);
    const call = wire(b);
    expect((await call("thread/archive", { threadId: "a1" })).result).toEqual({ ok: true });
    const { ids } = await walk(call, { limit: 2 }, async (page) => {
      if (page === 0) expect((await call("thread/unarchive", { threadId: "a1" })).result).toEqual({ ok: true });
    });
    // `a1` is absent, and that is the honest answer rather than a miss: it rejoined the partition behind a
    // cursor that had already passed its place. What the walk owes the client is that the rows it WAS
    // walking each arrive once — the claim an offset breaks.
    expect(ids).toEqual(["a2", "a3", "a4", "a5", "a6"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await call("thread/list", { archived: true })).result.data).toEqual([]);
  });

  it("an undecodable cursor is REFUSED -32602 — including the decimal offset an older server minted", async () => {
    // Silently restarting at the top would answer a duplicate first page under a reply that looks like
    // success — the same skip/repeat failure the keyset removes, arriving through the error path. The
    // legacy decimal is the case this change costs and therefore the case that must be pinned: `"2"` is
    // admitted by the base64url pattern, so the refusal it gets is the DECODER's, not the schema's.
    const b = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("c1", "c2", "c3") });
    init(b.c, 1);
    const call = wire(b);
    // Written as raw JSON TEXT, not through `JSON.stringify`: the non-finite case cannot be expressed the
    // other way round — `JSON.stringify(Infinity)` is `"null"` — which is the whole reason a decoded
    // `Infinity` is definitionally forged, and the reason the payload has to be composed by hand here.
    const b64 = (json: string) => Buffer.from(json, "utf8").toString("base64url");
    const bad: [string, string][] = [
      ["2", "the decimal offset a pre-M6 server minted for this same method"],
      ["0", "…including the one whose silent restart would have looked harmless"],
      ["!!not-base64url!!", "refused one door earlier, by the pattern"],
      [b64("nope"), "base64url that is not JSON"],
      [b64('{"v":1,"s":"c1","r":0,"q":"","g":""}'), "a thread/search cursor — same v and s, but it addresses ROWS"],
      [b64('{"v":"1","s":"c1"}'), "a stringly-typed sort value no mint emits"],
      [b64('{"v":1e999,"s":"c1"}'), "a non-finite sort value, which JSON.parse produces and no mint can"],
      [b64('{"v":1,"s":7}'), "a non-string id"],
    ];
    for (const [cursor, why] of bad) {
      const r = await call("thread/list", { cursor });
      expect([why, r.error?.code, r.result]).toEqual([why, ERR.INVALID_PARAMS, undefined]);
    }
    // …and a cursor this server DID mint still works, so none of the above is a blanket refusal.
    const page1 = (await call("thread/list", { limit: 1 })).result;
    expect((await call("thread/list", { limit: 1, cursor: page1.nextCursor })).result.data.map((r: any) => r.id)).toEqual(["c2"]);
  });

  it("a cursor minted in one WALK is refused in another — the show-archived-toggle door", async () => {
    // `archived` selects a PARTITION, so a cursor carried across the toggle still DECODES and still finds a
    // place in the other partition's ordering: the next page would begin after everything sorting before
    // that tuple, in a reply reporting nothing wrong. That is this method's original defect arriving by a
    // different door, and a client with a show-archived checkbox reaches it just by keeping its cursor.
    // `cwd` binds on the same argument. `thread/search`'s two cursors have carried this fingerprint since
    // M5 (D-M5-26); `thread/list` shipping without it would have left the sibling methods disagreeing about
    // whether a cursor names a position or a walk.
    const b = boot({ ccxDir: m6tmp(), listSessions: async () => storeRows("a1", "a2", "a3"), getSessionInfo: knowsAll });
    init(b.c, 1);
    const call = wire(b);
    expect((await call("thread/archive", { threadId: "a3" })).result).toEqual({ ok: true });

    const page1 = (await call("thread/list", { limit: 1 })).result;
    expect(page1.data.map((r: any) => r.id)).toEqual(["a1"]);

    for (const [params, why] of [
      [{ archived: true }, "the other partition"],
      [{ cwd: "/somewhere/else" }, "a different cwd selects a different set of rows"],
    ] as [Record<string, unknown>, string][]) {
      const crossed = await call("thread/list", { limit: 1, ...params, cursor: page1.nextCursor });
      expect([why, crossed.error?.code, crossed.result]).toEqual([why, ERR.INVALID_PARAMS, undefined]);
    }
    // …and the SAME walk still resumes, so none of the above is a blanket refusal.
    expect((await call("thread/list", { limit: 1, cursor: page1.nextCursor })).result.data.map((r: any) => r.id)).toEqual(["a2"]);
  });

  it("rows with no usable `updatedAt` sort LAST and page deterministically", async () => {
    // `lastModified` reaches `storeOnlyView` from a bring-your-own store and is divided, so a NaN or an
    // absent value arrives at the comparator as NaN — which `.sort()` reads as "no opinion", answering by
    // leaving unrelated rows unordered, and which a cursor then serializes as `null` (JSON has no NaN),
    // claiming a position the unscreened comparator does not put the row at. Screened, both spellings are
    // one thing: sorts last, tie-broken by id ascending, and walks like any other row.
    const b = boot({
      ccxDir: m6tmp(),
      listSessions: async () => [
        { sessionId: "z-nan", summary: "nan", lastModified: NaN },
        { sessionId: "m-old", summary: "old", lastModified: 1_000_000 },
        { sessionId: "a-missing", summary: "missing" }, // no lastModified at all
        { sessionId: "m-new", summary: "new", lastModified: 3_000_000 },
      ],
    });
    init(b.c, 1);
    const call = wire(b);
    const { ids, cursors } = await walk(call, { limit: 1 });
    expect(ids).toEqual(["m-new", "m-old", "a-missing", "z-nan"]);
    expect(cursors[cursors.length - 1]).toBeNull();
    // The two unusable rows are indistinguishable ON THE WIRE — JSON has no NaN — which is exactly why the
    // screen has to happen before the comparator rather than at serialization.
    const all = (await call("thread/list", {})).result.data as { id: string; updatedAt: number | null }[];
    expect(all.filter((r) => r.updatedAt === null).map((r) => r.id)).toEqual(["a-missing", "z-nan"]);
  });

  it("the order is TOTAL over the merge, not live-rows-then-store-rows", async () => {
    // The grouping `[...liveViews, ...storeOnlyViews]` is dropped rather than kept as an outer sort key,
    // and this is the row that says so: a store row NEWER than the live thread sorts ahead of it. Keeping
    // the grouping would reintroduce the same bug class one level up — a store row that goes live mid-walk
    // changes group, and so moves across every row of the other group at once.
    const b = boot({
      ccxDir: m6tmp(),
      listSessions: async () => [
        { sessionId: "store-older", summary: "older", lastModified: 1_000_000 },
        { sessionId: "store-newer", summary: "newer", lastModified: Date.now() + 10_000_000 },
      ],
    });
    init(b.c, 1);
    const thread = await startThread(b.c, b.lines, 2);
    const { ids } = await walk(wire(b), { limit: 1 });
    expect(ids).toEqual(["store-newer", thread.id, "store-older"]);
  });
});

describe("thread/delete ↔ thread/resume — the deletion reservation (merge review, finding 1)", () => {
  it("stamps the RESUME TARGET as the record's sessionId at admission, before any frame — not whatever the engine object reports", async () => {
    // The registry legitimately knows the store id here (the client just named it) and the live-guard
    // below depends on it being visible immediately; the engine's own getter is undefined until its first
    // init frame, so a record that waited for the engine would be un-guardable for its whole first turn.
    const { srv, lines, c } = boot({ sessionFactory: () => fakeSession({ sessionId: "stale-engine-id" }) });
    init(c, 1);
    send(c, { id: 2, method: "thread/resume", params: { sessionId: "target-sess" } });
    await tick();
    const thread = parsed(lines).find((f) => f.id === 2).result.thread;
    expect(thread.sessionId).toBe("target-sess");
    expect(srv.registry.get(thread.id)!.sessionId).toBe("target-sess");
  });

  it("a thread/resume admitted in the SAME tick as a thread/delete for that session makes the delete refuse BUSY — the store row is never touched under a live engine", async () => {
    const deleteCalls: string[] = [];
    const { lines, c } = boot({
      deleteSession: async (id) => { deleteCalls.push(id); },
      sessionFactory: () => fakeSession({ sessionId: undefined }), // engine-faithful: no id until the first init frame
    });
    init(c, 1);
    // Both frames arrive in one transport chunk — dispatched back-to-back with no microtask between them,
    // which is exactly the window the eager stamp closes.
    c.feed(JSON.stringify({ id: 2, method: "thread/resume", params: { sessionId: "sess-x" } }) + "\n" +
           JSON.stringify({ id: 3, method: "thread/delete", params: { threadId: "sess-x" } }) + "\n");
    await tick();
    expect(parsed(lines).find((f) => f.id === 2).result.thread.sessionId).toBe("sess-x"); // the resume won
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(ERR.BUSY);
    expect(deleteCalls).toEqual([]);
  });

  it("a thread/resume landing WHILE a delete is in flight is refused -33001 'Session is being deleted', and admits no thread — the reverse order of the same race", async () => {
    let releaseDelete!: () => void;
    const { srv, lines, c } = boot({
      deleteSession: async () => { await new Promise<void>((r) => { releaseDelete = r; }); },
      sessionFactory: () => fakeSession({ sessionId: undefined }),
    });
    init(c, 1);
    send(c, { id: 2, method: "thread/delete", params: { threadId: "sess-y" } });
    await tick(); // the delete is now parked inside deps.deleteSession

    send(c, { id: 3, method: "thread/resume", params: { sessionId: "sess-y" } });
    await tick();
    const err = parsed(lines).find((f) => f.id === 3).error;
    expect(err.code).toBe(ERR.BUSY);
    expect(err.message).toMatch(/being deleted/);
    expect(srv.registry.list()).toHaveLength(0); // nothing admitted onto the session being erased

    releaseDelete();
    await tick();
    expect(parsed(lines).find((f) => f.id === 2).result).toEqual({ ok: true });

    // the reservation is released once the delete settles — the same session id is resumable again
    send(c, { id: 4, method: "thread/resume", params: { sessionId: "sess-y" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 4).result.thread.sessionId).toBe("sess-y");
  });

  it("a FAILING delete releases the reservation too — a store error must not wedge the session unresumable", async () => {
    const { lines, c } = boot({
      deleteSession: async () => { throw new Error("store boom"); },
      sessionFactory: () => fakeSession({ sessionId: undefined }),
    });
    init(c, 1);
    send(c, { id: 2, method: "thread/delete", params: { threadId: "sess-z" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 2).error.message).toMatch(/store boom/);

    send(c, { id: 3, method: "thread/resume", params: { sessionId: "sess-z" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).result.thread.sessionId).toBe("sess-z");
  });
});

describe("thread/fork during shutdown (merge review, finding 5)", () => {
  it("refuses -33007 without ever calling the store when the shutdown latch is already down", async () => {
    const forkCalls: string[] = [];
    const { srv, lines, c } = boot({ forkSession: async (id) => { forkCalls.push(id); return { sessionId: "forked" }; } });
    init(c, 1);
    await srv.shutdown();

    send(c, { id: 2, method: "thread/fork", params: { threadId: "cold-sess" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(ERR.SHUTTING_DOWN);
    expect(forkCalls).toEqual([]);
  });

  it("a shutdown latching WHILE the fork's store write is in flight deletes the just-created fork and replies -33007 — no orphan row outlives the server", async () => {
    let releaseFork!: (v: { sessionId: string }) => void;
    const deleteCalls: string[] = [];
    const { srv, lines, c } = boot({
      forkSession: () => new Promise<{ sessionId: string }>((r) => { releaseFork = r; }),
      deleteSession: async (id) => { deleteCalls.push(id); },
    });
    init(c, 1);
    send(c, { id: 2, method: "thread/fork", params: { threadId: "cold-sess" } });
    await tick(); // parked inside deps.forkSession

    void srv.shutdown();          // the listener keeps accepting while shutdown awaits disposes
    releaseFork({ sessionId: "orphan-fork" });
    await tick();

    expect(deleteCalls).toEqual(["orphan-fork"]); // the row the fork just wrote is undone
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(ERR.SHUTTING_DOWN);
    expect(srv.registry.list()).toHaveLength(0);
  });
});

describe("store-only CRUD on a dead engine (merge review, finding 6)", () => {
  it("thread/name/set on a thr_ id whose engine has ended still reaches the store — renaming a persisted session never touches the engine", async () => {
    const renameCalls: unknown[] = [];
    const { srv, lines, c } = boot({
      renameSession: async (id, title) => { renameCalls.push({ id, title }); },
      sessionFactory: () => fakeSession({ isEnded: () => true }),
    });
    init(c, 1);
    const thread = await startThread(c, lines, 2);

    send(c, { id: 3, method: "thread/name/set", params: { threadId: thread.id, title: "Renamed after death" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(renameCalls).toEqual([{ id: "sess-1", title: "Renamed after death" }]);
    expect(srv.registry.get(thread.id)!.title).toBe("Renamed after death");
  });

  it("thread/tag/set, thread/fork and thread/delete are answerable on a dead engine too; a turn is still -33005", async () => {
    const { lines, c } = boot({
      tagSession: async () => {}, forkSession: async () => ({ sessionId: "forked-dead" }), deleteSession: async () => {},
      sessionFactory: () => fakeSession({ isEnded: () => true, sessionId: "sess-1" }),
    });
    init(c, 1);
    const thread = await startThread(c, lines, 2);

    send(c, { id: 3, method: "thread/tag/set", params: { threadId: thread.id, tag: "archive" } });
    send(c, { id: 4, method: "thread/fork", params: { threadId: thread.id } });
    send(c, { id: 5, method: "turn/start", params: { threadId: thread.id, input: "hi" } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(parsed(lines).find((f) => f.id === 4).result.thread.sessionId).toBe("forked-dead");
    expect(parsed(lines).find((f) => f.id === 5).error.code).toBe(ERR.ENGINE_GONE); // the engine-needing op still refuses

    // delete refuses BUSY (the live-guard, not the dead-engine gate) — the record is still registered
    send(c, { id: 6, method: "thread/delete", params: { threadId: thread.id } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 6).error.code).toBe(ERR.BUSY);
  });
});

describe("thread/name/set + thread/tag/set (Task 12) — safe pass-through on a live session (spec D-M2-7)", () => {
  it("rename calls deps.renameSession, patches the live record's title, and a subscriber gets thread/name/updated", async () => {
    const renameCalls: unknown[] = [];
    const { lines, c } = boot({ renameSession: async (id, title) => { renameCalls.push({ id, title }); } });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    send(c, { id: 3, method: "thread/subscribe", params: { threadId: thread.id } });
    await tick();
    lines.length = 0;

    send(c, { id: 4, method: "thread/name/set", params: { threadId: thread.id, title: "New Name" } });
    await tick();
    expect(renameCalls).toEqual([{ id: "sess-1", title: "New Name" }]);
    expect(parsed(lines).find((f) => f.id === 4).result).toEqual({ ok: true });
    const notif = parsed(lines).find((f) => f.method === "thread/name/updated");
    expect(notif.params).toEqual({ threadId: thread.id, title: "New Name" });
  });

  it("tag calls deps.tagSession, patches the live record's tags, and emits NO notification (parent §8 defines one for name only)", async () => {
    const tagCalls: unknown[] = [];
    const { lines, c } = boot({ tagSession: async (id, tag) => { tagCalls.push({ id, tag }); } });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    send(c, { id: 3, method: "thread/subscribe", params: { threadId: thread.id } });
    await tick();
    lines.length = 0;

    send(c, { id: 4, method: "thread/tag/set", params: { threadId: thread.id, tag: "important" } });
    await tick();
    expect(tagCalls).toEqual([{ id: "sess-1", tag: "important" }]);
    expect(parsed(lines).find((f) => f.id === 4).result).toEqual({ ok: true });
    expect(parsed(lines).find((f) => f.method?.startsWith("thread/tag"))).toBeUndefined();

    // the live mirror was patched too — a follow-up thread/list (empty store) reflects it without any store round-trip
    send(c, { id: 5, method: "thread/list", params: {} });
    const row = (await waitReply(lines, 5)).result.data.find((r: any) => r.id === thread.id);
    expect(row.tags).toEqual(["important"]);
  });

  it("rename/tag pass through safely on a live session — no BUSY refusal (only delete refuses live)", async () => {
    const { lines, c } = boot({ renameSession: async () => {}, tagSession: async () => {} });
    init(c, 1);
    const thread = await startThread(c, lines, 2);
    send(c, { id: 3, method: "thread/name/set", params: { threadId: thread.id, title: "x" } });
    send(c, { id: 4, method: "thread/tag/set", params: { threadId: thread.id, tag: null } });
    await tick();
    expect(parsed(lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(parsed(lines).find((f) => f.id === 4).result).toEqual({ ok: true });
  });

  it("rename on a cold (never-live) bare sessionId still calls the store and replies ok — no live record to patch", async () => {
    const renameCalls: unknown[] = [];
    const { lines, c } = boot({ renameSession: async (id, title) => { renameCalls.push({ id, title }); } });
    init(c, 1);
    send(c, { id: 2, method: "thread/name/set", params: { threadId: "cold-sess-9", title: "Cold rename" } });
    await tick();
    expect(renameCalls).toEqual([{ id: "cold-sess-9", title: "Cold rename" }]);
    expect(parsed(lines).find((f) => f.id === 2).result).toEqual({ ok: true });
    expect(parsed(lines).some((f) => f.method === "thread/name/updated")).toBe(false); // nothing live to notify
  });
});

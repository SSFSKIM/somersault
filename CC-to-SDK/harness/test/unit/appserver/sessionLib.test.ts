// test/unit/appserver/sessionLib.test.ts — Task 12: the session library (store-merged thread/list,
// fork, rename, tag, delete). Copies Task 6's mkSink/send/parsed/init helpers (server.test.ts) so this
// file reads standalone.
//
// Engine-faithful fakes (spec Testing, verbatim): `sessionId` is undefined until the first init frame —
// several cases below deliberately construct a live record in exactly that state (a thread/start whose
// fake session never latches an id) because the merge's dedup key IS sessionId, and a thread that cannot
// offer one cannot be matched against a store row by definition. That is tested explicitly, not left
// implicit in the happy-path cases.
import { describe, it, expect } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, opts: { name?: string; watchThreads?: boolean } = {}) =>
  send(c, { id, method: "initialize", params: { clientInfo: { name: opts.name ?? "t" }, ...(opts.watchThreads ? { watchThreads: true } : {}) } });
const fakeSession = (overrides: Record<string, unknown> = {}) => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1", ...overrides });

/** Every case here calls thread/list at least indirectly; the store side MUST be DI'd (never left to the
 *  real src/sessions/index.js default) — this repo's own real `~/.claude/projects` has thousands of real
 *  sessions on it, so an un-DI'd listSessions call is both slow and non-deterministic in exactly this
 *  environment. `deps.listSessions` defaults to an empty store here; individual tests override it. */
function boot(deps: Partial<AppServerDeps> = {}) {
  const fullDeps: AppServerDeps = { sessionFactory: () => fakeSession(), listSessions: async () => [], ...deps };
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
    send(c, { id: 3, method: "thread/list", params: {} });
    await tick();
    const { data } = parsed(lines).find((f) => f.id === 3).result;
    const rows = data.filter((r: any) => r.sessionId === "sess-1");
    expect(rows).toHaveLength(1); // deduped, not two rows for the one session
    expect(rows[0].id).toBe(thread.id); // live wins — keeps the thr_ id, not the bare sessionId
    expect(rows[0].title).toBe("Store title"); // filled in from the store match
    void srv;
  });

  it("store-only rows project the same 13-field shape, with id=sessionId (no thr_ id) and status idle; pages with the merged-array cursor", async () => {
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
    await tick();
    const page1 = parsed(lines).find((f) => f.id === 2).result;
    expect(page1.data).toHaveLength(1);
    // updatedAt/createdAt are unix SECONDS on the wire (registry.ts's ThreadRecord convention, which
    // threadView passes straight through for live rows) — a store-only row must match that unit, not
    // SDKSessionInfo's own milliseconds.
    expect(page1.data[0]).toMatchObject({ id: "store-a", sessionId: "store-a", title: "A", status: { state: "idle" }, preview: "hi a", updatedAt: 1_700_000_010, createdAt: 1_700_000_009 });
    expect(page1.nextCursor).toBe("1");

    send(c, { id: 3, method: "thread/list", params: { limit: 1, cursor: page1.nextCursor } });
    await tick();
    const page2 = parsed(lines).find((f) => f.id === 3).result;
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).toBe("store-b");
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
    await tick();
    const { data } = parsed(lines).find((f) => f.id === 3).result;
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
    await tick();
    const row = parsed(lines).find((f) => f.id === 4).result.data.find((r: any) => r.id === thread.id);
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
    await tick();
    const row = parsed(lines).find((f) => f.id === 5).result.data.find((r: any) => r.id === thread.id);
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

// test/unit/appserver/fr-resume-delete-toctou.test.ts — final pre-merge review R13.
// A thread/resume whose roster candidate needs a PID-liveness probe AWAITS that probe before it reaches
// startThread — and the deletingSessions reservation only fences an IN-FLIGHT delete. A concurrent
// thread/delete that reserves, deletes and RELEASES entirely inside that probe yield would leave
// startThread's check clear and resume over already-erased history. The fix reserves the resume
// synchronously before the probe (resumingSessions), which thread/delete refuses against — so admission
// and deletion cannot both win. This exercises the PROBE path (a non-terminal roster row), which the
// existing same-tick tests (no candidate) do not.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: undefined });
const tick = () => new Promise((r) => setTimeout(r, 0));
const tickN = async (n: number) => { for (let i = 0; i < n; i++) await tick(); };
const vi_waitFor = async (fn: () => void) => {
  const deadline = Date.now() + 2000;
  for (;;) { try { fn(); return; } catch (e) { if (Date.now() > deadline) throw e; await tick(); } }
};

let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-toctou-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(() => {
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

function boot(deps: Partial<AppServerDeps> = {}) {
  const srv = new AppServer({}, { sessionFactory: () => fakeSession() as never, listSessions: async () => [], ...deps });
  const s = mkSink();
  const c = srv.connect(s.sink);
  c.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "A" } } }) + "\n");
  return { srv, lines: s.lines, c };
}

// A DEAD pid with a procStart: isPidLive probes procStartOf (which returns undefined for a nonexistent
// process) and resolves FALSE — so resume proceeds past the probe rather than refusing "still running".
const candidateRow = (sessionId: string): RosterRow => ({
  short: "fa5e0013", pid: 999777, cwd: "/w", kind: "bg", name: "stale", state: "working",
  startedAt: Date.now(), procStart: "1970-01-01T00:00:00Z", sessionId,
});

describe("resume/delete TOCTOU across the PID probe (final review R13)", () => {
  it("a delete concurrent with a resume's PID probe is REFUSED against the resume's reservation — the store is never touched", async () => {
    const deleteCalls: string[] = [];
    writeRoster(candidateRow("sess-cand"));
    const { srv, lines, c } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });

    // Resume and delete in one chunk: resume reserves resumingSessions synchronously, then yields on the
    // probe; the delete's synchronous arrival then finds the reservation and refuses.
    c.feed(JSON.stringify({ id: 2, method: "thread/resume", params: { sessionId: "sess-cand" } }) + "\n" +
           JSON.stringify({ id: 3, method: "thread/delete", params: { threadId: "sess-cand" } }) + "\n");

    // Wait for the probe to resolve and the resume to admit.
    await vi_waitFor(() => expect(parsed(lines).find((f) => f.id === 2)).toBeTruthy());
    expect(parsed(lines).find((f) => f.id === 2).result.thread.sessionId).toBe("sess-cand"); // resume won
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(ERR.BUSY);                  // delete refused
    expect(deleteCalls).toEqual([]);                                                          // …and never touched the store
    expect(srv.resumingSessions.size).toBe(0);                                                // reservation released in finally
  });

  it("a resume with a candidate, arriving WHILE a delete is in flight, is refused 'Session is being deleted'", async () => {
    let releaseDelete!: () => void;
    writeRoster(candidateRow("sess-y"));
    const { srv, lines, c } = boot({ deleteSession: async () => { await new Promise<void>((r) => { releaseDelete = r; }); } });

    c.feed(JSON.stringify({ id: 2, method: "thread/delete", params: { threadId: "sess-y" } }) + "\n");
    // The delete reaches deps.deleteSession only AFTER its own real `liveInFleet` probe (a `ps` subprocess,
    // since a roster candidate for "sess-y" exists) resolves — not bounded by a fixed tick count under
    // load, so wait on the actual condition: the release handle existing.
    await vi_waitFor(() => expect(releaseDelete).toBeDefined());
    c.feed(JSON.stringify({ id: 3, method: "thread/resume", params: { sessionId: "sess-y" } }) + "\n");
    await tickN(2);

    const e = parsed(lines).find((f) => f.id === 3).error;
    expect(e.code).toBe(ERR.BUSY);
    expect(e.message).toMatch(/being deleted/);
    expect(srv.registry.list()).toHaveLength(0);   // nothing admitted onto the session being erased

    releaseDelete();
    await tickN(2);
    expect(parsed(lines).find((f) => f.id === 2).result).toEqual({ ok: true });
  });
});

describe("a resume-carrying thread/start is thread/resume's PEER, not an unguarded third door (M6)", () => {
  // Spec D-M5-21 already called these two of the three admission surfaces, but only one of them ran any
  // admission guard. `thread/start` with a `resume` in its config registered a record stamped with that
  // session id and asked nobody: two such calls left two records claiming one session — with
  // `findLiveBySessionId` picking between them arbitrarily, so archive and delete could act on one while a
  // live engine held the other — and no fence stopped a start landing mid-`thread/delete`. Both surfaces
  // now run the same `admitResume`.
  const startResuming = (sessionId: string, id: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ id, method: "thread/start", params: { config: { resume: sessionId, ...extra } } }) + "\n";

  it("two starts naming one session leave ONE record — the second is refused and told which remedy applies", async () => {
    const { srv, lines, c } = boot();
    c.feed(startResuming("sess-dup", 2));
    await tickN(2);
    expect(parsed(lines).find((f) => f.id === 2).result.thread.sessionId).toBe("sess-dup");

    c.feed(startResuming("sess-dup", 3));
    await tickN(2);
    const e = parsed(lines).find((f) => f.id === 3).error;
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    // The remedy has to be followable: "use thread/attach" is the FLEET sentence and is unfollowable here.
    expect(e.message).toMatch(/already holds a thread for that session/);
    expect(e.message).toMatch(/thread\/reopen/);
    expect(srv.registry.list().filter((r) => r.sessionId === "sess-dup")).toHaveLength(1);
  });

  it("a start arriving WHILE a delete is in flight is fenced, exactly as the resume peer is", async () => {
    let releaseDelete!: () => void;
    const { srv, lines, c } = boot({ deleteSession: async () => { await new Promise<void>((r) => { releaseDelete = r; }); } });

    c.feed(JSON.stringify({ id: 2, method: "thread/delete", params: { threadId: "sess-z" } }) + "\n");
    await tickN(2);   // parked inside deps.deleteSession, holding its reservation
    c.feed(startResuming("sess-z", 3));
    await tickN(2);

    const e = parsed(lines).find((f) => f.id === 3).error;
    expect(e.code).toBe(ERR.BUSY);
    expect(e.message).toMatch(/being deleted/);
    expect(srv.registry.list()).toHaveLength(0); // nothing admitted onto the session being erased

    releaseDelete();
    await tickN(2);
  });

  it("a FORK beside the resume is still admitted while a record holds the parent — it takes no identity from it", async () => {
    // The scope split `admits` exists for: `forkSession` beside `resume` opens a NEW session id
    // (D-M5-21b), so the live-holder refusal must not fire — two forks off one parent are legitimate — even
    // though the delete fence still applies, because a fork READS that transcript to replay it.
    const { srv, lines, c } = boot();
    c.feed(startResuming("sess-parent", 2));
    await tickN(2);
    c.feed(startResuming("sess-parent", 3, { forkSession: true }));
    await tickN(2);

    expect(parsed(lines).find((f) => f.id === 3).error).toBeUndefined();
    // The fork's record carries NO session id: nothing can know it before the engine's first init frame.
    const fork = srv.registry.list().find((r) => r.id === parsed(lines).find((f) => f.id === 3).result.thread.id);
    expect(fork!.sessionId).toBeUndefined();
  });

  it("a start with no resume at all is untouched by any of this", async () => {
    const { srv, lines, c } = boot();
    c.feed(JSON.stringify({ id: 2, method: "thread/start", params: {} }) + "\n");
    await tickN(2);
    expect(parsed(lines).find((f) => f.id === 2).result.thread).toBeTruthy();
    expect(srv.registry.list()).toHaveLength(1);
  });
});

describe("what the PID probe's yield invalidates (M6 backlog)", () => {
  // `admitResume` decides everything synchronously at arrival and THEN awaits `anyRosterPidLive` — a real
  // `ps` subprocess, milliseconds wide. Two of those arrival answers do not survive that yield, and the
  // roster fixture above is what forces the probe path to run at all.
  const startResuming = (sessionId: string, id: number) =>
    JSON.stringify({ id, method: "thread/start", params: { config: { resume: sessionId } } }) + "\n";

  it("two starts that BOTH reach the probe still leave ONE record — the loser gets the arrival check's own refusal", async () => {
    writeRoster(candidateRow("sess-race"));
    const { srv, lines, c } = boot();
    // ONE chunk: the registry is empty when EACH takes the arrival check, so both pass it and both yield.
    // `resumingSessions` refcounts deletion and deliberately does not serialize siblings, so nothing else
    // stands between them and two records stamped with one session id.
    c.feed(startResuming("sess-race", 2) + startResuming("sess-race", 3));

    await vi_waitFor(() => expect(parsed(lines).filter((f) => f.id === 2 || f.id === 3)).toHaveLength(2));
    const frames = parsed(lines).filter((f) => f.id === 2 || f.id === 3);
    expect(frames.filter((f) => f.result)).toHaveLength(1);
    const lost = frames.filter((f) => f.error);
    expect(lost).toHaveLength(1);
    expect(lost[0].error.code).toBe(ERR.INVALID_PARAMS);
    expect(lost[0].error.message).toMatch(/already holds a thread for that session/);
    expect(srv.registry.list().filter((r) => r.sessionId === "sess-race")).toHaveLength(1);
  });

  it("a shutdown latched DURING the probe refuses the admission rather than leaking a thread past the dispose snapshot", async () => {
    writeRoster(candidateRow("sess-shut"));
    const { srv, lines, c } = boot();
    c.feed(startResuming("sess-shut", 2));
    // shutdown() latches synchronously and snapshots `registry.list()` — here, while the probe is still in
    // flight, so a thread registered afterwards is in no snapshot and is never disposed: a leaked SDK
    // session and its `claude` child, which is the leak the latch exists to close.
    await srv.shutdown();

    await vi_waitFor(() => expect(parsed(lines).find((f) => f.id === 2)).toBeTruthy());
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(ERR.SHUTTING_DOWN);
    expect(srv.registry.list()).toHaveLength(0);
  });
});

// test/unit/appserver/fr-resume-reservation-refcount.test.ts — peer review PF2 (P2), a follow-on to the
// final-review R13 fix (fr-resume-delete-toctou.test.ts).
//
// R13 gave `thread/resume` a reservation to hold across its PID-liveness probe, so a `thread/delete` that
// arrives inside that yield is refused instead of erasing the history the resume is about to admit onto.
// But the reservation was a SET keyed by sessionId and its release unconditional, so two concurrent
// resumes for one sessionId shared ONE entry: the first to settle deleted it while the second was still
// awaiting its own probe, and R13's window reopened for the second. Reachable because the two probes are
// separate reads of a moving world — the first can find the host alive (refuse, release) and the second,
// a beat later, find it gone and proceed to admit.
//
// The fix REFCOUNTS the reservation: it survives every in-flight holder and is dropped at zero. Nothing
// else moves — both arrival-time checks stay exactly as R13 left them.
//
// `isPidLive` is loaded through a controllable stand-in so the interleaving is DECIDED rather than raced:
// each call parks, and the case releases them one at a time.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One parked probe per `isPidLive` call, resolved by the case in the order it wants. */
const probes: Array<(live: boolean) => void> = [];
vi.mock("../../../src/fleet/liveness.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/fleet/liveness.js")>()),
  isPidLive: () => new Promise<boolean>((resolve) => { probes.push(resolve); }),
}));

import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: undefined });
const tick = () => new Promise((r) => setTimeout(r, 0));
const tickN = async (n: number) => { for (let i = 0; i < n; i++) await tick(); };
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { probes.length = 0; root = mkdtempSync(join(tmpdir(), "ccx-fr-refcount-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(() => {
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

function boot(deps: Partial<AppServerDeps> = {}) {
  const srv = new AppServer({}, { sessionFactory: () => fakeSession() as never, listSessions: async () => [], ...deps });
  const s = mkSink();
  const c = srv.connect(s.sink);
  c.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "A" } } }) + "\n");
  return { srv, lines: s.lines, c, reply: (id: number) => s.lines.map((l) => JSON.parse(l)).find((f) => f.id === id) };
}

/** A non-terminal row carrying the sessionId — what makes `thread/resume` take the PROBE path at all. */
const candidateRow = (sessionId: string): RosterRow => ({
  short: "fa5e0021", pid: 999778, cwd: "/w", kind: "bg", name: "stale", state: "working",
  startedAt: Date.now(), procStart: "1970-01-01T00:00:00Z", sessionId,
});

describe("concurrent resumes share one reservation (peer review PF2)", () => {
  it("the first resume to settle does NOT release the reservation the second still needs", async () => {
    const deleteCalls: string[] = [];
    writeRoster(candidateRow("sess-r"));
    const { srv, c, reply } = boot({ deleteSession: async (id) => { deleteCalls.push(id); } });

    // Two resumes for ONE sessionId, dispatched in one chunk: both reserve synchronously, then both park
    // on their own probe.
    c.feed(JSON.stringify({ id: 2, method: "thread/resume", params: { sessionId: "sess-r" } }) + "\n" +
           JSON.stringify({ id: 3, method: "thread/resume", params: { sessionId: "sess-r" } }) + "\n");
    await waitFor(() => expect(probes).toHaveLength(2));

    // The first probe finds the host still alive: that resume refuses and runs its `finally`…
    probes[0](true);
    await tickN(2);
    expect(reply(2).error.code).toBe(ERR.INVALID_PARAMS);
    expect(reply(3)).toBeUndefined();                       // …while the second is still inside its probe
    expect(srv.resumingSessions.has("sess-r")).toBe(true);  // so the reservation must still stand

    // …and a delete arriving in that window is refused against it, never reaching the store.
    c.feed(JSON.stringify({ id: 4, method: "thread/delete", params: { threadId: "sess-r" } }) + "\n");
    await tickN(2);
    expect(reply(4).error.code).toBe(ERR.BUSY);
    expect(deleteCalls).toEqual([]);

    // The second probe now finds the host gone, and admits onto history nothing erased.
    probes[1](false);
    await waitFor(() => expect(reply(3)).toBeTruthy());
    expect(reply(3).result.thread.sessionId).toBe("sess-r");
    expect(srv.resumingSessions.has("sess-r")).toBe(false); // dropped at zero, not before
  });
});

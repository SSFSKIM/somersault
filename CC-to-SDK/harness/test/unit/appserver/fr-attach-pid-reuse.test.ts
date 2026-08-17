// test/unit/appserver/fr-attach-pid-reuse.test.ts — peer review PF1 (P1).
// `thread/attach` dialled the host by PID ALONE (`hostSocketPath(row.pid)`), with no identity check
// anywhere in the admission path — while its sibling `thread/resume` has always passed `row.procStart` to
// `isPidLive`. So a crashed host's still-nonterminal roster row, whose pid the OS later handed to a
// DIFFERENT ccx host, resolved to the new host's socket and adopted an unrelated live session: the client
// then drove someone else's conversation believing it was the one it named.
//
// The fix is two guards, and the second is the load-bearing one — a pre-dial pid check can always be
// overtaken (the process can die and its pid be reused between the check and the dial), so the socket's
// OWN testimony has to be what decides:
//   1. before the dial, `isPidLive(row.pid, row.procStart)` — the mirror of `thread/resume`'s check;
//   2. after `status`, the host's own `short` against the row's — refused only on a POSITIVE mismatch, so
//      a host predating the field (which reports none) still attaches.
// Every case drives a REAL fake host over a REAL unix socket and a REAL roster, wire-level through
// `srv.connect`/`feed`, exactly as fleet-adoption.test.ts does.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const frame = (lines: string[], id: number) => lines.map((l) => JSON.parse(l)).find((f) => f.id === id);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-reuse-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

function boot() {
  const srv = new AppServer({}, {} as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  s.lines.length = 0;
  return { srv, conn, lines: s.lines };
}

async function attach(conn: { feed(ch: string): void }, lines: string[], id: number, target: string) {
  send(conn, { id, method: "thread/attach", params: { target } });
  await waitFor(() => expect(frame(lines, id)).toBeTruthy());
  return frame(lines, id);
}

describe("thread/attach after PID reuse (peer review PF1)", () => {
  it("a stale row whose pid now runs a DIFFERENT session is refused, and the dialled engine is disposed", async () => {
    // The new occupant of this pid: a live host that knows it is `fa5e0002`.
    const fh = await startFakeHost({ short: "fa5e0002", status: { sessionId: "sess-new" } });
    hosts.push(fh);
    // The crashed host's row, never finalized — same pid, a session that is gone. This is the only row on
    // the roster, so the target resolves to it and the dial lands on the stranger's socket.
    writeRoster({ ...fh.row, short: "fa5e0001", name: "crashed", sessionId: "sess-crashed" });
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, "fa5e0001");
    expect(rep.error.code).toBe(ERR.ATTACH_FAILED);
    expect(rep.error.message).toMatch(/stale/);
    expect(rep.error.message).toContain("fa5e0002");     // names the session the socket actually belongs to
    expect(srv.registry.list()).toHaveLength(0);
    // …and nothing leaks: the engine dialled before the mismatch was seen is disposed (dispose() sends
    // `unfollow` before destroying the socket), the way the R1 shutdown race must not leak one either.
    await waitFor(() => expect(fh.ops).toContain("unfollow"));
  });

  it("a host that reports NO short (one predating the field) still attaches", async () => {
    const fh = await startFakeHost({ short: "fa5e0003", status: { short: undefined, sessionId: "sess-old" } });
    hosts.push(fh);
    writeRoster(fh.row);
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, fh.row.short);
    expect(rep.result.thread.short).toBe(fh.row.short);
    expect(rep.result.thread.sessionId).toBe("sess-old");
    expect(srv.registry.list()).toHaveLength(1);
  });

  it("a row whose procStart no longer matches its pid is refused BEFORE the socket is dialled", async () => {
    // Same pid, a `ps -o lstart=` stamp from a process that is long gone: `isPidLive` reads the pid's ACTUAL
    // start, sees a stranger, and the attach never reaches the wire — `thread/resume`'s check, on the path
    // that was missing it.
    const fh = await startFakeHost({ short: "fa5e0004" });
    hosts.push(fh);
    writeRoster({ ...fh.row, procStart: "Thu Jan  1 00:00:00 1970" });
    const { srv, conn, lines } = boot();

    const rep = await attach(conn, lines, 2, fh.row.short);
    expect(rep.error.code).toBe(ERR.ATTACH_FAILED);
    expect(rep.error.message).toMatch(/stale/);
    expect(srv.registry.list()).toHaveLength(0);
    expect(fh.ops).toEqual([]);                          // never dialled: no follow, no status
  });
});

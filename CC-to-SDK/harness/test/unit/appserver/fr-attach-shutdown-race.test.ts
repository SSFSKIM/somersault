// test/unit/appserver/fr-attach-shutdown-race.test.ts — final pre-merge review R1 (P1).
// thread/attach passes its shutdown-latch check at entry, then AWAITS the socket dial + host status. If
// shutdown() snapshots the registry during that await, an attach that registered its record AFTER the
// snapshot left a socket + follower nothing ever disposed — blocking graceful exit. The fix re-checks the
// latch atomically just before publishing: either the record is in shutdown's snapshot, or the attach
// disposes its own just-dialled engine and refuses SHUTTING_DOWN. Driven by a raw host that HOLDS its
// status reply, so shutdown can be interposed deterministically mid-dial.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostSocketPath } from "../../../src/fleet/paths.js";
import { encodeReply, decodeFrame } from "../../../src/host/wire.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const frame = (lines: string[], id: number) => lines.map((l) => JSON.parse(l)).find((f) => f.id === id);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** A raw NDJSON peer that answers `follow`/`unfollow` at once but HOLDS `status` until released, and
 *  records every op it saw — so a test can freeze an attach mid-dial and prove the dialled engine was
 *  disposed (an `unfollow` from dispose()). */
async function startHeldStatusHost(pid: number) {
  const socketPath = hostSocketPath(pid);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  let peer: Socket | undefined;
  const ops: string[] = [];
  let held: number | undefined;   // a pending status op's id
  const srv = createServer((s) => {
    peer = s;
    s.on("error", () => {});
    s.on("data", (c) => {
      for (const line of c.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const fr = decodeFrame(line) as { id?: number; op?: string } | undefined;
        if (typeof fr?.id !== "number") continue;
        ops.push(String(fr.op));
        if (fr.op === "status") { held = fr.id; continue; }   // hold it
        s.write(encodeReply(fr.id, { ok: true }));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(socketPath, () => r()));
  return {
    ops,
    releaseStatus: () => { if (held !== undefined && peer) { peer.write(encodeReply(held, { ok: true })); held = undefined; } },
    close: () => new Promise<void>((r) => { peer?.destroy(); srv.close(() => r()); }),
  };
}

const servers: AppServer[] = [];
const raws: Array<{ close(): Promise<void> }> = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-shut-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const r of raws.splice(0)) await r.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("attach vs shutdown race (final review R1)", () => {
  it("shutdown mid-dial: the attach disposes its own engine and refuses SHUTTING_DOWN; nothing leaks", async () => {
    const pid = 990601;
    const raw = await startHeldStatusHost(pid);
    raws.push(raw);
    const row: RosterRow = { short: "fa5e9601", pid, cwd: "/w", kind: "interactive", name: "raw", state: "working", startedAt: Date.now(), sessionId: "sess-raw" };
    writeRoster(row);

    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const s = mkSink();
    const conn = srv.connect(s.sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "A" }, watchThreads: true } });

    // Attach dials, follows, then blocks awaiting the held `status`.
    send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
    await waitFor(() => expect(raw.ops).toContain("status"));   // dial reached the status round trip

    // Shutdown while the dial is frozen — its registry snapshot cannot include the not-yet-published record.
    const done = srv.shutdown();
    // Now let the dial finish: the re-check sees the latch and refuses, disposing the just-dialled engine.
    raw.releaseStatus();
    await done;

    await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
    expect(frame(s.lines, 2).error.code).toBe(ERR.SHUTTING_DOWN);
    // No record survives, and the dialled engine was disposed (dispose() sends unfollow before destroy).
    expect(srv.registry.list()).toHaveLength(0);
    await waitFor(() => expect(raw.ops).toContain("unfollow"));
  });
});

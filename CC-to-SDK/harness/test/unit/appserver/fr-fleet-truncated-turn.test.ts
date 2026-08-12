// test/unit/appserver/fr-fleet-truncated-turn.test.ts — final pre-merge review R5.
// A host follow replay whose buffer head was evicted marks its turn-start `truncated` (host.ts:607) — the
// items that follow are a SUFFIX, not the whole turn. The event layer used to ignore that flag and open a
// normal whole-turn lifecycle, so a client rendered the retained suffix as the entire turn. The fix carries
// `truncated:true` on turn/started (live AND on the subscribe-time replay). fakeHost cannot put a truncated
// frame on the wire (it rides the seq-bearing turn-start), so this speaks the wire by hand through a raw
// socket peer on the real host socket path — the same pattern fleet-engine.test.ts uses.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hostSocketPath } from "../../../src/fleet/paths.js";
import { encodeEvent, encodeReply, decodeFrame } from "../../../src/host/wire.js";
import type { HostEvent } from "../../../src/host/wire.js";
import { writeRoster } from "../../../src/fleet/roster.js";
import type { RosterRow } from "../../../src/fleet/roster.js";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** A raw NDJSON peer on the REAL host socket path — answers every correlated op {ok:true} (so
 *  follow/status/unfollow complete) and lets a test hand-write event frames the fake host cannot. */
async function startRawHost(pid: number): Promise<{ emit(ev: HostEvent): void; close(): Promise<void> }> {
  const socketPath = hostSocketPath(pid);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });   // the real HostServer.listen does this
  let peer: Socket | undefined;
  const srv = createServer((s) => {
    peer = s;
    s.on("error", () => {});
    s.on("data", (c) => {
      for (const line of c.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const id = (decodeFrame(line) as { id?: number } | undefined)?.id;
        if (typeof id === "number") s.write(encodeReply(id, { ok: true }));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(socketPath, () => r()));
  return {
    emit: (ev) => { peer?.write(encodeEvent(ev)); },
    close: () => new Promise<void>((r) => { peer?.destroy(); srv.close(() => r()); }),
  };
}

const servers: AppServer[] = [];
const raws: Array<{ close(): Promise<void> }> = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-trunc-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const r of raws.splice(0)) await r.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("truncated fleet turn-start (final review R5)", () => {
  it("carries truncated:true on the live turn/started AND on a later subscribe's replay", async () => {
    const pid = 990501;
    const raw = await startRawHost(pid);
    raws.push(raw);
    const row: RosterRow = { short: "fa5e9001", pid, cwd: "/w", kind: "interactive", name: "raw", state: "working", startedAt: Date.now(), sessionId: "sess-raw" };
    writeRoster(row);

    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const a = mkSink();
    const connA = srv.connect(a.sink);
    send(connA, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(connA, { id: 2, method: "thread/attach", params: { target: row.short } });
    await waitFor(() => expect(frame(a.lines, 2)).toBeTruthy());
    const threadId = frame(a.lines, 2).result.thread.id as string;
    send(connA, { id: 3, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(a.lines, 3)).toBeTruthy());
    a.lines.length = 0;

    // The host's truncated mid-turn replay start (host.ts:607): seq-bearing, so it reaches the event layer.
    raw.emit({ kind: "turn", phase: "start", seq: 1, truncated: true });
    await waitFor(() => expect(notifs(a.lines, "turn/started")).toHaveLength(1));
    expect(notifs(a.lines, "turn/started")[0].params).toMatchObject({ turn: { id: "t1@e0", status: "inProgress" }, truncated: true });

    // A SECOND client subscribing AFTER the truncated start must be told the same, off the replay.
    const b = mkSink();
    const connB = srv.connect(b.sink);
    send(connB, { id: 10, method: "initialize", params: { clientInfo: { name: "B" } } });
    send(connB, { id: 11, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(notifs(b.lines, "turn/started")).toHaveLength(1));
    expect(notifs(b.lines, "turn/started")[0].params).toMatchObject({ turn: { id: "t1@e0", status: "inProgress" }, truncated: true });

    // And when the turn ends, the flag stops describing anything: a still-later subscriber sees no turn.
    raw.emit({ kind: "turn", phase: "end", seq: 1, result: "done" });
    await waitFor(() => expect(notifs(a.lines, "turn/completed")).toHaveLength(1));
    const c = mkSink();
    const connC = srv.connect(c.sink);
    send(connC, { id: 20, method: "initialize", params: { clientInfo: { name: "C" } } });
    send(connC, { id: 21, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(c.lines, 21)).toBeTruthy());
    expect(notifs(c.lines, "turn/started")).toHaveLength(0);
  });
});

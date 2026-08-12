// test/unit/appserver/fr-fleet-same-tick-interrupt.test.ts — scoped re-review SR1.
// R2 moved the fleet prompt submit THROUGH record.chain, opening a window: a turn/start reserves
// synchronously and defers its submit; a same-tick turn/interrupt sets interruptRequested and replies
// {interrupted:true}; THEN the deferred chain callback fires and — rechecking only `closing` — submits the
// prompt anyway, running the model/tool work the client was told was cancelled. The fix mirrors beginTurn's
// inProcess spine: reset interruptRequested at arrival and widen the chain-callback skip guard to cover it,
// replying an error (no id exists yet to synthesize a turn/completed). Driven wire-level against a REAL fake
// host over a REAL unix socket — the only honest way the same-tick ordering is reproduced.
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
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const promptOps = (fh: FakeHostControls) => fh.opCalls.filter((c) => c.op === "prompt");
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-stint-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const fh of hosts.splice(0)) await fh.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

async function bootAttached() {
  const fh = await startFakeHost();
  hosts.push(fh);
  writeRoster(fh.row);
  const srv = new AppServer({}, {} as never);
  servers.push(srv);
  const s = mkSink();
  const conn = srv.connect(s.sink);
  send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "T" }, watchThreads: true } });
  send(conn, { id: 2, method: "thread/attach", params: { target: fh.row.short } });
  await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
  const threadId = frame(s.lines, 2).result.thread.id as string;
  send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
  await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
  s.lines.length = 0;
  return { fh, conn, lines: s.lines, threadId };
}

describe("fleet same-tick turn/interrupt (scoped review SR1)", () => {
  it("a turn/interrupt in the same tick as turn/start refuses the turn — no prompt ever reaches the host", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    // Same-tick, back to back, before any microtask flushes: the start reserves and defers its submit, the
    // interrupt sets interruptRequested and answers first, and the deferred chain callback must then skip.
    send(conn, { id: 4, method: "turn/start", params: { threadId, input: "go" } });
    send(conn, { id: 5, method: "turn/interrupt", params: { threadId } });
    await waitFor(() => expect(frame(lines, 4)).toBeTruthy());   // the start caller learns its fate
    // (b) the turn/start is refused -33001, never told a turn started that the interrupt already cancelled.
    expect(frame(lines, 4).error?.code).toBe(ERR.BUSY);
    expect(frame(lines, 4).result).toBeUndefined();
    // (a) the deferred submit never fired: no prompt op reached the host at all.
    expect(promptOps(fh)).toHaveLength(0);
    // and the interrupt itself was honoured
    expect(frame(lines, 5)?.result).toEqual({ interrupted: true });
  });

  it("a turn/start AFTER an interrupted turn still submits — the arrival reset clears the stale latch", async () => {
    // The companion half of the fix: interruptRequested is left standing by onTurn 'end' (only 'start'
    // clears it, which for the NEXT turn runs after its submit). Without the arrival reset, the new turn's
    // chain callback would read the PRIOR turn's stale latch and wrongly refuse it.
    const { fh, conn, lines, threadId } = await bootAttached();
    // turn 1 — submits, the host echoes its start
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: "one" } });
    await waitFor(() => expect(promptOps(fh)).toHaveLength(1));
    await waitFor(() => expect(frame(lines, 10)?.result?.turn?.status).toBe("inProgress"));
    // interrupt it — sets the latch that must not survive into turn 2
    send(conn, { id: 11, method: "turn/interrupt", params: { threadId } });
    await waitFor(() => expect(frame(lines, 11)?.result).toEqual({ interrupted: true }));
    fh.endTurn(1, { result: "ok" });
    await waitFor(() => expect(parsed(lines).some((f) => f.method === "turn/completed")).toBe(true));
    // turn 2 — must reach the host despite the stale latch
    send(conn, { id: 12, method: "turn/start", params: { threadId, input: "two" } });
    await waitFor(() => expect(promptOps(fh)).toHaveLength(2));
    await waitFor(() => expect(frame(lines, 12)?.result?.turn?.status).toBe("inProgress"));
  });
});

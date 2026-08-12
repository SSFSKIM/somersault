// test/unit/appserver/fr-fleet-turn-admission.test.ts — final pre-merge review R2 + R3 (unified).
// A fleet turn/start must (R2) submit THROUGH record.chain so the prompt orders behind a prior chain
// mutation (thread/model/set) instead of racing ahead of the forwarded op, and (R3) reserve admission
// SYNCHRONOUSLY at arrival so a same-tick second turn/start is refused -33001 rather than overwriting the
// first turn's F2 ack and racing a second submit onto fleetEngine's one-submit guard. Driven wire-level
// against a REAL fake host over a REAL unix socket, the only way the ordering/race properties are honest.
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
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

const hosts: FakeHostControls[] = [];
const servers: AppServer[] = [];
let root = "";
const savedRoot = process.env.CCX_FLEET_ROOT;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-adm-")); process.env.CCX_FLEET_ROOT = root; });
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

describe("fleet turn admission (final review R2 + R3)", () => {
  it("R2: a prior thread/model/set reaches the host BEFORE the turn's prompt", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    // Same-tick: model/set then turn/start, back to back. Pre-fix the prompt submitted immediately
    // (outside record.chain) and beat the chain-deferred set_model to the host.
    send(conn, { id: 10, method: "thread/model/set", params: { threadId, model: "claude-opus-5" } });
    send(conn, { id: 11, method: "turn/start", params: { threadId, input: "hello" } });
    await waitFor(() => expect(fh.opCalls.some((c) => c.op === "prompt")).toBe(true));
    const order = fh.opCalls.map((c) => c.op).filter((op) => op === "set_model" || op === "prompt");
    expect(order).toEqual(["set_model", "prompt"]);
    // and the turn/start still gets its inProgress reply
    await waitFor(() => expect(frame(lines, 11)).toBeTruthy());
    expect(frame(lines, 11).result.turn.status).toBe("inProgress");
  });

  it("R3: two same-tick turn/start — exactly one admitted, the other -33001; completed never precedes the reply", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    send(conn, { id: 20, method: "turn/start", params: { threadId, input: "A" } });
    send(conn, { id: 21, method: "turn/start", params: { threadId, input: "B" } });
    // The second is refused SYNCHRONOUSLY at arrival by the reservation — before any host round trip.
    expect(frame(lines, 21).error.code).toBe(ERR.BUSY);
    // Exactly one prompt reaches the host.
    await waitFor(() => expect(fh.opCalls.filter((c) => c.op === "prompt")).toHaveLength(1));
    // The admitted turn gets its inProgress reply…
    await waitFor(() => expect(frame(lines, 20)).toBeTruthy());
    expect(frame(lines, 20).result.turn.status).toBe("inProgress");
    const admittedTurnId = frame(lines, 20).result.turn.id as string;
    // …and end it. Its turn/completed must land AFTER the inProgress reply (the F2 barrier held).
    fh.endTurn(1, { result: "ok" });
    await waitFor(() => expect(notifs(lines, "turn/completed").some((n) => n.params.turn.id === admittedTurnId)).toBe(true));
    const replyIdx = lines.findIndex((l) => JSON.parse(l).id === 20 && JSON.parse(l).result);
    const completedIdx = lines.findIndex((l) => { const f = JSON.parse(l); return f.method === "turn/completed" && f.params?.turn?.id === admittedTurnId; });
    expect(replyIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(replyIdx);
  });
});

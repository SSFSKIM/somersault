// test/unit/appserver/fr-fleet-legacy-settlement.test.ts — final pre-merge review R6.
// A host predating §1a-e emits a settlement's KIND STRING with no structured `answer`. For a payload-free
// deny that reconstructs exactly, but for a version-skewed old host answering a PLAN or QUESTION the event
// layer used to fabricate `{kind}` alone — schema-INVALID for those kinds. The fix reconstructs only
// payload-free kinds and otherwise settles DENY, so the emitted decision/resolved always validates.
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
import { decisionOutcomeParams } from "../../../src/appserver/schema/decisions.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const notifs = (lines: string[], method: string) => parsed(lines).filter((f) => f.method === method);
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

async function startRawHost(pid: number): Promise<{ emit(ev: HostEvent): void; close(): Promise<void> }> {
  const socketPath = hostSocketPath(pid);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
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
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fr-legacy-")); process.env.CCX_FLEET_ROOT = root; });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  for (const r of raws.splice(0)) await r.close().catch(() => {});
  if (savedRoot === undefined) delete process.env.CCX_FLEET_ROOT; else process.env.CCX_FLEET_ROOT = savedRoot;
  rmSync(root, { recursive: true, force: true });
});

describe("legacy fleet settlement without `answer` (final review R6)", () => {
  it("an answer-less plan_approve settlement resolves a SCHEMA-VALID outcome (deny), not a partial {kind:plan_approve}", async () => {
    const pid = 990701;
    const raw = await startRawHost(pid);
    raws.push(raw);
    const row: RosterRow = { short: "fa5e0006", pid, cwd: "/w", kind: "interactive", name: "raw", state: "working", startedAt: Date.now(), sessionId: "sess-raw" };
    writeRoster(row);

    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const s = mkSink();
    const conn = srv.connect(s.sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
    await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
    const threadId = frame(s.lines, 2).result.thread.id as string;
    send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
    s.lines.length = 0;

    // A plan decision parks (host-side view), then a LEGACY settlement of it: the kind string alone, no
    // structured `answer` — the version-skew case a pre-§1a-e host produces for a human plan approval.
    raw.emit({ kind: "decision", entry: { sessionId: "sess-raw", toolName: "ExitPlanMode", kind: "plan", input: {}, createdAt: Date.now(), toolUseID: "toolu_plan" } as never });
    await waitFor(() => expect(notifs(s.lines, "decision/requested")).toHaveLength(1));
    raw.emit({ kind: "decision_settled", toolUseID: "toolu_plan", by: "someone-else", decision: "plan_approve" } as never);
    await waitFor(() => expect(notifs(s.lines, "decision/resolved")).toHaveLength(1));

    const resolved = notifs(s.lines, "decision/resolved")[0].params;
    expect(resolved.toolUseId).toBe("toolu_plan");
    // THE FIX: the emitted answer is a complete, valid outcome — not `{kind:"plan_approve"}` missing `mode`.
    expect(decisionOutcomeParams.safeParse(resolved.answer).success).toBe(true);
    expect(resolved.answer).toEqual({ kind: "deny" });
  });

  it("an answer-less DENY still reconstructs exactly (the current-host path is unchanged)", async () => {
    const pid = 990702;
    const raw = await startRawHost(pid);
    raws.push(raw);
    const row: RosterRow = { short: "fa5e0007", pid, cwd: "/w", kind: "interactive", name: "raw", state: "working", startedAt: Date.now(), sessionId: "sess-raw" };
    writeRoster(row);

    const srv = new AppServer({}, {} as never);
    servers.push(srv);
    const s = mkSink();
    const conn = srv.connect(s.sink);
    send(conn, { id: 1, method: "initialize", params: { clientInfo: { name: "A" } } });
    send(conn, { id: 2, method: "thread/attach", params: { target: row.short } });
    await waitFor(() => expect(frame(s.lines, 2)).toBeTruthy());
    const threadId = frame(s.lines, 2).result.thread.id as string;
    send(conn, { id: 3, method: "thread/subscribe", params: { threadId } });
    await waitFor(() => expect(frame(s.lines, 3)).toBeTruthy());
    s.lines.length = 0;

    raw.emit({ kind: "decision", entry: { sessionId: "sess-raw", toolName: "Bash", kind: "permission", input: {}, createdAt: Date.now(), toolUseID: "toolu_bash" } as never });
    await waitFor(() => expect(notifs(s.lines, "decision/requested")).toHaveLength(1));
    raw.emit({ kind: "decision_settled", toolUseID: "toolu_bash", by: "system", decision: "deny" } as never);
    await waitFor(() => expect(notifs(s.lines, "decision/resolved")).toHaveLength(1));

    const resolved = notifs(s.lines, "decision/resolved")[0].params;
    expect(decisionOutcomeParams.safeParse(resolved.answer).success).toBe(true);
    expect(resolved.answer).toEqual({ kind: "deny" });
  });
});

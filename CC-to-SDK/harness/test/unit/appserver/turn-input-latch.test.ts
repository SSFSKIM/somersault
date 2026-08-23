// test/unit/appserver/turn-input-latch.test.ts — THE POST-RESOLUTION LATCH RE-CHECK (spec 2026-08-23
// rev 3, "Admission and the queue"; plan-review finding 2).
//
// `resolveInputItems` is an await that did not exist before this milestone, and it sits between the
// checks that admitted the turn and the engine call those checks were guarding. The M6 lesson names the
// failure exactly: an added await turns every check before it stale. So both origins re-check the SAME
// two latches on the far side of it — `closing` (a thread/close landed) and `interruptRequested` (a
// turn/interrupt landed) — and neither may reach an engine once either is up.
//
// The window is opened by MOCKING THIS REPO'S OWN RESOLVER, not by finding a slow file: the real
// resolver still does the real work, it is merely held. A real slow read (twenty 500 KB files, say)
// races the test's own interrupt frame, and the direction it races in is a false green — the interrupt
// arriving after resolution finished proves nothing at all. The mock defaults to pass-through, so a row
// that does not call `gate.hold()` sees the unmodified module.
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
import type { UserTurnInput } from "../../../src/session/turnInput.js";

const gate = vi.hoisted(() => {
  let release: (() => void) | undefined;
  let pending: Promise<void> = Promise.resolve();
  return {
    /** Hold every resolution from here until `release()` — armed BEFORE the turn/start it is about. */
    hold(): void { pending = new Promise<void>((r) => { release = r; }); },
    release(): void { const r = release; release = undefined; pending = Promise.resolve(); r?.(); },
    wait(): Promise<void> { return pending; },
  };
});
vi.mock("../../../src/appserver/turnItems.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/appserver/turnItems.js")>();
  return {
    ...actual,
    resolveInputItems: async (items: Parameters<typeof actual.resolveInputItems>[0]) => {
      await gate.wait();
      return actual.resolveInputItems(items);
    },
  };
});

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const frame = (lines: string[], id: number) => parsed(lines).find((f) => f.id === id);
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

/** A 24-byte PNG header — the cheapest buffer that sniffs as a real image. The rows below are about the
 *  latch, not the bytes, so one image is enough to make the input an ARRAY. */
const PNG = (() => {
  const buf = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(4, 16);
  buf.writeUInt32BE(4, 20);
  return buf;
})();
const ITEMS = [{ type: "text", text: "look" }, { type: "image", url: `data:image/png;base64,${PNG.toString("base64")}` }];

describe("post-resolution latch re-check — inProcess", () => {
  const submits: UserTurnInput[] = [];
  beforeEach(() => { submits.length = 0; });
  const factory = () => ({
    submit: async (prompt: UserTurnInput) => { submits.push(prompt); return { result: {} }; },
    interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
  });

  async function bootThread() {
    const srv = new AppServer({}, { sessionFactory: factory } as never);
    const s = mkSink(); const c = srv.connect(s.sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = frame(s.lines, 2).result.thread.id as string;
    send(c, { id: 99, method: "thread/subscribe", params: { threadId } });
    await tick();
    s.lines.length = 0;
    return { srv, s, c, threadId };
  }

  it("a turn/interrupt landing DURING resolution stops the turn before the engine ever sees it", async () => {
    const { s, c, threadId } = await bootThread();
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();                                                  // the chain callback ran; resolution is parked
    expect(frame(s.lines, 3).result.turn.status).toBe("inProgress");
    send(c, { id: 4, method: "turn/interrupt", params: { threadId } });
    gate.release();
    await settle();
    expect(submits).toEqual([]);                                   // the whole point: no engine call at all
    const completed = parsed(s.lines).filter((f) => f.method === "turn/completed");
    expect(completed.map((f) => f.params.turn.status)).toEqual(["interrupted"]);
  });

  it("a thread/close landing DURING resolution stops the turn — no submit against an engine the close is disposing, and no crash", async () => {
    const { srv, s, c, threadId } = await bootThread();
    gate.hold();
    send(c, { id: 3, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(c, { id: 5, method: "thread/close", params: { threadId } });
    gate.release();
    await settle();
    expect(submits).toEqual([]);
    expect(frame(s.lines, 5).result).toEqual({ ok: true });         // the close completed, un-wedged
    expect(srv.registry.get(threadId)).toBeUndefined();
  });
});

describe("post-resolution latch re-check — fleet", () => {
  const hosts: FakeHostControls[] = [];
  const servers: AppServer[] = [];
  let root = "";
  const savedRoot = process.env.CCX_FLEET_ROOT;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-latch-")); process.env.CCX_FLEET_ROOT = root; });
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

  it("a turn/interrupt landing DURING resolution refuses the start and never puts a prompt on the host wire", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    gate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(conn, { id: 11, method: "turn/interrupt", params: { threadId } });
    gate.release();
    await settle();
    // NOTHING reached the host — not the prompt, and not the `stageImage` that precedes it. Asserting on
    // the prompt alone would pass with this guard deleted, because the engine's own `opts.aborted` check
    // (one await later, on the far side of staging) would still catch it and answer identically: the two
    // guards are only distinguishable by whether the host was touched at all.
    expect(fh.ops.filter((op) => op === "prompt" || op === "stageImage")).toEqual([]);
    // The same -33001 the pre-resolution guard one line above it already answers: a fleet turn has no id
    // until the host's seq arrives, so a refusal is the only honest terminal it can report.
    expect(frame(lines, 10).error).toEqual({ code: ERR.BUSY, message: "Turn interrupted before it started" });
  });

  it("a thread/close landing DURING resolution refuses the start and never puts a prompt on the host wire", async () => {
    const { fh, conn, lines, threadId } = await bootAttached();
    gate.hold();
    send(conn, { id: 10, method: "turn/start", params: { threadId, input: ITEMS } });
    await tick();
    send(conn, { id: 12, method: "thread/close", params: { threadId } });
    gate.release();
    await settle();
    // NOTHING reached the host — not the prompt, and not the `stageImage` that precedes it. Asserting on
    // the prompt alone would pass with this guard deleted, because the engine's own `opts.aborted` check
    // (one await later, on the far side of staging) would still catch it and answer identically: the two
    // guards are only distinguishable by whether the host was touched at all.
    expect(fh.ops.filter((op) => op === "prompt" || op === "stageImage")).toEqual([]);
    expect(frame(lines, 10).error).toEqual({ code: ERR.BUSY, message: "Thread is busy (closing)" });
    expect(frame(lines, 12).result).toEqual({ ok: true });
  });
});

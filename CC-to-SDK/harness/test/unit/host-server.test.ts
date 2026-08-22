import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { HostServer } from "../../src/host/server.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { DecisionOutcome } from "../../src/permissions/types.js";

let srv: HostServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

// This file predates the op union Task 6 adds; it only exercises status/stop framing, so the rest of
// HostHandlers is stubbed once here rather than repeated at every one of its ~dozen call sites.
const stub = { busy: () => false, pending: () => [], answer: () => ({ ok: true }), prompt: async () => {}, interrupt: async () => {}, follow: () => () => {},
  control: async () => ({ ok: true }), resume: async () => {}, clear: async () => {}, turnSeq: () => 0,
  tasks: () => [], background: async () => true, stopTask: async () => {},
  rewindAnchors: async () => [], rewindDryRun: async () => ({ canRewind: false }), rewind: async () => {},
  getSettings: async () => ({}), listDirs: () => [], addDir: async () => {}, removeDir: async () => {},
  setOutputStyle: async () => {}, addRule: async () => {}, removeRule: async () => {}, setEffort: async () => {},
  // F9 T-IMAGE Task 5 (I3b): this file exercises status/stop framing only, so a fixed stub reply is enough.
  stageImage: () => ({ path: "/fake/staged/path" }) };

const root = mkdtempSync(join(tmpdir(), "ccx-host-"));   // one temp root for the file, not one per test
let nth = 0;
const sockPath = () => join(root, `h${nth++}.sock`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Fail loudly instead of hanging to the suite timeout when a frame never comes back. */
function within<T>(p: Promise<T>, what: string, ms = 1000): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`no ${what} within ${ms}ms`)), ms); })]);
}

function ask(path: string, op: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = connect({ path }, () => s.write(JSON.stringify(op) + "\n"));
    let buf = "";
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { s.end(); resolve(JSON.parse(buf.slice(0, i))); } });
    s.on("error", reject);
  });
}

/** One connection, many ops. `ask` opens a fresh connection per op, so only this exercises the framing
 *  invariant A2's `follow` stream depends on: the socket survives a reply, and survives a rejected op. */
function session(path: string) {
  const s = connect({ path });
  s.on("error", () => {});
  let buf = ""; const waiting: ((v: any) => void)[] = [];
  s.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiting.shift()?.(JSON.parse(line)); }
  });
  const next = () => new Promise<any>((r) => waiting.push(r));
  return {
    ready: new Promise<void>((r) => s.once("connect", () => r())),
    ask: (op: unknown) => { const p = next(); s.write(JSON.stringify(op) + "\n"); return p; },
    raw: (text: string) => { s.write(text); },   // hand-framed bytes: packet splits, blank + malformed lines
    next,                                        // a reply with no op of its own to send
    close: () => s.destroy(),
  };
}

describe("HostServer", () => {
  it("answers a status op with the handler's snapshot", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" }), stop: async () => {} }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "status" })).toEqual({ ok: true, state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" });
  });
  it("rejects an unknown op without killing the connection handler", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const bad = await ask(sock, { op: "nonsense" });
    expect(bad.ok).toBe(false);
    expect(await ask(sock, { op: "status" })).toMatchObject({ ok: true, state: "working" });
  });
  // Final-review finding 3: `chatAdapter.ts` treats the exact string "unknown op" as its ONLY version-skew
  // signal. Before this fix, EVERY schema parse failure — a truly unrecognized op literal, or a RECOGNIZED
  // literal whose payload just failed some other check — answered that identical string, so a validation
  // failure could misreport as "this host predates image paste". They must now read apart.
  it('answers "unknown op" for a literal this schema has never heard of, and something ELSE for a recognized op with an invalid payload', async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const trulyUnknown = await ask(sock, { op: "nonsense" });
    expect(trulyUnknown).toEqual({ ok: false, error: "unknown op" });
    // "prompt" IS a recognized literal — this payload (no text, no images) fails only the schema's own
    // `.refine`, never the discriminant itself.
    const badPayload = await ask(sock, { op: "prompt", text: "" });
    expect(badPayload.ok).toBe(false);
    expect(badPayload.error).not.toBe("unknown op");
  });
  it("serves further ops on the SAME connection after rejecting one", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    expect(await c.ask({ op: "nonsense" })).toMatchObject({ ok: false });
    expect(await c.ask({ op: "status" })).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("answers an error frame when a handler throws, and keeps serving", async () => {
    // unowned, a handler's throw is an unhandled rejection and node kills the whole detached host —
    // and a dead host is the exact condition this listener exists to report on
    const sock = sockPath();
    let boom = true;
    srv = new HostServer({ ...stub, status: () => { if (boom) { boom = false; throw new Error("handler exploded"); } return { state: "working", status: "busy" }; }, stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    expect(await within(c.ask({ op: "status" }), "error frame")).toMatchObject({ ok: false, error: "handler exploded" });
    expect(await within(c.ask({ op: "status" }), "status reply")).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("drains two ops arriving in one packet", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    const first = c.next(), second = c.next();
    c.raw(JSON.stringify({ op: "status" }) + "\n" + JSON.stringify({ op: "status" }) + "\n");
    expect(await within(first, "first reply")).toMatchObject({ ok: true, state: "working" });
    expect(await within(second, "second reply")).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("reassembles one op split across two packets", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    const reply = c.next();
    c.raw('{"op":"sta');
    await new Promise((r) => setTimeout(r, 20));   // force a second packet, not a coalesced one
    c.raw('tus"}\n');
    expect(await within(reply, "reply")).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("skips a blank line instead of answering it", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    const reply = c.next();
    c.raw('\n{"op":"status"}\n');
    expect(await within(reply, "reply")).toMatchObject({ ok: true, state: "working" });   // not a bad-json frame
    c.close();
  });
  it("answers unparseable bytes with an error and keeps serving", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const c = session(sock); await c.ready;
    const reply = c.next();
    c.raw("not json at all\n");   // `{\"op\":\"nonsense\"}` is valid JSON and never reaches the parse catch
    expect(await within(reply, "reply")).toMatchObject({ ok: false, error: "bad json" });
    expect(await within(c.ask({ op: "status" }), "status reply")).toMatchObject({ ok: true, state: "working" });
    c.close();
  });
  it("destroys a peer that streams a frame with no newline in it", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const hog = connect({ path: sock });
    hog.on("error", () => {});
    await new Promise((r) => hog.once("connect", r));
    const gone = new Promise<void>((r) => hog.once("close", () => r()));
    hog.write("x".repeat(400 * 1024));   // past the cap and still no frame in sight
    await within(gone, "peer destroy", 2000);
    expect(await ask(sock, { op: "status" })).toMatchObject({ ok: true });   // the host itself survived
  });
  it("invokes the stop handler and resolves `closed`", async () => {
    const sock = sockPath();
    let stopped = false;
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => { stopped = true; } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "stop" })).toMatchObject({ ok: true });
    expect(stopped).toBe(true);
    const s = srv; srv = undefined;
    await s.close();
    await s.closed;   // Task 7's host awaits this to exit; a `closed` that never settles hangs it forever
  });
  it("close() does not block on an open client connection", async () => {
    // node's server.close() waits for every open connection to end. Without destroying them, the
    // `stop` op deadlocks: the handler calls close(), which waits for the very connection that is
    // waiting for the stop ack. It self-heals only when the client's 1s timeout fires.
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const held = connect({ path: sock });
    await new Promise((r) => held.once("connect", r));
    await within(srv.close(), "close()", 2000);
    held.destroy();
    srv = undefined;
  });
  it("close() is idempotent and removes the socket file", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen(); await srv.close(); await srv.close();
    const { existsSync } = await import("node:fs");
    expect(existsSync(sock)).toBe(false);
  });
  it("a second close() awaits the first rather than resolving early", async () => {
    // a signal handler racing the `stop` op must not resume — and exit the process — mid-teardown
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    let settled = false;
    void srv.closed.then(() => { settled = true; });
    const first = srv.close();
    await srv.close();
    expect(settled).toBe(true);
    await first;
    srv = undefined;
  });

  it("a capabilities op round-trips the control handler's reply", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      control: async () => ({ ok: true, models: [1], commands: [2], mcpServers: [3] }) }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "capabilities" })).toEqual({ ok: true, models: [1], commands: [2], mcpServers: [3] });
  });
  it("refuses resume when busy() is true, gated exactly like prompt", async () => {
    const sock = sockPath();
    const resumed: string[] = [];
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      busy: () => true, resume: async (sid) => { resumed.push(sid); } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "resume", sessionId: "sid-1" })).toMatchObject({ ok: false, error: "busy" });
    expect(resumed).toEqual([]);
  });
  // Live-feedback fix (2026-08-06): the /clear engine half — dispatched to handlers.clear when idle,
  // refused outright when busy, exactly the resume gate.
  it("clear dispatches to the handler when idle, and is refused when busy without reaching it", async () => {
    const sock = sockPath();
    let cleared = 0;
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      clear: async () => { cleared++; } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "clear" })).toMatchObject({ ok: true });
    expect(cleared).toBe(1);
    await srv.close();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      busy: () => true, clear: async () => { cleared++; } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "clear" })).toMatchObject({ ok: false, error: "busy" });
    expect(cleared).toBe(1);
  });
  it("refuses rewind when busy() is true, gated exactly like resume — and never reaches the handler", async () => {
    const sock = sockPath();
    const rewound: unknown[] = [];
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      busy: () => true, rewind: async (anchor, scope) => { rewound.push([anchor, scope]); } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "rewind", uuid: "u1", prevUuid: null, scope: "both" })).toMatchObject({ ok: false, error: "busy" });
    expect(rewound).toEqual([]);
  });
  it("rewind_anchors/rewind_dryrun are NOT busy-gated: they answer even while busy() is true", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      busy: () => true, rewindAnchors: async () => [{ uuid: "uB", prevUuid: "aA", text: "B", index: 2 }],
      rewindDryRun: async () => ({ canRewind: true }) }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "rewind_anchors" })).toMatchObject({ ok: true, anchors: [{ uuid: "uB" }] });
    expect(await ask(sock, { op: "rewind_dryrun", uuid: "uB" })).toMatchObject({ ok: true, dryRun: { canRewind: true } });
  });
  it("a prompt reply carries the turn's seq", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
      prompt: async () => {}, turnSeq: () => 7 }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "prompt", text: "go" })).toMatchObject({ ok: true, accepted: true, seq: 7 });
  });
  it("connectionCount() tracks open sockets, growing and shrinking as they connect/disconnect", async () => {
    const sock = sockPath();
    srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    expect(srv.connectionCount()).toBe(0);
    const c = session(sock); await c.ready;
    await vi.waitFor(() => expect(srv!.connectionCount()).toBe(1));
    c.close();
    await vi.waitFor(() => expect(srv!.connectionCount()).toBe(0));
  });

  // GB fix pass: the mutual-exclusivity guard on `answer` (both/neither of decision|answer refused) was
  // implemented in server.ts's dispatch but never exercised — these three pin it, including the
  // previously-untested structured-only accept path.
  describe("answer op: decision|answer mutual exclusivity", () => {
    it("refuses both decision and answer present, and leaves the park intact", async () => {
      const sock = sockPath();
      const parked: PendingEntry[] = [{ sessionId: "s1", toolUseID: "tu-1", toolName: "ExitPlanMode", kind: "plan", input: {}, createdAt: 0 }];
      const settled = new Set<string>();
      srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
        pending: () => parked.filter((e) => !settled.has(e.toolUseID)),
        answer: (toolUseID) => { settled.add(toolUseID); return { ok: true }; } }, sock);
      await srv.listen();
      const reply = await ask(sock, { op: "answer", toolUseID: "tu-1", by: "human", decision: "deny", answer: { kind: "plan_reject" } });
      expect(reply).toEqual({ ok: false, error: "answer needs exactly one of decision|answer" });
      expect(settled.size).toBe(0);   // the handler must never have been reached
      expect(await ask(sock, { op: "pending" })).toEqual({ ok: true, pending: parked });   // still parked
    });

    it("refuses neither decision nor answer present, and leaves the park intact", async () => {
      const sock = sockPath();
      const parked: PendingEntry[] = [{ sessionId: "s1", toolUseID: "tu-2", toolName: "Bash", kind: "permission", input: {}, createdAt: 0 }];
      const settled = new Set<string>();
      srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
        pending: () => parked.filter((e) => !settled.has(e.toolUseID)),
        answer: (toolUseID) => { settled.add(toolUseID); return { ok: true }; } }, sock);
      await srv.listen();
      const reply = await ask(sock, { op: "answer", toolUseID: "tu-2", by: "human" });
      expect(reply).toEqual({ ok: false, error: "answer needs exactly one of decision|answer" });
      expect(settled.size).toBe(0);
      expect(await ask(sock, { op: "pending" })).toEqual({ ok: true, pending: parked });
    });

    it("accepts a structured-only answer and forwards the outcome to the handler untouched", async () => {
      const sock = sockPath();
      const calls: { toolUseID: string; outcome: DecisionOutcome; by: string }[] = [];
      srv = new HostServer({ ...stub, status: () => ({ state: "working", status: "busy" }), stop: async () => {},
        answer: (toolUseID, outcome, by) => { calls.push({ toolUseID, outcome, by }); return { ok: true }; } }, sock);
      await srv.listen();
      const reply = await ask(sock, { op: "answer", toolUseID: "tu-3", by: "human", answer: { kind: "question_answer", answers: { q: "a" } } });
      expect(reply).toEqual({ ok: true });
      expect(calls).toEqual([{ toolUseID: "tu-3", outcome: { kind: "question_answer", answers: { q: "a" } }, by: "human" }]);
    });
  });
});

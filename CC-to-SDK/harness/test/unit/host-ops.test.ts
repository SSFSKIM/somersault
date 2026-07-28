import { describe, expect, it, vi } from "vitest";
import { connect } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostServer } from "../../src/host/server.js";
import type { HostHandlers } from "../../src/host/server.js";
import { hostOp } from "../../src/host/ops.js";
import type { HostEvent } from "../../src/host/wire.js";

const sockPath = () => join(mkdtempSync(join(tmpdir(), "ccx-ops-")), "h.sock");

/** Send lines, collect frames until `until` says stop. */
function client(path: string) {
  const frames: any[] = [];
  const sock = connect(path);
  let buf = "";
  sock.on("data", (c) => {
    buf += c.toString();
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (line.trim()) frames.push(JSON.parse(line));
    }
  });
  return {
    frames,
    ready: new Promise<void>((r) => sock.once("connect", () => r())),
    send: (o: unknown) => sock.write(JSON.stringify(o) + "\n"),
    sendRaw: (s: string) => sock.write(s),
    end: () => sock.destroy(),
    async waitFor(pred: (f: any) => boolean, ms = 1000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = frames.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no frame matched within ${ms}ms; saw ${JSON.stringify(frames)}`);
    },
  };
}

const handlers = (over: Partial<HostHandlers> = {}): HostHandlers => ({
  status: () => ({ state: "working", status: "busy" }),
  busy: () => false,
  stop: async () => {},
  pending: () => [],
  answer: () => ({ ok: true }),
  prompt: async () => {},
  interrupt: async () => {},
  // `(ev: unknown) => void` (the brief's literal text) does not satisfy HostHandlers.follow's
  // `(ev: HostEvent) => void` callback param — TS rejects it (a fake that promises to accept
  // anything is not substitutable for one only ever called with HostEvent). HostEvent it is.
  follow: (_deliver: (ev: HostEvent) => void) => () => {},
  control: async () => ({ ok: true }),
  resume: async () => {},
  turnSeq: () => 0,
  tasks: () => [],
  background: async () => true,
  stopTask: async () => {},
  ...over,
});

describe("host ops", () => {
  it("echoes the correlation id on every reply", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 42, op: "status" });
    expect(await c.waitFor((f) => f.id === 42)).toMatchObject({ ok: true, state: "working" });
    c.end(); await s.close();
  });

  it("an A1 client sending no id still gets an A1-shaped reply", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ op: "status" });
    const f = await c.waitFor((x) => x.ok === true);
    expect(f).toEqual({ ok: true, state: "working", status: "busy" });   // no id, no t
    c.end(); await s.close();
  });

  it("answer carries the decision and the answerer through to the handler", async () => {
    const seen: any[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ answer: (id, d, by) => { seen.push([id, d, by]); return { ok: true }; } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "answer", toolUseID: "t1", decision: "allow_once", by: "tty-1" });
    await c.waitFor((f) => f.id === 1);
    expect(seen).toEqual([["t1", { kind: "allow_once" }, "tty-1"]]);
    c.end(); await s.close();
  });

  it("rejects an answer whose decision is not one of the three kinds", async () => {
    const p = sockPath(); const s = new HostServer(handlers(), p); await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 2, op: "answer", toolUseID: "t1", decision: "sudo-yes", by: "x" });
    expect(await c.waitFor((f) => f.id === 2)).toMatchObject({ ok: false });
    c.end(); await s.close();
  });

  it("each following connection gets its OWN sink, and events reach only it", async () => {
    const sinks: ((ev: any) => void)[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: (deliver) => { sinks.push(deliver); return () => {}; } }), p);
    await s.listen();
    const watcher = client(p), quiet = client(p);
    await watcher.ready; await quiet.ready;
    watcher.send({ id: 1, op: "follow" });
    await watcher.waitFor((f) => f.id === 1);
    expect(sinks).toHaveLength(1);                       // only the follower registered
    sinks[0]!({ kind: "state", status: { state: "blocked", status: "idle" } });
    await watcher.waitFor((f) => f.t === "event" && f.kind === "state");
    await new Promise((r) => setTimeout(r, 50));
    expect(quiet.frames.some((f) => f.t === "event")).toBe(false);
    watcher.end(); quiet.end(); await s.close();
  });

  it("delivers each event EXACTLY ONCE per following connection", async () => {
    const sinks: ((ev: any) => void)[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: (deliver) => { sinks.push(deliver); return () => {}; } }), p);
    await s.listen();
    const a = client(p), b = client(p);
    await a.ready; await b.ready;
    a.send({ id: 1, op: "follow" }); await a.waitFor((f) => f.id === 1);
    b.send({ id: 1, op: "follow" }); await b.waitFor((f) => f.id === 1);
    // The host emits ONE event; with per-connection sinks that is one write to each socket. A shared
    // broadcast called from each of the two registered followers would write it twice to both.
    for (const sink of sinks) sink({ kind: "turn", phase: "end" });
    await new Promise((r) => setTimeout(r, 60));
    expect(a.frames.filter((f) => f.t === "event")).toHaveLength(1);
    expect(b.frames.filter((f) => f.t === "event")).toHaveLength(1);
    a.end(); b.end(); await s.close();
  });

  it("a follower that disconnects releases its host-side subscription", async () => {
    const offs: number[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({ follow: () => () => { offs.push(1); } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "follow" }); await c.waitFor((f) => f.id === 1);
    c.end();
    // Observable, unlike "broadcast does not throw": socket.write() after destroy never throws
    // synchronously in Node, so that assertion passes even with the cleanup deleted.
    await vi.waitFor(() => expect(offs).toHaveLength(1), { timeout: 1000 });
    await s.close();
  });

  // The whole-branch review's Critical finding: SessionHost.status() deliberately projects a parked
  // turn as {state:"blocked", status:"idle"} for consumers — so a gate built on status().status reads
  // "idle" for the ENTIRE duration of a park, the state a background host spends real time in by
  // design. The gate must ask the handler's own `busy()` instead. This fixture reproduces exactly that
  // disconnect: status() claims idle, busy() says otherwise, and the op must be refused.
  it("refuses a prompt when busy() is true, even though status() reports idle", async () => {
    const got: string[] = [];
    const p = sockPath();
    const s = new HostServer(handlers({
      status: () => ({ state: "blocked", status: "idle", waitingFor: "permission:Bash" }),
      busy: () => true,
      prompt: async (t) => { got.push(t); },
    }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "prompt", text: "should not run" });
    expect(await c.waitFor((f) => f.id === 1)).toMatchObject({ ok: false, error: "busy" });
    expect(got).toEqual([]);   // the handler must never have been invoked
    c.end(); await s.close();
  });

  it("prompt reaches the handler with its text", async () => {
    const got: string[] = [];
    const p = sockPath();
    // dispatch's prompt case gates on busy() — not status().status, which the shared `handlers()`
    // default leaves at "busy" for the id-echo tests above — so the fixture's `busy: () => false`
    // default is what lets this reach the handler at all; `got` would stay empty otherwise.
    const s = new HostServer(handlers({ prompt: async (t) => { got.push(t); } }), p);
    await s.listen();
    const c = client(p); await c.ready;
    c.send({ id: 1, op: "prompt", text: "do the thing" });
    await c.waitFor((f) => f.id === 1);
    expect(got).toEqual(["do the thing"]);
    c.end(); await s.close();
  });

  // Step 7: prompt must reply immediately, without waiting for the handler's promise to settle — a
  // turn runs for minutes, and holding the reply would stall this connection's every other op,
  // including the `interrupt` that ends the very turn it is waiting on.
  //
  // Sent as a SINGLE sock.write with both frames concatenated: the server's read loop runs per 'data'
  // event over a shared buffer. Two frames sent as two separate writes usually arrive as two chunks,
  // handled by two independent async invocations of the 'data' listener — under which a hung `await`
  // in the first invocation does NOT stall the second, and this "regression guard" would pass even
  // with the bug present. Sent as one chunk, the for-loop over the buffered lines runs the two ops
  // within the SAME invocation, so a blocking `await this.handlers.prompt(...)` there really would
  // stall the `status` reply behind it.
  it("prompt replies before its handler settles, even queued behind it in one chunk", async () => {
    const p = sockPath();
    // busy() is dispatch's own gate for `prompt` (the shared fixture default, `busy: () => false`, is
    // what lets this reach the never-resolving handler below) — a `busy()` true here would short-circuit
    // before ever calling it, which would make this "regression guard" pass for the wrong reason
    // (nothing ever hangs because nothing ever runs).
    const s = new HostServer(handlers({ prompt: () => new Promise(() => {}) }), p);  // never resolves
    await s.listen();
    const c = client(p); await c.ready;
    c.sendRaw(JSON.stringify({ id: 1, op: "prompt", text: "x" }) + "\n"
            + JSON.stringify({ id: 2, op: "status" }) + "\n");
    expect(await c.waitFor((f) => f.id === 2)).toMatchObject({ ok: true });
    c.end(); await s.close();
  });

  it("parses the A2b control ops", () => {
    for (const frame of [
      { op: "set_model", model: "claude-sonnet-4-6" }, { op: "set_model" },
      { op: "set_permission_mode", mode: "acceptEdits" },
      { op: "set_thinking", maxTokens: 8000 }, { op: "set_thinking", maxTokens: null },
      { op: "capabilities" }, { op: "compact" }, { op: "usage" }, { op: "context_usage" },
      { op: "mcp_status" }, { op: "mcp_reconnect", name: "linear" }, { op: "mcp_toggle", name: "linear", enabled: false },
      { op: "resume", sessionId: "a".repeat(8) },
    ]) expect(hostOp.safeParse(frame).success, JSON.stringify(frame)).toBe(true);
  });
  it("rejects malformed control ops", () => {
    for (const frame of [{ op: "set_permission_mode" }, { op: "set_thinking" }, { op: "mcp_reconnect" }, { op: "mcp_toggle", name: "x" }, { op: "resume" }])
      expect(hostOp.safeParse(frame).success).toBe(false);
  });

  // GB T4: tasks/background/stop_task dispatch. `tasks` reads the host's OWN snapshot and never fails
  // (it never touches the session); `background`/`stop_task` call through to the session and can be
  // "unsupported" when the session lacks the member.
  describe("bg-task ops (GB T4)", () => {
    it("tasks returns the host's snapshot", async () => {
      const p = sockPath();
      const tasks = [{ task_id: "t1", task_type: "bash", description: "x" }];
      const s = new HostServer(handlers({ tasks: () => tasks }), p);
      await s.listen();
      const c = client(p); await c.ready;
      c.send({ id: 1, op: "tasks" });
      expect(await c.waitFor((f) => f.id === 1)).toMatchObject({ ok: true, tasks });
      c.end(); await s.close();
    });

    it("background calls the session's backgroundAll and returns its boolean", async () => {
      const seen: (string | undefined)[] = [];
      const p = sockPath();
      const s = new HostServer(handlers({ background: async (toolUseId?: string) => { seen.push(toolUseId); return true; } }), p);
      await s.listen();
      const c = client(p); await c.ready;
      c.send({ id: 1, op: "background" });
      expect(await c.waitFor((f) => f.id === 1)).toMatchObject({ ok: true, backgrounded: true });
      expect(seen).toEqual([undefined]);
      c.end(); await s.close();
    });

    it("stop_task calls stopTask(taskId) and reports ok", async () => {
      const seen: string[] = [];
      const p = sockPath();
      const s = new HostServer(handlers({ stopTask: async (taskId: string) => { seen.push(taskId); } }), p);
      await s.listen();
      const c = client(p); await c.ready;
      c.send({ id: 1, op: "stop_task", taskId: "t1" });
      expect(await c.waitFor((f) => f.id === 1)).toMatchObject({ ok: true });
      expect(seen).toEqual(["t1"]);
      c.end(); await s.close();
    });

    it("background/stop_task reply unsupported when the session lacks the member — tasks never fails that way", async () => {
      const p = sockPath();
      const s = new HostServer(handlers({
        background: async () => { throw new Error("background unsupported by this host"); },
        stopTask: async () => { throw new Error("stop_task unsupported by this host"); },
      }), p);
      await s.listen();
      const c = client(p); await c.ready;
      c.send({ id: 1, op: "background" });
      expect(await c.waitFor((f) => f.id === 1)).toMatchObject({ ok: false, error: expect.stringContaining("unsupported") });
      c.send({ id: 2, op: "stop_task", taskId: "t1" });
      expect(await c.waitFor((f) => f.id === 2)).toMatchObject({ ok: false, error: expect.stringContaining("unsupported") });
      c.send({ id: 3, op: "tasks" });
      expect(await c.waitFor((f) => f.id === 3)).toMatchObject({ ok: true });
      c.end(); await s.close();
    });
  });
});

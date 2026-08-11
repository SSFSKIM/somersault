import { describe, it, expect, afterEach } from "vitest";
import { connect } from "node:net";
import { vi } from "vitest";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { hostSocketPath, isShortId } from "../../../src/fleet/paths.js";
import { TERMINAL } from "../../../src/fleet/roster.js";

// The harness self-test. Every fleet task (6–11) drives `startFakeHost`, so a defect here is a defect in
// every one of their suites — and, worse, an INVISIBLE one: a fake that replies where production stays
// silent, or replays in the wrong order, makes a broken client look green. Each case below pins one
// live-measured (P106, 2026-08-11) or code-cited property of the real host wire.

let fh: FakeHostControls | undefined;
afterEach(async () => { await fh?.close(); fh = undefined; });

/** A raw NDJSON peer. Keeps every line — replies AND `t:"event"` frames — in ARRIVAL ORDER in one array,
 *  because the properties under test here are orderings between the two kinds, which a reply-matching
 *  client would erase. */
function dial(path: string) {
  const s = connect({ path });
  s.on("error", () => { /* the fake tears sockets down under us on purpose (stop/close) */ });
  const frames: any[] = [];
  let buf = "";
  s.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { frames.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  return {
    frames,
    ready: new Promise<void>((r) => s.once("connect", () => r())),
    closed: new Promise<void>((r) => s.once("close", () => r())),
    send: (op: unknown) => { s.write(JSON.stringify(op) + "\n"); },
    until: (n: number) => vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(n), { timeout: 2000 }),
    close: () => s.destroy(),
  };
}

describe("fakeHost", () => {
  it("replays a follow in the host's order, and lands the whole burst BEFORE the follow reply", async () => {
    fh = await startFakeHost({ busy: true, status: { permissionMode: "plan" } });
    fh.emitMessage({ type: "assistant", n: 1 });
    fh.emitMessage({ type: "assistant", n: 2 });
    fh.park({ toolUseID: "tu-1", toolName: "Bash" });
    fh.emitTasksChanged([{ task_id: "bg-1" }]);
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow", id: 1 });
    await c.until(7);
    // host.ts's follow(): turn-start-if-busy → buffered messages (replay:true) → parked decisions →
    // task snapshot → state. The reply is LAST — P106 measured the burst ahead of it.
    expect(c.frames.map((f) => f.kind ?? "reply")).toEqual(["turn", "message", "message", "decision", "tasks_changed", "state", "reply"]);
    expect(c.frames[0]).toMatchObject({ t: "event", kind: "turn", phase: "start", seq: 1 });
    expect(c.frames[1]).toMatchObject({ kind: "message", data: { n: 1 }, replay: true });
    expect(c.frames[2]).toMatchObject({ kind: "message", data: { n: 2 }, replay: true });
    expect(c.frames[3]).toMatchObject({ kind: "decision", entry: { toolUseID: "tu-1", toolName: "Bash", kind: "permission" } });
    expect(c.frames[4]).toMatchObject({ kind: "tasks_changed", tasks: [{ task_id: "bg-1" }] });
    // a parked request projects as blocked/idle (host.ts status()), and the settings mirror rides both arms
    expect(c.frames[5]).toMatchObject({ kind: "state", status: { state: "blocked", status: "idle", waitingFor: "permission:Bash", permissionMode: "plan" } });
    expect(c.frames[6]).toEqual({ ok: true, following: true, id: 1 });
    c.close();
  });

  it("an IDLE follow replays no turn-start, and the buffered messages still travel", async () => {
    fh = await startFakeHost();
    fh.emitMessage({ type: "assistant", n: 1 });
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow" });
    await c.until(3);
    expect(c.frames.map((f) => f.kind ?? "reply")).toEqual(["message", "state", "reply"]);
    expect(c.frames[1]).toMatchObject({ kind: "state", status: { state: "working", status: "idle" } });
    c.close();
  });

  it("prompt records {text, uuid} and opens the turn BEFORE the reply carries its seq", async () => {
    fh = await startFakeHost();
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow" }); await c.until(2);
    c.send({ op: "prompt", text: "go", uuid: "u-1", id: 4 });
    await c.until(4);
    expect(fh.promptCalls).toEqual([{ text: "go", uuid: "u-1" }]);
    // runTask bumps the seq and emits `start` synchronously, before the server reads turnSeq() for the reply
    expect(c.frames[2]).toMatchObject({ kind: "turn", phase: "start", seq: 1 });
    expect(c.frames[3]).toEqual({ ok: true, accepted: true, seq: 1, id: 4 });
    // and the busy latch closed behind it: a second prompt is refused by the server's gate
    c.send({ op: "prompt", text: "again", id: 5 });
    await c.until(5);
    expect(c.frames[4]).toEqual({ ok: false, error: "busy", id: 5 });
    expect(fh.promptCalls).toHaveLength(1);
    c.close();
  });

  it("endTurn reproduces the turn-end pairing contract", async () => {
    fh = await startFakeHost();
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow" }); await c.until(2);
    fh.beginTurn(3);
    fh.endTurn(3, { error: "boom" });
    await c.until(4);
    expect(c.frames[3]).toEqual({ t: "event", kind: "turn", phase: "end", seq: 3, error: "boom" });
    // a RESOLVED-but-failed turn: result and failure travel together, and never with `error`
    fh.beginTurn(4);
    fh.endTurn(4, { result: { text: "done" }, failure: { message: "API Error" } });
    await c.until(6);
    expect(c.frames[5]).toEqual({ t: "event", kind: "turn", phase: "end", seq: 4, result: { text: "done" }, failure: { message: "API Error" } });
    // a clean end carries neither
    fh.beginTurn(5); fh.endTurn(5);
    await c.until(8);
    expect(c.frames[7]).toEqual({ t: "event", kind: "turn", phase: "end", seq: 5 });
    // the impossible pairing is refused at the control, not modelled onto the wire
    expect(() => fh!.endTurn(6, { error: "boom", result: {} })).toThrow(/error/);
    c.close();
  });

  it("answers with the three live-measured receipts", async () => {
    fh = await startFakeHost();
    fh.park({ toolUseID: "tu-1", toolName: "Bash" });               // a PERMISSION park
    const c = dial(fh.socketPath); await c.ready;
    // 1. wrong answer kind for the parked type — refused, and the park survives for a well-shaped answer
    c.send({ op: "answer", toolUseID: "tu-1", by: "alice", answer: { kind: "question_answer", answers: { q: "a" } }, id: 1 });
    await c.until(1);
    expect(c.frames[0]).toEqual({ ok: false, error: "kind mismatch: permission park cannot take question_answer", id: 1 });
    // 2. unknown park id
    c.send({ op: "answer", toolUseID: "nope", by: "alice", decision: "allow_once", id: 2 });
    await c.until(2);
    expect(c.frames[1]).toEqual({ ok: false, error: "no parked request nope", id: 2 });
    // 3. first answer wins; the loser is TOLD who got there first — {ok:true}, not a refusal
    c.send({ op: "answer", toolUseID: "tu-1", by: "alice", decision: "allow_once", id: 3 });
    await c.until(3);
    expect(c.frames[2]).toEqual({ ok: true, id: 3 });
    c.send({ op: "answer", toolUseID: "tu-1", by: "bob", decision: "allow_once", id: 4 });
    await c.until(4);
    expect(c.frames[3]).toEqual({ ok: true, alreadyAnsweredBy: "alice", id: 4 });
    c.close();
  });

  it("fans a settled decision out with the STRUCTURED outcome, then the state that follows it", async () => {
    fh = await startFakeHost();
    fh.park({ toolUseID: "tu-p", toolName: "ExitPlanMode", kind: "plan" });
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow" }); await c.until(3);                      // decision + state + reply
    fh.settle("tu-p", "carol", { kind: "plan_approve", mode: "acceptEdits", feedback: "ship it" });
    await c.until(5);
    expect(c.frames[3]).toEqual({ t: "event", kind: "decision_settled", toolUseID: "tu-p", by: "carol", decision: "plan_approve",
      answer: { kind: "plan_approve", mode: "acceptEdits", feedback: "ship it" } });
    // the park is gone, so status leaves `blocked`
    expect(c.frames[4]).toMatchObject({ kind: "state", status: { state: "working" } });
    // a settlement with no payload is the SYSTEM shape: a bare deny, no `answer` key
    fh.park({ toolUseID: "tu-2", toolName: "Bash" });
    fh.settle("tu-2", "system");
    await c.until(8);
    expect(c.frames[6]).toEqual({ t: "event", kind: "decision_settled", toolUseID: "tu-2", by: "system", decision: "deny" });
    c.close();
  });

  it("stop closes every socket WITHOUT a reply", async () => {
    fh = await startFakeHost();
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "stop", id: 9 });
    await c.closed;                                   // production tears the sockets down before answering
    expect(c.frames).toEqual([]);
    expect(fh.ops).toEqual(["stop"]);
  });

  it("close() ends the socket under a live client", async () => {
    fh = await startFakeHost();
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "follow" }); await c.until(2);
    await fh.close();
    await c.closed;
  });

  it("records every op it received, in order, with its arguments", async () => {
    fh = await startFakeHost();
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "status" }); await c.until(1);
    c.send({ op: "follow" }); await c.until(3);
    c.send({ op: "set_model", model: "opus" }); await c.until(5);   // + the `state` push the setter emits
    c.send({ op: "add_dir", path: "/w" }); await c.until(6);
    c.send({ op: "unfollow" }); await c.until(7);
    expect(fh.ops).toEqual(["status", "follow", "set_model", "add_dir", "unfollow"]);
    expect(fh.opCalls.find((o) => o.op === "add_dir")?.args).toEqual(["/w"]);
    // the mirror moved on the SETTER and reached the client on `state`, never on the reply
    expect(c.frames[3]).toMatchObject({ kind: "state", status: { model: "opus" } });
    expect(c.frames[4]).toMatchObject({ ok: true });
    c.close();
  });

  it("hands out a roster row that points at this host and reads live", async () => {
    fh = await startFakeHost({ cwd: "/w", name: "worker" });
    expect(isShortId(fh.row.short)).toBe(true);          // roster.ts refuses to write any other shape
    expect(hostSocketPath(fh.row.pid)).toBe(fh.socketPath);
    expect(TERMINAL.has(fh.row.state)).toBe(false);
    expect(fh.row).toMatchObject({ cwd: "/w", name: "worker", pid: process.pid });
    expect(fh.row.procStart).toBeUndefined();            // a procStart-less row reads live off a live pid
  });

  it("serves a control reply the test planted, and a real-shaped default otherwise", async () => {
    fh = await startFakeHost();
    fh.replies.usage = { ok: true, usage: { input_tokens: 7 } };
    const c = dial(fh.socketPath); await c.ready;
    c.send({ op: "usage" }); await c.until(1);
    expect(c.frames[0]).toMatchObject({ ok: true, usage: { input_tokens: 7 } });
    c.send({ op: "mcp_status" }); await c.until(2);
    expect(c.frames[1]).toMatchObject({ ok: true, servers: [] });
    c.close();
  });
});

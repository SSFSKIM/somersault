import { describe, it, expect, afterEach, vi } from "vitest";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { connectFleetEngine, FleetBusyError } from "../../../src/appserver/fleetEngine.js";
import type { FleetEngineSession } from "../../../src/appserver/fleetEngine.js";
import { ERR } from "../../../src/appserver/rpc.js";

// M3 Task 6. The SECOND EngineSession implementation, driven the only way it can be driven honestly: over
// a real socket to a real HostServer (test/helpers/fakeHost.ts). Every case below pins a property the
// fleet bridge (Tasks 7-11) builds on — the seq ledger, the activation barrier, the death latch, and the
// hard split between host-SYNTHESIZED frames (typed events) and SDK frames (the router).

let fh: FakeHostControls | undefined;
let eng: FleetEngineSession | undefined;
afterEach(async () => {
  await eng?.dispose().catch(() => {});   // a case that already killed the host owes no unfollow
  eng = undefined;
  await fh?.close();
  fh = undefined;
});

/** Every typed event stream in one place, plus `order` — the interleave across kinds, which is what the
 *  activation barrier is actually about. */
function taps(s: FleetEngineSession) {
  const t = {
    turns: [] as unknown[], decisions: [] as unknown[], settled: [] as unknown[], tasks: [] as unknown[][],
    states: [] as unknown[], rewound: [] as unknown[], deaths: 0, frames: [] as unknown[], order: [] as string[],
  };
  s.onTurn((e) => { t.turns.push(e); t.order.push("turn"); });
  s.onDecision((e) => { t.decisions.push(e); t.order.push("decision"); });
  s.onDecisionSettled((e) => { t.settled.push(e); t.order.push("settled"); });
  s.onTasksChanged((x) => { t.tasks.push(x); t.order.push("tasks"); });
  s.onState((x) => { t.states.push(x); t.order.push("state"); });
  s.onRewound((e) => { t.rewound.push(e); t.order.push("rewound"); });
  s.onSocketDeath(() => { t.deaths += 1; t.order.push("death"); });
  s.onFrame((m) => { t.frames.push(m); t.order.push("frame"); });
  return t;
}

/** Connect, tap, activate — the ordinary case. A test about the barrier itself does these by hand. */
async function live(controls: FakeHostControls) {
  const s = await connectFleetEngine(controls.socketPath);
  const t = taps(s);
  s.activate();
  return { s, t };
}

/** The fake has no truncated-buffer replay control (Task 5 recorded that as unmodelled), so a seq-less
 *  turn frame is driven through beginTurn/endTurn with NO seq at all: `JSON.stringify` drops the undefined
 *  key, which puts byte-for-byte the `{kind:"turn",phase:"start"}` marker of host.ts:524 on the wire. */
const seqless = (emit: (...args: never[]) => void): void => (emit as () => void)();

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 2000 });

describe("FleetEngineSession", () => {
  it("settles a submit on the seq-matched turn end and returns the END's result", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    const msgs: unknown[] = [];
    const p = s.submit("go", (m) => msgs.push(m), { uuid: "u-1" });
    await waitFor(() => expect(fh!.promptCalls).toEqual([{ text: "go", uuid: "u-1" }]));
    fh.emitMessage({ type: "assistant", n: 1 });
    fh.endTurn(1, { result: "done" });
    await expect(p).resolves.toEqual({ result: "done" });
    expect(msgs).toEqual([{ type: "assistant", n: 1 }]);
    // P106: no message frame ever carries a result — the turn-end is the only route (§1a-f), and it is
    // what the typed event carries too, so Task 7's turn/completed reads the same value submit returned.
    expect(t.turns).toEqual([{ phase: "start", seq: 1 }, { phase: "end", seq: 1, result: "done" }]);
  });

  it("reports a RESOLVED-but-failed turn as {result, error: TurnFailure}", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    const p = s.submit("go", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    fh.endTurn(1, { result: "partial", failure: { message: "API Error", terminalReason: "api_error" } });
    await expect(p).resolves.toEqual({ result: "partial", error: { message: "API Error", terminalReason: "api_error" } });
    expect(t.turns[1]).toEqual({ phase: "end", seq: 1, result: "partial", failure: { message: "API Error", terminalReason: "api_error" } });
  });

  it("REJECTS when the turn threw host-side (the wire's `error`, which travels alone)", async () => {
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    const p = s.submit("go", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    fh.endTurn(1, { error: "boom" });
    await expect(p).rejects.toThrow("boom");
    // the window closed with the rejection: a second submit is accepted, not refused as in-flight
    const p2 = s.submit("again", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(2));
    fh.endTurn(2, { result: "ok" });
    await expect(p2).resolves.toEqual({ result: "ok" });
  });

  it("settles a turn whose END was processed before the waiter existed (ends-before-waiter ledger)", async () => {
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    // The end reaches this client BEFORE the prompt reply that names its seq — the legitimate ordering
    // chatAdapter.ts:18-25 documents (runTask's continuation racing dispatch's). Emitted here between the
    // prompt op leaving (submit writes it synchronously) and the host reading it, so the end is on the
    // wire strictly ahead of the reply, and submit's continuation finds no live frame to wait for.
    const p = s.submit("go", () => {});
    fh.endTurn(1, { result: "early" });
    await expect(p).resolves.toEqual({ result: "early" });
    expect(fh.promptCalls).toHaveLength(1);
  });

  it("maps the host's busy refusal to a -33001-shaped throw, and releases the window", async () => {
    fh = await startFakeHost({ busy: true });         // a turn (anyone's) already in flight
    const { s } = await live(fh); eng = s;
    const err = await s.submit("go", () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FleetBusyError);
    expect((err as FleetBusyError).code).toBe(ERR.BUSY);
    expect(fh.promptCalls).toHaveLength(0);
    // the refusal is not a stuck turn: once the host's turn ends, this engine accepts a submit again
    fh.endTurn(1);
    const p = s.submit("go", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    fh.endTurn(2, { result: "ok" });
    await expect(p).resolves.toEqual({ result: "ok" });
  });

  it("ignores a seq-less turn START (a replay marker) and still reports the next real one", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    seqless(fh.beginTurn);
    fh.beginTurn(1);
    await waitFor(() => expect(t.turns).toHaveLength(1));
    expect(t.turns).toEqual([{ phase: "start", seq: 1 }]);   // the marker never became an event
  });

  it("ignores a seq-less turn END: it settles nothing, and the real end still does", async () => {
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    const p = s.submit("go", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    let settled = false; void p.then(() => { settled = true; });
    seqless(fh.endTurn);
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    fh.endTurn(1, { result: "real" });
    await expect(p).resolves.toEqual({ result: "real" });
  });

  it("feeds onMessage ONLY inside the submit's turn window", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    const msgs: unknown[] = [];
    fh.emitMessage({ type: "assistant", when: "before" });
    // Awaited, because the window's edges are PROCESSING order, not host clock: the sink opens when the
    // prompt op leaves (never later — the turn's own first frame can share a chunk with the reply, and
    // dropping it is worse than catching a straggler that was already in flight) and closes when the end
    // settles. This waits for the pre-turn frame to be through the router, which is the honest boundary.
    await waitFor(() => expect(t.frames).toHaveLength(1));
    const p = s.submit("go", (m) => msgs.push(m));
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    fh.emitMessage({ type: "assistant", when: "inside" });
    fh.endTurn(1, { result: "ok" });
    await p;
    fh.emitMessage({ type: "assistant", when: "after" });
    await new Promise((r) => setTimeout(r, 20));
    expect(msgs).toEqual([{ type: "assistant", when: "inside" }]);
  });

  it("routes message and task frames to onFrame — and NO host-synthesized frame", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    fh.emitMessage({ type: "assistant", n: 1 });
    fh.emitTask({ type: "task_started", task_id: "bg-1" });
    fh.park({ toolUseID: "tu-1", toolName: "Bash" });   // decision + state
    fh.beginTurn(1); fh.endTurn(1);
    fh.emitTasksChanged([{ task_id: "bg-1", task_type: "t", description: "d" }]);
    fh.emitRewound({ sessionId: "s-2" });
    await waitFor(() => expect(t.rewound).toHaveLength(1));
    expect(t.frames).toEqual([{ type: "assistant", n: 1 }, { type: "task_started", task_id: "bg-1" }]);
    // …and every one of those synthesized frames DID reach its typed event instead
    expect(t.decisions).toEqual([expect.objectContaining({ toolUseID: "tu-1", toolName: "Bash", kind: "permission" })]);
    expect(t.turns).toHaveLength(2);
    expect(t.tasks).toEqual([[{ task_id: "bg-1", task_type: "t", description: "d" }]]);
    expect(t.states.length).toBeGreaterThan(0);
  });

  it("interrupt sends the op", async () => {
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    await s.interrupt();
    expect(fh.ops).toContain("interrupt");
  });

  it("dispose unfollows and closes — NEVER stop, and it is not a death", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    await s.dispose();
    eng = undefined;                                   // disposed; afterEach must not dispose twice
    expect(fh.ops).toContain("unfollow");
    // close is not stop (spec §1f): the host, its turn and its parks outlive this client
    expect(fh.ops).not.toContain("stop");
    await waitFor(() => expect(s.isEnded()).toBe(true));
    expect(t.deaths).toBe(0);                          // a death we asked for is not a connection loss
  });

  it("a dead host latches isEnded, fires onSocketDeath once, and settles the in-flight submit", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    const p = s.submit("go", () => {});
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    await fh.close();                                  // host death
    await expect(p).rejects.toThrow();
    await waitFor(() => expect(t.deaths).toBe(1));
    expect(s.isEnded()).toBe(true);
    await expect(s.usage!()).rejects.toThrow();        // every later call answers, none parks
    eng = undefined;
  });

  it("expectDeath() suppresses the death sequence but still latches isEnded", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    s.expectDeath();                                   // the thread/stop pre-latch (Task 9)
    await fh.close();
    await waitFor(() => expect(s.isEnded()).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(t.deaths).toBe(0);
    eng = undefined;
  });

  it("BUFFERS every event until activate(), then delivers them in arrival order", async () => {
    fh = await startFakeHost({ busy: true });
    fh.emitMessage({ type: "assistant", n: 1 });
    fh.park({ toolUseID: "tu-1", toolName: "Bash" });
    const s = await connectFleetEngine(fh.socketPath); eng = s;
    // the whole follow replay has already arrived (the burst precedes the follow reply, P106) — and not
    // one frame of it has been delivered, because the listeners below did not exist when it landed
    const t = taps(s);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.order).toEqual([]);
    s.activate();
    // host.ts's replay order, preserved across the barrier: turn-start → buffered messages → parked
    // decisions → state
    expect(t.order).toEqual(["turn", "frame", "decision", "state"]);
    expect(t.turns).toEqual([{ phase: "start", seq: 1 }]);
    expect(t.frames).toEqual([{ type: "assistant", n: 1 }]);
    expect(t.decisions).toEqual([expect.objectContaining({ toolUseID: "tu-1" })]);
    // and live events flow straight through afterwards
    fh.emitTasksChanged([]);
    await waitFor(() => expect(t.tasks).toEqual([[]]));
  });

  it("buffers a death that lands before activate() rather than dropping it", async () => {
    fh = await startFakeHost();
    const s = await connectFleetEngine(fh.socketPath); eng = s;
    const t = taps(s);
    await fh.close();
    await waitFor(() => expect(s.isEnded()).toBe(true));
    expect(t.deaths).toBe(0);
    s.activate();
    expect(t.deaths).toBe(1);
    eng = undefined;
  });

  it("mirrors state: sessionId latches, and a cleared rewind forgets it", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    fh.setStatus({ sessionId: "s-1", model: "opus", permissionMode: "plan" });
    await waitFor(() => expect(s.sessionId).toBe("s-1"));
    expect(t.states.at(-1)).toMatchObject({ sessionId: "s-1", model: "opus", permissionMode: "plan" });
    fh.emitRewound({ cleared: true });
    await waitFor(() => expect(t.rewound).toEqual([{ cleared: true }]));
    expect(s.sessionId).toBeUndefined();               // the discarded conversation's id must not survive
  });

  it("fans a settled decision out with the structured answer (§1a-e)", async () => {
    fh = await startFakeHost();
    const { s, t } = await live(fh); eng = s;
    fh.park({ toolUseID: "tu-p", toolName: "ExitPlanMode", kind: "plan" });
    await waitFor(() => expect(t.decisions).toHaveLength(1));
    fh.settle("tu-p", "carol", { kind: "plan_approve", mode: "acceptEdits" });
    await waitFor(() => expect(t.settled).toHaveLength(1));
    expect(t.settled[0]).toEqual({ toolUseID: "tu-p", by: "carol", decision: "plan_approve", answer: { kind: "plan_approve", mode: "acceptEdits" } });
  });

  it("answer() forwards the outcome and returns the host's receipt verbatim", async () => {
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    fh.park({ toolUseID: "tu-1", toolName: "Bash" });
    await expect(s.answer("tu-1", { kind: "deny", feedback: "no" })).resolves.toMatchObject({ ok: true });
    // the whole outcome travelled, not the kind alone
    expect(fh.opCalls.find((o) => o.op === "answer")?.args[1]).toEqual({ kind: "deny", feedback: "no" });
    // a lost race is a RECEIPT, not a refusal — Task 8 maps it to -33002 (never orFail'd here)
    await expect(s.answer("tu-1", { kind: "allow_once" })).resolves.toMatchObject({ ok: true, alreadyAnsweredBy: expect.any(String) });
  });

  it("forwards the optional members onto host ops and maps their payloads", async () => {
    fh = await startFakeHost();
    fh.replies.usage = { ok: true, usage: { input_tokens: 7 } };
    fh.replies.capabilities = { ok: true, models: [{ id: "m" }], commands: ["/x"], mcpServers: [], agents: [{ name: "a" }] };
    fh.replies.get_settings = { allowedTools: ["Bash"] };
    const { s } = await live(fh); eng = s;
    expect(await s.usage!()).toEqual({ input_tokens: 7 });
    // four catalogs — `agents` included (§1a-d), or fleet capabilities/read would silently lose subagents
    expect(await s.capabilities!()).toEqual({ models: [{ id: "m" }], commands: ["/x"], mcpServers: [], agents: [{ name: "a" }] });
    expect(await s.getSettings!()).toEqual({ allowedTools: ["Bash"] });
    expect(await s.listBackgroundTasks!()).toEqual([]);
    await s.setPermissionMode!("plan");
    await s.setModel!("opus");
    await s.setMaxThinkingTokens!(1024);
    await s.stopTask!("bg-1");
    await s.toggleMcpServer!("srv", false);
    expect(fh.opCalls.find((o) => o.op === "set_permission_mode")?.args[0]).toMatchObject({ mode: "plan" });
    expect(fh.opCalls.find((o) => o.op === "set_model")?.args[0]).toMatchObject({ model: "opus" });
    expect(fh.opCalls.find((o) => o.op === "set_thinking")?.args[0]).toMatchObject({ maxTokens: 1024 });
    expect(fh.opCalls.find((o) => o.op === "stop_task")?.args).toEqual(["bg-1"]);
    expect(fh.opCalls.find((o) => o.op === "mcp_toggle")?.args[0]).toMatchObject({ name: "srv", enabled: false });
  });

  it("throws the host's own message when a forwarded op is refused", async () => {
    fh = await startFakeHost();
    fh.replies.mcp_reconnect = { ok: false, error: "SDK servers should be handled in print.ts" };
    const { s } = await live(fh); eng = s;
    await expect(s.reconnectMcpServer!("srv")).rejects.toThrow("SDK servers should be handled in print.ts");
  });

  it("sendOp is the raw escape the forwarded-op handlers (Tasks 9-11) ride", async () => {
    fh = await startFakeHost();
    fh.replies.rewind_anchors = [{ uuid: "u-1" }];
    const { s } = await live(fh); eng = s;
    await expect(s.sendOp({ op: "rewind_anchors" })).resolves.toMatchObject({ ok: true, anchors: [{ uuid: "u-1" }] });
    await s.sendOp({ op: "add_dir", path: "/w" });
    expect(fh.opCalls.find((o) => o.op === "add_dir")?.args).toEqual(["/w"]);
  });
});

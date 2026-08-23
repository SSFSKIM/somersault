import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeHost } from "../../helpers/fakeHost.js";
import type { FakeHostControls } from "../../helpers/fakeHost.js";
import { encodeEvent, decodeFrame } from "../../../src/host/wire.js";
import type { HostEvent } from "../../../src/host/wire.js";
import { connectFleetEngine, FleetBusyError } from "../../../src/appserver/fleetEngine.js";
import type { FleetEngineSession } from "../../../src/appserver/fleetEngine.js";
import { IMAGE_VERSION_SKEW_NOTICE } from "../../../src/client/stagedSubmit.js";
import type { UserContentBlock } from "../../../src/session/turnInput.js";
import { ERR } from "../../../src/appserver/rpc.js";

// M3 Task 6. The SECOND EngineSession implementation, driven the only way it can be driven honestly: over
// a real socket to a real HostServer (test/helpers/fakeHost.ts). Every case below pins a property the
// fleet bridge (Tasks 7-11) builds on — the seq ledger, the activation barrier, the death latch, and the
// hard split between host-SYNTHESIZED frames (typed events) and SDK frames (the router).

let fh: FakeHostControls | undefined;
let sh: StagingHost | undefined;
let eng: FleetEngineSession | undefined;
afterEach(async () => {
  await eng?.dispose().catch(() => {});   // a case that already killed the host owes no unfollow
  eng = undefined;
  await fh?.close();
  fh = undefined;
  await sh?.close();
  sh = undefined;
});

/** Every typed event stream in one place, plus `order` — the interleave across kinds, which is what the
 *  activation barrier is actually about. */
function taps(s: FleetEngineSession) {
  const t = {
    turns: [] as unknown[], decisions: [] as unknown[], settled: [] as unknown[], tasks: [] as unknown[][],
    states: [] as unknown[], rewound: [] as unknown[], deaths: 0, frames: [] as unknown[], order: [] as string[],
    // The envelope's replay mark, per frame and positionally aligned with `frames` — history is not news
    // (wire.ts:16-19), and the frame itself must stay byte-for-byte what the SDK produced.
    replays: [] as (true | undefined)[],
  };
  s.onTurn((e) => { t.turns.push(e); t.order.push("turn"); });
  s.onDecision((e) => { t.decisions.push(e); t.order.push("decision"); });
  s.onDecisionSettled((e) => { t.settled.push(e); t.order.push("settled"); });
  s.onTasksChanged((x) => { t.tasks.push(x); t.order.push("tasks"); });
  s.onState((x) => { t.states.push(x); t.order.push("state"); });
  s.onRewound((e) => { t.rewound.push(e); t.order.push("rewound"); });
  s.onSocketDeath(() => { t.deaths += 1; t.order.push("death"); });
  s.onFrame((m, replay) => { t.frames.push(m); t.replays.push(replay); t.order.push("frame"); });
  return t;
}

/** The ONE frame the fake host cannot put on the wire: a mid-turn replay start carrying `truncated`
 *  (host.ts:607 — the flag rides the SEQ-BEARING frame; only the idle marker at :610 is seq-less). Task 5
 *  recorded the truncated buffer as unmodelled and `fakeHost.ts` is out of scope for this fix, so this one
 *  case speaks the wire by hand — through the SHARED codec (`encodeEvent`), so it cannot drift on what a
 *  frame is — and answers every correlated op `{ok:true}` so `follow`/`unfollow` complete. */
async function startRawHost(): Promise<{ socketPath: string; emit(ev: HostEvent): void; writeRaw(buf: Buffer): void; close(): Promise<void> }> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "fleet-raw-")), "h.sock");
  let peer: Socket | undefined;
  const srv = createServer((s) => {
    peer = s;
    s.on("error", () => {});
    s.on("data", (c) => {
      for (const line of c.toString("utf8").split("\n")) {
        const id = (decodeFrame(line) as { id?: number } | undefined)?.id;
        if (typeof id === "number") s.write(JSON.stringify({ ok: true, id }) + "\n");
      }
    });
  });
  await new Promise<void>((r) => srv.listen(socketPath, () => r()));
  return {
    socketPath,
    emit: (ev) => { peer?.write(encodeEvent(ev)); },
    // Raw bytes, so a test can split one encoded frame across two writes at a chosen byte offset — the only
    // way to put a multibyte char astride a socket-chunk boundary (F1); `emit` always writes a whole frame.
    writeRaw: (buf) => { peer?.write(buf); },
    close: () => new Promise<void>((r) => { peer?.destroy(); srv.close(() => r()); }),
  };
}

type PromptReply = "ok" | "busy" | "die";
interface StagingHost {
  socketPath: string;
  /** Every op name dispatched, in order — `follow` included, so a row can pin that staging happened
   *  BEFORE the prompt rather than merely that both arrived. */
  ops: string[];
  /** Every path this host minted, in order, whether or not the client ever wrote to it. */
  staged: string[];
  /** Every `prompt` frame exactly as it came off the wire, `id` and all: the only honest place to assert
   *  that a string prompt carries NO `images` key at all. */
  prompts: Array<Record<string, unknown>>;
  promptReply(mode: PromptReply): void;
  /** Answer the one `stageImage` reply `holdStage` withheld. */
  release(): void;
  close(): Promise<void>;
}

/** A raw host that mints a REAL file per staged image (spec rev 3, "fleet threads"). `fakeHost.ts` answers
 *  `stageImage` with ONE fixed stub path — enough for the dispatch wiring it was written for, but it can
 *  show neither a per-image claim, nor the cleanup of a SPECIFIC file, nor a refusal that lands mid-loop
 *  after an earlier image already staged. So this speaks the wire by hand (the shape `startRawHost` above
 *  uses), answering every other op `{ok:true}` so `follow`/`unfollow` still complete. */
async function startStagingHost(opts: { stageErrorAt?: { at: number; error: string }; holdStage?: true; prompt?: PromptReply } = {}): Promise<StagingHost> {
  const dir = mkdtempSync(join(tmpdir(), "fleet-stage-"));
  const socketPath = join(dir, "h.sock");
  const ops: string[] = [];
  const staged: string[] = [];
  const prompts: Array<Record<string, unknown>> = [];
  let mode: PromptReply = opts.prompt ?? "ok";
  let held: { id: number; path: string } | undefined;
  let peer: Socket | undefined;
  const reply = (id: number, body: Record<string, unknown>): void => { peer?.write(JSON.stringify({ ...body, id }) + "\n"); };
  const srv = createServer((sock) => {
    peer = sock;
    sock.on("error", () => {});
    sock.on("data", (c) => {
      for (const line of c.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const f = decodeFrame(line) as (Record<string, unknown> & { id?: number; op?: string }) | undefined;
        if (!f || typeof f.id !== "number" || typeof f.op !== "string") continue;
        ops.push(f.op);
        if (f.op === "stageImage") {
          const n = ops.filter((o) => o === "stageImage").length;
          if (opts.stageErrorAt?.at === n) { reply(f.id, { ok: false, error: opts.stageErrorAt.error }); continue; }
          const path = join(dir, `img-${n}.png`);
          staged.push(path);
          // Withheld, not slow: the reply is written only by `release()`, which pins the first submit
          // inside its very first await for as long as the reservation row needs it there.
          if (opts.holdStage && n === 1) { held = { id: f.id, path }; continue; }
          reply(f.id, { ok: true, path });
          continue;
        }
        if (f.op === "prompt") {
          prompts.push(f);
          if (mode === "die") { sock.destroy(); continue; }
          if (mode === "busy") { reply(f.id, { ok: false, error: "busy" }); continue; }
          reply(f.id, { ok: true, accepted: true, seq: 1 });
          // The end rides right behind its own reply — the seq ledger's own case (header property 1) — so
          // a row about staging never has to drive the turn lifecycle by hand.
          peer?.write(encodeEvent({ kind: "turn", phase: "end", seq: 1, result: "done" }));
          continue;
        }
        reply(f.id, { ok: true });
      }
    });
  });
  await new Promise<void>((r) => srv.listen(socketPath, () => r()));
  return {
    socketPath, ops, staged, prompts,
    promptReply: (m) => { mode = m; },
    release: () => { if (held) { reply(held.id, { ok: true, path: held.path }); held = undefined; } },
    close: () => new Promise<void>((r) => { peer?.destroy(); srv.close(() => { rmSync(dir, { recursive: true, force: true }); r(); }); }),
  };
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

  it("QUARANTINES a foreign turn's frames while a busy refusal is in flight, and never accepts a seq", async () => {
    // The host is busy precisely BECAUSE a foreign turn is streaming, so its frames are what a refused
    // submit's round trip is full of. They must not reach this caller's onMessage: turns.ts feeds that
    // sink into the item mapper under the caller's OWN turnId, so one leaked frame publishes items for a
    // turn that never started. Emitted synchronously after submit writes its op, hence strictly ahead of
    // the refusal reply on the wire — the ordering the ends-before-waiter case uses.
    fh = await startFakeHost({ busy: true });
    const { s } = await live(fh); eng = s;
    const msgs: unknown[] = [];
    const accepted: number[] = [];
    const p = s.submit("go", (m) => msgs.push(m), { onAccepted: (n) => accepted.push(n) });
    fh.emitMessage({ type: "assistant", whose: "foreign" });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FleetBusyError);
    await new Promise((r) => setTimeout(r, 20));
    expect(msgs).toEqual([]);
    expect(accepted).toEqual([]);   // no seq was resolved, so Task 7 has no turn to own
  });

  it("does not leak a FOREIGN turn-end into the ends ledger on a busy refusal (F5)", async () => {
    // The busy window is full of a foreign turn's frames (that turn is why the host is busy). If that foreign
    // turn ENDS during the submit's round trip, settle() ledgers its end into `ends` — keyed by a seq this
    // engine never submitted and that no future own submit will ever consume, so `ends` grows unbounded
    // under repeated multi-client busy races. A busy refusal accepted no seq of our own, so any end recorded
    // in that window is foreign and must be discarded. The fake's `endTurn` flips its host-side busy flag,
    // which would let the prompt be accepted rather than refused, so this drives the exact frame ORDER by
    // hand over a raw peer (through the SHARED codec): the foreign end lands strictly BEFORE the busy reply.
    const socketPath = join(mkdtempSync(join(tmpdir(), "fleet-f5-")), "h.sock");
    let peer: Socket | undefined;
    const srv = createServer((sock) => {
      peer = sock;
      sock.on("error", () => {});
      sock.on("data", (c) => {
        for (const line of c.toString("utf8").split("\n")) {
          if (!line.trim()) continue;
          const f = decodeFrame(line) as { id?: number; op?: string } | undefined;
          if (!f || typeof f.id !== "number") continue;
          if (f.op === "prompt") {
            peer!.write(encodeEvent({ kind: "turn", phase: "end", seq: 99, result: "foreign" })); // foreign end, mid-round-trip
            peer!.write(JSON.stringify({ ok: false, error: "busy", id: f.id }) + "\n");            // then the busy refusal
          } else {
            peer!.write(JSON.stringify({ ok: true, id: f.id }) + "\n");                            // follow, etc.
          }
        }
      });
    });
    await new Promise<void>((r) => srv.listen(socketPath, () => r()));
    try {
      const s = await connectFleetEngine(socketPath); eng = s;
      const ledger = (s as unknown as { ends: Map<number, unknown> }).ends;
      s.activate();
      await expect(s.submit("go", () => {})).rejects.toBeInstanceOf(FleetBusyError);
      await new Promise((r) => setTimeout(r, 20));
      expect(ledger.size).toBe(0);                    // the foreign end was discarded, not retained
    } finally {
      await eng?.dispose().catch(() => {}); eng = undefined;
      peer?.destroy(); await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("FLUSHES a straggler that arrived before the prompt reply — after onAccepted, ahead of live frames", async () => {
    // The other half of the quarantine: our own turn's first frame can be on the wire before the reply
    // that names its seq (the host emits it inside the prompt handler), so holding pre-reply frames must
    // DELAY them, never drop them. onAccepted lands first — Task 7 has to know which turn it owns before
    // the first item of that turn reaches it.
    fh = await startFakeHost();
    const { s } = await live(fh); eng = s;
    const order: string[] = [];
    const p = s.submit("go", (m) => order.push(`msg:${(m as { n: string }).n}`), { onAccepted: (n) => order.push(`accepted:${n}`) });
    fh.emitMessage({ n: "straggler" });
    await waitFor(() => expect(fh!.promptCalls).toHaveLength(1));
    fh.emitMessage({ n: "live" });
    fh.endTurn(1, { result: "ok" });
    await expect(p).resolves.toEqual({ result: "ok" });
    expect(order).toEqual(["accepted:1", "msg:straggler", "msg:live"]);
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

  it("carries `truncated` through on a seq-bearing turn frame — and still drops the seq-less marker", async () => {
    // `truncated` is the real "this replay is partial" signal, and at HEAD it rides a frame that DOES name
    // its turn (host.ts:607); only the idle notice (:610) is seq-less. Dropping the flag would leave Task 7
    // announcing a partial turn as a whole one.
    const raw = await startRawHost();
    try {
      const s = await connectFleetEngine(raw.socketPath); eng = s;
      const t = taps(s);
      s.activate();
      raw.emit({ kind: "turn", phase: "start", seq: 7, truncated: true });
      raw.emit({ kind: "turn", phase: "start", truncated: true });   // the idle marker: names no turn, still dropped
      await waitFor(() => expect(t.turns).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(t.turns).toEqual([{ phase: "start", seq: 7, truncated: true }]);
    } finally {
      await eng?.dispose().catch(() => {}); eng = undefined;
      await raw.close();
    }
  });

  it("reassembles a multibyte char split across socket chunks (F1)", async () => {
    // The wire is UTF-8 and the socket chunks it at arbitrary BYTE offsets, so a non-ASCII char can straddle
    // a chunk boundary. Decoding each chunk independently (`chunk.toString("utf8")`) turns the split char
    // into replacement chars before the newline-level line buffer ever sees it. The fake host writes whole
    // frames in one write, so this never fired in the other cases — hence the raw peer, splitting one
    // encoded frame mid-codepoint by hand through the SHARED codec.
    const raw = await startRawHost();
    try {
      const s = await connectFleetEngine(raw.socketPath); eng = s;
      const t = taps(s);
      s.activate();
      const buf = Buffer.from(encodeEvent({ kind: "message", data: { text: "가나다😀" } }), "utf8");
      // Land the split ONE byte into "가" (a 3-byte sequence) — the boundary falls inside the codepoint.
      const splitAt = buf.indexOf(Buffer.from("가", "utf8")) + 1;
      raw.writeRaw(buf.subarray(0, splitAt));
      await new Promise((r) => setTimeout(r, 15));
      raw.writeRaw(buf.subarray(splitAt));
      await waitFor(() => expect(t.frames).toHaveLength(1));
      expect(t.frames[0]).toEqual({ text: "가나다😀" });   // intact, not replacement chars
    } finally {
      await eng?.dispose().catch(() => {}); eng = undefined;
      await raw.close();
    }
  });

  it("keeps the host's `replay` mark on a replayed frame, and the frame itself untouched", async () => {
    // Replay honesty is a wire contract here (wire.ts:16-19: a joiner that clocks buffered history
    // fabricates durations for work that finished before it connected). The mark travels BESIDE the frame,
    // never on it — the router must never be handed a frame the SDK never produced.
    fh = await startFakeHost();
    fh.emitMessage({ type: "assistant", n: 1 });        // into the turn buffer: follow replays it marked
    const s = await connectFleetEngine(fh.socketPath); eng = s;
    const t = taps(s);
    s.activate();
    fh.emitMessage({ type: "assistant", n: 2 });        // live: no mark
    await waitFor(() => expect(t.frames).toHaveLength(2));
    expect(t.frames).toEqual([{ type: "assistant", n: 1 }, { type: "assistant", n: 2 }]);
    expect(t.replays).toEqual([true, undefined]);
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

  // Task 2 (spec rev 3, "fleet threads"): `submit` takes the whole `UserTurnInput` union, and an array
  // reaches the host the only way the host wire can carry an image — staged to disk through the SHARED
  // helper (`client/stagedSubmit.ts`), then claimed by path on the `prompt` op. What these rows pin is
  // OWNERSHIP: staged bytes belong to this client until the host accepts the prompt, so every path that
  // is not an accepted prompt has to take its files back with it.
  describe("submit with an image block array", () => {
    // Header-only PNG (the fixture `client-chat-adapter.test.ts` uses): `pngDimensions` never reads past
    // byte 24, so this is the cheapest buffer that sniffs as a real image.
    const fakePng = (width: number, height: number, totalBytes = 64): Buffer => {
      const buf = Buffer.alloc(Math.max(totalBytes, 24));
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
      buf.write("IHDR", 12, "ascii");
      buf.writeUInt32BE(width, 16);
      buf.writeUInt32BE(height, 20);
      return buf;
    };
    const imageBlock = (buf: Buffer): UserContentBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data: buf.toString("base64") } });
    const sha = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");
    /** The frame minus its correlation id — everything the op itself put on the wire, and nothing else. */
    const frameOf = (f: Record<string, unknown>): Record<string, unknown> => { const { id: _id, ...rest } = f; return rest; };
    const liveRaw = async (socketPath: string): Promise<FleetEngineSession> => { const s = await connectFleetEngine(socketPath); eng = s; s.activate(); return s; };

    it("stages each image, then claims it by path on the prompt op beside the folded text", async () => {
      sh = await startStagingHost();
      const s = await liveRaw(sh.socketPath);
      const png = fakePng(4, 4);
      const p = s.submit([{ type: "text", text: "A" }, imageBlock(png), { type: "text", text: "B" }], () => {}, { uuid: "u-1" });
      await expect(p).resolves.toEqual({ result: "done" });
      expect(sh.ops).toEqual(["follow", "stageImage", "prompt"]);         // staged BEFORE the prompt, never beside it
      expect(frameOf(sh.prompts[0])).toEqual({ op: "prompt", text: "AB", images: [{ stagedId: sh.staged[0], sha256: sha(png) }], uuid: "u-1" });
      expect(readFileSync(sh.staged[0]).equals(png)).toBe(true);          // the decoded bytes, not the base64
      // An ACCEPTED prompt transfers ownership to the host: `cleanup` is dropped uncalled, so the file the
      // host is about to read is still on disk.
      expect(existsSync(sh.staged[0])).toBe(true);
    });

    it("refuses an 'unknown op' stage reply as version skew — no prompt, and the images already staged go with it", async () => {
      sh = await startStagingHost({ stageErrorAt: { at: 2, error: "unknown op" } });
      const s = await liveRaw(sh.socketPath);
      await expect(s.submit([imageBlock(fakePng(4, 4)), imageBlock(fakePng(8, 8))], () => {})).rejects.toThrow(IMAGE_VERSION_SKEW_NOTICE);
      expect(sh.ops).not.toContain("prompt");                             // an old host is told nothing it cannot parse
      expect(sh.staged).toHaveLength(1);                                  // the second call was refused before it minted
      expect(existsSync(sh.staged[0])).toBe(false);                       // …and the FIRST image's file went with the refusal
    });

    it("cleans the staged files on a busy refusal, and releases the reservation with them", async () => {
      sh = await startStagingHost({ prompt: "busy" });
      const s = await liveRaw(sh.socketPath);
      await expect(s.submit([imageBlock(fakePng(4, 4))], () => {})).rejects.toBeInstanceOf(FleetBusyError);
      expect(sh.staged).toHaveLength(1);                                  // it really did stage before the refusal
      expect(existsSync(sh.staged[0])).toBe(false);                       // ownership never transferred — the host refused
      // A refusal is not a wedged engine: the reservation cleared with the failure, so the next submit goes.
      sh.promptReply("ok");
      await expect(s.submit("go", () => {})).resolves.toEqual({ result: "done" });
    });

    it("LEAVES the staged files when the connection dies across the prompt op — an indeterminate ack is not a refusal", async () => {
      // THE THIRD OWNERSHIP CASE (whole-branch review P2). A rejection from the prompt op says only that
      // no reply came back — not that no prompt arrived. The host's `runTask` survives a client
      // disconnect and reads the claimed files lazily as the turn runs, so unlinking on this path makes
      // every later image of a turn the host DID accept degrade as missing. The files stay; if the prompt
      // truly never landed, the host's own orphan sweep takes them.
      sh = await startStagingHost({ prompt: "die" });
      const s = await liveRaw(sh.socketPath);
      await expect(s.submit([imageBlock(fakePng(4, 4))], () => {})).rejects.toThrow(/closed/);
      expect(sh.staged).toHaveLength(1);                                  // it really did stage before the death
      expect(existsSync(sh.staged[0])).toBe(true);                        // …and the bytes are still there for it
      eng = undefined;                                                    // the socket is gone; no unfollow to send
    });

    it("takes the one-in-flight reservation SYNCHRONOUSLY — a second array submit never stages a byte", async () => {
      sh = await startStagingHost({ holdStage: true });
      const s = await liveRaw(sh.socketPath);
      const png = fakePng(4, 4);
      const first = s.submit([imageBlock(png)], () => {});
      // Same tick, so the first submit is still inside its very first await. The pre-Task-2 guard read
      // `turnSink || waiter` — both set only AFTER staging — so two array submits both passed it, both
      // staged, and the second clobbered the first's sink.
      const second = s.submit([imageBlock(png)], () => {});
      await expect(second).rejects.toThrow(/already in flight/);
      await waitFor(() => expect(sh!.ops.filter((o) => o === "stageImage")).toHaveLength(1));   // the FIRST one's
      await new Promise((r) => setTimeout(r, 20));                                              // and no second follows it
      expect(sh.ops.filter((o) => o === "stageImage")).toHaveLength(1);
      sh.release();
      await expect(first).resolves.toEqual({ result: "done" });
    });

    it("an interrupt landing DURING the staging round trip stops the turn: no prompt reaches the host, and the staged bytes go back", async () => {
      // THE STAGING WINDOW (Task 2 review). Staging is one or more host round trips, and an interrupt
      // that lands inside it reaches the HOST FIRST — where it cancels nothing, or cancels a FOREIGN
      // turn — and our prompt then starts a turn the client already stopped, while turns.ts reports it
      // interrupted. `opts.aborted` is the caller's own latch, read on the far side of that window.
      sh = await startStagingHost({ holdStage: true });
      const s = await liveRaw(sh.socketPath);
      let stop: string | undefined;
      const p = s.submit([imageBlock(fakePng(4, 4))], () => {}, { aborted: () => stop });
      await waitFor(() => expect(sh!.staged).toHaveLength(1));      // the stage op is out and its reply is held
      stop = "Turn interrupted before it started";                  // …the interrupt lands right here
      sh.release();
      // Rejected with the code the turns spine answers -33001 with, so an interrupted-before-it-started
      // fleet turn reads identically whichever side of the staging window the latch went up on.
      await expect(p).rejects.toBeInstanceOf(FleetBusyError);
      await expect(p).rejects.toThrow("Turn interrupted before it started");
      expect(sh.ops).not.toContain("prompt");
      expect(existsSync(sh.staged[0])).toBe(false);                 // ownership never transferred — nothing to sweep
      // and the reservation cleared with it: the engine is not wedged by a turn that never started.
      await expect(s.submit("go", () => {})).resolves.toEqual({ result: "done" });
    });

    it("leaves a plain-string submit byte-identical on the wire — no `images` key at all", async () => {
      sh = await startStagingHost();
      const s = await liveRaw(sh.socketPath);
      await expect(s.submit("go", () => {})).resolves.toEqual({ result: "done" });
      expect(sh.ops).toEqual(["follow", "prompt"]);
      expect(frameOf(sh.prompts[0])).toEqual({ op: "prompt", text: "go" });
    });
  });
});

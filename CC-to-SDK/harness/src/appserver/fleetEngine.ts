// appserver/fleetEngine.ts — the SECOND implementation of `EngineSession` (registry.ts), and the only one
// that does not own its engine: a fleet thread's engine belongs to a RUNNING ccx host (one process per
// session, `src/cli/spawn.ts`), reached over that host's unix socket and its 34-op NDJSON wire
// (`src/host/server.ts`). Spec: M3 §1b.
//
// Four properties are the whole reason this is a module rather than an adapter:
//
//  1. THE SEQ LEDGER. A turn is settled by the host's `{kind:"turn", phase:"end", seq}` event, not by the
//     prompt reply — and that end can be PROCESSED before submit's continuation installs its waiter (the
//     reply and the end can land in one data chunk, whose frames are routed synchronously while the
//     reply's `await` continuation is still queued; chatAdapter.ts:18-25 documents the same race). Ends
//     seen inside an open submit window with no waiter yet are ledgered and consumed on match. Only
//     inside that window: a FOREIGN turn's end has no waiter coming, and ledgering those on a bridge that
//     watches a host for days is a growing map of results nobody will ever read.
//  2. THE ACTIVATION BARRIER. `follow` replays synchronously — turn-start, buffered messages, parked
//     decisions, task snapshot, state, all BEFORE the follow reply (P106) — so every event is queued
//     until `activate()`. Task 7 installs its listeners and publishes the record first, then activates,
//     and no replayed frame is lost or broadcast ahead of `thread/started`.
//  3. HOST-SYNTHESIZED FRAMES ARE NOT SDK FRAMES. `state`/`decision`/`decision_settled`/`rewound`/`turn`/
//     `tasks_changed` are control signals the host invented; only `{kind:"message"}` and `{kind:"task"}`
//     carry SDK frames. The former reach the typed events below, the latter reach `onFrame` — the router
//     (router.ts) must never be handed a frame the SDK never produced.
//  4. DEATH IS NOT CLOSE. `dispose()` detaches (unfollow + socket close) and the host lives on; only an
//     UNEXPECTED close is the §1f death sequence, which is why `expectDeath()` exists for the death a
//     client asked for (thread/stop, Task 9) and why dispose latches it too.
//
// It speaks the wire directly rather than wrapping `client/remote.ts`'s `RemoteChatSession`: that class's
// request seam is private and its surface is twenty REPL-shaped methods, while a bridge forwards ops it
// does not interpret and needs per-op deadlines (`sendOp`'s second argument) for the two ops whose host
// side is an engine round trip. The frame CODEC is still the shared one (`host/wire.ts`), so the two
// clients cannot drift on what a frame is.
import { connect } from "node:net";
import type { Socket } from "node:net";
import { decodeFrame } from "../host/wire.js";
import type { HostEvent } from "../host/wire.js";
import type { HostStatus } from "../host/ops.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { TurnFailure } from "../session/turnResult.js";
import type { EngineSession } from "./registry.js";
import { ERR } from "./rpc.js";

/** Deadlines, and their reasons, are `client/remote.ts`'s — measured over `ccx attach` against real
 *  hosts. The default covers a wedged (not dead) host: a genuinely dead one rejects everything in flight
 *  from the close handler, deadline or not. `compact` is the one forwarded member whose host side is a
 *  full engine summarization pass (routinely 30-120s), where a fired timer is a lie rather than a safety
 *  net — the engine finishes and succeeds after the client already reported failure. A caller that needs
 *  neither (Tasks 9's mutating `rewind`, whose protocol has no cancellation) passes `Infinity`. */
const REQUEST_TIMEOUT_MS = 10_000;
const COMPACT_TIMEOUT_MS = 300_000;
/** THIS direction's cap (host→client event frames carry SDK messages including large tool results) —
 *  remote.ts's 32 MiB, not the server's 256 KiB op cap. Reusing the small one once destroyed a live
 *  connection on a legitimate ~500 KiB event. */
const MAX_FRAME = 32 * 1024 * 1024;
/** Who this server is when it answers a host decision — it travels to every other client of that host as
 *  `decision_settled.by`, and back out of this server as `decision/resolved.by`. */
const LABEL = `ccx-appserver-${process.pid}`;

/** The host's answer receipt, verbatim. NOT `orFail`ed anywhere: `{ok:true, alreadyAnsweredBy}` is a lost
 *  RACE, not a refusal (host.ts:754-774), and `{ok:false}` means "no parked request" — Task 8 maps the
 *  three outcomes onto -33002 / not-found / success, so the whole receipt has to survive the trip. */
export interface AnswerReceipt { ok: boolean; alreadyAnsweredBy?: string; error?: string }

/** What a seq-bearing host turn frame carries. `result`/`failure`/`error` are the turn-end trio of spec
 *  §1a-f (wire.ts): `error` is a turn that THREW and travels alone; `result` and `failure` describe a turn
 *  that RESOLVED and can travel together. The fleet event layer (Task 7) is the SOLE turn-lifecycle owner
 *  for fleet threads, so this is the whole evidence base for `turn/completed`'s status.
 *  `truncated` is the OTHER thing a turn frame can say (host.ts:607): the buffer this replay came out of
 *  had already evicted frames, so what follows is a PART of the turn, not the turn. It rides the
 *  seq-bearing mid-turn frame — only the idle notice (:610) is seq-less — so it survives the replay-marker
 *  drop below and has to reach Task 7, which would otherwise announce a partial turn as a whole one. */
export interface FleetTurnEvent { phase: "start" | "end"; seq: number; truncated?: true; result?: unknown; failure?: TurnFailure; error?: string }

/** The host refused a prompt because a turn — anyone's — is already in flight (`{ok:false, error:"busy"}`,
 *  host/server.ts:169). Carries the code the turns spine answers with, and the same message shape its own
 *  local gate uses (turns.ts's `Thread is busy (turn)`), so a client matches one string family whichever
 *  origin refused it. */
export class FleetBusyError extends Error {
  readonly code = ERR.BUSY;
  constructor(message = "Thread is busy (turn)") { super(message); this.name = "FleetBusyError"; }
}

export interface FleetEngineEvents {
  onTurn(cb: (e: FleetTurnEvent) => void): () => void;
  onDecision(cb: (entry: PendingDecision) => void): () => void;
  onDecisionSettled(cb: (e: { toolUseID: string; by: string; decision: string; answer?: DecisionOutcome }) => void): () => void;
  onTasksChanged(cb: (tasks: BackgroundTaskInfo[]) => void): () => void;
  onState(cb: (s: HostStatus) => void): () => void;
  onRewound(cb: (e: { sessionId?: string; prevUuid?: string; cleared?: true }) => void): () => void;
  onSocketDeath(cb: () => void): () => void;
  /** Release the buffered events — call AFTER every listener is installed and the record is published. */
  activate(): void;
  /** Pre-latch: the next socket close is client-requested (thread/stop), so the death sequence is not
   *  fired for it. Everything else a close does still happens — the latch, and settling whatever was
   *  in flight — because a suppressed announcement must never become a parked promise. */
  expectDeath(): void;
}

export interface FleetEngineSession extends EngineSession, FleetEngineEvents {
  readonly kind: "fleet";
  /** `opts.onAccepted` (widening `EngineSession.submit`) fires EXACTLY ONCE, with the seq the host's `ok`
   *  reply named, before the first frame of that turn is delivered. It is the only race-free seq channel a
   *  caller has: deriving the seq from "the next turn-start we saw" is wrong on the refusal path, where a
   *  FOREIGN turn's start can land between the op leaving and the busy reply coming back. */
  submit(prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string; onAccepted?: (seq: number) => void }): Promise<{ result: unknown; error?: TurnFailure }>;
  /** `replay` is the host's own mark (wire.ts:16-19), passed BESIDE the frame rather than on it: the frame
   *  stays byte-for-byte what the SDK produced, and a consumer that clocks arrival can still tell buffered
   *  history from news instead of fabricating a duration for work that finished before it connected. */
  onFrame(cb: (m: unknown, replay?: true) => void): () => void;
  /** REQUIRED here, optional on `EngineSession`: the socket-close latch always exists on a fleet engine,
   *  and it is the only dead-engine signal the -33005 gate is allowed to read. */
  isEnded(): boolean;
  answer(toolUseID: string, outcome: DecisionOutcome): Promise<AnswerReceipt>;
  /** The raw op escape the forwarding handlers ride (§1d, Tasks 9-11): the host wire carries ops that no
   *  `EngineSession` member can express (`rewind {uuid, prevUuid, scope}`, the eight flag ops, `clear`).
   *  `timeoutMs` is per-op; `Infinity` disables the deadline. */
  sendOp<T>(op: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

type Fan<T> = Set<(v: T) => void>;
/** One subscriber's failure is not another's (host.ts's deliver()). */
const fan = <T>(cbs: Fan<T>, v: T): void => { for (const cb of [...cbs]) { try { cb(v); } catch { /* dropped from this event, not from the set */ } } };
/** Generic over the CALLBACK, not its value: the frame fan carries the envelope's replay mark alongside. */
const sub = <C>(cbs: Set<C>, cb: C): (() => void) => { cbs.add(cb); return () => { cbs.delete(cb); }; };

class FleetEngine implements FleetEngineSession {
  readonly kind = "fleet" as const;
  private buf = "";
  private nextId = 1;
  private inflight = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;
  private expectedDeath = false;
  private active = false;
  private queue: HostEvent[] = [];
  private deathQueued = false;
  private sid?: string;
  private turnSink?: (m: unknown) => void;
  private waiter?: { seq: number; resolve: (e: FleetTurnEvent) => void; reject: (e: Error) => void };
  private ends = new Map<number, FleetTurnEvent>();
  private turnCbs: Fan<FleetTurnEvent> = new Set();
  private decisionCbs: Fan<PendingDecision> = new Set();
  private settledCbs: Fan<{ toolUseID: string; by: string; decision: string; answer?: DecisionOutcome }> = new Set();
  private tasksCbs: Fan<BackgroundTaskInfo[]> = new Set();
  private stateCbs: Fan<HostStatus> = new Set();
  private rewoundCbs: Fan<{ sessionId?: string; prevUuid?: string; cleared?: true }> = new Set();
  private deathCbs: Fan<void> = new Set();
  private frameCbs = new Set<(m: unknown, replay?: true) => void>();

  constructor(private sock: Socket) {
    sock.on("data", (c) => this.onData(c.toString("utf8")));
    sock.on("close", () => this.die(new Error("fleet host connection closed")));
    sock.on("error", (e) => this.die(e));
  }

  get sessionId(): string | undefined { return this.sid; }
  isEnded(): boolean { return this.closed; }

  // ── wire ────────────────────────────────────────────────────────────────────────────────────────
  private onData(chunk: string): void {
    this.buf += chunk;
    for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      const frame = decodeFrame(line);
      if (!frame) continue;
      // Routed on `t === "event"` before the id is looked at: a pushed event can never be mistaken for a
      // correlated reply, whatever either happens to carry.
      if (frame.t === "event") { this.route(frame as HostEvent); continue; }
      const id = (frame as Record<string, unknown>)["id"];
      if (typeof id !== "number") continue;
      const waiter = this.inflight.get(id);
      if (!waiter) continue;
      this.inflight.delete(id);
      waiter.resolve(frame);
    }
    // A host writing without a terminating newline must not grow this buffer for the life of an attached
    // thread; destroying it takes the close path, which rejects everything in flight.
    if (this.buf.length > MAX_FRAME) { this.buf = ""; this.sock.destroy(); }
  }

  sendOp<T>(op: Record<string, unknown>, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new Error("fleet host connection closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = Number.isFinite(timeoutMs) ? setTimeout(() => {
        if (!this.inflight.delete(id)) return;     // already answered — never reject a settled promise
        reject(new Error(`host did not answer ${String(op["op"])} within ${timeoutMs}ms`));
      }, timeoutMs) : undefined;
      (timer as { unref?: () => void } | undefined)?.unref?.();
      this.inflight.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v as T); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
      this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    });
  }

  /** Every reply can also come back as the generic `{ok:false, error}` a throwing host handler produces
   *  (server.ts wraps every dispatch), so `error` is a real field on all of them. */
  private async op<T extends { ok: boolean; error?: string }>(frame: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const rep = await this.sendOp<T>(frame, timeoutMs);
    if (!rep.ok) throw new Error(rep.error ?? "host refused");
    return rep;
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────────────
  private route(ev: HostEvent): void {
    if (!this.active) { this.queue.push(ev); return; }
    switch (ev.kind) {
      // The router first, then the turn's own sink — the order the in-process read loop delivers in
      // (session.ts:305 vs :325), so an item mapper sees the same interleave on both origins.
      case "message": this.fanFrame(ev.data, ev.replay); if (this.turnSink) { try { this.turnSink(ev.data); } catch { /* the sink is its owner's problem */ } } return;
      case "task": this.fanFrame(ev.data); return;
      case "decision": fan(this.decisionCbs, ev.entry); return;
      case "decision_settled": fan(this.settledCbs, { toolUseID: ev.toolUseID, by: ev.by, decision: ev.decision, ...(ev.answer ? { answer: ev.answer } : {}) }); return;
      case "tasks_changed": fan(this.tasksCbs, ev.tasks); return;
      case "state": if (ev.status.sessionId) this.sid = ev.status.sessionId; fan(this.stateCbs, ev.status); return;
      // The swap's own announcement carries the id the `state` emitted beside it often cannot (a fresh
      // engine has minted none yet), and `cleared` FORGETS: a restore to the first message opens a new
      // conversation, and keeping the discarded id would point every later read at the wrong transcript
      // (chatAdapter.ts:52-59, same rule, same reason).
      case "rewound": if (ev.cleared) this.sid = undefined; else if (ev.sessionId) this.sid = ev.sessionId;
        fan(this.rewoundCbs, { ...(ev.sessionId ? { sessionId: ev.sessionId } : {}), ...(ev.prevUuid ? { prevUuid: ev.prevUuid } : {}), ...(ev.cleared ? { cleared: true as const } : {}) }); return;
      case "turn": {
        // SEQ-LESS TURN FRAMES ARE REPLAY MARKERS (spec §1b, host.ts:524): the truncated-buffer notice a
        // late follower gets. They name no turn, so they can neither settle one nor start one — dropped
        // here rather than passed on, because everything downstream treats a turn event as lifecycle.
        if (typeof ev.seq !== "number") return;
        const e: FleetTurnEvent = { phase: ev.phase, seq: ev.seq, ...(ev.truncated ? { truncated: true as const } : {}),
          ...(ev.result === undefined ? {} : { result: ev.result }),
          ...(ev.failure === undefined ? {} : { failure: ev.failure }), ...(ev.error === undefined ? {} : { error: ev.error }) };
        if (e.phase === "end") this.settle(e);
        fan(this.turnCbs, e);
        return;
      }
    }
  }

  /** The router's fan. `replay` travels as a SECOND argument, never merged into the frame: property 3 of
   *  the header is that the router is only ever handed a frame the SDK actually produced. */
  private fanFrame(data: unknown, replay?: true): void {
    for (const cb of [...this.frameCbs]) { try { cb(data, replay); } catch { /* dropped from this event, not from the set */ } }
  }

  private settle(e: FleetTurnEvent): void {
    if (this.waiter && this.waiter.seq === e.seq) { const w = this.waiter; this.waiter = undefined; w.resolve(e); return; }
    // Ledgered only while a submit is open (see the header): an end with no waiter and no window is a
    // foreign turn's, and nothing will ever consume it.
    if (this.turnSink) this.ends.set(e.seq, e);
  }

  private die(e: Error): void {
    if (this.closed) return;                     // first close wins; a later error is not a second death
    this.closed = true;
    for (const { reject } of this.inflight.values()) reject(e);
    this.inflight.clear();
    const w = this.waiter; this.waiter = undefined; this.turnSink = undefined;
    w?.reject(e);                                // never leave a turn parked on a connection that is gone
    if (this.expectedDeath) return;
    // Death is terminal, so it can simply follow the queue rather than joining it.
    if (!this.active) { this.deathQueued = true; return; }
    fan(this.deathCbs, undefined);
  }

  onTurn(cb: (e: FleetTurnEvent) => void): () => void { return sub(this.turnCbs, cb); }
  onDecision(cb: (entry: PendingDecision) => void): () => void { return sub(this.decisionCbs, cb); }
  onDecisionSettled(cb: (e: { toolUseID: string; by: string; decision: string; answer?: DecisionOutcome }) => void): () => void { return sub(this.settledCbs, cb); }
  onTasksChanged(cb: (tasks: BackgroundTaskInfo[]) => void): () => void { return sub(this.tasksCbs, cb); }
  onState(cb: (s: HostStatus) => void): () => void { return sub(this.stateCbs, cb); }
  onRewound(cb: (e: { sessionId?: string; prevUuid?: string; cleared?: true }) => void): () => void { return sub(this.rewoundCbs, cb); }
  onSocketDeath(cb: () => void): () => void { return sub(this.deathCbs, cb); }
  onFrame(cb: (m: unknown, replay?: true) => void): () => void { return sub(this.frameCbs, cb); }

  activate(): void {
    if (this.active) return;
    this.active = true;
    for (const ev of this.queue.splice(0)) this.route(ev);
    if (this.deathQueued) { this.deathQueued = false; fan(this.deathCbs, undefined); }
  }

  expectDeath(): void { this.expectedDeath = true; }

  // ── the EngineSession contract ──────────────────────────────────────────────────────────────────
  async submit(prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string; onAccepted?: (seq: number) => void }): Promise<{ result: unknown; error?: TurnFailure }> {
    // One in-flight submit per engine: a second would clobber the sink and the waiter under the first.
    // The host refuses a concurrent prompt anyway (busy), but this engine must not depend on that to
    // keep its own bookkeeping straight.
    if (this.turnSink || this.waiter) throw new Error("a submit is already in flight on this fleet engine");
    // QUARANTINE, not delivery. A sink is open before the op leaves — the turn's own first frames are on
    // the wire ahead of the reply that names its seq, and dropping them is worse than delaying them — but
    // until that reply says `ok` there is no evidence any of those frames are OURS. On a busy refusal they
    // are a FOREIGN turn's, which is the common case rather than the edge: the host is busy precisely
    // because someone else's turn is streaming. Leaked, they reach the caller's item mapper under a turnId
    // whose turn never started. So they are held here and flushed only once the seq is in hand.
    const pending: unknown[] = [];
    this.turnSink = (m) => { pending.push(m); };
    let rep: { ok: boolean; accepted?: boolean; seq?: number; error?: string };
    try { rep = await this.sendOp({ op: "prompt", text: prompt, ...(opts?.uuid ? { uuid: opts.uuid } : {}) }); }
    catch (e) { this.turnSink = undefined; throw e; }
    if (!rep.ok || rep.seq === undefined) {
      this.turnSink = undefined;
      // The host's ONE refusal token, matched exactly (host/server.ts:169) — not a message heuristic:
      // every other failure is a real error and must not read as a retryable busy.
      if (rep.error === "busy") throw new FleetBusyError();
      throw new Error(rep.error ?? "prompt refused");
    }
    const seq = rep.seq;
    // The seq FIRST, then the frames it names: a caller that publishes its turn record here is holding it
    // before the turn's first item arrives. Guarded like every other callback this engine calls — its
    // failure must not strand a turn the host has already started.
    try { opts?.onAccepted?.(seq); } catch { /* the callback is its owner's problem */ }
    this.turnSink = onMessage;
    // Synchronous, so no live frame can interleave: the quarantined ones keep their arrival order and stay
    // ahead of everything that follows.
    for (const m of pending) { try { onMessage(m); } catch { /* the sink is its owner's problem */ } }
    try {
      const end = this.ends.get(seq);
      if (end !== undefined) this.ends.delete(seq);
      const outcome = end ?? await new Promise<FleetTurnEvent>((resolve, reject) => {
        // The connection can have died across the round trip; a waiter installed on a dead socket is a
        // promise nothing will ever settle, because die() already ran its rejection sweep.
        if (this.closed) { reject(new Error("fleet host connection closed")); return; }
        this.waiter = { seq, resolve, reject };
      });
      // A turn that THREW host-side rejects, mirroring the local Session.submit — `error` is that turn's
      // whole result. A turn that RESOLVED reporting failure returns its `failure` as the contract's
      // `error` tag, which is what keeps `turn/completed {status:"failed"}` reachable for fleet threads.
      if (outcome.error !== undefined) throw new Error(outcome.error);
      return { result: outcome.result, ...(outcome.failure ? { error: outcome.failure } : {}) };
    } finally { this.turnSink = undefined; }
  }

  async interrupt(): Promise<unknown> { return this.op({ op: "interrupt" }); }

  /** DETACH, never stop (spec §1f): unfollow, drop the socket, and the host, its turn and its parked
   *  decisions carry on exactly as they were. Ending the session is `thread/stop`'s own op, on Task 9's
   *  path. Our own close is not a connection loss, so it never fires the death sequence. */
  async dispose(): Promise<void> {
    this.expectDeath();
    if (!this.closed) { try { await this.sendOp({ op: "unfollow" }); } catch { /* a host already gone owes no receipt */ } }
    this.sock.destroy();
  }

  async answer(toolUseID: string, outcome: DecisionOutcome): Promise<AnswerReceipt> {
    // Payload-free permission kinds keep the FLAT legacy field so a host older than Goal B still parses
    // this answer (remote.ts:150-160, same rule); anything carrying a payload must go structured or the
    // payload is dropped on the wire.
    const flat = (outcome.kind === "allow_once" && outcome.updatedInput === undefined)
      || outcome.kind === "allow_always"
      || (outcome.kind === "deny" && outcome.feedback === undefined);
    return this.sendOp<AnswerReceipt>(flat ? { op: "answer", toolUseID, decision: outcome.kind, by: LABEL }
                                           : { op: "answer", toolUseID, answer: outcome, by: LABEL });
  }

  // ── forwarded optional members (spec §1b's table) ───────────────────────────────────────────────
  async stopTask(taskId: string): Promise<void> { await this.op({ op: "stop_task", taskId }); }
  /** The host op carries no `toolUseId` (ops.ts) — it is the Ctrl+B "background everything in flight"
   *  shape — so the argument is accepted for the interface and dropped here rather than silently
   *  narrowing the call. The boolean is a RECEIPT ("was anything backgrounded"), not a success flag. */
  async backgroundAll(toolUseId?: string): Promise<boolean> { void toolUseId; return (await this.op<{ ok: boolean; error?: string; backgrounded?: boolean }>({ op: "background" })).backgrounded ?? false; }
  async listBackgroundTasks(): Promise<BackgroundTaskInfo[]> { return (await this.op<{ ok: boolean; error?: string; tasks?: BackgroundTaskInfo[] }>({ op: "tasks" })).tasks ?? []; }
  async mcpServerStatus(): Promise<unknown[]> { return (await this.op<{ ok: boolean; error?: string; servers?: unknown[] }>({ op: "mcp_status" })).servers ?? []; }
  async reconnectMcpServer(serverName: string): Promise<void> { await this.op({ op: "mcp_reconnect", name: serverName }); }
  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> { await this.op({ op: "mcp_toggle", name: serverName, enabled }); }
  async compact(): Promise<unknown> { return (await this.op<{ ok: boolean; error?: string; outcome?: unknown }>({ op: "compact" }, COMPACT_TIMEOUT_MS)).outcome; }
  async usage(): Promise<unknown> { return (await this.op<{ ok: boolean; error?: string; usage?: unknown }>({ op: "usage" })).usage; }
  async getContextUsage(): Promise<unknown> { return (await this.op<{ ok: boolean; error?: string; usage?: unknown }>({ op: "context_usage" })).usage; }
  /** FOUR catalogs (§1a-d): `agents` rides along, or a fleet `thread/capabilities/read` silently loses
   *  subagents. Each defaulted, because a pre-M3 host answers without one. */
  async capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[]; agents: unknown[] }> {
    const rep = await this.op<{ ok: boolean; error?: string; models?: unknown[]; commands?: unknown[]; mcpServers?: unknown[]; agents?: unknown[] }>({ op: "capabilities" });
    return { models: rep.models ?? [], commands: rep.commands ?? [], mcpServers: rep.mcpServers ?? [], agents: rep.agents ?? [] };
  }
  /** The host's own mirror moves on these and republishes on `state` (§1a-c) — this server never writes
   *  its mirror from the reply, which carries nothing. */
  async setModel(model?: string): Promise<void> { await this.op({ op: "set_model", ...(model ? { model } : {}) }); }
  async setPermissionMode(mode: string): Promise<void> { await this.op({ op: "set_permission_mode", mode }); }
  async setMaxThinkingTokens(maxTokens: number | null): Promise<void> { await this.op({ op: "set_thinking", maxTokens }); }
  async getSettings(): Promise<unknown> { return (await this.op<{ ok: boolean; error?: string; settings?: unknown }>({ op: "get_settings" })).settings; }
}

/** Dial a running host and register as a follower. The follow ACK is awaited, which is what makes the
 *  replay guarantee usable: the host writes its whole burst before that reply (P106), so a caller holding
 *  the resolved engine holds every replayed frame — queued, because `activate()` has not been called. */
export async function connectFleetEngine(socketPath: string): Promise<FleetEngineSession> {
  const sock = await new Promise<Socket>((resolve, reject) => {
    const s = connect(socketPath);
    s.once("error", reject);
    s.once("connect", () => { s.off("error", reject); resolve(s); });
  });
  const engine = new FleetEngine(sock);
  try {
    const rep = await engine.sendOp<{ ok: boolean; error?: string }>({ op: "follow" });
    if (!rep.ok) throw new Error(rep.error ?? "host refused follow");
  } catch (e) { sock.destroy(); throw e; }
  return engine;
}

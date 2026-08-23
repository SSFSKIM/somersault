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
import type { UserTurnInput } from "../session/turnInput.js";
import type { TurnFailure } from "../session/turnResult.js";
import { stageBlocks } from "../client/stagedSubmit.js";
import type { EngineSession } from "./registry.js";
import { ERR } from "./rpc.js";

/** Deadlines, and their reasons, are `client/remote.ts`'s — measured over `ccx attach` against real
 *  hosts. The default covers a wedged (not dead) host: a genuinely dead one rejects everything in flight
 *  from the close handler, deadline or not. `compact` is the one forwarded member whose host side is a
 *  full engine summarization pass (routinely 30-120s), where a fired timer is a lie rather than a safety
 *  net — the engine finishes and succeeds after the client already reported failure. A caller whose
 *  promise NOBODY READS passes `Infinity` instead: `thread/stop`'s op (fleet.ts) is written into a socket
 *  the host is about to destroy, and there is no deadline to keep on a result no one awaits. */
const REQUEST_TIMEOUT_MS = 10_000;
const COMPACT_TIMEOUT_MS = 300_000;
/** The SWAP family's deadline — `rewind` and `clear`, forwarded by `appserver/rewind.ts`'s
 *  `forwardSwapOp` (external review 2026-08-11: both used to ride the 10 s default).
 *
 *  LONG for compact's reason, and more so: the host's side of a swap is a dry run, a filesystem
 *  checkpoint restore, a fresh `claude` spawn and a flag-state replay against it, so exceeding 10 s is
 *  ordinary rather than pathological — and the wire carries no cancellation, so a fired timer would fail
 *  the client for a swap the host goes on to complete, with the contradicting `rewound` arriving after.
 *
 *  FINITE, though, where `stop` is not, and the difference is who waits: this promise is awaited ON
 *  `record.chain`, so nothing else on that thread — `thread/close` included — runs until it settles, and
 *  `AppServer.shutdown()` awaits the same chain. An unbounded wait on a host that is WEDGED rather than
 *  dead (the class the default exists for; a dead one rejects from the close handler) would therefore jam
 *  the thread permanently and take the server's own exit with it. Five minutes is far beyond any real
 *  swap and still lets both make progress. */
export const SWAP_TIMEOUT_MS = 300_000;
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
  /** Give the latch back: the requested death did NOT happen and the connection is still open, so the
   *  next close is once again the unannounced kind §1f exists for. Only `thread/stop`'s timeout path has
   *  a use for it (fleet.ts) — a latch left standing over a live socket is a death nobody will hear. */
  cancelExpectDeath(): void;
}

export interface FleetEngineSession extends EngineSession, FleetEngineEvents {
  readonly kind: "fleet";
  /** `opts.onAccepted` (widening `EngineSession.submit`) fires EXACTLY ONCE, with the seq the host's `ok`
   *  reply named, before the first frame of that turn is delivered. It is the only race-free seq channel a
   *  caller has: deriving the seq from "the next turn-start we saw" is wrong on the refusal path, where a
   *  FOREIGN turn's start can land between the op leaving and the busy reply coming back. */
  /** `opts.aborted` is the CALLER'S latch, read on the far side of the staging round trip an image prompt
   *  opens with and before the prompt op is written. That round trip is a real window: an interrupt the
   *  client sends inside it reaches the HOST first, where it cancels nothing — or cancels a FOREIGN turn —
   *  and the prompt then starts a turn the client already stopped. It returns the REFUSAL MESSAGE rather
   *  than a bare boolean so the engine can reject with the caller's own wording, and a turn stopped inside
   *  the window reads exactly like one stopped just before it. */
  /** `opts.onPromptDispatch` fires SYNCHRONOUSLY in the same tick as the prompt op's write, on the far
   *  side of staging and of the `aborted` check — the moment this turn first becomes capable of provoking
   *  a frame of its own. It exists for a caller that arms an ordering barrier around its own turn (turns.ts's
   *  `fleetStartAck`): armed at submit-time instead, the barrier would span the whole staging sequence, a
   *  window in which the host has not even heard of this prompt and every frame arriving is a FOREIGN
   *  turn's — deferring those behind our barrier reorders another client's turn behind ours. */
  submit(prompt: UserTurnInput, onMessage: (m: unknown) => void, opts?: { uuid?: string; onAccepted?: (seq: number) => void; aborted?: () => string | undefined; onPromptDispatch?: () => void }): Promise<{ result: unknown; error?: TurnFailure }>;
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
  /** THE RESERVATION. Taken SYNCHRONOUSLY at the top of `submit` and released by its `finally`, so it is
   *  true across every await the submit contains. `turnSink` and `waiter` are both set only AFTER the
   *  staging round trip an array prompt now opens with, which left the older guard passable by two
   *  concurrent array submits — both staging, the second clobbering the first's sink (spec 2026-08-23,
   *  plan-review finding 3). This flag is the one that is already true before the first await. */
  private submitInFlight = false;
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
    // `setEncoding("utf8")` FIRST: the socket then runs an internal StringDecoder that retains an incomplete
    // multibyte sequence across chunk boundaries and only emits already-decoded strings, so `data` arrives
    // as a string with no partial codepoint. Decoding each raw Buffer chunk independently
    // (`chunk.toString("utf8")`) instead corrupts a non-ASCII char split across a socket-chunk boundary to
    // replacement chars BEFORE the newline-level line buffer at onData() can reassemble it (the buffering is
    // at the newline level, not the byte level).
    sock.setEncoding("utf8");
    sock.on("data", (s: string) => this.onData(s));
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

  /** Drop every ledgered end when a submit fails BEFORE it accepted a seq (the busy/refusal reply and the
   *  sendOp-throw path). Such a submit owns no seq of its own, and this engine runs one submit at a time
   *  while a successful one deletes its own matched end — so at this moment `ends` can only hold FOREIGN
   *  entries ledgered by settle() during the round trip (the host is busy precisely because someone else's
   *  turn is streaming, and its end lands with no waiter to consume it). Left behind they accumulate
   *  unbounded across repeated multi-client busy races; there is never a legitimately-pending OWN end to
   *  drop here, so clearing is correct rather than lossy (external review F5). */
  private discardWindowEnds(): void { this.ends.clear(); }

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
  cancelExpectDeath(): void { this.expectedDeath = false; }

  // ── the EngineSession contract ──────────────────────────────────────────────────────────────────
  async submit(prompt: UserTurnInput, onMessage: (m: unknown) => void, opts?: { uuid?: string; onAccepted?: (seq: number) => void; aborted?: () => string | undefined; onPromptDispatch?: () => void }): Promise<{ result: unknown; error?: TurnFailure }> {
    // One in-flight submit per engine: a second would clobber the sink and the waiter under the first.
    // The host refuses a concurrent prompt anyway (busy), but this engine must not depend on that to
    // keep its own bookkeeping straight — and an array prompt spends a whole staging round trip before
    // either of those is set, so the reservation is taken HERE, ahead of the first await, and released on
    // every terminal path the body can take (success, throw, busy refusal, socket death).
    if (this.submitInFlight || this.turnSink || this.waiter) throw new Error("a submit is already in flight on this fleet engine");
    this.submitInFlight = true;
    try { return await this.runSubmit(prompt, onMessage, opts); }
    finally { this.submitInFlight = false; }
  }

  private async runSubmit(prompt: UserTurnInput, onMessage: (m: unknown) => void, opts?: { uuid?: string; onAccepted?: (seq: number) => void; aborted?: () => string | undefined; onPromptDispatch?: () => void }): Promise<{ result: unknown; error?: TurnFailure }> {
    // A string prompt takes the exact path it always did, down to the absent `images` key. An array's
    // images cannot travel on the host wire at all (M3 §1b's op set) — they travel as BYTES ON THE HOST'S
    // DISK, staged through the same helper the socket-owning REPL adapter uses (client/stagedSubmit.ts)
    // and claimed by path on the prompt op. Version skew — an old host that never heard of `stageImage` —
    // throws out of here, the helper having already deleted whatever it had staged.
    let staged: Awaited<ReturnType<typeof stageBlocks>> | undefined;
    let body: Record<string, unknown> = { text: prompt };
    if (typeof prompt !== "string") {
      staged = await stageBlocks(prompt, { stageImageOp: (d) => this.sendOp({ op: "stageImage", ...d }) });
      body = { text: staged.text, ...(staged.images.length ? { images: staged.images } : {}) };
    }
    // THE LAST CHECK BEFORE THE WIRE. Staging is one host round trip per image, and the caller's admission
    // decisions were all taken before it; an interrupt or a close landing inside that window would
    // otherwise be followed by our own prompt, starting a turn the client already stopped. The staged
    // bytes are still OURS here — no `prompt` op has left at all, so this is the one cleanup with nothing
    // indeterminate about it — and they go back with the refusal rather than waiting on the orphan sweep.
    // For a STRING prompt this runs in the caller's own tick — no window, no cost, and one rule instead of two.
    const stopped = opts?.aborted?.();
    if (stopped) { await staged?.cleanup(); throw new FleetBusyError(stopped); }
    // THE DISPATCH EDGE (final review round 4). Everything from here to the `sendOp` below is ONE TICK, so
    // this fires in the same breath as the prompt's write: past it this turn can provoke frames, before it
    // it cannot, and a caller's own-turn ordering barrier has exactly that span to cover. Deliberately
    // ahead of the quarantine sink rather than woven into the try below — the only caller assigns a field
    // here, and an unguarded throw that has installed nothing leaves this engine re-submittable.
    opts?.onPromptDispatch?.();
    // QUARANTINE, not delivery. A sink is open before the op leaves — the turn's own first frames are on
    // the wire ahead of the reply that names its seq, and dropping them is worse than delaying them — but
    // until that reply says `ok` there is no evidence any of those frames are OURS. On a busy refusal they
    // are a FOREIGN turn's, which is the common case rather than the edge: the host is busy precisely
    // because someone else's turn is streaming. Leaked, they reach the caller's item mapper under a turnId
    // whose turn never started. So they are held here and flushed only once the seq is in hand.
    const pending: unknown[] = [];
    this.turnSink = (m) => { pending.push(m); };
    let rep: { ok: boolean; accepted?: boolean; seq?: number; error?: string };
    // THE STAGED BYTES SPLIT FOUR WAYS HERE, on what this one op came back as (whole-branch review P2,
    // widened in round 2). An explicit REFUSAL and an ACCEPTANCE are both definite answers and are
    // handled below: refused, the bytes are still ours and go back; accepted, the host owns them.
    // A REJECTION is two cases wearing one face, and `sendOp` is what tells them apart:
    //  - NEVER SENT. `sendOp` checks `this.closed` BEFORE it writes anything, so a prompt op invoked on
    //    an already-dead engine rejects without a byte leaving. Acceptance is then impossible AND the
    //    dead host's orphan sweeper died with the host, so these files would sit on disk until someone
    //    restarted it — up to a full 5 MiB per turn. They are ours: taken back. Reachable without a race
    //    to win: every staging reply arrives, the host dies during the client-local `writeFile`, and
    //    `stageBlocks` returns into an engine that closed while it worked.
    //  - INDETERMINATE. The socket died ACROSS the op: the host can have accepted the prompt before its
    //    reply reached us, and its `runTask` survives a client disconnect and reads the claimed files
    //    lazily as the turn runs. So those files are LEFT STANDING — unlinking them would make every
    //    later image of an accepted turn degrade as missing, while leaving them costs nothing when the
    //    prompt really never arrived: the host's own orphan sweep reaps them (host/imageStaging.ts,
    //    ORPHAN_MAX_AGE_MS), and a file the sweep already took is exactly the "missing" verdict
    //    `readAndValidate` already tolerates.
    // Sampled SYNCHRONOUSLY, in the same tick as the call it describes — no await between the sample and
    // the `sendOp`, so it reads the very state that decides which branch inside `sendOp` was taken.
    const neverSent = this.closed;
    try { rep = await this.sendOp({ op: "prompt", ...body, ...(opts?.uuid ? { uuid: opts.uuid } : {}) }); }
    catch (e) {
      this.turnSink = undefined; this.discardWindowEnds();
      if (neverSent) await staged?.cleanup();
      throw e;
    }
    if (!rep.ok || rep.seq === undefined) {
      this.turnSink = undefined;
      this.discardWindowEnds();
      // A REAL REPLY SAYING NO. Staged bytes are OURS until the host accepts the prompt (stagedSubmit.ts's
      // ownership contract), and an explicit refusal is a definite non-acceptance: taken back here, they
      // never wait on the orphan sweep. Past this point the prompt was ACCEPTED and the host owns them, so
      // `cleanup` is deliberately dropped uncalled.
      await staged?.cleanup();
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

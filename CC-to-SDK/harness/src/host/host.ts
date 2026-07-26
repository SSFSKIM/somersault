import { HostServer } from "./server.js";
import type { HostStatus } from "./ops.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL, finalizeRoster, readRoster, writeRoster } from "../fleet/roster.js";
import { procStartOf as realProcStartOf } from "../fleet/liveness.js";
import type { FleetState, RosterRow } from "../fleet/roster.js";
import { openSession as realOpenSession } from "../session/index.js";
import type { HarnessConfig } from "../config/types.js";
import { TurnBuffer } from "./follow.js";
import type { HostEvent } from "./wire.js";
import { PendingPermissions } from "../permissions/pending.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision, PermissionBroker, PermissionRequest } from "../permissions/types.js";

export interface SessionHostOpts {
  short: string; name: string; cwd: string; kind: "bg" | "interactive";
  worktree?: string; config: HarnessConfig; env?: NodeJS.ProcessEnv;
}

/** How long stop() will wait for a well-behaved dispose after the turn has been interrupted. Generous
 *  enough that the normal path always completes inside it, short enough that a wedged turn does not
 *  keep a detached process alive for the rest of the day. */
const DISPOSE_GRACE_MS = 5_000;

/** Exactly the three members a host drives on its session — structural, not `any`, so a signature drift
 *  in `Session` fails THIS build instead of failing at runtime inside a detached process nobody watches. */
export interface HostSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<unknown>;
  readonly sessionId: string | undefined;
  dispose(): Promise<void>;
  // `unknown`, not `void` — the real Session.interrupt() returns Promise<unknown>, and a Promise<void>
  // declaration here makes the default `openSession: realOpenSession` stop type-checking.
  interrupt?(): Promise<unknown>;
}

/** Owns one SDK session, its UDS socket, and its roster row. Live truth is answered over the socket;
 *  only the TERMINAL state is written down, because a finished process cannot be interrogated. */
export class SessionHost {
  readonly short: string;
  private session?: HostSession;
  private server?: HostServer;
  private state: FleetState = "working";
  // True for the ENTIRE life of a turn, including while it is parked mid-turn on a permission decision.
  // Do not confuse with status()'s projection: status() deliberately reports the parked case as
  // {state:"blocked", status:"idle"} for consumers (spec-mandated, do not change) — a caller that needs
  // to know "is it safe to start another turn" (the socket's `prompt` gate, runTask's own re-entry
  // guard) must ask `busy()`, never that projection, or a prompt arriving mid-park re-enters runTask and
  // resets the turn buffer out from under a turn that never stopped.
  private turnInFlight = false;
  private env: NodeJS.ProcessEnv;
  private followers = new Set<(ev: HostEvent) => void>();
  private turnBuffer = new TurnBuffer({ maxMessages: 500, maxBytes: 1024 * 1024 });
  // "never": a background host parks until a human answers, which is the entire point of a worker that
  // outlives the terminal that spawned it. The interactive case is handled by the follower rule in
  // broker(), not by a timer — a timer is how "the human is thinking" becomes "the human said no".
  private parked = new PendingPermissions({ expireAfterMs: "never" });
  // Who answered what, so a second answerer can be told. A host that runs for days would otherwise
  // accumulate one entry per permission for its whole life.
  private settledBy = new Map<string, string>();

  constructor(private opts: SessionHostOpts,
    private deps: { openSession: (c: HarnessConfig) => HostSession; procStartOf?: (p: number) => Promise<string | undefined>;
      /** Test-only override for DISPOSE_GRACE_MS — otherwise every wedged-dispose test burns the real
       *  grace period in a suite that runs on every commit. */
      disposeGraceMs?: number }
      = { openSession: realOpenSession }) {
    this.short = opts.short;
    this.env = opts.env ?? process.env;
  }

  async start(): Promise<void> {
    // Our OWN copy of the start stamp. The engine writes one too, but unlinks it on exit — and a
    // roster row outlives that, so without this a crashed host reads live forever (see RosterRow).
    // procStartOf RETURNS undefined for a gone pid but THROWS when `ps` could not be run at all;
    // swallowing the throw writes exactly the no-procStart row that reads live forever, so say so.
    const procStart = await (this.deps.procStartOf ?? realProcStartOf)(process.pid).catch((e: unknown) => {
      console.error(`cc-harness host ${this.opts.short}: could not read own procStart (${(e as Error)?.message ?? e}) — a crash will read as live`);
      return undefined;
    });
    const row: RosterRow = {
      short: this.opts.short, pid: process.pid, cwd: this.opts.cwd, kind: this.opts.kind,
      name: this.opts.name, state: "working", startedAt: Date.now(),
      ...(procStart ? { procStart } : {}),
      ...(this.opts.worktree ? { worktree: this.opts.worktree } : {}),
    };
    writeRoster(row, this.env);                        // written BEFORE any session id exists
    try {
      this.session = this.deps.openSession({ ...this.opts.config, permissionBroker: this.broker() });
      this.server = new HostServer({
        status: () => this.status(),
        busy: () => this.busy(),
        stop: () => this.stop("stopped"),
        pending: () => this.pending(),
        answer: (id, d, by) => this.answer(id, d, by),
        prompt: (text) => this.runTask(text),
        interrupt: () => this.interrupt(),
        // One follower per connection, delivering to that connection's sink. The host counts
        // followers (the interactive deny rule reads that count); the server owns the sockets.
        follow: (deliver) => this.follow(deliver),
      }, hostSocketPath(process.pid, this.env));
      await this.server.listen();
    } catch (e) {
      // The row is already on disk and nothing reaps a row whose host never came up, so a failure here
      // (a stale socket file is the obvious `listen` trigger) would otherwise strand a permanent
      // `working` row plus, on the listen path, an opened session whose dispose never runs.
      await this.session?.dispose().catch(() => {});
      finalizeRoster(this.opts.short, "error", this.env);
      throw e;
    }
  }

  /** A second call while a turn is already running MUST be refused here, not merely by the socket's own
   *  gate: this method is public and reachable directly (RemoteChatSession.prompt() is one caller, not
   *  the only one), and trusting every caller to check first is how the socket bug shipped. Re-entering
   *  would reset() the turn buffer out from under a turn that is still delivering messages to followers —
   *  a client attaching afterwards would be replayed zero messages, the exact regression the buffer
   *  exists to prevent. */
  async runTask(prompt: string): Promise<void> {
    if (this.turnInFlight) throw new Error(`host ${this.short} is already running a turn`);
    this.turnInFlight = true; this.state = "working";
    this.turnBuffer.reset(); this.settledBy.clear();
    this.emit({ kind: "turn", phase: "start" });
    // Stamp the roster the MOMENT the engine's session id materializes — it arrives in the init frame
    // near the start of the turn, and Session sets .sessionId before dispatching that frame here. Waiting
    // for the turn to end (all syncRoster ever did) left `agents` printing sessionId "" for the session's
    // whole life, and the consumer's uuid poller gives up after ~60s: every turn longer than that made
    // `--resume` impossible while the run itself looked fine. Once, not per message: the write is
    // read-then-write, so repeating it costs a syscall pair per frame and keeps re-opening the window in
    // which a concurrent `ccx rm` has its unlink undone.
    let stamped = false;
    const onMessage = (m: unknown) => {
      if (!stamped && this.session?.sessionId) { stamped = true; this.writeSessionId(); }
      this.turnBuffer.push(m);
      this.emit({ kind: "message", data: m });
    };
    try { await this.session!.submit(prompt, onMessage); this.state = "done"; }
    catch (e) { this.state = "error"; this.emit({ kind: "turn", phase: "end", error: (e as Error)?.message }); throw e; }
    // For a BG worker the turn's completion IS the terminal event, so record it here: a host that dies
    // after the turn but before stop() then still reports `done` rather than waiting to be reaped by
    // liveness. An interactive host stays live across turns — finalize is first-terminal-wins, so
    // finalizing on turn one would freeze it at `done` while it works on turn two — it waits for stop().
    finally { this.turnInFlight = false; if (this.opts.kind === "bg") this.syncRoster(); }
    this.emit({ kind: "turn", phase: "end" });
  }

  /** Subscribe to the live turn. The new follower is replayed the turn so far FIRST, synchronously, so
   *  it never sees message 3 before messages 1 and 2. Returns its own unsubscribe. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const snap = this.turnBuffer.snapshot();
    // The truncation flag has to reach the client or it is a promise we do not keep: TurnBuffer
    // records that the replay is partial, and a follower shown a partial turn with no marker reads it
    // as the whole turn. Sent only when true, so an untruncated replay costs no frame.
    if (snap.truncated) this.deliver(cb, { kind: "turn", phase: "start", truncated: true });
    for (const m of snap.messages) this.deliver(cb, { kind: "message", data: m });
    // A request parked before this follower attached is otherwise invisible to it forever: the
    // `permission` event fires exactly once, at park time, over the followers registered at that
    // instant. A socket-borne follower's registration is not synchronous with its client's `follow()`
    // call (it lands after an async round trip), so without this replay a client that raced a parked
    // permission — or one that simply reconnects — would see it only through the separate `pending()`
    // poll, never through the live stream it otherwise relies on.
    for (const entry of this.parked.list()) this.deliver(cb, { kind: "permission", entry });
    // LAST in the replay, not first: every frame above describes history so far; this one describes
    // "right now", so it belongs immediately before we start relaying genuinely live events. Without
    // it, a follower attaching mid-turn has no way to tell a live turn from the tail of a finished one
    // until the next event happens to arrive — which, for a turn parked on a slow tool call or one that
    // already ended, may be a long wait or may never come.
    this.deliver(cb, { kind: "state", status: this.status() });
    this.followers.add(cb);
    return () => { this.followers.delete(cb); };
  }

  /** One follower's failure is that follower's problem. Without this guard a client whose callback
   *  throws — a socket write to a peer that vanished, most likely — unwinds through the SDK's message
   *  dispatch and rejects the turn, taking a detached host down over a client that already left. */
  private deliver(cb: (ev: HostEvent) => void, ev: HostEvent): void {
    try { cb(ev); } catch { /* a follower that throws is dropped from this event, not from the set */ }
  }

  private emit(ev: HostEvent): void { for (const cb of [...this.followers]) this.deliver(cb, ev); }

  /** The permission seam this host exposes to its SDK session (wired as `config.permissionBroker`).
   *
   *  The interactive rule is evaluated HERE, when the request arrives — never retroactively when a
   *  follower leaves. An interactive session whose human is gone denies rather than hanging; but a
   *  request already parked stays parked through a detach, because detaching is what a human does in
   *  order to go and think about it (spec acceptance 6). */
  broker(): PermissionBroker {
    return {
      request: async (req: PermissionRequest): Promise<PermissionDecision> => {
        if (this.opts.kind === "interactive" && this.followers.size === 0) return { kind: "deny" };
        const decision = this.parked.brokerFor(this.short).request(req);
        const entry = this.parked.list().find((e) => e.toolUseID === req.toolUseID);
        if (entry) this.emit({ kind: "permission", entry });
        this.emit({ kind: "state", status: this.status() });
        return decision;
      },
    };
  }

  pending(): PendingEntry[] { return this.parked.list(); }

  /** First answer wins. A second answerer is TOLD who got there first rather than erroring: two humans
   *  racing on the same prompt is normal, and an error frame would read as "your answer failed". */
  answer(toolUseID: string, decision: PermissionDecision, by: string): { ok: true; alreadyAnsweredBy?: string } | { ok: false; error: string } {
    if (!this.parked.respond(toolUseID, decision)) {
      const who = this.settledBy.get(toolUseID);
      // Answered-by-someone-else and never-parked-at-all are different outcomes and must not share a
      // reply: a client whose toolUseID is stale or wrong would otherwise read `{ok:true}` and believe
      // its answer landed.
      return who ? { ok: true, alreadyAnsweredBy: who } : { ok: false, error: `no parked request ${toolUseID}` };
    }
    this.settledBy.set(toolUseID, by);
    this.emit({ kind: "permission_settled", toolUseID, by, decision: decision.kind });
    this.emit({ kind: "state", status: this.status() });
    return { ok: true };
  }

  /** `PendingPermissions.denyAll()` settles straight into its own map, bypassing `answer()`'s
   *  `permission_settled`/`state` emits entirely — so, unfixed, a follower watching a parked request is
   *  never told the decision is gone; it can only infer that later from a `turn end` frame, and until
   *  then a client's permission dialog is stuck showing a request nobody will ever answer. Both
   *  interrupt() and teardown() settle this way (the host, not a human, is ending the request), so the
   *  emit is centralized here instead of duplicated at each call site. */
  private settleParkedForSystem(): void {
    for (const e of this.parked.denyAll()) {
      this.settledBy.set(e.toolUseID, "system");
      this.emit({ kind: "permission_settled", toolUseID: e.toolUseID, by: "system", decision: "deny" });
    }
  }

  /** `blocked` is live-reported, never written to `this.state`: the roster's recorded state and this
   *  live status are deliberately separate, because `blocked` is not terminal and syncRoster's
   *  first-terminal-wins finalize must never freeze on it. */
  status(): HostStatus {
    const first = this.parked.list()[0];
    if (first) return { state: "blocked", status: "idle", waitingFor: `permission:${first.toolName}` };
    return { state: this.state, status: this.turnInFlight ? "busy" : "idle" };
  }

  /** The host's OWN truthful busy signal, wired to the socket's `prompt` gate (see server.ts). Unlike
   *  status(), it never lies during a park: true from the moment runTask starts until it returns,
   *  covering the entire time a permission is parked mid-turn — the state a background host spends real
   *  time in by design, and exactly when the old status()-based gate was open. */
  busy(): boolean { return this.turnInFlight; }

  /** Ends the in-flight turn, settling parked decisions first (see stop()).
   *
   *  Probe 63 recorded a fact worth knowing here: interrupting a turn that is parked at a `tool_use`
   *  makes the message stream **throw** rather than return a result —
   *  `Claude Code returned an error result: … stop_reason=tool_use`. So `runTask`'s catch arm runs,
   *  sets `state = "error"`, and its `finally` re-syncs the roster. Left unguarded, that turns a
   *  deliberate `interrupt` op into a roster row indistinguishable from a crash — exactly what routes a
   *  downstream consumer down the failure arm for a session the operator ended on purpose.
   *
   *  On a BACKGROUND host we write the terminal state `stopped` down FIRST, before interrupting — the
   *  same ordering stop()/teardown() uses, and for the same reason: `finalizeRoster` is first-terminal-
   *  wins, so once `stopped` is on disk the later `error` write that runTask's own catch produces is a
   *  no-op. `stopped`, not e.g. `done`, because the spec defines it for exactly this case: an
   *  operator-ended session that stays resumable by uuid. Interactive hosts are unaffected — runTask's
   *  bg-gate on finalize (see runTask's `finally`) means their roster is never written from here either
   *  way. Do not move `syncRoster()` below the interrupt call. */
  async interrupt(): Promise<void> {
    const bg = this.opts.kind === "bg";
    if (bg) this.state = "stopped";
    this.settleParkedForSystem();
    if (bg) this.syncRoster();
    await this.session?.interrupt?.();
  }

  // Memoized so a second stop() — e.g. runHostMain's `finally` racing a `stop` op that already arrived
  // over the socket — returns the FIRST call's promise instead of re-running interrupt()/dispose() on a
  // session that is already torn down. `this.session` is never cleared, and the SDK's Query.request()
  // does not check whether the query was already cleaned up before issuing a fresh control request and
  // awaiting a response — a second interrupt() risks parking forever, exactly like an unbounded first one.
  private stopping?: Promise<void>;

  /** `final` lets stop() record `stopped` while a completed run records `done`/`error`. With no argument
   *  and no finished turn the state is still `working`, and syncRoster then writes nothing down. */
  async stop(final?: FleetState): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.teardown(final);
    return this.stopping;
  }

  /** Order matters and each position is load-bearing:
   *  1. Settle parked decisions — nothing awaited may survive us.
   *  2. Write the terminal roster state — a reader must never wait on a host that is going away, and it
   *     must land BEFORE the interrupt below: interrupting a turn parked at a tool call makes the
   *     message stream throw, and runTask's catch arm then records `error` — harmless only because
   *     finalizeRoster is first-terminal-wins and `stopped` was already written.
   *  3. Interrupt the in-flight turn, THEN dispose. This is the actual repair, not the timeout below:
   *     dispose() is `input.close(); await done`, and `done` cannot resolve while a request is in
   *     flight — interrupting is what ends the turn and lets it.
   *  4. The two together, bounded by ONE deadline (DISPOSE_GRACE_MS). Interrupt itself has no timeout of
   *     its own — the SDK's `Query.request({subtype:"interrupt"})` writes a control request and waits
   *     for a matching response — so racing dispose alone (as this used to) left a wedged interrupt
   *     unbounded: dispose was never even reached, and stop() never returned. One deadline covering
   *     both is what "bounded" has to mean: after it expires we leave regardless of which SDK call
   *     stalled.
   *  5. Close the server unconditionally, in a `finally` — not just after the race. A server left
   *     listening is a host that never exits, and a `finally` guarantees it runs even if a synchronous
   *     throw earlier in this method (settleParkedForSystem/syncRoster) would otherwise skip it —
   *     guaranteed by structure, not by convention. */
  private async teardown(final?: FleetState): Promise<void> {
    try {
      if (final) this.state = final;
      this.settleParkedForSystem();
      this.syncRoster();                     // terminal state on disk BEFORE anything that can block
      const graceMs = this.deps.disposeGraceMs ?? DISPOSE_GRACE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<void>((r) => { timer = setTimeout(r, graceMs); (timer as { unref?: () => void }).unref?.(); });
      const interruptThenDispose = (async () => {
        await this.session?.interrupt?.().catch(() => {});
        await this.session?.dispose().catch(() => {});
      })();
      await Promise.race([interruptThenDispose, deadline]);
      clearTimeout(timer);                   // whichever arm won, the other's handle must not dangle
    } finally {
      await this.server?.close();
    }
  }

  /** Copy the engine's session id onto our row, if it has reported one yet. Read-then-write, and gated
   *  on the row still existing: a `ccx rm` that unlinked it under us must not have it put back. This is
   *  the ONLY writer of `sessionId` — nothing derives it at read time, because the engine files its own
   *  registry rows by the pid of the CLI subprocess it spawns, never by ours. */
  private writeSessionId(): void {
    const sid = this.session?.sessionId;
    if (!sid) return;
    const r = readRoster(this.opts.short, this.env);
    if (r) writeRoster({ ...r, sessionId: sid }, this.env);
  }

  /** The session id lands here, not at start(): the engine only reports one once its first turn's
   *  init frame arrives, and a listing must be able to find this host before that — so that write is
   *  unconditional. Finalizing is not: only a TERMINAL state may be written down. Stamping a `working`
   *  row with an endedAt yields a row that looks ended but never satisfies the poller, which then waits
   *  on it forever; skipping it loses nothing, because projectRow already turns a dead pid with a
   *  non-terminal row into `error` — exactly what a host that exited without finishing deserves. */
  private syncRoster(): void {
    this.writeSessionId();                              // runTask already did this mid-turn; re-run for
    if (TERMINAL.has(this.state)) finalizeRoster(this.opts.short, this.state, this.env);  // the stop() path
  }
}

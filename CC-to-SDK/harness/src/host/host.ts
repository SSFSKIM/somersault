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
  private busy = false;
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

  async runTask(prompt: string): Promise<void> {
    this.busy = true; this.state = "working";
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
    finally { this.busy = false; if (this.opts.kind === "bg") this.syncRoster(); }
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

  /** `blocked` is live-reported, never written to `this.state`: the roster's recorded state and this
   *  live status are deliberately separate, because `blocked` is not terminal and syncRoster's
   *  first-terminal-wins finalize must never freeze on it. */
  status(): HostStatus {
    const first = this.parked.list()[0];
    if (first) return { state: "blocked", status: "idle", waitingFor: `permission:${first.toolName}` };
    return { state: this.state, status: this.busy ? "busy" : "idle" };
  }

  /** Ends the in-flight turn, settling parked decisions first (see stop()).
   *
   *  Probe 63 recorded a second fact worth knowing here: interrupting a turn that is parked at a
   *  `tool_use` makes the message stream **throw** rather than return a result —
   *  `Claude Code returned an error result: … stop_reason=tool_use`. So `runTask`'s catch arm runs,
   *  sets `state = "error"`, and rethrows. That is harmless *provided* the terminal state was written
   *  first: `finalizeRoster` is first-terminal-wins, so a `stop("stopped")` that already recorded
   *  `stopped` is not overwritten by the error that its own interrupt caused. Task 10 depends on this
   *  ordering — do not move `syncRoster()` after the interrupt. */
  async interrupt(): Promise<void> {
    this.parked.denyAll();
    await this.session?.interrupt?.();
  }

  /** `final` lets stop() record `stopped` while a completed run records `done`/`error`. With no argument
   *  and no finished turn the state is still `working`, and syncRoster then writes nothing down.
   *
   *  Order matters and each position is load-bearing:
   *  1. Settle parked decisions — nothing awaited may survive us.
   *  2. Write the terminal roster state — a reader must never wait on a host that is going away, and it
   *     must land BEFORE the interrupt below: interrupting a turn parked at a tool call makes the
   *     message stream throw, and runTask's catch arm then records `error` — harmless only because
   *     finalizeRoster is first-terminal-wins and `stopped` was already written.
   *  3. Interrupt the in-flight turn. This is the actual repair, not the timeout in step 4: dispose()
   *     is `input.close(); await done`, and `done` cannot resolve while a request is in flight —
   *     interrupting is what ends the turn and lets it.
   *  4. Dispose, bounded by DISPOSE_GRACE_MS. If a turn will not end even after being interrupted, we
   *     still leave rather than hang forever.
   *  5. Close the server unconditionally, OUTSIDE the race in step 4. A server left listening is a host
   *     that never exits — this used to sit behind the same await a wedged turn never satisfied, so
   *     `ccx stop` reported success over a process that lived on with its socket still answering. */
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    this.parked.denyAll();
    this.syncRoster();                     // terminal state on disk BEFORE anything that can block
    await this.session?.interrupt?.().catch(() => {});
    const graceMs = this.deps.disposeGraceMs ?? DISPOSE_GRACE_MS;
    await Promise.race([
      this.session?.dispose().catch(() => {}) ?? Promise.resolve(),
      new Promise<void>((r) => { const t = setTimeout(r, graceMs); (t as { unref?: () => void }).unref?.(); }),
    ]);
    await this.server?.close();
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

import { HostServer } from "./server.js";
import type { HostStatus } from "./ops.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL, finalizeRoster, readRoster, writeRoster } from "../fleet/roster.js";
import { procStartOf as realProcStartOf } from "../fleet/liveness.js";
import type { FleetState, RosterRow } from "../fleet/roster.js";
import { openSession as realOpenSession } from "../session/index.js";
import type { HarnessConfig } from "../config/types.js";

export interface SessionHostOpts {
  short: string; name: string; cwd: string; kind: "bg" | "interactive";
  worktree?: string; noHumanSeam?: boolean; config: HarnessConfig; env?: NodeJS.ProcessEnv;
}

/** Exactly the three members a host drives on its session — structural, not `any`, so a signature drift
 *  in `Session` fails THIS build instead of failing at runtime inside a detached process nobody watches. */
export interface HostSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<unknown>;
  readonly sessionId: string | undefined;
  dispose(): Promise<void>;
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

  constructor(private opts: SessionHostOpts,
    private deps: { openSession: (c: HarnessConfig) => HostSession; procStartOf?: (p: number) => Promise<string | undefined> }
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
      ...(this.opts.noHumanSeam ? { noHumanSeam: true } : {}),
    };
    writeRoster(row, this.env);                        // written BEFORE any session id exists
    try {
      this.session = this.deps.openSession(this.opts.config);
      this.server = new HostServer({ status: () => this.status(), stop: () => this.stop("stopped") },
        hostSocketPath(process.pid, this.env));
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
    // Stamp the roster the MOMENT the engine's session id materializes — it arrives in the init frame
    // near the start of the turn, and Session sets .sessionId before dispatching that frame here. Waiting
    // for the turn to end (all syncRoster ever did) left `agents` printing sessionId "" for the session's
    // whole life, and the consumer's uuid poller gives up after ~60s: every turn longer than that made
    // `--resume` impossible while the run itself looked fine. Once, not per message: the write is
    // read-then-write, so repeating it costs a syscall pair per frame and keeps re-opening the window in
    // which a concurrent `ccx rm` has its unlink undone.
    let stamped = false;
    const stamp = () => { if (stamped || !this.session?.sessionId) return; stamped = true; this.writeSessionId(); };
    try { await this.session!.submit(prompt, stamp); this.state = "done"; }
    catch (e) { this.state = "error"; throw e; }
    // For a BG worker the turn's completion IS the terminal event, so record it here: a host that dies
    // after the turn but before stop() then still reports `done` rather than waiting to be reaped by
    // liveness. An interactive host stays live across turns — finalize is first-terminal-wins, so
    // finalizing on turn one would freeze it at `done` while it works on turn two — it waits for stop().
    finally { this.busy = false; if (this.opts.kind === "bg") this.syncRoster(); }
  }

  status(): HostStatus { return { state: this.state, status: this.busy ? "busy" : "idle" }; }

  /** `final` lets stop() record `stopped` while a completed run records `done`/`error`. With no argument
   *  and no finished turn the state is still `working`, and syncRoster then writes nothing down. */
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    this.syncRoster();
    await this.session?.dispose().catch(() => {});
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

import { HostServer } from "./server.js";
import type { HostStatus } from "./ops.js";
import { hostSocketPath } from "../fleet/paths.js";
import { finalizeRoster, readRoster, writeRoster } from "../fleet/roster.js";
import { procStartOf as realProcStartOf } from "../fleet/liveness.js";
import type { FleetState, RosterRow } from "../fleet/roster.js";
import { openSession as realOpenSession } from "../session/index.js";
import type { HarnessConfig } from "../config/types.js";

export interface SessionHostOpts {
  short: string; name: string; cwd: string; kind: "bg" | "interactive";
  worktree?: string; noHumanSeam?: boolean; config: HarnessConfig; env?: NodeJS.ProcessEnv;
}

/** Owns one SDK session, its UDS socket, and its roster row. Live truth is answered over the socket;
 *  only the TERMINAL state is written down, because a finished process cannot be interrogated. */
export class SessionHost {
  readonly short: string;
  private session: any;
  private server?: HostServer;
  private state: FleetState = "working";
  private busy = false;
  private env: NodeJS.ProcessEnv;

  constructor(private opts: SessionHostOpts,
    private deps: { openSession: (c: HarnessConfig) => any; procStartOf?: (p: number) => Promise<string | undefined> }
      = { openSession: realOpenSession as any }) {
    this.short = opts.short;
    this.env = opts.env ?? process.env;
  }

  async start(): Promise<void> {
    // Our OWN copy of the start stamp. The engine writes one too, but unlinks it on exit — and a
    // roster row outlives that, so without this a crashed host reads live forever (see RosterRow).
    const procStart = await (this.deps.procStartOf ?? realProcStartOf)(process.pid).catch(() => undefined);
    const row: RosterRow = {
      short: this.opts.short, pid: process.pid, cwd: this.opts.cwd, kind: this.opts.kind,
      name: this.opts.name, state: "working", startedAt: Date.now(),
      ...(procStart ? { procStart } : {}),
      ...(this.opts.worktree ? { worktree: this.opts.worktree } : {}),
      ...(this.opts.noHumanSeam ? { noHumanSeam: true } : {}),
    };
    writeRoster(row, this.env);                        // written BEFORE any session id exists
    this.session = this.deps.openSession(this.opts.config);
    this.server = new HostServer({ status: () => this.status(), stop: () => this.stop("stopped") },
      hostSocketPath(process.pid, this.env));
    await this.server.listen();
  }

  async runTask(prompt: string): Promise<void> {
    this.busy = true; this.state = "working";
    try { await this.session.submit(prompt, () => {}); this.state = "done"; }
    catch (e) { this.state = "error"; throw e; }
    finally { this.busy = false; this.syncRoster(); }
  }

  status(): HostStatus { return { state: this.state, status: this.busy ? "busy" : "idle" }; }

  /** `final` lets stop() record `stopped` while a completed run records `done`/`error`. */
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    this.syncRoster();
    await this.session?.dispose?.().catch?.(() => {});
    await this.server?.close();
  }

  /** The session id lands here, not at start(): the engine only reports one once its first turn's
   *  init frame arrives, and a listing must be able to find this host before that. */
  private syncRoster(): void {
    const sid = this.session?.sessionId;
    if (sid) {
      const r = readRoster(this.opts.short, this.env);
      if (r) writeRoster({ ...r, sessionId: sid }, this.env);
    }
    finalizeRoster(this.opts.short, this.state, this.env);
  }
}

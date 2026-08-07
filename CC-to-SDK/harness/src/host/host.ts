import { HostServer } from "./server.js";
import type { ControlOp, HostStatus } from "./ops.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL, finalizeRoster, readRoster, writeRoster } from "../fleet/roster.js";
import { procStartOf as realProcStartOf } from "../fleet/liveness.js";
import type { FleetState, RosterRow } from "../fleet/roster.js";
import { openSession as realOpenSession } from "../session/index.js";
import { resolvedModel, resolvedPermissionMode } from "../config/resolveOptions.js";
import { isAutoSupportedModel, resolveAutoModel } from "../config/autoModel.js";
import { resolveModelAlias } from "../config/models.js";
import type { HarnessConfig } from "../config/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import { rewindAnchorsFrom } from "../sessions/rows.js";
import { getSessionMessages as realGetMessages } from "../sessions/index.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
import { TurnBuffer } from "./follow.js";
import type { HostEvent } from "./wire.js";
import { PendingDecisions } from "../permissions/pending.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { PermissionBroker, PermissionRequest, DecisionOutcome, DecisionKind, PlanGrantMode } from "../permissions/types.js";

export interface SessionHostOpts {
  short: string; name: string; cwd: string; kind: "bg" | "interactive";
  // REQUIRED, not defaulted: a defaulted boolean is exactly how a bg worker would silently lose its park
  // (spec A2b §4). true means "surviving unattended is the point" (every bg host, plus a --detachable
  // interactive one); false means an in-process host whose UI going away leaves nobody to answer.
  detached: boolean;
  // Only meaningful on a detachable host — see armIdle()'s doc. Absent = no idle reaper.
  idleTimeoutMs?: number;
  worktree?: string; config: HarnessConfig; env?: NodeJS.ProcessEnv;
}

/** How long stop() will wait for a well-behaved dispose after the turn has been interrupted. Generous
 *  enough that the normal path always completes inside it, short enough that a wedged turn does not
 *  keep a detached process alive for the rest of the day. */
const DISPOSE_GRACE_MS = 5_000;

/** The members a host drives on its session — the 3 core ones plus the 10 optional A2b control members
 *  below — structural, not `any`, so a signature drift in `Session` fails THIS build instead of failing
 *  at runtime inside a detached process nobody watches. */
export interface HostSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<unknown>;
  readonly sessionId: string | undefined;
  dispose(): Promise<void>;
  // `unknown`, not `void` — the real Session.interrupt() returns Promise<unknown>, and a Promise<void>
  // declaration here makes the default `openSession: realOpenSession` stop type-checking.
  interrupt?(): Promise<unknown>;
  // The A2b control-op surface — exact signatures from ChatSession, all optional so every existing
  // HostSession fake (host-session/host-follow/host-busy-gate/host-park/host-teardown fixtures) stays
  // valid without modification.
  setModel?(model?: string): Promise<void>;
  setPermissionMode?(mode: string): Promise<void>;
  setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
  capabilities?(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
  compact?(): Promise<unknown>;
  usage?(): Promise<unknown>;
  getContextUsage?(): Promise<unknown>;
  mcpServerStatus?(): Promise<unknown[]>;
  reconnectMcpServer?(name: string): Promise<void>;
  toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
  // GB T4: the background-task surface — all optional, so every existing HostSession fake stays valid.
  onFrame?(cb: (m: unknown) => void): () => void;
  listBackgroundTasks?(): Promise<BackgroundTaskInfo[]>;
  backgroundAll?(toolUseId?: string): Promise<boolean>;
  stopTask?(taskId: string): Promise<void>;
  // C5 T2: the real Session.rewind (src/session/session.ts:184) already matches this signature.
  rewind?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>;
  // W3 T1: the settings/dirs surface. applyFlagSettings replaces whole top-level keys per call
  // (probe 75) — the host never sends a partial object. getSettings is the untyped get_settings door.
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>;
  getSettings?(): Promise<unknown>;
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
  // True for the ENTIRE duration of rewind()/resumeSession() — both awaited across the engine's dry run,
  // its real file restore, and the engine swap itself. Without this, the `prompt` op's gate (busy(), read
  // by server.ts BEFORE it calls runTask) is false throughout that whole window — turnInFlight alone says
  // nothing about a swap in progress — so a second attached client's prompt arriving mid-rewind starts a
  // turn on the OLD engine (the model reasons over the pre-rewind conversation while the working tree has
  // already been reverted), and swapEngine then resets the turn buffer and disposes that engine out from
  // under the still-running turn. Set for the whole method body and cleared in a `finally` — a `finally`
  // is load-bearing: a rewind that throws must not leave this stuck true forever, or the host would wedge
  // every later prompt behind a busy error nothing will ever clear.
  private swapInFlight = false;
  // Monotonic per-host turn counter. A client's `prompt` reply carries the seq its submit() started
  // (server.ts), and every `turn` event this turn emits carries the same seq — the correlation a
  // follower/adapter needs to tell "this turn's end" from "some other turn's end" apart (Task 5).
  private turnSeq_ = 0;
  turnSeq(): number { return this.turnSeq_; }
  private env: NodeJS.ProcessEnv;
  private followers = new Set<(ev: HostEvent) => void>();
  private turnBuffer = new TurnBuffer({ maxMessages: 500, maxBytes: 1024 * 1024 });
  // "never": a background host parks until a human answers, which is the entire point of a worker that
  // outlives the terminal that spawned it. The interactive case is handled by the detachedness rule in
  // broker(), not by a timer — a timer is how "the human is thinking" becomes "the human said no".
  private parked = new PendingDecisions({
    expireAfterMs: "never",
    // An SDK-side abort (NOT our own interrupt()/stop(), which settle via settleParkedForSystem below)
    // used to vanish silently — the client's dialog stayed up forever waiting on a park nobody would ever
    // answer. This is the NEW wiring (spec: interrupt-path emit) that tells a follower it is gone.
    onAutoSettle: (e) => {
      this.settledBy.set(e.toolUseID, "system");
      this.emit({ kind: "decision_settled", toolUseID: e.toolUseID, by: "system", decision: "deny" });
      this.emit({ kind: "state", status: this.status() });
    },
  });
  // Who answered what, so a second answerer can be told. A host that runs for days would otherwise
  // accumulate one entry per decision for its whole life.
  private settledBy = new Map<string, string>();
  // The mode an approved plan GRANTED, set when the plan_approve settles and consumed by the status-frame
  // handler. Undefined = nothing armed, which includes a `default` grant: the engine flips there by itself
  // ten milliseconds after the allow (probe 97), so there is nothing for us to set.
  private planUpgradeMode?: PlanGrantMode;
  // ONE source of truth for the engine's permission mode; last-write-wins between an intercepted CLI
  // `status` frame and a successful set_permission_mode/plan-upgrade setter (spec §mode-sync). Seeded
  // from resolvedPermissionMode in start(), before this default is ever read.
  private mode = "default";
  // ONE source of truth for the engine's MODEL, on the same rule: seeded from the launch config in start()
  // and rewritten by a successful set_model. Read by the plan-upgrade applier alone — `auto` is model-gated
  // (autoModel.ts) and needs a supported model under it before the mode is worth setting.
  private model?: string;
  // Nested tool_use id → parent Agent tool_use id (from nested assistant frames' parent_tool_use_id).
  private parentOf = new Map<string, string>();
  // Agent tool_use id → subagent_type (from task_started frames).
  private subagentOf = new Map<string, string>();
  // REPLACE snapshot of the live background-task set — the last background_tasks_changed frame the
  // session's onFrame delivered (probe 39: never merge). Read by the `tasks` op and replayed to a
  // follower that joins after the frame already fired.
  private bgTasks: BackgroundTaskInfo[] = [];
  // Unsubscribe from the CURRENT session's onFrame — re-pointed at the fresh session on resumeSession
  // (see there for why: the swap replaces `this.session` with a subscriber set of zero).
  private offFrame?: () => void;
  // W3 T1: the host OWNS the dynamic flag-settings state. applyFlagSettings replaces whole top-level
  // keys per call (probe 75), and a resumed session is a NEW CLI process with an empty flag layer —
  // both make a client-side "just call the engine" design wrong. Single accumulator, always sent whole.
  private flagPerms = { allow: [] as string[], ask: [] as string[], deny: [] as string[], additionalDirectories: [] as string[] };
  private flagOutputStyle?: string;

  private finishedResolve!: () => void;
  /** Resolves when teardown completes (server closed). runHostMain awaits this for interactive hosts. */
  readonly finished: Promise<void> = new Promise((r) => { this.finishedResolve = r; });

  private idleTimer?: ReturnType<typeof setTimeout>;
  /** Arm (or re-arm) the idle stop. Only ever configured for detachable hosts; a parked turn never idles
   *  out because turnInFlight spans the park, and the timer is only armed when a turn is NOT in flight.
   *  A LIVE CONNECTION also defers it: the reaper ends unattended idle sessions — an attached client
   *  reading the transcript is not "idle beyond the timeout" in any sense the operator meant. */
  private armIdle(): void {
    if (!this.opts.idleTimeoutMs) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if ((this.server?.connectionCount() ?? 0) > 0) { this.armIdle(); return; }
      void this.stop("done");
    }, this.opts.idleTimeoutMs);
    (this.idleTimer as { unref?: () => void }).unref?.();
  }

  constructor(private opts: SessionHostOpts,
    private deps: { openSession: (c: HarnessConfig) => HostSession; procStartOf?: (p: number) => Promise<string | undefined>;
      /** Test-only override for DISPOSE_GRACE_MS — otherwise every wedged-dispose test burns the real
       *  grace period in a suite that runs on every commit. */
      disposeGraceMs?: number;
      /** Test seam for rewindAnchors' transcript read — defaults to the real getSessionMessages. */
      getMessages?: (id: string, opts: { cwd?: string }) => Promise<any[]> }
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
    // Seed the mode truth from the SAME config the engine is about to be opened with — before opening
    // it, so a fresh client's status bar never shows a placeholder (spec §mode-sync).
    this.mode = resolvedPermissionMode(this.opts.config);
    this.model = resolvedModel(this.opts.config);
    try {
      this.session = this.deps.openSession(this.engineConfig());
      this.offFrame = this.session.onFrame?.((m) => this.onSessionFrame(m));
      this.server = new HostServer({
        status: () => this.status(),
        busy: () => this.busy(),
        stop: () => this.stop("stopped"),
        pending: () => this.pending(),
        answer: (id, d, by) => this.answer(id, d, by),
        prompt: (text) => this.runTask(text),
        interrupt: () => this.interrupt(),
        // One follower per connection, delivering to that connection's sink. The server owns the
        // sockets and counts them (the deny rule reads THAT count, not the follower set — see broker()).
        follow: (deliver) => this.follow(deliver),
        control: (op) => this.control(op),
        resume: (sid) => this.resumeSession(sid),
        clear: () => this.clearSession(),
        turnSeq: () => this.turnSeq(),
        tasks: () => this.bgTasks,
        background: (toolUseId) => this.background(toolUseId),
        stopTask: (taskId) => this.stopBgTask(taskId),
        rewindAnchors: () => this.rewindAnchors(),
        rewindDryRun: (uuid) => this.rewindDryRun(uuid),
        rewind: (anchor, scope) => this.rewind(anchor, scope),
        getSettings: () => this.getSettings(),
        listDirs: () => this.listDirs(),
        addDir: (path) => this.addDir(path),
        removeDir: (path) => this.removeDir(path),
        setOutputStyle: (style) => this.setOutputStyle(style),
        addRule: (behavior, rule) => this.addRule(behavior, rule),
        removeRule: (behavior, rule) => this.removeRule(behavior, rule),
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
    this.armIdle();
  }

  /** A second call while a turn is already running MUST be refused here, not merely by the socket's own
   *  gate: this method is public and reachable directly (RemoteChatSession.prompt() is one caller, not
   *  the only one), and trusting every caller to check first is how the socket bug shipped. Re-entering
   *  would reset() the turn buffer out from under a turn that is still delivering messages to followers —
   *  a client attaching afterwards would be replayed zero messages, the exact regression the buffer
   *  exists to prevent. */
  async runTask(prompt: string): Promise<void> {
    if (this.turnInFlight) throw new Error(`host ${this.short} is already running a turn`);
    clearTimeout(this.idleTimer);   // a turn (including any park inside it) must never idle out
    this.turnInFlight = true; this.state = "working";
    const seq = ++this.turnSeq_;
    this.turnBuffer.reset(); this.settledBy.clear();
    this.parentOf.clear(); this.subagentOf.clear();   // attribution is per-turn (spec §attribution)
    this.emit({ kind: "turn", phase: "start", seq });
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
      // stream_event partials fan out LIVE only. With the interactive engine now streaming partials
      // (F3 t3), a turn carries thousands of token-delta frames; through the 500-message TurnBuffer
      // they would evict the turn's REAL frames, so a mid-turn attach replayed stale partials plus
      // the truncation banner. A late follower cannot use a partial anyway — its LiveTurn missed the
      // deltas before the join, and the completed message supersedes them all.
      if ((m as { type?: unknown } | null)?.type !== "stream_event") this.turnBuffer.push(m);
      this.emit({ kind: "message", data: m });
    };
    // A bg worker's success IS the terminal event — `done`. An interactive host stays LIVE across
    // turns instead: `working`, the same state start() wrote, so it is ready for the next runTask()
    // rather than frozen at a state that reads like the whole session is over.
    try {
      await this.session!.submit(prompt, onMessage);
      // Turn-end belt: an approved plan that settled but never saw the CLI's own post-approval status
      // frame (e.g. the turn ended before the CLI emitted one) must still upgrade — never leave an
      // approved upgrade silently unapplied (spec §mode-sync ordering).
      await this.applyPlanUpgrade();
      this.state = this.opts.kind === "bg" ? "done" : "working";
    }
    catch (e) {
      // A failed/interrupted turn must not leave a stale approved-upgrade that fires at the NEXT turn's
      // status frame (plan-review M2) — the plan this upgrade belonged to did not survive the turn.
      this.planUpgradeMode = undefined;
      this.state = "error"; this.emit({ kind: "turn", phase: "end", seq, error: (e as Error)?.message }); throw e;
    }
    // For a BG worker the turn's completion IS the terminal event, so record it here: a host that dies
    // after the turn but before stop() then still reports `done` rather than waiting to be reaped by
    // liveness. An interactive host stays live across turns — finalize is first-terminal-wins, so
    // finalizing on turn one would freeze it at `done` while it works on turn two — it waits for stop().
    finally { this.turnInFlight = false; if (this.opts.kind === "bg") this.syncRoster(); this.armIdle(); }
    this.emit({ kind: "turn", phase: "end", seq });
  }

  /** Dispatch one A2b control op onto the underlying session. Every member is OPTIONAL on HostSession,
   *  so an absent one throws a named error here rather than a bare TypeError — the server's dispatch
   *  catch (see server.ts) turns that into an `{ok:false, error:…}` reply instead of crashing the
   *  connection. */
  async control(op: ControlOp): Promise<Record<string, unknown>> {
    const s = this.session;
    const need = <T>(v: T | undefined, name: string): T => { if (!v) throw new Error(`${name} unsupported by this host`); return v; };
    switch (op.op) {
      // The model truth moves only after the engine took it — same rule as set_permission_mode below.
      case "set_model": await need(s?.setModel?.bind(s), "set_model")(op.model); this.model = resolveModelAlias(op.model); return { ok: true };
      case "set_permission_mode": {
        await need(s?.setPermissionMode?.bind(s), "set_permission_mode")(op.mode);
        this.mode = op.mode;                                      // our own successful set is the second writer
        this.emit({ kind: "state", status: this.status() });
        return { ok: true };
      }
      case "set_thinking": await need(s?.setMaxThinkingTokens?.bind(s), "set_thinking")(op.maxTokens); return { ok: true };
      case "capabilities": return { ok: true, ...await need(s?.capabilities?.bind(s), "capabilities")() };
      case "compact": return { ok: true, outcome: await need(s?.compact?.bind(s), "compact")() };
      case "usage": return { ok: true, usage: await need(s?.usage?.bind(s), "usage")() };
      case "context_usage": return { ok: true, usage: await need(s?.getContextUsage?.bind(s), "context_usage")() };
      case "mcp_status": return { ok: true, servers: await need(s?.mcpServerStatus?.bind(s), "mcp_status")() };
      case "mcp_reconnect": await need(s?.reconnectMcpServer?.bind(s), "mcp_reconnect")(op.name); return { ok: true };
      case "mcp_toggle": await need(s?.toggleMcpServer?.bind(s), "mcp_toggle")(op.name, op.enabled); return { ok: true };
    }
  }

  /** Swap the underlying engine for a fresh open carrying `extra` (resume / resumeAt). Everything
   *  session-scoped resets with it; the swap opens at the CURRENT runtime mode (`this.mode`) — see
   *  resumeSession's doc for why launch-config would be the worse surprise. Shared by resumeSession
   *  and rewind (the conversation-restore engine swap). */
  /** The config every engine this host opens is built from — `start()` and `swapEngine()` both, so a
   *  /resume or a rewind can never quietly drop something the first engine had.
   *
   *  F3 Task 3: `includePartialMessages` is opt-in in `resolveOptions` and no interactive front door set
   *  it, so the shipped REPL received no `stream_event` frames at all — its streaming partial region
   *  rendered nothing and the thinking clock had no duration source whatsoever (P82: the only anchors
   *  that exist are the LOCAL ARRIVAL of `content_block_start`/`content_block_stop`, which travel on
   *  exactly those frames). Both interactive front doors — the in-process foreground host and the
   *  detached `--detachable` one a `ccx attach` client drives — are `kind:"interactive"`, and nothing
   *  headless is, so keying on the kind turns the frames on for every TUI session while leaving `--bg`
   *  workers' (and every library caller's) wire volume untouched. An explicit config value still wins in
   *  both directions: this is a default, not an override. */
  private engineConfig(extra: Partial<HarnessConfig> = {}): HarnessConfig {
    const partials = this.opts.kind === "interactive" ? { includePartialMessages: this.opts.config.includePartialMessages ?? true } : {};
    return { ...this.opts.config, ...partials, ...extra, permissionBroker: this.broker() };
  }

  private async swapEngine(extra: Partial<HarnessConfig>): Promise<void> {
    const old = this.session;
    // Open the resumed engine at the CURRENT runtime mode (`this.mode`), not the launch config's. `this.mode`
    // is the one field every writer (status-frame intercept, set_permission_mode, plan-upgrade) keeps
    // truthful for exactly this purpose — a Tab-laddered or plan-earned mode is live user intent, and
    // /resume is "same conversation continues," not "reset to launch config." Silently reverting it here
    // (re-seeding from resolvedPermissionMode instead) would be the OTHER obvious fix, but it throws away a
    // choice the user just made with no notice — the worse surprise of the two. This keeps the host's
    // reported mode and the engine's actual mode in agreement, which is the one invariant that must hold.
    this.session = this.deps.openSession(this.engineConfig({ ...extra, permissionMode: this.mode as HarnessConfig["permissionMode"] }));
    this.turnBuffer.reset(); this.settledBy.clear();
    this.parentOf.clear(); this.subagentOf.clear();   // the old session's attribution is gone with it
    // Plan-review I1: the swap replaces `this.session` with a fresh Session whose subscriber set is
    // empty — without re-pointing onFrame here, mode sync, the tasks panel, and attribution all
    // silently die after a /resume, a shipped surface.
    this.offFrame?.();
    this.offFrame = this.session.onFrame?.((m) => this.onSessionFrame(m));
    // W3 T1: the new CLI process starts with an empty flag layer — re-push whatever this host has
    // accumulated (dirs/rules/output-style) BEFORE the old session's dispose, so a fresh attach or a
    // turn on the new engine never observes a mid-swap window with the grants silently dropped.
    await this.replayFlagState();
    this.bgTasks = []; this.emit({ kind: "tasks_changed", tasks: [] });   // the old session's tasks are gone
    this.planUpgradeMode = undefined;                                      // (field exists from T3)
    this.emit({ kind: "state", status: this.status() });
    const graceMs = this.deps.disposeGraceMs ?? DISPOSE_GRACE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((r) => { timer = setTimeout(r, graceMs); (timer as { unref?: () => void }).unref?.(); });
    await Promise.race([old?.dispose().catch(() => {}) ?? Promise.resolve(), deadline]);
    clearTimeout(timer);
  }

  /** Re-send whatever the host has accumulated to a NEW engine process (a resumed/rewound session
   *  starts with an empty flag layer — see swapEngine). Called from INSIDE swapEngine, after the new
   *  engine session is live; swapEngine is the single seam both resumeSession and rewind go through. */
  private async replayFlagState(): Promise<void> {
    const hasPerms = Object.values(this.flagPerms).some((a) => a.length);
    if (hasPerms) await this.session?.applyFlagSettings?.({ permissions: { ...this.flagPerms } });
    if (this.flagOutputStyle) await this.session?.applyFlagSettings?.({ outputStyle: this.flagOutputStyle });
  }

  /** Apply + commit one whole permissions object. Commit ONLY after the engine accepts it — a rejected
   *  grant (a denied add_dir, say) must not leave a phantom row in the accumulator that a later replay
   *  would then re-push as if it had succeeded (retry-safety). */
  private async pushFlagPerms(next: typeof this.flagPerms): Promise<void> {
    await this.session?.applyFlagSettings?.({ permissions: { ...next } });
    this.flagPerms = next;
  }
  async addDir(path: string): Promise<void> {
    if (this.flagPerms.additionalDirectories.includes(path)) return;
    await this.pushFlagPerms({ ...this.flagPerms, additionalDirectories: [...this.flagPerms.additionalDirectories, path] });
  }
  async removeDir(path: string): Promise<void> {
    await this.pushFlagPerms({ ...this.flagPerms, additionalDirectories: this.flagPerms.additionalDirectories.filter((d) => d !== path) });
  }
  async addRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void> {
    if (this.flagPerms[behavior].includes(rule)) return;
    await this.pushFlagPerms({ ...this.flagPerms, [behavior]: [...this.flagPerms[behavior], rule] });
  }
  async removeRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void> {
    await this.pushFlagPerms({ ...this.flagPerms, [behavior]: this.flagPerms[behavior].filter((r) => r !== rule) });
  }
  async setOutputStyle(style: string): Promise<void> {
    await this.session?.applyFlagSettings?.({ outputStyle: style });
    this.flagOutputStyle = style;
  }
  /** cwd first (it is implicit, always granted), then the launch config's static list, then this
   *  host's own session-scoped grants — the three sources /add-dir's UI needs to tell apart. */
  listDirs(): { path: string; source: "cwd" | "launch" | "session" }[] {
    return [
      { path: this.opts.cwd, source: "cwd" as const },
      ...(this.opts.config.additionalDirectories ?? []).map((d) => ({ path: d, source: "launch" as const })),
      ...this.flagPerms.additionalDirectories.map((d) => ({ path: d, source: "session" as const })),
    ];
  }
  /** Untyped get_settings passthrough (probe 75 Q5). Throws a named error when unsupported, same as
   *  the other session-member passthroughs (background/stopBgTask) — dispatch's catch turns it into
   *  `{ok:false, error:…}`. */
  async getSettings(): Promise<unknown> {
    const fn = this.session?.getSettings?.bind(this.session);
    if (!fn) throw new Error("get_settings unsupported by this host");
    return fn();
  }

  /** Swap the underlying SDK session for a resume of `sessionId`. Interactive /resume path — refused
   *  mid-turn for the same reason a second prompt is. The old session's dispose is bounded by the same
   *  grace as teardown: an idle dispose resolves immediately, but this must never hang the socket op. */
  async resumeSession(sessionId: string): Promise<void> {
    if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
    this.swapInFlight = true;
    try { await this.swapEngine({ resume: sessionId }); }
    finally { this.swapInFlight = false; }
  }

  /** The engine half of /clear (live-feedback fix, 2026-08-06): a fresh conversation through the same
   *  swap seam resume/rewind use. The explicit `resume: undefined` matters — engineConfig spreads the
   *  LAUNCH config first, so a host born from `ccx --resume <sid>` still carries that key, and without
   *  the override a /clear would silently reopen the very conversation it was asked to drop. */
  async clearSession(): Promise<void> {
    if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
    this.swapInFlight = true;
    try { await this.swapEngine({ resume: undefined, resumeAt: undefined }); }
    finally { this.swapInFlight = false; }
  }

  /** Subscribe to the live turn. The new follower is replayed the turn so far FIRST, synchronously, so
   *  it never sees message 3 before messages 1 and 2. Returns its own unsubscribe. */
  follow(cb: (ev: HostEvent) => void): () => void {
    const snap = this.turnBuffer.snapshot();
    // A follower joining MID-TURN must be told a turn is open, or every replayed and live message of this
    // turn reaches a client with no LiveTurn to render into. An IDLE attach deliberately gets no start
    // frame: the buffer still holds the last COMPLETED turn, whose content the disk replay already covers —
    // no start frame means the REPL's no-live-turn guard drops it, which is the dedup (probe 62: the disk
    // gains a turn only at turn end, so mid-turn buffer content never overlaps disk).
    if (this.turnInFlight) this.deliver(cb, { kind: "turn", phase: "start", seq: this.turnSeq_, ...(snap.truncated ? { truncated: true } : {}) });
    // NOT in flight: the buffer holds the last COMPLETED turn. The truncation flag still has to reach
    // the client or it is a promise we do not keep — a follower shown a partial turn with no marker
    // reads it as the whole turn — so a truncated idle replay keeps the old bare start frame.
    else if (snap.truncated) this.deliver(cb, { kind: "turn", phase: "start", truncated: true });
    // MARKED as replay: every one of these is buffered history, and a joiner that stamped them with its own
    // arrival clock would fabricate durations for work that finished before it connected (wire.ts's note).
    for (const m of snap.messages) this.deliver(cb, { kind: "message", data: m, replay: true });
    // A request parked before this follower attached is otherwise invisible to it forever: the
    // `decision` event fires exactly once, at park time, over the followers registered at that
    // instant. A socket-borne follower's registration is not synchronous with its client's `follow()`
    // call (it lands after an async round trip), so without this replay a client that raced a parked
    // decision — or one that simply reconnects — would see it only through the separate `pending()`
    // poll, never through the live stream it otherwise relies on.
    for (const entry of this.parked.list()) this.deliver(cb, { kind: "decision", entry });
    // The live background-task snapshot, if any: a follower joining after the last change would
    // otherwise never learn a task is running until the NEXT change fires (or never, if there is none).
    if (this.bgTasks.length) this.deliver(cb, { kind: "tasks_changed", tasks: this.bgTasks });
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

  /** Every session frame, waiter or not (Session.onFrame). Task events and the tasks snapshot are emitted
   *  from HERE, not from runTask's onMessage: between turns there is no waiter, and a bg task finishing
   *  while the host idles must still reach an attached client (spec §background). */
  private onSessionFrame(m: unknown): void {
    const mm = m as any;
    if (mm?.type === "system" && mm.subtype === "background_tasks_changed") {
      this.bgTasks = mm.tasks ?? [];                                     // REPLACE, never merge (probe 39)
      this.emit({ kind: "tasks_changed", tasks: this.bgTasks });
      return;
    }
    // Task lifecycle frames arrive with either a bare type tag or as a system subtype depending on SDK
    // path — match both, deterministically (spec §attribution note; acceptance ③ pins the live shape).
    const sub = mm?.type === "system" ? mm.subtype : mm?.type;
    // Attribution capture happens FIRST, ahead of the task-lifecycle re-emit below, so a task_started
    // frame both feeds subagentOf AND is re-emitted as a `task` event.
    if (mm?.type === "assistant" && mm.parent_tool_use_id) {
      for (const b of mm.message?.content ?? []) if (b?.type === "tool_use" && b.id) this.parentOf.set(String(b.id), String(mm.parent_tool_use_id));
    }
    if (sub === "task_started" && mm.tool_use_id && mm.subagent_type) this.subagentOf.set(String(mm.tool_use_id), String(mm.subagent_type));
    if (mm?.type === "system" && mm.subtype === "status" && typeof mm.permissionMode === "string") {
      this.mode = mm.permissionMode;
      // The upgrade is triggered by OBSERVING this frame, never by answer release — the CLI's own flip
      // rides the message stream and an eager setter would race it (spec §mode-sync ordering).
      if (this.planUpgradeMode) void this.applyPlanUpgrade();
      else this.emit({ kind: "state", status: this.status() });
      return;
    }
    if (sub === "task_started" || sub === "task_notification" || sub === "task_progress" || sub === "task_updated") {
      this.emit({ kind: "task", data: m });
      return;
    }
  }

  /** Apply an armed plan upgrade, once — a no-op unless one is armed, so the status-frame watcher and the
   *  turn-end belt can both call it.
   *
   *  TWO THINGS THIS MUST NOT DO, both of which it used to (Wave T t10, the qa3-17 / qa3-02 pair):
   *  · GRANT `auto` WITHOUT A MODEL THAT CAN RUN IT. `auto` is model-gated (autoModel.ts, probe 72 for the
   *    set): off its supported set the engine REFUSES the mode — probe 99 measured the setter REJECTING
   *    ("Cannot set permission mode to auto: auto mode unavailable for this model") with the next init
   *    still on the old mode. So granting auto unswapped does not downgrade the session, it fails to move
   *    it at all and the upgrade the human approved is lost. Swap first, the same order and for the same
   *    reason as useChat's applyMode.
   *  · SWALLOW A REFUSAL. A rejected setter left `this.mode` at whatever the status frame wrote — correct —
   *    but said nothing, so an upgrade the human explicitly approved could vanish with no trace anywhere.
   *    The mode truth still only moves on success; the failure is now reported. */
  private async applyPlanUpgrade(): Promise<void> {
    const mode = this.planUpgradeMode;
    if (!mode) return;
    this.planUpgradeMode = undefined;
    if (mode === "auto" && this.model !== undefined && !isAutoSupportedModel(this.model)) {
      const target = resolveAutoModel(this.model);
      try { await this.session?.setModel?.(target); this.model = target; }
      catch (e) { console.error(`cc-harness host ${this.opts.short}: plan approved auto mode but the model swap to ${target} failed (${(e as Error)?.message ?? e}) — the engine will refuse auto on ${this.model}`); }
    }
    // The NO-SWAP arm, and why it still speaks. `this.model` is undefined on a host whose config named no
    // model — and stays that way after a `{op:"set_model"}` carrying none (ops.ts:43 declares the field
    // optional). Not swapping is deliberate, the same call useChat.applyMode makes (:1450-1453): resolving
    // an unknown model to DEFAULT_AUTO_MODEL would downgrade a session the user configured on purpose. But
    // useChat pairs that refusal with a visible notice, and so does this line: the grant below is real but
    // UNVERIFIED, and an unsupported model makes the setter reject (probe 99) — a refusal the human hears.
    if (mode === "auto" && this.model === undefined) console.error(`cc-harness host ${this.opts.short}: plan approved auto mode but this client's model can't be checked — if it doesn't support auto the engine will refuse the mode`);
    try { await this.session?.setPermissionMode?.(mode); this.mode = mode; }
    catch (e) { console.error(`cc-harness host ${this.opts.short}: plan approved ${mode} but the engine refused it (${(e as Error)?.message ?? e}) — the session stays in ${this.mode}`); }
    this.emit({ kind: "state", status: this.status() });
  }

  /** Ctrl+B passthrough: background in-flight foreground tasks on the underlying session. Throws a
   *  named error (dispatch's catch turns it into `{ok:false, error:…}`, see server.ts) when the session
   *  lacks the member — same shape as control()'s `need`. */
  async background(toolUseId?: string): Promise<boolean> {
    const fn = this.session?.backgroundAll?.bind(this.session);
    if (!fn) throw new Error("background unsupported by this host");
    return fn(toolUseId);
  }

  /** Stop one running background task on the underlying session. */
  async stopBgTask(taskId: string): Promise<void> {
    const fn = this.session?.stopTask?.bind(this.session);
    if (!fn) throw new Error("stop_task unsupported by this host");
    await fn(taskId);
  }

  /** User-prompt rewind anchors from the persisted transcript — always re-read, never cached (probe
   *  68 Q4: post-rewind row counts defy local arithmetic; the transcript is the truth). */
  async rewindAnchors(): Promise<RewindAnchor[]> {
    const sid = this.session?.sessionId;
    if (!sid) return [];
    const rows = await (this.deps.getMessages ?? realGetMessages)(sid, { cwd: this.opts.cwd });
    return rewindAnchorsFrom(rows);
  }

  /** dryRun on the FILE anchor. Normalizes the throw-vs-return split (probe 68d): checkpointing-off
   *  makes dryRun RETURN {canRewind:false} but other failures (and older engines) THROW — callers get
   *  one shape either way. */
  async rewindDryRun(uuid: string): Promise<RewindDryRun> {
    const fn = this.session?.rewind?.bind(this.session);
    if (!fn) return { canRewind: false, error: "rewind unsupported by this host" };
    try { return (await fn(uuid, { dryRun: true })) as RewindDryRun; }
    catch (e) { return { canRewind: false, error: (e as Error).message }; }
  }

  /** Esc-Esc rewind. VALIDATION FIRST, THEN SIDE EFFECTS: the null-prevUuid refusal below runs before the
   *  file-restore block even though it only governs the LATER conversation-swap step — a `both`-scope
   *  rewind whose anchor has no prevUuid (the first prompt, or the first prompt after a compaction
   *  boundary) must be refused before the real, filesystem-mutating file rewind runs, or the caller sees
   *  a rejection implying nothing happened while the working tree was already reverted with no matching
   *  conversation swap. ORDER IS OTHERWISE LOAD-BEARING: file restore runs on the LIVE engine first
   *  (probe 68d: rewindFiles needs the open transport), THEN the conversation swap replaces the engine.
   *  The dry-run guard exists because with checkpointing off the real call THROWS where dryRun merely
   *  reports (probe 68d) — never reach the throwing call with a known-bad state. Live background tasks
   *  die with the swap (they belong to the old CLI process): announce, then clear via swapEngine. */
  async rewind(anchor: { uuid: string; prevUuid: string | null }, scope: RewindScope): Promise<void> {
    if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
    if (this.parked.list().length) throw new Error("a decision is pending — answer it first");
    const sid = this.session?.sessionId;
    if (!sid) throw new Error("no session to rewind");
    // A code-only rewind is legitimate for a null-prevUuid anchor — that is the intended degradation —
    // so this is gated on `scope !== "code"`, same as the conversation-swap step it protects.
    if (scope !== "code" && !anchor.prevUuid) throw new Error("no conversation anchor before the first prompt — code-only rewind is available");
    // Spans the dry run, the real file restore, AND the engine swap — the whole window server.ts's
    // `prompt` gate must see as busy (see the field doc above). `finally` guarantees it clears even on a
    // throw from the dry run, the real restore, or the swap itself.
    this.swapInFlight = true;
    try {
      if (scope !== "conversation") {
        const dry = await this.rewindDryRun(anchor.uuid);
        if (!dry.canRewind) throw new Error(dry.error ?? "file rewind unavailable");
        const fn = this.session?.rewind?.bind(this.session);
        if (!fn) throw new Error("rewind unsupported by this host");
        await fn(anchor.uuid);
      }
      if (scope !== "code") {
        if (this.bgTasks.length) this.emit({ kind: "task", data: { type: "task_notification", status: "stopped", task_id: "rewind", summary: "background tasks ended by rewind" } });
        await this.swapEngine({ resume: sid, resumeAt: anchor.prevUuid as string });
        // Broadcast so EVERY attached client rebuilds, not just the one that confirmed (see wire.ts).
        this.emit({ kind: "rewound", sessionId: this.session?.sessionId ?? sid, ...(anchor.prevUuid ? { prevUuid: anchor.prevUuid } : {}) });
      }
    } finally {
      this.swapInFlight = false;
    }
  }

  /** The permission seam this host exposes to its SDK session (wired as `config.permissionBroker`).
   *
   *  The interactive rule is evaluated HERE, when the request arrives — never retroactively when a
   *  follower leaves. An interactive session whose human is gone denies rather than hanging; but a
   *  request already parked stays parked through a detach, because detaching is what a human does in
   *  order to go and think about it (spec acceptance 6). */
  broker(): PermissionBroker {
    return {
      request: async (req: PermissionRequest): Promise<DecisionOutcome> => {
        // Detachedness, not kind, decides (spec A2b §4): a detached host's purpose is surviving
        // unattended — park. An in-process host whose UI is gone has nobody left to answer — deny.
        // Counted on CONNECTIONS, not followers: a client that connected but has not (yet) followed is
        // still a present human.
        if (!this.opts.detached && (this.server?.connectionCount() ?? 0) === 0) return { kind: "deny" };
        // A map miss parks unattributed, never blocks — attribution is best-effort (spec §attribution).
        const parentToolUseID = this.parentOf.get(req.toolUseID);
        const subagentType = parentToolUseID ? this.subagentOf.get(parentToolUseID) : undefined;
        const decision = this.parked.brokerFor(this.short).request({ ...req, ...(parentToolUseID ? { parentToolUseID } : {}), ...(subagentType ? { subagentType } : {}) });
        const entry = this.parked.list().find((e) => e.toolUseID === req.toolUseID);
        if (entry) this.emit({ kind: "decision", entry });
        this.emit({ kind: "state", status: this.status() });
        return decision;
      },
    };
  }

  pending(): PendingDecision[] { return this.parked.list(); }

  /** Which outcome kinds each parked kind may settle with. `deny` is universal (system teardown, and a
   *  human declining any of the three, settle the same way); everything else is kind-specific — a
   *  question park cannot be answered with a bare permission decision, and vice versa. */
  private static readonly KIND_ANSWERS: Record<DecisionKind, ReadonlySet<string>> = {
    permission: new Set(["allow_once", "allow_with_updates", "allow_always", "deny"]),
    question: new Set(["question_answer", "deny"]),
    plan: new Set(["plan_approve", "plan_reject", "deny"]),
  };

  /** First answer wins. A second answerer is TOLD who got there first rather than erroring: two humans
   *  racing on the same prompt is normal, and an error frame would read as "your answer failed". A
   *  kind-mismatched outcome (e.g. a 3-way decision against a parked question) is refused BEFORE
   *  settling, so the park stays intact for a correctly-shaped answer to land later. */
  answer(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: true; alreadyAnsweredBy?: string } | { ok: false; error: string } {
    const entry = this.parked.list().find((e) => e.toolUseID === toolUseID);
    if (entry && !SessionHost.KIND_ANSWERS[entry.kind].has(outcome.kind)) {
      return { ok: false, error: `kind mismatch: ${entry.kind} park cannot take ${outcome.kind}` };
    }
    if (!this.parked.respond(toolUseID, outcome)) {
      const who = this.settledBy.get(toolUseID);
      // Answered-by-someone-else and never-parked-at-all are different outcomes and must not share a
      // reply: a client whose toolUseID is stale or wrong would otherwise read `{ok:true}` and believe
      // its answer landed.
      return who ? { ok: true, alreadyAnsweredBy: who } : { ok: false, error: `no parked request ${toolUseID}` };
    }
    // An approval upgrades the SESSION's permission mode going forward — this only ARMS the mode it
    // granted; the status-frame handler is what calls setPermissionMode and clears it. A `default` grant
    // arms nothing: the engine flips there by itself ten milliseconds after the allow (probe 97).
    if (outcome.kind === "plan_approve" && outcome.mode !== "default") this.planUpgradeMode = outcome.mode;
    this.settledBy.set(toolUseID, by);
    this.emit({ kind: "decision_settled", toolUseID, by, decision: outcome.kind });
    this.emit({ kind: "state", status: this.status() });
    return { ok: true };
  }

  /** `PendingDecisions.denyAll()` settles straight into its own map, bypassing `answer()`'s
   *  `decision_settled`/`state` emits entirely — so, unfixed, a follower watching a parked request is
   *  never told the decision is gone; it can only infer that later from a `turn end` frame, and until
   *  then a client's dialog is stuck showing a request nobody will ever answer. Both interrupt() and
   *  teardown() settle this way (the host, not a human, is ending the request), so the emit is
   *  centralized here instead of duplicated at each call site. */
  private settleParkedForSystem(): void {
    for (const e of this.parked.denyAll()) {
      this.settledBy.set(e.toolUseID, "system");
      this.emit({ kind: "decision_settled", toolUseID: e.toolUseID, by: "system", decision: "deny" });
    }
  }

  /** `blocked` is live-reported, never written to `this.state`: the roster's recorded state and this
   *  live status are deliberately separate, because `blocked` is not terminal and syncRoster's
   *  first-terminal-wins finalize must never freeze on it. */
  status(): HostStatus {
    const first = this.parked.list()[0];
    if (first) return { state: "blocked", status: "idle", waitingFor: `${first.kind}:${first.toolName}`, permissionMode: this.mode, ...(this.session?.sessionId ? { sessionId: this.session.sessionId } : {}) };
    return { state: this.state, status: this.turnInFlight ? "busy" : "idle", permissionMode: this.mode, ...(this.session?.sessionId ? { sessionId: this.session.sessionId } : {}) };
  }

  /** The host's OWN truthful busy signal, wired to the socket's `prompt` gate (see server.ts). Unlike
   *  status(), it never lies during a park: true from the moment runTask starts until it returns,
   *  covering the entire time a permission is parked mid-turn — the state a background host spends real
   *  time in by design, and exactly when the old status()-based gate was open. */
  busy(): boolean { return this.turnInFlight || this.swapInFlight; }

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
      clearTimeout(this.idleTimer);          // going away on our own terms — the reaper must not also fire
      if (final) this.state = final;
      this.offFrame?.();
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
      // Nested: if server.close() itself throws, `finished` must still resolve — otherwise
      // runHostMain's interactive arm hangs forever on `await host.finished` for a host that is
      // already gone in every other respect (roster finalized, session torn down).
      try {
        await this.server?.close();
      } finally {
        this.finishedResolve();
      }
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

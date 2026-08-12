// appserver/registry.ts — in-memory thread registry (spec §3.9): id minting + lookup. Per-thread
// serialization lives ON the record (`chain`), not in the registry — the registry is just a map.
import { randomBytes } from "node:crypto";
import type { Peer } from "./peer.js";
import type { ItemEvent } from "./items/types.js";
import type { QueuedTurn } from "./queue.js";
import type { PlanGrantMode } from "../permissions/types.js";
import type { TurnFailure } from "../session/turnResult.js";
import { ERR, type RpcError } from "./rpc.js";

/** Where a thread's engine lives: one this server spawned (`inProcess`), or a running ccx fleet session
 *  this server attached to over its host socket (`fleet`, M3 §1b). The distinction is not cosmetic —
 *  a fleet thread's engine is the HOST's, shared with other clients, and the host wire carries a smaller
 *  op set than the SDK session does (see FLEET_UNSUPPORTED below). */
export type ThreadOrigin = "inProcess" | "fleet";

/** One buffered item event tagged with the turn it belongs to. The buffer is a bounded PER-TURN
 *  window (spec §5: subscribe-time replay is the in-flight turn's items; completed-turn history comes
 *  from thread/read) — `record.buffer` is reset at the start of every turn, and each event also carries
 *  its `turnId` so a later replay (Task 9) can filter reliably instead of trusting the reset alone. */
export interface BufferedItemEvent { turnId: string; event: ItemEvent }

/** The subset of the lib Session the server drives in M1 (structural — the real Session satisfies
 *  this without adapting). */
export interface EngineSession {
  /** `opts.uuid` (appserver-only seam, Task 6/gap 6): a caller-minted uuid to stamp onto the pushed
   *  SDKUserMessage. Probe 70 (ALIVE) found the SDK persists exactly the supplied uuid, so the appserver
   *  mints it BEFORE submit and reuses it as the live userMessage item's id — the live id equals the
   *  persisted transcript id, so the item can join the replay buffer under the normal id-dedup stitch.
   *  `error` is Wave T Task 14's additive failure tag: a turn that reached a terminal result frame and
   *  reported failure RESOLVES carrying it (only a transport exception rejects), so turns.ts's success
   *  path has to read it to keep broadcasting `turn/completed{status:"failed"}` for a failed turn.
   *  Both are optional — a DI fake returning a bare `{result}` still satisfies this. */
  submit(prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string }): Promise<{ result: unknown; error?: TurnFailure }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  /** `replay` is additive and OPTIONAL — only an engine that can hand back buffered history ever passes it
   *  (the fleet engine's follow burst, fleetEngine.ts; the in-process engine has no history to replay and
   *  always calls with one argument). Declared here rather than on the fleet engine alone so the ONE
   *  consumer that must tell history from news — the frame router — can read it without knowing which
   *  engine it is installed on. */
  onFrame(cb: (m: unknown, replay?: true) => void): () => void;
  /** Optional (the real lib Session has it; a DI fake need not): the seam an approved plan upgrades the
   *  session's permission mode through — see appserver/planUpgrade.ts. */
  setPermissionMode?(mode: string): Promise<void>;
  /** Optional (the real lib Session has it — src/session/session.ts:130-161): Task 9's three remaining
   *  settings setters. `setModel(undefined)` resets to the engine's default model. */
  setModel?(model?: string): Promise<void>;
  setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>;
  /** Optional (the real lib Session has it — src/session/session.ts's `getSettings`): M2b Task 3b's
   *  `thread/settings/read`. An UNTYPED passthrough (probe 75 Q5) — the SDK answers a control request
   *  whose shape it owns, so the appserver relays the value rather than projecting it. */
  getSettings?(): Promise<unknown>;
  /** Optional (the real lib Session has it — src/session/session.ts:155-160,196-202): Task 10's five
   *  introspection reads. `usage()` wraps the SDK's own EXPERIMENTAL-prefixed method name
   *  (`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`) behind this stable spelling — callers
   *  here only ever see `usage`. `capabilities()` carries FOUR catalogs: `agents` (the SDK's
   *  supportedAgents) rides along with models/commands/mcpServers, and since introspect.ts replies the
   *  object verbatim, this type is what decides whether subagents reach the wire at all. */
  capabilities?(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[]; agents: unknown[] }>;
  getContextUsage?(): Promise<unknown>;
  usage?(): Promise<unknown>;
  initializationResult?(): Promise<unknown>;
  accountInfo?(): Promise<unknown>;
  /** Optional (the real lib Session has it): Task 11's compact-as-turn. Enqueues a genuine engine turn —
   *  `lifecycle.ts`'s `thread/compact/start` drives it through the same `beginTurn` spine as `turn/start`,
   *  never as a side call (spec Wave 2), so the thread reads busy for its whole duration. */
  compact?(): Promise<unknown>;
  /** Optional (the real lib Session has it): Task 11's `thread/reinitialize` — returns a fresh init
   *  payload; the handler also pings `thread/capabilities/changed` since a reinit refreshes that mirror
   *  too. */
  reinitialize?(): Promise<unknown>;
  /** Optional (the real lib Session has it — src/session/session.ts's `rewind`): M2b's rewind trio. ONE
   *  method serves both halves of the file-checkpoint restore — `{dryRun:true}` asks whether the restore
   *  can happen, the bare call performs it — and it needs the LIVE transport, so it is always driven on
   *  the engine that is about to be replaced, never on the one that replaces it (probe 68d). */
  rewind?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>;
  /** Optional (the real lib Session has it — src/session/session.ts:222-239): M2b's MCP quintet. Live
   *  runtime MCP topology (W3.5; probes 52/52b) — `reconnectMcpServer`/`toggleMcpServer` THROW for
   *  SDK-type servers ("SDK servers should be handled in print.ts", session.ts's own doc comment), which
   *  mcp.ts maps to a -32602-class method error carrying the SDK's message. `setMcpPermissionModeOverride`
   *  is RULES-LAYER only (probe 49) — it does not by itself silence a canUseTool broker. */
  mcpServerStatus?(): Promise<unknown[]>;
  reconnectMcpServer?(serverName: string): Promise<void>;
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers?(servers: Record<string, unknown>): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>;
  setMcpPermissionModeOverride?(serverName: string, mode: string | null): Promise<unknown>;
  /** Optional (the real lib Session has them — src/session/session.ts:191-196): M2b's background-task trio.
   *  `stopTask`/`backgroundAll` reach the live transport (they throw once it is gone), while
   *  `listBackgroundTasks` answers from the session's own level signal — the task set replaced wholesale by
   *  each `system/background_tasks_changed` frame — so it stays answerable mid-turn. `backgroundAll`'s
   *  boolean is a RECEIPT ("was anything backgrounded"), not a success flag, and an absent `toolUseId`
   *  means "all in-flight foreground tasks" (Ctrl+B). The task-set shape is spelled structurally rather
   *  than imported as `BackgroundTaskInfo`, matching this interface's other members: a DI fake satisfies it
   *  without depending on the lib Session's module. */
  stopTask?(taskId: string): Promise<void>;
  backgroundAll?(toolUseId?: string): Promise<boolean>;
  listBackgroundTasks?(): Promise<Array<{ task_id: string; task_type: string; description: string }>>;
  /** Optional (the real lib Session has it — src/session/session.ts's `steer`): M2b Task 5's `turn/steer`
   *  (X), promoted from probe 103b. VOID and synchronous by design — the seam pushes a user message onto
   *  the live prompt stream and there is nothing to await; the outcome is the steered turn's own result,
   *  reported through the turn machinery that is already running. It deliberately registers no result
   *  waiter, which is the whole reason it is its own seam rather than a `submit` (see that doc comment). */
  steer?(text: string): void;
  /** Optional (the real lib Session has them — src/session/session.ts's `reloadPlugins`/`reloadSkills`):
   *  M2b Task 5's `plugin/reload` / `skill/reload`, promoted from probe 105 (both ALIVE). Each answers
   *  with a FRESH CATALOG rather than an ack — a reload IS a capabilities refresh, which is why the
   *  handlers ping `thread/capabilities/changed` — but the receipt shape is the SDK's own, so it is typed
   *  `unknown` here and never re-projected onto the wire. */
  reloadPlugins?(): Promise<unknown>;
  reloadSkills?(): Promise<unknown>;
  /** Optional (the real lib Session has it): true once the read loop has ended — the engine is gone.
   *  The ONLY dead-engine signal handlers may use (spec Wave 0: no message-matching, ever). */
  isEnded?(): boolean;
  readonly sessionId?: string;
}

export interface ThreadRecord {
  id: string;
  origin: ThreadOrigin;
  session: EngineSession;
  unattended: "park" | "deny";
  busy: boolean;
  turnSeq: number;
  currentTurnId?: string;      // minted synchronously by turn/start (same tick as busy=true) — the ONLY
                                // source of "the in-flight turn's id" a subscribe-time replay may read;
                                // never reconstruct it from turnSeq (that increments in the same step now,
                                // but re-deriving invites drift back in — see Task 9 finding 1)
  turnStartedBroadcast?: boolean; // true only once the chain callback has actually broadcast turn/started
                                // for currentTurnId; false while busy=true but the broadcast is still
                                // pending (the same-tick turn/start+subscribe gap), and reset to false when
                                // the turn completes. This — NOT `busy` — is what subscribe-time replay
                                // gates turn/started on (Task 9 finding 2): busy flips true synchronously at
                                // request-arrival, before the broadcast; replaying to a peer that is already
                                // wired into `subscribers` by then would double-deliver turn/started once
                                // the live broadcast lands right after.
  interruptRequested: boolean; // set by turn/interrupt; read by both the success and rejection paths to pick "interrupted" vs "completed"/"failed"
  buffer: BufferedItemEvent[]; // reset at the start of every turn (see BufferedItemEvent) — not a rolling lifetime window
  subscribers: Set<Peer>;
  chain: Promise<unknown>;      // serialization scope for thread-scoped methods (record.chain = record.chain.then(...))
  planUpgradeMode?: PlanGrantMode; // the mode an approved plan GRANTED, set when the plan_approve settled and
                                // the engine has not been upgraded to it yet; cleared by applyPlanUpgrade
                                // (planUpgrade.ts). Absent = nothing armed — including a `default` grant,
                                // which the engine reaches on its own after the allow (probe 97). Observed
                                // and applied by the per-thread router's status route (D-M2-6), never by a
                                // per-approval watcher — so there is no planUpgradeOff here.
  routerOff?: () => void;       // unsubscribes the ONE per-thread frame router (router.ts, Task 8a,
                                 // spec D-M2-6) — closeRecord calls this before disposing the engine
  sessionId?: string;
  config?: Record<string, unknown>; // the FULL config this thread's engine was opened with (broker
                                 // included) — stamped once at thread/start|resume and never rewritten.
                                 // M2b's engine swap (rewind.ts) rebuilds the replacement engine from it:
                                 // without it a swapped thread silently loses its model, cwd and — worst —
                                 // its decision broker, so every later tool call would bypass this
                                 // server's permission surface entirely
  createdAt: number;            // unix seconds
  updatedAt: number;            // unix seconds — bumped on every settings/turn mutation (Task 8's setters)
  cwd?: string;                 // seeded from the start config; surfaced on threadView
  settings: { model?: string; permissionMode?: string; thinkingTokens?: number }; // seeded from the
    // start config at thread/start|resume; written by Task 8's router/setters thereafter
  title?: string;                // Task 12: set only by thread/name/set patching a live match — never
                                  // seeded at start/resume time (a fresh/resumed thread's title, if any,
                                  // is store-only data; the merged thread/list fills it in from there)
  tags?: string[];                // Task 12: set only by thread/tag/set patching a live match (same as
                                  // `title` — the SDK's store model is a single nullable `tag`, wrapped
                                  // here as a one-element array to match parent §5's plural wire field)
  /** The thread's own DYNAMIC FLAG LAYER — everything M2b Task 3b's settings ops have pushed through
   *  `applyFlagSettings` since the engine was opened, mirroring `host/host.ts`'s per-host accumulator.
   *  Two jobs, and the second is why it is state rather than a fire-and-forget call: `thread/directory/list`
   *  reports the session-scoped grants as their own source, and every engine swap (rewind.ts's `swapEngine`)
   *  REPLAYS the whole layer onto the replacement, which is a fresh CLI process with an empty one.
   *  Each entry is written only AFTER the engine accepted the push (settingsOps.ts's commit-after-accept):
   *  a phantom row here is a grant the replay would later hand an engine that never agreed to it. */
  flagPerms: { allow: string[]; ask: string[]; deny: string[]; additionalDirectories: string[] };
  flagOutputStyle?: string;
  flagEffort?: string;
  /** The thread's own RUNTIME MCP TOPOLOGY — everything `mcpServer/set`, `mcpServer/toggle` and
   *  `mcpServer/permissionModeOverride/set` (mcp.ts) have pushed since the engine was opened. It exists for
   *  the same one reason the flag layer above does: a replacement engine is rebuilt from `record.config`,
   *  so without a REPLAY (rewind.ts's `repushThreadState`) a swap silently reverts the thread to its
   *  launch topology — servers a client added gone, disabled servers back, pins evaporated. Written only
   *  AFTER the engine accepted the push, by the same commit-after-accept rule (a phantom row here is a
   *  server the replay would later hand an engine that never agreed to it). inProcess-only in practice:
   *  `set` and the override are origin-refused for fleet threads, whose engine is the host's anyway.
   *
   *  `mcpServersSet` is the last ACCEPTED wholesale `servers` value — the base the other two refine, which
   *  is why the replay pushes it first and why an accepted `set` PRUNES the two maps to the names it
   *  carries (a toggle for a server the new topology does not contain is a push no engine can honour). */
  mcpServersSet?: Record<string, unknown>;
  mcpToggles: Record<string, boolean>;   // name -> enabled
  mcpOverrides: Record<string, string>;  // name -> permission mode; a `null` mode DELETES the entry (clears the pin)
  /** M2b Task 4's server-side turn queue: the turns a client asked to run AFTER the one in flight
   *  (`turn/start {queue:true}`), FIFO, each already carrying the id it was minted at enqueue time.
   *  Only queue.ts writes it — enqueue pushes, the drain shifts, close/interrupt flush. */
  queue: QueuedTurn[];
  closing?: boolean;            // set SYNCHRONOUSLY at request arrival by thread/close and shutdown()
                                 // (server.ts) and never cleared — the latch M2b Task 4's queue drain
                                 // checks so no engine call starts after a close began
  swapInFlight?: boolean;       // set by M2b's rewind while an engine swap is in flight
  short?: string;               // FLEET ONLY (M3 §1b): the roster row's 8-hex id — the handle `ccx` itself
                                 // addresses a session by, so a client can name the same session both here
                                 // and at the CLI. Filled at attach (Task 7); never set on inProcess.
  name?: string;                // FLEET ONLY: the roster row's session name. Distinct from `title`, which
                                 // is this server's own thread/name/set patch over a STORE row — one is
                                 // the fleet's label for a running session, the other a client's label for
                                 // a persisted conversation, and merging them would let a rename here
                                 // silently disagree with `ccx fleet list`.
  epoch: number;                // one generation token per thread, initialized to 0 at creation; bumped
                                 // ONLY by M2b's rewind engine swap (spec D-M2-8) — every later task that
                                 // needs "am I still talking to the current engine" reads this, not a
                                 // second counter of its own
}

/** The settings mirror at birth: what the engine a config OPENS is actually running, before any client
 *  write. Seeded once at thread/start|resume (server.ts) — and read a second time by the engine-swap
 *  re-push (rewind.ts), because a replacement engine is rebuilt from that same `record.config`, so this is
 *  exactly the value a REJECTED re-push step has to reconcile the mirror back to. Lives here, next to the
 *  record it describes, so the two readings cannot drift apart.
 *
 *  `thinkingTokens` only has a value for the SDK's `{type:'enabled', budgetTokens}` shape; adaptive/
 *  disabled thinking (or no thinking config at all) leaves it undefined. */
export function seedSettings(config: Record<string, unknown> | undefined): ThreadRecord["settings"] {
  const thinking = config?.thinking as { type?: string; budgetTokens?: number } | undefined;
  return {
    model: config?.model as string | undefined,
    permissionMode: config?.permissionMode as string | undefined,
    thinkingTokens: thinking?.type === "enabled" ? thinking.budgetTokens : undefined,
  };
}

/** A record's flag layer at birth. A FUNCTION, not a shared constant: the four arrays are replaced
 *  wholesale on every accepted push, but a shared literal would still let one thread's accumulator be
 *  aliased by every other thread created before the first push. */
export const emptyFlagPerms = (): ThreadRecord["flagPerms"] => ({ allow: [], ask: [], deny: [], additionalDirectories: [] });

/** The ONE place a turn id is minted (spec Wave 4, external review): `beginTurn` (turns.ts) and the
 *  queue's `enqueueTurn` (queue.ts) are its only callers, so `turn/start`, compact and a queued turn all
 *  produce identical id formats off one counter — format drift between them surfaces far downstream, in
 *  replay and the D10 stitch. It lives HERE, beside the `turnSeq` it advances, rather than in turns.ts:
 *  queue.ts needs it too, and importing it from turns.ts (which imports queue.ts for the drain) would
 *  make the two modules a cycle. */
export function mintTurnId(record: ThreadRecord): string {
  return `turn_${record.id}_${++record.turnSeq}`;
}

/** The fleet counterpart, and the reason `mintTurnId` is never called for a fleet thread (spec §1b): a
 *  fleet turn id is DERIVED from the host's own turn seq. Two properties fall out of that and neither is
 *  reachable by minting. The host's `turn start` event BEATS the prompt reply that names the seq, so a
 *  bridge that minted on start would give its own turn a foreign turn's id whenever the two interleave;
 *  and a FOREIGN turn — one another client of the same host prompted — has no local mint site at all, yet
 *  still owes this server's subscribers a `turn/started`/`turn/completed` pair. `epoch` qualifies the seq
 *  because a host-side engine swap (§1a-a) starts a fresh conversation on the same socket: without it a
 *  turn from before the swap and one from after could answer to the same id. Lives here beside
 *  `mintTurnId` for the same reason that one does — two callers (fleet.ts's event layer and turns.ts's
 *  fleet branch), and importing it from either would make the pair a cycle. */
export const fleetTurnId = (record: ThreadRecord, seq: number): string => `t${seq}@e${record.epoch}`;

/** The ONE answer to "is this thread busy?" (spec D-M2-8). Gates never re-assemble these terms — every
 *  later gate (queue drain, close, rewind, compact) calls this instead. Precedence is deliberate: a
 *  closing thread is not merely "busy with a turn" even if one happens to still be in flight, and a
 *  swap-in-flight likewise outranks a plain turn. */
export function threadBusyReason(r: ThreadRecord): "turn" | "closing" | "swapping" | null {
  if (r.closing) return "closing";
  if (r.swapInFlight) return "swapping";
  return r.busy ? "turn" : null;
}

/** The ONE thread-status shape emitted on the wire (spec D-M2-8): every `threadView`/`thread/status/changed`
 *  site builds its `status` field through this, never by hand. `waitingOn` is the caller's job to compute
 *  (it needs the decisions map, which this function does not have) — see `srv.pendingDecisions`. */
export function threadStatus(r: ThreadRecord, waitingOn: boolean): { state: "idle" | "active"; waitingOn?: "decision" } {
  if (!threadBusyReason(r)) return { state: "idle" };
  return waitingOn ? { state: "active", waitingOn: "decision" } : { state: "active" };
}

/** The methods a fleet-origin thread cannot serve, because the HOST WIRE has no op behind them (spec
 *  §1c) — not because some engine build happens to lack a member. Membership is a statement about the
 *  wire, so it is a flat set here rather than a per-handler check: the refusal must read the same for a
 *  fleet thread whichever engine object is behind it.
 *
 *  Every string MUST be a registered `methodSchemas` key (schema/index.ts) — a typo gates nothing at all,
 *  silently, since the misspelled name is never dispatched. origin-gate.test.ts pins both directions.
 *  `thread/reopen` belongs here too (the host owns its own engine lifecycle) and joins in Task 14, in the
 *  same change that registers its schema — never before, or the subset tripwire is lying.
 *
 *  `turn/start` is deliberately ABSENT: only its `{queue:true}` FLAG is unsupported (the server-side queue
 *  rides ownership of the engine chain, which a fleet thread's host does not hand over), so that refusal
 *  lives in the turns handler where the flag is visible — the method itself stays allowed. */
export const FLEET_UNSUPPORTED: ReadonlySet<string> = new Set([
  "turn/steer", "thread/settings/apply", "mcpServer/set", "mcpServer/permissionModeOverride/set",
  "plugin/reload", "skill/reload", "thread/reinitialize", "account/read", "thread/init/read",
]);

/** The one message every origin refusal carries — the turns handler's queue-flag arm included, so a client
 *  matches one string rather than a family of near-identical ones. */
export const ORIGIN_REFUSAL_MESSAGE = "unsupported for fleet-origin threads";

/** The origin gate (spec §1c). Consulted in dispatch BEFORE handler entry, which is the load-bearing part:
 *  several of these methods ALSO map an absent optional `EngineSession` member to -32601, and a fleet
 *  thread must never answer a wire gap as if it were an engine-capability accident — a client would then
 *  retry against a different engine build that can never exist. Precedence inverts only for the gated set:
 *  a NON-gated method whose member is absent still answers -32601 on a fleet thread. */
export function originRefusal(record: ThreadRecord, method: string): RpcError | null {
  if (record.origin !== "fleet") return null;
  return FLEET_UNSUPPORTED.has(method) ? { code: ERR.UNSUPPORTED_FOR_ORIGIN, message: ORIGIN_REFUSAL_MESSAGE } : null;
}

/** The id of the turn a decision belongs to, or undefined when none is in flight. `currentTurnId` is
 *  never cleared at completion (the replay path wants the last turn's id), so reading it bare stamps a
 *  park raised on an idle thread with the id of a turn that already finished — a UI would attach the
 *  park to a dead turn row. `busy` is the honest gate. */
export const activeTurnId = (r: ThreadRecord | undefined): string | undefined => (r?.busy ? r.currentTurnId : undefined);

export class Registry {
  private threads = new Map<string, ThreadRecord>();
  mint(): string { return "thr_" + randomBytes(6).toString("hex"); }
  add(r: ThreadRecord): void { this.threads.set(r.id, r); }
  get(id: string): ThreadRecord | undefined { return this.threads.get(id); }
  list(): ThreadRecord[] { return [...this.threads.values()]; }
  delete(id: string): void { this.threads.delete(id); }
}

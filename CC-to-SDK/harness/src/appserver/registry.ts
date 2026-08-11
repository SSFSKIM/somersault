// appserver/registry.ts — in-memory thread registry (spec §3.9): id minting + lookup. Per-thread
// serialization lives ON the record (`chain`), not in the registry — the registry is just a map.
import { randomBytes } from "node:crypto";
import type { Peer } from "./peer.js";
import type { ItemEvent } from "./items/types.js";
import type { PlanGrantMode } from "../permissions/types.js";
import type { TurnFailure } from "../session/turnResult.js";

export type ThreadOrigin = "inProcess"; // fleet adoption is M3

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
  onFrame(cb: (m: unknown) => void): () => void;
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
  closing?: boolean;            // set by M2b's close-drain queue while a close is in flight
  swapInFlight?: boolean;       // set by M2b's rewind while an engine swap is in flight
  epoch: number;                // one generation token per thread, initialized to 0 at creation; bumped
                                 // ONLY by M2b's rewind engine swap (spec D-M2-8) — every later task that
                                 // needs "am I still talking to the current engine" reads this, not a
                                 // second counter of its own
}

/** A record's flag layer at birth. A FUNCTION, not a shared constant: the four arrays are replaced
 *  wholesale on every accepted push, but a shared literal would still let one thread's accumulator be
 *  aliased by every other thread created before the first push. */
export const emptyFlagPerms = (): ThreadRecord["flagPerms"] => ({ allow: [], ask: [], deny: [], additionalDirectories: [] });

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

// appserver/registry.ts — in-memory thread registry (spec §3.9): id minting + lookup. Per-thread
// serialization lives ON the record (`chain`), not in the registry — the registry is just a map.
import { randomBytes } from "node:crypto";
import type { Peer } from "./peer.js";
import type { ItemEvent } from "./items/types.js";

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
   *  persisted transcript id, so the item can join the replay buffer under the normal id-dedup stitch. */
  submit(prompt: string, onMessage: (m: unknown) => void, opts?: { uuid?: string }): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
  /** Optional (the real lib Session has it; a DI fake need not): the seam a plan_approve(acceptEdits:true)
   *  upgrades the session's permission mode through — see appserver/planUpgrade.ts. */
  setPermissionMode?(mode: string): Promise<void>;
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
  planUpgradePending?: boolean; // set when a plan_approve settled with acceptEdits:true and the engine has
                                // not been upgraded yet; cleared by planUpgrade.ts's applyPlanUpgrade
  planUpgradeOff?: () => void;  // unsubscribes the status-frame watcher that arms the upgrade (same file)
  sessionId?: string;
  createdAt: number;            // unix seconds
  updatedAt: number;            // unix seconds — bumped on every settings/turn mutation (Task 8's setters)
  cwd?: string;                 // seeded from the start config; surfaced on threadView
  settings: { model?: string; permissionMode?: string; thinkingTokens?: number }; // seeded from the
    // start config at thread/start|resume; written by Task 8's router/setters thereafter
  closing?: boolean;            // set by M2b's close-drain queue while a close is in flight
  swapInFlight?: boolean;       // set by M2b's rewind while an engine swap is in flight
  epoch: number;                // one generation token per thread, initialized to 0 at creation; bumped
                                 // ONLY by M2b's rewind engine swap (spec D-M2-8) — every later task that
                                 // needs "am I still talking to the current engine" reads this, not a
                                 // second counter of its own
}

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

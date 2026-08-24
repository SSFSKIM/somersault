// appserver/rewind.ts — M2b Wave 3: the rewind trio (`thread/rewind/anchors`, `thread/rewind/dryRun`,
// `thread/rewind`). Time travel has two halves that fail in different ways: the working tree is restored
// by an engine call on the LIVE session (it needs the open transport — probe 68d), while the conversation
// is restored by REPLACING the engine with one resumed at the anchor. This file drives them in the ONE
// order `src/host/host.ts`'s shipped `rewind()` proves: every refusal is decided BEFORE either side effect,
// then the file restore, then the engine swap.
//
// Why that order is load-bearing (and not just tidy): a rejection that arrives after the working tree was
// already reverted tells the caller "nothing happened" while the files on disk say otherwise, with no
// matching conversation swap to explain them. `rewindParams`'s own validation and the busy/park gates are
// therefore all resolved synchronously, at request-arrival time, before `record.chain` is even touched.
//
// The swap itself (`swapEngine` below) is deliberately factored away from rewind's own validation: M2b's
// `thread/clear` performs the SAME swap against a different replacement engine (a fresh conversation
// instead of one resumed at an anchor), and the one thing neither may re-derive is the ORDER — bump the
// epoch, drop the router, dispose, install the replacement. M3 §4's `thread/reopen` (bottom of this file)
// is the third caller and the one that inverts the precondition: rewind and clear swap a LIVE engine for a
// different conversation, reopen swaps a DEAD one for the same conversation, which is why it is the only
// member that dispatch lets through the -33005 gate at all.
//
// NONE OF THAT REACHES A FLEET THREAD (M3 §1d, Task 11). Everything above describes one server owning one
// engine. A fleet thread's engine belongs to a running ccx host that other clients are attached to, and
// the host performs this very sequence itself — its own `swapEngine`, its own `replayFlagState`, its own
// `rewound` broadcast to every follower. So the fleet arm of each method here FORWARDS the host's own op
// (`rewind_anchors`/`rewind_dryrun`/`rewind`; `clear` is settingsOps.ts's, through the same sender) and
// writes nothing: no `swapInFlight`, no `swapEngine`, no `repushThreadState`, no epoch bump and no
// `thread/rewound` of its own. Running the local swap for this origin would dispose the SOCKET to a
// living host — dropping a follower other clients still have — and replace it with a locally resumed SDK
// session no other client of that host can see. The resync is event-driven instead: the host's `rewound`
// is what bumps the epoch, reconciles the id and announces (fleet.ts's event layer, Task 7), so exactly
// one broadcast reaches the wire per host swap however many clients asked for it.
// The GATES stay local, though (busy + a parked decision view), because they are the same refusals the
// host makes for the same reasons (host.ts's rewind) and answering them here keeps the UX identical
// across origins — one refusal, at request-arrival time, before anything is sent.
// `thread/reopen` is the exception to the forwarding rule and refuses the origin outright (-33006, from
// the dispatch gate — `FLEET_UNSUPPORTED`, never a branch here): there is no host op to forward to, and
// there should not be one. Rebuilding a running host's engine on its own clients' behalf is the host's
// lifecycle to own, and §1f already names the recovery for a dead fleet socket — close, then re-attach.
import { ERR } from "./rpc.js";
import type { RequestId } from "./rpc.js";
import { installRouter } from "./router.js";
import { flushQueue } from "./queue.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { emptyFlagPerms, seedSettings, threadBusyReason, threadStatus, type EngineSession, type ThreadRecord } from "./registry.js";
import { FleetBusyError, SWAP_TIMEOUT_MS, type FleetEngineSession } from "./fleetEngine.js";
import { replyEngineThrow } from "./engineThrow.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { rewindAnchorsFrom } from "../sessions/rows.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import { SESSION_IDENTITY, stripIdentityHatch } from "./sessionIdentity.js";
import { withThreadDynamicServers } from "./dynamicServers.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams, reopenParams } from "./schema/rewind.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors server.ts/turns.ts — registry.ts's `updatedAt` is unix seconds, not ms

const defaultGetSessionMessages = (sessionId: string): Promise<unknown[]> => sdkGetSessionMessages(sessionId);

/** The default replacement-engine factory: the SAME primitive `src/session/index.ts`'s `rewindSession`
 *  uses (`openSession({...config, resume, resumeAt})`), rather than calling `rewindSession` itself, so a
 *  DI'd factory in a test observes `resume`/`resumeAt` on an ordinary config object exactly as the real
 *  one does — the reasoning server.ts's `startThread` records for folding `resume` into the config.
 *  `droppedTurnUuid` maps to the SDK's `resumeDropsTurn` (M3 Wave 0): the truncation now DECLARES which
 *  turn it discards, so the CLI refuses the fork when the discarded range holds anything that turn did
 *  not produce — a queued message the engine absorbed after the client read its anchors. A refusal is
 *  NOT raised here: it is an `error_during_execution` result frame the replacement engine emits, so the
 *  swap has already completed and `thread/rewind` has already replied `ok` by the time it lands, and the
 *  client sees it as the next turn on this thread failing with a `Resume rejected by
 *  --resume-drops-turn:` message. Deterministic — retrying that turn re-refuses forever; recovery is a
 *  fresh swap WITHOUT the guard, which nothing here does yet (M3 open follow-up). */
const defaultResumeAtFactory = (sessionId: string, resumeAt: string, droppedTurnUuid: string, config: Record<string, unknown>): EngineSession =>
  openSession({ ...(config as OpenSessionConfig), resume: sessionId, resumeAt, droppedTurnUuid } as OpenSessionConfig);

interface DryRunResult { canRewind: boolean; error?: string }

/** Normalizes the throw-vs-return split (probe 68d, mirrored from `host.rewindDryRun`): with file
 *  checkpointing off the engine RETURNS `{canRewind:false}`, but other failures — and any engine build
 *  without `rewindFiles` at all — THROW. One shape reaches the wire either way, because a client deciding
 *  whether to offer the rewind cannot be asked to tell those apart. */
async function dryRunRewind(session: EngineSession, uuid: string): Promise<DryRunResult> {
  const fn = session.rewind?.bind(session);
  if (!fn) return { canRewind: false, error: "rewind unsupported by this engine" };
  try { return (await fn(uuid, { dryRun: true })) as DryRunResult; }
  catch (e) { return { canRewind: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** The refusal a parked decision earns, word for word on both origins AND on the host (host.ts's rewind).
 *  One constant because it is now matched, not merely emitted: `forwardSwapOp` re-classes the host's copy
 *  of it, so three separately-typed copies of the string would be three ways for that match to rot. */
export const DECISION_PENDING = "a decision is pending — answer it first";

/** The swap family's shared starting point: `record.config` with EVERY session-identity knob written to
 *  `undefined`, so each member states the one anchor it means and inherits none of the other five.
 *
 *  `record.config` is the client's VERBATIM `thread/start` passthrough (server.ts's `buildConfig`), so a
 *  thread opened with a fork, a truncate, a caller-chosen id or a `continue` still carries those keys for
 *  the rest of its life. A spread that merely OMITS a key leaves the original in force, which is why every
 *  one is written explicitly — the same rule `thread/reopen` already stated for the three it nulled.
 *
 *  Nulling all six rather than the subset each site happened to think of, because they are one question
 *  asked six ways (`SESSION_IDENTITY`, shared with the other site that must drop it — review.ts) and each
 *  site had a different, quiet hole:
 *   - `thread/rewind` set `resume`/`resumeAt`/`droppedTurnUuid` but inherited `forkSession`, so rewinding a
 *     FORKED thread branched to a brand-new conversation while `swapEngine` re-stamped the old id — a
 *     thread reporting an identity it no longer had. Its sibling `thread/reopen` guards exactly this and
 *     says so in its header; the guard simply never reached here.
 *   - `thread/clear` nulled `resume`/`resumeAt` only, so a cleared thread inherited `sessionId` — honored
 *     by the engine (config/types.ts, probe 53) — and wrote its fresh conversation straight back into the
 *     id it had just dropped, defeating the `undefined` post-swap id that method passes on purpose.
 *   - `continueSession` is `resume`'s documented mutual exclusive ("excl. with resume", config/types.ts)
 *     and nothing enforces that, so on the one member that wants a FRESH conversation it would reopen the
 *     most recent one in the cwd instead.
 *
 *  Set to `undefined` rather than deleted: `resolveOptions` reads every one of these as "absent" when
 *  undefined, and an explicit write is what survives a spread. Written FROM the shared list rather than
 *  spelled out again, so a seventh knob is dropped here the day it is named there.
 *
 *  AND THE SEVENTH HOLE, which nulling the typed six does not close: `extraOptions` carries the SDK's own
 *  spelling of the same knobs straight into `Options`, past every typed field — `stripIdentityHatch` is
 *  that half, and its own header is the argument for why it deletes where this writes `undefined`. */
export const swapBaseConfig = (config: Record<string, unknown> | undefined): Record<string, unknown> => ({
  ...stripIdentityHatch(config ?? {}),
  ...Object.fromEntries(SESSION_IDENTITY.map((k) => [k, undefined])),
});

/** The swap family's one host-op sender (§1d) — shared with `thread/clear` (settingsOps.ts), which is the
 *  fourth member of the family and must not grow a second copy of this. `{ok:false, error}` is the shape
 *  a throwing host handler produces (host/server.ts wraps every dispatch), so it is raised here and both
 *  arms answer through `replySwapThrow` below rather than each inventing a mapping.
 *
 *  THE DEADLINE IS THE CALLER'S, and the family splits on it (external review 2026-08-11, which found all
 *  four members riding the 10 s default). A MUTATION — `rewind`, `clear` — passes `SWAP_TIMEOUT_MS`,
 *  because the host side is a dry run, a filesystem checkpoint restore, a fresh CLI spawn and a flag-state
 *  replay, which together exceed the default as a matter of course, and because the wire has no
 *  cancellation: a fired timer errors the client for an operation the host completes anyway, and the
 *  contradicting `rewound` lands moments later. It is long-but-finite rather than `Infinity` for a reason
 *  that is about THIS call site specifically — these two are awaited on `record.chain`, which
 *  `thread/close` and `AppServer.shutdown()` also wait behind; see fleetEngine.ts's constant. The two
 *  READS (`rewind_anchors` here, `rewind_dryrun` below) pass nothing and keep the default: they change no
 *  state, so giving up contradicts nothing later, and a picker asking "can I still rewind to this?"
 *  against a wedged host is better answered than hung.
 *
 *  TWO tokens are re-classed on the way past, both of them refusals whose LOCAL twin is -33001, and both
 *  matched exactly (never by substring) against the string the host raises:
 *   - `"busy"`. `host/server.ts` gates `rewind` and `clear` exactly as it gates `prompt`, so losing a race
 *     to another client of that host is the SAME refusal `turn/start` already answers -33001 for.
 *   - the parked-decision refusal. `host.ts`'s rewind raises it for the reason this file's own gate does,
 *     and a client that reads -32603 for one origin and -33001 for the other cannot treat them as one
 *     retryable condition.
 *  Both are reachable only in the gap before the host's own event (turn start, or the park) has reached
 *  this record's mirror; after that the local gates refuse first, which is why they are races and not the
 *  ordinary path.
 *
 *  Deliberately NOT settingsOps.ts's `forwardFlagOp`, which is send-plus-reply for a family whose reply is
 *  always the bare `{ok:true}`: each method here answers a DIFFERENT shape off the host's own body, and
 *  the flag ops are ungated host-side, so the re-classes above would be refusals they cannot receive. */
export async function forwardSwapOp<T extends { ok: boolean; error?: string }>(record: ThreadRecord, op: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const rep = await (record.session as FleetEngineSession).sendOp<T>(op, timeoutMs);
  if (rep.ok) return rep;
  if (rep.error === "busy") throw new FleetBusyError();
  if (rep.error === DECISION_PENDING) throw new FleetBusyError(DECISION_PENDING);
  throw new Error(rep.error ?? "host refused");
}

/** What a throw out of `forwardSwapOp` becomes: -33005 when the socket died while the op waited its turn
 *  in the chain (engineThrow.ts's re-check), -33001 for the busy refusal above, and otherwise -32603
 *  carrying the HOST's own message — this server never sees the host's engine and cannot re-derive what
 *  it was refusing, so relaying is the only honest answer. */
export function replySwapThrow(record: ThreadRecord, ctx: ConnCtx, id: RequestId, e: unknown): void {
  if ((e as { code?: unknown } | null)?.code === ERR.BUSY) { ctx.peer.replyError(id, ERR.BUSY, e instanceof Error ? e.message : "Thread is busy (turn)"); return; }
  replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
}

/** Replace a thread's engine, in the ONE order spec D-M2-8 fixes. Callers own the validation; this owns
 *  the sequence, and Task 3b's `thread/clear` reuses it with its own `makeReplacement`.
 *
 *  `record.epoch += 1` goes FIRST, before anything is torn down. The bump is what makes the outgoing
 *  engine's late frames inert (router.ts's installed router compares the epoch it captured against the
 *  record's on every frame) and what invalidates every outstanding `thread/read` cursor (subscribe.ts:
 *  cursors are `"<epoch>:<row>"`, and a rewind truncates rows, so a bare offset would silently address
 *  different content). Bumping before the dispose means a frame the outgoing engine emits WHILE it winds
 *  down is already stale by the time it is dispatched — `routerOff()` alone cannot promise that, because
 *  the read loop dispatches each frame over a snapshot of its callback set (src/session/session.ts).
 *
 *  A FAILING dispose does not abort the swap (host.ts's `swapEngine` swallows it the same way): the
 *  outgoing engine is being discarded either way, and letting its failure propagate here would leave the
 *  record holding a dead engine with no router at all — strictly worse than completing the replacement.
 *  A THROW is all that catch can absorb, so `thread/reopen` — the one caller whose outgoing engine is
 *  already dead by definition (§4) — asked whether a HANG were possible here instead, and it is not:
 *  `Session.dispose()` is `input.close(); await this.done` (src/session/session.ts), `close()` is
 *  idempotent, and `done` is the read loop, which has already ended whenever `isEnded()` is true (`ended`
 *  is set in that loop's own `finally`). An already-dead engine therefore disposes in a microtask, and no
 *  bounded-await guard is needed for the only engine kind that can reach this line — a fleet thread's
 *  socket-backed session never does, every fleet arm in this family returning before the swap.
 *
 *  `nextSessionId` is the store id the record carries afterwards, and it is the CALLER's to decide: a
 *  destructive rewind resumes the same conversation id, so it stays stamped (the router's init latch then
 *  no-ops, exactly as on the `thread/resume` admission path). A swap that mints a NEW conversation passes
 *  `undefined` and lets the latch learn it off the first init frame.
 *
 *  RESTORED here, by `repushThreadState` below: whatever the thread ACCUMULATED on the outgoing engine
 *  after it was opened. A replacement engine is a fresh CLI process rebuilt from `record.config`, so
 *  without the re-push every runtime write — a model or permission mode a client moved, the whole flag
 *  layer, the runtime MCP topology — silently reverts to the launch values while the wire keeps
 *  announcing the new ones. */
export async function swapEngine(
  srv: AppServer, record: ThreadRecord, makeReplacement: () => EngineSession, nextSessionId: string | undefined,
): Promise<void> {
  record.epoch += 1;
  // M7, and the position is the whole of it: IMMEDIATELY after the bump, BEFORE the dispose is awaited.
  // `dispose()` awaits a read loop that cannot end while a turn sits blocked inside the dynamic-tool
  // handler on one of these promises, and this is the only thing that settles them — resetting after the
  // await is the same circular wait `closeRecord` orders around. Non-latching, because this same registry
  // serves the replacement engine (dynamicCalls.ts's header). Both wire callers inherit it here rather
  // than saying it themselves: `thread/rewind` and `thread/clear` differ only in the replacement they
  // build. `thread/reopen`, the third, settles its own ghost parks with a truer reason at arrival time,
  // and reaches this line with nothing left to cancel.
  srv.threadDynamicCalls(record.id)?.reset("engine swapped");
  record.routerOff?.();
  try { await record.session.dispose(); } catch { /* see above — the replacement is what matters */ }
  record.session = makeReplacement();
  record.sessionId = nextSessionId;
  // The per-turn replay window belongs to the conversation that was just discarded (host.ts's swapEngine
  // resets its own turn buffer for the same reason): subscribe.ts replays `record.buffer` to every newly
  // attached client, so leaving it would hand the next client item events from a turn that no longer
  // exists in the transcript it is about to read.
  record.buffer = [];
  // `record.terminalSlashCommands` is deliberately NOT reset here (fix wave I / sweep#3, declined with its
  // reason). It is the one latched field whose SUBJECT survives the swap: the replacement is a fresh CLI
  // process built from `record.config`, so the executable, its setting sources and therefore the commands
  // it tags as terminal-only are the same ones the outgoing engine advertised — unlike `sessionId` and the
  // turn buffer above, which describe the conversation that was just discarded. Clearing it would cost
  // twice: the field would go absent until the replacement's next init frame, which for an idle thread is
  // indefinitely (the gap scalpel-5#2 names on the fleet path), and the first init after the swap would
  // then read as a CHANGE and put a `thread/capabilities/changed` on the wire for a value that never moved.
  installRouter(srv, record);
  await repushThreadState(srv, record);
}

/** THE SWAP LATCH, AND THE STATUS RETRACTION IT OWES — one implementation for the two methods that run a
 *  LOCAL swap behind `record.chain` (`thread/rewind` below, `thread/clear` in settingsOps.ts). Shared
 *  rather than stated twice because stating it twice is stating it wrong once: this is r7 finding 4's
 *  defect, and it reappears on whichever sibling forgets.
 *
 *  `swapEngine`'s `reset("engine swapped")` above settles whatever the thread still had parked, and every
 *  settle rides a `thread/status/changed` out (server.ts's `broadcastToolCall`) computed while
 *  `swapInFlight` is latched — i.e. `{state:"active"}` for a thread that is about to be idle. The latch
 *  then drops in a `finally` without a word, so a client that renders status off the wire rather than
 *  re-reading `thread/get` would sit on "active" until some later turn edge moved it.
 *
 *  CAPTURE AND RELEASE ARE ONE OBJECT, deliberately: the predicate can only be sampled BEFORE the chain
 *  (by the time it matters, the parks are gone) and the correction emitted only AFTER the latch drops, and
 *  pairing them is what stops the next swap-family caller from latching without arranging the retraction.
 *  `thread/reopen` states its own instead of taking this one — it settles at ARRIVAL with a truer reason,
 *  reads both registries, and releases early on success so its announcements describe the recovered thread.
 *
 *  The DYNAMIC registry alone, where reopen reads both: both callers here refuse outright on a pending
 *  decision (the C1 circular wait), so nothing can be in the decisions one by this line. Conditional, for
 *  reopen's reason — a swap with nothing parked broadcast no status at all, and an unconditional emit would
 *  invent a status edge the ordinary swap does not have. Recomputed rather than asserted idle: the latch is
 *  the only term that moved, and the honest answer comes from the same `threadStatus`/`threadWaiter` pair
 *  every other emit site uses.
 *
 *  FLEET latches nothing and so retracts nothing (see the file header and settingsOps.ts's clear): there is
 *  no local swap for the latch to fence off, and no local registry that origin's engine can park into. */
export function latchSwap(srv: AppServer, record: ThreadRecord): () => void {
  if (record.origin === "fleet") return () => {};
  record.swapInFlight = true;
  const settledGhostParks = srv.pendingToolCalls(record.id).length > 0;
  return () => {
    record.swapInFlight = false;
    if (settledGhostParks) srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: threadStatus(record, srv.threadWaiter(record.id)) });
  };
}

/** Re-send everything the thread accumulated on the OUTGOING engine to the replacement — the appserver's
 *  equivalent of `host/host.ts`'s `replayFlagState`, widened to the settings mirror. Called from inside
 *  `swapEngine`, which is the single seam both `thread/rewind` and Task 3b's `thread/clear` go through, so
 *  neither path can forget it and the two cannot drift.
 *
 *  Three layers, in this order:
 *  1. the SETTINGS MIRROR (`record.settings`) — the model/permissionMode/thinkingTokens trio the wire
 *     announces through `thread/settings/changed` and `threadView`. Re-pushing is what keeps that
 *     announcement true; `permissionMode` is the security-relevant one, since a silent revert to the
 *     launch mode is a thread that reports `acceptEdits` while the engine asks about every edit — or,
 *     worse, the reverse. Values seeded from `record.config` are re-pushed too: they are already what the
 *     replacement was built with, so the call is idempotent and cheap, and skipping them would mean
 *     tracking which fields were client-written, a second piece of state to get wrong.
 *  2. the FLAG LAYER (`record.flagPerms`/`flagOutputStyle`/`flagEffort`) — Task 3b's accumulator, pushed
 *     as the same three `applyFlagSettings` calls host.ts makes, and only for the parts that hold
 *     anything (an empty layer needs no push).
 *  3. the MCP LAYER (`record.mcpServersSet`/`mcpToggles`/`mcpOverrides`) — mcp.ts's accumulator, pushed
 *     as at most three labelled steps. The wholesale SET goes first because it is the base the other two
 *     refine; the toggles and the overrides then each replay as ONE step looping their entries, so a
 *     partially-applied map reconciles as a unit rather than leaving the record half-true. A replay that
 *     ran and succeeded also PINGS `thread/capabilities/changed` for the set/toggle halves: the
 *     replacement's server catalog now differs from the one its own init announced, which is exactly what
 *     that ping means everywhere else (mcp.ts). The override half never pings — rules layer, no catalog.
 *
 *  BEST EFFORT, never fatal. The swap has already happened by the time this runs — the outgoing engine is
 *  disposed and the record holds the replacement — so a rejection here cannot be undone, and propagating
 *  it would turn a completed swap into a reported failure with a live engine behind it. What must not
 *  happen is silence: the state a client believes is in force would be gone with nothing saying so. Two
 *  independent things are therefore said about a rejected step, and they answer different questions:
 *
 *  - THE STATE IS RECONCILED to what the replacement engine actually has — both layers, by the same rule.
 *    For the flag layer that means clearing what was refused (the fresh engine's session layer is empty);
 *    see the reconciliation block below for why the accumulator cannot be the exception. For the mirror:
 *    `record.settings` is the only
 *    source `threadView` and `thread/settings/changed` answer from, so a step the replacement rejected
 *    leaves the wire announcing a knob no engine is honouring — and for `permissionMode` that lie is a
 *    security statement ("acceptEdits" over an engine still asking, or the reverse). Engine reality after
 *    a rejected push is the value the replacement was BUILT with: `record.config`'s seed (`seedSettings`,
 *    the same function thread/start seeds the mirror with), or nothing at all when the config never named
 *    one — hence the field is CLEARED in that case rather than left holding a client's write. The
 *    correction rides the existing `thread/settings/changed` with `source: "engine"`, which is precisely
 *    what it is (the engine, not a client, decided this value) and which every client already renders.
 *  - The LOSSES ARE NAMED in ONE `warning`, so a client can tell "the engine disagrees" from "your request
 *    never took". It carries `threadId` and goes to the thread's subscribers AND every server-scoped
 *    watcher — the same both-scope fan-out `thread/rewound` uses (fanout.ts) — because lost state is a
 *    fact about what this thread now IS, not a per-peer aside to whoever asked for the swap.
 *
 *  An ABSENT optional method is not a failure: it raises no warning and reconciles nothing (the convention
 *  every handler here follows) — an engine build that has no `setModel` never had the value to lose. */
async function repushThreadState(srv: AppServer, record: ThreadRecord): Promise<void> {
  const s = record.session;
  const lost: string[] = [];
  const step = async (label: string, run: () => Promise<unknown>): Promise<void> => {
    try { await run(); } catch { lost.push(label); }
  };
  const { model, permissionMode, thinkingTokens } = record.settings;
  if (model !== undefined && s.setModel) await step("model", () => s.setModel!(model));
  if (permissionMode !== undefined && s.setPermissionMode) await step("permissionMode", () => s.setPermissionMode!(permissionMode));
  if (thinkingTokens !== undefined && s.setMaxThinkingTokens) await step("thinkingTokens", () => s.setMaxThinkingTokens!(thinkingTokens));
  if (s.applyFlagSettings) {
    const perms = record.flagPerms;
    if (Object.values(perms).some((a) => a.length)) await step("permissions", () => s.applyFlagSettings!({ permissions: { ...perms } }));
    if (record.flagOutputStyle) await step("outputStyle", () => s.applyFlagSettings!({ outputStyle: record.flagOutputStyle }));
    if (record.flagEffort) await step("effortLevel", () => s.applyFlagSettings!({ effortLevel: record.flagEffort }));
  }
  // The MCP layer, set first (the wholesale base the other two refine). `catalogMoved` gates the one ping
  // below: it is set INSIDE each step, after the pushes, so a step that threw leaves it as it was.
  let catalogMoved = false;
  const servers = record.mcpServersSet;
  if (servers !== undefined && s.setMcpServers) await step("mcpServers", async () => { await s.setMcpServers!(servers); catalogMoved = true; });
  // Toggles and overrides replay ENTRY BY ENTRY, and reconcile per entry (final review R10). Each is an
  // independent engine call, so an early toggle that APPLIED is live on the replacement — clearing the
  // WHOLE map because a LATER entry threw would leave the accumulator claiming less than the engine has,
  // and the NEXT swap would then silently revert the survivor. Drop only the entries that threw; name the
  // label in `lost` once if any did (the warning stays per-layer, the reconciliation is per-entry — which
  // is why the coarse `record.mcpToggles = {}` / `record.mcpOverrides = {}` clears below are gone).
  const noteLost = (label: string): void => { if (!lost.includes(label)) lost.push(label); };
  if (s.toggleMcpServer) {
    for (const [name, enabled] of Object.entries(record.mcpToggles)) {
      try { await s.toggleMcpServer!(name, enabled); catalogMoved = true; }
      catch { delete record.mcpToggles[name]; noteLost("mcpToggles"); }
    }
  }
  if (s.setMcpPermissionModeOverride) {
    for (const [name, mode] of Object.entries(record.mcpOverrides)) {
      try { await s.setMcpPermissionModeOverride!(name, mode); }
      catch { delete record.mcpOverrides[name]; noteLost("mcpOverrides"); }
    }
  }
  // Reconciliation FIRST, then the warning: by the time a client is told what was lost, the state it will
  // re-read already tells the truth. A step whose mirror value already equals the seed changed nothing —
  // the engine has that value either way — so it is named in the warning without moving the mirror.
  const seeded = seedSettings(record.config);
  let reconciled = false;
  if (lost.includes("model") && record.settings.model !== seeded.model) { record.settings.model = seeded.model; reconciled = true; }
  if (lost.includes("permissionMode") && record.settings.permissionMode !== seeded.permissionMode) { record.settings.permissionMode = seeded.permissionMode; reconciled = true; }
  if (lost.includes("thinkingTokens") && record.settings.thinkingTokens !== seeded.thinkingTokens) { record.settings.thinkingTokens = seeded.thinkingTokens; reconciled = true; }
  if (reconciled) {
    // Bumped HERE, not left to the caller: a reconciliation is a settings mutation like any of settings.ts's
    // four, and `updatedAt` is what a client polling thread/list keys "this row moved" off (registry.ts's
    // contract). Both swap callers happen to bump afterwards, but this correction can be the only thing that
    // changed on a swap the caller reports as a plain success — so it must not depend on them.
    record.updatedAt = nowSec();
    // The identical payload settings.ts/router.ts build — full post-update mirror, never a partial diff.
    srv.broadcast(record.id, "thread/settings/changed", {
      threadId: record.id, source: "engine",
      model: record.settings.model, permissionMode: record.settings.permissionMode, thinkingTokens: record.settings.thinkingTokens,
    });
  }
  // The FLAG LAYER reconciles exactly like the mirror above, and for a sharper reason than symmetry
  // (external review 2026-08-11, superseding the deliberate asymmetry appserver.md's gap 9 recorded). The
  // replacement engine was built from `record.config`, so its SESSION flag layer is empty — that IS engine
  // reality, the same way the config seed is for the mirror. Keeping a refused grant is wrong twice over:
  // `thread/directory/list` reports a directory no engine has, and — the sharp part — the add-side dedup
  // guards read this very accumulator (settingsOps.ts's `directoryAdd`/`permissionRuleAdd`), so a client's
  // retry of the refused grant short-circuits to `ok` WITHOUT touching the engine, leaving it unrecoverable
  // until some later swap. Clearing is what makes the retry a real push again.
  if (lost.includes("permissions")) record.flagPerms = emptyFlagPerms();
  if (lost.includes("outputStyle")) record.flagOutputStyle = undefined;
  if (lost.includes("effortLevel")) record.flagEffort = undefined;
  // The wholesale MCP SET reconciles like the flag layer — one atomic call, so a refusal drops the whole
  // base. The toggle/override maps were already reconciled per entry in the replay loop above (R10), so no
  // coarse clear here: clearing the whole map would discard the entries that DID apply and are live on the
  // replacement, reverting them on the next swap.
  if (lost.includes("mcpServers")) record.mcpServersSet = undefined;
  // The catalog the replacement announced at init is not the one it is running now — the same fact
  // mcp.ts's own set/toggle handlers ping for, so it rides the identical bare `{threadId}` payload.
  if (catalogMoved) srv.broadcast(record.id, "thread/capabilities/changed", { threadId: record.id });
  if (lost.length) {
    broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "warning", {
      threadId: record.id, code: "stateRepushFailed", message: `the replacement engine did not accept: ${lost.join(", ")}`,
    });
  }
}

export const rewindAnchors: Handler = async (srv, ctx, id, params) => {
  const parsed = rewindAnchorsParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // FLEET (§1d): the host reads ITS transcript through the same `rewindAnchorsFrom` this arm uses
  // (host.ts's `rewindAnchors`), so the two sides cannot drift on what an anchor is — and only the host
  // knows which conversation its engine currently holds. Forwarded WITHOUT the sessionId short-circuit
  // below: on this origin that field is a mirror a host-side swap can leave momentarily empty, while the
  // host's own reader already answers `[]` when it genuinely has nothing to anchor on. Un-chained like the
  // read it is; a rejection propagates into dispatch's own catch (introspect.ts's convention).
  if (record.origin === "fleet") {
    const rep = await forwardSwapOp<{ ok: boolean; error?: string; anchors?: unknown[] }>(record, { op: "rewind_anchors" });
    ctx.peer.reply(id, { data: rep.anchors ?? [], nextCursor: null });
    return;
  }
  // Nothing is persisted until the first turn's init frame latches an id, so "no anchors yet" is the
  // honest answer, not an error — same call the picker makes on a freshly started thread.
  if (!record.sessionId) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  // Always re-read, never cached (probe 68 Q4: post-rewind row counts defy local arithmetic — the
  // transcript is the truth). Unpaged: `nextCursor` rides along only so every list method's envelope
  // matches (the same reasoning decision/list records).
  const getMessages = srv.deps.getSessionMessages ?? defaultGetSessionMessages;
  const rows = await getMessages(record.sessionId);
  ctx.peer.reply(id, { data: rewindAnchorsFrom(rows as unknown[]), nextCursor: null });
};

/** Read-only, and deliberately NOT chain-scoped: it mutates nothing, and a client polling "can I still
 *  rewind to this?" must not queue behind whatever else the thread has in flight. */
export const rewindDryRun: Handler = async (srv, ctx, id, params) => {
  const parsed = rewindDryRunParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // FLEET (§1d): the host runs the dry run on ITS engine and normalizes the same throw-vs-return split
  // (host.ts's `rewindDryRun`, probe 68d). Without this branch the handler answers from the FLEET engine's
  // absent `rewind` member — "rewind unsupported by this engine", a verdict about this server's own engine
  // build rather than about the host's. A host-side refusal keeps `dryRunRewind`'s ONE-SHAPE contract
  // rather than becoming an RPC error: a client deciding whether to OFFER the rewind cannot be asked to
  // tell "the host said no" from "the host could not be asked".
  // On the DEFAULT deadline, unlike the two mutations this file forwards (see `forwardSwapOp`): the host
  // side changes nothing, so a client that gives up leaves no completed work to be contradicted by a later
  // event — and this is the poll a picker makes before OFFERING the rewind, where a bounded failure it can
  // retry beats a request that never settles against a wedged host.
  if (record.origin === "fleet") {
    const rep = await (record.session as FleetEngineSession).sendOp<{ ok: boolean; error?: string; dryRun?: DryRunResult }>({ op: "rewind_dryrun", uuid: parsed.data.uuid });
    ctx.peer.reply(id, rep.ok ? rep.dryRun ?? { canRewind: false } : { canRewind: false, error: rep.error ?? "host refused" });
    return;
  }
  ctx.peer.reply(id, await dryRunRewind(record.session, parsed.data.uuid));
};

export const threadRewind: Handler = (srv, ctx, id, params) => {
  const parsed = rewindParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { threadId, uuid, prevUuid, scope } = parsed.data;
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // ── Every refusal, resolved here: synchronously, at request-arrival time, before a single side effect.
  // The busy reason is on the wire (the shape beginTurn and reinitialize already reply): "closing" and
  // "swapping" are not the same refusal as "a turn is running".
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  // A parked decision blocks the rewind for a concrete reason, not out of caution: the swap awaits the
  // outgoing engine's dispose(), and dispose awaits its read loop, which cannot end while a turn sits
  // inside canUseTool holding one of our parked promises (the C1 circular wait, closeRecord's header).
  if (srv.pendingDecisions(threadId).length) { ctx.peer.replyError(id, ERR.BUSY, DECISION_PENDING); return; }
  // ── FLEET (§1d): forward, and stop. Everything BELOW this line is the local swap — the one thing this
  // origin must never do (see the module header). The two gates above stayed local because the host
  // refuses the same two things for the same reasons (host.ts's rewind), and a parked VIEW counts: it
  // mirrors a park the host is genuinely blocked on.
  //
  // NEITHER of the two refusals below is re-stated here, and each absence is deliberate:
  //  - no `sessionId` gate. That field is a MIRROR of the host's conversation id on this origin, and only
  //    the host knows whether its engine has one; it raises the identical "no session to rewind" itself.
  //  - no null-`prevUuid` refusal. The inProcess one is a statement about the LOCAL fork primitive
  //    (`resumeAt` cannot name "before the first message"), and the host expresses exactly that outcome by
  //    CLEARING instead (host.ts's `clearing`, W-S8) — refusing here would deny a capability the engine on
  //    the other end has, and the host's `rewound {cleared:true}` is what tells every client it happened.
  //
  // Chain-scoped like every other fleet mutation (settingsOps.ts's `forwardFlagOp`), so two writes from
  // one client reach the host in the order that client made them. The REPLY's `sessionId` is read AFTER
  // the op resolves, and that ordering is what makes it true: the host writes its swap burst — including
  // the `rewound` this record reconciles from — to the socket BEFORE the reply to the op that caused it,
  // and frames are routed in arrival order, so the event layer has already run by the time this resolves.
  if (record.origin === "fleet") {
    record.chain = record.chain.then(async () => {
      try {
        // The swap deadline, not the default: the host's side of this is a dry run, a filesystem restore
        // and a fresh CLI spawn, and the protocol carries no cancellation — see `forwardSwapOp`.
        await forwardSwapOp(record, { op: "rewind", uuid, prevUuid, scope }, SWAP_TIMEOUT_MS);
        record.updatedAt = nowSec();          // the epoch/id/announce half belongs to the host's `rewound`
        ctx.peer.reply(id, { ok: true, sessionId: record.sessionId ?? null });
      } catch (e) { replySwapThrow(record, ctx, id, e); }
    });
    return;
  }
  const sessionId = record.sessionId;
  if (!sessionId) { ctx.peer.replyError(id, ERR.ENGINE_GONE, "no session to rewind"); return; }
  // `resumeAt` takes a message uuid and has no value meaning "before the first message" (the fork
  // primitive genuinely cannot express an empty conversation), so a conversation-scoped rewind to the
  // very first prompt is refused rather than approximated — the code-only rewind is what remains, and
  // the message says so. M2b's `thread/clear` is the method that DOES express it.
  if (scope !== "code" && !prevUuid) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "no conversation anchor before the first prompt — code-only rewind is available");
    return;
  }
  // Latched SYNCHRONOUSLY, for the same reason thread/close latches `closing` at request arrival: the work
  // below sits behind record.chain, so a same-tick turn/start (two requests dispatched before any
  // microtask runs) would otherwise pass its own busy gate and drive an engine call against a thread that
  // is being swapped out from under it. Every gate reads it through threadBusyReason -> "swapping".
  // Through `latchSwap`, which also captures — here, before the chain — whether this swap is about to
  // settle a ghost park under that latch, and hands back the release that corrects the wire if it did.
  const releaseSwap = latchSwap(srv, record);
  record.chain = record.chain.then(async () => {
    try {
      // FILE RESTORE, on the live engine, first (probe 68d: rewindFiles needs the open transport). The dry
      // run is not a courtesy check — with checkpointing off the real call THROWS where the dry run merely
      // reports, so this is what keeps the throwing call away from a known-bad state.
      if (scope !== "conversation") {
        const dry = await dryRunRewind(record.session, uuid);
        if (!dry.canRewind) throw new Error(dry.error ?? "file rewind unavailable");
        await record.session.rewind!(uuid); // reachable only when the dry run answered — a missing rewind refuses above
      }
      // CONVERSATION RESTORE second: the swap is what replaces the engine, and it must not run before the
      // file restore has had the live transport it needs.
      if (scope !== "code") {
        const factory = srv.deps.resumeAtFactory ?? defaultResumeAtFactory;
        // The id stays stamped: a destructive `resumeAt` keeps the SAME session id (src/session/index.ts's
        // rewindSession), and clearing it would blind every reader that keys on it — thread/read and
        // thread/rewind/anchors would answer empty until the next turn, and sessionLib.ts's live-guard
        // would stop finding this thread, letting a concurrent thread/delete erase the history out from
        // under a live engine.
        // `uuid` is the turn the truncation DISCARDS (the resume anchor is `prevUuid`, the entry before
        // it), which is exactly what `resumeDropsTurn` names — the value is already in hand, so the guard
        // costs nothing and catches the one thing the client's anchor list cannot show it.
        // Through `swapBaseConfig`, not raw: a thread STARTED as a fork carries `forkSession` in its
        // verbatim config forever, and the factory below spreads it beside the `resume` it sets — the pair
        // the SDK reads as "branch to a new session id". The engine would then open a different
        // conversation while the `sessionId` passed to `swapEngine` re-stamps the old one, so the thread
        // would report an identity it no longer holds, permanently (routeInit's latch early-returns on a
        // stamped record, so the real id is never learned).
        // …and through `withThreadDynamicServers` (M7): the replacement engine gets FRESH MCP servers built
        // from `record.dynamicTools`, never the outgoing engine's — an MCP `Server` refuses a second
        // transport, and the agent SDK swallows that failure, so a reused instance is a rewound thread that
        // silently lost its declared tools. Inside the thunk, so the generation it captures is the bumped
        // one `swapEngine` has already written.
        await swapEngine(srv, record, () => factory(sessionId, prevUuid!, uuid, withThreadDynamicServers(srv, record, swapBaseConfig(record.config))), sessionId);
      }
      record.updatedAt = nowSec(); // a rewind is a mutation like any other (registry.ts's updatedAt contract)
      // Both scopes at once: the thread's own subscribers, and every server-scoped watcher — a rewind
      // changes what this thread IS, which is the class of event watchers opted into (fanout.ts). Fired
      // for a code-only rewind too: the working tree moved under every attached client, which is news
      // whether or not the conversation moved with it.
      broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId, sessionId });
      ctx.peer.reply(id, { ok: true, sessionId });
    } catch (e) {
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    } finally {
      // Guaranteed: a throw from the dry run, the real restore or the swap itself must not leave the
      // thread wedged reading "swapping" forever — nor, when the swap settled a ghost park on its way
      // past, leave the wire's last word on this thread reading "active" (`latchSwap`).
      releaseSwap();
    }
  });
};

/** The replacement `thread/reopen` builds when no test injected one — the SAME primitive `thread/clear`'s
 *  own default uses (settingsOps.ts's `defaultFreshFactory`), because the two ask the identical thing of
 *  `record.config`; whether the conversation continues or starts over is decided by the `resume` the
 *  caller folds in, not by the factory. Defaulted at the call site like every other DI slot here. */
const defaultReopenFactory = (config: Record<string, unknown>): EngineSession => openSession(config as OpenSessionConfig);

/** The refusal an ALIVE engine earns. Reopen is a RECOVERY, not a restart: without this a client could
 *  cycle a healthy thread's engine — dropping its in-flight context and its CLI process — through a method
 *  whose whole contract is "this thread is already broken". */
export const ENGINE_NOT_DEAD = "engine is not dead; nothing to reopen";

/** `thread/reopen` (spec §4) — the fourth member of the swap family, and the only one whose starting state
 *  is a thread that answers -33005 to everything else. Scorecard gap 10: `swapEngine`'s fixed order
 *  disposes before it builds, so a factory that throws (an `openSession` that cannot spawn the CLI child)
 *  unwinds leaving the record holding a disposed engine. That reads honestly — `isEnded()` is true, so
 *  dispatch refuses every method — but until now the only way out was `thread/close` plus a fresh
 *  `thread/resume`, which mints a NEW thread id and drops every subscription, name, tag and cursor the
 *  client held against the old one. This admits a replacement engine into the EXISTING record instead.
 *
 *  REACHABLE ONLY BECAUSE IT IS EXEMPT. `thread/reopen` is in server.ts's `ENGINE_GONE_EXEMPT`, or the
 *  dispatch-level -33005 gate would refuse it in exactly the state it exists for. The origin gate runs
 *  immediately after that exemption, which is what makes a fleet thread's -33006 land here without a line
 *  of code in this handler: reopen NEVER forwards, because a fleet thread's engine is a running host's and
 *  its lifecycle is that host's to own (§1f — a dead fleet socket is recovered by `thread/close` plus a
 *  fresh `thread/attach`, not by rebuilding someone else's engine underneath them).
 *
 *  RESUME OR FRESH is decided by the retained id and nothing else: `record.sessionId` present means the
 *  conversation was persisted and the replacement resumes it; absent means the engine died before its
 *  first init frame ever latched one, so there is no transcript to resume and the thread reopens as a
 *  fresh conversation (spec §4, documented — the `thread/rewound` then carries the new id, `null` until
 *  the router's init latch learns it). The `resume` is folded into the config the factory receives, which
 *  is `startThread`'s own convention (server.ts) — and folding it in is also what OVERWRITES a stale
 *  `resume` left in `record.config` by the original admission, so a thread that has been cleared since
 *  does not quietly resurrect the conversation the clear dropped. THE OTHER THREE SWAP-FAMILY KEYS ARE
 *  NULLED for the same reason and by the same explicit-write rule `thread/clear` follows (settingsOps.ts):
 *  `record.config` is the client's VERBATIM `thread/start` passthrough (server.ts's `buildConfig`), so a
 *  thread opened with a fork or truncate config still carries those keys, and a spread that merely omits
 *  them leaves them in force. Each is destructive in its own way — `resumeAt`/`droppedTurnUuid` would make
 *  the recovered engine resume TRUNCATED at an anchor from some earlier request, and `forkSession` would
 *  mint a new conversation id while `record.sessionId` keeps reporting the old one.
 *
 *  THE DEAD CONVERSATION'S PARKS ARE SETTLED, through `ThreadDecisions.reset()` — the settle loop without
 *  `teardown()`/`discard()`'s `closed` latch, which is the one thing this method must not set (the broker
 *  is the same object `record.config` carries onto the replacement, so latching would auto-deny the
 *  recovered thread's every tool call). Not merely tidiness: those promises are awaited by a read loop that
 *  has already ended, so no answer will ever be consumed — while the entries keep listing on the wire and
 *  keep refusing a later rewind/clear. Worse, the reopen makes them reachable in the wrong direction:
 *  `decision/respond`'s two side channels are keyed on the RECORD, not the engine (server.ts's
 *  `armPlanUpgrade`, and `abortTurn -> requestInterrupt`), so answering a ghost would upgrade the
 *  REPLACEMENT's permission mode or interrupt a live unrelated turn. Settled here, that answer is a plain
 *  "already settled" instead. Runs in the same synchronous step as the queue flush, and each entry gets the
 *  `decision/resolved` a client told about a park is owed (the terminal-event invariant queue.ts follows). */
export const threadReopen: Handler = (srv, ctx, id, params) => {
  // Mirrors `thread/clear`'s own first line, and for the same reason: this method SPAWNS an engine, and
  // shutdown()'s snapshot must not be raced into leaking a CLI child nothing will dispose.
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  const parsed = reopenParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { threadId } = parsed.data;
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // Every refusal resolved synchronously, before a side effect — the family's rule (see threadRewind).
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  // NO parked-decision gate, unlike rewind and clear, and the omission is the point: that gate exists
  // because the swap awaits a LIVE engine's dispose, which cannot finish while a turn sits inside
  // canUseTool holding one of our parked promises (the C1 circular wait). Here the read loop has already
  // ended — that is the precondition — so there is no wait to deadlock, and refusing on a park would make
  // the recovery unreachable for exactly the threads that died holding one. They are SETTLED below instead
  // of refused on, which is what leaves nothing for a client to have to answer first.
  if (!record.session.isEnded?.()) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, ENGINE_NOT_DEAD); return; }
  // Latched synchronously, as rewind and clear do: the swap sits behind record.chain, and every gate reads
  // the latch through threadBusyReason -> "swapping".
  record.swapInFlight = true;
  // The queue is FLUSHED, in the same synchronous step — `thread/close`'s latch+flush pair, for a reason of
  // this method's own. A queued turn was accepted against a conversation that has since died, and on the
  // no-sessionId arm the replacement is a different conversation outright; nothing would run it at reopen
  // time either (only `settleTurn` drains), so left in place it would execute against unrecognizable
  // context the first time some later turn completed. Cancelled rather than dropped, because a client that
  // was told `{queued:true}` is owed a terminal event for that id (queue.ts's invariant).
  flushQueue(srv, record);
  // …and the dead conversation's parks are settled in that same step, NON-LATCHING (broker.ts's `reset()`).
  // Ghost entries whose awaiter is gone would otherwise keep listing, keep blocking rewind/clear — and,
  // once the replacement is live, keep `decision/respond`'s record-keyed side channels aimed at it.
  // Whether it settles ANYTHING is remembered, because each settle rides a `thread/status/changed` out
  // (server.ts's broadcastDecision) computed while `swapInFlight` is latched — i.e. `{state:"active"}` for
  // a thread that is mid-recovery — and the latch clears without a word. See the correction below.
  // BOTH registries, on both halves of this (r7 finding 4). A dynamic tool call the dead engine abandoned
  // still parked is a ghost of exactly the same kind — awaited by a read loop that has already ended, yet
  // listed on the wire and settleable by any subscriber — and its settlement rides the same suppressed
  // status broadcast, so the retraction below is owed whichever registry had something in it. Reset with
  // this method's own reason rather than the swap's: what happened to that call is that the thread was
  // recovered, which is the only thing its note will ever tell the model.
  const settledGhostParks = srv.pendingDecisions(threadId).length > 0 || srv.pendingToolCalls(threadId).length > 0;
  srv.threadDecisions(threadId)?.reset();
  srv.threadDynamicCalls(threadId)?.reset("thread reopened");
  const sessionId = record.sessionId;
  record.chain = record.chain.then(async () => {
    try {
      const factory = srv.deps.sessionFactory ?? defaultReopenFactory;
      // The siblings are nulled EXPLICITLY, not omitted — `record.config` is a verbatim client passthrough
      // and this is a spread (see the header). This method's own three (`resumeAt`/`droppedTurnUuid` would
      // resume the recovery truncated at a stale anchor; `forkSession` would silently mint a new id) plus
      // the two it used to miss, now that `swapBaseConfig` states all six in one place.
      // The M7 overlay is rebuilt here too (`withThreadDynamicServers`, applied outermost so the `resume`
      // folded in above rides inside it): a recovered engine owes the client the tools it declared, and it
      // owes them as NEW server instances — the dead engine's are spent.
      await swapEngine(srv, record, () => factory(withThreadDynamicServers(srv, record, { ...swapBaseConfig(record.config), resume: sessionId })), sessionId);
      record.updatedAt = nowSec();
      // Released HERE, ahead of the announcements rather than only in the finally, because everything below
      // describes the RECOVERED thread and would otherwise describe the swap that is finishing. Nothing can
      // interleave: the rest of this block is synchronous, and the finally stays the guarantee for the
      // throwing path (where the thread must read retryable, not wedged at "swapping").
      record.swapInFlight = false;
      // The established "engine swapped, resync" signal, both scopes (fanout.ts): the epoch moved, so every
      // outstanding thread/read cursor is stale, and a client rendering this thread needs to know its
      // engine is a different process now. `null` rather than an omitted key on the fresh arm — the same
      // choice thread/clear makes, so a client reads "no id yet" instead of "field missing".
      broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId, sessionId: record.sessionId ?? null });
      // THE RETRACTION, and only when there is something to retract. Settling the ghost parks above emitted
      // one `thread/status/changed` per entry, each computed under the latch and therefore reading "active";
      // a client that renders status off the wire (rather than re-reading `thread/get`) would sit on that
      // until some later turn edge moved it. Conditional because a reopen with nothing parked broadcast no
      // status at all, and an unconditional emit here would give this method a status edge its swap-family
      // siblings do not have. Recomputed rather than asserted idle — the latch is the only term that
      // changed, and the honest answer comes from the same `threadStatus`/`threadWaiter` pair every other
      // emit site uses.
      if (settledGhostParks) srv.broadcast(threadId, "thread/status/changed", { threadId, status: threadStatus(record, srv.threadWaiter(threadId)) });
      ctx.peer.reply(id, { ok: true, sessionId: record.sessionId ?? null });
    } catch (e) {
      // R11: the FAILURE twin of the success path's retraction above. reset() emitted one
      // `thread/status/changed` per settled ghost park, each computed under the `swapInFlight` latch and so
      // reading "active"; the success path corrects them, but a factory throw would clear the latch silently
      // in `finally` and leave every subscriber that renders status off the wire stuck on "active" forever.
      // Clear the latch HERE (before the recompute) so the corrected status reads the true post-failure
      // state (idle — the corpse's turn is over), then name the failure.
      record.swapInFlight = false;
      if (settledGhostParks) srv.broadcast(threadId, "thread/status/changed", { threadId, status: threadStatus(record, srv.threadWaiter(threadId)) });
      // NOT `replyEngineThrow`: the record is still holding the corpse on this path (the factory threw
      // before `swapEngine` could install anything), so its -33005 re-check would fire and answer "Engine
      // is gone" — true, already known, and it would swallow the factory's own message, which is the only
      // thing telling the client whether a retry can possibly work. The thread keeps answering -33005
      // everywhere else, so nothing here misrepresents its state.
      ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    } finally {
      // Guaranteed, exactly as in threadRewind: a second factory throw must leave the thread retryable
      // rather than wedged at "swapping" — which is what makes this recovery REPEATABLE.
      record.swapInFlight = false;
    }
  });
};

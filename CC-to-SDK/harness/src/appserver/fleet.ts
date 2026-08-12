// appserver/fleet.ts — fleet ADOPTION (spec §1e): `fleet/list`, `thread/attach`, and the fleet EVENT
// LAYER an attach installs. Three things live here because they are one mechanism:
//
//  1. `fleet/list` is a ROSTER + PROJECTION JOIN, not a registry read. The rows a client picks an attach
//     target from are sessions this server has never seen — the roster on disk is the only place they all
//     appear — and their live state comes from the same probe seams `collectFleet` uses (fleet/index.ts),
//     so a listing here and `ccx fleet list` can never disagree about what "working" or "unresponsive"
//     means. `threadId` is the one column this server owns: which of those rows it currently holds.
//  2. `thread/attach` is an ADMISSION with a reservation and an activation barrier. The barrier is the
//     part that is easy to get wrong: `follow` replays synchronously and its whole burst lands before the
//     follow reply (P106), so the engine buffers everything until `activate()`, and this module publishes
//     the record — and announces it — BEFORE releasing that buffer. The reservation is the concurrency
//     half: two attaches for one target must produce one record, so the second awaits the first's
//     admission rather than dialling a second socket onto the same host.
//  3. The EVENT LAYER is the sole turn-lifecycle owner for a fleet thread (§1b), own turns included. The
//     host's `turn` events are the only place both origins of a turn meet — this client's prompt and
//     another client's — so busy, the turn id, the item mapper and the two broadcasts all hang off them,
//     and `turns.ts`'s fleet branch does nothing but gate, submit and reply.
import { listRoster, readRoster, TERMINAL } from "../fleet/roster.js";
import type { RosterRow } from "../fleet/roster.js";
import { hostSocketPath } from "../fleet/paths.js";
import { collectFleet } from "../fleet/index.js";
import type { HostStatus } from "../host/ops.js";
import type { DecisionOutcome } from "../permissions/types.js";
import { connectFleetEngine } from "./fleetEngine.js";
import type { AnswerReceipt, FleetEngineSession } from "./fleetEngine.js";
import { ERR } from "./rpc.js";
import type { RequestId } from "./rpc.js";
import { emptyFlagPerms, fleetTurnId, threadStatus } from "./registry.js";
import type { ThreadRecord } from "./registry.js";
import { TurnMapper } from "./items/mapper.js";
import { emitItems, requestInterrupt } from "./turns.js";
import { replyEngineThrow } from "./engineThrow.js";
import { installRouter } from "./router.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { threadView } from "./server.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import { fleetListParams, threadAttachParams } from "./schema/fleet.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // registry.ts's `updatedAt` is unix seconds
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What §1f's death sequence puts on the wire — the failed turn's `error` and the warning's `message` say
 *  the same thing, because they ARE the same fact reaching a client through two channels. Deliberately not
 *  the engine's own "connection closed" wording (fleetEngine.ts's rejection): a client that CLOSED a thread
 *  reads that phrase as its own doing, and this is the death nobody asked for. */
const CONNECTION_LOST = "fleet host connection lost";
const CONNECTION_LOST_HINT = `${CONNECTION_LOST} — close this thread and attach again to recover`;

/** `thread/stop`'s roster-terminal poll (§1e). The host writes its terminal row from its own exit path,
 *  AFTER the sockets are gone, so there is a real gap between the EOF this method takes as success and the
 *  state a client will read next; 250 ms steps cover that gap without spinning.
 *
 *  THE CAP IS COUPLED TO THE HOST'S OWN `DISPOSE_GRACE_MS` (host/host.ts) — tune either and you must look
 *  at the other. `SessionHost.teardown` writes the terminal roster row EARLY and closes the server only in
 *  its outer `finally`, so on the host's DESIGNED slow path (a wedged interrupt/dispose riding out the full
 *  grace) the roster half of this poll satisfies at once while the socket stays open for the whole grace.
 *  A cap equal to that grace therefore expires precisely inside the host's normal-but-slow window: the
 *  client gets -33008 for a stop that was in fact working, the death latch is handed back, and the real
 *  death a beat later announces a connection loss for a session the client DELIBERATELY ended — the exact
 *  mis-announcement `expectDeath` exists to prevent. 10 s clears the 5 s grace with room for the socket
 *  teardown tail behind it (`server.close()` destroys sockets immediately, host/server.ts). */
const STOP_POLL: StopPoll = { stepMs: 250, capMs: 10_000 };
export interface StopPoll { stepMs: number; capMs: number }
const sleep = (ms: number): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); (t as { unref?: () => void }).unref?.(); });

/** The ONE status shape (registry.ts), same as turns.ts's own private helper — `waitingOn` needs the
 *  decisions map, which the record does not have. */
function statusChanged(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: threadStatus(record, srv.pendingDecisions(record.id).length > 0) });
}

/** Everything a fleet thread learns from its host that is NOT an SDK frame (§1b's host-synthesized set).
 *  Installed BEFORE the record is published and BEFORE `activate()`, so the follow replay — buffered
 *  since the dial — finds every listener in place.
 *
 *  Returns its own UNINSTALLER, which the caller stores as `record.fleetOff` for `closeRecord` to call
 *  beside `routerOff` (M3 Task 9). Install and teardown are symmetric for the same reason the router's
 *  pair is: every subscription this record took is given back when the record goes, so none outlives its
 *  registration. Not an accumulation across attach cycles — a re-attach dials a FRESH engine and the
 *  disposed one's callback sets are garbage with it — but a fan still wired to a record the registry has
 *  dropped is state this server cannot account for. */
export function installFleetEvents(srv: AppServer, record: ThreadRecord, engine: FleetEngineSession): () => void {
  // ONE mapper and ONE derived id per turn WINDOW, whoever started the turn (§1b: "one mapper owner per
  // turn window, both origins of the turn"). Held in this closure rather than on the record because
  // nothing outside this layer may feed them — `turns.ts`'s fleet branch passes an inert sink precisely
  // so a turn is itemized once, here, from the frames every client of the host sees.
  let mapper: TurnMapper | undefined;
  let windowId: string | undefined;

  /** Every host-event subscription this layer takes, so the uninstaller can give all of them back. The
   *  frame subscription is NOT in here — it is re-taken on every swap (see `installFrames`), so only its
   *  current value can be released. */
  const subs: Array<() => void> = [];
  const track = (off: () => void): void => { subs.push(off); };

  // The frame subscriptions are a PAIR, in this order: the router first, the item layer second — the
  // order the in-process read loop delivers in (session.ts's frame fan runs before the turn's own sink),
  // so an item mapper sees the same interleave on both origins. Re-installed as a pair on a host-side
  // swap: `installRouter` captures `record.epoch` and drops every frame once it moves, which for an
  // inProcess swap is the whole point (the superseded engine is still alive and still emitting) and for a
  // fleet thread would silently deafen a socket that never changed.
  let offItems: (() => void) | undefined;
  const installFrames = (): void => {
    record.routerOff?.();
    offItems?.();
    installRouter(srv, record);
    // The two halves of the pair read the replay mark OPPOSITELY, and that is the point. The router drops
    // a replayed frame outright (router.ts) — its routes write the settings mirror and announce news, and
    // history is neither. Here `replay` is deliberately unread: a replayed message frame inside a turn
    // window IS that turn's own item, and the buffer it lands in is the per-turn live window, not history.
    // There is nothing to double-count — `thread/read` is disk-only for a fleet thread (§1f) and the
    // host's socket replay covers the live turn the disk does not have yet (probe 62; chatAdapter.ts's
    // resume-before-follow rule is the same split from the other side).
    offItems = engine.onFrame((m) => {
      if (!mapper || windowId === undefined) return; // outside a turn there is no turn to attribute items to
      emitItems(srv, record, windowId, mapper.ingest(m));
    });
  };
  installFrames();

  track(engine.onTurn((e) => {
    const turnId = fleetTurnId(record, e.seq);
    if (e.phase === "start") {
      // Everything `beginTurn` does at request-arrival time (turns.ts), minus the mint and the reply:
      // this IS the arrival, for own and foreign turns alike.
      windowId = turnId;
      mapper = new TurnMapper();
      record.busy = true;
      record.buffer = [];               // the bounded PER-TURN window (registry.ts), reset every turn
      record.interruptRequested = false;
      record.currentTurnId = turnId;
      record.updatedAt = nowSec();
      srv.broadcast(record.id, "turn/started", { threadId: record.id, turn: { id: turnId, status: "inProgress" } });
      record.turnStartedBroadcast = true; // recorded after the broadcast, exactly as turns.ts does
      statusChanged(srv, record);
      return;
    }
    // NO OPEN WINDOW, NO END. The host runs one turn at a time, so an end naming a different turn than the
    // open window is a stale frame rather than a second live turn — settling the open window on it would
    // report the wrong id. An end with NO window is the same refusal for a stronger reason: `turn/completed`
    // for a turn this thread never announced started is an unpaired lifecycle event. Today only the host's
    // emission order keeps that unreachable (an end is always preceded by the start that opened the window,
    // and a follow replay opens one whenever the host is mid-turn — host.ts:607 before :630), and this
    // layer must not depend on another process's ordering to stay well-formed.
    if (windowId !== turnId) return;
    // §1b's turn-end trio: `error` is a turn that THREW, `failure` a turn that RESOLVED reporting failure.
    // Either is `failed` on the wire; there is no local status synthesis, and an interrupt is not one —
    // it reaches this client as the host's own turn end (§1e), whatever that end says.
    const failure = e.error ?? e.failure?.message;
    if (mapper) emitItems(srv, record, turnId, mapper.finalize(failure !== undefined));
    mapper = undefined; windowId = undefined;
    record.busy = false;
    record.turnStartedBroadcast = false;
    record.updatedAt = nowSec();
    // `currentTurnId` is deliberately left standing (registry.ts: the replay path wants the last turn's id).
    const complete = (): void => {
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: failure === undefined ? { id: turnId, status: "completed" } : { id: turnId, status: "failed", error: failure } });
      statusChanged(srv, record);
    };
    // F2: an OWN turn's turn/start REPLY (fleetTurnStart's onAccepted) is published on the microtask after
    // the host's prompt reply resolves, while this end edge is broadcast synchronously as the frame routes.
    // A trivially-fast turn whose end shares a data chunk with (or precedes) that reply would put
    // turn/completed on the wire before the inProgress reply. `fleetStartAck` is set while that reply is
    // pending and resolved the instant it publishes — so hold the completed edge behind it. Foreign turns
    // set no ack, and once the reply is out it is cleared, so a normal completion stays synchronous. Mirrors
    // the in-process spine, where turn/started strictly precedes turn/completed.
    const ack = record.fleetStartAck;
    if (ack) void ack.then(complete); else complete();
  }));

  // A park raised host-side, mirrored as a VIEW (broker.ts's parkView) — looked up per event rather than
  // captured, so a park arriving after the thread closed reaches nothing instead of a dangling registry.
  track(engine.onDecision((entry) => { srv.threadDecisions(record.id)?.parkView(record.id, entry); }));

  // …and its settlement, by ANY client of that host — the sole remover of a view (§1b: this server never
  // settles a fleet decision locally), the settlement its own `decision/respond` won included. It arrives
  // here exactly as a foreign client's does, which is what makes `decision/resolved.by` the truth about
  // who answered rather than a claim about who asked us.
  //
  // The structured `answer` is §1a-e's addition; the kind string alone is what a host predating it emits,
  // and what the host's OWN settlements carry today (an SDK abort, an interrupt's sweep — a system deny
  // has no payload the kind drops). Reconstructing the payload-free outcome from it is exact, and is the
  // same `{kind:"deny"}` a local teardown resolves with.
  track(engine.onDecisionSettled((e) => {
    srv.threadDecisions(record.id)?.settleView(e.toolUseID, e.by, e.answer ?? ({ kind: e.decision } as DecisionOutcome));
  }));

  // Announce-only, no record-level task mirror — inProcess parity: `task/list` forwards to the engine's own
  // live set on both origins (tasks.ts, and here the host's `tasks` op), so there is no second copy to keep
  // honest. Which also means the snapshot the follow replay carries is not lost by reaching an empty
  // subscriber set during the attach: it is the host's CURRENT task set (host.ts:624, delivered for the same
  // reason `state` is), and the first client to ask reads it straight off the host.
  track(engine.onTasksChanged((tasks) => { srv.broadcast(record.id, "task/changed", { threadId: record.id, tasks }); }));

  track(engine.onState((s) => {
    if (s.sessionId && s.sessionId !== record.sessionId) record.sessionId = s.sessionId;
    // §1a-c: `model`/`thinkingTokens` are OMITTED until the host has one, so an absent field means
    // "unknown", never "cleared" — only a present-and-different value is a change worth announcing.
    const moved = (s.permissionMode !== undefined && s.permissionMode !== record.settings.permissionMode)
      || (s.model !== undefined && s.model !== record.settings.model)
      || (s.thinkingTokens !== undefined && s.thinkingTokens !== record.settings.thinkingTokens);
    if (moved) {
      if (s.permissionMode !== undefined) record.settings.permissionMode = s.permissionMode;
      if (s.model !== undefined) record.settings.model = s.model;
      if (s.thinkingTokens !== undefined) record.settings.thinkingTokens = s.thinkingTokens;
      record.updatedAt = nowSec();
      srv.broadcast(record.id, "thread/settings/changed", { threadId: record.id, source: "engine", model: record.settings.model, permissionMode: record.settings.permissionMode, thinkingTokens: record.settings.thinkingTokens });
    }
    // The host's own busy/waitingFor is NOT mirrored onto `record.busy`: the turn events above own that,
    // and a `state` frame arrives for reasons that are not turn edges (a park, a setter, a swap).
    statusChanged(srv, record);
  }));

  track(engine.onRewound((e) => {
    // Any client's resume/clear/rewind (§1a-a makes all three announce). The epoch bump is what
    // invalidates every outstanding read cursor (subscribe.ts) — the rows those cursors addressed are not
    // the rows the same offsets address now.
    record.epoch += 1;
    if (e.cleared) record.sessionId = undefined; else if (e.sessionId) record.sessionId = e.sessionId;
    // The per-turn replay window belongs to the conversation the host just discarded — the same reason
    // rewind.ts's `swapEngine` drops it on the inProcess origin, and the host's own swapEngine drops its
    // turn buffer: subscribe.ts replays `record.buffer` to every client that joins before the next turn
    // resets it, so leaving it would hand the next client item events from a turn that is no longer in
    // the transcript it is about to read.
    record.buffer = [];
    record.updatedAt = nowSec();
    installFrames();                    // the epoch moved — see installFrames
    broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId: record.id, sessionId: record.sessionId ?? null, ...(e.cleared ? { cleared: true } : {}) });
  }));

  // §1f's death sequence — the host crashed, was killed, or the network went. It is a SEQUENCE, not a
  // latch: the latch already exists on the engine (`isEnded`, which dispatch's -33005 gate reads), and
  // what this owes a client is everything the latch cannot say. Fired only for an UNEXPECTED close —
  // `dispose()` and `thread/stop` both pre-latch `expectDeath()`, so a release this server asked for
  // never announces a loss.
  //
  // ORDER IS THE CONTRACT, and the first step is the load-bearing one: a client watching a turn must get
  // that turn's terminal event BEFORE it hears the connection is gone, or it is left holding a turn row
  // that never ends. The engine has already rejected the in-flight submit by the time this runs (die()
  // sweeps its waiter before fanning here), but a fleet turn's lifecycle is not owned by the submit — this
  // layer owns it (§1b), for foreign turns as much as our own — so the broadcast is ours to make, rendered
  // exactly as turns.ts's `onFailure` renders a rejected in-process turn.
  track(engine.onSocketDeath(() => {
    if (windowId !== undefined) {
      // The open items are finalized FAILED first, same as every other failure path: a client left with an
      // `item/started` that never completes cannot render the turn at all.
      if (mapper) emitItems(srv, record, windowId, mapper.finalize(true));
      const turnId = windowId;
      mapper = undefined; windowId = undefined;
      record.busy = false;
      record.turnStartedBroadcast = false;
      // `currentTurnId` is left standing, exactly as the normal turn end leaves it (the replay path wants
      // the last turn's id).
      srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "failed", error: CONNECTION_LOST } });
    }
    record.busy = false;               // idle-at-death holds too: there may have been no turn to fail
    record.updatedAt = nowSec();
    // SILENTLY (§1f, and broker.ts's `discard`): the host may be dead or alive — a crashed host's parks
    // died with it, a network loss left them exactly where they were — and this server cannot tell which,
    // so it must not claim either.
    srv.threadDecisions(record.id)?.discard();
    // A fact about what the thread now IS, not an aside to whoever last asked for something — so it fans
    // to subscribers and watchers alike, the same shape rewind.ts's re-push warning uses.
    broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "warning", { threadId: record.id, code: "fleetConnectionLost", message: CONNECTION_LOST_HINT });
    statusChanged(srv, record);
    // The RECORD stays: a zombie answering -33005 to everything but the exempt set, until a client's own
    // `thread/close` drops it (§1f — recovery is close plus a fresh attach; there is no auto-reconnect,
    // D-M3-13).
  }));

  return () => { offItems?.(); offItems = undefined; for (const off of subs.splice(0)) off(); };
}

/** Dial, seed, publish. Returns the record UNACTIVATED — the caller announces `thread/started` first and
 *  releases the replay after (§1e's activation protocol), which is the whole reason this is not one
 *  function with the handler. */
async function admitFleet(srv: AppServer, row: RosterRow): Promise<ThreadRecord> {
  const engine = await connectFleetEngine(hostSocketPath(row.pid));
  try {
    // The settings mirror seeds from the host's own `status` BEFORE the record publishes. The follow
    // replay ends with a `state` frame carrying the same values, but it is held behind the activation
    // barrier until after the reply — so without this read the attach reply would describe a thread whose
    // model and permission mode it has not learned yet.
    const st = await engine.sendOp<{ ok: boolean } & Partial<HostStatus>>({ op: "status" });
    const record: ThreadRecord = {
      id: srv.registry.mint(), origin: "fleet", session: engine, unattended: "park",
      busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [],
      subscribers: new Set(), chain: Promise.resolve(),
      // The read substrate IS the persisted transcript: `thread/read` on a fleet thread is disk-only
      // (§1f) and pages off this id, so stamping it here is the whole of "seed the history" — the same
      // eager stamp `thread/resume`'s admission makes ahead of any frame (server.ts's startThread). The
      // host's own answer wins over the roster's copy, which a running session rewrites.
      sessionId: st.sessionId ?? row.sessionId,
      // The SESSION's birth, not this attach's: a client sorting threads by age is asking how old the
      // conversation is. (Roster stamps are ms; every record timestamp here is unix seconds.)
      createdAt: Math.floor(row.startedAt / 1000), updatedAt: nowSec(),
      cwd: row.cwd, short: row.short, name: row.name,
      settings: { model: st.model, permissionMode: st.permissionMode, thinkingTokens: st.thinkingTokens },
      // `config` stays absent: a fleet record's engine is the HOST's, and the field exists for the local
      // swap that rebuilds one (registry.ts) — which never runs for this origin (§1b).
      flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0,
    };
    record.fleetOff = installFleetEvents(srv, record, engine);
    srv.admitFleetThread(record);
    return record;
  } catch (e) {
    // Nothing was published, so nothing will ever dispose this socket — and a host with a follower it
    // cannot reach keeps buffering for it.
    await engine.dispose().catch(() => {});
    throw e;
  }
}

/** `decision/respond` on a FLEET thread (§1b) — the branch server.ts's handler takes once the params, the
 *  thread lookup and the dispatch gates have all passed, so a fleet thread refuses the same things in the
 *  same order an inProcess one does. Two rules are the whole of it:
 *
 *   1. FORWARD UNCONDITIONALLY. The local view is not consulted in either direction: first-answer-wins is
 *      host-side (every client of that host races the same park), so a view that still looks parked is not
 *      permission to answer and a view already dropped is not proof there is nothing to answer. The host's
 *      receipt is the only verdict, and it is mapped EXACTLY — its three shapes are P106's live recording
 *      (2026-08-11), matched on what the host actually says rather than on a shape invented here.
 *   2. NEVER SETTLE THE VIEW. Removal is `decision_settled`-driven only (installFleetEvents above), for
 *      the winning respond too — it observes its own settlement like every other client of that host.
 *      Settling here as well would announce the resolution twice, the first time under a `by` this server
 *      made up. */
export async function fleetDecisionRespond(ctx: ConnCtx, id: RequestId, record: ThreadRecord, p: { toolUseId: string; answer: DecisionOutcome; abortTurn?: boolean }): Promise<void> {
  let receipt: AnswerReceipt;
  // The cast is `turn/start`'s (turns.ts): `answer` is a FLEET engine's member, and `record.origin` is the
  // guarantee behind it — fleet.ts is the only writer of that pair.
  try { receipt = await (record.session as FleetEngineSession).answer(p.toolUseId, p.answer); }
  catch (e) { replyEngineThrow(record, ctx, id, e, ERR.INTERNAL); return; }
  // A LOST RACE, not a refusal — hence `ok:true` (host.ts): two humans answering one prompt is normal, and
  // the loser is told who won. The same -33002 with the same `data.by` a second answer to a LOCAL park
  // gets, so a client handles one shape whichever origin raced it.
  if (receipt.alreadyAnsweredBy !== undefined) { ctx.peer.replyError(id, ERR.ALREADY_SETTLED, "Already settled", { by: receipt.alreadyAnsweredBy }); return; }
  if (!receipt.ok) {
    const error = receipt.error ?? "host refused the answer";
    // An id the host is not holding — which is what the LOCAL path answers for an unknown id too, down to
    // the absent `data.by` (there is no winner to name). Spelled the same way here, deliberately: the two
    // origins must not disagree about what "I do not have that decision" is.
    if (error.startsWith("no parked request")) { ctx.peer.replyError(id, ERR.ALREADY_SETTLED, "Already settled", { by: undefined }); return; }
    // Kind mismatch carries the HOST's own message — it names the park's kind and the answer's, which this
    // server cannot reconstruct: it never sees the host's park, only a view of it.
    if (error.startsWith("kind mismatch")) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, error); return; }
    // Anything else is the generic `{ok:false, error}` a THROWING host handler produces (host/server.ts
    // wraps every dispatch): a failure to answer, not a verdict on the answer.
    ctx.peer.replyError(id, ERR.INTERNAL, error);
    return;
  }
  // NO local `armPlanUpgrade` for a plan approval, unlike the inProcess path: the host runs its own on the
  // answer it has just taken (host.ts's answer -> applyPlanUpgrade) and republishes the granted mode on
  // `state`, which the event layer mirrors. Arming here would forward a second `set_permission_mode` for a
  // mode the host already set — the flag layer's rule (§1b), that the host is the single owner.
  if (p.abortTurn) await requestInterrupt(record);
  ctx.peer.reply(id, { ok: true });
}

/** Why `thread/stop` is not finished yet, or `undefined` when it is. Two conditions, in the order they
 *  become true, and each is a different thing to be stuck on — which is the whole reason the poll reports a
 *  reason rather than a bare timeout: "the host never let go of the socket" and "the host let go but never
 *  accounted for itself" send a client to different places.
 *
 *  A roster row that is GONE counts as terminal. A concurrent `ccx rm` unlinks it, and waiting for a state
 *  nobody will ever write again is waiting forever — the session is at least as finished as a stamped row
 *  says it is. */
function stopStuckReason(record: ThreadRecord, engine: FleetEngineSession): string | undefined {
  if (!engine.isEnded()) return "the host has not closed the connection";
  const row = record.short === undefined ? undefined : readRoster(record.short);
  if (row && !TERMINAL.has(row.state)) return `roster row ${record.short} still reads ${JSON.stringify(row.state)}`;
  return undefined;
}

/** `thread/stop` on a FLEET thread (§1e): end the HOST. The counterpart of `thread/close`, which only ends
 *  this server's hold on it — the asymmetry that makes stop its own method.
 *
 *  EOF IS THE CONTRACT, NOT A RECEIPT. `SessionHost.stop` tears down its server, destroying every open
 *  socket, before the dispatch that would have written a reply (host/server.ts's close() cannot wait on the
 *  connection carrying the very op it is answering, or it deadlocks) — P106 measured exactly that, and
 *  `ccx stop` ignores the missing ack for the same reason. So the op is written and never awaited: its
 *  ordinary outcome is the connection-closed rejection every in-flight op takes, and a host that happens to
 *  ack resolves it. Neither is the verdict.
 *
 *  The verdict is the POLL: the socket at EOF and the roster row terminal. It is the roster the rest of the
 *  world reads — `ccx fleet list`, this server's own `fleet/list`, the next attach's resolution — so a stop
 *  that returned on the EOF alone would report a session ended while every listing still called it working.
 *  A stop that runs out of cap throws, and the CALLER keeps the record: a host that would not die is a host
 *  a client may still need to reach.
 *
 *  Does NOT close the record — `thread/stop`'s handler does that, through the same `closeRecord` every
 *  other teardown goes through, so a stopped fleet thread and a closed one leave the server in one state. */
export async function fleetStop(srv: AppServer, record: ThreadRecord): Promise<void> {
  // The cast is `decision/respond`'s: `expectDeath` is a FLEET engine's member and `record.origin` is the
  // guarantee behind it — fleet.ts is the only writer of that pair.
  const engine = record.session as FleetEngineSession;
  // FIRST, before the op is on the wire: this death is the client's own, so §1f's sequence — the failed
  // turn, the fleetConnectionLost warning — must not fire for it. A stop that latched after writing would
  // race the host's teardown and announce a loss for a session the client just ended. Given BACK if the
  // poll times out on a socket that is still open — see the loop.
  engine.expectDeath();
  const { stepMs, capMs } = srv.deps.stopPoll ?? STOP_POLL;
  // `Infinity`: there is no deadline to keep on a promise nobody reads. Caught, not left floating — an
  // unhandled rejection here would take the process down for the ordinary path.
  void engine.sendOp({ op: "stop" }, Infinity).catch(() => {});
  const deadline = Date.now() + capMs;
  for (;;) {
    const stuck = stopStuckReason(record, engine);
    if (stuck === undefined) return;
    if (Date.now() >= deadline) {
      // THE LATCH GOES BACK, because the death it was armed for never came: the socket is still open, the
      // record stays standing (see the doc above), and whatever kills that host next is a loss nobody
      // asked for — §1f's sequence, in full. Left armed, the client's only word about a thread that later
      // dies is -33005 on its next call, with no failed turn, no warning and no status change.
      //
      // ONLY on this branch. When the stuck reason is the OTHER one — the engine already ended, the roster
      // row just never turned terminal — the death has ALREADY happened under the latch and was correctly
      // suppressed; re-arming would leave a latch nothing can ever fire, and nothing to resurrect either.
      if (!engine.isEnded()) engine.cancelExpectDeath();
      throw new Error(`thread/stop did not complete within ${capMs}ms: ${stuck}`);
    }
    await sleep(stepMs);
  }
}

/** `fleet/list` — every session on this machine, attached or not (§1e). The live half is `collectFleet`
 *  ITSELF, not a copy of it: the probe fold (pid → socket → status → projectRow) and its per-row fault
 *  isolation are one seam, so a listing here and `ccx fleet list` cannot drift on what "working" or
 *  "unresponsive" means — an arm added to that fold reaches both or neither. This handler owns only the
 *  join: the roster columns the projection drops (pid, kind, the two timestamps) and `threadId`, the one
 *  column this server knows. Joined by `short`, the roster's own primary key. */
export const fleetList: Handler = async (srv, ctx, id, params) => {
  const parsed = fleetListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const held = new Map<string, string>();
  for (const r of srv.registry.list()) if (r.origin === "fleet" && r.short) held.set(r.short, r.id);
  const rows = listRoster();
  const probed = new Map((await collectFleet()).map((a) => [a.id, a])); // AgentsRow.id IS the short
  const data = rows.map((roster) => {
    // A row `collectFleet` did not see was written between the two roster reads — brand new, and the
    // roster's own state is the honest answer for it rather than a probe result nobody took.
    const live = probed.get(roster.short);
    const threadId = held.get(roster.short);
    return {
      short: roster.short, name: roster.name, kind: roster.kind, state: live?.state ?? roster.state, pid: roster.pid, cwd: roster.cwd,
      ...(roster.sessionId ? { sessionId: roster.sessionId } : {}),
      startedAt: roster.startedAt,
      ...(roster.endedAt === undefined ? {} : { endedAt: roster.endedAt }),
      ...(live?.unresponsive ? { unresponsive: true } : {}),
      ...(threadId ? { threadId } : {}),
    };
  });
  ctx.peer.reply(id, { data });
};

/** `thread/attach` — adopt a running fleet session as a thread (§1e). */
export const threadAttach: Handler = async (srv, ctx, id, params) => {
  const parsed = threadAttachParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  const target = parsed.data.target;
  // The CLI's actual rule (cli/lifecycle.ts's findTarget), not a re-derivation: a client addresses the
  // same session by the same handle here and at the terminal.
  const matches = listRoster().filter((r) => r.short === target || r.sessionId === target || r.name === target);
  if (matches.length === 0) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, `no fleet session matches ${JSON.stringify(target)}`); return; }
  if (matches.length > 1) {
    // Ambiguity is an ERROR listing its matches, never a precedence (CLI parity): a wrong guess attaches
    // to someone else's session, and the client can re-ask with a handle that is unique.
    ctx.peer.replyError(id, ERR.ATTACH_FAILED, `ambiguous target ${JSON.stringify(target)}`, { matches: matches.map((m) => ({ short: m.short, name: m.name })) });
    return;
  }
  const row = matches[0];
  if (TERMINAL.has(row.state)) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, "session already ended"); return; }
  // Already held: return the same thread, mint nothing, announce nothing (idempotent, mirroring Codex's
  // rejoin). Keyed by `short`, so the three handles that resolve to one row all land on one thread.
  const held = srv.registry.list().find((r) => r.origin === "fleet" && r.short === row.short);
  if (held) { ctx.peer.reply(id, { thread: threadView(srv, held) }); return; }
  // Everything above is SYNCHRONOUS, which is what makes the reservation below sound: two attaches
  // dispatched in one tick both reach this line before either awaits.
  const inflight = srv.attachingShorts.get(row.short);
  if (inflight) {
    // The loser: it neither dials nor announces — it answers with the winner's record, or with the
    // winner's failure (a target that could not be attached is not attachable for either caller).
    try { ctx.peer.reply(id, { thread: threadView(srv, await inflight) }); }
    catch (e) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, `cannot attach to ${row.short}: ${msg(e)}`); }
    return;
  }
  const admission = admitFleet(srv, row);
  srv.attachingShorts.set(row.short, admission);
  let record: ThreadRecord;
  try { record = await admission; }
  catch (e) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, `cannot attach to ${row.short}: ${msg(e)}`); return; }
  // Released in a `finally`-equivalent position on both paths: a failed attach must leave the target
  // attachable rather than poisoned by its own reservation.
  finally { srv.attachingShorts.delete(row.short); }
  ctx.peer.reply(id, { thread: threadView(srv, record) });
  srv.broadcastServer("thread/started", { thread: threadView(srv, record) });
  // LAST (§1e's activation protocol). The follow replay has been queued since the dial; releasing it here
  // is what guarantees no replayed frame is lost to a missing listener or delivered ahead of
  // `thread/started`. The cast is safe by construction — `admitFleet` is the only writer of this field.
  (record.session as FleetEngineSession).activate();
};

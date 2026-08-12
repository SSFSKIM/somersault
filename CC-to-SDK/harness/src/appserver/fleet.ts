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
import { listRoster, TERMINAL } from "../fleet/roster.js";
import type { RosterRow } from "../fleet/roster.js";
import { hostSocketPath } from "../fleet/paths.js";
import { isPidLive, socketAnswers } from "../fleet/liveness.js";
import { askStatus } from "../fleet/status.js";
import { projectRow } from "../fleet/project.js";
import type { HostStatus } from "../host/ops.js";
import { connectFleetEngine } from "./fleetEngine.js";
import type { FleetEngineSession } from "./fleetEngine.js";
import { ERR } from "./rpc.js";
import { emptyFlagPerms, fleetTurnId, threadStatus } from "./registry.js";
import type { ThreadRecord } from "./registry.js";
import { TurnMapper } from "./items/mapper.js";
import { emitItems } from "./turns.js";
import { installRouter } from "./router.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { threadView } from "./server.js";
import type { AppServer, Handler } from "./server.js";
import { fleetListParams, threadAttachParams } from "./schema/fleet.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // registry.ts's `updatedAt` is unix seconds
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The ONE status shape (registry.ts), same as turns.ts's own private helper — `waitingOn` needs the
 *  decisions map, which the record does not have. */
function statusChanged(srv: AppServer, record: ThreadRecord): void {
  srv.broadcast(record.id, "thread/status/changed", { threadId: record.id, status: threadStatus(record, srv.pendingDecisions(record.id).length > 0) });
}

/** Everything a fleet thread learns from its host that is NOT an SDK frame (§1b's host-synthesized set).
 *  Installed BEFORE the record is published and BEFORE `activate()`, so the follow replay — buffered
 *  since the dial — finds every listener in place. */
export function installFleetEvents(srv: AppServer, record: ThreadRecord, engine: FleetEngineSession): void {
  // ONE mapper and ONE derived id per turn WINDOW, whoever started the turn (§1b: "one mapper owner per
  // turn window, both origins of the turn"). Held in this closure rather than on the record because
  // nothing outside this layer may feed them — `turns.ts`'s fleet branch passes an inert sink precisely
  // so a turn is itemized once, here, from the frames every client of the host sees.
  let mapper: TurnMapper | undefined;
  let windowId: string | undefined;

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
    // `replay` (the callback's second argument) is deliberately unread: a replayed message frame inside a
    // turn window IS that turn's own item, and the buffer it lands in is the per-turn live window, not
    // history. There is nothing to double-count — `thread/read` is disk-only for a fleet thread (§1f) and
    // the host's socket replay covers the live turn the disk does not have yet (probe 62; chatAdapter.ts's
    // resume-before-follow rule is the same split from the other side).
    offItems = engine.onFrame((m) => {
      if (!mapper || windowId === undefined) return; // outside a turn there is no turn to attribute items to
      emitItems(srv, record, windowId, mapper.ingest(m));
    });
  };
  installFrames();

  engine.onTurn((e) => {
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
    // The host runs one turn at a time, so an end naming a different turn than the open window is a stale
    // frame rather than a second live turn — settling the open window on it would report the wrong id.
    if (windowId !== undefined && windowId !== turnId) return;
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
    srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: failure === undefined ? { id: turnId, status: "completed" } : { id: turnId, status: "failed", error: failure } });
    statusChanged(srv, record);
  });

  // A park raised host-side, mirrored as a VIEW (broker.ts's parkView) — looked up per event rather than
  // captured, so a park arriving after the thread closed reaches nothing instead of a dangling registry.
  engine.onDecision((entry) => { srv.threadDecisions(record.id)?.parkView(record.id, entry); });

  engine.onTasksChanged((tasks) => { srv.broadcast(record.id, "task/changed", { threadId: record.id, tasks }); });

  engine.onState((s) => {
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
  });

  engine.onRewound((e) => {
    // Any client's resume/clear/rewind (§1a-a makes all three announce). The epoch bump is what
    // invalidates every outstanding read cursor (subscribe.ts) — the rows those cursors addressed are not
    // the rows the same offsets address now.
    record.epoch += 1;
    if (e.cleared) record.sessionId = undefined; else if (e.sessionId) record.sessionId = e.sessionId;
    record.updatedAt = nowSec();
    installFrames();                    // the epoch moved — see installFrames
    broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId: record.id, sessionId: record.sessionId ?? null, ...(e.cleared ? { cleared: true } : {}) });
  });

  // §1f's death sequence is Task 9's, and it is a SEQUENCE (settle the in-flight turn, clear busy, drop
  // the parked views, warn) rather than a latch — the latch already exists, on the engine (`isEnded`),
  // and dispatch's -33005 gate is the only reader that matters until then. Subscribed here so the seam is
  // where Task 9 needs it, and because an unsubscribed death is an event this layer would never see.
  engine.onSocketDeath(() => { /* Task 9 (§1f) */ });
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
    installFleetEvents(srv, record, engine);
    srv.admitFleetThread(record);
    return record;
  } catch (e) {
    // Nothing was published, so nothing will ever dispose this socket — and a host with a follower it
    // cannot reach keeps buffering for it.
    await engine.dispose().catch(() => {});
    throw e;
  }
}

/** `fleet/list` — every session on this machine, attached or not (§1e). The join is per row and
 *  fault-isolated for the same reason `collectFleet`'s is: one host that throws mid-probe must cost its
 *  own row's live state, never the listing — a terminal row nobody can read is exactly the blindness this
 *  listing exists to prevent. */
export const fleetList: Handler = async (srv, ctx, id, params) => {
  const parsed = fleetListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const held = new Map<string, string>();
  for (const r of srv.registry.list()) if (r.origin === "fleet" && r.short) held.set(r.short, r.id);
  const rows = listRoster();
  const probed = await Promise.allSettled(rows.map(async (roster) => {
    const sock = hostSocketPath(roster.pid);
    const pidLive = await isPidLive(roster.pid, roster.procStart);
    const answers = pidLive ? await socketAnswers(sock) : false;
    const liveStatus = answers ? await askStatus(sock) : undefined;
    return projectRow({ roster, pidLive, socketAnswers: answers, ...(liveStatus ? { liveStatus } : {}) });
  }));
  const data = rows.map((roster, i) => {
    const settled = probed[i];
    const live = settled.status === "fulfilled" ? settled.value : projectRow({ roster, pidLive: false, socketAnswers: false });
    const threadId = held.get(roster.short);
    return {
      short: roster.short, name: roster.name, kind: roster.kind, state: live.state, pid: roster.pid, cwd: roster.cwd,
      ...(roster.sessionId ? { sessionId: roster.sessionId } : {}),
      startedAt: roster.startedAt,
      ...(roster.endedAt === undefined ? {} : { endedAt: roster.endedAt }),
      ...(live.unresponsive ? { unresponsive: true } : {}),
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

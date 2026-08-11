// appserver/server.ts — AppServer dispatcher (spec §3.9): connection gating (initialize), a flat
// method table, per-thread serialization via record.chain, and thread lifecycle (start/resume/
// list/close). Turn/decision/subscribe/read land in Tasks 7-9 on top of this spine.
import { createRequire } from "node:module";
import { Peer, type PeerSink } from "./peer.js";
import { classify, ERR, type RequestId } from "./rpc.js";
import { Registry, activeTurnId, emptyFlagPerms, originRefusal, seedSettings, threadStatus, type ThreadRecord, type EngineSession } from "./registry.js";
import { listRoster, TERMINAL, type RosterRow } from "../fleet/roster.js";
import { isPidLive } from "../fleet/liveness.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import { ThreadDecisions, toWireDecision, type DecisionEvent } from "./broker.js";
import type { DecisionOutcome, PermissionBroker } from "../permissions/types.js";
import type { PendingDecision } from "../permissions/pending.js";
import { turnStart, turnInterrupt, turnSteer, requestInterrupt } from "./turns.js";
import { flushQueue } from "./queue.js";
import { threadSubscribe, threadUnsubscribe, threadRead } from "./subscribe.js";
import { modelSet, permissionModeSet, thinkingSet, settingsApply } from "./settings.js";
import { capabilitiesRead, contextUsageRead, usageRead, initRead, accountRead } from "./introspect.js";
import { threadCompactStart, threadReinitialize } from "./lifecycle.js";
import { threadList, threadFork, threadNameSet, threadTagSet, threadDelete } from "./sessionLib.js";
import { armPlanUpgrade } from "./planUpgrade.js";
import { installRouter } from "./router.js";
import { broadcastToWatchers, broadcastToSubscribersAndWatchers } from "./fanout.js";
import { rewindAnchors, rewindDryRun, threadRewind } from "./rewind.js";
import { mcpStatusList, mcpReconnect, mcpToggle, mcpSet, mcpPermissionModeOverrideSet } from "./mcp.js";
import { taskList, taskStop, turnBackground } from "./tasks.js";
import { settingsRead, directoryList, directoryAdd, directoryRemove, permissionRuleAdd, permissionRuleRemove, outputStyleSet, effortSet, threadClear } from "./settingsOps.js";
import { pluginReload, skillReload } from "./reloads.js";
import { initializeParams, threadIdParams } from "./schema/core.js";
import { threadStartParams, threadResumeParams } from "./schema/threads.js";
import { decisionRespondParams, decisionListParams } from "./schema/decisions.js";

const require = createRequire(import.meta.url);
const pkgVersion = (require("../../package.json") as { version: string }).version;
const USER_AGENT = "cc-harness-appserver";

export interface AppServerDeps {
  sessionFactory?: (config: Record<string, unknown>) => EngineSession;
  // Task 13: `opts` pages the transcript by ROW window (offset/limit forwarded to src/sessions'
  // getSessionMessages, which forwards to the SDK) — subscribe.ts's threadRead is the only caller
  // that ever passes it; every other caller of this DI slot omits it entirely.
  getSessionMessages?: (sessionId: string, opts?: { limit?: number; offset?: number }) => Promise<unknown[]>;
  // Task 12 (session library): DI-defaulted, at each call site, to the real src/sessions/index.js
  // exports — mirrors getSessionMessages above. `unknown[]`/void return shapes (rather than the real
  // wrappers' typed SDKSessionInfo[]/ForkSessionResult) keep this interface decoupled from the SDK's
  // exported types; the real functions' richer return types are assignable to these narrower ones.
  listSessions?: (opts: { cwd?: string; limit?: number; offset?: number }) => Promise<unknown[]>;
  forkSession?: (id: string, opts: { cwd?: string; upToMessageId?: string; title?: string }) => Promise<{ sessionId: string }>;
  renameSession?: (id: string, title: string) => Promise<void>;
  tagSession?: (id: string, tag: string | null) => Promise<void>;
  deleteSession?: (id: string) => Promise<void>;
  // M2b Task 1: the replacement-engine factory rewind's conversation swap opens — separate from
  // `sessionFactory` above because it takes the resume anchor as an argument rather than a bare config,
  // and because a test overriding one has no reason to be forced into overriding the other. Defaulted at
  // its call site (rewind.ts) to the same openSession-with-resumeAt primitive rewindSession uses.
  // `droppedTurnUuid` (M3 Wave 0) is the prompt uuid of the turn the truncation throws away — the
  // request's own `uuid`, since the rewind resumes at `prevUuid`. It rides beside the anchor rather than
  // inside `config` because it is derived per-rewind from the request, exactly as `resumeAt` is, while
  // `config` is the thread's unchanging start config.
  resumeAtFactory?: (sessionId: string, resumeAt: string, droppedTurnUuid: string, config: Record<string, unknown>) => EngineSession;
}
export interface ConnCtx {
  peer: Peer;
  initialized: boolean;
  authed: boolean;
  clientName?: string;
  connId: number;
  watchThreads: boolean; // initialize{watchThreads:true} — this connection wants thread-EXISTENCE fan-out (fanout.ts)
  optOut: Set<string>;   // initialize{optOutNotificationMethods} — the SAME instance the Peer was built with (mutable-in-place)
}

/** parent §5's full Thread projection (14 fields) — a GUI's thread row. `title`/`tags` reflect only
 *  what thread/name/set or thread/tag/set have explicitly patched onto this record (registry.ts) — a
 *  thread that was never renamed/tagged in-process reads `undefined` here even if the store has a title
 *  for it; sessionLib.ts's merged thread/list is what fills that gap from a store match, on the VIEW it
 *  builds, without mutating the record. `preview` stays store-only (no registry equivalent exists) and is
 *  always `undefined` off this function. `status` goes through the one predicate+shape pair (registry.ts,
 *  spec D-M2-8) — `waitingOn` needs the decisions map, which the record itself does not have, hence `srv`.
 *  `queueDepth` (M2b Task 8, flagged addition to §5) is ALWAYS present and 0 when the queue is empty,
 *  rather than omitted-when-zero: a thread row that answers "how many turns are waiting" with a missing
 *  key forces every consumer to write the `?? 0` itself, and one that forgets it renders "unknown" for the
 *  ordinary case. It counts only turns that have NOT started — the running turn is `status`'s business.
 *
 *  `cwd` is ORIGIN-BRANCHED (M3 §1b; `fs/search` and `thread/shellCommand` both root themselves on it):
 *  an inProcess thread whose start config named no cwd genuinely runs in THIS process's cwd, so reporting
 *  that is a fact, not a placeholder. A fleet thread does not — its session runs wherever its roster row
 *  says, filled at attach (Task 7) — so an absent value stays absent rather than borrowing ours, which
 *  would point a client's file reads at the wrong tree. `short`/`name` are the roster's own handles and
 *  exist for fleet threads only; the keys are OMITTED (not undefined) on inProcess rows, which keeps this
 *  view's key set identical to sessionLib.ts's store-only projection for every row that predates M3. */
export function threadView(srv: AppServer, r: ThreadRecord): Record<string, unknown> {
  const waitingOn = srv.pendingDecisions(r.id).length > 0;
  return {
    id: r.id,
    sessionId: r.sessionId,
    title: r.title,
    tags: r.tags,
    cwd: r.origin === "inProcess" ? r.cwd ?? process.cwd() : r.cwd,
    ...(r.origin === "fleet" ? { short: r.short, name: r.name } : {}),
    model: r.settings.model,
    permissionMode: r.settings.permissionMode,
    thinking: { maxTokens: r.settings.thinkingTokens },
    status: threadStatus(r, waitingOn),
    queueDepth: r.queue.length,
    origin: r.origin,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    preview: undefined,
  };
}

/** The one seam thread/start and thread/resume both build their engine config through — extended in
 *  Task 7 to inject the thread's decision broker as the SDK's canUseTool seam. */
function buildConfig(parsed: { config?: Record<string, unknown>; unattended: "park" | "deny" }, broker: PermissionBroker): OpenSessionConfig {
  return { ...(parsed.config as OpenSessionConfig | undefined), permissionBroker: broker };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

const RESUME_LIVE_FLEET = "sessionId belongs to a running fleet session; use thread/attach";

/** The synchronous half of `thread/resume`'s live-session guard (spec §1c). `thread/resume` is NOT
 *  origin-gated — it CREATES a thread, so there is no record to gate on — but the hazard it opens is real:
 *  resuming a sessionId a running ccx session is still writing forks a second engine over a live
 *  conversation, and both then append to the same store id. `thread/attach` is what that caller wants, so
 *  the refusal names it.
 *
 *  Two sources, both needed: a session THIS server already attached is authoritative on its own (and its
 *  roster row may be mid-rewrite), while a live fleet session nobody here attached is invisible to the
 *  registry. Answers `"live"` for the first, or the roster rows that still need a liveness probe for the
 *  second — never a promise. That split is load-bearing, not a micro-optimization: `thread/resume` must
 *  reach `startThread` in the SAME TICK it was dispatched, because the delete/resume reservation race
 *  (sessionLib.ts) is decided by which of the two admits first, and an `await` on the happy path (where
 *  there is no roster row to probe at all — the overwhelmingly common case) would silently hand every
 *  same-tick delete the win.
 *
 *  Deliberately NOT `collectFleet`: that dials every host's socket to derive live state, which is a great
 *  deal of I/O for one yes/no, and its extra precision (busy vs idle) is not what this asks. A
 *  non-terminal row whose pid is still alive IS "still running"; a terminal row is a finished session,
 *  whose transcript is exactly what resume is for. */
function fleetResumeCandidates(srv: AppServer, sessionId: string): "live" | RosterRow[] {
  if (srv.registry.list().some((r) => r.origin === "fleet" && r.sessionId === sessionId)) return "live";
  return listRoster().filter((r) => r.sessionId === sessionId && !TERMINAL.has(r.state));
}

/** Methods still answerable when the thread's engine is dead (dispatch's -33005 gate). The invariant is
 *  "answerable without live transport", not "is a read" — three families:
 *  close/read/subscribe/unsubscribe/decision-list, because closing and reading history are exactly what a
 *  client does with a dead thread; the store-only CRUD (sessionLib.ts), because renaming, tagging,
 *  forking or deleting a persisted session never touches the engine at all — refusing them is refusing the
 *  cleanup a client reaches for precisely when a thread has died (thread/delete keeps its own live-guard,
 *  which is about the session being LIVE, not about the engine being alive); and `task/list`, because the
 *  real `Session.listBackgroundTasks` returns the cached `_bgTasks` level signal with no engine round-trip
 *  (session/session.ts) — the last known task set stays answerable forever, which is exactly what a client
 *  reconciling a dead thread wants; and `thread/directory/list` (M2b Task 3b), which is assembled entirely
 *  from the record (cwd + the start config's dirs + this thread's own accumulator) and never reaches an
 *  engine at all — its sibling `thread/settings/read` is NOT exempt, because that one is a real control
 *  request over the live transport. Exemption is not a promise the call cannot fail: an engine that DOES
 *  throw still lands in dispatch's post-handler catch, which re-checks engineGone and maps it there. */
const ENGINE_GONE_EXEMPT = new Set([
  "thread/close", "thread/read", "thread/subscribe", "thread/unsubscribe", "decision/list",
  "thread/name/set", "thread/tag/set", "thread/fork", "thread/delete",
  "task/list", "thread/directory/list",
]);

export type Handler = (srv: AppServer, ctx: ConnCtx, id: RequestId, params: Record<string, unknown>) => void | Promise<void>;

export class AppServer {
  readonly registry = new Registry();
  private conns = new Map<number, ConnCtx>();
  private decisions = new Map<string, ThreadDecisions>();
  private connSeq = 0;
  private startedAt = Date.now();
  private shuttingDown = false; // latched by shutdown(); refuses new thread admission (see shutdown())
  /** Store sessionIds with a `thread/delete` in flight against them (sessionLib.ts owns the add/remove).
   *  A store delete is the one op that awaits with nothing holding the session: without this reservation a
   *  `thread/resume` (or a fork's own resume) admitted during that await would end up live on a session
   *  whose history is being erased underneath it. `startThread` refuses admission against a reserved id;
   *  the delete re-checks the live set after reserving, so whichever lands first wins and the other is
   *  refused — never both. */
  readonly deletingSessions = new Set<string>();
  private handlers: Record<string, Handler> = {
    "server/status": (srv, ctx, id) => {
      ctx.peer.reply(id, { uptimeMs: Date.now() - srv.startedAt, threads: srv.registry.list().length, listeners: srv.conns.size });
    },
    "thread/start": async (srv, ctx, id, params) => {
      if (srv.shuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; } // see shutdown()
      const parsed = threadStartParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const threadId = srv.registry.mint();
      const dec = srv.makeDecisions(threadId, parsed.data.unattended);
      const config = buildConfig(parsed.data, dec.broker(threadId));
      const factory = srv.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
      const session = factory(config as Record<string, unknown>); // throws synchronously on an invalid config — dec must NOT be registered yet (else it orphans forever, nothing can ever reach it)
      srv.decisions.set(threadId, dec);
      const nowS = nowSec();
      const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: parsed.data.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId, config: config as Record<string, unknown>, createdAt: nowS, updatedAt: nowS, cwd: parsed.data.config?.cwd as string | undefined, settings: seedSettings(parsed.data.config), flagPerms: emptyFlagPerms(), epoch: 0 };
      srv.registry.add(record);
      installRouter(srv, record); // the snapshot above is undefined until the first turn's init frame (router.ts's routeInit)
      ctx.peer.reply(id, { thread: threadView(srv, record) });
      srv.broadcastServer("thread/started", { thread: threadView(srv, record) });
    },
    "thread/resume": async (srv, ctx, id, params) => {
      const parsed = threadResumeParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      // Before anything is spawned (see fleetResumeCandidates): a live fleet session is the one sessionId
      // this method must not fork. -32602 rather than a new code — the request is well-formed but its ONE
      // parameter names something resume cannot legally act on, which is what INVALID_PARAMS means here
      // (thread/delete's own live-refusal reasons the same way). The loop below awaits ONLY when a roster
      // row actually carries this sessionId; with none (the ordinary case) the handler falls straight
      // through to startThread in its dispatch tick — see fleetResumeCandidates for why that matters.
      const candidates = fleetResumeCandidates(srv, parsed.data.sessionId);
      if (candidates === "live") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_FLEET); return; }
      for (const row of candidates) {
        if (await isPidLive(row.pid, row.procStart)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_FLEET); return; }
      }
      srv.startThread(ctx, id, { resume: parsed.data.sessionId, config: parsed.data.config, unattended: parsed.data.unattended });
    },
    "thread/list": threadList,
    "thread/fork": threadFork,
    "thread/name/set": threadNameSet,
    "thread/tag/set": threadTagSet,
    "thread/delete": threadDelete,
    "thread/close": async (srv, ctx, id, params) => {
      const parsed = threadIdParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const record = srv.registry.get(parsed.data.threadId);
      if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      // Latched SYNCHRONOUSLY at request arrival, before the dispose is queued — same reasoning as
      // beginTurn's own busy gate (turns.ts): the dispose sits behind record.chain, so a compact/
      // reinitialize/turn arriving in that window would otherwise be admitted and run its engine call
      // against a record this close is already tearing down. threadBusyReason reads `closing` first.
      // The flush is the latch's other half (M2b Wave 4, spec: "set the latch synchronously at request
      // arrival … and flush the queue then and there"): every queued turn is answered `cancelled` here,
      // in the same synchronous step, so nothing is left for a later settle to start and nothing is
      // silently dropped. The two lines are a pair — the latch alone would strand the queue, the flush
      // alone would let the next enqueue refill it.
      record.closing = true;
      flushQueue(srv, record);
      record.chain = record.chain.then(async () => {
        try {
          await srv.closeRecord(record);
          ctx.peer.reply(id, { ok: true });
        } catch (e) {
          // the record/decisions are already gone (closeRecord's finally) — the engine is gone from the
          // server's POV either way, so a failed dispose still owes the caller an error, not silence
          ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
        }
      });
    },
    "decision/list": (srv, ctx, id, params) => {
      const parsed = decisionListParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const dec = srv.decisions.get(parsed.data.threadId);
      if (!dec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      // A parked set is small and unpaged (cursor/limit are accepted for envelope uniformity but not
      // consulted yet) — the reply still carries nextCursor so every list method's shape matches (gap 2).
      // Projected to the wire shape (toolUseId) — see broker.ts's toWireDecision.
      ctx.peer.reply(id, { data: dec.pending().map(toWireDecision), nextCursor: null });
    },
    "decision/respond": async (srv, ctx, id, params) => {
      const parsed = decisionRespondParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const record = srv.registry.get(parsed.data.threadId);
      const dec = srv.decisions.get(parsed.data.threadId);
      if (!record || !dec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      const by = `${ctx.clientName}#${ctx.connId}`; // server-stamped only — a client-supplied `by` is never read (spec §6)
      const outcome = parsed.data.answer as DecisionOutcome;
      const result = dec.respond(parsed.data.toolUseId, outcome, by);
      if (!result.ok) {
        if (result.code === "alreadySettled") ctx.peer.replyError(id, ERR.ALREADY_SETTLED, "Already settled", { by: result.by });
        else ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Answer kind does not match the parked decision's kind");
        return;
      }
      // Settling the broker only releases THIS tool call. An approval that GRANTS something additionally
      // upgrades the SESSION's permission mode going forward (mirrors host/host.ts's answer -> planUpgrade):
      // without it the RPC reported {ok:true} while every later edit stayed in the old mode and prompted
      // again. `default` grants nothing — the engine flips there by itself after the allow (probe 97).
      if (outcome.kind === "plan_approve" && outcome.mode !== "default") armPlanUpgrade(record, outcome.mode);
      // spec §6: EVERY answer variant may carry abortTurn, not just `deny` — and aborting goes through the
      // same flag-then-interrupt path turn/interrupt uses, else the turn it just aborted reports "completed"
      if (parsed.data.abortTurn) await requestInterrupt(record);
      ctx.peer.reply(id, { ok: true });
    },
    "turn/start": turnStart,
    "turn/interrupt": turnInterrupt,
    "thread/subscribe": threadSubscribe,
    "thread/unsubscribe": threadUnsubscribe,
    "thread/read": threadRead,
    "thread/model/set": modelSet,
    "thread/permissionMode/set": permissionModeSet,
    "thread/thinking/set": thinkingSet,
    "thread/settings/apply": settingsApply,
    "thread/capabilities/read": capabilitiesRead,
    "thread/contextUsage/read": contextUsageRead,
    "thread/usage/read": usageRead,
    "thread/init/read": initRead,
    "account/read": accountRead,
    "thread/compact/start": threadCompactStart,
    "thread/reinitialize": threadReinitialize,
    "thread/rewind/anchors": rewindAnchors,
    "thread/rewind/dryRun": rewindDryRun,
    "thread/rewind": threadRewind,
    "mcpServer/status/list": mcpStatusList,
    "mcpServer/reconnect": mcpReconnect,
    "mcpServer/toggle": mcpToggle,
    "mcpServer/set": mcpSet,
    "mcpServer/permissionModeOverride/set": mcpPermissionModeOverrideSet,
    "task/list": taskList,
    "task/stop": taskStop,
    "turn/background": turnBackground,
    "thread/settings/read": settingsRead,
    "thread/directory/list": directoryList,
    "thread/directory/add": directoryAdd,
    "thread/directory/remove": directoryRemove,
    "thread/permissionRule/add": permissionRuleAdd,
    "thread/permissionRule/remove": permissionRuleRemove,
    "thread/outputStyle/set": outputStyleSet,
    "thread/effort/set": effortSet,
    "thread/clear": threadClear,
    // M2b Task 5's probe promotions, registered last as their own cluster (probes 103b/105). `turn/steer`
    // is experimental-designated (X) — Task 6 adds the marker mechanism; it registers plainly here.
    // `readFile` deliberately has no method: probe 104 found it callable but resolving null for an
    // existing file AND for a missing path, so there is nothing to serve.
    "turn/steer": turnSteer,
    "plugin/reload": pluginReload,
    "skill/reload": skillReload,
  };

  private readonly token: string;
  // PRESENCE of the option — not truthiness — is what turns auth on. `token: ""` means "auth configured
  // but holding no usable secret", and must fail every client CLOSED; reading it as "no auth configured"
  // is what turned an empty --token-file into a fully open control plane (C2).
  private readonly authRequired: boolean;

  constructor(opts: { token?: string } = {}, public readonly deps: AppServerDeps = {}) {
    this.authRequired = opts.token !== undefined;
    this.token = opts.token ?? "";
  }

  /** The one thread-admission spine shared by thread/resume and Task 12's thread/fork (sessionLib.ts) —
   *  "start a new thread in this server resuming a given session id". Verbatim-extracted from the
   *  pre-Task-12 thread/resume handler body, with one change: `resume` is folded into the config object
   *  handed to the factory (`{...config, resume}`) rather than threaded via a resumeSession(id, config)
   *  closure — mirroring what the real src/session/index.ts resumeSession already does internally
   *  (`openSession({...config, resume: id})`) one level up, so a DI'd `sessionFactory` (every test in this
   *  suite overrides it) can observe `resume` on the config it receives, exactly like any other flag,
   *  instead of it being invisible to anything but the real default factory. */
  startThread(ctx: ConnCtx, id: RequestId, opts: { resume: string; config?: Record<string, unknown>; unattended: "park" | "deny" }): void {
    if (this.shuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; } // see shutdown()
    // BUSY, not a new code: "you may not resume this right now" is exactly what the busy family means on
    // the wire (same reasoning thread/delete's own live-refusal uses). See `deletingSessions`.
    if (this.deletingSessions.has(opts.resume)) { ctx.peer.replyError(id, ERR.BUSY, "Session is being deleted"); return; }
    const threadId = this.registry.mint();
    const dec = this.makeDecisions(threadId, opts.unattended);
    const config = { ...buildConfig({ config: opts.config, unattended: opts.unattended }, dec.broker(threadId)), resume: opts.resume };
    const factory = this.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
    const session = factory(config as Record<string, unknown>); // same ordering as thread/start: register dec only once the factory hasn't thrown
    this.decisions.set(threadId, dec);
    const nowS = nowSec();
    // `sessionId` is stamped EAGERLY with the resume target, at registration, ahead of any frame: this is
    // the one admission path where the registry legitimately knows the store id before the engine reports
    // it (router.ts's init latch only confirms the same id later, and a getter read here would be
    // undefined on a real engine anyway). The live-guard in sessionLib.ts is what needs it — a resume
    // admitted this tick must already be findable by sessionId, or a concurrent thread/delete deletes the
    // history out from under it.
    // `config` is the FULL object the factory received (broker and `resume` included) — M2b's rewind swap
    // rebuilds the replacement engine from it, so anything dropped here is silently dropped by every later
    // swap too (registry.ts's field doc).
    const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: opts.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: opts.resume, config: config as Record<string, unknown>, createdAt: nowS, updatedAt: nowS, cwd: opts.config?.cwd as string | undefined, settings: seedSettings(opts.config), flagPerms: emptyFlagPerms(), epoch: 0 };
    this.registry.add(record);
    installRouter(this, record); // no-op on the init route in practice — resume already knows the id — but keeps one rule for both entry points
    ctx.peer.reply(id, { thread: threadView(this, record) });
    this.broadcastServer("thread/started", { thread: threadView(this, record) });
  }

  /** The shutdown latch, readable by the handlers that create a thread out of band (sessionLib.ts's
   *  thread/fork writes to the store BEFORE it reaches startThread's own refusal, so it has to consult
   *  the latch itself — both before and after that write). */
  get isShuttingDown(): boolean { return this.shuttingDown; }

  /** Tear one thread down: settle its parked decisions, dispose the engine, tell the thread's subscribers,
   *  drop the record. Shared by thread/close and shutdown().
   *
   *  ORDER IS LOAD-BEARING (C1): the real Session.dispose() is `input.close(); await this.done`, and
   *  `done` is the read loop — which cannot end while a turn sits blocked inside canUseTool awaiting one of
   *  our parked promises. teardown() is the only thing that settles those promises, so awaiting dispose()
   *  FIRST is a circular wait: thread/close never replies, the record stays busy, no decision/resolved ever
   *  goes out, and record.chain stays pending forever so every later request for the thread hangs too.
   *
   *  Rethrows a failing dispose() (the caller owes its own reply) but still broadcasts + drops the record
   *  in `finally` — the engine is gone from the server's point of view either way. thread/closed goes out
   *  BEFORE the delete, since broadcast() no-ops once the record is out of the registry. */
  private async closeRecord(record: ThreadRecord): Promise<void> {
    this.decisions.get(record.id)?.teardown();
    record.routerOff?.(); // stop routing frames from an engine we are about to dispose (Task 8a)
    try {
      await record.session.dispose();
    } finally {
      // thread/closed reaches BOTH this thread's subscribers and every server-scoped watcher (Task 5),
      // deduped by Peer identity — fanout.ts owns that rule now that M2b's thread/rewound needs it too.
      broadcastToSubscribersAndWatchers(record.subscribers, this.watchers(), "thread/closed", { threadId: record.id });
      this.decisions.delete(record.id);
      this.registry.delete(record.id);
    }
  }

  /** Process shutdown (the `ccx serve` SIGINT path): settle every parked decision and dispose every live
   *  thread. Without it, closing the listener leaves each SDK session — and its `claude` child process —
   *  running, which also keeps the event loop alive so the first Ctrl-C may not exit at all. One thread's
   *  failing dispose must not abandon the rest, so each is guarded.
   *
   *  LATCHED FIRST, snapshot second: the listener is still accepting frames while this awaits a slow
   *  dispose(), so an admission (thread/start, thread/resume) landing inside that window used to create a
   *  thread that was never in the snapshot and therefore outlived the shutdown — a leaked SDK session and
   *  its `claude` child. `shuttingDown` makes the snapshot un-staleable. The refusal is SHUTTING_DOWN
   *  (-33007), not INVALID_REQUEST and not OVERLOADED: nothing about the request is malformed, and
   *  OVERLOADED (-32001) is reserved for backpressure — there is no backpressure source in M2, so it stays
   *  N/A-deferred (spec Wave 0).
   *
   *  THROUGH each record's chain (gap 7), not a direct closeRecord: a thread/close already queued for this
   *  record must run first, and closeRecord's registry-delete makes this pass's own close a no-op once it
   *  does — ordered, never concurrent (a direct call raced the queued close and drove dispose() twice). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(this.registry.list().map((r) => {
      // The same latch+flush pair thread/close raises, per record, BEFORE anything is awaited (M2b Wave 4):
      // the server-wide `shuttingDown` flag above refuses new THREADS, but a turn/start on a thread that
      // already exists is not an admission, and its queue would otherwise be drained by a settle landing
      // during a slow dispose. Every queued turn is answered `cancelled` while its record is still in the
      // registry — after closeRecord deletes it, broadcast() no-ops and the client would never hear.
      r.closing = true;
      flushQueue(this, r);
      r.chain = r.chain.then(async () => { if (this.registry.get(r.id)) await this.closeRecord(r); });
      return r.chain.catch(() => {});
    }));
  }

  /** Mints this thread's decision broker. `unattended` is captured at thread/start time (spec: the
   *  brief's `unattended` field is set once per thread, not renegotiated per-request). Deliberately
   *  does NOT register into `this.decisions` — the session factory the caller feeds this broker into
   *  can still throw synchronously on an invalid config, and a registered-but-never-returned threadId
   *  would orphan forever (nothing can ever reach it to close it). Callers register after the factory
   *  succeeds. */
  private makeDecisions(threadId: string, unattended: "park" | "deny"): ThreadDecisions {
    return new ThreadDecisions(
      (ev) => this.broadcastDecision(threadId, ev),
      () => unattended,
      () => this.hasWatchers(threadId),
    );
  }

  /** Task 9: a watcher is a real subscriber of THIS thread — not just any initialized connection on the
   *  server (the interim Task 7 shim). */
  private hasWatchers(threadId: string): boolean {
    return (this.registry.get(threadId)?.subscribers.size ?? 0) > 0;
  }

  /** The one small broadcast helper (spec) every thread-scoped notification goes through — decisions
   *  (Task 7) and turns/items (Task 8) alike. Task 9: fan-out is `record.subscribers` only, not every
   *  initialized connection on the server. */
  broadcast(threadId: string, method: string, params: Record<string, unknown>): void {
    const record = this.registry.get(threadId);
    if (!record) return;
    // Guarded per subscriber, exactly as session.ts's onFrame loop is: one sink's failure is not another's.
    // Unguarded, a single throwing sink aborted the fan-out to every remaining subscriber — and inside
    // turnStart the throw escapes the chain callback's try (which wraps only submit), rejecting
    // record.chain and wedging the thread the same way C1 did. Not reachable through the `ws` sink today;
    // the stdio/UDS transports the spec names would inherit it (M2).
    for (const peer of record.subscribers) { try { peer.notify(method, params); } catch { /* one subscriber's failure is not another's */ } }
  }

  /** Connections that opted into thread-existence fan-out via initialize{watchThreads:true} — orthogonal
   *  to any thread's `record.subscribers` (fanout.ts's header comment). */
  watchers(): ConnCtx[] {
    return [...this.conns.values()].filter((c) => c.watchThreads);
  }

  /** Server-scoped notification fan-out (Task 5): thread/started, and future server-wide events. Goes
   *  through Peer.notify like every other emit path, so optOutNotificationMethods still applies. */
  broadcastServer(method: string, params: Record<string, unknown>): void {
    broadcastToWatchers(this.conns.values(), method, params);
  }

  /** A per-peer meta-notification (spec Wave 0) — e.g. "your request was silently adjusted". Exactly one
   *  peer, never fanned out. */
  warn(peer: Peer, code: string, message: string): void {
    peer.notify("warning", { code, message });
  }

  /** The parked decisions for one thread — subscribe.ts's replay step (spec §5) reads this to hand a
   *  newly-attached client every decision still awaiting an answer. */
  pendingDecisions(threadId: string): PendingDecision[] {
    return this.decisions.get(threadId)?.pending() ?? [];
  }

  private broadcastDecision(threadId: string, ev: DecisionEvent): void {
    // spec §6's payload is {threadId, turnId, decision} — without turnId a UI cannot attach a park to a
    // turn row. Legitimately absent when nothing is in flight (JSON.stringify drops the undefined key).
    // `decision` is projected to the wire shape (toolUseId) — see broker.ts's toWireDecision.
    if (ev.type === "requested") this.broadcast(threadId, "decision/requested", { threadId, turnId: activeTurnId(this.registry.get(threadId)), decision: toWireDecision(ev.entry) });
    else this.broadcast(threadId, "decision/resolved", { threadId, toolUseId: ev.toolUseID, by: ev.by, answer: ev.outcome });
    // `status.waitingOn` is part of the ONE status shape (registry.ts) and turns.ts already re-broadcasts
    // it at every turn edge — but a park/answer moves it too, and without this a client that renders
    // status (rather than tracking decision events itself) shows "active" through a park and stays stale
    // until the turn ends. Computed AFTER the event has been applied, so `pendingDecisions` is current.
    const record = this.registry.get(threadId);
    if (!record) return;
    this.broadcast(threadId, "thread/status/changed", { threadId, status: threadStatus(record, this.pendingDecisions(threadId).length > 0) });
  }

  connect(sink: PeerSink): { peer: Peer; feed(chunk: string): void; close(): void } {
    const connId = ++this.connSeq;
    const optOut = new Set<string>();
    const peer = new Peer(sink, { optOut }); // same Set instance handleInitialize fills in place — Peer is
    // built before initialize arrives, so the option must be mutable-in-place, not re-passed later.
    const ctx: ConnCtx = { peer, initialized: false, authed: false, connId, watchThreads: false, optOut };
    this.conns.set(connId, ctx);
    const feed = (chunk: string) => peer.feed(chunk, (frame) => this.onFrame(ctx, frame));
    // A closing connection must not leave a dead Peer in any thread's subscriber set (spec: a browser
    // tab closing sweeps every record, not just whichever thread it last touched).
    const close = () => { this.conns.delete(connId); for (const record of this.registry.list()) record.subscribers.delete(peer); sink.end(); };
    return { peer, feed, close };
  }

  private onFrame(ctx: ConnCtx, frame: unknown): void {
    if (frame && typeof frame === "object" && (frame as Record<string, unknown>).__parseError) {
      ctx.peer.replyError(null as unknown as RequestId, ERR.PARSE, "Parse error");
      return;
    }
    const c = classify(frame);
    if (c.kind === "invalid") { ctx.peer.replyError(null as unknown as RequestId, ERR.INVALID_REQUEST, "Invalid request"); return; }
    if (c.kind === "response") return;      // no server->client requests in M1; a client response is unexpected — ignore, never reply-loop
    if (c.kind === "notification") return;  // no notification handlers land in M1; ignore silently (no id to reply to anyway)
    void this.dispatch(ctx, c.id, c.method, c.params ?? {});
  }

  private handleInitialize(ctx: ConnCtx, id: RequestId, params: Record<string, unknown>): void {
    if (ctx.initialized) { ctx.peer.replyError(id, ERR.INVALID_REQUEST, "Already initialized"); return; }
    const parsed = initializeParams.safeParse(params);
    if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    if (this.authRequired) {
      // `!this.token` first: an empty configured token can never be a valid credential, so it rejects every
      // client rather than matching a bare "Bearer " (C2 — auth on with no secret must fail closed).
      if (!this.token || parsed.data.authorization !== "Bearer " + this.token) { ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Invalid token"); return; }
      ctx.authed = true;
    }
    ctx.initialized = true;
    ctx.clientName = parsed.data.clientInfo.name;
    ctx.watchThreads = parsed.data.watchThreads ?? false;
    for (const m of parsed.data.optOutNotificationMethods ?? []) ctx.optOut.add(m);
    ctx.peer.reply(id, { userAgent: USER_AGENT, version: pkgVersion, platformOs: process.platform });
    ctx.peer.notify("initialized", {}); // spec §7: identical to Codex — reply first, notification second, no fields specified
  }

  private async dispatch(ctx: ConnCtx, id: RequestId, method: string, params: Record<string, unknown>): Promise<void> {
    if (method === "initialize") { this.handleInitialize(ctx, id, params); return; }
    if (!ctx.initialized) {
      if (this.authRequired) ctx.peer.replyError(id, ERR.UNAUTHENTICATED, "Not authenticated");
      else ctx.peer.replyError(id, ERR.INVALID_REQUEST, "Not initialized");
      return;
    }
    // OWN-property only: a plain-object lookup answers `toString`/`constructor`/`valueOf` with an INHERITED
    // Object.prototype function, which dispatch then awaits as if it were a handler — so those method names
    // returned no response at all instead of METHOD_NOT_FOUND, hanging the caller.
    const handler = Object.prototype.hasOwnProperty.call(this.handlers, method) ? this.handlers[method] : undefined;
    if (!handler) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, `Unknown method: ${method}`); return; }
    const goneBefore = this.engineGoneCode(params);
    if (goneBefore !== undefined && !ENGINE_GONE_EXEMPT.has(method)) {
      ctx.peer.replyError(id, goneBefore, "Engine is gone (session ended)"); return;
    }
    // The origin gate (M3 §1c, registry.ts). HERE — before handler entry — is the whole point: the
    // handlers themselves map an absent optional EngineSession member to -32601, and for a fleet thread a
    // missing HOST OP must never read as a missing engine capability. Running the gate at the dispatch
    // seam is also what keeps that ordering true for every future handler without each one re-stating it.
    //
    // AFTER the -33005 gate above, deliberately: a dead engine is a fact about this thread RIGHT NOW and
    // outranks a structural refusal (spec §1f — once a fleet socket dies, "subsequent methods answer
    // -33005", and recovery is thread/close + a fresh thread/attach). Where a method is BOTH gated and
    // engine-gone-exempt this order is what makes it answer correctly rather than accidentally:
    // `thread/reopen` (Task 14) is exempt precisely so a dead thread can reach it, and a fleet thread must
    // then hear -33006 — the host owns its own engine lifecycle — which is exactly what running the gate
    // after an exemption produces.
    const gated = this.recordFor(params);
    const refusal = gated ? originRefusal(gated, method) : null;
    if (refusal) { ctx.peer.replyError(id, refusal.code, refusal.message, refusal.data); return; }
    try {
      await handler(this, ctx, id, params);
    } catch (e) {
      // one guard for every current and future handler — a thrown/rejecting handler must still reply,
      // never leave the caller hanging or surface as an unhandled rejection (dispatch is fired `void`)
      const gone = this.engineGoneCode(params);
      if (gone !== undefined) ctx.peer.replyError(id, gone, "Engine is gone (session ended)");
      else ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
    }
  }

  /** The thread a request names, when it names one — the ONE reading of `params.threadId` at dispatch
   *  level, shared by the -33005 gate and M3's origin gate so the two can never disagree about which
   *  record they are judging. */
  private recordFor(params: Record<string, unknown>): ThreadRecord | undefined {
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    return threadId ? this.registry.get(threadId) : undefined;
  }

  /** -33005 mapping (spec Wave 0): a dead read-loop is real on inProcess threads (probe 38). Checked
   *  via isEnded() ONLY — the lib's errors are untyped strings and message-matching misses half the
   *  class ("not running" vs "disposed"). `threadId` comes from the request params when present. */
  private engineGoneCode(params: Record<string, unknown>): number | undefined {
    return this.recordFor(params)?.session.isEnded?.() ? ERR.ENGINE_GONE : undefined;
  }
}

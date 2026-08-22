// appserver/server.ts — AppServer dispatcher (spec §3.9): connection gating (initialize), a flat
// method table, per-thread serialization via record.chain, and thread lifecycle (start/resume/
// list/close). Turn/decision/subscribe/read land in Tasks 7-9 on top of this spine.
import { createRequire } from "node:module";
import { Peer, type PeerSink } from "./peer.js";
import { classify, ERR, type RequestId } from "./rpc.js";
import { Registry, activeTurnId, emptyFlagPerms, originRefusal, seedSettings, threadCwd, threadStatus, type ThreadRecord, type EngineSession } from "./registry.js";
import { listRoster, TERMINAL, type RosterRow } from "../fleet/roster.js";
import { isPidLive } from "../fleet/liveness.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import { ThreadDecisions, toWireDecision, type DecisionEvent } from "./broker.js";
import { elicitationContentSatisfies, makeOnElicitation } from "./elicitation.js";
import type { DecisionOutcome, PermissionBroker } from "../permissions/types.js";
import type { ElicitationRequest, OnElicitation } from "@anthropic-ai/claude-agent-sdk";
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
import { rewindAnchors, rewindDryRun, threadRewind, threadReopen } from "./rewind.js";
import { mcpStatusList, mcpReconnect, mcpToggle, mcpSet, mcpPermissionModeOverrideSet } from "./mcp.js";
import { taskList, taskStop, turnBackground } from "./tasks.js";
import { settingsRead, directoryList, directoryAdd, directoryRemove, permissionRuleAdd, permissionRuleRemove, outputStyleSet, effortSet, threadClear } from "./settingsOps.js";
import { pluginReload, skillReload } from "./reloads.js";
import { fleetDecisionRespond, fleetList, fleetStop, threadAttach, type StopPoll } from "./fleet.js";
import { fsRead, fsSearch, shellCommand } from "./workspace.js";
import { reviewStart } from "./review.js";
import { configRead, configValueWrite, configBatchWrite } from "./configDomain.js";
import { threadSearch, threadSearchOccurrences } from "./search.js";
import { storeRefusal, threadArchive, threadUnarchive } from "./archiveDomain.js";
import { listArchived, removeArchiveMarker } from "./archive.js";
import { initializeParams, threadIdParams } from "./schema/core.js";
import { threadStopParams } from "./schema/fleet.js";
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
  // `cwd` (M5 fix wave G / P2-2#1) is the SDK's project SCOPE, not a filter: `src/sessions`' wrapper maps
  // it to the reader's `dir`, and a search that scoped its listing to one project while looking that
  // project's transcripts up in the process-default one was answering about two stores in one reply.
  getSessionMessages?: (sessionId: string, opts?: { limit?: number; offset?: number; cwd?: string }) => Promise<unknown[]>;
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
  // M3 Task 9: `thread/stop`'s roster-terminal poll (fleet.ts's STOP_POLL is the default). CONFIG rather
  // than a function, unlike every other slot here, because what a caller ever wants to change is the
  // wall-clock wait, not the algorithm — a suite that had to serve the production cap honestly would spend
  // five real seconds proving one timeout, and faking the clock instead would fake the very thing the poll
  // is measuring (a host taking its own time to exit).
  stopPoll?: StopPoll;
  // M3 Task 13: `thread/shellCommand`'s OUTER deadline in ms (workspace.ts's SHELL_DEADLINE_MS is the
  // default), the bound on the REQUEST rather than on the child. Injectable for stopPoll's reason above and
  // one of its own: the production value must sit ABOVE the seam's inner 30 s SIGTERM attempt, so a suite
  // that served it honestly would spend 40 real seconds proving one branch.
  shellDeadlineMs?: number;
  // M5: the config-files domain + archive markers. `configHome` is the base of the user layer
  // (`<configHome>/.claude/settings.json`), defaulted to os.homedir() at each call site so tests point
  // the whole domain at a temp dir; `managedSettingsPath` overrides the platform managed file (null =
  // no managed layer, the win32 default); `ccxDir` is the server-state dir the archive markers live
  // under, defaulting to `fleetRoot()` (src/fleet/paths.ts) so a `CCX_FLEET_ROOT` override moves them
  // with the rest of the fleet state; `getSessionInfo` backs the D-M5-20 existence checks.
  configHome?: string;
  managedSettingsPath?: string | null;
  ccxDir?: string;
  getSessionInfo?: (id: string) => Promise<unknown | undefined>;
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
 *  `cwd` is ORIGIN-BRANCHED (M3 §1b) and comes from `threadCwd` (registry.ts) rather than from a branch
 *  written out here, because `thread/shellCommand` runs its command through the SAME function: what this
 *  view reports and where that command lands are one answer by construction, not two that happen to agree.
 *  `fs/search` roots itself on this value too, a client passing it back as a search root.
 *  `short`/`name` are the roster's own handles and
 *  exist for fleet threads only; the keys are OMITTED (not undefined) on inProcess rows, which keeps this
 *  view's key set identical to sessionLib.ts's store-only projection for every row that predates M3.
 *  `reviewOf` (M4 §review) is omitted the same way, and rides HERE rather than on `review/findings`: what a
 *  thread is a review OF is a property of the thread, so one appearance on the row every client already
 *  reads — `thread/started`, `thread/list` — is what lets a client identify a review thread at all,
 *  including one another client raised. On the notification instead it would repeat a constant on every
 *  message and still leave a thread list unable to tell the two kinds apart. */
export function threadView(srv: AppServer, r: ThreadRecord): Record<string, unknown> {
  const waitingOn = srv.pendingDecisions(r.id).length > 0;
  return {
    id: r.id,
    sessionId: r.sessionId,
    title: r.title,
    tags: r.tags,
    cwd: threadCwd(r),
    ...(r.origin === "fleet" ? { short: r.short, name: r.name } : {}),
    model: r.settings.model,
    permissionMode: r.settings.permissionMode,
    thinking: { maxTokens: r.settings.thinkingTokens },
    status: threadStatus(r, waitingOn),
    queueDepth: r.queue.length,
    origin: r.origin,
    ...(r.reviewOf ? { reviewOf: r.reviewOf } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    preview: undefined,
  };
}

/** The one seam thread/start and thread/resume both build their engine config through — extended in
 *  Task 7 to inject the thread's decision broker as the SDK's canUseTool seam, and in M4 Task 8 to inject
 *  the elicitation bridge as the SDK's `onElicitation` seam. The two are siblings: both turn a question the
 *  engine would otherwise have to ask a connected client into a parked decision any client can answer. */
function buildConfig(parsed: { config?: Record<string, unknown>; unattended: "park" | "deny" }, broker: PermissionBroker, onElicitation: OnElicitation): OpenSessionConfig {
  return { ...(parsed.config as OpenSessionConfig | undefined), permissionBroker: broker, onElicitation };
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Does this engine config RESUME a session, or merely READ its transcript into a new one? (D-M5-21b.)
 *  `forkSession: true` beside `resume` is the SDK's own "fork to a new session ID rather than continuing
 *  the previous session" (sdk.d.ts), and `src/session/index.ts`'s `rewindSession` uses exactly that pair
 *  for a non-destructive branch. Measured against a real engine rather than read off the type: a live
 *  probe (parent `d78907bb…`) resumed with the flag reported a DIFFERENT id at init (`9dd9e17c…`), left
 *  the parent's transcript at the message count it had before, and carried that history into the fork's
 *  own file; the same resume WITHOUT the flag reported the parent's id back.
 *
 *  So the parent is not admitted by such a request, and the two things admission does to an id are both
 *  wrong for it: stamping `record.sessionId` names a session this thread does not hold — permanently,
 *  since `routeInit`'s latch early-returns on a stamped record, so the id the engine actually opened is
 *  never learned and every id-keyed method answers about the parent — and `autoUnarchive` would take a
 *  conversation off the shelf that never went live. The fork's OWN id needs neither: nothing here can know
 *  it before the engine's first init frame (the latch is exactly the mechanism for that), and a freshly
 *  minted id has no marker to clear.
 *
 *  TRUTHY rather than `=== true`: `config` is a client passthrough, this predicate only ever REMOVES an
 *  eager guess, and the CLI reads the flag the same way. Being wrong in this direction costs the stamp's
 *  head start; being wrong in the other costs a permanently mis-identified thread. */
const forksSession = (config: Record<string, unknown> | undefined): boolean => Boolean(config?.forkSession);

const RESUME_LIVE_FLEET = "sessionId belongs to a running fleet session; use thread/attach";

/** The same refusal for a holder in THIS process, and it names a different remedy because "use
 *  thread/attach" is unfollowable here — the client is already connected to the server that holds it.
 *  Both remedies are spelled because the two ways a local record can hold an id want different ones: a
 *  working thread is closed, and one whose engine died is `thread/reopen`'d (the method that exists for
 *  exactly that state), never resumed into a SECOND record naming the same session. */
const RESUME_LIVE_LOCAL = "This server already holds a thread for that session; close it first, or thread/reopen it if its engine died";

/** The refusal for a session held by a live ccx process ELSEWHERE on this machine — shared by
 *  `thread/archive` (archiveDomain.ts) and `thread/delete` (sessionLib.ts), the two methods that refuse
 *  rather than redirect. It lives HERE, beside `liveInFleet`, because the sentence and the probe are one
 *  fact: "in this server — close it first" is false about a holder in another process and its advice is
 *  unfollowable, so any guard that gains the roster arm needs this sentence with it. `thread/resume`
 *  keeps its own (`RESUME_LIVE_FLEET`) because it has a remedy to name — attach instead. */
export const LIVE_REFUSAL_FLEET = "Thread is live in another ccx process; close it there first";

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

/** The ASYNC half of the guard above — the pid probes the candidate rows still need. Split out so
 *  `thread/resume` can take its reservation in the gap between the two halves (see `resumingSessions`)
 *  while a caller with no such gap composes both through `liveInFleet` below. */
async function anyRosterPidLive(rows: RosterRow[]): Promise<boolean> {
  for (const row of rows) if (await isPidLive(row.pid, row.procStart)) return true;
  return false;
}

/** ADMISSION, for every request that names an existing session — `thread/resume` and the resume-carrying
 *  `thread/start`, which spec D-M5-21 already calls two of the three admission surfaces but which had
 *  drifted into two different answers. `thread/start` ran none of this: two starts naming one session each
 *  registered a record stamped with it, leaving `findLiveBySessionId` to pick one arbitrarily and the other
 *  thread's history to be archived or deleted out from under a live engine; and no fence stopped a start
 *  landing in the middle of a `thread/delete`. Both surfaces now run this, so a rule added here reaches
 *  them together instead of being remembered twice.
 *
 *  THREE SCOPES, NOT TWO, which is why `admits` gates one of them and not the others:
 *   - The DELETE FENCE applies to every shape, fork included. A fork does not admit the id, but it READS
 *     that transcript to replay it, so erasing it mid-admission breaks the session being opened —
 *     `startThread` already reasoned this way for its own copy of the check.
 *   - The LOCAL live-holder refusal applies only when the request ADMITS the id (`forkSession` beside
 *     `resume` opens a NEW session id — D-M5-21b): a fork takes no identity from the holder, and two forks
 *     off one parent are legitimate. Two threads of THIS server stamped with one session id are not — that
 *     is the state the refusal exists to prevent.
 *   - The FLEET refusals are UNCONDITIONAL — a fork of a live fleet session is refused too, and that is
 *     deliberate rather than an oversight of the carve-out above. What a fork reads is the parent's
 *     transcript, and a live fleet holder is still APPENDING to that file, so the copy the fork replays is
 *     torn: the same reasoning `thread/delete`'s own fleet arm gives (sessionLib.ts). Loosening it is a
 *     product decision about a hazard nothing here can bound, not a repair.
 *
 *  Local before fleet, and each with its own sentence: a refusal whose remedy is unfollowable is worse than
 *  a generic one. The local test excludes fleet-origin records so the fleet arm below keeps its own.
 *
 *  `register` runs INSIDE the roster reservation and is not awaited until after the release, which is
 *  `thread/resume`'s established shape: the reservation fences the window before REGISTRATION — after it,
 *  `findLiveBySessionId` sees the thread and `thread/delete`'s live-guard covers the rest — and holding it
 *  across the shelf read would be incidental rather than principled. Returns whether the caller was
 *  admitted, so a refused request runs none of its own follow-on work (the eager unarchive). */
async function admitResume(
  srv: AppServer, ctx: ConnCtx, id: RequestId,
  target: { sessionId: string; admits: boolean },
  register: () => void | Promise<void>,
): Promise<boolean> {
  const { sessionId, admits } = target;
  // A closure, not a value, because it is asked TWICE — at arrival and again after the probe below — and
  // the whole point of the second ask is that the answer can have changed in between.
  const localHolder = (): boolean => admits && srv.registry.list().some((r) => r.origin !== "fleet" && r.sessionId === sessionId);
  // BUSY, not a new code: "you may not resume this right now" is what the busy family means on the wire.
  if (srv.deletingSessions.has(sessionId)) { ctx.peer.replyError(id, ERR.BUSY, "Session is being deleted"); return false; }
  if (localHolder()) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_LOCAL); return false; }
  // Before anything is spawned: a live fleet session is the one sessionId this must not fork. -32602 rather
  // than a new code — the request is well-formed but its target is something resume cannot legally act on.
  const candidates = fleetResumeCandidates(srv, sessionId);
  if (candidates === "live") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_FLEET); return false; }
  // No roster candidate to probe (the overwhelmingly common case): register in this same dispatch tick, so
  // there is no yield for a delete to race into (see fleetResumeCandidates).
  if (candidates.length === 0) { await register(); return true; }
  // The probe below AWAITS. Reserve synchronously HERE, before that yield — with the arrival check above,
  // these are what make admission and deletion mutually exclusive even when a delete completes inside the
  // probe (see resumingSessions and sessionLib.ts's delete). Released in a `finally`: a refused probe must
  // not reserve forever.
  srv.resumingSessions.set(sessionId, (srv.resumingSessions.get(sessionId) ?? 0) + 1);
  let admitted: void | Promise<void>;
  try {
    if (await anyRosterPidLive(candidates)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_FLEET); return false; }
    // RE-ASKED AFTER THE PROBE, and HERE rather than in either caller, because the callers cannot see this
    // window: every one of their own checks ran in the dispatch tick, and a `ps` subprocess is milliseconds
    // wide. Two arrival answers do not survive it.
    //  - `shuttingDown`: shutdown() latches and THEN snapshots `registry.list()`, so a thread registered
    //    after that snapshot is disposed by nobody and leaks its `claude` child — the exact leak the latch
    //    exists to close. `startThread` re-checks it at its own top for this reason, which is why the
    //    `thread/resume` caller was never exposed; `createThread` (the other caller's `register`) has no
    //    check of its own. `review/start` states the same rule for its own git yield.
    //  - the LOCAL HOLDER: the arrival check fences an admission that arrives after a registration, not two
    //    that arrive before either. `resumingSessions` refcounts DELETION and deliberately does not
    //    serialize siblings (a second resume of one session is legal), so without this both pass arrival,
    //    both probe and both register — two records stamped with one session id, which is precisely the
    //    state that refusal exists to prevent. Same code and same sentence as the arrival check: the
    //    loser's remedy does not depend on which side of the probe it lost on.
    if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return false; }
    if (localHolder()) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, RESUME_LIVE_LOCAL); return false; }
    admitted = register();
  } finally {
    // MY hold, not the reservation (PF2): a sibling may still be inside its own probe, and the entry is
    // gone only when the last of us leaves.
    const held = (srv.resumingSessions.get(sessionId) ?? 1) - 1;
    if (held > 0) srv.resumingSessions.set(sessionId, held); else srv.resumingSessions.delete(sessionId);
  }
  await admitted;
  return true;
}

/** "Does a FLEET ROSTER ROW or this server's own registry say someone holds this session?" — both halves
 *  of `thread/resume`'s roster guard, for callers that have nothing to do between them.
 *
 *  THE QUESTION IS NARROWER THAN "is it live on this machine", and the difference is stated here rather
 *  than left to be discovered (fix wave I / scalpel-3#1, declined as unfixable at this altitude). Two
 *  holders are invisible to it, both by construction. A ccx HOST admitted after `listRoster()` took its
 *  snapshot is not in that snapshot — a listing is a listing, and no arrangement of one is atomic with
 *  another process's admission. And an IN-PROCESS thread of a SECOND app-server process is in no roster at
 *  all: roster rows are written by `SessionHost`, and an app server's own `thread/start` mints no host. So
 *  a `false` here means "nothing this process can see holds it", never "nobody does" — which is the same
 *  scope the spec's criterion 7 states for the shelf ("no transition THIS SERVER mediates"), and it is why
 *  markers are re-read per request rather than cached. Making it true across processes would mean every
 *  app server publishing its in-process threads into shared state, which is an architecture with an owner
 *  and not a corrective repair.
 *
 *  EXPORTED for `thread/archive` (archiveDomain.ts), which is the reason it exists at all: this server was
 *  answering two different questions about one session, refusing to RESUME an id a running fleet session
 *  still holds while cheerfully SHELVING that same id two lines away. D-M5-21's invariant is that a live
 *  thread is never hidden from the default list across servers, not merely within one, and the archiving
 *  server already has the roster data it needs to honour that. Sharing the probe rather than re-deriving
 *  it is what keeps the two answers from drifting apart again. */
export async function liveInFleet(srv: AppServer, sessionId: string): Promise<boolean> {
  const candidates = fleetResumeCandidates(srv, sessionId);
  return candidates === "live" || anyRosterPidLive(candidates);
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
  // M3 §4's `thread/reopen` is the one member that is exempt for the OPPOSITE reason to the rest: not
  // "this answers without transport" but "a dead engine is its entire subject". The gate would otherwise
  // refuse the recovery in exactly the state it exists for, and the alive-engine refusal it owes (-32602)
  // is the handler's, after the exemption (rewind.ts).
  "thread/reopen",
  // M5 (§search) Task 8: `thread/searchOccurrences` is exempt for the ORIGINAL reason — it answers off disk,
  // like `thread/read` two lines above, reading the persisted transcript and never the transport. Without the
  // exemption the same session would be searchable by its bare store id (no record, no gate) and refused by
  // its own registry id, which is a difference in the answer produced by how the client spelled the thread.
  "thread/searchOccurrences",
  // M5: disk/sidecar reads that must answer for a thread whose engine died (spec rev 3). The archive pair
  // joins `thread/searchOccurrences` above for the same reason it is there — the subject is a file on
  // disk, never the transport — and with one of its own: shelving a conversation is precisely the cleanup
  // a client reaches for once a thread has died, which is `thread/delete`'s argument two lines up.
  "thread/archive", "thread/unarchive",
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
  /** The mirror of `deletingSessions` for the OTHER direction of the same race (final review R13). A
   *  `thread/resume` whose roster candidates need a PID liveness probe AWAITS that probe before it reaches
   *  `startThread` — and a concurrent `thread/delete` for the same session could reserve, delete and RELEASE
   *  its own reservation entirely inside that yield, leaving `startThread`'s `deletingSessions` check clear
   *  and resuming over just-erased history. The resume reserves the sessionId here SYNCHRONOUSLY, before the
   *  probe, and `thread/delete` refuses against it — so admission and deletion still cannot both win: either
   *  the resume reserved first (the delete is refused here) or the delete reserved `deletingSessions` first
   *  (the resume is refused at arrival / in `startThread`). The resume handler owns the add/remove and
   *  removes in a `finally`. Empty in the common no-roster-candidate case — that path never probes, so it
   *  reaches `startThread` in its own dispatch tick with no window to reserve against.
   *
   *  A REFCOUNT, not a set of ids (peer review PF2): two resumes for ONE sessionId can be inside their
   *  probes at the same time, and a shared entry deleted by whichever settles first reopens this very
   *  window for the other — a delete then sees no reservation and no live record (the second resume has
   *  not reached `startThread` yet) and erases the history it is about to admit onto. Held while ANY
   *  holder is in flight, dropped at zero. Refusing the duplicate resume instead would also close it, but
   *  a second resume of one session is legal and its refusal would be user-visible; the count is not. */
  readonly resumingSessions = new Map<string, number>();
  /** M3 §1e: the attaches in flight, keyed by roster `short` — the reservation that makes two simultaneous
   *  `thread/attach` calls for one target collapse onto ONE admission (the second awaits the first's
   *  promise) instead of dialling the host twice and registering two threads for one session. Taken and
   *  consulted SYNCHRONOUSLY in the dispatch tick, before the dial's first await, for the same reason
   *  `deletingSessions` is: a reservation taken after an await is a reservation both callers miss.
   *  fleet.ts owns the add/remove, and removes in a `finally` — a failed attach must leave its target
   *  attachable rather than poisoned. */
  readonly attachingShorts = new Map<string, Promise<ThreadRecord>>();
  private handlers: Record<string, Handler> = {
    "server/status": (srv, ctx, id) => {
      ctx.peer.reply(id, { uptimeMs: Date.now() - srv.startedAt, threads: srv.registry.list().length, listeners: srv.conns.size });
    },
    "thread/start": async (srv, ctx, id, params) => {
      if (srv.shuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; } // see shutdown()
      const parsed = threadStartParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      // The THIRD admission surface (spec D-M5-21 names all three: thread/resume, resume-carrying
      // thread/start, thread/attach). `config` is a parsed record, not an opaque blob — the server
      // spreads it into the engine config — so the resume target is readable here, and it is the same
      // value `startThread` uses for its own eager stamp.
      // …EXCEPT when `forkSession` rides beside it (D-M5-21b): that pair READS the named transcript into a
      // NEW session id rather than admitting it, so this request admits no existing id at all and neither
      // the stamp nor the shelf read below has a subject. ONE predicate decides both, because the two must
      // agree — a stamp without its unarchive, or the reverse, is the half-shipped shape this milestone
      // keeps paying for.
      const cfg = parsed.data.config;
      // `resumeTarget` is "this request names an existing transcript" (fork or not — the delete fence cares
      // about both); `resuming` is the narrower "it ADMITS that id", which is what the stamp, the shelf
      // read and the live-holder refusals all key on.
      const resumeTarget = typeof cfg?.resume === "string" ? cfg.resume : undefined;
      const resuming = resumeTarget !== undefined && !forksSession(cfg) ? resumeTarget : undefined;
      const register = (): void => {
        const record = srv.createThread({ config: parsed.data.config, unattended: parsed.data.unattended });
        // Stamped EAGERLY, before the reply and before any await, for the reason startThread's own stamp is:
        // a real engine's `sessionId` getter stays undefined until the first turn's init frame (router.ts's
        // routeInit), so without this the record is invisible to `findLiveBySessionId` from here until the
        // client's first turn — a window, lasting whole requests rather than a tick, in which thread/archive
        // and thread/delete both judge a live conversation to be cold.
        if (resuming && !record.sessionId) record.sessionId = resuming;
        ctx.peer.reply(id, { thread: threadView(srv, record) });
        srv.broadcastServer("thread/started", { thread: threadView(srv, record) });
      };
      // A start that names NO session is not an admission at all: nothing to fence, nobody to conflict
      // with, and it must not pay for a roster read to learn that.
      if (resumeTarget === undefined) { register(); return; }
      if (!await admitResume(srv, ctx, id, { sessionId: resumeTarget, admits: resuming !== undefined }, register)) return;
      // LAST, once admission has fully succeeded — same placement and same guarded helper as the other
      // two admission surfaces, so this one cannot drift from them (D-M5-21).
      if (resuming) await srv.autoUnarchive(ctx, resuming);
    },
    "thread/resume": async (srv, ctx, id, params) => {
      const parsed = threadResumeParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      // The whole guard — fences, live-holder refusals, roster probe and reservation — is `admitResume`,
      // shared with the resume-carrying `thread/start` so the two admission surfaces cannot answer
      // differently again. `startThread` registers the record synchronously and only then awaits (its
      // D-M5-21 shelf read), which is the property the reservation's placement depends on.
      const sessionId = parsed.data.sessionId;
      await admitResume(srv, ctx, id, { sessionId, admits: !forksSession(parsed.data.config) },
        () => srv.startThread(ctx, id, { resume: sessionId, config: parsed.data.config, unattended: parsed.data.unattended }));
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
      const outcome = parsed.data.answer as DecisionOutcome;
      // M3 §1b: a fleet thread's park lives on the HOST — forward the answer, map the receipt, and leave
      // the view standing. It is the host's own `decision_settled` that removes it and names who won, so
      // there is no local `by` to stamp on this path at all.
      if (record.origin === "fleet") { await fleetDecisionRespond(ctx, id, record, { toolUseId: parsed.data.toolUseId, answer: outcome, abortTurn: parsed.data.abortTurn }); return; }
      // M4 (final review): an `elicitation_accept` whose content satisfies the generic wire type but violates
      // THIS request's `requestedSchema` is refused BEFORE anything settles. `elicitation.ts` used to catch it
      // afterwards and answer the MCP server `decline` — by which point this handler had replied {ok:true} and
      // broadcast `decision/resolved {elicitation_accept}`, so clients and audit logs recorded an acceptance
      // that never happened. Refusing here keeps one story on the wire and costs nothing: the park stays
      // listed and answerable, and the MCP server goes on waiting exactly as it already was, so a client can
      // simply correct its answer. The predicate is elicitation.ts's own — one implementation, two call sites.
      // NOT applied on the fleet path above: the authoritative request lives on the HOST, this server holds a
      // mirrored view of it, and the host runs this same check when it settles its own park.
      const parked = dec.pending().find((e) => e.toolUseID === parsed.data.toolUseId);
      if (parked?.kind === "elicitation" && outcome.kind === "elicitation_accept"
        && !elicitationContentSatisfies(parked.input as unknown as ElicitationRequest, outcome.content)) {
        ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Answer content does not satisfy the elicitation's requestedSchema");
        return;
      }
      const by = `${ctx.clientName}#${ctx.connId}`; // server-stamped only — a client-supplied `by` is never read (spec §6)
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
    // M3 Task 7 (§1e): the adoption pair. Both are SERVER-scoped — no `threadId`, so neither passes
    // through the -33005 or origin gates below, and `thread/attach` is what CREATES the fleet records
    // those gates exist for.
    "fleet/list": fleetList,
    "thread/attach": threadAttach,
    // M3 Task 9 (§1e): ONE method, origin-appropriate meaning. On an inProcess thread this IS
    // `thread/close` — our engine, our call to end it. On a fleet thread the two diverge completely:
    // closing only detaches (the host lives on), so ending the SESSION needs its own op and its own
    // completion contract. Both answer `{ok:true}` and both announce `thread/closed {reason:"stopped"}`,
    // so a client that does not care which origin it holds writes one call and reads one notification.
    "thread/stop": async (srv, ctx, id, params) => {
      const parsed = threadStopParams.safeParse(params);
      if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
      const record = srv.registry.get(parsed.data.threadId);
      if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
      // The same synchronous latch+flush pair `thread/close` raises, for the same reasons — see there.
      record.closing = true;
      flushQueue(srv, record);
      record.chain = record.chain.then(async () => {
        // The fleet half runs FIRST and separately, because its failure mode is the opposite of a close's.
        // A close can say "the engine is gone from this server's point of view either way" and drop the
        // record on a failing dispose; a stop cannot. A host whose roster row never turns terminal may
        // still be running, and the record is the only handle a client has on it — dropping it there would
        // make the session unaddressable from here (§1e: the record is NOT closed on that path). The
        // `closing` latch above stays down on that path, deliberately: the client asked for this session
        // to end, so admitting new turns onto a host that is mid-exit is the wrong recovery. What the
        // record is still good for is `thread/close` — exempt from both gates — which is §1f's recovery
        // for a dead fleet thread and is this one's too.
        if (record.origin === "fleet") {
          // -33008, the fleet-operation-failed code (rpc.ts): the request was well-formed and the thread
          // real — the TARGET could not be brought to the state the method promises.
          try { await fleetStop(srv, record); }
          catch (e) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, e instanceof Error ? e.message : String(e)); return; }
        }
        try {
          await srv.closeRecord(record, "stopped");
          ctx.peer.reply(id, { ok: true });
        } catch (e) {
          ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
        }
      });
    },
    // M3 Task 12 (§2): the workspace pair. SERVER-scoped like `fleet/list` — no `threadId`, so no record
    // lookup, no chain and no gate; the SUBJECT is a path on this machine, not a conversation. A client
    // roots them on a thread's tree by passing `threadView.cwd` as the path or the search root.
    "fs/read": fsRead,
    "fs/search": fsSearch,
    // M3 Task 13 (§3): the display-only shell escape — the TUI's `!cmd` over the wire, run in the thread's
    // own cwd. Registered with the pair above (same module, same subject: this machine's filesystem) but
    // unlike them it NAMES A THREAD, so it does pass through both dispatch gates — and answers each the way
    // its own semantics demand: -33005 applies (a dead thread is dead for everything), while the origin gate
    // never fires because a fleet thread's cwd is as runnable as an inProcess one's. What it does NOT do is
    // take `record.chain`: the command never reaches the engine, so nothing about a turn in flight has any
    // claim on it (workspace.ts's own note).
    "thread/shellCommand": shellCommand,
    // M3 Task 14 (§4): the gap-10 recovery path — a dead-engine record gets a replacement engine in place
    // rather than staying -33005 until the client closes it. Registered last, but it lives in rewind.ts:
    // it is the fourth member of the swap family and reuses `swapEngine` verbatim. It is the ONLY entry in
    // this table that is BOTH `ENGINE_GONE_EXEMPT` and origin-gated, which is what the gate ordering above
    // was written for — the exemption lets a dead thread reach it, and the origin gate still answers
    // -33006 for a fleet one.
    "thread/reopen": threadReopen,
    // M4 (§surface): Codex's whole review REQUEST surface is one method, and so is ours. It NAMES A THREAD
    // but only to read where that thread runs — the review itself is an ordinary turn on a new thread — so
    // it passes both dispatch gates and answers each honestly: -33005 applies (a dead thread is dead for
    // everything a client can name on it, thread/shellCommand's precedent), while the origin gate never
    // fires because a fleet thread's cwd is as reviewable as an inProcess one's.
    "review/start": reviewStart,
    // M5 (§config): the settings-files domain's read half. SERVER-scoped like `fs/read` — it names no
    // thread, so neither dispatch gate can fire — and it reads the files a client is about to write
    // through, which is why the reply carries the CAS `versions` its first conditional write needs.
    "config/read": configRead,
    // ...and its write half. SERVER-scoped exactly like the read — no thread is named, so neither dispatch
    // gate can fire — and mutual exclusion is the handler's own (`withFileLock` around read→CAS→write),
    // not the dispatch table's: the contended resource is a FILE on this machine, which a second server
    // process can hold too, and no per-connection or per-thread serialization could ever see that.
    "config/value/write": configValueWrite,
    "config/batchWrite": configBatchWrite,
    // M5 (§search): the store, searched. SERVER-scoped like the config trio above — it names no thread, so
    // neither dispatch gate can fire — and it reaches sessions this server has never opened, which is the
    // point: the corpus is every transcript on this machine, not this process's registry. Mutual exclusion
    // is the handler's own (`runScanExclusive`), for the same reason the config writes' is: the contended
    // resource is this process's disk read rate, which no per-thread chain could ever see.
    "thread/search": threadSearch,
    // …and its per-thread sibling, which DOES name a thread and therefore does meet both dispatch gates. It
    // is `ENGINE_GONE_EXEMPT` above for the reason `thread/read` is: the subject is the persisted transcript
    // on disk, so a thread whose engine died must still answer — otherwise the same session is searchable by
    // its bare store id and refused by its own registry id. Mutual exclusion is again the handler's own, and
    // it is the SAME chain the store-wide search uses: one content scan at a time per server.
    "thread/searchOccurrences": threadSearchOccurrences,
    // M5 (§archive): the shelf pair (archiveDomain.ts). They NAME A THREAD — either spelling, a registry
    // id or a bare store sessionId — so both meet the dispatch gates, and both are `ENGINE_GONE_EXEMPT`
    // above: the subject is a marker file, not a live conversation. Mutual exclusion is not the dispatch
    // table's here either, and for a stronger reason than the searches': the marker store needs none. One
    // atomic create and one unlink per transition means no read-modify-write exists for two requests — or
    // two SERVER PROCESSES, which no in-process chain could ever see — to lose each other's update in.
    "thread/archive": threadArchive,
    "thread/unarchive": threadUnarchive,
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

  /** The FRESH-thread creation spine, extracted verbatim from the `thread/start` handler so M4's
   *  `review/start` (review.ts) can raise its detached review thread the same way rather than assembling
   *  its own: mint the id, mint the broker, build the config, build the engine, register the decisions and
   *  the record, install the router. Everything EXCEPT the reply and the `thread/started` announcement,
   *  which stay at the call sites because the two callers owe different ones — `thread/start` answers
   *  `{thread}`, a review answers `{turn, reviewThreadId}` — and because the reply-then-broadcast ordering
   *  `thread/start` has always had is then still visible where it happens.
   *
   *  Throws whatever the session factory throws (an invalid config); dispatch's own catch answers for it.
   *  The `resume` sibling below is a separate spine on purpose: it admits a thread onto an EXISTING store
   *  id, which brings the delete/resume reservation race with it — nothing this one can encounter. */
  createThread(opts: { config?: Record<string, unknown>; unattended: "park" | "deny" }): ThreadRecord {
    const threadId = this.registry.mint();
    const dec = this.makeDecisions(threadId, opts.unattended);
    const config = buildConfig({ config: opts.config, unattended: opts.unattended }, dec.broker(threadId), makeOnElicitation(this, threadId));
    const factory = this.deps.sessionFactory ?? ((c: Record<string, unknown>) => openSession(c as OpenSessionConfig));
    const session = factory(config as Record<string, unknown>); // throws synchronously on an invalid config — dec must NOT be registered yet (else it orphans forever, nothing can ever reach it)
    this.decisions.set(threadId, dec);
    const nowS = nowSec();
    const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: opts.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: session.sessionId, config: config as Record<string, unknown>, createdAt: nowS, updatedAt: nowS, cwd: opts.config?.cwd as string | undefined, settings: seedSettings(opts.config), flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0 };
    this.registry.add(record);
    installRouter(this, record); // the snapshot above is undefined until the first turn's init frame (router.ts's routeInit)
    return record;
  }

  /** The one thread-admission spine shared by thread/resume and Task 12's thread/fork (sessionLib.ts) —
   *  "start a new thread in this server resuming a given session id". Verbatim-extracted from the
   *  pre-Task-12 thread/resume handler body, with one change: `resume` is folded into the config object
   *  handed to the factory (`{...config, resume}`) rather than threaded via a resumeSession(id, config)
   *  closure — mirroring what the real src/session/index.ts resumeSession already does internally
   *  (`openSession({...config, resume: id})`) one level up, so a DI'd `sessionFactory` (every test in this
   *  suite overrides it) can observe `resume` on the config it receives, exactly like any other flag,
   *  instead of it being invisible to anything but the real default factory.
   *
   *  ASYNC as of M5 Task 9, and the async part is deliberately ALL of it and NONE of it: everything
   *  through registration, the reply and `thread/started` still runs in the caller's own dispatch tick
   *  (an async function body runs synchronously up to its first `await`, and the first one here is the
   *  last line), which is exactly the property the delete/resume reservation race is decided by. The
   *  returned promise is worth awaiting rather than dropping: it is what makes "this request is finished"
   *  true at the dispatch seam, and it is what keeps a failure raised after the reply — the shelf read's
   *  own disclosure path throwing, say — reportable on the wire instead of escaping as an unhandled
   *  rejection. It does NOT hold `thread/resume`'s reservation across the shelf read: that release sits in
   *  the handler's `finally`, whose body is synchronous and therefore runs BEFORE the `await` below it.
   *  That is the intended shape, and the capture-site comment in the resume handler is the argument for
   *  it — the reservation fences the window before REGISTRATION, and `findLiveBySessionId` covers the
   *  rest. */
  async startThread(ctx: ConnCtx, id: RequestId, opts: { resume: string; config?: Record<string, unknown>; unattended: "park" | "deny" }): Promise<void> {
    if (this.shuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; } // see shutdown()
    // BUSY, not a new code: "you may not resume this right now" is exactly what the busy family means on
    // the wire (same reasoning thread/delete's own live-refusal uses). See `deletingSessions`.
    if (this.deletingSessions.has(opts.resume)) { ctx.peer.replyError(id, ERR.BUSY, "Session is being deleted"); return; }
    const threadId = this.registry.mint();
    const dec = this.makeDecisions(threadId, opts.unattended);
    const config = { ...buildConfig({ config: opts.config, unattended: opts.unattended }, dec.broker(threadId), makeOnElicitation(this, threadId)), resume: opts.resume };
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
    // …unless the caller's config FORKS (`admits` — D-M5-21b, and the same carve-out `thread/start` makes
    // above): then the engine opens a different id, the registry legitimately knows nothing, and the latch
    // is the only honest source. `deletingSessions` above still fences the parent for both shapes — a fork
    // READS that transcript to replay it, so erasing it mid-admission breaks the session being opened.
    // `config` is the FULL object the factory received (broker and `resume` included) — M2b's rewind swap
    // rebuilds the replacement engine from it, so anything dropped here is silently dropped by every later
    // swap too (registry.ts's field doc).
    const admits = !forksSession(opts.config);
    const record: ThreadRecord = { id: threadId, origin: "inProcess", session, unattended: opts.unattended, busy: false, turnSeq: 0, interruptRequested: false, buffer: [], queue: [], subscribers: new Set(), chain: Promise.resolve(), sessionId: admits ? opts.resume : undefined, config: config as Record<string, unknown>, createdAt: nowS, updatedAt: nowS, cwd: opts.config?.cwd as string | undefined, settings: seedSettings(opts.config), flagPerms: emptyFlagPerms(), mcpToggles: {}, mcpOverrides: {}, epoch: 0 };
    this.registry.add(record);
    installRouter(this, record); // a no-op init route for an ordinary resume (the id is already stamped) and the ONLY id source for a fork — one rule for both entry points
    ctx.peer.reply(id, { thread: threadView(this, record) });
    this.broadcastServer("thread/started", { thread: threadView(this, record) });
    // LAST, once admission has fully succeeded and no step after it can fail: unarchiving a session whose
    // admission then threw would take a conversation off the shelf that never opened — which is also why a
    // FORK skips it (`admits`): the id it names never goes live here at all.
    //   AFTER THE REPLY, and that ordering is not free (fix wave I / scalpel-3#2, declined with its reason).
    // Between the reply and this line the thread is live AND still carries its marker, so a `thread/list`
    // dispatched in that window puts a live thread in the archived half — which criterion 7's "no transition
    // this server mediates" does not cover, and the spec now says so. It cannot be closed by moving this
    // line up: the reply and `thread/started` MUST leave in the caller's own dispatch tick, because the
    // delete/resume reservation race is decided by which of the two admits first, and an `await` before
    // them hands every same-tick delete the win. The window is two filesystem calls wide and self-clearing,
    // which is the D-M5-21c boot-window class; the reservation race is a lost transcript.
    //   The other half of that finding — a concurrent `thread/archive` writing a marker this call then
    // removes — is not a defect: `registry.add` above runs BEFORE the reply, so archive's own second
    // live-guard sees the record, takes its marker back out and refuses BUSY. Whichever order the two
    // arrive in, the session ends up live and unshelved, which is what D-M5-21 asks for.
    if (admits) await this.autoUnarchive(ctx, opts.resume);
  }

  /** D-M5-21: opening a conversation takes it off the shelf — and it is what keeps "a live thread is never
   *  hidden from the default list" true ACROSS servers, since markers are re-read per request and another
   *  server's archive is otherwise invisible to this one until someone lists. Called from every path that
   *  puts an existing session id under a live thread: the three the spec enumerates — `startThread` above
   *  (thread/resume, thread/fork), resume-carrying `thread/start`, `thread/attach` (fleet.ts) — plus the
   *  one it did not, a fleet host swapping its own conversation under a thread already attached here
   *  (fleet.ts's `adoptSessionId`, M5 fix wave A). That fourth is an admission in substance and not in
   *  shape: no request of ours performs it, we only observe it, and the shelved-and-live state it produced
   *  is exactly the one this decision exists to make unreachable. A FORK-carrying resume is NOT in the set
   *  and both of its request-side callers skip this (`forksSession`, D-M5-21b): it reads a transcript into
   *  a new id rather than admitting the one it names, so clearing that id's marker would take a
   *  conversation off the shelf that never opened.
   *
   *  GUARDED, because it runs after the reply is already on the wire: a state directory that cannot be read
   *  is not a reason to report a successful admission as failed, and the request id is spent, so an escaping
   *  rejection would reach dispatch's catch and put a SECOND frame on the wire for one request. The client
   *  is told instead — silence would leave a live thread hidden from the default list with nothing to say
   *  so, and the message goes through the handlers' own `storeRefusal` so this path cannot be the one that
   *  puts the operator's home directory on the wire.
   *
   *  `ctx` is UNDEFINED for the observed transition, because no connection asked for it. The warning then
   *  goes where that call's success notification goes — server-scoped, to the watchers — rather than to a
   *  requester who does not exist; the alternative, staying silent on the one path where nobody is holding
   *  a reply open, would make the failure invisible precisely when no client can correlate it. */
  async autoUnarchive(ctx: ConnCtx | undefined, sessionId: string): Promise<void> {
    try {
      if (!(await listArchived({ ccxDir: this.deps.ccxDir })).has(sessionId)) return;
      await removeArchiveMarker(sessionId, { ccxDir: this.deps.ccxDir });
      this.broadcastServer("thread/unarchived", { sessionId });
    } catch (e) {
      const message = `thread is live but its archive marker could not be removed — ${storeRefusal(e).message}`;
      if (ctx) this.warn(ctx.peer, "unarchiveFailed", message);
      else this.broadcastServer("warning", { code: "unarchiveFailed", message });
    }
  }

  /** M3 Task 7: admit a FLEET record (fleet.ts) — the register-half of the admission `thread/start` does
   *  inline, for a record whose engine has already been dialled, wired and (per §1e's activation
   *  protocol) deliberately NOT activated yet. Registering the decisions here rather than in fleet.ts is
   *  what makes `decision/list`, the park broadcast and the close-time teardown work for the thread
   *  exactly as they do for an inProcess one; `unattended` is read off the record because a fleet thread
   *  has no start config to carry it. */
  admitFleetThread(record: ThreadRecord): void {
    this.decisions.set(record.id, this.makeDecisions(record.id, record.unattended));
    this.registry.add(record);
  }

  /** One thread's decision registry — fleet.ts parks the HOST's decisions into it as views (§1b, and
   *  broker.ts's `parkView`). Deliberately narrower than exposing the map: a caller can reach the thread
   *  it is wiring and nothing else. */
  threadDecisions(threadId: string): ThreadDecisions | undefined { return this.decisions.get(threadId); }

  /** The shutdown latch, readable by the handlers that create a thread out of band (sessionLib.ts's
   *  thread/fork writes to the store BEFORE it reaches startThread's own refusal, so it has to consult
   *  the latch itself — both before and after that write). */
  get isShuttingDown(): boolean { return this.shuttingDown; }

  /** Tear one thread down: release its parked decisions, dispose the engine, tell the thread's subscribers,
   *  drop the record. Shared by thread/close, thread/stop and shutdown() — `reason` is what distinguishes
   *  them on the wire (`thread/closed {reason:"stopped"}` for a stop; absent for a plain close, which is
   *  the only honest thing to say about a detach).
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
  async closeRecord(record: ThreadRecord, reason?: "stopped"): Promise<void> {
    // M3 §1f — the origin branch, and it is a branch about TRUTH, not about cleanup. On a fleet thread a
    // close is a DETACH: the host keeps every decision it has parked and stays blocked on each one.
    // `teardown()` would announce `decision/resolved {by:"system", answer:{kind:"deny"}}` for each — a
    // denial no human gave and no engine performed, which an audit-logging client records as fact and a UI
    // renders as an answered prompt. So the views are dropped, silently, and the decisions stay where they
    // actually live.
    //
    // Safe to decide per RECORD rather than per entry: a fleet thread's registry holds views and nothing
    // else (`admitFleetThread` mints its ThreadDecisions but no fleet path ever calls `broker()` — the
    // host's engine has its own), while an inProcess thread's holds only real local parks, whose awaited
    // promises `teardown()` MUST settle or the dispose below deadlocks on them (see the order note above).
    const decisions = this.decisions.get(record.id);
    if (record.origin === "fleet") decisions?.discard(); else decisions?.teardown();
    record.routerOff?.(); // stop routing frames from an engine we are about to dispose (Task 8a)
    record.fleetOff?.();  // …and, for a fleet thread, the event layer installed alongside it (M3 Task 9:
                          // the two are installed as a pair and are released as one, so no subscription
                          // this record took outlives its registration)
    try {
      await record.session.dispose();
    } finally {
      // thread/closed reaches BOTH this thread's subscribers and every server-scoped watcher (Task 5),
      // deduped by Peer identity — fanout.ts owns that rule now that M2b's thread/rewound needs it too.
      broadcastToSubscribersAndWatchers(record.subscribers, this.watchers(), "thread/closed", { threadId: record.id, ...(reason ? { reason } : {}) });
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

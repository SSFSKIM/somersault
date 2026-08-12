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
// epoch, drop the router, dispose, install the replacement.
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
import { ERR } from "./rpc.js";
import type { RequestId } from "./rpc.js";
import { installRouter } from "./router.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { emptyFlagPerms, seedSettings, threadBusyReason, type EngineSession, type ThreadRecord } from "./registry.js";
import { FleetBusyError, type FleetEngineSession } from "./fleetEngine.js";
import { replyEngineThrow } from "./engineThrow.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { rewindAnchorsFrom } from "../sessions/rows.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import { rewindAnchorsParams, rewindDryRunParams, rewindParams } from "./schema/rewind.js";

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

/** The swap family's one host-op sender (§1d) — shared with `thread/clear` (settingsOps.ts), which is the
 *  fourth member of the family and must not grow a second copy of this. `{ok:false, error}` is the shape
 *  a throwing host handler produces (host/server.ts wraps every dispatch), so it is raised here and both
 *  arms answer through `replySwapThrow` below rather than each inventing a mapping.
 *
 *  ONE token is re-classed on the way past: `"busy"`. `host/server.ts` gates `rewind` and `clear` exactly
 *  as it gates `prompt`, so losing a race to another client of that host is the SAME refusal `turn/start`
 *  already answers -33001 for — raised as the same class (fleetEngine.ts's `FleetBusyError`) so a client
 *  matches one family whichever method it raced on. Only reachable in the gap before the host's own
 *  turn-start event has flipped this record's busy flag; after that the local gate refuses first.
 *
 *  Deliberately NOT settingsOps.ts's `forwardFlagOp`, which is send-plus-reply for a family whose reply is
 *  always the bare `{ok:true}`: each method here answers a DIFFERENT shape off the host's own body, and
 *  the flag ops are ungated host-side, so the busy re-class above would be a refusal they cannot receive. */
export async function forwardSwapOp<T extends { ok: boolean; error?: string }>(record: ThreadRecord, op: Record<string, unknown>): Promise<T> {
  const rep = await (record.session as FleetEngineSession).sendOp<T>(op);
  if (rep.ok) return rep;
  if (rep.error === "busy") throw new FleetBusyError();
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
  record.routerOff?.();
  try { await record.session.dispose(); } catch { /* see above — the replacement is what matters */ }
  record.session = makeReplacement();
  record.sessionId = nextSessionId;
  // The per-turn replay window belongs to the conversation that was just discarded (host.ts's swapEngine
  // resets its own turn buffer for the same reason): subscribe.ts replays `record.buffer` to every newly
  // attached client, so leaving it would hand the next client item events from a turn that no longer
  // exists in the transcript it is about to read.
  record.buffer = [];
  installRouter(srv, record);
  await repushThreadState(srv, record);
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
  const toggles = Object.entries(record.mcpToggles);
  if (toggles.length && s.toggleMcpServer) {
    await step("mcpToggles", async () => { for (const [name, enabled] of toggles) await s.toggleMcpServer!(name, enabled); catalogMoved = true; });
  }
  const overrides = Object.entries(record.mcpOverrides);
  if (overrides.length && s.setMcpPermissionModeOverride) {
    await step("mcpOverrides", async () => { for (const [name, mode] of overrides) await s.setMcpPermissionModeOverride!(name, mode); });
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
  // The MCP layer reconciles by the same rule, label by label: the replacement's real topology is the one
  // `record.config` built it with, so a refused label has nothing left to carry — and, as with the flag
  // layer, a stale row would be silently re-pushed onto every LATER replacement too.
  if (lost.includes("mcpServers")) record.mcpServersSet = undefined;
  if (lost.includes("mcpToggles")) record.mcpToggles = {};
  if (lost.includes("mcpOverrides")) record.mcpOverrides = {};
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
  if (srv.pendingDecisions(threadId).length) { ctx.peer.replyError(id, ERR.BUSY, "a decision is pending — answer it first"); return; }
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
        await forwardSwapOp(record, { op: "rewind", uuid, prevUuid, scope });
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
  record.swapInFlight = true;
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
        await swapEngine(srv, record, () => factory(sessionId, prevUuid!, uuid, record.config ?? {}), sessionId);
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
      // thread wedged reading "swapping" forever.
      record.swapInFlight = false;
    }
  });
};

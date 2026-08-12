// appserver/settingsOps.ts — M2b Task 3b: the nine host-wire ops gap 6 named (`thread/settings/read`,
// `thread/directory/{list,add,remove}`, `thread/permissionRule/{add,remove}`, `thread/outputStyle/set`,
// `thread/effort/set`, `thread/clear`). Six of the nine reach the engine through ONE primitive —
// `applyFlagSettings` — which is PER-KEY REPLACEMENT: every key the pushed object names is overwritten
// wholesale, never merged into, while keys it does not name are left alone. This file depends on both
// halves of that. Because a named key is REPLACED, the whole of that key's value must be pushed every
// time — hence the per-record accumulator (`registry.ts`'s `flagPerms`/`flagOutputStyle`/`flagEffort`)
// rather than forwarding each request verbatim: without it, granting a second directory would revoke the
// first. Because an UNNAMED key is untouched, the layer can be replayed as three independent single-key
// calls — which is exactly what the swap seam does (rewind.ts's `repushThreadState`, mirroring
// `host/host.ts`'s `replayFlagState`, host.ts:432-437).
//
// COMMIT ONLY AFTER THE ENGINE ACCEPTS (`host/host.ts`'s `pushFlagPerms`, verbatim reasoning). The
// accumulator is not a log of what clients asked for, it is the set the swap seam will REPLAY onto every
// replacement engine — so a rejected grant that left a phantom row behind would be silently re-granted
// later, by a push no client ever made and no engine ever approved. Every mutation therefore builds
// `next` locally, awaits the push, and only then assigns.
//
// The reads (`settings/read`, `directory/list`) are UN-CHAINED, mirroring introspect.ts/tasks.ts: a poll
// must not queue behind whatever else the thread has in flight. The mutations are chain-scoped, mirroring
// settings.ts/mcp.ts, and each resolves its engine method INSIDE the chain — rewind and clear both swap
// `record.session`, so the engine that serves an op is the one live when the chain reaches it, not the one
// live when the request arrived.
//
// `thread/clear` is the ninth, and it is not a flag op at all: it is the SAME engine swap `thread/rewind`
// performs (rewind.ts's `swapEngine`), against a fresh conversation instead of a resumed one. It reuses
// that seam whole — including the post-swap state re-push, which is what carries this file's accumulator
// across the replacement.
//
// FLEET THREADS TAKE NONE OF THAT (M3 §1b, Task 10). Everything above describes one server owning one
// engine; a fleet thread's engine belongs to a running host that other clients are also pushing flag state
// into, and that host keeps the very accumulator this file keeps — `host/host.ts`'s own layer, replayed by
// its own `replayFlagState` across its own swaps. So the fleet arm forwards each request as the host's own
// dedicated op (`add_dir`, `set_effort`, … — `host/ops.ts`'s shapes) and writes NOTHING locally:
//  - No accumulator. A second copy could only ever disagree with the host's, and nothing here would ever
//    replay it (`repushThreadState` runs on a local engine swap, which this origin never performs).
//  - No dedup guard. The membership test that makes an inProcess re-add a no-op reads that local copy, so
//    on a fleet thread it would answer for state it does not own — the host decides what a re-add means.
//  - No `applyFlagSettings`. The fleet engine deliberately lacks the member (§1b's absent list): per-key
//    replacement of a whole bucket is exactly the wrong primitive when the bucket's truth is the host's.
import { ERR } from "./rpc.js";
import type { RequestId } from "./rpc.js";
import { replyEngineThrow } from "./engineThrow.js";
import { DECISION_PENDING, forwardSwapOp, replySwapThrow, swapEngine } from "./rewind.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { threadBusyReason, type EngineSession, type ThreadRecord } from "./registry.js";
import { SWAP_TIMEOUT_MS, type FleetEngineSession } from "./fleetEngine.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import {
  settingsReadParams, directoryListParams, directoryPathParams, permissionRuleParams,
  outputStyleSetParams, effortSetParams, threadClearParams,
} from "./schema/settingsOps.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors mcp.ts/tasks.ts — registry.ts's `updatedAt` is unix seconds, not ms

const UNSUPPORTED = "unsupported by this engine"; // introspect.ts:36's exact wording — one string, every call site

// Every chain-deferred mutation here shares engineThrow.ts's -33005 re-check (see its header), with
// -32603 as the ALIVE mapping: the engine's failures on this seam are untyped strings, so there is no
// sub-class to relay.

/** The fleet arm of every flag mutation (see the module header): one host op, one `{ok:true}`, nothing
 *  written here. Chain-scoped like its inProcess twin, so two writes from one client reach the host in the
 *  order the client made them.
 *
 *  The receipt is checked rather than assumed — a host handler that threw answers the generic
 *  `{ok:false, error}` `host/server.ts` wraps every dispatch in — and the failure goes through the same
 *  `replyEngineThrow` the local arm uses, so a socket that died while this op waited its turn in the chain
 *  reads as -33005 rather than as an internal error. */
async function forwardFlagOp(record: ThreadRecord, ctx: ConnCtx, id: RequestId, op: Record<string, unknown>): Promise<void> {
  try {
    const rep = await (record.session as FleetEngineSession).sendOp<{ ok: boolean; error?: string }>(op);
    if (!rep.ok) throw new Error(rep.error ?? "host refused");
    record.updatedAt = nowSec();
    ctx.peer.reply(id, { ok: true });
  } catch (e) {
    replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
  }
}

/** The whole of a flag mutation's body, minus the delta each one computes. `next` returns the accumulator
 *  value this op WANTS; returning `undefined` means "nothing changes" — an idempotent re-add — which
 *  replies ok WITHOUT touching the engine and WITHOUT bumping `updatedAt` (host's addDir/addRule early
 *  return; the timestamp tracks work the engine accepted, and no work happened).
 *
 *  `apply` is handed the whole post-push accumulator to commit. The order inside the try is fixed: push,
 *  commit, bump, reply — a throw anywhere before the commit leaves the record exactly as it was.
 *
 *  `hostOp` is the same request said in the HOST's vocabulary, for the fleet arm. Every writer supplies
 *  both, side by side, because they are one request in two dialects — writing them apart is how the two
 *  drift. */
function flagMutation(
  parse: (params: Record<string, unknown>) => { ok: true; threadId: string; hostOp: Record<string, unknown>; delta: FlagDelta } | { ok: false },
): Handler {
  return (srv, ctx, id, params) => {
    const parsed = parse(params);
    if (!parsed.ok) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    const record = srv.registry.get(parsed.threadId);
    if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    record.chain = record.chain.then(async () => {
      if (record.origin === "fleet") { await forwardFlagOp(record, ctx, id, parsed.hostOp); return; }
      const fn = record.session.applyFlagSettings?.bind(record.session);
      if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
      const delta = parsed.delta(record);
      if (!delta) { ctx.peer.reply(id, { ok: true }); return; } // already in the accumulator — nothing to push
      try {
        await fn(delta.settings);
        delta.commit();          // COMMIT-AFTER-ACCEPT — see the module header
        record.updatedAt = nowSec();
        ctx.peer.reply(id, { ok: true });
      } catch (e) {
        replyEngineThrow(record, ctx, id, e, ERR.INTERNAL);
      }
    });
  };
}

/** What one flag mutation wants to do, resolved against the record at the moment the chain reaches it:
 *  the object to push, and the accumulator write to perform once the engine has accepted it. */
type FlagDelta = (record: ThreadRecord) => { settings: Record<string, unknown>; commit: () => void } | undefined;

/** Every permissions push carries the WHOLE four-bucket object (`applyFlagSettings` replaces, never
 *  merges), so the four helpers below differ only in which bucket they rebuild. */
const permsDelta = (record: ThreadRecord, next: ThreadRecord["flagPerms"]) => ({
  settings: { permissions: { ...next } },
  commit: () => { record.flagPerms = next; },
});

export const settingsRead: Handler = async (srv, ctx, id, params) => {
  const parsed = settingsReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const fn = record.session.getSettings?.bind(record.session);
  if (!fn) { ctx.peer.replyError(id, ERR.METHOD_NOT_FOUND, UNSUPPORTED); return; }
  // Under one named key, like introspect.ts's five reads: the engine's answer is untyped and may be any
  // JSON value, and a bare passthrough of `undefined` would put a result-less frame on the wire — one
  // this codebase's own `classify()` scores `invalid`, so the caller's request would never settle.
  ctx.peer.reply(id, { settings: await fn() });
};

export const directoryList: Handler = async (srv, ctx, id, params) => {
  const parsed = directoryListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // FLEET: the host assembles the identical three sources from ITS launch config and ITS accumulator
  // (`host.listDirs`, the op this forwards to). Answering from the fields below instead would report a
  // fleet thread's cwd alone — `record.config` is absent on this origin and `flagPerms` is deliberately
  // empty — i.e. every grant the session actually holds, missing. Un-chained like the read it is; a
  // rejection propagates into dispatch's own try/catch (introspect.ts's convention).
  if (record.origin === "fleet") {
    const rep = await (record.session as FleetEngineSession).sendOp<{ ok: boolean; error?: string; dirs?: unknown[] }>({ op: "list_dirs" });
    if (!rep.ok) { ctx.peer.replyError(id, ERR.INTERNAL, rep.error ?? "host refused"); return; }
    ctx.peer.reply(id, { data: rep.dirs ?? [], nextCursor: null });
    return;
  }
  // Three sources in host order (`host.listDirs`), and the three are what a directory UI needs to tell
  // apart: cwd is implicit and always granted, the launch list is fixed for the thread's life, and only
  // the session grants are removable. `process.cwd()` is not a guess when the start config named no cwd:
  // resolveOptions only sets the SDK's `cwd` option when the config carries one, so the engine genuinely
  // inherits this process's directory.
  const launch = (record.config?.additionalDirectories as string[] | undefined) ?? [];
  ctx.peer.reply(id, {
    data: [
      { path: record.cwd ?? process.cwd(), source: "cwd" },
      ...launch.map((path) => ({ path, source: "launch" })),
      ...record.flagPerms.additionalDirectories.map((path) => ({ path, source: "session" })),
    ],
    nextCursor: null, // unpaged; the envelope matches every other list method (decision/list, task/list)
  });
};

export const directoryAdd = flagMutation((params) => {
  const p = directoryPathParams.safeParse(params);
  if (!p.success) return { ok: false };
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "add_dir", path: p.data.path },
    delta: (record) => record.flagPerms.additionalDirectories.includes(p.data.path)
      ? undefined
      : permsDelta(record, { ...record.flagPerms, additionalDirectories: [...record.flagPerms.additionalDirectories, p.data.path] }),
  };
});

export const directoryRemove = flagMutation((params) => {
  const p = directoryPathParams.safeParse(params);
  if (!p.success) return { ok: false };
  // No dedup guard on the remove side (host's `removeDir` has none either): re-pushing a list a path is
  // already absent from is how a caller re-asserts the layer against an engine it does not trust.
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "remove_dir", path: p.data.path },
    delta: (record) => permsDelta(record, { ...record.flagPerms, additionalDirectories: record.flagPerms.additionalDirectories.filter((d) => d !== p.data.path) }),
  };
});

export const permissionRuleAdd = flagMutation((params) => {
  const p = permissionRuleParams.safeParse(params);
  if (!p.success) return { ok: false };
  const { behavior, rule } = p.data;
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "add_rule", behavior, rule },
    delta: (record) => record.flagPerms[behavior].includes(rule)
      ? undefined
      : permsDelta(record, { ...record.flagPerms, [behavior]: [...record.flagPerms[behavior], rule] }),
  };
});

export const permissionRuleRemove = flagMutation((params) => {
  const p = permissionRuleParams.safeParse(params);
  if (!p.success) return { ok: false };
  const { behavior, rule } = p.data;
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "remove_rule", behavior, rule },
    delta: (record) => permsDelta(record, { ...record.flagPerms, [behavior]: record.flagPerms[behavior].filter((r) => r !== rule) }),
  };
});

export const outputStyleSet = flagMutation((params) => {
  const p = outputStyleSetParams.safeParse(params);
  if (!p.success) return { ok: false };
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "set_output_style", style: p.data.style },
    // No dedup: unlike the list ops there is nothing to double up, and re-asserting the current style is a
    // legitimate way to push it onto an engine whose layer a client believes has drifted.
    delta: (record) => ({ settings: { outputStyle: p.data.style }, commit: () => { record.flagOutputStyle = p.data.style; } }),
  };
});

export const effortSet = flagMutation((params) => {
  const p = effortSetParams.safeParse(params);
  if (!p.success) return { ok: false }; // the enum refuses an unknown level HERE, before the engine is touched
  return {
    ok: true, threadId: p.data.threadId,
    hostOp: { op: "set_effort", level: p.data.level },
    delta: (record) => ({ settings: { effortLevel: p.data.level }, commit: () => { record.flagEffort = p.data.level; } }),
  };
});

const defaultFreshFactory = (config: Record<string, unknown>): EngineSession => openSession(config as OpenSessionConfig);

/** `thread/clear` — the conversation-dropping half of the swap family, and the one method `thread/rewind`
 *  deliberately cannot express (`resumeAt` takes a message uuid and has no value meaning "before the first
 *  message"). Same gates in the same order as rewind, for the same reasons: every refusal is decided
 *  SYNCHRONOUSLY, at request arrival, before a single side effect, and a parked decision blocks the clear
 *  because the swap awaits the outgoing engine's dispose, which cannot finish while a turn sits inside
 *  canUseTool holding one of our parked promises.
 *
 *  Two differences from rewind, both load-bearing:
 *  - NO sessionId gate. A rewind needs an anchor to resume; a clear needs nothing — it opens a fresh
 *    conversation, which is exactly what a thread whose engine never reported an id has already got.
 *  - The replacement config sets `resume`/`resumeAt` to undefined EXPLICITLY rather than omitting them
 *    (`host.clearSession`'s lesson): `record.config` is the object the factory was handed at start OR
 *    resume time, so a thread born from `thread/resume` still carries a `resume` key, and spreading it
 *    would silently reopen the very conversation the clear was asked to drop.
 *
 *  Not exempt from dispatch's -33005 gate: the swap disposes the outgoing engine and opens a replacement
 *  through the same factory `thread/start` uses, so it is not "answerable without live transport" — a
 *  client reconciling a dead thread closes it and starts a new one.
 *
 *  And for the same reason it consults the SHUTDOWN LATCH like every other engine-CREATING method
 *  (`thread/start`, `thread/fork`): shutdown's whole guarantee is that its snapshot of live threads cannot
 *  go stale (server.ts's `shutdown`), and a clear admitted inside that window opens a replacement engine —
 *  an SDK session and its `claude` child — that the pass already walked past and will never dispose. The
 *  latch is left origin-blind: a fleet clear creates nothing here, but the record it names is one the
 *  shutdown pass is already detaching, so refusing it is the same true answer for a different reason.
 *
 *  FLEET (M3 §1d, Task 11): the fourth member of the swap family, and it forwards like the other three —
 *  the bare host `clear` op, and nothing written locally. The gates above still answer first (identical
 *  UX; the host gates its own clear the same way), but no `swapInFlight` is latched — the latch guards a
 *  LOCAL swap that never happens on this origin, and the host serializes its own clear against its own
 *  prompts. The epoch bump, the dropped id and the `thread/rewound {cleared:true}` all ride the host's
 *  `rewound` event (fleet.ts's layer), so one host swap produces exactly one broadcast no matter how many
 *  of its clients asked for it. It is also why the MCP/flag accumulators stay untouched for this origin
 *  (Task 10): they exist to be replayed by `repushThreadState`, which only a local swap runs. */
export const threadClear: Handler = (srv, ctx, id, params) => {
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  const parsed = threadClearParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { threadId } = parsed.data;
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  if (srv.pendingDecisions(threadId).length) { ctx.peer.replyError(id, ERR.BUSY, DECISION_PENDING); return; }
  // Latched synchronously, same as rewind: the work below sits behind record.chain, so a same-tick
  // turn/start would otherwise pass its own busy gate and drive an engine call against a thread being
  // swapped out from under it. Every gate reads it through threadBusyReason -> "swapping". INPROCESS
  // ONLY — see the fleet paragraph above: there is no local swap for the latch to fence off, and a busy
  // state no other client of that host observes is exactly what §1d's compact deviation refuses to invent.
  if (record.origin !== "fleet") record.swapInFlight = true;
  record.chain = record.chain.then(async () => {
    if (record.origin === "fleet") {
      try {
        // The swap deadline, like the rewind it shares a sender with: the host disposes one engine and
        // spawns another, and the default would fire mid-swap on work no timer can cancel (`forwardSwapOp`).
        await forwardSwapOp(record, { op: "clear" }, SWAP_TIMEOUT_MS);
        record.updatedAt = nowSec();
        // Read AFTER the op resolves: the host writes its swap burst — the `rewound {cleared:true}` this
        // record drops its id from — ahead of the reply to the op that caused it, and frames route in
        // arrival order, so the event layer has already run. `null`, not omitted: JSON.stringify would
        // drop an undefined key and a client would read "field missing" rather than "no id yet".
        ctx.peer.reply(id, { ok: true, sessionId: record.sessionId ?? null });
      } catch (e) { replySwapThrow(record, ctx, id, e); }
      return;
    }
    try {
      const factory = srv.deps.sessionFactory ?? defaultFreshFactory;
      // `undefined` as the post-swap id, where rewind passes its retained one: a fresh conversation
      // genuinely has no store id until its first init frame, and the router's init latch is what learns
      // it (router.ts's routeInit) — stamping the old id here would point every reader at a transcript
      // this thread no longer has.
      await swapEngine(srv, record, () => factory({ ...(record.config ?? {}), resume: undefined, resumeAt: undefined }), undefined);
      record.updatedAt = nowSec();
      // A clear IS a rewind, as far as a client's transcript is concerned: the conversation it was
      // rendering is gone and every cursor into it is stale. So it rides the SAME notification rather
      // than a second one every subscriber would have to learn — `cleared` is an additive tag, absent on
      // a plain rewind, so no existing subscriber's parse changes. `sessionId` is explicitly `null` (not
      // omitted — JSON.stringify would drop an undefined key) so a client reads "no id yet" rather than
      // "field missing"; it carries the NEW id only if the init latch has already learned one.
      broadcastToSubscribersAndWatchers(record.subscribers, srv.watchers(), "thread/rewound", { threadId, sessionId: record.sessionId ?? null, cleared: true });
      ctx.peer.reply(id, { ok: true, sessionId: record.sessionId ?? null });
    } catch (e) {
      replyEngineThrow(record, ctx, id, e, ERR.INTERNAL); // chain-deferred like every mutation here: the engine can die between arrival and this body
    } finally {
      record.swapInFlight = false; // a throw from the factory or the swap must not wedge the thread at "swapping"
    }
  });
};

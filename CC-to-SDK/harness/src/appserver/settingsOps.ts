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
import { ERR } from "./rpc.js";
import { swapEngine } from "./rewind.js";
import { broadcastToSubscribersAndWatchers } from "./fanout.js";
import { threadBusyReason, type EngineSession, type ThreadRecord } from "./registry.js";
import { openSession, type OpenSessionConfig } from "../session/index.js";
import type { AppServer, ConnCtx, Handler } from "./server.js";
import type { RequestId } from "./rpc.js";
import {
  settingsReadParams, directoryListParams, directoryPathParams, permissionRuleParams,
  outputStyleSetParams, effortSetParams, threadClearParams,
} from "./schema/settingsOps.js";

const nowSec = (): number => Math.floor(Date.now() / 1000); // mirrors mcp.ts/tasks.ts — registry.ts's `updatedAt` is unix seconds, not ms

const UNSUPPORTED = "unsupported by this engine"; // introspect.ts:36's exact wording — one string, every call site

/** Shared by every chain-deferred mutation here, identical to tasks.ts/mcp.ts's copy: a chain-deferred
 *  body runs LATER than dispatch's arrival-time -33005 gate, so the engine can die while the op waits its
 *  turn — and scoring that -32603 reports a server-internal fault for a dead read loop the caller can see
 *  for itself. Re-check `isEnded()` first, with dispatch's own wording, so a client sees one -33005
 *  message on either path. */
function replyMutationThrow(record: ThreadRecord, ctx: ConnCtx, id: RequestId, e: unknown): void {
  if (record.session.isEnded?.()) { ctx.peer.replyError(id, ERR.ENGINE_GONE, "Engine is gone (session ended)"); return; }
  ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
}

/** The whole of a flag mutation's body, minus the delta each one computes. `next` returns the accumulator
 *  value this op WANTS; returning `undefined` means "nothing changes" — an idempotent re-add — which
 *  replies ok WITHOUT touching the engine and WITHOUT bumping `updatedAt` (host's addDir/addRule early
 *  return; the timestamp tracks work the engine accepted, and no work happened).
 *
 *  `apply` is handed the whole post-push accumulator to commit. The order inside the try is fixed: push,
 *  commit, bump, reply — a throw anywhere before the commit leaves the record exactly as it was. */
function flagMutation(
  parse: (params: Record<string, unknown>) => { ok: true; threadId: string; delta: FlagDelta } | { ok: false },
): Handler {
  return (srv, ctx, id, params) => {
    const parsed = parse(params);
    if (!parsed.ok) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
    const record = srv.registry.get(parsed.threadId);
    if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    record.chain = record.chain.then(async () => {
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
        replyMutationThrow(record, ctx, id, e);
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

export const directoryList: Handler = (srv, ctx, id, params) => {
  const parsed = directoryListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
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
    delta: (record) => permsDelta(record, { ...record.flagPerms, additionalDirectories: record.flagPerms.additionalDirectories.filter((d) => d !== p.data.path) }),
  };
});

export const permissionRuleAdd = flagMutation((params) => {
  const p = permissionRuleParams.safeParse(params);
  if (!p.success) return { ok: false };
  const { behavior, rule } = p.data;
  return {
    ok: true, threadId: p.data.threadId,
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
    delta: (record) => permsDelta(record, { ...record.flagPerms, [behavior]: record.flagPerms[behavior].filter((r) => r !== rule) }),
  };
});

export const outputStyleSet = flagMutation((params) => {
  const p = outputStyleSetParams.safeParse(params);
  if (!p.success) return { ok: false };
  return {
    ok: true, threadId: p.data.threadId,
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
 *  an SDK session and its `claude` child — that the pass already walked past and will never dispose. */
export const threadClear: Handler = (srv, ctx, id, params) => {
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  const parsed = threadClearParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { threadId } = parsed.data;
  const record = srv.registry.get(threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  const busyReason = threadBusyReason(record);
  if (busyReason) { ctx.peer.replyError(id, ERR.BUSY, `Thread is busy (${busyReason})`); return; }
  if (srv.pendingDecisions(threadId).length) { ctx.peer.replyError(id, ERR.BUSY, "a decision is pending — answer it first"); return; }
  // Latched synchronously, same as rewind: the work below sits behind record.chain, so a same-tick
  // turn/start would otherwise pass its own busy gate and drive an engine call against a thread being
  // swapped out from under it. Every gate reads it through threadBusyReason -> "swapping".
  record.swapInFlight = true;
  record.chain = record.chain.then(async () => {
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
      replyMutationThrow(record, ctx, id, e); // chain-deferred like every mutation here: the engine can die between arrival and this body
    } finally {
      record.swapInFlight = false; // a throw from the factory or the swap must not wedge the thread at "swapping"
    }
  });
};

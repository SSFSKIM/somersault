// appserver/sessionLib.ts — Task 12: the session library (spec Wave 2, gap 4). Sessions persist on disk
// and outlive this process, so a GUI's thread picker needs the union of what this server has LIVE in
// memory plus everything the store knows about — thread/list below is that merge. The four CRUD ops
// (fork/rename/tag/delete) round it out: they let a client operate on a session this server never opened
// (a "cold" session, addressed by its bare store id) as easily as one it has live.
//
// Id resolution rule (doc-commented HERE ONCE; every one of the four CRUD handlers below goes through
// `resolveThreadId`, never re-implements it): `threadId` accepts EITHER a registry id (`thr_…` — resolved
// to `record.sessionId`, refusing ENGINE_GONE-shaped if the record exists but hasn't latched a sessionId
// yet — see registry.ts/router.ts on why that's a real, not hypothetical, state) OR a bare store
// `sessionId` (anything else — passed through as-is). This is what lets a client rename/tag/delete/fork a
// session the registry never saw.
//
// The one safety rule (binding constraint, spec D-M2-7): a session that is LIVE in this server must not
// be deleted out from under its own engine. `findLiveBySessionId` below is the one place that check is
// made; thread/delete is the only op that consults it as a refusal — rename/tag pass through safely on a
// live session (the store write is safe to make regardless; this handler just also keeps the in-memory
// mirror in sync so a live thread's next view already reflects it). "Live" includes a session admitted
// while the delete is mid-flight, which no single check can see: thread/delete pairs the check with a
// reservation (server.ts's `deletingSessions`) so admission and deletion cannot both win.
import { ERR } from "./rpc.js";
import type { ThreadRecord } from "./registry.js";
import { threadView, type AppServer, type Handler } from "./server.js";
import {
  listSessions as realListSessions,
  forkSession as realForkSession,
  renameSession as realRenameSession,
  tagSession as realTagSession,
  deleteSession as realDeleteSession,
} from "../sessions/index.js";
import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { threadListParams, threadForkParams, threadNameSetParams, threadTagSetParams, threadDeleteParams } from "./schema/threads.js";

const DEFAULT_LIST_LIMIT = 200; // same default as the pre-Task-12 registry-only thread/list (server.ts)

type Resolved = { ok: true; sessionId: string } | { ok: false; code: number; message: string };

/** The one id-resolution rule (module header) — every CRUD handler below calls this instead of
 *  re-deriving it. A `thr_…` id must exist in the registry (else THREAD_NOT_FOUND, same as every other
 *  threadId-taking method) and must have already latched a store sessionId (else the engine-faithful
 *  "not yet known" state — router.ts's routeInit latches `record.sessionId` off the first system/init
 *  frame, so a thread started this same tick and never yet turned has no sessionId to resolve to).
 *  Anything else is treated as a bare store sessionId and passed straight through — no registry lookup at
 *  all — which is exactly what lets a client address a session this server never opened. */
function resolveThreadId(srv: AppServer, threadId: string): Resolved {
  if (!threadId.startsWith("thr_")) return { ok: true, sessionId: threadId };
  const record = srv.registry.get(threadId);
  if (!record) return { ok: false, code: ERR.THREAD_NOT_FOUND, message: "Thread not found" };
  if (!record.sessionId) return { ok: false, code: ERR.ENGINE_GONE, message: "Session id not yet available for this thread" };
  return { ok: true, sessionId: record.sessionId };
}

/** The live-guard's one lookup (module header, spec D-M2-7): is ANY record in this server's registry
 *  currently backed by this store sessionId — regardless of how the caller spelled `threadId` (a `thr_…`
 *  id resolves to the SAME record this finds; a bare sessionId that happens to match a live thread's
 *  engine must be caught here too). */
function findLiveBySessionId(srv: AppServer, sessionId: string): ThreadRecord | undefined {
  return srv.registry.list().find((r) => r.sessionId === sessionId);
}

/** Store-only rows project to the SAME 14-field shape threadView produces (parent §5) — a client must not
 *  be able to tell a live row from a stored one by its shape alone, only by its content. No `thr_` id
 *  exists for a session this server never opened, so `id` IS the store sessionId; `status` is always idle
 *  and `queueDepth` always 0 (a store-only session has no engine to be busy and no queue to fill — 0 is
 *  the fact, not a placeholder); `model`/`permissionMode`/`thinking`/`origin` have no store equivalent and
 *  stay `undefined` exactly as an un-configured registry row would read.
 *
 *  UNIT NOTE (real bug caught in self-review, not just a style choice): `SDKSessionInfo.createdAt`/
 *  `lastModified` are documented milliseconds-since-epoch; `ThreadRecord.createdAt`/`updatedAt`
 *  (registry.ts) are explicitly unix SECONDS, and threadView passes those straight through. Without the
 *  /1000 below, a store-only row's timestamps would read ~1000x a live row's on the exact same wire
 *  field — wrong data, not just a cosmetic mismatch. */
function storeOnlyView(info: SDKSessionInfo): Record<string, unknown> {
  return {
    id: info.sessionId,
    sessionId: info.sessionId,
    title: info.summary,
    tags: info.tag !== undefined ? [info.tag] : undefined,
    cwd: info.cwd,
    model: undefined,
    permissionMode: undefined,
    thinking: { maxTokens: undefined },
    status: { state: "idle" as const },
    queueDepth: 0,
    origin: undefined,
    createdAt: info.createdAt !== undefined ? Math.floor(info.createdAt / 1000) : undefined,
    updatedAt: Math.floor(info.lastModified / 1000),
    preview: info.firstPrompt,
  };
}

/** `thread/list`, replacing the registry-only M1 handler: merges live registry + `deps.listSessions`,
 *  deduped on sessionId with LIVE WINNING (spec gap 4) — a live record's view already carries the freshest
 *  turn/settings state, so a store row for the same session is dropped, not layered on top. A live
 *  record's `title`/`tags` are filled from its store match only when the record itself doesn't already
 *  carry them (i.e. thread/name/set or thread/tag/set never patched this in-memory record) — patched
 *  fields always win over the store, since they were written by the SAME rename/tag call that persisted
 *  them. A live record whose `sessionId` has not yet latched (engine-faithful: undefined until the first
 *  turn's init frame) cannot be looked up in the store map at all — it is included as its own unmatched
 *  row, exactly like a fresh thread/list did before this task, and the store row it might one day match is
 *  independently listed as store-only until that happens. Cursor pages the MERGED array (offset cursor,
 *  Task 7's convention) — the merge, not either input alone, is what gets paginated. */
export const threadList: Handler = async (srv, ctx, id, params) => {
  const parsed = threadListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const listFn = srv.deps.listSessions ?? realListSessions;
  const storeRows = (await listFn({ cwd: parsed.data.cwd })) as SDKSessionInfo[];
  const bySessionId = new Map(storeRows.map((r) => [r.sessionId, r]));
  const seen = new Set<string>();
  const liveViews = srv.registry.list().map((r) => {
    const match = r.sessionId ? bySessionId.get(r.sessionId) : undefined;
    const view = threadView(srv, r);
    if (match) {
      seen.add(r.sessionId!);
      if (view.title === undefined) view.title = match.summary;
      if (view.tags === undefined) view.tags = match.tag !== undefined ? [match.tag] : undefined;
    }
    return view;
  });
  const storeOnlyViews = storeRows.filter((r) => !seen.has(r.sessionId)).map(storeOnlyView);
  const merged = [...liveViews, ...storeOnlyViews];
  const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;
  const offset = parsed.data.cursor ? Number(parsed.data.cursor) : 0;
  const page = merged.slice(offset, offset + limit);
  const consumed = offset + page.length;
  ctx.peer.reply(id, { data: page, nextCursor: consumed < merged.length ? String(consumed) : null });
};

/** `thread/fork`: resolve the source id, ask the store to fork it (a pure store-level copy — the source
 *  engine, if live, is untouched), then start a brand-new LIVE thread in THIS server resuming the fork —
 *  the same admission spine `thread/resume` uses (`AppServer.startThread`, extracted from its handler body
 *  in this task). The reply's thread is that new record's view: startable and usable like any other, not
 *  merely a stored copy. */
export const threadFork: Handler = async (srv, ctx, id, params) => {
  const parsed = threadForkParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  // The shutdown latch is consulted TWICE, around the store write. This is the one admission path whose
  // side effect lands before `startThread`'s own refusal is reached: startThread refusing a fork whose
  // store copy already exists leaves an orphan session on disk that nothing in this process ever owned.
  // Checking first skips the write entirely; re-checking after undoes it, since the latch can land while
  // forkFn is in flight (shutdown() keeps accepting frames while it awaits a slow dispose).
  if (srv.isShuttingDown) { ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down"); return; }
  try {
    const forkFn = srv.deps.forkSession ?? realForkSession;
    const result = await forkFn(resolved.sessionId, { upToMessageId: parsed.data.upToMessageId, title: parsed.data.title });
    if (srv.isShuttingDown) {
      await (srv.deps.deleteSession ?? realDeleteSession)(result.sessionId);
      ctx.peer.replyError(id, ERR.SHUTTING_DOWN, "Server is shutting down");
      return;
    }
    srv.startThread(ctx, id, { resume: result.sessionId, unattended: parsed.data.unattended });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** `thread/delete`: the ONE place the live-guard (module header) is enforced. Refuses BUSY (-33001) —
 *  reusing the busy-family code, not inventing a new one, since "you may not tear this down right now" is
 *  exactly what BUSY already means on the wire — with the spec's literal message. Passes through to the
 *  store otherwise, then announces the deletion server-wide (thread/deleted, spec D-M2-7) so a picker
 *  watching thread existence drops the row even though no thread/subscribe ever existed for a cold id. */
export const threadDelete: Handler = async (srv, ctx, id, params) => {
  const parsed = threadDeleteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  // RESERVE FIRST, then check live (srv.deletingSessions): the live-check and the store delete cannot be
  // one atomic step — the delete is awaited, and a thread/resume for this same session admitted during
  // that await would come up live on a session whose history is being erased. The reservation is what
  // startThread refuses against, so the two orders are the only two possible: reserved-then-resumed (the
  // resume is refused) or resumed-then-reserved (this check finds it and refuses the delete, because
  // startThread stamps the resume target eagerly). Released in `finally` — a failed delete must not
  // reserve the id forever.
  srv.deletingSessions.add(resolved.sessionId);
  try {
    if (findLiveBySessionId(srv, resolved.sessionId)) { ctx.peer.replyError(id, ERR.BUSY, "Thread is live in this server — close it first"); return; }
    const deleteFn = srv.deps.deleteSession ?? realDeleteSession;
    await deleteFn(resolved.sessionId);
    ctx.peer.reply(id, { ok: true });
    srv.broadcastServer("thread/deleted", { sessionId: resolved.sessionId });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  } finally {
    srv.deletingSessions.delete(resolved.sessionId);
  }
};

/** `thread/name/set`: safe on a live session (spec D-M2-7) — passes through to the store, and if a live
 *  record is backed by this sessionId, patches its in-memory mirror too (so its NEXT threadView already
 *  carries the new title without waiting on a store round-trip) and tells that thread's subscribers via
 *  thread/name/updated. */
export const threadNameSet: Handler = async (srv, ctx, id, params) => {
  const parsed = threadNameSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  try {
    const renameFn = srv.deps.renameSession ?? realRenameSession;
    await renameFn(resolved.sessionId, parsed.data.title);
    const live = findLiveBySessionId(srv, resolved.sessionId);
    if (live) live.title = parsed.data.title;
    ctx.peer.reply(id, { ok: true });
    if (live) srv.broadcast(live.id, "thread/name/updated", { threadId: live.id, title: parsed.data.title });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** `thread/tag/set`: same pass-through + live-mirror-patch shape as thread/name/set — but NO notification
 *  (parent §8 defines a notification for a name change only; tag has none). The store's tag is a single
 *  nullable string; the mirror (and the wire's `tags`) is the plural array parent §5 defines, so a set tag
 *  wraps to a one-element array and `null` clears it back to `undefined`. */
export const threadTagSet: Handler = async (srv, ctx, id, params) => {
  const parsed = threadTagSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const resolved = resolveThreadId(srv, parsed.data.threadId);
  if (!resolved.ok) { ctx.peer.replyError(id, resolved.code, resolved.message); return; }
  try {
    const tagFn = srv.deps.tagSession ?? realTagSession;
    await tagFn(resolved.sessionId, parsed.data.tag);
    const live = findLiveBySessionId(srv, resolved.sessionId);
    if (live) live.tags = parsed.data.tag !== null ? [parsed.data.tag] : undefined;
    ctx.peer.reply(id, { ok: true });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

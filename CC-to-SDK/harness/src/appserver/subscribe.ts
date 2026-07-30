// appserver/subscribe.ts — thread/subscribe + thread/unsubscribe + thread/read (Task 9): the
// replay-first join a client uses to attach to a thread already in progress (spec §5), plus paginated
// read of the persisted transcript. Split out of server.ts per the plan's "extract before letting a hot
// file sprawl" rule (turns.ts is the precedent for this split).
import { ERR } from "./rpc.js";
import { itemEventNotification } from "./turns.js";
import { itemsFromTranscript } from "./items/replay.js";
import type { Item } from "./items/types.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { activeTurnId, threadStatus } from "./registry.js";
import type { Handler } from "./server.js";
import { threadIdParams } from "./schema/core.js";
import { threadReadParams } from "./schema/threads.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500; // gap 10: a client-requested limit above this is clamped, not honored verbatim
// gap 12: how far a subsequent page over-fetches past its target row count, since rows and items are
// not 1:1 (one row can complete several items, or an item's own row can sit many rows back) — a
// straddling tool call needs its OPENING row inside the fetch window to resolve at all (spec Wave 0).
const LOOKAHEAD_MULTIPLIER = 4;

const defaultGetSessionMessages = (sessionId: string, opts?: { limit?: number; offset?: number }): Promise<unknown[]> =>
  sdkGetSessionMessages(sessionId, opts);

/** Binary search for the smallest prefix of `windowMessages` whose `itemsFromTranscript` mapping
 *  already contains `targetId` — NOT a search by item COUNT (item counts are not safe to bisect on
 *  here): a truncated prefix's own `itemsFromTranscript` call runs its own `finalize(false)` at that
 *  prefix's end, which force-completes any tool still dangling there. That forced completion is
 *  counted in a SHORTER prefix even though the tool's true (or forced) completion in a LONGER prefix
 *  lands at a different position — so two prefixes can disagree on WHICH items make up a given count,
 *  and cutting on count risks stranding a row-range between two pages that neither page's fetch ever
 *  covers again (a real data-loss bug, caught by hand-tracing a straddling-tool-call fixture before
 *  this landed). An id's PRESENCE has no such issue: once some row registers or emits an id, every
 *  longer prefix still contains it, forced or genuine — a stable, monotonic property to bisect on. */
function boundaryRow(windowMessages: unknown[], targetId: string): number {
  let lo = 0, hi = windowMessages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (itemsFromTranscript(windowMessages.slice(0, mid)).some((it) => it.id === targetId)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Maps one fetched row window to a page: the newest `limit` items of it, plus where the NEXT
 *  (older) page's fetch should end. `base` is this window's own absolute row offset (0 for the
 *  first page's whole-file fetch, `from` for a subsequent page's bounded fetch) — `boundaryRow`
 *  only knows the window-relative index, so the caller's absolute position has to be added back in.
 *  When nothing in this window is discarded (it already fit within `limit`), the next cursor is
 *  simply this window's own start ("recurse the window start", spec Wave 0) — every earlier row is
 *  still unfetched and untouched, so paging can resume exactly there. */
function pageFromWindow(windowMessages: unknown[], limit: number, epoch: number, base: number): { data: Item[]; nextCursor: string | null } {
  const windowItems = itemsFromTranscript(windowMessages);
  const discardCount = Math.max(0, windowItems.length - limit);
  const page = windowItems.slice(discardCount);
  const begin = discardCount > 0 ? base + boundaryRow(windowMessages, windowItems[discardCount - 1].id) : base;
  return { data: page, nextCursor: begin > 0 ? `${epoch}:${begin}` : null };
}

export const threadSubscribe: Handler = (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.subscribers.add(ctx.peer);
  ctx.peer.reply(id, { subscribed: true });
  // Replay, host-follow() order (spec §5): turn/started (only if the client actually MISSED it) -> buffered
  // item events -> parked decisions -> thread/status/changed LAST. Each buffered event is replayed under its
  // OWN tagged turnId (BufferedItemEvent.turnId) rather than a single computed "current" one — the
  // buffer is already scoped per-turn by the reset in turns.ts, but this avoids trusting that invariant
  // a second time (the registry.ts doc comment on BufferedItemEvent is explicit about this).
  //
  // Gated on record.turnStartedBroadcast, NOT on record.busy alone (Task 9 finding 2): busy flips true
  // synchronously at turn/start's request-arrival time, before the chain callback's live turn/started
  // broadcast actually fires. A subscribe landing in that gap already joined `record.subscribers` above,
  // so the live broadcast is about to reach it anyway — replaying here too would double-deliver. A turn
  // that HAS broadcast turn/started, though, was missed by a peer subscribing after the fact, and must be
  // replayed.
  if (record.busy && record.turnStartedBroadcast) {
    // record.currentTurnId is minted synchronously by turn/start in the SAME step as busy=true (Task 9
    // finding 1) — it is never stale, unlike a turnSeq re-derivation would be if this replay landed
    // before the chain callback's microtask ran.
    const turnId = record.buffer.length ? record.buffer[record.buffer.length - 1].turnId : record.currentTurnId!;
    ctx.peer.notify("turn/started", { threadId: record.id, turn: { id: turnId, status: "inProgress" } });
  }
  for (const b of record.buffer) {
    const { method, params: p } = itemEventNotification(record.id, b.turnId, b.event);
    ctx.peer.notify(method, p);
  }
  // Same payload as the live broadcast (server.ts's broadcastDecision), turnId included — replay and live
  // must never drift on shape; absent when no turn is in flight.
  const pending = srv.pendingDecisions(record.id);
  for (const entry of pending) ctx.peer.notify("decision/requested", { threadId: record.id, turnId: activeTurnId(record), decision: entry });
  ctx.peer.notify("thread/status/changed", { threadId: record.id, status: threadStatus(record, pending.length > 0) });
};

export const threadUnsubscribe: Handler = (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.subscribers.delete(ctx.peer);
  ctx.peer.reply(id, { subscribed: false });
};

/** Row-windowed pagination over the persisted transcript (gap 12): `cursor` is `"<epoch>:<rowOffset>"`
 *  — an absolute row index qualified by the thread's generation counter, since M2b's rewind truncates
 *  rows and a bare offset would then silently address different content (spec Wave 0). A cursor whose
 *  epoch no longer matches `record.epoch` is refused, not honored. Each page itself reads
 *  oldest->newest so the client can prepend it directly above what it already holds. Absent
 *  `record.sessionId` (never persisted yet) is an empty page, not an error.
 *
 *  The first page fetches the whole transcript once (there's no cheaper way to find "the newest N
 *  items" without seeing everything); every later page fetches only a bounded row window
 *  (`LOOKAHEAD_MULTIPLIER * limit` rows, offset/limit forwarded straight to the reader) — the gap-12
 *  fix. A straddling tool call whose result falls outside a page's window resolves as an `inProgress`-
 *  or forced-`completed` item on the older page rather than its true settled form; the newer page
 *  already carried (or will carry) the true form under the SAME id, so the client's id-dedup stitch
 *  keeps exactly one — acceptable for history paging (spec Wave 0). */
export const threadRead: Handler = async (srv, ctx, id, params) => {
  const parsed = threadReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  if (!record.sessionId) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  const getMessages = srv.deps.getSessionMessages ?? defaultGetSessionMessages;
  const requested = parsed.data.limit;
  const limit = Math.min(requested ?? DEFAULT_LIMIT, MAX_LIMIT);
  if (requested !== undefined && requested > MAX_LIMIT) srv.warn(ctx.peer, "limitClamped", "thread/read limit clamped to 500");

  if (!parsed.data.cursor) {
    const messages = await getMessages(record.sessionId);
    ctx.peer.reply(id, pageFromWindow(messages, limit, record.epoch, 0));
    return;
  }

  const [epochStr, rowStr] = parsed.data.cursor.split(":");
  if (Number(epochStr) !== record.epoch) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "cursor invalidated by a rewind; re-read from the start");
    return;
  }
  const cursorRow = Number(rowStr);
  if (cursorRow <= 0) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  const from = Math.max(0, cursorRow - LOOKAHEAD_MULTIPLIER * limit);
  const windowMessages = await getMessages(record.sessionId, { offset: from, limit: cursorRow - from });
  ctx.peer.reply(id, pageFromWindow(windowMessages, limit, record.epoch, from));
};

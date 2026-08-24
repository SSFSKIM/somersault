// appserver/subscribe.ts — thread/subscribe + thread/unsubscribe + thread/read (Task 9): the
// replay-first join a client uses to attach to a thread already in progress (spec §5), plus paginated
// read of the persisted transcript. Split out of server.ts per the plan's "extract before letting a hot
// file sprawl" rule (turns.ts is the precedent for this split).
import { ERR } from "./rpc.js";
import { itemEventNotification } from "./turns.js";
import { queuedNotification } from "./queue.js";
import { itemsFromTranscript } from "./items/replay.js";
import type { Item } from "./items/types.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { activeTurnId, threadStatus } from "./registry.js";
import { toWireDecision } from "./broker.js";
import { toWireToolCall } from "./dynamicCalls.js";
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
 *  contains EVERY id in `targetIds` — NOT a single anchor id, and NOT a search by item COUNT.
 *  Both of those are unsafe to bisect on here, for the same underlying reason: `itemsFromTranscript`
 *  pushes items in SCAN-COMPLETION order (a row's normal processing order), then appends
 *  `finalize(false)`'s still-open tools at the very END — so an item's position in the returned array
 *  does not track its OPENING row's position. A tool that opens early but is still dangling when the
 *  window ends lands at the array's tail even though an earlier-completing tool that opened LATER
 *  sits ahead of it. Bisecting on raw item count was the first bug caught here (a shorter prefix's
 *  own forced-tail completion can inflate its count past where a longer prefix's TRUE completion
 *  order would place that same id — proven by hand-trace, see subscribe.test.ts). Bisecting on a
 *  single anchor id's presence was the SECOND, subtler bug (an external review caught it): picking
 *  only `windowItems[discardCount - 1]` as the anchor assumes the discarded set's opening-row order
 *  matches its completion order, which a forced-tail completion breaks — a concurrently-open tool
 *  that opened EARLIER than the anchor but is still dangling can sit AFTER the anchor in the array,
 *  so including only the anchor's opening row can permanently strand rows the anchor never touched.
 *
 *  What IS safe: for any single item, "its id appears in `itemsFromTranscript(rows[0,w))`" is true
 *  exactly when `w` exceeds that item's OPENING row (a tool registers as soon as its `tool_use` row
 *  is seen, and is then either genuinely completed or force-completed by that prefix's own finalize —
 *  present either way; a non-tool item completes immediately at its own single row). That is
 *  monotonic in `w`, and so is the CONJUNCTION "prefix contains every id in `targetIds`" — its
 *  transition point is simply the max of each id's own transition point. Bisecting on that
 *  conjunction, over the FULL discarded set (not one representative), is what actually guarantees no
 *  discarded item's opening row is ever excluded from every future window. */
function boundaryRow(windowMessages: unknown[], targetIds: Set<string>): number {
  let lo = 0, hi = windowMessages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const ids = new Set(itemsFromTranscript(windowMessages.slice(0, mid)).map((it) => it.id));
    let hasAll = true;
    for (const t of targetIds) if (!ids.has(t)) { hasAll = false; break; }
    if (hasAll) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Maps one fetched row window to a page: the newest `limit` items of it, plus `begin` — the
 *  absolute row where the NEXT (older) page's fetch should end. `base` is this window's own
 *  absolute row offset (0 for the first page's whole-file fetch, `from` for a subsequent page's
 *  bounded fetch) — `boundaryRow` only knows the window-relative index, so the caller's absolute
 *  position has to be added back in. When nothing in this window is discarded (it already fit
 *  within `limit`), `begin` is simply this window's own start ("recurse the window start", spec
 *  Wave 0) — every earlier row is still unfetched and untouched, so paging can resume exactly
 *  there. Returns the raw `begin` (not yet a cursor string) so the caller can detect a window that
 *  made NO progress (`begin >= cursorRow`, the fetch's own exclusive upper bound) — see threadRead's
 *  retry loop for why that can legitimately happen and how it's handled. Also returns the window's
 *  full item mapping (`all`) so a caller falling back to "return everything this window has" (the
 *  retry loop's last resort) doesn't need to re-parse it. */
function pageFromWindow(windowMessages: unknown[], limit: number, base: number): { data: Item[]; begin: number; all: Item[] } {
  const windowItems = itemsFromTranscript(windowMessages);
  const discardCount = Math.max(0, windowItems.length - limit);
  const page = windowItems.slice(discardCount);
  const discardedIds = new Set(windowItems.slice(0, discardCount).map((it) => it.id));
  const begin = discardCount > 0 ? base + boundaryRow(windowMessages, discardedIds) : base;
  return { data: page, begin, all: windowItems };
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
    // `truncated` rides the replay too (final review R5): a client that subscribes AFTER a truncated fleet
    // turn-start must learn the head is missing exactly as one present at the live broadcast did (fleet.ts).
    ctx.peer.notify("turn/started", { threadId: record.id, turn: { id: turnId, status: "inProgress" }, ...(record.fleetTurnTruncated ? { truncated: true } : {}) });
  }
  // The queue, FIFO, one turn/queued per entry (M2b Task 8, chartered by the Task 4 review adjudication).
  // Replayed HERE — with the turn layer it belongs to, ahead of the item layer below — so the join order
  // stays turn edges -> items -> decisions -> status. Un-gated on `turnStartedBroadcast` unlike the
  // turn/started above: that gate exists because a live broadcast is about to deliver the same event to
  // this peer, and no such broadcast is pending for an entry that was enqueued before this peer arrived.
  // Without this a late client holds no id for the turns waiting behind the one in flight, and the
  // terminal `turn/completed {cancelled}` (or the `turn/started`) it will receive for each names a turn it
  // never saw exist.
  record.queue.forEach((q, i) => {
    const queued = queuedNotification(record.id, q.id, i + 1);
    ctx.peer.notify(queued.method, queued.params);
  });
  for (const b of record.buffer) {
    const { method, params: p } = itemEventNotification(record.id, b.turnId, b.event);
    ctx.peer.notify(method, p);
  }
  // Same payload as the live broadcast (server.ts's broadcastDecision), turnId included — replay and live
  // must never drift on shape; absent when no turn is in flight. `decision` is projected to the wire
  // shape (toolUseId) — see broker.ts's toWireDecision.
  const pending = srv.pendingDecisions(record.id);
  for (const entry of pending) ctx.peer.notify("decision/requested", { threadId: record.id, turnId: activeTurnId(record), decision: toWireDecision(entry) });
  // M7: the parked TOOL CALLS, after the decisions and before the status, because that is the order a
  // client must act in — a permission prompt gates the very tool whose call may be waiting behind it. The
  // same projection the live broadcast uses (server.ts's broadcastToolCall), so replay and live cannot
  // drift; `turnId` comes off the ENTRY rather than from `activeTurnId` — the call names the turn it was
  // parked under, which outlives a subscribe landing between turns.
  for (const call of srv.pendingToolCalls(record.id)) ctx.peer.notify("tool/callRequested", toWireToolCall(call));
  ctx.peer.notify("thread/status/changed", { threadId: record.id, status: threadStatus(record, srv.threadWaiter(record.id)) });
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
  // Cursor GENERATION check before the no-session early return, not after (M2b Task 3b): a cursor minted
  // at an earlier epoch is invalid whether or not the thread currently has a session, and `thread/clear`
  // is the case that separates the two — it bumps the epoch AND leaves the record with no sessionId until
  // the fresh conversation's init frame (a rewind, which retains its id, never reaches this ordering).
  // Answering that cursor with an empty page would tell a client "you have read everything" about a walk
  // the epoch bump actually invalidated, which is the exact silent-truncation this cursor scheme exists to
  // prevent.
  if (parsed.data.cursor && Number(parsed.data.cursor.split(":")[0]) !== record.epoch) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, "cursor invalidated by a rewind; re-read from the start");
    return;
  }
  if (!record.sessionId) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  const getMessages = srv.deps.getSessionMessages ?? defaultGetSessionMessages;
  const requested = parsed.data.limit;
  const limit = Math.min(requested ?? DEFAULT_LIMIT, MAX_LIMIT);
  if (requested !== undefined && requested > MAX_LIMIT) srv.warn(ctx.peer, "limitClamped", "thread/read limit clamped to 500");

  if (!parsed.data.cursor) {
    const messages = await getMessages(record.sessionId);
    const { data, begin } = pageFromWindow(messages, limit, 0);
    ctx.peer.reply(id, { data, nextCursor: begin > 0 ? `${record.epoch}:${begin}` : null });
    return;
  }

  const cursorRow = Number(parsed.data.cursor.split(":")[1]); // the epoch half was validated above
  if (cursorRow <= 0) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }

  // The `4*limit` lookahead is a guess, and a guess can undershoot: two (or more) tools can be open
  // at once, and the window's blind start can land AFTER one of them opened but still include a row
  // that references it (its tool_result) — that reference is then silently dropped (the mapper has
  // no record of a tool it never saw open), and no further progress is possible from THIS window's
  // own contents. Detected as `begin >= cursorRow` (the fetch made no headway at all). Retry with a
  // wider window; `from` monotonically shrinks toward 0 as the multiplier grows, so this always
  // terminates. At `from === 0` the window already covers everything back to the start of the
  // transcript — if it STILL can't progress there is nowhere earlier to send the client, so this
  // returns everything the window holds (bypassing `limit` for this one page) rather than loop or
  // drop data. This is NOT a rare path gated behind an exotic fixture: reaching `from === 0` without
  // progress is exactly what an ORDINARY transcript with two-plus concurrently-open tool calls hits
  // whenever `limit` is small relative to how much history is still owed (subscribe.test.ts's test
  // (j), an ordinary two-concurrent-tool fixture with no batching at all, triggers this branch at
  // `limit: 1` and `limit: 2`, and does not at `limit: 3` — see that test for the exact boundary).
  // It stays correctness-safe every time it fires: `cursorRow` is always a valid boundary carried
  // forward from the PRIOR page's own computation, so the `[0, cursorRow)` dump necessarily contains
  // everything not yet returned, nothing more and nothing less. It also self-limits — this branch
  // always replies `nextCursor: null`, so it can fire at most once per client walk and ends the
  // walk when it does. What it costs: for that one page, the fetch is bounded by `[0, cursorRow)`
  // rather than by the lookahead window, so the `O(window)` mapping-cost guarantee this task exists
  // to deliver degrades to `O(rows not yet returned)` for that single page — a real, bounded,
  // self-limiting cost, not a correctness bug.
  let multiplier = LOOKAHEAD_MULTIPLIER;
  for (;;) {
    const from = Math.max(0, cursorRow - multiplier * limit);
    const windowMessages = await getMessages(record.sessionId, { offset: from, limit: cursorRow - from });
    const { data, begin, all } = pageFromWindow(windowMessages, limit, from);
    if (begin < cursorRow) { ctx.peer.reply(id, { data, nextCursor: begin > 0 ? `${record.epoch}:${begin}` : null }); return; }
    if (from === 0) { ctx.peer.reply(id, { data: all, nextCursor: null }); return; }
    multiplier *= 2;
  }
};

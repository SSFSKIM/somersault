// appserver/subscribe.ts — thread/subscribe + thread/unsubscribe + thread/read (Task 9): the
// replay-first join a client uses to attach to a thread already in progress (spec §5), plus paginated
// read of the persisted transcript. Split out of server.ts per the plan's "extract before letting a hot
// file sprawl" rule (turns.ts is the precedent for this split).
import { ERR } from "./rpc.js";
import { itemEventNotification } from "./turns.js";
import { itemsFromTranscript } from "./items/replay.js";
import { getSessionMessages as sdkGetSessionMessages } from "../sessions/index.js";
import { activeTurnId } from "./registry.js";
import type { Handler } from "./server.js";
import { threadIdParams } from "./schema/core.js";
import { threadReadParams } from "./schema/threads.js";

const DEFAULT_LIMIT = 200;

const defaultGetSessionMessages = (sessionId: string): Promise<unknown[]> => sdkGetSessionMessages(sessionId);

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
  for (const entry of srv.pendingDecisions(record.id)) ctx.peer.notify("decision/requested", { threadId: record.id, turnId: activeTurnId(record), decision: entry });
  ctx.peer.notify("thread/status/changed", { threadId: record.id, status: record.busy ? "active" : "idle" });
};

export const threadUnsubscribe: Handler = (srv, ctx, id, params) => {
  const parsed = threadIdParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  record.subscribers.delete(ctx.peer);
  ctx.peer.reply(id, { subscribed: false });
};

/** Newest-first pagination over the persisted transcript, offset-from-end cursor: `cursor` is how many
 *  of the newest items the client has already consumed (as a decimal string). Each page itself reads
 *  oldest->newest so the client can prepend it directly above what it already holds. Absent
 *  `record.sessionId` (never persisted yet) is an empty page, not an error. */
export const threadRead: Handler = async (srv, ctx, id, params) => {
  const parsed = threadReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  if (!record.sessionId) { ctx.peer.reply(id, { data: [], nextCursor: null }); return; }
  const getMessages = srv.deps.getSessionMessages ?? defaultGetSessionMessages;
  const messages = await getMessages(record.sessionId);
  const items = itemsFromTranscript(messages);
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  const offset = parsed.data.cursor ? Number(parsed.data.cursor) : 0;
  const total = items.length;
  const end = Math.max(0, total - offset);
  const start = Math.max(0, end - limit);
  const page = items.slice(start, end);
  const consumed = offset + page.length;
  ctx.peer.reply(id, { data: page, nextCursor: consumed < total ? String(consumed) : null });
};

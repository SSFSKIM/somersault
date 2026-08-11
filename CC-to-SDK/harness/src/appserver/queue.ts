// appserver/queue.ts — the server-side turn queue (spec Wave 4). One module, one state machine: a queued
// entry goes `queued` -> `started` (drain) or `queued` -> `cancelled` (flush), and nothing else. The three
// transitions each have exactly one function here, and every caller reaches them through it:
//   enqueue    — the id is minted HERE, at enqueue time, so the enqueue reply, any cancel receipt and the
//                eventual turn/started all carry ONE correlatable id (a client can address, and cancel, a
//                turn that has not started).
//   flushQueue — the close/interrupt path: every entry is broadcast `turn/completed {status:"cancelled"}`.
//                A queued turn is NEVER silently dropped; a client that got `{queued:true}` is owed a
//                terminal event for that id either way.
//   takeNext   — the settleTurn path, and the ONLY place the drain reads the queue. It checks the
//                `closing` latch first: no engine call may start after a close began, and an entry seen
//                while the latch is up is left in place for the flush to cancel rather than shifted off
//                (a shifted entry whose start is then refused by beginTurn's busy gate would be exactly
//                the silent drop the flush exists to prevent).
// The latch itself is written by thread/close and shutdown() (server.ts), synchronously at request
// arrival, and never cleared — which is what makes "flush then never re-admit" a closed window rather
// than a race (turn/start's enqueue arm refuses a `closing` thread, turns.ts).
import { mintTurnId, type ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";

export interface QueuedTurn { id: string; input: string }

/** The queue's ADMISSION CAPS (fix wave 1). The queue is this server's own memory, held for as long as the
 *  running turn takes — so a client that keeps a thread busy could otherwise stack unlimited turns of
 *  unlimited size in it. Two caps, because the two failures are different: many small entries exhaust the
 *  count, one client's transcript-sized prompt exhausts the bytes. */
export const MAX_QUEUED_TURNS = 64;
export const MAX_QUEUED_BYTES = 1_048_576; // 1 MiB of queued input, summed across entries

/** What an enqueue attempt answers. A refusal names WHICH cap it hit, so `turn/start` can say so on the
 *  wire — a client that cannot tell "too many" from "too big" cannot retry usefully. */
export type EnqueueResult = { ok: true; id: string; position: number } | { ok: false; reason: "entries" | "bytes" };

/** Mints the entry's id off the thread's own turn counter — the same counter and format `turn/start` and
 *  compact use, so a drained turn needs no second id and the sequence never skips.
 *
 *  Both caps are checked BEFORE the mint, and that order is the invariant this module opens with: every
 *  minted id gets a terminal event, and a refused enqueue has none — so an id burned on a refusal would be
 *  a gap in the sequence that no client could ever account for. */
export function enqueueTurn(record: ThreadRecord, input: string): EnqueueResult {
  if (record.queue.length >= MAX_QUEUED_TURNS) return { ok: false, reason: "entries" };
  // The candidate counts against what is already queued, in BYTES (a UTF-16 length under-counts the
  // memory an emoji-heavy prompt actually holds). Accepted asymmetry: a NON-queued `turn/start` is not
  // size-capped — this cap protects THIS server's buffer, not the engine's input path.
  const queued = record.queue.reduce((n, q) => n + Buffer.byteLength(q.input, "utf8"), 0);
  if (queued + Buffer.byteLength(input, "utf8") > MAX_QUEUED_BYTES) return { ok: false, reason: "bytes" };
  const id = mintTurnId(record);
  record.queue.push({ id, input });
  return { ok: true, id, position: record.queue.length };
}

/** The `turn/queued` payload, built in ONE place because two paths emit it and they must not drift:
 *  turns.ts's enqueue arm broadcasts it live, subscribe.ts's replay notifies a late-joining peer one per
 *  queued entry (the same rule, and the same reason, as `itemEventNotification`'s two callers in turns.ts).
 *  Chartered by the Task 4 review adjudication (2026-08-11): the enqueue reply is private to one caller, so
 *  without this every OTHER subscriber's first news of a queued id is a `turn/started` or a
 *  `turn/completed {cancelled}` for a turn it never saw exist — an uncorrelatable, unrenderable event.
 *  `position` is 1-based and is a SNAPSHOT of where the entry sat when the event was emitted, exactly as
 *  the enqueue reply's own `position` always was — an interrupt naming an earlier entry shortens the queue
 *  without renumbering anything already sent. */
export function queuedNotification(threadId: string, turnId: string, position: number): { method: string; params: Record<string, unknown> } {
  return { method: "turn/queued", params: { threadId, turn: { id: turnId, status: "queued" }, position } };
}

/** `turn/interrupt` aimed at a QUEUED turn's own id (spec D-M2-10): remove the entry and complete it
 *  cancelled. Returns false when the id is not in the queue — the caller then treats the request as an
 *  ordinary interrupt of the running turn. */
export function cancelQueued(srv: AppServer, record: ThreadRecord, turnId: string): boolean {
  const i = record.queue.findIndex((q) => q.id === turnId);
  if (i === -1) return false;
  const [entry] = record.queue.splice(i, 1);
  broadcastCancelled(srv, record, entry.id);
  return true;
}

/** Empties the queue, answering every entry with its terminal `cancelled` event. Returns the ids, in
 *  queue order, for the receipt the caller replies with. */
export function flushQueue(srv: AppServer, record: ThreadRecord): string[] {
  const cancelled = record.queue.splice(0);
  for (const q of cancelled) broadcastCancelled(srv, record, q.id);
  return cancelled.map((q) => q.id);
}

/** The next queued turn to start, or undefined. The `closing` check is THE latch rule (spec Wave 4): a
 *  settle racing a close finds the latch up and starts nothing. */
export function takeNext(record: ThreadRecord): QueuedTurn | undefined {
  if (record.closing) return undefined;
  return record.queue.shift();
}

function broadcastCancelled(srv: AppServer, record: ThreadRecord, turnId: string): void {
  srv.broadcast(record.id, "turn/completed", { threadId: record.id, turn: { id: turnId, status: "cancelled" } });
}

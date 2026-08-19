// appserver/schema/core.ts — shared shapes (spec §9: zod is the single source of truth; the schema IS
// the validator — handlers import from here, never declare inline).
import { z } from "zod/v4";
export const threadIdParams = z.object({ threadId: z.string().min(1) });
/** The bare acknowledgement (M5 Task 9, D-M5-19's `result` slot). `thread/close`, `thread/stop`,
 *  `thread/delete` and the decision ops have all replied `{ok:true}` since M1 without publishing a shape;
 *  this is that shape, declared once so the two archive methods cannot disagree about it and so a later
 *  task can retrofit the older ones onto the SAME object rather than a second spelling of it.
 *  `z.literal(true)` rather than `z.boolean()`: `{ok:false}` is not a reply this protocol has — a failure
 *  is an error frame — and publishing `boolean` would tell a client to write a branch that never runs. */
export const okResult = z.object({ ok: z.literal(true) });
export const initializeParams = z.object({
  clientInfo: z.object({ name: z.string() }),
  authorization: z.string().optional(),
  // Both connection-scoped (spec Wave 0, D-M2-5): watchThreads opts this connection into server-scoped
  // thread-existence fan-out (fanout.ts); optOutNotificationMethods is honored at the last hop, Peer.notify.
  watchThreads: z.boolean().optional(),
  optOutNotificationMethods: z.array(z.string()).optional(),
});
export const serverStatusParams = z.object({});
// The one cursor shape, reused (via .extend(cursorParam.shape)) by thread/list and decision/list.
// Both page a plain in-memory array (the merged thread view, a parked-decision set) that a rewind
// never truncates, so a bare decimal offset stays valid for their whole lifetime — no epoch to
// qualify it against. thread/read used to reuse this shape too (Task 7); Task 13 below splits it off.
export const cursorParam = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
// Task 13: thread/read pages the persisted transcript by ROW, and M2b's rewind truncates rows — a
// bare row offset would silently address different content after a rewind. This cursor carries the
// thread's generation counter (record.epoch) as "<epoch>:<rowOffset>"; threadRead refuses one whose
// epoch no longer matches. Kept as its OWN shape rather than widening cursorParam above: thread/list
// and decision/list have no per-thread epoch to qualify against (thread/list, in fact, has no single
// thread at all — it lists across every thread), so forcing them onto this format would only break
// their existing plain-decimal mint/parse convention for no benefit.
export const epochCursorParam = z.object({
  cursor: z.string().regex(/^\d+:\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});

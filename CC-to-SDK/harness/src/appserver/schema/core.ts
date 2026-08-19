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
// Both page a plain in-memory array (the merged thread view, a parked-decision set) that a rewind never
// truncates, so a bare decimal offset needs no epoch to qualify it against — which is the narrow claim,
// and the only one still true. It is NOT a claim that the offset stays valid for a session's whole
// lifetime: the offset indexes a POSITION in the array, so anything that changes what the array holds
// between two pages shifts every later position, and a walk can then skip or repeat a row. Since M5 Task
// 10 `thread/list` pages a PARTITION of the merge (`archived`), and `thread/archive`/`thread/unarchive`
// are a first-party way for a client of this same milestone to move a session across that partition
// mid-walk — so the mutator is no longer only "a thread closed by itself". See the spec's parking lot:
// `thread/search` already ships the keyset that solves this class (D-M5-16), and re-cursoring a shipped
// method is a wire change M5 deliberately did not take.
// thread/read used to reuse this shape too (Task 7); Task 13 below splits it off.
export const cursorParam = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
/** The archived PARTITION, in the ONE spelling both methods the spec gives it to publish (D-M5-3, M5
 *  Tasks 7 and 10): `thread/search` and `thread/list`. Shared rather than declared twice because the
 *  sentence below IS the contract — `false` and OMITTED are the same request, and only `true` selects the
 *  other half — and two copies of a sentence are how one of them ends up saying "excludes archived
 *  sessions" while the other says "hides them unless asked", which are different methods to a client. The
 *  predicate that enforces it is shared for the same reason (archive.ts's `inArchivedPartition`).
 *  Spread into each params object at its existing field position rather than `.extend`ed on the end: the
 *  generated artifact is byte-pinned, and re-ordering a shipped method's properties is a diff about
 *  nothing. */
export const archivedParam = z.object({
  archived: z.boolean().optional().describe("false/omitted lists only unarchived sessions; true lists only archived ones"),
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

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
// `decision/list`'s cursor, and now only its. A decimal offset indexes a POSITION in the array being
// paged, so anything that changes what the array holds between two pages shifts every later position and
// the walk skips or repeats a row — which is a defect wherever the array can move under the walk, and is
// why `thread/list` no longer shares this shape (listCursorParam below). It stays here because a parked
// decision set is not that array: `decision/list` replies `nextCursor: null` unconditionally (an unpaged
// envelope, spec gap 2), so no client ever holds a decision cursor to send back, and the offset this
// accepts addresses nothing. Narrowing it to a keyset would be a wire change buying a walk that does not
// exist; the day decision/list actually pages, it takes the shape below, not this one.
// thread/read used to reuse this shape too (Task 7); Task 13 below splits it off.
export const cursorParam = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().positive().optional(),
});
// M6: `thread/list`'s own cursor, split off from `cursorParam` for the reason `epochCursorParam` was —
// one method's position needs a qualification the others' do not, and widening the shared shape would
// only break the remaining reuser's convention for no benefit.
//
// It is an OPAQUE keyset (base64url of `{v,s,q}` — searchScan.ts's codec), naming the SORT POSITION of the
// last row the previous page delivered rather than a count of rows consumed. `thread/list` pages a
// PARTITION of the live+store merge (`archived`, M5 Task 10), and `thread/archive`/`thread/unarchive` are
// a first-party way for a client to move a session across that partition mid-walk — so under an offset a
// walk that archived a row it had already been handed silently skipped the next one. A position in the
// ordering has no such coupling: the rows before it can come and go, and "the rows after this tuple" is
// still the same set. `thread/search` has shipped this pattern since D-M5-16; the ordering it resumes
// into is `updatedAt` descending, `id` ascending (sessionLib.ts's threadList).
//
// THE WIRE CHANGE, stated because it is the one this costs: a decimal cursor minted by an older server no
// longer decodes, and is refused `-32602` rather than read as "start from the beginning". A silent restart
// would hand that client a duplicate first page under a reply that looks like success, which is the same
// failure the keyset exists to remove, arriving through the error path instead of the happy one. The
// pattern below is base64url's alphabet, so such a cursor still reaches the decoder — the refusal is the
// decoder's, and it is the same refusal a forged or truncated cursor gets.
//
// It carries `thread/search`'s `q` too — the fingerprint binding a cursor to the walk it was minted for
// (D-M5-26), here over `cwd` and `archived`. Without it the fix would have had a second door left open:
// `archived` selects a partition, so a cursor kept across a show-archived toggle DECODES, finds a place in
// the other partition's ordering, and resumes after everything sorting before that tuple — a well-defined
// page of a walk nobody asked for, reported as success. A client with a checkbox reaches that by doing
// nothing unusual. Refused, not documented-around: telling a client "don't do it" in a description is not
// a guarantee, and the sibling method already spends the same eight bytes to make it one.
//
// WHAT THE KEYSET STILL DOES NOT PROMISE, stated because a limit a client has to infer from a data model
// it cannot see is one it will not infer. A keyset is exhaustive only over an IMMUTABLE sort key, and
// NEITHER component of this one is immutable for a logical session:
//   - `updatedAt` is the recency this method sorts by, and a turn bumps it. A session updated mid-walk
//     moves to the front of a descending order — ahead of a cursor already past that position — so an
//     unseen row can be carried over the cursor and missed, and a row already delivered can come back.
//   - `id` is `thr_…` for a row this server holds live and the bare sessionId for a store-only one, so a
//     cold session that goes live between two pages changes which tuple it sorts as: the same session,
//     under a different identity, on either side of the cursor.
// Strictly smaller than the offset it replaced — that skipped a row for a first-party ARCHIVE, a client's
// own action, where this needs a concurrent writer — and the fix is not one this shape can make: binding a
// walk to a snapshot means holding one, which is an architecture with an owner and not a repair. So it is
// PUBLISHED instead, in the `describe` below as well as here, which is where a client actually reads it.
// `thread/search` publishes the same caveat for its own recency keys and names the escape this method has
// no version of — `sortKey: created_at`, immutable, "use created_at for an exhaustive walk" (schema/
// search.ts). A client that needs an exhaustive inventory should walk THAT method; `thread/list` is the
// recency view, where being current matters more than being complete.
export const listCursorParam = z.object({
  cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).optional().describe("opaque keyset cursor from a previous reply's nextCursor; never client-composed. It is bound to the walk that minted it: re-issuing it with a different cwd or archived refuses -32602, as does anything this server did not mint (a forged or truncated cursor, or a pre-keyset decimal offset). Change either parameter and start a fresh walk. NOT exhaustive under concurrent writes: this walk's sort key (updatedAt, then id) is mutable — a turn bumps updatedAt, and a store-only session that goes live here changes id from its sessionId to a thr_ id — so a session that moves while you page can be re-encountered or missed. For an exhaustive walk use thread/search with sortKey created_at, whose key is immutable"),
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

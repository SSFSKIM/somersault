// appserver/arrivalsReply.ts — the READ side of an arrival: the entries a session logged, plus the rows a
// page actually returned, turned into placements the projector can render and into the one counts field
// every `thread/read` reply carries.
//
// ONE RULE, AND IT IS A REFUSAL (spec: When placement fails). The anchor resolves against the rows in hand
// and the arrival renders there, or it does not resolve and the arrival does not render — never a guessed
// position. Everything asymmetric about this file follows from that. An entry withheld here is still
// COUNTED, because `arrivalsField` reads the store rather than the page: a client that sees more `logged`
// than it received marked items learns that history is short, which is the only thing this design can
// honestly offer for an arrival whose row is gone. Counting only what rendered would turn a visible
// omission into a silent one.
//
// IT DOES NOT PLACE ANYTHING ITSELF. `items/project.ts` renders; this file only decides where. The split
// is what lets the projector stay a pure function of two data structures — the shape in which its parity
// law is checkable at all — and it means the contract between the two is `ResolvedArrivals` alone: every
// key in `byRow` is a real index into the rows the caller passed, and nothing unplaceable is in it.
import { rawTextOf } from "../peer/address.js";
import { contentHash16, type ArrivalAnchor, type ArrivalCounts, type ArrivalEntry, type ArrivalStore } from "../peer/arrivalLog.js";
import type { ResolvedArrivals } from "./items/project.js";

/** The reply's `arrivals` member, as a spread. THREE distinguishable answers, and the difference between
 *  them is the point:
 *
 *  - `{}` — merging is OFF for this server (no store: the structural rule in `peerInbound.ts`). The key is
 *    ABSENT rather than zero, because zero is a claim about a log, and no log was consulted (D3).
 *  - `{ arrivals: null }` — the store is degraded: it cannot vouch for its own count. Loud beats wrong; a
 *    number that may under-report would falsely certify a complete history.
 *  - `{ arrivals: { logged, dropped } }` — `logged` is the PRE-eviction total this session received, so it
 *    can legitimately exceed what any page returns.
 *
 *  A merge-enabled thread with no session id yet reports zeroes rather than hiding the field: merging is
 *  on, this thread has simply logged nothing that a session id could key.
 *
 *  ONE STORE OPERATION, AND THAT IS THE POINT (round 2, finding 5). Asking `isDegraded` and then `counts`
 *  is two marker reads with a window between them, and two app-server processes can hold one session — so
 *  the other process's degrade lands inside that window and this reply publishes numbers from a marker
 *  that had already stopped standing behind them. `countsSnapshot` answers both questions from one read,
 *  and `null` is the store saying it cannot tell: rendered here as the `arrivals: null` a client reads as
 *  "I cannot vouch for this history", never as a zero. */
export function arrivalsField(store: ArrivalStore | undefined, sessionId: string | undefined): { arrivals?: ArrivalCounts | null } {
  if (!store) return {};
  if (!sessionId) return { arrivals: { logged: 0, dropped: 0 } };
  return { arrivals: store.countsSnapshot(sessionId) };
}

const uuidOf = (row: unknown): string | null => {
  const u = (row as { uuid?: unknown } | null | undefined)?.uuid;
  return typeof u === "string" && u ? u : null;
};

/** Is `row` the row this anchor names? THE single anchor-match predicate — `resolveArrivals` below is built
 *  on it and Stage D's search calls it directly, because two transcriptions of this rule would eventually
 *  disagree about where one arrival goes depending on which method a client asked.
 *
 *  `predecessor` is the row before `row` in the transcript, and it has three legitimate values, all three
 *  of which the caller genuinely knows: a ROW, `null` for "this is the first row of the file", and
 *  `"unknown"` for "the window's left edge and no lookbehind" — which withholds, since an unverifiable
 *  anchor is an unresolved one. `prevUuid` is what pins POSITION: a uuid rebound by the reader's last-wins
 *  keying (M5 measured 1,562 duplicate occurrences) sits after a different predecessor, and that
 *  disagreement is exactly what this read side must withhold on.
 *
 *  The fingerprint is matched ON RECORDED FIELDS ONLY: `timestamp` is optional on a live frame, so an
 *  anchor that did not record one must not require the row to lack one — the same rule `peerInbound.ts`'s
 *  `fpMatchesRow` applies on the write side, and `rawTextOf`/`contentHash16` are the same two functions
 *  both sides hash with, so the bytes cannot drift apart. */
export function anchorMatchesRow(anchor: ArrivalAnchor, row: unknown, predecessor: unknown | null | "unknown"): boolean {
  if (uuidOf(row) !== anchor.afterUuid) return false;
  if (predecessor === "unknown") return false;
  // `null` is FILE START and only file start: a predecessor row carrying no uuid names nothing, and must
  // not be allowed to stand in for the absence of a predecessor.
  const prevUuid = predecessor === null ? null : uuidOf(predecessor);
  if (prevUuid !== anchor.prevUuid || (predecessor !== null && prevUuid === null)) return false;
  const r = row as { type?: unknown; timestamp?: unknown; message?: { content?: unknown } };
  if (String(r.type) !== anchor.fp.type) return false;
  if (contentHash16(rawTextOf(r.message?.content)) !== anchor.fp.hash) return false;
  return anchor.fp.timestamp === undefined || r.timestamp === anchor.fp.timestamp;
}

/** Where each entry goes in ONE window of rows — the answer `projectItems` is handed and trusts.
 *
 *  `rows` is the window as it will be rendered, WITHOUT the lookbehind: `byRow` keys index into it, so the
 *  caller's `base` offset and the cursor arithmetic stay in the row space they were already in.
 *  `lookbehindRow` is the one row of left context a bounded fetch carries, used for nothing but the first
 *  row's predecessor check. `windowIncludesRowZero` says this window starts at the transcript's first row,
 *  which decides two things at once: row 0's predecessor is the file start, and the `anchor: null`
 *  sentinel — the arrival preceded every row the seed returned — may render here and nowhere else.
 *
 *  WHAT IT WILL NOT EMIT, each for its own reason: an `ambiguous` entry (its position is unknowable, so it
 *  is counted and never placed), an entry whose id is already a fetched row's uuid (the dedupe guard —
 *  inert while the reader drops every `isMeta` row, and what keeps this correct the day one stops), an
 *  entry whose anchor matches no row in this window, and a null-anchored entry on a window that does not
 *  reach row 0. A key outside `[0, rows.length)` is never produced: the projector would ignore one, but an
 *  invariant a consumer merely tolerates is not an invariant.
 *
 *  ORDER IS THE STORE'S. Entries arrive in `(seq, id)` order and are appended in that order, never
 *  re-sorted — `seq` is seeded from the store across restarts precisely so this order means something.
 *
 *  FIRST MATCH WINS when a window holds two occurrences indistinguishable in every recorded field (uuid,
 *  predecessor, type, content hash, timestamp). That is a stated limit, not a resolution: the data carries
 *  no dimension that separates them, so any choice is equally true of what was observed, and a
 *  deterministic one at least keeps the bisection below monotone. */
export function resolveArrivals(
  entries: ArrivalEntry[],
  rows: unknown[],
  lookbehindRow: unknown | undefined,
  windowIncludesRowZero: boolean,
): ResolvedArrivals {
  const resolved: ResolvedArrivals = { byRow: new Map(), atStart: [] };
  // Indexed by uuid up front rather than scanned per entry: the cursorless page's window is the whole
  // transcript, and a per-entry scan would re-hash every row's content once per logged arrival.
  const rowsByUuid = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const uuid = uuidOf(rows[i]);
    if (!uuid) continue;
    const at = rowsByUuid.get(uuid);
    if (at) at.push(i); else rowsByUuid.set(uuid, [i]);
  }
  const predecessorOf = (i: number): unknown | null | "unknown" => {
    if (i > 0) return rows[i - 1];
    if (windowIncludesRowZero) return null;
    return lookbehindRow === undefined ? "unknown" : lookbehindRow;
  };
  for (const entry of entries) {
    if (entry.ambiguous) continue;
    if (rowsByUuid.has(entry.id)) continue;
    if (entry.anchor === null) {
      if (windowIncludesRowZero) resolved.atStart.push(entry);
      continue;
    }
    for (const i of rowsByUuid.get(entry.anchor.afterUuid) ?? []) {
      if (!anchorMatchesRow(entry.anchor, rows[i], predecessorOf(i))) continue;
      const here = resolved.byRow.get(i);
      if (here) here.push(entry); else resolved.byRow.set(i, [entry]);
      break;
    }
  }
  return resolved;
}

/** The same placements, narrowed to a PREFIX of the window — what `boundaryRow`'s bisection maps.
 *
 *  Re-resolving against the prefix would be the wrong primitive twice over: the prefix's first row has a
 *  predecessor the prefix cannot see, and first-match-wins could land a duplicate anchor on a different
 *  index in a shorter window. Narrowing an already-computed answer keeps the property the bisection rests
 *  on — an id appears in the prefix for every width past its row and never before.
 *
 *  `atStart` is dropped, not narrowed: a null-anchored entry has no row transition to bisect for, and it
 *  is outside the bisection by construction (spec round 5, finding 4). */
export function restrictTo(arrivals: ResolvedArrivals, rowCount: number): ResolvedArrivals {
  const byRow = new Map<number, ArrivalEntry[]>();
  for (const [i, group] of arrivals.byRow) if (i < rowCount) byRow.set(i, group);
  return { byRow, atStart: [] };
}

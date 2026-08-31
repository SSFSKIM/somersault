// appserver/items/project.ts — a window of persisted rows, plus the arrivals that landed inside it,
// projected into one ordered item list (M9 Stage C).
//
// THE PARITY LAW DEFINES THIS FILE. `projectItems(rows, EMPTY_ARRIVALS, …)` is `itemsFromTranscript(rows)`
// — element for element, on every transcript shape — and it is that by CONSTRUCTION rather than by test:
// `replay.ts` now calls this function, so there is exactly one loop and one per-row routing body in the
// codebase. The alternative that was rejected is worth naming, because it is the one that looks right: a
// second loop here that mirrors the replay's. Two mirrored routers drift the moment either side gains a
// row kind, and the drift surfaces as history that reads differently depending on whether a session ever
// received a peer message. A design review of exactly that shape caught a mirror that had dropped the
// DIRECT top-level user path — which erases ordinary prompts from history while every parity test that
// compares the two paths stays green, because both sides lose the row together.
//
// WHAT THIS FILE DOES NOT DO: resolve anchors. It is handed `ResolvedArrivals` keyed by row INDEX and it
// trusts them. Turning an entry's `anchor` (a uuid plus a content fingerprint) into an index against the
// rows a reader actually returned is the resolver's job (thread/read), and keeping it out of here is what
// lets the projector stay a pure function of two data structures — the only shape in which the parity law
// above is checkable at all.
import type { Item } from "./types.js";
import { TurnMapper, arrivalItem, userItem } from "./mapper.js";
import { rowKind } from "../../sessions/rows.js";
import { flattenForDisplay, type UserTurnInput } from "../../session/turnInput.js";
import { peerArrival } from "../../peer/address.js";
import type { ArrivalEntry } from "../../peer/arrivalLog.js";

const PHANTOM_ROW_KINDS = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);

/** Where each logged arrival goes in ONE window of rows, already decided.
 *
 *  `byRow` is keyed by WINDOW-RELATIVE row index — the position in the `rows` array handed to
 *  `projectItems`, not an absolute transcript offset — and an entry under key `i` emits after everything
 *  row `i` produced. `atStart` is the `anchor: null` sentinel: the arrival precedes every row the seed
 *  returned, which SUBSUMES (but is not limited to) a transcript that was confirmed empty.
 *
 *  ALREADY RESOLVED, in two senses the caller owes and this file cannot check. Entries are sorted by
 *  `(seq, id)` within each group — the store's order, preserved rather than re-derived. And `ambiguous`
 *  entries are NEVER placed: an arrival whose position is genuinely unknowable is counted but not
 *  rendered, so the resolver filters it out before building this. An ambiguous entry that reached `byRow`
 *  would be placed, and the projector would be right to place it — it was told where it goes. */
export interface ResolvedArrivals { byRow: Map<number, ArrivalEntry[]>; atStart: ArrivalEntry[] }

/** A `Map` that refuses every mutator. `Object.freeze` cannot reach inside a Map — `set` writes through a
 *  frozen reference exactly as it would through a live one — so the only way to make the shared empty
 *  un-poisonable at RUNTIME rather than by convention is to replace the mutators themselves. Throwing
 *  beats silently ignoring: a caller reaching for `set` here means to build a set of arrivals, and the
 *  message tells it where to build one. */
class ImmutableRowMap extends Map<number, ArrivalEntry[]> {
  private static refuse(): never {
    throw new TypeError("EMPTY_ARRIVALS is shared and immutable — build a fresh ResolvedArrivals instead");
  }
  override set(): never { return ImmutableRowMap.refuse(); }
  override delete(): never { return ImmutableRowMap.refuse(); }
  override clear(): never { return ImmutableRowMap.refuse(); }
}

/** Frozen as its own statement, not inline: `Object.freeze` on an array narrows it to `readonly T[]`, and
 *  the interface's field is a plain array because every OTHER `ResolvedArrivals` is built by filling one. */
const NO_ENTRIES: ArrivalEntry[] = [];
Object.freeze(NO_ENTRIES);

/** The no-arrivals case, and the left-hand side of the parity law. ONE shared value, and mutating it is a
 *  runtime error rather than a rule someone has to know: the container is frozen (no swapping `byRow`),
 *  the array is frozen (`push` throws under the module strictness every consumer here runs in), and the
 *  map's mutators throw. The failure this closes is silent and total — a single consumer that poisoned the
 *  shared empty would corrupt every LATER projection in the process, including the overwhelming majority
 *  of reads that carry no arrival at all and never look at this value's contents. */
export const EMPTY_ARRIVALS: ResolvedArrivals = Object.freeze({
  byRow: new ImmutableRowMap(),
  atStart: NO_ENTRIES,
});

/** ONE persisted row → the items it completes, appended to `out`.
 *
 *  This is the routing body `itemsFromTranscript` used to hold inline, unchanged in behaviour. It runs the
 *  row through a FRESH `TurnMapper` — the same reducer the live path uses — so replayed item ids and
 *  shapes are byte-identical to what the live stream produced. Task 9: a real on-disk transcript also
 *  carries CLI bookkeeping rows (slash-command echoes, local command output, caveats, compaction
 *  summaries) that must never surface as ordinary user messages; `rowKind` (src/sessions/rows.ts, the same
 *  classifier tui/replay.ts uses) filters those out first.
 *
 *  A phantom row still OCCUPIES its index — the caller's loop, not this function, decides what happens at
 *  a row — because `byRow` keys count raw rows. Keying arrivals off surviving items instead would shift
 *  every arrival behind a `/compact` echo. */
function routeRow(mapper: TurnMapper, frame: unknown, out: Item[]): void {
  if (PHANTOM_ROW_KINDS.has(rowKind(frame))) return;
  const f = frame as any;
  // `!f.parent_tool_use_id` mirrors TurnMapper.ingest EXACTLY (it discards every nested/subagent frame
  // before its own type routing): a persisted `user` row taking this direct path first would surface a
  // subagent's prompt as an ordinary top-level user message, which the live path never emits — and the
  // cold-vs-live id stitch rests on the two paths producing identical items. Nested rows fall through to
  // the mapper, which drops them.
  if (f?.type === "user" && !f.parent_tool_use_id) {
    const content = f.message?.content;
    const hasToolResult = Array.isArray(content) && content.some((b: any) => b?.type === "tool_result");
    if (!hasToolResult) {
      // Task 10d: the SAME reader the live arrival path uses (`peerArrival`, src/peer/address.ts). Asking
      // it here is what makes the cold-vs-live id stitch true for peer rows by construction of ONE rule,
      // rather than by two files happening to hold the same one. Same id with different text is worse than
      // either alone — a client that dedupes by id would render whichever copy it happened to see first,
      // so the message would depend on who was subscribed.
      // A peer row's text is never the raw persisted `content`: that carries a CLI-authored preamble
      // ("Another Claude session sent a message:") and safety postamble the sender never wrote.
      //   M9: and its ORIGIN travels with it, from the same reader, for the same reason the text does —
      // this item's third path (a projected arrival, below) carries `entry.origin`, and an item that
      // announced its peer attribution live only to lose it on reload would be a third answer under one id.
      const arrival = peerArrival(f);
      out.push(arrival
        ? arrivalItem(arrival.text, String(f.uuid ?? ""), arrival.origin)
        : userItem(flattenForDisplay(content as UserTurnInput), String(f.uuid ?? "")));
      return;
    }
  }
  for (const ev of mapper.ingest(frame)) if (ev.kind === "completed") out.push(ev.item);
}

/** The window's items, with each resolved arrival emitted at the position it was observed at.
 *
 *  AN ARRIVAL EMITS AFTER ITS ROW, not after the item that row opened — those differ, and the difference is
 *  the honest one. A `tool_use` row completes only when its result lands, possibly many rows later; the
 *  message really did arrive while that tool was still running, so it belongs between the two. Nothing here
 *  special-cases the straddle: emitting at the row is what produces it, and the same rule puts an arrival
 *  anchored to the last row ahead of `finalize`'s tail of still-open tools. */
export function projectItems(rows: unknown[], arrivals: ResolvedArrivals, windowIncludesRowZero: boolean): Item[] {
  const mapper = new TurnMapper();
  const items: Item[] = [];
  // Withheld outright on any window that does not start at row 0: a later page's first row is not the top
  // of history, and an arrival that preceded the whole transcript would otherwise be rendered in the middle
  // of it — once per page the client asks for.
  if (windowIncludesRowZero) for (const e of arrivals.atStart) items.push(arrivalItem(e.text, e.id, e.origin));
  for (let i = 0; i < rows.length; i++) {
    routeRow(mapper, rows[i], items);
    const here = arrivals.byRow.get(i);
    if (here) for (const e of here) items.push(arrivalItem(e.text, e.id, e.origin));
  }
  for (const ev of mapper.finalize(false)) if (ev.kind === "completed") items.push(ev.item);
  return items;
}

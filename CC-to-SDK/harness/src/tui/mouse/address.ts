// tui/mouse/address.ts — F10 S4: selection endpoints that survive the document moving under them.
//
// F9 addressed endpoints by NUMERIC ROW INDEX into the freshly-published window and cleared the selection
// whenever the itemKey at that index changed (`FullscreenViewport.tsx`'s own comment: "never wrong,
// sometimes just gone"). Canon does better and worse at once: it translates screen coordinates by the
// renderer's scroll delta and never clears (`C0p`/`k0p`, L198804-198853), which survives a scroll but
// mispoints whenever content changes WITHOUT one — an insert above in a non-sticky viewport, a fold
// toggling. ccx has what canon does not: the whole document in memory with durable per-item ids. So an
// endpoint here is CHARACTER IDENTITY — an item and an offset into that item's canonical text — and a
// re-wrap at a new width is a non-event by construction.
//   THE TWO SIDES ARE NOT SYMMETRIC, and that is round-3 F2: a single half-open lookup loses the trailing
// grapheme at a wrap edge. The lower endpoint wants the row that CONTAINS its offset; the upper endpoint
// wants the row whose trailing edge IS its offset. Hence two containment predicates and two fallbacks.
import { columnOfSourceChar, type HitRow } from "./hitmap.js";
import { createSelectionState, type Cell, type SelectionState } from "./selection.js";

/** F10 S4 — a selection endpoint that survives a re-wrap, an insert above, a fold toggle and a partial
 *  slice, because it names CHARACTER IDENTITY rather than screen geometry. */
export interface SelectionAddr { itemKey: string; charOffset: number }
/** …plus the exclusive end of the grapheme `charOffset` starts, recorded at gesture time. Which of the two
 *  numbers is used is decided at READ time by document order, never by the anchor/focus role: the LOWER
 *  endpoint contributes `charOffset`, the UPPER contributes `charEnd`. */
export interface SelectionEndpoint extends SelectionAddr { charEnd: number }

/** The gesture's two named ends, plus a live multi-click span carried alongside them (`dragToSpanned`'s own
 *  pivot — F10 S2). `focus: null` mirrors `SelectionState`'s own click/sweep discriminant: a plain press has
 *  no second endpoint yet. */
export interface SelectionAddresses {
  anchor: SelectionEndpoint;
  focus: SelectionEndpoint | null;
  span: { lo: SelectionEndpoint; hi: SelectionEndpoint; kind: "word" | "line" } | null;
}

/** Where an endpoint lands in a fresh row window. `virtual` is canon's `virtualAnchorRow/Col`: the address
 *  is still good, the item is simply off the window in `edge`'s direction, so the painted position is
 *  clamped to that edge and restores on scroll back. `undefined` = the item is not in the DOCUMENT at all
 *  (fold collapse, session swap) — the one case that warrants clearing. */
export interface Located { row: number; col: number; virtual: boolean; edge: -1 | 0 | 1 }

/** `charStart <= v < charEnd` — the lower endpoint's rule. At a soft-wrap boundary the value opens the
 *  FOLLOWING row, which is where the selection visibly starts. An EMPTY row (a blank hard line, whose whole
 *  source is the separator charged to the line above it) satisfies neither rule and is skipped by both. */
const containsLower = (row: HitRow, v: number): boolean => row.charStart <= v && v < row.charEnd;
/** `charStart < v <= charEnd` — the upper endpoint's rule. At a soft-wrap boundary the value closes the
 *  PRECEDING row, so its last grapheme stays inside the selection instead of being dropped. */
const containsUpper = (row: HitRow, v: number): boolean => row.charStart < v && v <= row.charEnd;

/** The contiguous run of painted rows belonging to one item. Bounded by the window height (tens of rows),
 *  so a scan finds it; the binary search below is what keeps the per-endpoint cost logarithmic in a tall
 *  item's own row count, which is the part that can actually grow. */
function runOf(rows: readonly HitRow[], itemKey: string): { lo: number; hi: number } | undefined {
  const lo = rows.findIndex((r) => r.itemKey === itemKey);
  if (lo < 0) return undefined;
  let hi = lo;
  while (hi + 1 < rows.length && rows[hi + 1]!.itemKey === itemKey) hi++;
  return { lo, hi };
}

function search(rows: readonly HitRow[], run: { lo: number; hi: number }, v: number, side: "lower" | "upper"): number {
  const contains = side === "lower" ? containsLower : containsUpper;
  let lo = run.lo, hi = run.hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, row = rows[mid]!;
    if (contains(row, v)) return mid;
    if (v < row.charStart) hi = mid - 1; else lo = mid + 1;
  }
  // No row contains it — a gap (a `\n` between a gutter block's hard rows, a blank line's empty row, or a
  // character a wrap consumed) or a value past the item's current end. Both snap the same way, per side:
  // the upper endpoint takes the greatest row that STARTS before it, the lower endpoint the least row that
  // ENDS after it.
  if (side === "upper") {
    for (let i = run.hi; i >= run.lo; i--) if (rows[i]!.charStart < v) return i;
    return run.lo;
  }
  for (let i = run.lo; i <= run.hi; i++) if (rows[i]!.charEnd > v) return i;
  return run.hi;
}

export function locateEndpoint(
  rows: readonly HitRow[], addr: SelectionEndpoint, side: "lower" | "upper",
  documentOrdinal: (itemKey: string) => number | undefined, windowOrdinals: { first: number; last: number },
  // F10 S4c fix round — two callers want two DIFFERENT numbers out of the same upper boundary, and
  // `columnOfSourceChar(row, charEnd)` can only ever answer one of them: it is the EXCLUSIVE column, one
  // PAST the last included grapheme (`wordSpan`/`lineSpan`'s own convention for `anchorSpan.hi`, consumed
  // directly by `selectedSpans`'s pivoted branch with no further snapping — this is `"exclusive"`, the
  // default, and every existing caller of this function keeps it, including this module's own span pair).
  // `remapSelection`'s ORDINARY `state.anchor`/`state.focus` (the non-span two-endpoint case) are a
  // DIFFERENT consumer: `selectedSpans`'s non-pivoted branch treats those columns as a RAW, INCLUSIVE mouse
  // click and re-derives the exclusive boundary itself via `snappedColumnRange`. Feeding it the already-
  // exclusive column double-snaps — `columnToChar` resolves that column onto the NEXT grapheme (whatever the
  // exclusive boundary sits in front of) and extends one more cluster past it (measured: `"select target
  // word"`, endpoint at source offset 6 — the space right after "select" — round-tripped through the
  // exclusive column and painted `"select "`, one character too many). `"inclusive"` asks for the column of
  // the LAST INCLUDED grapheme instead (`v - 1`, which `containsUpper`'s own contract guarantees still sits
  // inside the SAME row `search` already chose — `row.charStart < v <= row.charEnd` makes `v - 1 >=
  // row.charStart` unconditionally), which is exactly the raw-click column `selectedSpans` expects to re-snap.
  upperBoundary: "exclusive" | "inclusive" = "exclusive",
): Located | undefined {
  const ordinal = documentOrdinal(addr.itemKey);
  if (ordinal === undefined) return undefined;                    // gone from the DOCUMENT — the one clear case
  const run = runOf(rows, addr.itemKey);
  if (!run) {
    // Still in the document, off the window: canon's `virtualAnchorRow/Col`. Keep the address, clamp the
    // painted position to the edge it left by, and let the scroll back restore it exactly.
    const edge: -1 | 1 = ordinal < windowOrdinals.first ? -1 : 1;
    return { row: edge === -1 ? 1 : rows.length, col: edge === -1 ? 1 : (rows[rows.length - 1]?.width ?? 0) + 1, virtual: true, edge };
  }
  const v = side === "lower" ? addr.charOffset : addr.charEnd;
  const at = search(rows, run, v, side);
  const row = rows[at]!;
  const colValue = side === "upper" && upperBoundary === "inclusive" ? Math.max(row.charStart, v - 1) : v;
  return { row: at + 1, col: columnOfSourceChar(row, colValue), virtual: false, edge: 0 };
}

/** Document order for two endpoints: by the item's position in the document first, by source offset
 *  second. This — not the anchor/focus ROLE — is what decides which endpoint contributes `charOffset` and
 *  which contributes `charEnd` (round-2 F2: role-based half-open ranges break every backward drag). */
export function orderEndpoints(
  a: SelectionEndpoint, b: SelectionEndpoint, documentOrdinal: (itemKey: string) => number | undefined,
): [SelectionEndpoint, SelectionEndpoint] {
  const oa = documentOrdinal(a.itemKey) ?? 0, ob = documentOrdinal(b.itemKey) ?? 0;
  if (oa !== ob) return oa < ob ? [a, b] : [b, a];
  return a.charOffset <= b.charOffset ? [a, b] : [b, a];
}

function cellOf(loc: Located): Cell {
  return { row: loc.row, col: loc.col };
}

/** Resolve one ordered pair (already lo/hi, or an anchor/focus pair `orderEndpoints` still has to sort) into
 *  its two `Located`s, `undefined` the moment either side is gone from the document — the same short-circuit
 *  `remapSelection`/`projectSelectionOnto` both need before they can even ask about virtual/offscreen. */
function locatePair(
  lo: SelectionEndpoint, hi: SelectionEndpoint, rows: readonly HitRow[],
  documentOrdinal: (itemKey: string) => number | undefined, windowOrdinals: { first: number; last: number },
  upperBoundary: "exclusive" | "inclusive" = "exclusive",
): { lo: Located; hi: Located } | undefined {
  const locLo = locateEndpoint(rows, lo, "lower", documentOrdinal, windowOrdinals);
  const locHi = locateEndpoint(rows, hi, "upper", documentOrdinal, windowOrdinals, upperBoundary);
  if (!locLo || !locHi) return undefined;
  return { lo: locLo, hi: locHi };
}

/** The shared core of `remapSelection`/`projectSelectionOnto`: resolve every endpoint `addrs` names (the
 *  anchor alone, or the document-ordered anchor/focus pair, plus a live span if one rides along) and decide
 *  the three-way verdict. Returns the resolved pieces so each caller only has to turn them into the shape
 *  its own `SelectionState` wants. */
function resolveAddresses(
  addrs: SelectionAddresses, rows: readonly HitRow[],
  documentOrdinal: (itemKey: string) => number | undefined, windowOrdinals: { first: number; last: number },
): { status: "gone" } | {
  status: "offscreen" | "ok";
  main: { lo: Located; hi: Located; hasFocus: boolean };
  span: { lo: Located; hi: Located } | null;
} {
  const main = addrs.focus === null
    ? (() => {
        const loc = locateEndpoint(rows, addrs.anchor, "lower", documentOrdinal, windowOrdinals);
        return loc ? { lo: loc, hi: loc, hasFocus: false } : undefined;
      })()
    : (() => {
        const [lo, hi] = orderEndpoints(addrs.anchor, addrs.focus, documentOrdinal);
        // `"inclusive"` for an ORDINARY sweep — `main` feeds `state.anchor`/`state.focus`, which
        // `selectedSpans`'s non-pivoted branch re-snaps as a raw click (see `locateEndpoint`'s own header).
        // BUT a live `addrs.span` means the sweep is PIVOTED (`dragToSpanned`'s own word/line extension —
        // F10 S2): `selectedSpans`'s pivoted branch reads `state.anchor`/`state.focus` the SAME way it reads
        // `anchorSpan.lo/hi` — consumed directly, no re-snap — because `dragToSpanned` itself always writes
        // them from `wordSpan`/`lineSpan`'s own exclusive convention. Using `"inclusive"` here for a pivoted
        // sweep would under-select by one grapheme the moment it round-trips through a remap (caught by
        // `selectionPaint.test.tsx`'s own T6(j)/F10 S2 cases, which run real pivoted drags through this
        // exact path once `recordSelectionAddresses` records them like any other gesture).
        const pair = locatePair(lo, hi, rows, documentOrdinal, windowOrdinals, addrs.span ? "exclusive" : "inclusive");
        return pair ? { ...pair, hasFocus: true } : undefined;
      })();
  if (!main) return { status: "gone" };

  const spanPair = addrs.span ? locatePair(addrs.span.lo, addrs.span.hi, rows, documentOrdinal, windowOrdinals) : undefined;
  if (addrs.span && !spanPair) return { status: "gone" };
  const span = spanPair ?? null;

  const all = span ? [main.lo, main.hi, span.lo, span.hi] : [main.lo, main.hi];
  const offscreen = all.every((l) => l.virtual && l.edge === all[0]!.edge);
  return { status: offscreen ? "offscreen" : "ok", main, span };
}

/** The publish-time remap: order the pair, locate each side, write the resulting numeric `Cell`s back into
 *  `state`. `"gone"` = the itemKey left the document (clear); `"offscreen"` = both ends off the SAME edge
 *  (canon's `ELt`, L198855-198860 — retain, paint nothing, copy nothing); `"ok"` = painted normally, with
 *  either end possibly clamped-and-virtual. Mutates `state` in place, matching every other function in
 *  `selection.ts`. */
export function remapSelection(
  state: SelectionState, addrs: SelectionAddresses, rows: readonly HitRow[],
  documentOrdinal: (itemKey: string) => number | undefined, windowOrdinals: { first: number; last: number },
): "ok" | "offscreen" | "gone" {
  const resolved = resolveAddresses(addrs, rows, documentOrdinal, windowOrdinals);
  if (resolved.status === "gone") {
    state.anchor = null;
    state.focus = null;
    state.anchorSpan = null;
    return "gone";
  }
  if (resolved.status === "offscreen") return "offscreen";   // retain, paint nothing, copy nothing
  state.anchor = cellOf(resolved.main.lo);
  state.focus = resolved.main.hasFocus ? cellOf(resolved.main.hi) : null;
  state.anchorSpan = resolved.span ? { lo: cellOf(resolved.span.lo), hi: cellOf(resolved.span.hi), kind: addrs.span!.kind } : null;
  return "ok";
}

/** The same projection onto an ARBITRARY row array — the document-wide one Task 8's extractor builds.
 *  Returns a fresh `SelectionState` rather than mutating the live one, since the caller is a copy, not a
 *  paint; `null` when the addresses do not resolve there at all (gone from the document, OR — since a fresh
 *  copy has nothing to "retain" — every end lands off this array's own edge). */
export function projectSelectionOnto(
  rows: readonly HitRow[], addrs: SelectionAddresses,
  documentOrdinal: (itemKey: string) => number | undefined,
): SelectionState | null {
  const resolved = resolveAddresses(addrs, rows, documentOrdinal, { first: -Infinity, last: Infinity });
  if (resolved.status !== "ok") return null;
  const state = createSelectionState();
  state.anchor = cellOf(resolved.main.lo);
  state.focus = resolved.main.hasFocus ? cellOf(resolved.main.hi) : null;
  state.anchorSpan = resolved.span ? { lo: cellOf(resolved.span.lo), hi: cellOf(resolved.span.hi), kind: addrs.span!.kind } : null;
  return state;
}

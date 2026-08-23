// tui/mouse/documentText.ts — F10 S6: THE CAPTURE READS THE DOCUMENT, NOT THE WINDOW. With S4's durable
// addresses an endpoint that scrolled out is still exactly addressed, so the rows a copy needs are the
// DOCUMENT's rows, not the painted ones — which is why ccx needs no equivalent of canon's `Cka` off-screen
// text snapshot (L198912-198930) or its `scrolledOffAbove/Below` side-bands at all.
//   IT RUNS THE SAME TWO FUNCTIONS THE PAINT RUNS over whichever rows it is handed, so byte-for-byte
// agreement with the window extractor for a wholly visible selection is structural rather than a promise
// (and it is asserted anyway — `selectionCapture.test.ts` — because a selection whose text changed
// depending on whether it happened to auto-scroll would be the worst possible outcome here).
//   A MODULE RATHER THAN A CLOSURE, because the alternative is untestable: the walk's only home would be a
// private callback behind a component ref, and a "pure" test beside it would be exercising a second copy of
// the algorithm (plan review).
import { projectSelectionOnto, type SelectionAddresses } from "./address.js";
import { extractText } from "./extract.js";
import type { HitRow } from "./hitmap.js";
import { selectedSpans } from "./selection.js";

export function documentSelectionText(
  rows: readonly HitRow[], addrs: SelectionAddresses,
  documentOrdinal: (itemKey: string) => number | undefined,
): string {
  const state = projectSelectionOnto(rows, addrs, documentOrdinal);
  return state ? extractText(selectedSpans(state, rows), rows) : "";
}

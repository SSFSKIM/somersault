// appserver/items/replay.ts — persisted-transcript replay (spec D10): a saved session's frames as items.
//
// It is now ONE LINE, and that is the point (M9 Stage C). Replay is the projector with nothing to place —
// `project.ts` owns the loop and the per-row routing this file used to hold inline, and holds the reasoning
// that went with it. Delegating rather than mirroring is what makes the parity law ("a read with no
// arrivals returns exactly what it returned before M9") true by construction: there is one routing body,
// and a function cannot drift from itself.
//
// The NAME stays, and stays exported, because it is what the rest of the server means: `subscribe.ts`'s
// pager reads history, not arrivals, and its boundary bisect calls this many times per page.
import type { Item } from "./types.js";
import { EMPTY_ARRIVALS, projectItems } from "./project.js";

export function itemsFromTranscript(messages: unknown[]): Item[] {
  // `false` for the window flag: with no arrivals there is nothing to place at the start either, so the
  // value cannot change the result — it is the honest one for a caller that never says which window it is
  // reading, not a placeholder.
  return projectItems(messages, EMPTY_ARRIVALS, false);
}

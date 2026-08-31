// tui/src/streamingItems.ts — the in-flight turn's `RenderLine[]` as `RenderItem[]`, pre-wrapped to a width.
//
// WHY THIS EXISTS AT ALL. `LiveTurn.snapshot()` hands out lines wrapped at the width the turn STARTED with,
// and `<Line>` then lets Ink re-wrap them at whatever the terminal is now — which is fine for painting and
// useless for arithmetic. Every surface that has to reason about ROWS (the live window's budget, and
// Task 10's `pageItemSlices` walk over the fullscreen viewport) needs a height it can trust before Ink
// lays anything out: a line three times the region's width MUST report three rows, not one. So the wrap
// happens here, ahead of the renderer, and each physical row becomes its own one-row `kind: "line"` item —
// `renderItemHeight` is 1 for a line item, so the item count IS the row count by construction.
//
// IDS ARE SYNTHETIC AND STABLE, keyed by position (`stream:<line>`, plus `wrapItems`' own `#w<row>` suffix
// on a line that took more than one row). The streaming region is transient and is never published into
// `<Static>`, so these ids need no document identity — they only have to stay put across the re-renders of
// one turn, so React keeps its element instances instead of remounting the whole tail on every delta, and
// the SOURCE id has to survive a re-wrap so a held scroll offset can be remapped across a width change
// (`remapRowOffset`).
//
// THE WRAP ITSELF MOVED (T17 fix round) into `wrapItems`, which is now the one place the substrate turns a
// projection into painted rows — this module is the streaming region's id scheme over it. The behaviour is
// unchanged: a line that fits keeps its object, its `segments` and its styling; one that does not becomes
// one item per physical row with the gutter on the first and the continuation rows indented under the text.
//
// T-SPACE Task 2 (spec §2.2/D14) — THE STREAMING REGION JOINS THE ONE-BLANK-ABOVE-EVERY-BLOCK INVARIANT.
// Every other top-level rendered block gets its separator at a `toolRenderer.tsx` concat site
// (`withLeadingSeparator`), but this region is never assembled by one of those sites — it is the leaf that
// feeds `FullscreenViewport` and (via `rowsOf`) `ChatApp`'s classic-window budget directly, so the gap has to
// be minted HERE, ahead of both consumers, using the SAME shared gate (imported, not re-implemented) so the
// shape (no ownerKey, no clickable, no foldAnchor) and the non-empty gate (D11: an empty region is not a
// block and gets no separator — this is what keeps an interrupted/aborted stream from leaving an orphan
// blank row) are identical to every other block's. No document-start suppression here either (D7): this
// function has no idea what precedes it, so it always emits the gap for a non-empty region regardless of
// position — which is exactly the "first thing in an empty transcript still gets its separator" behaviour.
import type { RenderLine } from "./render.js";
import { streamOwnerKey, withLeadingSeparator, type RenderItem } from "./toolRenderer.js";
import { wrapItemsToWidth } from "./wrapItems.js";

/** Pre-wrap the live region to `width`, one item per physical row, with its own leading separator prepended
 *  when non-empty. `ownerKey` defaults to `streamOwnerKey`'s own fallback so `ChatApp`'s row-arithmetic call
 *  (measured, never hovered) and every pre-F10-T-HOVER test need no change — the VIEWPORT (the only caller
 *  whose output is hovered) passes the real key.
 *    ONE OWNER FOR THE WHOLE ARRAY, because the array IS one API message: `message_start` clears `current`
 *  (`liveTurn.ts`) and a completed assistant message clears it too (`ingest`), so the region physically
 *  cannot hold two messages at once.
 *    THE SEPARATOR IS ADDED BEFORE THE WRAP, keyed off line 0's own unwrapped id (`stream:0`) — stable for
 *  the whole message regardless of how many physical rows line 0 ends up wrapping to, and unaffected by the
 *  wrap step itself (an empty-text separator item never wraps to more than one row). This is also why the
 *  gap never accumulates across deltas: a longer `lines` array on the next delta still has the identical
 *  line 0 at index 0, so `withLeadingSeparator` mints the SAME id, not a new one. */
export function streamingItems(lines: readonly RenderLine[], width: number, ownerKey: string = streamOwnerKey("live")): readonly RenderItem[] {
  const items = lines.map((line, index) => ({ kind: "line" as const, id: `stream:${index}`, ownerKey, line }));
  return wrapItemsToWidth(withLeadingSeparator(items), width);
}

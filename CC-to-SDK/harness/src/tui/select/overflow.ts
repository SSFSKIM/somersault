// tui/select/overflow.ts — ONE spelling of the counted overflow indicators, shared by every windowed list in
// this package. It used to live in `rewindModel.ts`, which made every other dialog either import the rewind
// picker's model or type the strings a second time; `rewindModel` re-exports from here now, so the picker's
// own import is unchanged and there is still exactly one definition.
//
// UPSTREAM IS NOT INTERNALLY CONSISTENT HERE and we do not reproduce the inconsistency (W-S11): the bundle
// ships three indentations (paddingLeft 1 at the rewind picker L487190/193, 2 at the MCP and csb lists
// L465044/L467913, two leading spaces at the artifacts list L435655) and two forms (counted, and a countless
// `↑ more above` at L466948). The COPY below is upstream's counted form verbatim; each caller keeps its own
// indentation, which is the part that is genuinely per-frame.
import type { SelectWindow } from "./selectModel.js";

export const moreAbove = (n: number): string => `↑ ${n} more above`;
export const moreBelow = (n: number): string => `↓ ${n} more below`;

/** How many rows a reported `Select` window leaves off each end. `end` is exclusive (selectModel.ts). */
export function overflowRows(view: SelectWindow, total: number): { above: number; below: number } {
  return { above: Math.max(0, view.start), below: Math.max(0, total - view.end) };
}

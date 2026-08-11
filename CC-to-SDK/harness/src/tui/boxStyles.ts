// tui/boxStyles.ts — Ink `BoxStyle` objects this port needs and stock `cli-boxes` does not ship.
//
// Upstream's Ink is a FORK with extra entries in the box registry; ours is stock Ink 5, whose registry is
// `cli-boxes`'s five names. The seam that closes the gap is that Ink 5 accepts a `BoxStyle` OBJECT wherever
// it accepts a registry name (`node_modules/ink/build/styles.d.ts:142`), so a fork-only style can be
// TRANSCRIBED — its eight glyphs copied — rather than approximated with the nearest stock border.
//
// Lives here rather than beside its first consumer because it has two: `PlanDialog`'s plan body (Wave T t11)
// and the file dialog's write body (t17). A permission dialog importing a plan dialog to borrow a border
// would be the wrong dependency edge for a value that is neither's.

/** `luy.dashed` (2.1.220 L179535) — the style upstream's ink fork registers under the name `"dashed"`, which
 *  `SM` (L424996) then asks for. Corners included for completeness: they are SPACES upstream, and every
 *  consumer so far switches the left and right edges off, so they never actually print. */
export const DASHED_BORDER = Object.freeze({
  top: "╌", bottom: "╌", left: "╎", right: "╎", topLeft: " ", topRight: " ", bottomLeft: " ", bottomRight: " ",
});

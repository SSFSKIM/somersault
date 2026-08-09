// tui/src/compactionBar.ts — upstream's compaction progress bar, INCLUDING its fake progress curve.
//
// THE CURVE MEASURES NOTHING. `JCp` (L407448) is `min(95, round((1 - e^(-seconds/90)) * 100))` over
// elapsed wall-clock — the SDK exposes no compaction progress value and upstream computes none. It is
// ported because this project's goal is fidelity to the installed build and the formula is transcribed
// and cheap, and it is labelled here so nobody later "fixes" it by wiring it to pre_tokens/post_tokens —
// those arrive at the boundary, i.e. when the bar would already be finished.
//
// Geometry, all of it upstream's (L407977-978, L408060): width `min(40, columns - 2 - 6)` suppressed
// entirely under 8 cells, `marginLeft: 2`, a trailing dim `NN%` a single space after the bar, pill glyphs
// `▰`/`▱` (`█`/`░` on ink-bleed terminals), whole cells only — no sub-cell interpolation in this variant.

export const COMPACTING_VERB = "Compacting conversation";
export const BAR_MAX_WIDTH = 40, BAR_MIN_WIDTH = 8, BAR_MARGIN_LEFT = 2;
const FILL_GLYPH = "▰", EMPTY_GLYPH = "▱", FILL_BLEED = "█", EMPTY_BLEED = "░";
const RATIO_CAP = 95, TIME_CONSTANT_S = 90;

/** Upstream's saturating curve over elapsed wall-clock, in PERCENT (0..95), held monotonic against
 *  `previous` — a shrinking terminal or a clock that stepped backwards must never walk the bar back. */
export function compactionRatio(elapsedMs: number, previous = 0): number {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const ratio = Math.min(RATIO_CAP, Math.round((1 - Math.exp(-seconds / TIME_CONSTANT_S)) * 100));
  return Math.max(previous, ratio);
}

/** Cells the bar may occupy at this terminal width; 0 means SUPPRESS the bar (the verb line stays). */
export function barWidth(columns: number): number {
  const width = Math.min(BAR_MAX_WIDTH, columns - BAR_MARGIN_LEFT - 6);
  return width < BAR_MIN_WIDTH ? 0 : width;
}

/** `ratio` is a PERCENTAGE (0..100), not a 0..1 fraction: filled = round(ratio / 100 * width). */
export function barCells(ratio: number, width: number, inkBleed = false): { fill: string; empty: string } {
  const filled = Math.round(Math.min(100, Math.max(0, ratio)) / 100 * width);
  const [f, e] = inkBleed ? [FILL_BLEED, EMPTY_BLEED] : [FILL_GLYPH, EMPTY_GLYPH];
  return { fill: f.repeat(filled), empty: e.repeat(Math.max(0, width - filled)) };
}

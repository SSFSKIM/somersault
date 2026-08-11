// tui/select/selectModel.ts — the pure half of the `Select` primitive (F6 T1): the scroll window, the digit
// table, the visible-count clamp and the compact two-column measurements. Every rule below is TRANSCRIBED
// from 2.1.220 rather than designed; the bundle line is on the rule it produced.
//
// The one non-obvious shape is the window. Upstream does NOT recompute a window from the focus — it keeps
// `{visibleFromIndex, visibleToIndex}` in a reducer (`nz_`, L396851-396937) and nudges it, which is why the
// list scrolls the way it does: going DOWN the focus rides the bottom edge (`i = visibleToIndex + 1`,
// L396866), going UP it scrolls one row EARLY (`n.index <= visibleFromIndex`, L396882 — a step onto the row
// that is already the top of the window still scrolls, leaving one row of context above), and both ends WRAP
// to a freshly anchored window (L396862-396863, L396878-396881). A mid-anchored "keep the focus centred"
// window would be a different product; `viewAfterFocus` keeps the reducer's shape while taking only the new
// focus index, because that is all our `Select` keymap action can carry.
import stringWidth from "string-width";

/** `ZJs`'s own default (L397020) — five rows. */
export const VISIBLE_OPTION_COUNT = 5;
/** `MHp` (L397288): the rows `Nbr` reserves for everything that is not the list itself. */
export const CLAMP_CHROME_ROWS = 8;
/** `DHp` (L397288): the share of the terminal a compact two-column label may take. */
export const LABEL_COLUMN_FRACTION = 0.6;

export interface SelectWindow { start: number; end: number }
/** A window plus the row the cursor is on. `start`/`end` are absolute half-open option indexes. */
export interface SelectView extends SelectWindow { focus: number }

/** `Nbr` (L397256-397259): the caller's `visibleOptionCount`, capped by what the terminal can actually show —
 *  `max(1, floor((rows - 8) / perOption))`. Never returns 0: a one-row list beats an invisible one. */
export function clampVisible(visible: number, rows: number, perOption: 1 | 2 | 3): number {
  return Math.min(visible, Math.max(1, Math.floor((rows - CLAMP_CHROME_ROWS) / perOption)));
}

/** `nHp` (L396939-396957) / the reducer's `set-focus` case (L396923-396936): the window that shows `focus`
 *  with the least movement from `prev`. With no `prev` this is the mount-time window — top of the list, or
 *  bottom-anchored on `focus` when the focus starts past the first page. */
export function windowBounds(count: number, focus: number, visible: number, prev?: SelectWindow): SelectWindow {
  const size = Math.min(Math.max(0, visible), Math.max(0, count));
  if (size <= 0) return { start: 0, end: 0 };
  const f = Math.max(0, Math.min(count - 1, focus));
  const start = prev ? Math.max(0, Math.min(prev.start, count - size)) : 0;
  const end = Math.min(count, start + size);
  if (f >= start && f < end) return { start, end };
  if (f < start) return { start: f, end: Math.min(count, f + size) };
  const bottom = Math.min(count, f + 1);
  return { start: Math.max(0, bottom - size), end: bottom };
}

/** The reducer (`nz_`) collapsed onto "the focus moved to `target`". Every case reduces to `windowBounds`
 *  except one: a SINGLE step up onto (or above) the top visible row scrolls the window one row early
 *  (L396882-396885), which `windowBounds` would not do because that row is already on screen. */
export function viewAfterFocus(view: SelectView, count: number, visible: number, target: number): SelectView {
  if (count <= 0) return { focus: 0, start: 0, end: 0 };
  const f = Math.max(0, Math.min(count - 1, target));
  const size = Math.min(Math.max(0, visible), count);
  if (f === view.focus - 1 && f <= view.start) {
    const start = Math.max(0, view.start - 1);
    return { focus: f, start, end: Math.min(count, start + size) };
  }
  return { focus: f, ...windowBounds(count, f, visible, view) };
}

/** `DJs`'s numeric branch (L396765-396786). The digit is a 1-based ABSOLUTE position in the whole list (never
 *  window-relative); the return is its 0-based index, or -1 for "no target". `"0"` can never match (upstream
 *  computes `parseInt(d) - 1` and requires `>= 0`), and a digit that lands on a DISABLED row is a dead key —
 *  upstream `return`s rather than advancing to the next enabled row. */
export function digitTarget(options: readonly { disabled?: boolean }[], digit: string): number {
  if (!/^[0-9]$/.test(digit)) return -1;
  const index = Number.parseInt(digit, 10) - 1;
  if (index < 0 || index >= options.length) return -1;
  return options[index]?.disabled === true ? -1 : index;
}

/** What the two-column measurements need to see of an option. */
interface MeasuredOption { value: string; label: string; description?: string; type?: "input" }

/** L397053 (which per-option height the clamp uses) and L397171 (which branch renders): a compact list gets
 *  the aligned two-column layout only when descriptions are NOT inline, no row is an input, and at least one
 *  row has a description. */
export function isTwoColumn(options: readonly MeasuredOption[], inlineDescriptions: boolean): boolean {
  return !inlineDescriptions && !options.some((o) => o.type === "input") && options.some((o) => !!o.description);
}

/** L397053-397054: upstream clamps a two-column compact list as `"compact-vertical"` — two terminal rows per
 *  option — even though it renders it on one. Kept faithfully; the clamp signature stays general for the
 *  `expanded` (3) layout no F6 surface ships yet. */
export function perOptionRows(twoColumn: boolean): 1 | 2 { return twoColumn ? 2 : 1; }

/** L397176-397191: the shared label-column width — the widest `2 + indexPad + labelWidth (+2 when the row is
 *  the current value)` over every option, capped at 60% of the terminal. Input rows measure 0 (L397180). */
export function labelColumnWidth(
  options: readonly MeasuredOption[],
  { columns, indexPad, currentValue }: { columns: number; indexPad: number; currentValue?: string },
): number {
  const widths = options.map((o) => (o.type === "input" ? 0 : 2 + indexPad + stringWidth(o.label) + (currentValue === o.value ? 2 : 0)));
  return Math.min(Math.max(0, ...widths), Math.floor(columns * LABEL_COLUMN_FRACTION));
}

const segmenter = new Intl.Segmenter();
/** `gi` (L106951-106963): grapheme-wise truncation that reserves one column for its `…`. */
export function truncateLabel(label: string, width: number): string {
  if (stringWidth(label) <= width) return label;
  if (width <= 1) return "…";
  let used = 0, out = "";
  for (const { segment } of segmenter.segment(label)) {
    const w = stringWidth(segment);
    if (used + w > width - 1) break;
    out += segment; used += w;
  }
  return `${out}…`;
}

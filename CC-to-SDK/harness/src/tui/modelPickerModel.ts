// tui/src/modelPickerModel.ts — the /model picker's literals and geometry (F6 T11), transcribed from
// 2.1.220's `zAe` (L440917-441174). Pure: no React, no Ink, no I/O — everything a test can pin without a
// terminal lives here, and `ModelPicker.tsx` is only the layout plus the two key paths.
//
// The one number that matters: upstream windows the list at TEN rows (`tva = Math.min(10, tMe.length)`,
// L440969) and prints the remainder BELOW the list as its own counter row (`rva`, rendered through `bM` at
// L441132) — the `Select` primitive never prints a counter of its own, so the caller owns that line.

/** `hOH` L441096: bold, colour `remember`. */
export const MODEL_TITLE = "Select model";
/** `Trf` L441099 — the default `headerText`. Verbatim, `--model` and all. */
export const MODEL_SUBTITLE = "Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model.";
/** `dva` L441107, rendered ONLY when a session-only override is in force (upstream's `sessionModel` prop =
 *  `mainLoopModelForSession`). The name is the model's DISPLAY name (`eq(ZAa)`), not its id. */
export const sessionOnlyLine = (name: string): string =>
  `Currently using ${name} for this session only. Selecting a model will undo this.`;

/** `Math.min(10, tMe.length)` (L440969) — upstream's fixed cap, and ours only as the FALLBACK below. The
 *  parameter is the CATALOG SIZE, not a terminal height; it was called `rows` until Wave S t4 and that name
 *  was the whole confusion (the picker's genuine `rows` prop is the pane, and it lives in `ModelPicker.tsx`). */
export const MODEL_VISIBLE_MAX = 10;
export const modelVisibleCount = (total: number): number => Math.min(MODEL_VISIBLE_MAX, total);
/** `rva = Math.max(0, tMe.length - tva)` (L440969) — what the `… +N models` counter counts.
 *
 *  DELIBERATE DIVERGENCE (W-S11), added in Wave S t4. Upstream computes this off the fixed ten-row cap above
 *  and its `/model` list carries no scroll gutter at all, so on a pane too short for ten rows upstream's
 *  `… +N models` names a number unrelated to what is on screen. Ours follows the window `Select` ACTUALLY
 *  rendered — `Select` clamps its own `visibleOptionCount` by terminal height (`clampVisible`) and reports
 *  the result through `onViewChange`, the same channel the rewind picker's `↑ N more above` already reads.
 *  Passing no window keeps the upstream arithmetic, which is what the pre-migration tests pin. */
export const modelOverflowCount = (total: number, view?: { start: number; end: number }): number =>
  view ? Math.max(0, total - Math.max(0, view.end - view.start)) : Math.max(0, total - modelVisibleCount(total));
/** `bM`'s `unit` at L441132. */
export const MODEL_UNIT = "model";

/** `bva` L441157: `enter to set as default` · `s to use this session only` · `Esc to cancel`, composed by
 *  `$e`/`bn` (which print the chord in lower case — `bn`'s `fallback:"Esc"` is only reached with no keymap in
 *  scope at all). Written as one literal for the same reason `REWIND_FOOTER` is: the three chords are fixed
 *  keys of a modal that owns the keyboard, and one string is what the frame renders.
 *
 *  Upstream gates the whole footer on `isStandaloneCommand` and drops the `s` clause when no `onSetDefault`
 *  was passed (L441157). Ours is always both — the picker is only ever opened as a modal, and the default
 *  write always has somewhere to go (the ccx prefs file) — so it renders unconditionally. */
export const MODEL_FOOTER = "enter to set as default · s to use this session only · esc to cancel";

export interface ModelRow { value: string; displayName?: string; description?: string }
/** The row label, and the name every notice/`sessionOnlyLine` prints (upstream's `eq()`/`option.label`). */
export const modelLabel = (m: ModelRow | undefined, fallback = ""): string => m?.displayName ?? m?.value ?? fallback;
/** The display name for a VALUE, when all we have is the id — a session-only override outliving its row. */
export const modelName = (models: readonly ModelRow[], value: string): string =>
  modelLabel(models.find((m) => m.value === value), value);

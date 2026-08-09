// tui/src/modelPickerModel.ts — the /model picker's literals and geometry (F6 T11), transcribed from
// 2.1.220's `zAe` (L440917-441174). Pure: no React, no Ink, no I/O — everything a test can pin without a
// terminal lives here, and `ModelPicker.tsx` is only the layout plus the two key paths.
//
// The one number that matters: upstream windows the list at TEN rows (`tva = Math.min(10, tMe.length)`,
// L440969) and prints the remainder BELOW the list as its own counter row (`rva`, rendered through `bM` at
// L441132) — the `Select` primitive never prints a counter of its own, so the caller owns that line.

import { resolveModelAlias } from "../config/models.js";
import { DEFAULTS } from "../config/types.js";

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 11 (EP-C6) — THE EFFORT AXIS, pure half. Annex §C6.1 (glyphs), §C6.2 (the hint), §C6.3
// (the picker row) and §C6.4 (the standalone dialog's footer).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// It lives beside the picker's literals because §C6.3's row IS a row of that picker, and the standalone
// dialog (§C6.4) renders the same one. Nothing here is React — the two surfaces are `EffortRow.tsx` (the
// three coloured spans) and `EffortDialog.tsx` (the staging + footer).
//
// THE ONE MECHANISM FACT BEHIND ALL OF IT (probe 102, `waveC-grounding-probes.md` §(f)): the SDK has no
// `setEffort`. The runtime hook is `Query.applyFlagSettings({effortLevel})`, it is live mid-session, and it
// performs NO VALIDATION — `{effortLevel:"bogus"}` resolves silently and the session keeps running at
// whatever it was. So `isEffortLevel` below is not defensive boilerplate: it is the ONLY thing between a
// typo and an engine that will accept it without a word. Everything that can produce a level (the `/effort`
// argument, a rebind, an attach client) goes through it before a wire op is built.

/** The five levels, in upstream's own order — the order `xrf` (L441195) steps and wraps through. Identical
 *  to `cli/args.ts`'s `EFFORT_LEVELS` domain and to `config/validate.ts`'s enum; those two guard the launch
 *  flag and the config file, this one guards the running session. Kept as three literals rather than one
 *  shared constant because the two live on opposite sides of the tui/config boundary and neither package
 *  may import the other — `test/tui/effort.test.tsx`'s "across all three of its spellings" case pins them
 *  equal instead: it imports all three (a TEST is not bound by that runtime boundary) and compares this
 *  array against `args.ts`'s domain KEYS and `validate.ts`'s zod enum OPTIONS, as sets. */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_SET = new Set<string>(EFFORT_LEVELS);
/** The client-side gate. `Set.has` on a plain string — no prototype reachability to worry about, unlike the
 *  object-literal domains `args.ts` has to use `Object.hasOwn` on. */
export function isEffortLevel(v: unknown): v is EffortLevel { return typeof v === "string" && EFFORT_SET.has(v); }

/** `F7o` (L440864). The default arm returns `ePi` (`●`), which is why an UNDEFINED level — the unsupported
 *  row's own case — still prints a glyph; only its COLOUR changes there (`subtle`, not `claude`). */
export function effortGlyph(level?: EffortLevel): string {
  switch (level) {
    case "low": return "○";
    case "medium": return "◐";
    case "xhigh": return "◉";
    case "max": return "◈";
    default: return "●";                                   // `high` and `default:` are the same arm upstream
  }
}
/** `Jir` title-cases — except `xhigh`, which L441659 special-cases to the literal `xHigh` (lower x, upper H). */
export function effortTitle(level: EffortLevel): string {
  return level === "xhigh" ? "xHigh" : level[0].toUpperCase() + level.slice(1);
}
/** `$e chord={["left","right"]} action="adjust"` — `kUe` joins arrow chords with `arrowSep:"/"` (L183786,
 *  L183849) and `$e` appends ` to adjust`. One literal for the same reason `MODEL_FOOTER` is one. */
export const EFFORT_ADJUST_HINT = "←/→ to adjust";
/** `TQt` (L76519), verbatim. Printed under the row while (and only while) the level is `max`. */
export const MAX_EFFORT_CAVEAT = "May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.";

/** `yva`'s supported arm (L441142) as one string. Upstream's JSX is glyph, `" "`, the title-cased level,
 *  `" "`, the word `effort`, then `" (default)"` ONLY when the level equals the model's default, then `" "`,
 *  then the adjust hint — so the `(default)` clause takes its leading space with it when it goes.
 *  `EffortRow.tsx` renders the same pieces as three coloured spans; this is what the tests pin and what any
 *  non-coloured consumer can print. */
export function effortRowText(level: EffortLevel, isDefault: boolean): string {
  return `${effortGlyph(level)} ${effortTitle(level)} effort${isDefault ? " (default)" : ""} ${EFFORT_ADJUST_HINT}`;
}
/** `yva`'s unsupported arm: `<ivn effort={undefined}/>{" Effort not supported"}{nva ? ` for ${nva}` : ""}`.
 *  No adjust hint — there is nothing to adjust. */
export function effortUnsupportedText(modelName?: string): string {
  return `${effortGlyph(undefined)} Effort not supported${modelName ? ` for ${modelName}` : ""}`;
}

/** `xrf` (L441195): step and WRAP MODULO THE SUPPORTED LIST. Upstream builds that list by filtering `max`
 *  and `xhigh` out unless the model allows them; ours arrives pre-filtered from the catalog row's own
 *  `supportedEffortLevels`, which is the same set by the authoritative route. A `current` the list does not
 *  contain lands on index 0 rather than throwing — reachable when a session-scoped `max` outlives a switch
 *  to a model that does not offer it. */
export function stepEffort(levels: readonly EffortLevel[], current: EffortLevel, delta: 1 | -1): EffortLevel {
  if (levels.length === 0) return current;
  const at = levels.indexOf(current);
  if (at < 0) return levels[0];
  return levels[(at + delta + levels.length) % levels.length];
}

/** `prf` (L440857): `${F7o(e)} ${e} · /effort` — glyph, space, the RAW LOWERCASE level (not `Jir`'s
 *  title case: this is the one surface that prints the level as the wire spells it), ` · `, `/effort`. */
export function effortHint(level: EffortLevel): string { return `${effortGlyph(level)} ${level} · /effort`; }
/** The `Nd` call's own key and deadline (L496132). The key matters as much as the text: upstream REMOVES it
 *  and re-ADDs it on every change (L496126-134), and that remove-then-add is what restarts the ten seconds. */
export const EFFORT_HINT_KEY = "effort-level";
export const EFFORT_HINT_TIMEOUT_MS = 10_000;

/** §C6.4's `w` useMemo (L447278), composed from the same `kUe` chord formatter as the adjust hint above. */
export const EFFORT_DIALOG_FOOTER = "←/→ to adjust · Enter to confirm · Esc to cancel";

export interface ModelRow {
  value: string; displayName?: string; description?: string;
  /** The id the CATALOG says this row resolves to (`claude-opus-5`) — a real field of the live
   *  `supportedModels()` row, not an invention. Only §C8.6's sibling match reads it, and only as the
   *  authoritative answer to "which row IS ccx's default model": `resolveModelAlias` is OUR table, and the
   *  engine's alias→id mapping is the engine's to change. Absent on older catalogs, which is why the match
   *  still falls back to the alias resolver. */
  resolvedModel?: string;
}
/** The row label, and the name every notice/`sessionOnlyLine` prints (upstream's `eq()`/`option.label`). */
export const modelLabel = (m: ModelRow | undefined, fallback = ""): string => m?.displayName ?? m?.value ?? fallback;
/** The display name for a VALUE, when all we have is the id — a session-only override outliving its row. */
export const modelName = (models: readonly ModelRow[], value: string): string =>
  modelLabel(models.find((m) => m.value === value), value);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 13 (EP-C8 §C8.6) — the `default` row's description, `AJn` (L76856).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Upstream's row NAMES THE MODEL IT CURRENTLY RESOLVES TO: `Use the default model (currently Sonnet 5)`.
// Ours arrives from `supportedModels()` carrying the SDK's own sentence, which names the SDK's default —
// and ccx's `default` alias does not resolve there (`config/models.ts`: `default → claude-opus-5`, an owner
// decision taken deliberately AGAINST the SDK's moving recommendation). So the row as shipped tells the user
// a model they will not get. Rewritten here, from the same resolver every other surface asks.
//
// Importing the config layer from `src/tui/` is the established pattern for exactly this — `modelConfirmModel.ts`
// pulls `resolveModelAlias` and `PlanDialog.tsx` pulls `isAutoSupportedModel`. (The `EFFORT_LEVELS` comment
// above is about `cli/args.ts` and `config/validate.ts`, which are a different boundary.)

/** The catalog value that IS the default row.
 *  DIVERGENCE (§C8.6 `value: null`): ours stays the catalog's alias STRING. Upstream's `null` means "clear the
 *  explicit model"; ccx has no such cleared state on this path — a pick flows through `resolveModelAlias` and
 *  is written to prefs, and a `null` there would be a second, unwritten way to mean the same model. Only the
 *  DESCRIPTION is rewritten below, which is the honesty defect §C8.6 was cited for. */
export const DEFAULT_ROW_VALUE = "default";
/** What ccx's default alias actually resolves to — the same expression `resolveOptions.ts:48` runs. */
export const ccxDefaultModel = (): string => resolveModelAlias(DEFAULT_ROW_VALUE) ?? DEFAULTS.model;
/** `Use the default model (currently ${x9r(t)})`, verbatim minus the pricing/attribution suffixes (`i`/`xug`)
 *  — ccx has neither a promo price nor an org-attributed setting to append. */
export const defaultRowDescription = (name: string): string => `Use the default model (currently ${name})`;
/** Rewrite the default row in place in a catalog, naming the DISPLAY name of the sibling row that resolves to
 *  the same id (`Opus 5`, upstream's `x9r`) and falling back to the bare id when the catalog has no such row.
 *  Every other row is returned untouched — the SDK's descriptions are its own to write. */
export function withDefaultRowDescription<T extends ModelRow>(rows: readonly T[]): T[] {
  const target = ccxDefaultModel();
  // `resolvedModel` FIRST (t13 review finding 3): the live catalog row states its own target id, and that
  // beats re-deriving one through our alias table — a row whose `value` our table has never heard of still
  // matches, and a row the engine has re-pointed matches where it actually points. `resolveModelAlias` stays
  // as the fallback for rows (and fixtures) that carry no such field.
  const named = rows.find((r) => r.value !== DEFAULT_ROW_VALUE && (r.resolvedModel ?? resolveModelAlias(r.value)) === target);
  const name = named ? modelLabel(named, target) : target;
  return rows.map((r) => (r.value === DEFAULT_ROW_VALUE ? { ...r, description: defaultRowDescription(name) } : r));
}

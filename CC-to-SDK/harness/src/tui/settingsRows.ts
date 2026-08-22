// tui/src/settingsRows.ts — pure row/search/summary model for the /config Settings dialog's Config tab
// (Wave 3 task 5). No React/Ink/session here — SettingsDialog.tsx renders these rows, useChat.ts diffs
// them (baseline vs. current, captured on open/close) to build the Esc-close change summary. Deliberately
// ONLY the 5 rows we can actually apply through this harness's engine surface — not upstream's ~54, most of
// which are meaningless without the real Claude Code client (Global Constraints, recorded divergence).
import type { RenderLine } from "./render.js";
import type { ThemeId } from "./theme.js";

/** Everything a row's display value is computed from — a snapshot, not a live subscription. useChat takes
 *  one snapshot when /config opens (the baseline) and another when it closes (current), diffing the two
 *  `buildRows()` outputs row-by-row to decide what changed. */
export interface SettingsRowCtx { theme: ThemeId; model?: string; outputStyle: string; mode: string; thinkLevel: string; showTurnDuration: boolean; reduceMotion: boolean; promptSuggestionEnabled: boolean; progressBar: boolean; copyOnSelect: boolean }

export interface SettingsRow {
  id: "theme" | "model" | "outputStyle" | "permissionMode" | "thinking" | "showTurnDuration" | "reduceMotion" | "promptSuggestionEnabled" | "progressBar" | "copyOnSelect";
  label: string;
  type: "boolean" | "enum" | "managedEnum";
  value: string;                       // display value ("Default (recommended)" for unset model, "true"/"false" for booleans)
  options?: string[];                  // enum only — cycleEnum's wrap universe
  hint?: string;                       // dim hint text, only theme/model carry one (Global Constraints line 29)
}

// bypassPermissions is deliberately excluded — matches upstream's own /config row (it's reached only via
// /yolo here, same divergence upstream itself makes for this specific row). Exported: useChat.ts's Tab
// ladder cycles this SAME sequence (review finding 3, Wave 3 task 5 fix pass) — a single source so the
// ladder and this row's cycle order can never quietly drift apart.
export const PERMISSION_MODE_OPTIONS = ["default", "acceptEdits", "plan", "auto"];
const MODEL_UNSET = "Default (recommended)";
export const THINKING_WARNING = "Changing thinking mode mid-conversation will increase latency and may reduce quality.";

/** ctx → the 7 Config rows, in the pinned display order (Global Constraints line 29).
 *
 *  `showTurnDuration` carries UPSTREAM'S OWN LABEL, `Show turn duration` — it is a real `/config` row there,
 *  ungated, captured in this repo's QA corpus of the shipped client
 *  (`docs/parity/qa-findings/frames-qa4/qa4-settings-cc.txt:24`). It is a boolean and it rides the `thinking`
 *  row's exact shape; only the storage differs (upstream's settings file vs. ccx's prefs file).
 *
 *  `promptSuggestionEnabled` is the same story one wave later (W-C T12, annex §C5.1 L315485): upstream's own
 *  id and its own label, `Prompt suggestions`, with NO description and no help text — the row is label-only
 *  there and label-only here. Upstream gates it behind the `tengu_chomp_inflection` feature flag (off at both
 *  of its two call sites) and files it under the `Input & controls` category; ccx has one flat Config list and
 *  no flag system, so the row is unconditional and simply sits last.
 *
 *  `reduceMotion` is F8 T6's row, and canon's own id and label character for character (bundle L383488:
 *  `{ id: "reduceMotion", label: "Reduce motion", value: r?.prefersReducedMotion ?? !1, type: "boolean" }`).
 *  It rides `showTurnDuration`'s exact shape and sits directly below it.
 *
 *  `progressBar` is T-CH34's row, and canon's own id and label character for character (bundle L383525-383526:
 *  `{ id: "progressBar", label: "Terminal progress bar", ... type: "boolean" }`) — note this id is DIFFERENT
 *  from the pref key it drives (`terminalProgressBarEnabled`, `prefs.ts`), exactly as `reduceMotion`'s row id
 *  differs from its own pref key (`prefersReducedMotion`); canon names its schema field and its `/config` row
 *  independently too. It rides `reduceMotion`'s exact shape and sits directly below it.
 *
 *  `copyOnSelect` is F9 T-MOUSE Task 7's row, and canon's own pref key (`prefs.ts`'s own doc) — DEFAULT TRUE.
 *  It rides `progressBar`'s exact shape and sits last, below `promptSuggestionEnabled`: the newest boolean in
 *  the list, unconditional like every other row here. */
export function buildRows(ctx: SettingsRowCtx): SettingsRow[] {
  return [
    { id: "theme", label: "Theme", type: "managedEnum", value: ctx.theme, hint: "For custom themes, use /theme." },
    { id: "model", label: "Model", type: "managedEnum", value: ctx.model ?? MODEL_UNSET, hint: "For a specific model ID, use /model." },
    { id: "outputStyle", label: "Output style", type: "managedEnum", value: ctx.outputStyle },
    { id: "permissionMode", label: "Default permission mode", type: "enum", value: ctx.mode, options: [...PERMISSION_MODE_OPTIONS] },
    { id: "thinking", label: "Thinking mode", type: "boolean", value: String(ctx.thinkLevel !== "off") },
    { id: "showTurnDuration", label: "Show turn duration", type: "boolean", value: String(ctx.showTurnDuration) },
    { id: "reduceMotion", label: "Reduce motion", type: "boolean", value: String(ctx.reduceMotion) },
    { id: "progressBar", label: "Terminal progress bar", type: "boolean", value: String(ctx.progressBar) },
    { id: "promptSuggestionEnabled", label: "Prompt suggestions", type: "boolean", value: String(ctx.promptSuggestionEnabled) },
    { id: "copyOnSelect", label: "Copy on select", type: "boolean", value: String(ctx.copyOnSelect) },
  ];
}

/** Case-insensitive label substring match — the `/` search box's filter (empty query matches everything). */
export function filterRows(rows: SettingsRow[], q: string): SettingsRow[] {
  const needle = q.toLowerCase();
  return rows.filter((r) => r.label.toLowerCase().includes(needle));
}

/** Next option after the row's current value, wrapping past the end back to the first. A row with no
 *  `options` (managedEnum) or an unrecognized current value is a harmless no-op / wraps to the first. */
export function cycleEnum(row: SettingsRow): string {
  const opts = row.options ?? [];
  if (opts.length === 0) return row.value;
  const i = opts.indexOf(row.value);
  return opts[(i + 1) % opts.length];
}

/** changes: label → new display value, in the order the caller inserted them (buildRows' row order, since
 *  useChat diffs baseline-vs-current row-by-row in that order). "Set {label} to {value}", value bold — the
 *  label/prefix carries no style so the two segments concatenate back to the exact same plain `text`. */
export function summarizeChanges(changes: Map<string, string>): RenderLine[] {
  return [...changes.entries()].map(([label, value]) => ({
    text: `Set ${label} to ${value}`,
    segments: [{ text: `Set ${label} to ` }, { text: value, bold: true }],
  }));
}

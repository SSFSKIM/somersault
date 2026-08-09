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
export interface SettingsRowCtx { theme: ThemeId; model?: string; outputStyle: string; mode: string; thinkLevel: string; showTurnDuration: boolean }

export interface SettingsRow {
  id: "theme" | "model" | "outputStyle" | "permissionMode" | "thinking" | "showTurnDuration";
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

/** ctx → the 6 Config rows, in the pinned display order (Global Constraints line 29).
 *
 *  RECORDED DIVERGENCE (Wave C T7): `showTurnDuration` is a row HERE and is not one upstream. Upstream
 *  declares the setting in its schema (bundle L42035) and reads it straight out of the settings file
 *  (L428650) with no `/config` entry at all — the reachable surface for it there is hand-editing JSON. ccx
 *  keeps the value in its own prefs file, so a row is the only surface it could have; it is a boolean and it
 *  rides the `thinking` row's exact shape. */
export function buildRows(ctx: SettingsRowCtx): SettingsRow[] {
  return [
    { id: "theme", label: "Theme", type: "managedEnum", value: ctx.theme, hint: "For custom themes, use /theme." },
    { id: "model", label: "Model", type: "managedEnum", value: ctx.model ?? MODEL_UNSET, hint: "For a specific model ID, use /model." },
    { id: "outputStyle", label: "Output style", type: "managedEnum", value: ctx.outputStyle },
    { id: "permissionMode", label: "Default permission mode", type: "enum", value: ctx.mode, options: [...PERMISSION_MODE_OPTIONS] },
    { id: "thinking", label: "Thinking mode", type: "boolean", value: String(ctx.thinkLevel !== "off") },
    { id: "showTurnDuration", label: "Turn duration", type: "boolean", value: String(ctx.showTurnDuration) },
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

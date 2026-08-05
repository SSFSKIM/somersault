// tui/src/bgDialogModel.ts — the PURE half of the Background dialog (F6 T13, DG60): section routing, the
// status badge, the counts subtitle and the two clip rules. Transcribed from `rsi` (bundle L481110-481256),
// its section header `zSt` (L481282), its row `$Lr`/`Woi` (L481295/L478653) and the badge pair `Goi`/`S4`
// (L478611/L478603).
//
// UPSTREAM HAS TEN TASK TYPES AND WE HAVE THREE. `rsi` splits `Object.values(tasks)` into bash / remote_agent /
// local_agent / teammate / workflow / mcp-monitor / mcp-task / dream / auto-mode-scan and renders a titled
// section for each. Our wire (probe 74) carries `task_type` from the SDK's own background-task snapshot, which
// in practice is `local_bash` and `local_agent`/`agent` — so the sections below are upstream's first three plus
// a catch-all, and the catch-all is load-bearing rather than defensive: the list index the cursor moves over is
// the CONCATENATION of the sections, so a row that belonged to no section would silently shift every selection
// past it.
import type { BgTaskRow } from "./bgTaskMeta.js";
import type { ThemeTokenName } from "./theme.js";
import { truncateLabel } from "./select/selectModel.js";

export type BgSection = "agents" | "shells" | "monitors" | "tasks";

/** Section order and labels, following `re`'s order (L481255) for the three we have. */
export const BG_SECTIONS: readonly { key: BgSection; label: string }[] = [
  { key: "agents", label: "Agents" }, { key: "shells", label: "Shells" },
  { key: "monitors", label: "Monitors" }, { key: "tasks", label: "Tasks" },
];

/** `VSb`'s switch (L481258) reduced to the types our snapshot actually uses. Anything unrecognised lands in
 *  `tasks` rather than nowhere. */
export function bgSection(taskType: string): BgSection {
  const t = taskType.toLowerCase();
  if (t.includes("monitor")) return "monitors";
  if (t.includes("bash") || t.includes("shell")) return "shells";
  if (t.includes("agent") || t.includes("teammate")) return "agents";
  return "tasks";
}

/** `zSt` (L481282-481293): two leading spaces, the bold label, then a dim ` (n)`. */
export const bgSectionHeader = (label: string, size: number): string => `  ${label} (${size})`;

/** `Goi` (L478611) mapped through `S4` (L478603): the label a status prints and the theme role it takes.
 *  `running`/`pending` print the status word itself with no colour; an unknown status does the same, which is
 *  `S4`'s own `label ?? status` fallback rather than a guess. */
export function bgBadge(status: string): { label: string; color?: ThemeTokenName } {
  switch (status) {
    case "completed": return { label: "done", color: "success" };
    case "failed": case "error": return { label: "error", color: "error" };
    case "killed": case "stopped": return { label: "stopped", color: "warning" };
    default: return { label: status };
  }
}

/** The row's own label: a shell shows its COMMAND (falling back to the description when the harvest never saw
 *  the tool_use that started it), everything else shows its description (`VSb`, L481261-481265). */
export const bgRowLabel = (row: BgTaskRow): string =>
  (bgSection(row.task_type) === "shells" ? row.command ?? row.description : row.description) || row.task_id;

/** `EFf = Math.max(30, columns - 26)` (L481296) — the width `Woi` clips a row label to. */
export const bgLabelWidth = (columns: number): number => Math.max(30, columns - 26);

/** `oa(text, width, true)` (L106993): a multi-line value is cut at its first newline and marked with an
 *  ellipsis, unless that first line would already overflow — then the ordinary clip runs. */
export function clipLine(text: string, width: number): string {
  const nl = text.indexOf("\n");
  if (nl === -1) return truncateLabel(text, width);
  const head = text.slice(0, nl);
  return head.length + 1 > width ? truncateLabel(head, width) : `${head}…`;
}

const running = (rows: readonly BgTaskRow[], section: BgSection): number =>
  rows.filter((r) => r.status === "running" && bgSection(r.task_type) === section).length;

/** `K` (L481255): the counts line under the title, clauses joined by ` · `, each clause dropped at zero and
 *  singular at one. Upstream has three clauses (teammates → `N agents`, shells → `N active shells`, remote +
 *  local agents → `N active agents`); ours has the two whose rows are reachable headlessly, and our agent rows
 *  take the `agents` wording. */
export function bgSubtitle(rows: readonly BgTaskRow[]): string {
  const agents = running(rows, "agents"), shells = running(rows, "shells");
  const parts: string[] = [];
  if (agents > 0) parts.push(`${agents} ${agents !== 1 ? "agents" : "agent"}`);
  if (shells > 0) parts.push(`${shells} ${shells !== 1 ? "active shells" : "active shell"}`);
  return parts.join(" · ");
}

export interface BgGroup { key: BgSection; label: string; rows: BgTaskRow[] }
/** The sections in render order with their rows, empty ones dropped — and `flat`, the concatenation the
 *  cursor indexes into (`allSelectableItems`, L481130). */
export function bgGroups(rows: readonly BgTaskRow[]): { groups: BgGroup[]; flat: BgTaskRow[] } {
  const groups = BG_SECTIONS
    .map(({ key, label }) => ({ key, label, rows: rows.filter((r) => bgSection(r.task_type) === key) }))
    .filter((g) => g.rows.length > 0);
  return { groups, flat: groups.flatMap((g) => g.rows) };
}

export const BG_TITLE = "Background";
export const BG_EMPTY = "No tasks currently running";
/** Handed to `onClose` and NOT printed — see BgTasksPanel's header for the `display:"skip"` reading. */
export const BG_DISMISSED = "Background dialog dismissed";
export const BG_FOOTER = "↑↓ select · enter view · x stop · escape close";
export const BG_DETAIL_FOOTER = "left go back · escape close · x stop";
export const SHELL_DETAIL_TITLE = "Shell details";
export const MONITOR_DETAIL_TITLE = "Monitor details";
export const NO_OUTPUT = "No output available";
/** `Y8a` (L479900): the tail is the last TEN lines. */
export const TAIL_LINES = 10;
